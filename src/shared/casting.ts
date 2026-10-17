// „Casting“: legt aus einem Seed deterministisch die Eckdaten eines neuen Charakters fest.
// Das Textmodell formuliert danach Biografie und Persönlichkeit aus. So bleibt die Vielfalt
// steuerbar, und seltene Varianten treten mit festen, kleinen Wahrscheinlichkeiten auf.
//
// Wichtig: Herkunft beeinflusst nur Vornamen und Aussehen, nie Verhalten oder Lebensstil.
// Seltene Lebensstile (Influencer, Creator, statusorientiert) werden unabhängig von
// Geschlecht und Herkunft gewürfelt.

import { CHARACTER_MAX_AGE, MIN_AGE } from "./config";
import { Rng, hashString } from "./rng";
import type {
  Attractiveness,
  CharacterSpec,
  EmojiUse,
  Gender,
  Intent,
  Lifestyle,
  ReplyLength,
  Responsiveness,
  Temperament,
  UserProfile,
} from "./types";

interface Heritage {
  key: string;
  weight: number;
  names: Record<Gender, readonly string[]>;
  skin: readonly string[];
}

const NEUTRAL_NAMES = ["Alex", "Kim", "Robin", "Charlie", "Sascha", "Luca", "Noa", "Mika", "Toni", "Kaya", "Eli", "Sam", "Ari", "Jona", "Nico", "Finley"];

const HERITAGES: readonly Heritage[] = [
  {
    key: "German",
    weight: 46,
    names: {
      frau: ["Lena", "Hannah", "Marie", "Jana", "Svenja", "Katharina", "Lisa", "Annika", "Paula", "Franziska", "Merle", "Johanna", "Carina", "Nele", "Theresa", "Vanessa", "Jacqueline", "Sophie", "Lea", "Kristin"],
      mann: ["Jonas", "Lukas", "Felix", "Tobias", "Niklas", "Moritz", "Jan", "Kevin", "Florian", "Sebastian", "Tim", "Marvin", "Philipp", "Hendrik", "Dennis", "Malte", "Leon", "Benedikt", "Julian", "Patrick"],
      nichtbinaer: NEUTRAL_NAMES,
    },
    skin: ["fair skin", "light skin with freckles", "light skin", "rosy fair skin", "light skin with a slight tan"],
  },
  {
    key: "Turkish",
    weight: 9,
    names: {
      frau: ["Elif", "Zeynep", "Melis", "Aylin", "Derya", "Selin", "Büşra", "Ece"],
      mann: ["Emre", "Can", "Deniz", "Burak", "Mert", "Yusuf", "Kerem", "Onur"],
      nichtbinaer: ["Deniz", "Ece", "Can", "Umut"],
    },
    skin: ["light olive skin", "olive skin", "warm beige skin"],
  },
  {
    key: "Polish or Eastern European",
    weight: 8,
    names: {
      frau: ["Natalia", "Kasia", "Olga", "Alina", "Daria", "Milena", "Karolina"],
      mann: ["Dominik", "Pawel", "Artur", "Kamil", "Viktor", "Daniel", "Mateusz"],
      nichtbinaer: ["Sasha", "Mika", "Alex"],
    },
    skin: ["fair skin", "pale skin", "light skin"],
  },
  {
    key: "Arab",
    weight: 6,
    names: {
      frau: ["Leila", "Amira", "Yasmin", "Rana", "Nour", "Salma"],
      mann: ["Karim", "Omar", "Samir", "Tarek", "Bilal", "Rami"],
      nichtbinaer: ["Noor", "Sami", "Rayan"],
    },
    skin: ["olive skin", "light brown skin", "warm tan skin"],
  },
  {
    key: "Italian or Greek",
    weight: 6,
    names: {
      frau: ["Giulia", "Chiara", "Eleni", "Francesca", "Sofia", "Daphne"],
      mann: ["Marco", "Luca", "Nikos", "Matteo", "Giorgos", "Fabio"],
      nichtbinaer: ["Andrea", "Luca", "Nikita"],
    },
    skin: ["olive skin", "light olive skin", "tanned skin"],
  },
  {
    key: "West African",
    weight: 5,
    names: {
      frau: ["Ama", "Adaeze", "Efua", "Chiamaka", "Abena", "Fatou"],
      mann: ["Kwame", "Kofi", "Emeka", "Ibrahim", "Tunde", "Yaw"],
      nichtbinaer: ["Ife", "Sena", "Dayo"],
    },
    skin: ["dark brown skin", "deep brown skin", "medium brown skin"],
  },
  {
    key: "Vietnamese",
    weight: 4,
    names: {
      frau: ["Linh", "Mai", "Thu", "Hoa", "Ngoc"],
      mann: ["Minh", "Duc", "Huy", "Tuan", "Bao"],
      nichtbinaer: ["An", "Khanh", "Linh"],
    },
    skin: ["light skin", "light tan skin", "warm light skin"],
  },
  {
    key: "South Asian",
    weight: 4,
    names: {
      frau: ["Priya", "Ananya", "Divya", "Meera", "Sana"],
      mann: ["Arjun", "Rohan", "Vikram", "Imran", "Karan"],
      nichtbinaer: ["Kiran", "Ashwin", "Rumi"],
    },
    skin: ["medium brown skin", "light brown skin", "warm brown skin"],
  },
  {
    key: "Latin American",
    weight: 3,
    names: {
      frau: ["Valentina", "Camila", "Lucía", "Daniela", "Mariana"],
      mann: ["Mateo", "Diego", "Santiago", "Andrés", "Javier"],
      nichtbinaer: ["Ale", "Cruz", "Dani"],
    },
    skin: ["tan skin", "light brown skin", "olive skin"],
  },
  {
    key: "mixed",
    weight: 9,
    names: {
      frau: ["Mia", "Lina", "Noemi", "Samira", "Jasmin", "Leonie", "Amelie", "Naomi"],
      mann: ["Elias", "Noah", "Aaron", "David", "Rafael", "Samuel", "Joel", "Adrian"],
      nichtbinaer: NEUTRAL_NAMES,
    },
    skin: ["light brown skin", "medium brown skin", "olive skin", "fair skin with freckles", "warm tan skin"],
  },
];

