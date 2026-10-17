// Reine Funktionen rund um Chats – ohne DOM und ohne Datenbank, damit sie testbar sind.

import { LIMITS } from "../shared/config";
import type { Decision } from "../shared/matching";
import { Rng, hashString } from "../shared/rng";
import type { Character, ChatTurnResult, HistoryEntry } from "../shared/types";
import type { Relation, StoredMessage } from "./model";

/** Baut den Modellkontext ausschließlich aus den Nachrichten genau dieses Chats. */
export function buildHistory(charId: string, messages: readonly StoredMessage[], now: number): HistoryEntry[] {
  return messages
    .filter((m) => m.charId === charId && m.from !== "system" && m.at <= now)
    .slice(-LIMITS.chatHistory)
    .map((m) => ({ from: m.from === "user" ? "user" : "char", text: m.text.slice(0, 1000) }));
}

const DELAY_RANGE: Record<Character["spec"]["style"]["responsiveness"], [number, number]> = {
  // Für den Prototyp zeitlich gestaucht.
  schnell: [4, 14],
  mittel: [12, 45],
  langsam: [40, 150],
};

/** Simulierte Antwortverzögerung in ms. Geringes Interesse -> langsamer. */
export function replyDelay(c: Character, interest: number, random: () => number = Math.random): number {
  const [lo, hi] = DELAY_RANGE[c.spec.style.responsiveness];
  const base = lo + random() * (hi - lo);
  const factor = 1 + Math.max(0, 5 - interest) * 0.15;
  return Math.round(base * factor * 1000);
}

/** Verzögerung bis zur ersten Nachricht nach einem Match – deterministisch je Charakter. */
export function openerDelay(c: Character): number {
  const rng = new Rng(hashString(`opener:${c.id}`));
  return (15 + Math.floor(rng.next() * 75)) * 1000;
}

/** Zeitpunkte, zu denen mehrere Nachrichten einer Antwort nacheinander erscheinen. */
export function staggerTimes(texts: readonly string[], start: number): number[] {
  const out: number[] = [];
  let t = start;
  texts.forEach((text, i) => {
    if (i > 0) t += Math.min(6000, 1200 + text.length * 45);
    out.push(t);
  });
  return out;
}

export interface TurnOutcome {
  relation: Relation;
  messages: StoredMessage[];
}

/** Wendet eine Modellantwort auf Beziehung und Verlauf an. */
export function applyTurn(rel: Relation, c: Character, turn: ChatTurnResult, now: number): TurnOutcome {
  const times = staggerTimes(turn.messages, now);
  const messages: StoredMessage[] = turn.messages.map((text, i) => ({ charId: c.id, from: "char", text, at: times[i]! }));
  const lastAt = times.length > 0 ? times[times.length - 1]! : now;

  const interest = Math.max(0, Math.min(10, rel.interest + turn.interestChange));
  const memory = [...rel.memory];
  for (const note of turn.memory) {
    if (!memory.some((m) => m.toLowerCase() === note.toLowerCase())) memory.push(note);
  }

  const next: Relation = {
    ...rel,
    interest,
    memory: memory.slice(-LIMITS.memoryNotes),
    replyDueAt: undefined,
    openerDueAt: undefined,
    jobFailures: 0,
    retryAfter: undefined,
  };

  if (turn.action === "unmatch" || interest <= 0) {
    next.status = "unmatched";
    next.chatEnded = true;
    next.endedBy = "char";
    messages.push({ charId: c.id, from: "system", text: `${c.spec.name} hat das Match aufgelöst.`, at: lastAt + 1500 });
  } else if (turn.action === "end_conversation") {
    next.chatEnded = true;
    next.endedBy = "char";
    messages.push({ charId: c.id, from: "system", text: `${c.spec.name} möchte das Gespräch nicht fortsetzen.`, at: lastAt + 1500 });
  }
  return { relation: next, messages };
}

/** Überträgt eine (einmalig berechnete) Entscheidung auf die Beziehung. */
export function applyDecision(rel: Relation, c: Character, decision: Decision, now: number): Relation {
  const next: Relation = { ...rel, decision, jobFailures: 0, retryAfter: undefined };
  const visible = decision.outcome === "pending" && (decision.resolveAt ?? 0) <= now ? decision.finalOutcome : decision.outcome;
  if (visible === "like") {
    next.status = "matched";
    next.matchedAt = now;
    next.interest = decision.initialInterest;
    next.lastReadAt = now;
    if (decision.opensChat) next.openerDueAt = now + openerDelay(c);
  } else if (visible === "pass") {
    next.status = "rejected";
  } else {
    next.status = "pending";
  }
  return next;
}

/** Ungelesene, bereits sichtbare Nachrichten der Figur. */
export function unreadCount(rel: Relation, messages: readonly StoredMessage[], now: number): number {
  return messages.filter((m) => m.from !== "user" && m.at > rel.lastReadAt && m.at <= now).length;
}
