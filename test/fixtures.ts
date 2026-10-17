import { castCharacter } from "../src/shared/casting";
import type { Character, GeneratedProfile, UserProfile } from "../src/shared/types";

export const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
export const IMAGE_TOKEN = "IMG_tokenAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const TEXT_TOKEN = "TXT_tokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

export const user: UserProfile = {
  name: "Robin",
  age: 26,
  gender: "mann",
  lookingFor: ["frau"],
  ageMin: 21,
  ageMax: 32,
  interests: ["Bouldern", "Kochen", "Indie-Konzerte", "Wandern"],
  bio: "Arbeite als Bauingenieur, koche gern für Freunde und bin am Wochenende oft in der Kletterhalle oder im Harz unterwegs.",
  intent: "beziehung",
};

export const profile: GeneratedProfile = {
  occupation: "Physiotherapeutin in einer kleinen Praxis",
  bio: "Ich renke tagsüber Rücken ein und abends meine Laune mit Pasta. Suche wen, der auch mal schweigen kann.",
  interests: ["Bouldern", "Pasta kochen", "Hörbücher", "Wandern im Mittelgebirge"],
  traits: ["trocken", "loyal", "ungeduldig"],
  humor: "Trocken und leicht sarkastisch.",
  communicationStyle: "Kurze Nachrichten, antwortet ehrlich, mag keine Floskeln.",
  values: ["Ehrlichkeit", "Verlässlichkeit"],
  partnerPreferences: "Menschen, die zuhören und nicht nur von sich reden.",
  dealbreakers: ["Unpünktlichkeit ohne Bescheid"],
  boundaries: ["Keine Fotos-Anfragen", "Erst schreiben, dann telefonieren"],
  speechQuirks: ["sagt oft 'joa'"],
  backstory: "Aufgewachsen auf dem Land, seit drei Jahren in der Stadt. Ihre Schwester ist ihre engste Vertraute.",
  photo: { outfit: "grey hoodie and jeans", hair: "shoulder-length wavy brown hair", details: "slight smile, holding a coffee cup" },
};

export function makeCharacter(seed = 12345, overrides: Partial<UserProfile> = {}): Character {
  const spec = castCharacter(seed, { ...user, ...overrides });
  return { id: spec.id, createdAt: 1_700_000_000_000, spec, profile };
}

export const credentials = { accountId: ACCOUNT_ID, imageToken: IMAGE_TOKEN };