/** Fiktive Orte. Sie sind bewusst erfunden und werden in der App als fiktiv gekennzeichnet. */
export const FICTIONAL_CITIES = [
  "Kesselbrück", "Hohenwald am See", "Neu-Ellerbach", "Marlingen", "Sandhafen", "Rabenstedt",
  "Lindenbühl", "Falkenmoor", "Ostermarsch", "Kirchtal an der Wenne", "Brunnstadt", "Elbenhafen",
  "Grauwacke", "Sonnenfelde", "Weidenstein", "Altkronach", "Mühlbrunn", "Seegrafen",
] as const;

interface Archetype {
  key: string;
  weight: number;
  minAge: number;
  occupations: readonly string[];
}

const ARCHETYPES: readonly Archetype[] = [
  { key: "studium", weight: 22, minAge: 18, occupations: ["Studium Lehramt", "Studium Maschinenbau", "Studium Psychologie", "Studium Soziale Arbeit", "Studium Informatik", "Studium Medizin", "Studium Kunstgeschichte", "Studium BWL", "Studium Biologie", "Studium Jura", "Studium Medienwissenschaft", "Studium Architektur"] },
  { key: "ausbildung", weight: 13, minAge: 18, occupations: ["Ausbildung zur Pflegefachkraft", "Ausbildung als Elektroniker:in", "Ausbildung zur Bankkauffrau/zum Bankkaufmann", "Ausbildung als Tischler:in", "Ausbildung zur Erzieherin/zum Erzieher", "Ausbildung als Mechatroniker:in", "Ausbildung als Friseur:in", "Ausbildung als Fachinformatiker:in"] },
  { key: "berufseinstieg", weight: 18, minAge: 21, occupations: ["Junior im Marketing", "Sachbearbeitung in einer Versicherung", "Werkstudent:in, die/der gerade übernommen wurde", "Trainee im Einzelhandel", "Junior-Softwareentwicklung", "Projektassistenz in einem Ingenieurbüro", "Referendariat an einer Grundschule", "Assistenzarzt/-ärztin im ersten Jahr"] },
  { key: "handwerk", weight: 8, minAge: 19, occupations: ["Geselle/Gesellin im Dachdeckerbetrieb", "Kfz-Mechatroniker:in", "Bäcker:in mit Frühschicht", "Gärtner:in in einer Baumschule", "Zimmerer/Zimmerin auf Wanderschaft gewesen"] },
  { key: "gesundheit_sozial", weight: 8, minAge: 20, occupations: ["Physiotherapeut:in", "Pflegefachkraft auf der Intensivstation", "Rettungssanitäter:in", "Erzieher:in in einer Kita", "Medizinische Fachangestellte"] },
  { key: "kreativ", weight: 8, minAge: 19, occupations: ["Freie Illustratorin/freier Illustrator", "Tätowierer:in in Ausbildung", "Fotograf:in für Hochzeiten", "Musiker:in mit Nebenjob in einer Bar", "Mediengestalter:in", "Keramiker:in mit kleinem Online-Shop"] },
  { key: "gastro_service", weight: 7, minAge: 18, occupations: ["Barista", "Koch/Köchin in einem Bistro", "Servicekraft im Biergarten", "Hotelfachkraft", "Barkeeper:in"] },
  { key: "tech_gaming", weight: 6, minAge: 19, occupations: ["IT-Support", "Spieleentwickler:in in einem kleinen Studio", "Data-Analyst:in", "Systemadministrator:in"] },
  { key: "sport", weight: 5, minAge: 19, occupations: ["Fitnesstrainer:in", "Sportstudium mit Job im Kletterzentrum", "Schwimmlehrer:in", "Physiotherapie-Studium und Vereinsfußball"] },
  { key: "suchend", weight: 5, minAge: 18, occupations: ["Gap Year nach dem Abi mit Aushilfsjob", "Studienabbruch, jetzt Neuorientierung", "Jobbt im Lager und spart für eine Reise", "Freiwilliges Ökologisches Jahr"] },
];

