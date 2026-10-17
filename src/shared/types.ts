export type Gender = "frau" | "mann" | "nichtbinaer";
export type Intent = "beziehung" | "locker" | "offen";
export type Lifestyle = "influencer" | "onlyfans" | "status";
export type Temperament = "introvertiert" | "ambivertiert" | "extrovertiert";
export type Attractiveness = "unauffällig" | "durchschnittlich" | "attraktiv" | "sehr attraktiv";
export type ReplyLength = "kurz" | "mittel" | "lang";
export type EmojiUse = "nie" | "selten" | "oft";
export type Responsiveness = "schnell" | "mittel" | "langsam";

export const GENDERS: readonly Gender[] = ["frau", "mann", "nichtbinaer"];
export const INTENTS: readonly Intent[] = ["beziehung", "locker", "offen"];
export const LIFESTYLES: readonly Lifestyle[] = ["influencer", "onlyfans", "status"];
export const TEMPERAMENTS: readonly Temperament[] = ["introvertiert", "ambivertiert", "extrovertiert"];
export const ATTRACTIVENESS: readonly Attractiveness[] = ["unauffällig", "durchschnittlich", "attraktiv", "sehr attraktiv"];
export const REPLY_LENGTHS: readonly ReplyLength[] = ["kurz", "mittel", "lang"];
export const EMOJI_USES: readonly EmojiUse[] = ["nie", "selten", "oft"];
export const RESPONSIVENESS: readonly Responsiveness[] = ["schnell", "mittel", "langsam"];

export const GENDER_LABEL: Record<Gender, string> = {
  frau: "Frau",
  mann: "Mann",
  nichtbinaer: "Nicht-binär",
};

export const INTENT_LABEL: Record<Intent, string> = {
  beziehung: "Feste Beziehung",
  locker: "Lockeres Kennenlernen",
  offen: "Noch unentschlossen",
};

export interface UserProfile {
  name: string;
  age: number;
  gender: Gender;
  lookingFor: Gender[];
  ageMin: number;
  ageMax: number;
  interests: string[];
  bio: string;
  intent: Intent;
}

/** Vom Client deterministisch aus einem Seed „gecastete“ Eckdaten eines Charakters. */
export interface CharacterSpec {
  id: string;
  seed: number;
  name: string;
  age: number;
  gender: Gender;
  lookingFor: Gender[];
  ageRange: [number, number];
  city: string;
  intent: Intent;
  /** Grundlegende Lebenssituation, z. B. "studium", "ausbildung". */
  archetype: string;
  occupationHint: string;
  /** Seltene, überlagernde Lebensstil-Merkmale. Ersetzen nicht die Persönlichkeit. */
  lifestyle: Lifestyle[];
  temperament: Temperament;
  traitHints: string[];
  looks: {
    heritage: string;
    skin: string;
    bodyType: string;
    attractiveness: Attractiveness;
    hairHint: string;
    glasses: boolean;
    setting: string;
    photoStyle: string;
  };
  style: {
    replyLength: ReplyLength;
    emoji: EmojiUse;
    responsiveness: Responsiveness;
    /** 0..1: Wie wahrscheinlich die Figur selbst den Chat beginnt. */
    initiative: number;
    /** 0..1: Wie wählerisch die Figur ist. */
    pickiness: number;
    /** 0..1: Grundwärme im Umgang. */
    warmth: number;
    /** Schreibgewohnheit, z. B. "schreibt alles klein". */
    writing: string;
  };
}

/** Vom Textmodell ausformulierte Teile des Charakters. */
export interface GeneratedProfile {
  occupation: string;
  bio: string;
  interests: string[];
  traits: string[];
  humor: string;
  communicationStyle: string;
  values: string[];
  partnerPreferences: string;
  dealbreakers: string[];
  boundaries: string[];
  speechQuirks: string[];
  backstory: string;
  /** Englische Stichworte für das Bildmodell. */
  photo: { outfit: string; hair: string; details: string };
}

export interface Character {
  id: string;
  createdAt: number;
  spec: CharacterSpec;
  profile: GeneratedProfile;
}

export type ChatAction = "none" | "end_conversation" | "unmatch";

export interface ChatTurnResult {
  messages: string[];
  interestChange: number;
  action: ChatAction;
  memory: string[];
}

export interface Impression {
  /** -2 (gar nicht angesprochen) bis +2 (sehr angesprochen). Wird nie angezeigt. */
  impression: number;
}

export interface Credentials {
  accountId: string;
  imageToken: string;
  /** Optional; leer bedeutet: Bild-Token auch für Text verwenden. */
  textToken?: string;
}

export interface HistoryEntry {
  from: "user" | "char";
  text: string;
}

export type ChatMode = "reply" | "opener";

export interface CharacterRequest {
  credentials: Credentials;
  spec: CharacterSpec;
}
export interface ImageRequest {
  credentials: Credentials;
  character: Character;
}
export interface EvaluateRequest {
  credentials: Credentials;
  character: Character;
  user: UserProfile;
}
export interface ChatRequest {
  credentials: Credentials;
  character: Character;
  user: UserProfile;
  mode: ChatMode;
  interest: number;
  memory: string[];
  history: HistoryEntry[];
}

export interface ImageResult {
  mime: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}
