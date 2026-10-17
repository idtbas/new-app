// Schlanke Laufzeit-Validierung ohne Abhängigkeiten.
// Strenger Modus für Eingaben von außen, toleranter Modus (kürzt zu lange Werte)
// für Modellantworten, deren Struktur stimmt, die aber etwas zu lang geraten sind.

import { CHARACTER_MAX_AGE, MAX_AGE, MIN_AGE } from "./config";
import {
  ATTRACTIVENESS,
  EMOJI_USES,
  GENDERS,
  INTENTS,
  LIFESTYLES,
  REPLY_LENGTHS,
  RESPONSIVENESS,
  TEMPERAMENTS,
  type Character,
  type CharacterSpec,
  type ChatAction,
  type ChatTurnResult,
  type Credentials,
  type GeneratedProfile,
  type HistoryEntry,
  type Impression,
  type RewriteResult,
  type UserProfile,
} from "./types";

export class ValidationError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "ValidationError";
  }
}

interface Ctx {
  /** true: zu lange Strings/Listen werden gekürzt statt abgelehnt. */
  clip: boolean;
}

const STRICT: Ctx = { clip: false };
const LENIENT: Ctx = { clip: true };

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ValidationError(path, "Objekt erwartet");
  }
  return v as Obj;
}

// Steuerzeichen außer Zeilenumbruch und Tab entfernen.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function str(v: unknown, path: string, ctx: Ctx, max: number, min = 1): string {
  if (typeof v !== "string") throw new ValidationError(path, "Text erwartet");
  let s = v.replace(CONTROL_CHARS, "").trim();
  if (s.length > max) {
    if (!ctx.clip) throw new ValidationError(path, `höchstens ${max} Zeichen`);
    s = s.slice(0, max).trimEnd();
  }
  if (s.length < min) throw new ValidationError(path, `mindestens ${min} Zeichen`);
  return s;
}

function int(v: unknown, path: string, min: number, max: number): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new ValidationError(path, "Ganzzahl erwartet");
  }
  if (n < min || n > max) throw new ValidationError(path, `zwischen ${min} und ${max} erwartet`);
  return n;
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError(path, "Zahl erwartet");
  if (v < min || v > max) throw new ValidationError(path, `zwischen ${min} und ${max} erwartet`);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new ValidationError(path, "true/false erwartet");
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new ValidationError(path, `einer von ${allowed.join(", ")} erwartet`);
  }
  return v as T;
}

function arr<T>(
  v: unknown,
  path: string,
  ctx: Ctx,
  minItems: number,
  maxItems: number,
  item: (x: unknown, p: string) => T,
): T[] {
  if (!Array.isArray(v)) throw new ValidationError(path, "Liste erwartet");
  let list = v;
  if (list.length > maxItems) {
    if (!ctx.clip) throw new ValidationError(path, `höchstens ${maxItems} Einträge`);
    list = list.slice(0, maxItems);
  }
  const out = list.map((x, i) => item(x, `${path}[${i}]`));
  if (out.length < minItems) throw new ValidationError(path, `mindestens ${minItems} Einträge`);
  return out;
}

function strList(v: unknown, path: string, ctx: Ctx, minItems: number, maxItems: number, maxLen: number): string[] {
  return arr(v, path, ctx, minItems, maxItems, (x, p) => str(x, p, ctx, maxLen));
}

function uniqueGenders(v: unknown, path: string): UserProfile["lookingFor"] {
  const list = arr(v, path, STRICT, 1, 3, (x, p) => oneOf(x, p, GENDERS));
  return [...new Set(list)];
}

// ---------------------------------------------------------------------------
// Zugangsdaten

const ACCOUNT_ID = /^[a-f0-9]{32}$/;
// Cloudflare-API-Tokens: URL-sichere Zeichen, keine Leer- oder Steuerzeichen (Header-Injection).
const TOKEN = /^[A-Za-z0-9_\-.]{20,400}$/;

export function validateCredentials(v: unknown): Credentials {
  const o = obj(v, "credentials");
  const accountId = typeof o.accountId === "string" ? o.accountId.trim().toLowerCase() : "";
  if (!ACCOUNT_ID.test(accountId)) {
    throw new ValidationError("credentials.accountId", "32-stellige hexadezimale Account-ID erwartet");
  }
  const imageToken = typeof o.imageToken === "string" ? o.imageToken.trim() : "";
  if (!TOKEN.test(imageToken)) {
    throw new ValidationError("credentials.imageToken", "API-Token fehlt oder hat ein ungültiges Format");
  }
  const rawText = typeof o.textToken === "string" ? o.textToken.trim() : "";
  if (rawText !== "" && !TOKEN.test(rawText)) {
    throw new ValidationError("credentials.textToken", "API-Token hat ein ungültiges Format");
  }
  return rawText ? { accountId, imageToken, textToken: rawText } : { accountId, imageToken };
}