const TRAITS = [
  "neugierig", "sarkastisch", "schüchtern", "direkt", "verplant", "ehrgeizig", "gemütlich", "chaotisch",
  "ordentlich", "nachdenklich", "albern", "skeptisch", "loyal", "spontan", "eigensinnig", "geduldig",
  "ungeduldig", "hilfsbereit", "stur", "verträumt", "pragmatisch", "abenteuerlustig", "vorsichtig", "streitlustig",
  "empathisch", "trocken", "nerdig", "launisch", "bodenständig", "melancholisch",
] as const;

export const WRITING_HABITS = [
  "schreibt alles klein und ohne Punkt",
  "schreibt sauber mit Groß- und Kleinschreibung",
  "nutzt viele Abkürzungen wie 'vllt', 'ka', 'iwie'",
  "schreibt oft mehrere kurze Nachrichten hintereinander",
  "benutzt gern '...' am Satzende",
  "schreibt leicht umgangssprachlich mit regionalen Ausdrücken",
  "schreibt eher förmlich-höflich, wirkt manchmal steif",
  "schreibt schnell und mit gelegentlichen Tippfehlern",
] as const;

const BODY_TYPES = ["slim build", "average build", "athletic build", "curvy build", "stocky build", "plus-size build", "tall and lanky build", "short and sturdy build", "soft, slightly chubby build"] as const;

const HAIR: Record<Gender, readonly string[]> = {
  frau: ["long straight hair", "shoulder-length wavy hair", "curly hair in a messy bun", "short pixie cut", "braided hair", "dyed copper hair", "dark hair in a ponytail", "bob haircut", "natural afro hair", "hair tucked under a beanie"],
  mann: ["short cropped hair", "messy medium-length hair", "buzz cut", "curly hair", "receding hairline", "man bun", "neatly styled side part", "shaggy hair and stubble", "short beard", "full beard"],
  nichtbinaer: ["short undercut", "dyed blue short hair", "curly shoulder-length hair", "buzz cut", "messy bob", "mullet haircut", "short bleached hair"],
};

