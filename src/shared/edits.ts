// Anwenden der im Editor festgelegten Änderungen auf eine Figur. Rein und deterministisch,
// damit Client (sofortige Änderung ohne KI) und Worker (verbindliche Vorgaben nach der KI)
// dasselbe Ergebnis erzeugen.

import { CHARACTER_MAX_AGE, MIN_AGE } from "./config";
import type { Character, CharacterEdits } from "./types";

export function applyEdits(c: Character, e: CharacterEdits): Character {
  const spec = { ...c.spec, looks: { ...c.spec.looks }, style: { ...c.spec.style } };
  const profile = { ...c.profile, photo: { ...c.profile.photo } };

  if (e.name !== undefined) spec.name = e.name;
  if (e.age !== undefined) {
    const age = Math.max(MIN_AGE, Math.min(CHARACTER_MAX_AGE, Math.round(e.age)));
    // Wunschspanne der Figur wandert mit dem Alter mit.
    const shift = age - spec.age;
    const lo = Math.max(MIN_AGE, spec.ageRange[0] + shift);
    spec.ageRange = [lo, Math.max(lo, spec.ageRange[1] + shift)];
    spec.age = age;
  }
  if (e.gender !== undefined) spec.gender = e.gender;
  if (e.lookingFor !== undefined) spec.lookingFor = [...e.lookingFor];
  if (e.city !== undefined) spec.city = e.city;
  if (e.intent !== undefined) spec.intent = e.intent;
  if (e.occupation !== undefined) {
    profile.occupation = e.occupation;
    spec.occupationHint = e.occupation;
  }
  if (e.bio !== undefined) profile.bio = e.bio;
  if (e.interests !== undefined) profile.interests = [...e.interests];
  if (e.traits !== undefined) profile.traits = [...e.traits];
  if (e.values !== undefined) profile.values = [...e.values];
  if (e.humor !== undefined) profile.humor = e.humor;
  if (e.temperament !== undefined) spec.temperament = e.temperament;
  if (e.lifestyle !== undefined) spec.lifestyle = [...e.lifestyle];

  const l = e.looks ?? {};
  if (l.hairHint !== undefined) {
    spec.looks.hairHint = l.hairHint;
    profile.photo.hair = l.hairHint;
  }
  if (l.bodyType !== undefined) spec.looks.bodyType = l.bodyType;
  if (l.attractiveness !== undefined) spec.looks.attractiveness = l.attractiveness;
  if (l.glasses !== undefined) spec.looks.glasses = l.glasses;
  if (l.skin !== undefined) spec.looks.skin = l.skin;
  if (l.outfit !== undefined) profile.photo.outfit = l.outfit;
  if (l.setting !== undefined) spec.looks.setting = l.setting;
  if (l.photoStyle !== undefined) spec.looks.photoStyle = l.photoStyle;

  const st = e.style ?? {};
  if (st.replyLength !== undefined) spec.style.replyLength = st.replyLength;
  if (st.emoji !== undefined) spec.style.emoji = st.emoji;
  if (st.responsiveness !== undefined) spec.style.responsiveness = st.responsiveness;
  if (st.writing !== undefined) spec.style.writing = st.writing;
  if (st.warmth !== undefined) spec.style.warmth = st.warmth;
  if (st.pickiness !== undefined) spec.style.pickiness = st.pickiness;
  if (st.initiative !== undefined) spec.style.initiative = st.initiative;

  return { ...c, spec, profile };
}

const LABELS: Record<string, string> = {
  name: "Name",
  age: "Alter",
  gender: "Geschlecht",
  lookingFor: "Interessiert an",
  city: "Wohnort",
  intent: "Dating-Absicht",
  occupation: "Beruf",
  bio: "Beschreibung",
  interests: "Interessen",
  traits: "Charakterzüge",
  values: "Werte",
  humor: "Humor",
  temperament: "Temperament",
  lifestyle: "Lebensstil",
  "looks.hairHint": "Frisur",
  "looks.bodyType": "Körperbau",
  "looks.attractiveness": "Ausstrahlung",
  "looks.glasses": "Brille",
  "looks.skin": "Hautton",
  "looks.outfit": "Outfit",
  "looks.setting": "Foto-Szene",
  "looks.photoStyle": "Fotostil",
  "style.replyLength": "Antwortlänge",
  "style.emoji": "Emojis",
  "style.responsiveness": "Antworttempo",
  "style.writing": "Schreibstil",
  "style.warmth": "Wärme",
  "style.pickiness": "Wählerischkeit",
  "style.initiative": "Initiative",
};

/** Deutsche Bezeichnungen der gesetzten Felder, z. B. ["Name", "Frisur"]. */
export function editLabels(e: CharacterEdits): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(e)) {
    if (value === undefined) continue;
    if ((key === "looks" || key === "style") && typeof value === "object" && value !== null) {
      for (const [sub, v] of Object.entries(value)) if (v !== undefined) out.push(LABELS[`${key}.${sub}`] ?? sub);
    } else {
      out.push(LABELS[key] ?? key);
    }
  }
  return out;
}

export function countEdits(e: CharacterEdits): number {
  return editLabels(e).length;
}

/** Ändert sich etwas, das auf dem Foto sichtbar ist? */
export function affectsPhoto(e: CharacterEdits): boolean {
  return (e.looks !== undefined && Object.keys(e.looks).length > 0) || e.age !== undefined || e.gender !== undefined;
}