export function isPlausibleAccountId(s: string): boolean {
  return ACCOUNT_ID.test(s.trim().toLowerCase());
}

export function isPlausibleToken(s: string): boolean {
  return TOKEN.test(s.trim());
}

// ---------------------------------------------------------------------------
// Nutzerprofil

export function validateUserProfile(v: unknown): UserProfile {
  const o = obj(v, "user");
  const age = int(o.age, "user.age", MIN_AGE, MAX_AGE);
  const ageMin = int(o.ageMin, "user.ageMin", MIN_AGE, MAX_AGE);
  const ageMax = int(o.ageMax, "user.ageMax", MIN_AGE, MAX_AGE);
  if (ageMax < ageMin) throw new ValidationError("user.ageMax", "muss mindestens so groß wie das Mindestalter sein");
  return {
    name: str(o.name, "user.name", STRICT, 40),
    age,
    gender: oneOf(o.gender, "user.gender", GENDERS),
    lookingFor: uniqueGenders(o.lookingFor, "user.lookingFor"),
    ageMin,
    ageMax,
    interests: strList(o.interests, "user.interests", STRICT, 1, 12, 40),
    bio: str(o.bio, "user.bio", STRICT, 500),
    intent: oneOf(o.intent, "user.intent", INTENTS),
  };
}

// ---------------------------------------------------------------------------
// Charakter

const ID = /^[a-z0-9-]{8,64}$/;

export function validateSpec(v: unknown): CharacterSpec {
  const o = obj(v, "spec");
  const id = str(o.id, "spec.id", STRICT, 64);
  if (!ID.test(id)) throw new ValidationError("spec.id", "ungültige ID");
  const looks = obj(o.looks, "spec.looks");
  const style = obj(o.style, "spec.style");
  const range = arr(o.ageRange, "spec.ageRange", STRICT, 2, 2, (x, p) => int(x, p, MIN_AGE, MAX_AGE));
  if (range[1]! < range[0]!) throw new ValidationError("spec.ageRange", "ungültige Altersspanne");
  return {
    id,
    seed: int(o.seed, "spec.seed", 0, 0xffffffff),
    name: str(o.name, "spec.name", STRICT, 40),
    // Harte Untergrenze: Kein Charakter unter 18, auch nicht bei manipulierten Daten.
    age: int(o.age, "spec.age", MIN_AGE, CHARACTER_MAX_AGE),
    gender: oneOf(o.gender, "spec.gender", GENDERS),
    lookingFor: uniqueGenders(o.lookingFor, "spec.lookingFor"),
    ageRange: [range[0]!, range[1]!],
    city: str(o.city, "spec.city", STRICT, 60),
    intent: oneOf(o.intent, "spec.intent", INTENTS),
    archetype: str(o.archetype, "spec.archetype", STRICT, 40),
    occupationHint: str(o.occupationHint, "spec.occupationHint", STRICT, 120),
    lifestyle: [...new Set(arr(o.lifestyle, "spec.lifestyle", STRICT, 0, 3, (x, p) => oneOf(x, p, LIFESTYLES)))],
    temperament: oneOf(o.temperament, "spec.temperament", TEMPERAMENTS),
    traitHints: strList(o.traitHints, "spec.traitHints", STRICT, 1, 6, 40),
    looks: {
      heritage: str(looks.heritage, "spec.looks.heritage", STRICT, 80),
      skin: str(looks.skin, "spec.looks.skin", STRICT, 80),
      bodyType: str(looks.bodyType, "spec.looks.bodyType", STRICT, 80),
      attractiveness: oneOf(looks.attractiveness, "spec.looks.attractiveness", ATTRACTIVENESS),
      hairHint: str(looks.hairHint, "spec.looks.hairHint", STRICT, 120),
      glasses: bool(looks.glasses, "spec.looks.glasses"),
      setting: str(looks.setting, "spec.looks.setting", STRICT, 200),
      photoStyle: str(looks.photoStyle, "spec.looks.photoStyle", STRICT, 200),
    },
    style: {
      replyLength: oneOf(style.replyLength, "spec.style.replyLength", REPLY_LENGTHS),
      emoji: oneOf(style.emoji, "spec.style.emoji", EMOJI_USES),
      responsiveness: oneOf(style.responsiveness, "spec.style.responsiveness", RESPONSIVENESS),
      initiative: num(style.initiative, "spec.style.initiative", 0, 1),
      pickiness: num(style.pickiness, "spec.style.pickiness", 0, 1),
      warmth: num(style.warmth, "spec.style.warmth", 0, 1),
      writing: str(style.writing, "spec.style.writing", STRICT, 160),
    },
  };
}

