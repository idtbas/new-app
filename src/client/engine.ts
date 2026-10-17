// Ablaufsteuerung: Profile vorab erzeugen (wenige), Likes bewerten lassen, simulierte
// Verzögerungen abarbeiten. Alles läuft nur, solange die Seite geöffnet ist – es gibt
// keine Hintergrundaktivität, und es wird nichts dergleichen behauptet.

import { LIMITS } from "../shared/config";
import { castCharacter } from "../shared/casting";
import { BLOCKING_KINDS, type ApiErrorInfo, describeError } from "../shared/errors";
import { decide } from "../shared/matching";
import { validateCharacter } from "../shared/schema";
import type { Character, ChatMode, UserProfile } from "../shared/types";
import { api, ApiError, toErrorInfo } from "./api";
import { applyDecision, applyTurn, buildHistory, replyDelay } from "./chatlogic";
import { hasCredentials } from "./credentials";
import * as db from "./db";
import { newRelation, type Relation, type StoredMessage } from "./model";

/** Maximal so viele automatische Versuche pro Job, danach nur noch per Knopf. */
const MAX_JOB_FAILURES = 2;
const RETRY_BACKOFF_MS = 90_000;

type Listener = () => void;

export interface DeckEntry {
  character: Character;
  relation: Relation;
}