const SETTINGS = [
  "mirror selfie in a small apartment hallway",
  "sitting at a beer garden table with a drink, friends partially cropped out",
  "on a forest hiking trail with a backpack",
  "in a café by the window holding a cappuccino",
  "at a friend's birthday party indoors, warm lighting",
  "on a city bridge at dusk",
  "at a windy North Sea beach wearing a hoodie",
  "in a kitchen cooking pasta",
  "at a bouldering gym, chalky hands",
  "at an open-air concert in daylight",
  "on a balcony with plants",
  "with a bicycle on a cobblestone street",
  "at a flea market looking at records",
  "in a park on a picnic blanket",
  "at a lake jetty in summer, fully clothed",
  "on a sofa with a cat",
  "at a football stadium wearing a scarf",
  "in a university library",
  "at a Christmas market in winter clothes",
  "in a car passenger seat, seatbelt on, casual selfie",
] as const;

const PHOTO_STYLES = [
  "slightly grainy smartphone photo",
  "front camera selfie, slightly off-center framing",
  "casual photo taken by a friend",
  "well-lit candid photo",
  "slightly overexposed phone photo",
  "photo with natural evening light",
] as const;

const LIFESTYLE_PHOTO: Record<Lifestyle, { settings: readonly string[]; styles: readonly string[] }> = {
  influencer: {
    settings: ["posing at a trendy brunch spot", "outfit photo on a city street with good light", "at a rooftop terrace with a view"],
    styles: ["polished phone photo with ring-light look", "well-composed lifestyle photo"],
  },
  onlyfans: {
    settings: ["at a stylish café, casual outfit", "outdoor portrait on a city street", "at a gym in sportswear, fully covered"],
    styles: ["confident, well-lit smartphone portrait", "polished but casual portrait"],
  },
  status: {
    settings: ["at a rooftop bar in a designer outfit", "in front of a luxury hotel entrance", "at a fancy restaurant table"],
    styles: ["well-lit photo with polished styling", "glossy smartphone photo"],
  },
};

function pickGender(rng: Rng, user: UserProfile): Gender {
  const options = user.lookingFor.length > 0 ? user.lookingFor : (["frau", "mann"] as Gender[]);
  // Nicht-binäre Personen kommen seltener vor, sind aber dabei, wenn gewünscht.
  return rng.weighted(options.map((g) => [g, g === "nichtbinaer" ? 0.35 : 1] as const));
}

function pickAge(rng: Rng, user: UserProfile, minAge: number): number {
  const lo = Math.max(MIN_AGE, minAge, user.ageMin);
  const hi = Math.min(CHARACTER_MAX_AGE, user.ageMax);
  if (hi < lo) return Math.max(MIN_AGE, Math.min(CHARACTER_MAX_AGE, user.ageMax));
  // Zwei Würfe mitteln: Häufung in der Mitte der Spanne.
  return Math.round((rng.int(lo, hi) + rng.int(lo, hi)) / 2);
}

function pickLookingFor(rng: Rng, own: Gender, user: UserProfile): Gender[] {
  // Wer angezeigt wird, interessiert sich grundsätzlich für das Geschlecht der Person,
  // wie in echten Dating-Apps. Darüber hinaus variiert die Orientierung.
  const set = new Set<Gender>([user.gender]);
  if (rng.chance(0.22)) set.add(own === "frau" ? "mann" : own === "mann" ? "frau" : rng.pick(["frau", "mann"] as const));
  if (rng.chance(0.12)) set.add(rng.pick(["frau", "mann", "nichtbinaer"] as const));
  return [...set];
}

function pickIntent(rng: Rng, lifestyle: Lifestyle[]): Intent {
  if (lifestyle.includes("status")) return rng.weighted([["beziehung", 3], ["offen", 2], ["locker", 1]] as const);
  return rng.weighted([["beziehung", 40], ["locker", 33], ["offen", 27]] as const);
}

function pickLifestyle(rng: Rng, age: number): Lifestyle[] {
  const out: Lifestyle[] = [];
  if (rng.chance(0.07)) out.push("influencer");
  // Erwachsene Creator: nur bei Charakteren ab 19, damit kein Grenzfall entsteht.
  if (age >= 19 && rng.chance(0.04)) out.push("onlyfans");
  if (rng.chance(0.06)) out.push("status");
  return out;
}

