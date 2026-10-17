// Entscheidung eines Charakters über ein Like. Rein deterministisch: Gleiche Eingaben
// (Charakter, Nutzerprofil, KI-Eindruck) führen immer zum gleichen Ergebnis. Die
// Entscheidung wird einmalig gespeichert und nie neu berechnet.
//
// Die Bestandteile (Score, Schwelle, …) sind intern und werden nie in der Oberfläche angezeigt.

import { Rng, hashString } from "./rng";
import type { Character, Intent, UserProfile } from "./types";

export type Outcome = "like" | "pass";

export interface Decision {
  /** Sofort sichtbares Ergebnis. "pending" = Figur ist noch unentschlossen. */
  outcome: Outcome | "pending";
  /** Bei "pending": Ergebnis, das zum Zeitpunkt resolveAt wirksam wird (vorab festgelegt). */
  finalOutcome: Outcome;
  resolveAt?: number;
  decidedAt: number;
  /** Anfangsinteresse 0..10 für den Chat, falls es ein Match wird. */
  initialInterest: number;
  /** Ob die Figur nach einem Match selbst zuerst schreibt. */
  opensChat: boolean;
  /** Interne Nachvollziehbarkeit, nur für Tests/Debugging. */
  internal: {
    score: number;
    threshold: number;
    probability: number;
    components: Record<string, number>;
  };
}

const INTENT_FIT: Record<Intent, Record<Intent, number>> = {
  beziehung: { beziehung: 1, offen: 0.2, locker: -1.1 },
  locker: { locker: 0.9, offen: 0.3, beziehung: -1.1 },
  offen: { offen: 0.5, beziehung: 0.2, locker: 0.3 },
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9äöüß ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Zählt Interessen, die sich grob überschneiden ("Wandern" ~ "wandern im Harz"). */
export function sharedInterests(a: readonly string[], b: readonly string[]): number {
  const na = a.map(normalize).filter((s) => s.length >= 3);
  const nb = b.map(normalize).filter((s) => s.length >= 3);
  let count = 0;
  for (const x of na) {
    if (nb.some((y) => x === y || x.includes(y) || y.includes(x) || stemOverlap(x, y))) count++;
  }
  return count;
}

function stemOverlap(x: string, y: string): boolean {
  const wx = x.split(" ").filter((w) => w.length >= 5).map((w) => w.slice(0, 5));
  const wy = new Set(y.split(" ").filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));
  return wx.some((w) => wy.has(w));
}

/** Fingerabdruck der für die Entscheidung relevanten Profildaten (für den Zufalls-Seed). */
export function userFingerprint(user: UserProfile): number {
  return hashString(JSON.stringify([user.name, user.age, user.gender, user.intent, user.interests, user.bio]));
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export interface DecideInput {
  character: Character;
  user: UserProfile;
  /** KI-Eindruck der Figur vom Nutzerprofil, -2..+2. */
  impression: number;
  now: number;
}

export function decide({ character, user, impression, now }: DecideInput): Decision {
  const { spec, profile } = character;
  const rng = new Rng(hashString(`decide:${character.id}:${userFingerprint(user)}`));
  const components: Record<string, number> = {};

  // Grundvoraussetzung: Die Figur sucht dieses Geschlecht überhaupt.
  const genderOk = spec.lookingFor.includes(user.gender);
  components.gender = genderOk ? 0 : -6;

  // Alter: innerhalb der Wunschspanne gut, knapp daneben je nach Wählerischkeit tolerierbar.
  const [lo, hi] = spec.ageRange;
  const off = user.age < lo ? lo - user.age : user.age > hi ? user.age - hi : 0;
  components.age = off === 0 ? 0.6 : off <= 2 ? -0.4 - spec.style.pickiness * 0.6 : -1.6 - off * 0.15;

  components.intent = INTENT_FIT[spec.intent][user.intent];

  const shared = sharedInterests(user.interests, profile.interests);
  components.interests = Math.min(1.0, shared * 0.35);

  // Wer sich bei der Selbstbeschreibung kaum Mühe gibt, wirkt weniger interessant.
  const bioLen = user.bio.trim().length;
  components.bio = bioLen < 25 ? -0.5 : bioLen > 90 ? 0.2 : 0;

  // Subjektiver Eindruck der Figur (vom Textmodell, aus ihrer Perspektive).
  components.impression = Math.max(-2, Math.min(2, impression)) * 0.9;

  // Begrenzte Zufallsvariation (Tagesform), aber deterministisch geseedet.
  components.noise = (rng.next() - 0.5) * 0.8;

  const score = Object.values(components).reduce((s, v) => s + v, 0);
  const threshold = 0.6 + spec.style.pickiness * 1.2;
  const probability = genderOk ? sigmoid((score - threshold) * 1.8) : 0;

  const draw = rng.next();
  const finalDraw = rng.next();
  const initialInterest = Math.max(3, Math.min(7, Math.round(4.5 + (score - threshold) * 1.4)));
  const opensChat = rng.next() < spec.style.initiative;
  const delayMs = (60 + Math.floor(rng.next() * 240)) * 1000;

  let outcome: Decision["outcome"];
  let finalOutcome: Outcome;
  if (draw < probability - 0.1) {
    outcome = finalOutcome = "like";
  } else if (draw > probability + 0.1 || probability < 0.05) {
    outcome = finalOutcome = "pass";
  } else {
    // Grenzfall: Figur ist unentschlossen. Das spätere Ergebnis steht schon fest,
    // damit ein Neuladen nichts neu auswürfelt.
    outcome = "pending";
    finalOutcome = finalDraw < probability ? "like" : "pass";
  }

  return {
    outcome,
    finalOutcome,
    resolveAt: outcome === "pending" ? now + delayMs : undefined,
    decidedAt: now,
    initialInterest,
    opensChat,
    internal: { score, threshold, probability, components },
  };
}