class Engine {
  user: UserProfile | null = null;
  generating = false;
  generationError: ApiErrorInfo | null = null;
  /** Gesetzt bei Fehlern, die ohne Handeln der Person nicht verschwinden (z. B. ungültiger Token). */
  paused: ApiErrorInfo | null = null;
  readonly typing = new Set<string>();
  readonly evaluating = new Set<string>();
  readonly imageErrors = new Map<string, string>();
  private readonly imageBusy = new Set<string>();
  private readonly imageUrls = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private readonly matchListeners = new Set<(id: string) => void>();
  private readonly toastListeners = new Set<(msg: string) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticking = false;
  private tickAgain = false;

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  onMatch(fn: (id: string) => void): void {
    this.matchListeners.add(fn);
  }
  onToast(fn: (msg: string) => void): void {
    this.toastListeners.add(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }
  private toast(msg: string): void {
    for (const fn of this.toastListeners) fn(msg);
  }

  private handleError(err: unknown, context: string): ApiErrorInfo {
    const info = toErrorInfo(err);
    if (BLOCKING_KINDS.includes(info.kind)) this.paused = info;
    this.toast(`${context}: ${describeError(info)}`);
    return info;
  }

  /** Nach Eingabe neuer Zugangsdaten: Pause aufheben und Arbeit wieder aufnehmen. */
  resume(): void {
    this.paused = null;
    this.generationError = null;
    this.emit();
    void this.fillDeck();
    void this.resumeImages();
    void this.tick();
  }

  setUser(user: UserProfile): void {
    this.user = user;
  }

  // -------------------------------------------------------------------------
  // Stapel / Profilerzeugung

  async deck(): Promise<DeckEntry[]> {
    const rels = (await db.allRelations()).filter((r) => r.status === "unseen").sort((a, b) => a.createdAt - b.createdAt);
    const out: DeckEntry[] = [];
    for (const r of rels) {
      const c = await db.getCharacter(r.id);
      if (c) out.push({ character: c, relation: r });
    }
    return out;
  }

  canWork(): boolean {
    return hasCredentials() && this.paused === null && this.user !== null;
  }

  /** Erzeugt Profile, bis höchstens LIMITS.prefetchProfiles ungesehene vorrätig sind. Bricht beim ersten Fehler ab. */
  async fillDeck(): Promise<void> {
    if (this.generating || !this.canWork()) return;
    this.generating = true;
    this.generationError = null;
    this.emit();
    try {
      for (let guard = 0; guard < LIMITS.prefetchProfiles; guard++) {
        const unseen = (await db.allRelations()).filter((r) => r.status === "unseen").length;
        if (unseen >= LIMITS.prefetchProfiles || !this.canWork() || !this.user) break;
        const usedNames = new Set((await db.allCharacters()).map((c) => c.spec.name));
        const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
        const spec = castCharacter(seed, this.user, { usedNames });
        const generated = await api.character(spec);
        let character: Character;
        try {
          character = validateCharacter(generated);
        } catch {
          throw new ApiError({ kind: "model_output", message: "Das erzeugte Profil ist unvollständig." });
        }
        // Die Eckdaten stammen immer aus dem lokalen Casting, nicht aus der Antwort.
        if (character.spec.id !== spec.id || character.spec.age !== spec.age || character.spec.name !== spec.name) {
          throw new ApiError({ kind: "model_output", message: "Das erzeugte Profil passt nicht zu den Vorgaben." });
        }
        await db.addCharacterWithRelation(character, newRelation(character.id, Date.now()));
        this.emit();
        void this.loadImage(character);
      }
    } catch (err) {
      this.generationError = this.handleError(err, "Profil konnte nicht erzeugt werden");
    } finally {
      this.generating = false;
      this.emit();
    }
  }

  // -------------------------------------------------------------------------
  // Bilder

  imageUrl(id: string): string | undefined {
    return this.imageUrls.get(id);
  }

  async ensureImageUrl(id: string): Promise<string | undefined> {
    const cached = this.imageUrls.get(id);
    if (cached) return cached;
    const img = await db.getImage(id);
    if (!img) return undefined;
    const url = URL.createObjectURL(img.blob);
    this.imageUrls.set(id, url);
    return url;
  }

  isImageLoading(id: string): boolean {
    return this.imageBusy.has(id);
  }

  /** Ein Bild pro Charakter, einmalig. Fehler machen nur dieses Bild unbrauchbar, nicht die App. */
  async loadImage(c: Character): Promise<void> {
    if (this.imageBusy.has(c.id) || !hasCredentials()) return;
    const rel = await db.getRelation(c.id);
    if (!rel || rel.imageState === "ready") return;
    this.imageBusy.add(c.id);
    this.imageErrors.delete(c.id);
    this.emit();
    try {
      const res = await api.image(c);
      const bytes = Uint8Array.from(atob(res.base64), (ch) => ch.charCodeAt(0));
      await db.putImage({ id: c.id, blob: new Blob([bytes], { type: res.mime }) });
      const fresh = await db.getRelation(c.id);
      if (fresh) await db.putRelation({ ...fresh, imageState: "ready" });
    } catch (err) {
      const info = toErrorInfo(err);
      if (BLOCKING_KINDS.includes(info.kind)) this.paused = info;
      this.imageErrors.set(c.id, describeError(info));
      const fresh = await db.getRelation(c.id);
      if (fresh) await db.putRelation({ ...fresh, imageState: "failed" });
    } finally {
      this.imageBusy.delete(c.id);
      this.emit();
    }
  }

  /** Nach dem Neuladen: fehlende Bilder sichtbarer Profile nachladen (nicht fehlgeschlagene). */
  async resumeImages(): Promise<void> {
    if (!this.canWork()) return;
    for (const r of await db.allRelations()) {
      if (r.imageState !== "none" || r.status === "passed" || r.status === "rejected") continue;
      const c = await db.getCharacter(r.id);
      if (c) await this.loadImage(c);
    }
  }

  // -------------------------------------------------------------------------
  // Swipen und Matching

  async swipe(id: string, action: "like" | "pass"): Promise<void> {
    const rel = await db.getRelation(id);
    // Nur ungesehene Profile können bewertet werden – kein erneutes Bewerten.
    if (!rel || rel.status !== "unseen") return;
    const now = Date.now();
    if (action === "pass") {
      await db.putRelation({ ...rel, status: "passed" });
    } else {
      await db.putRelation({ ...rel, status: "awaiting", likedAt: now });
    }
    this.emit();
    if (action === "like") await this.evaluate(id);
    void this.fillDeck();
  }

  /** Die Figur entscheidet einmalig über das Like. Die Entscheidung wird gespeichert. */
  async evaluate(id: string, manual = false): Promise<void> {
    if (this.evaluating.has(id) || !this.user) return;
    const rel = await db.getRelation(id);
    const c = await db.getCharacter(id);
    if (!rel || !c || rel.status !== "awaiting" || rel.decision) return;
    if (!manual && (rel.jobFailures >= MAX_JOB_FAILURES || (rel.retryAfter ?? 0) > Date.now())) return;
    if (!this.canWork()) return;
    this.evaluating.add(id);
    this.emit();
    try {
      const { impression } = await api.evaluate(c, this.user);
      const latest = await db.getRelation(id);
      if (!latest || latest.decision) return; // bereits entschieden: nichts neu berechnen
      const now = Date.now();
      const decision = decide({ character: c, user: this.user, impression, now });
      const next = applyDecision(latest, c, decision, now);
      await db.putRelation(next);
      if (next.status === "matched") this.announceMatch(c.id);
    } catch (err) {
      const latest = await db.getRelation(id);
      if (latest) await db.putRelation({ ...latest, jobFailures: latest.jobFailures + 1, retryAfter: Date.now() + RETRY_BACKOFF_MS });
      this.handleError(err, `Rückmeldung von ${c.spec.name} fehlgeschlagen`);
    } finally {
      this.evaluating.delete(id);
      this.emit();
      this.schedule();
    }
  }

  private announceMatch(id: string): void {
    for (const fn of this.matchListeners) fn(id);
  }

  // -------------------------------------------------------------------------
  // Chat

  async sendMessage(id: string, text: string): Promise<void> {
    const rel = await db.getRelation(id);
    const c = await db.getCharacter(id);
    const clean = text.trim().slice(0, 1000);
    if (!rel || !c || rel.status !== "matched" || rel.chatEnded || clean === "") return;
    const now = Date.now();
    await db.addMessage({ charId: id, from: "user", text: clean, at: now });
    await db.putRelation({
      ...rel,
      lastReadAt: now,
      openerDueAt: undefined,
      // Mehrere schnelle Nachrichten werden gemeinsam beantwortet.
      replyDueAt: rel.replyDueAt ?? now + replyDelay(c, rel.interest),
      jobFailures: 0,
      retryAfter: undefined,
    });
    this.emit();
    this.schedule();
  }

  async markRead(id: string): Promise<void> {
    const rel = await db.getRelation(id);
    if (rel) await db.putRelation({ ...rel, lastReadAt: Date.now() });
  }

  async unmatchByUser(id: string): Promise<void> {
    const rel = await db.getRelation(id);
    if (!rel || rel.status !== "matched") return;
    const now = Date.now();
    await db.putRelation({ ...rel, status: "unmatched", chatEnded: true, endedBy: "user", replyDueAt: undefined, openerDueAt: undefined });
    await db.addMessage({ charId: id, from: "system", text: "Du hast das Match aufgelöst.", at: now });
    this.emit();
  }

  /** Manueller Neuversuch nach Fehlern (setzt den Zähler zurück). */
  async retryJob(id: string): Promise<void> {
    const rel = await db.getRelation(id);
    if (!rel) return;
    await db.putRelation({ ...rel, jobFailures: 0, retryAfter: undefined });
    if (rel.status === "awaiting") await this.evaluate(id, true);
    else void this.tick();
  }

  private async runChatTurn(rel: Relation, c: Character, mode: ChatMode): Promise<void> {
    if (!this.user) return;
    const startedAt = Date.now();
    const all = await db.messagesFor(c.id);
    const history = buildHistory(c.id, all, startedAt);
    this.typing.add(c.id);
    this.emit();
    try {
      const turn = await api.chat({ character: c, user: this.user, mode, interest: rel.interest, memory: rel.memory, history });
      const latest = (await db.getRelation(c.id)) ?? rel;
      if (latest.status !== "matched") return; // z. B. inzwischen vom Nutzer aufgelöst
      const now = Date.now();
      const outcome = applyTurn(latest, c, turn, now);
      for (const m of outcome.messages) await db.addMessage(m);
      // Hat die Person während der Generierung weitergeschrieben, folgt eine weitere Antwort.
      const after = await db.messagesFor(c.id);
      const newer = after.some((m: StoredMessage) => m.from === "user" && m.at > startedAt);
      if (newer && !outcome.relation.chatEnded) outcome.relation.replyDueAt = now + replyDelay(c, outcome.relation.interest);
      await db.putRelation(outcome.relation);
    } catch (err) {
      const latest = (await db.getRelation(c.id)) ?? rel;
      await db.putRelation({ ...latest, jobFailures: latest.jobFailures + 1, retryAfter: Date.now() + RETRY_BACKOFF_MS });
      this.handleError(err, `Antwort von ${c.spec.name} fehlgeschlagen`);
    } finally {
      this.typing.delete(c.id);
      this.emit();
    }
  }

  jobBlocked(rel: Relation): boolean {
    return rel.jobFailures >= MAX_JOB_FAILURES;
  }

  // -------------------------------------------------------------------------
  // Zeitsteuerung (nur bei geöffneter, sichtbarer Seite)

  async tick(): Promise<void> {
    if (this.ticking) {
      this.tickAgain = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickAgain = false;
        await this.processDue();
      } while (this.tickAgain);
    } finally {
      this.ticking = false;
      this.schedule();
    }
  }