function profileWith(v: unknown, ctx: Ctx, root: string): GeneratedProfile {
  const o = obj(v, root);
  const photo = obj(o.photo, `${root}.photo`);
  return {
    occupation: str(o.occupation, `${root}.occupation`, ctx, 100),
    bio: str(o.bio, `${root}.bio`, ctx, 500, 20),
    interests: strList(o.interests, `${root}.interests`, ctx, 3, 8, 40),
    traits: strList(o.traits, `${root}.traits`, ctx, 2, 6, 40),
    humor: str(o.humor, `${root}.humor`, ctx, 200),
    communicationStyle: str(o.communicationStyle, `${root}.communicationStyle`, ctx, 300),
    values: strList(o.values, `${root}.values`, ctx, 1, 6, 60),
    partnerPreferences: str(o.partnerPreferences, `${root}.partnerPreferences`, ctx, 400),
    dealbreakers: strList(o.dealbreakers, `${root}.dealbreakers`, ctx, 1, 6, 120),
    boundaries: strList(o.boundaries, `${root}.boundaries`, ctx, 1, 6, 160),
    speechQuirks: strList(o.speechQuirks, `${root}.speechQuirks`, ctx, 1, 6, 120),
    backstory: str(o.backstory, `${root}.backstory`, ctx, 700),
    photo: {
      outfit: str(photo.outfit, `${root}.photo.outfit`, ctx, 160),
      hair: str(photo.hair, `${root}.photo.hair`, ctx, 120),
      details: str(photo.details, `${root}.photo.details`, ctx, 200),
    },
  };
}

/** Für Modellantworten: Struktur muss stimmen, zu lange Texte werden gekürzt. */
export function parseGeneratedProfile(v: unknown): GeneratedProfile {
  return profileWith(v, LENIENT, "profil");
}

/** Für gespeicherte Charaktere, die der Client wieder an den Worker schickt. */
export function validateCharacter(v: unknown): Character {
  const o = obj(v, "character");
  const spec = validateSpec(o.spec);
  const id = str(o.id, "character.id", STRICT, 64);
  if (id !== spec.id) throw new ValidationError("character.id", "passt nicht zur Spezifikation");
  const out: Character = {
    id,
    createdAt: int(o.createdAt, "character.createdAt", 0, Number.MAX_SAFE_INTEGER),
    spec,
    profile: profileWith(o.profile, STRICT, "character.profile"),
  };
  if (o.version !== undefined) out.version = int(o.version, "character.version", 0, 100_000);
  if (o.editedAt !== undefined) out.editedAt = int(o.editedAt, "character.editedAt", 0, Number.MAX_SAFE_INTEGER);
  return out;
}

// ---------------------------------------------------------------------------
// Umschreiben der Realität einer Figur

const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 600;

/** Neue Beschreibung der Person. Bei wörtlicher Übernahme gelten die Grenzen der Bio. */
export function validateDescription(v: unknown, literal: boolean): string {
  return literal ? str(v, "description", STRICT, 500, 20) : str(v, "description", STRICT, DESCRIPTION_MAX, DESCRIPTION_MIN);
}

function objOrEmpty(v: unknown): Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {};
}

/** Liefert den neuen Wert, wenn er gültig ist, sonst den alten („alles andere bleibt“). */
function orKeep<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Wendet die vom Modell umgeschriebene Figur an. Unveränderliche Felder (ID, Seed,
 * Erstellungszeit) bleiben, Alter wird hart auf 18–40 begrenzt, ungültige Einzelwerte
 * fallen auf den alten Stand zurück. Das Profil muss vollständig gültig sein.
 */