export interface CastingOptions {
  /** Bereits vergebene Vornamen, um Dopplungen zu vermeiden. */
  usedNames?: ReadonlySet<string>;
}

export function newCharacterId(seed: number): string {
  return `c-${seed.toString(36)}-${hashString(`id:${seed}`).toString(36)}`;
}

export function castCharacter(seed: number, user: UserProfile, opts: CastingOptions = {}): CharacterSpec {
  const rng = new Rng(seed);
  const gender = pickGender(rng, user);
  const archetype = rng.weighted(ARCHETYPES.map((a) => [a, a.weight] as const));
  const age = pickAge(rng, user, archetype.minAge);
  const heritage = rng.weighted(HERITAGES.map((h) => [h, h.weight] as const));

  const used = opts.usedNames ?? new Set<string>();
  const pool = heritage.names[gender];
  const fresh = pool.filter((n) => !used.has(n));
  const name = fresh.length > 0 ? rng.pick(fresh) : rng.pick(pool);

  const lifestyle = pickLifestyle(rng, age);
  const temperament = rng.weighted<Temperament>([["introvertiert", 35], ["ambivertiert", 40], ["extrovertiert", 25]]);
  const attractiveness = rng.weighted<Attractiveness>(
    lifestyle.length > 0
      ? [["durchschnittlich", 30], ["attraktiv", 50], ["sehr attraktiv", 20]]
      : [["unauffällig", 22], ["durchschnittlich", 45], ["attraktiv", 26], ["sehr attraktiv", 7]],
  );

  const special = lifestyle[0];
  const setting = special && rng.chance(0.7) ? rng.pick(LIFESTYLE_PHOTO[special].settings) : rng.pick(SETTINGS);
  const photoStyle = special && rng.chance(0.7) ? rng.pick(LIFESTYLE_PHOTO[special].styles) : rng.pick(PHOTO_STYLES);

  const spread = rng.int(2, 6);
  const ageRange: [number, number] = [Math.max(MIN_AGE, age - spread - rng.int(0, 2)), age + rng.int(2, 8)];

  const replyLength = rng.weighted<ReplyLength>(
    temperament === "extrovertiert" ? [["kurz", 2], ["mittel", 4], ["lang", 3]] : [["kurz", 4], ["mittel", 4], ["lang", 1]],
  );
  const emoji = rng.weighted<EmojiUse>([["nie", 3], ["selten", 5], ["oft", 3]]);
  const responsiveness = rng.weighted<Responsiveness>([["schnell", 3], ["mittel", 5], ["langsam", 3]]);

  const extroBoost = temperament === "extrovertiert" ? 0.25 : temperament === "introvertiert" ? -0.2 : 0;
  const statusBoost = lifestyle.includes("status") || lifestyle.includes("influencer") ? 0.2 : 0;
  const round2 = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;

  return {
    id: newCharacterId(seed),
    seed,
    name,
    age,
    gender,
    lookingFor: pickLookingFor(rng, gender, user),
    ageRange,
    city: rng.pick(FICTIONAL_CITIES),
    intent: pickIntent(rng, lifestyle),
    archetype: archetype.key,
    occupationHint: rng.pick(archetype.occupations),
    lifestyle,
    temperament,
    traitHints: rng.sample(TRAITS, 3),
    looks: {
      heritage: heritage.key,
      skin: rng.pick(heritage.skin),
      bodyType: rng.pick(BODY_TYPES),
      attractiveness,
      hairHint: rng.pick(HAIR[gender]),
      glasses: rng.chance(0.22),
      setting,
      photoStyle,
    },
    style: {
      replyLength,
      emoji,
      responsiveness,
      initiative: round2(0.25 + rng.next() * 0.5 + extroBoost),
      pickiness: round2(0.2 + rng.next() * 0.55 + statusBoost),
      warmth: round2(0.2 + rng.next() * 0.7),
      writing: rng.pick(WRITING_HABITS),
    },
  };
}