  private async processDue(): Promise<void> {
    const now = Date.now();
    for (const rel of await db.allRelations()) {
      const c = await db.getCharacter(rel.id);
      if (!c) continue;
      const retryOk = (rel.retryAfter ?? 0) <= now && rel.jobFailures < MAX_JOB_FAILURES;

      if (rel.status === "pending" && rel.decision && (rel.decision.resolveAt ?? 0) <= now) {
        // Vorab festgelegtes Ergebnis wird sichtbar – ohne neue Berechnung.
        const next = applyDecision(rel, c, rel.decision, now);
        await db.putRelation(next);
        if (next.status === "matched") this.announceMatch(c.id);
        this.emit();
        continue;
      }
      if (!this.canWork() || !retryOk) continue;
      if (rel.status === "awaiting" && !rel.decision) {
        await this.evaluate(rel.id);
      } else if (rel.status === "matched" && !rel.chatEnded) {
        if (rel.replyDueAt !== undefined && rel.replyDueAt <= now) await this.runChatTurn(rel, c, "reply");
        else if (rel.openerDueAt !== undefined && rel.openerDueAt <= now) await this.runChatTurn(rel, c, "opener");
      }
    }
  }

  /** Plant den nächsten Durchlauf für den frühesten fälligen Zeitpunkt. */
  schedule(): void {
    void (async () => {
      if (this.timer) clearTimeout(this.timer);
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const now = Date.now();
      let next = Number.POSITIVE_INFINITY;
      for (const r of await db.allRelations()) {
        if (r.status === "pending" && r.decision?.resolveAt) next = Math.min(next, r.decision.resolveAt);
        if (r.status === "matched" && !r.chatEnded && r.jobFailures < MAX_JOB_FAILURES && this.canWork()) {
          const due = Math.min(r.replyDueAt ?? Infinity, r.openerDueAt ?? Infinity);
          if (Number.isFinite(due)) next = Math.min(next, Math.max(due, r.retryAfter ?? 0));
        }
        if (r.status === "awaiting" && !r.decision && r.jobFailures < MAX_JOB_FAILURES && this.canWork()) {
          next = Math.min(next, r.retryAfter ?? now);
        }
      }
      // Gestaffelte Nachrichten sichtbar werden lassen.
      const reveal = await this.nextReveal(now);
      next = Math.min(next, reveal);
      if (!Number.isFinite(next)) return;
      const wait = Math.max(250, Math.min(next - now, 2_147_000_000));
      this.timer = setTimeout(() => {
        this.emit();
        void this.tick();
      }, wait);
    })();
  }

  private async nextReveal(now: number): Promise<number> {
    let next = Number.POSITIVE_INFINITY;
    for (const r of await db.allRelations()) {
      if (r.status !== "matched" && r.status !== "unmatched") continue;
      for (const m of await db.messagesFor(r.id)) if (m.at > now) next = Math.min(next, m.at);
    }
    return next;
  }

  revokeImages(): void {
    for (const url of this.imageUrls.values()) URL.revokeObjectURL(url);
    this.imageUrls.clear();
  }
}

export const engine = new Engine();
export { ApiError };