export function parseRewrite(v: unknown, old: Character, now: number): RewriteResult {
  const o = obj(v, "umschrift");
  const s = objOrEmpty(o.spec);
  const looks = objOrEmpty(s.looks);
  const style = objOrEmpty(s.style);
  const os = old.spec;
  const text = (x: unknown, path: string, max: number, fallback: string) => orKeep(() => str(x, path, LENIENT, max), fallback);

  const rawAge = typeof s.age === "number" || typeof s.age === "string" ? Number(s.age) : NaN;
  // Harte Grenze: Auch wenn die Beschreibung etwas anderes verlangt, bleibt die Figur erwachsen.
  const age = Number.isFinite(rawAge) ? Math.max(MIN_AGE, Math.min(CHARACTER_MAX_AGE, Math.round(rawAge))) : os.age;
  const shift = age - os.age;
  const lo = Math.max(MIN_AGE, os.ageRange[0] + shift);
  const hi = Math.max(lo, os.ageRange[1] + shift);

  const spec = validateSpec({
    ...os,
    name: text(s.name, "spec.name", 40, os.name),
    age,
    ageRange: [lo, hi],
    gender: orKeep(() => oneOf(s.gender, "spec.gender", GENDERS), os.gender),
    lookingFor: orKeep(() => uniqueGenders(s.lookingFor, "spec.lookingFor"), os.lookingFor),
    city: text(s.city, "spec.city", 60, os.city),
    intent: orKeep(() => oneOf(s.intent, "spec.intent", INTENTS), os.intent),
    occupationHint: text(s.occupationHint, "spec.occupationHint", 120, os.occupationHint),
    lifestyle: orKeep(() => [...new Set(arr(s.lifestyle, "spec.lifestyle", STRICT, 0, 3, (x, p) => oneOf(x, p, LIFESTYLES)))], os.lifestyle),
    temperament: orKeep(() => oneOf(s.temperament, "spec.temperament", TEMPERAMENTS), os.temperament),
    looks: {
      ...os.looks,
      heritage: text(looks.heritage, "spec.looks.heritage", 80, os.looks.heritage),
      skin: text(looks.skin, "spec.looks.skin", 80, os.looks.skin),
      bodyType: text(looks.bodyType, "spec.looks.bodyType", 80, os.looks.bodyType),
      attractiveness: orKeep(() => oneOf(looks.attractiveness, "spec.looks.attractiveness", ATTRACTIVENESS), os.looks.attractiveness),
      hairHint: text(looks.hairHint, "spec.looks.hairHint", 120, os.looks.hairHint),
      glasses: typeof looks.glasses === "boolean" ? looks.glasses : os.looks.glasses,
      setting: text(looks.setting, "spec.looks.setting", 200, os.looks.setting),
      photoStyle: text(looks.photoStyle, "spec.looks.photoStyle", 200, os.looks.photoStyle),
    },
    style: {
      ...os.style,
      replyLength: orKeep(() => oneOf(style.replyLength, "spec.style.replyLength", REPLY_LENGTHS), os.style.replyLength),
      emoji: orKeep(() => oneOf(style.emoji, "spec.style.emoji", EMOJI_USES), os.style.emoji),
      responsiveness: orKeep(() => oneOf(style.responsiveness, "spec.style.responsiveness", RESPONSIVENESS), os.style.responsiveness),
      writing: text(style.writing, "spec.style.writing", 160, os.style.writing),
    },
  });

  const profile = profileWith(o.profile, LENIENT, "profil");
  // Neue Frisur-Vorgabe, aber vergessene Foto-Stichworte: sonst bliebe die alte Frisur im Bild.
  if (spec.looks.hairHint !== os.looks.hairHint && profile.photo.hair === old.profile.photo.hair) {
    profile.photo.hair = spec.looks.hairHint;
  }

  return {
    character: {
      id: old.id,
      createdAt: old.createdAt,
      spec,
      profile,
      version: (old.version ?? 0) + 1,
      editedAt: now,
    },
    changes: text(o.changes, "changes", 240, ""),
  };
}

// ---------------------------------------------------------------------------
// Chat

export function validateHistory(v: unknown, maxItems: number): HistoryEntry[] {
  return arr(v, "history", STRICT, 0, maxItems, (x, p) => {
    const o = obj(x, p);
    return {
      from: oneOf(o.from, `${p}.from`, ["user", "char"] as const),
      text: str(o.text, `${p}.text`, STRICT, 1000),
    };
  });
}

export function validateMemory(v: unknown, maxItems: number): string[] {
  return strList(v, "memory", STRICT, 0, maxItems, 200);
}

const ACTIONS: readonly ChatAction[] = ["none", "end_conversation", "unmatch"];

export function parseChatTurn(v: unknown, mode: "reply" | "opener"): ChatTurnResult {
  const o = obj(v, "antwort");
  const messages = arr(o.messages, "antwort.messages", LENIENT, 0, 4, (x, p) => str(x, p, LENIENT, 600));
  if (mode === "opener" && messages.length === 0) {
    throw new ValidationError("antwort.messages", "Eröffnung ohne Nachricht");
  }
  const rawChange = typeof o.interest_change === "number" ? Math.round(o.interest_change) : 0;
  const action = typeof o.action === "string" && (ACTIONS as readonly string[]).includes(o.action) ? (o.action as ChatAction) : "none";
  const memory = o.memory === undefined ? [] : strList(o.memory, "antwort.memory", LENIENT, 0, 4, 200);
  return {
    messages,
    interestChange: Math.max(-3, Math.min(2, rawChange)),
    action,
    memory,
  };
}

export function parseImpression(v: unknown): Impression {
  const o = obj(v, "eindruck");
  const n = typeof o.impression === "string" ? Number(o.impression) : o.impression;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ValidationError("eindruck.impression", "Zahl erwartet");
  return { impression: Math.max(-2, Math.min(2, Math.round(n))) };
}
