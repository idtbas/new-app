import { afterEach, describe, expect, it, vi } from "vitest";
import { affectsPhoto, applyEdits, countEdits, editLabels } from "../src/shared/edits";
import { parseRewrite, validateCharacter, validateEdits } from "../src/shared/schema";
import { handleApi } from "../src/worker/index";
import { IMAGE_TOKEN, credentials, makeCharacter, profile } from "./fixtures";

const NOW = 1_800_000_000_000;
const original = makeCharacter(4711);

function rewritten(overrides: Record<string, unknown> = {}, spec: Record<string, unknown> = {}) {
  return {
    spec: {
      name: "Mara",
      age: 29,
      city: "Sandhafen",
      occupationHint: "Pilotin bei einer kleinen Airline",
      looks: { hairHint: "short red hair", glasses: true, setting: "in an airport lounge" },
      ...spec,
    },
    profile: { ...profile, occupation: "Pilotin", bio: "Ich fliege beruflich und lande privat lieber im Garten." },
    changes: "Sie ist jetzt Pilotin mit roten Haaren.",
    ...overrides,
  };
}

function chatCompletion(content: string): Response {
  return new Response(JSON.stringify({ success: true, result: { choices: [{ message: { content }, finish_reason: "stop" }] } }), {
    headers: { "content-type": "application/json" },
  });
}

function apiRequest(body: unknown): Request {
  return new Request("https://app.example/api/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.example" },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Realität umschreiben – Validierung", () => {
  it("übernimmt Änderungen und behält ID, Seed und Erstellungszeit", () => {
    const { character, changes } = parseRewrite(rewritten(), original, NOW);
    expect(character.id).toBe(original.id);
    expect(character.spec.seed).toBe(original.spec.seed);
    expect(character.createdAt).toBe(original.createdAt);
    expect(character.version).toBe(1);
    expect(character.editedAt).toBe(NOW);
    expect(character.spec.name).toBe("Mara");
    expect(character.spec.looks.hairHint).toBe("short red hair");
    expect(character.spec.looks.glasses).toBe(true);
    expect(character.profile.occupation).toBe("Pilotin");
    expect(changes).toContain("Pilotin");
    expect(validateCharacter(character)).toEqual(character);
  });

  it("lässt nicht erwähnte Felder unverändert", () => {
    const { character } = parseRewrite(rewritten(), original, NOW);
    expect(character.spec.gender).toBe(original.spec.gender);
    expect(character.spec.intent).toBe(original.spec.intent);
    expect(character.spec.looks.heritage).toBe(original.spec.looks.heritage);
    expect(character.spec.style.pickiness).toBe(original.spec.style.pickiness);
  });

  it("hält die Figur erwachsen (Alter hart auf 18–40 begrenzt)", () => {
    expect(parseRewrite(rewritten({}, { age: 15 }), original, NOW).character.spec.age).toBe(18);
    expect(parseRewrite(rewritten({}, { age: 70 }), original, NOW).character.spec.age).toBe(40);
    const young = parseRewrite(rewritten({}, { age: 15 }), original, NOW).character;
    expect(young.spec.ageRange[0]).toBeGreaterThanOrEqual(18);
  });

  it("fällt bei ungültigen Einzelwerten auf den alten Stand zurück", () => {
    const { character } = parseRewrite(rewritten({}, { gender: "alien", intent: 42, lifestyle: ["astronaut"] }), original, NOW);
    expect(character.spec.gender).toBe(original.spec.gender);
    expect(character.spec.intent).toBe(original.spec.intent);
    expect(character.spec.lifestyle).toEqual(original.spec.lifestyle);
  });

  it("verlangt ein vollständiges Profil", () => {
    expect(() => parseRewrite({ spec: {}, profile: { bio: "zu wenig" } }, original, NOW)).toThrow();
  });

  it("zählt die Version bei jedem Umschreiben hoch", () => {
    const first = parseRewrite(rewritten(), original, NOW).character;
    expect(parseRewrite(rewritten(), first, NOW).character.version).toBe(2);
  });
});

describe("Realität umschreiben – Worker", () => {
  function stubModel(answer: unknown): string[] {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return chatCompletion(JSON.stringify(answer));
    });
    return bodies;
  }

  it("setzt eine freie Anweisung um, ohne Token im Prompt", async () => {
    const bodies = stubModel(rewritten());
    const res = await handleApi(apiRequest({ credentials, character: original, edits: {}, instruction: "Sie ist jetzt Pilotin mit roten Haaren.", literalBio: false, surprise: false }));
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(json.data.character.spec.name).toBe("Mara");
    expect(json.data.character.version).toBe(1);
    expect(bodies[0]).toContain("Sie ist jetzt Pilotin");
    expect(bodies[0]).not.toContain(IMAGE_TOKEN);
  });

  it("festgelegte Felder gewinnen, auch wenn das Modell sie überschreibt", async () => {
    const bodies = stubModel(rewritten({}, { name: "Mara", age: 33, city: "Andersort" }));
    const edits = { name: "Juna", age: 27, looks: { hairHint: "long blonde hair", glasses: false }, style: { emoji: "oft" } };
    const res = await handleApi(apiRequest({ credentials, character: original, edits, instruction: "", literalBio: false, surprise: false }));
    const c = ((await res.json()) as any).data.character;
    expect(c.spec.name).toBe("Juna");
    expect(c.spec.age).toBe(27);
    expect(c.spec.looks.hairHint).toBe("long blonde hair");
    expect(c.profile.photo.hair).toBe("long blonde hair");
    expect(c.spec.looks.glasses).toBe(false);
    expect(c.spec.style.emoji).toBe("oft");
    // Nicht festgelegte Felder darf die KI anpassen.
    expect(c.spec.city).toBe("Andersort");
    // Die KI erfährt, welche Felder fest sind.
    expect(bodies[0]).toContain("Name, Alter, Frisur, Brille, Emojis");
  });

  it("übernimmt bei 'wörtlich' die Bio exakt", async () => {
    stubModel(rewritten());
    const text = "Ich bin jetzt Pilotin und liebe Nachtflüge über die Ostsee.";
    const res = await handleApi(apiRequest({ credentials, character: original, edits: { bio: text }, instruction: "", literalBio: true, surprise: false }));
    expect(((await res.json()) as any).data.character.profile.bio).toBe(text);
  });

  it("schickt bei 'Überrasch mich' eine Überraschungs-Anweisung", async () => {
    const bodies = stubModel(rewritten());
    const res = await handleApi(apiRequest({ credentials, character: original, edits: {}, instruction: "", literalBio: false, surprise: true }));
    expect(res.status).toBe(200);
    expect(bodies[0]).toContain("Überrasche");
  });

  it("lehnt Anfragen ohne jede Änderung und ungültige Vorgaben ohne Cloudflare-Aufruf ab", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const none = await handleApi(apiRequest({ credentials, character: original, edits: {}, instruction: "", literalBio: false, surprise: false }));
    expect(none.status).toBe(400);
    const young = await handleApi(apiRequest({ credentials, character: original, edits: { age: 16 }, instruction: "", surprise: false }));
    expect(young.status).toBe(400);
    const badEnum = await handleApi(apiRequest({ credentials, character: original, edits: { style: { emoji: "immer" } }, instruction: "", surprise: false }));
    expect(badEnum.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("erzeugt nach dem Umschreiben ein neues Bild (anderer Seed)", async () => {
    const forms: string[] = [];
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0) + "x".repeat(300));
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      forms.push(await new Request("https://x/", { method: "POST", body: init.body as FormData }).text());
      return new Response(JSON.stringify({ success: true, result: { image: jpeg } }), { headers: { "content-type": "application/json" } });
    });
    const updated = parseRewrite(rewritten(), original, NOW).character;
    const req = (character: unknown) =>
      new Request("https://app.example/api/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credentials, character }) });
    await handleApi(req(original));
    await handleApi(req(updated));
    const seedOf = (s: string) => /name="seed"\r\n\r\n(\d+)/.exec(s)?.[1];
    expect(seedOf(forms[0]!)).not.toBe(seedOf(forms[1]!));
    expect(forms[1]).toContain("short red hair");
    expect(forms[1]).toContain("clearly an adult");
  });
});

describe("Direkte Vorgaben (ohne KI)", () => {
  it("wendet Vorgaben an und bleibt gültig", () => {
    const edited = applyEdits(original, {
      name: "Juna",
      age: 30,
      occupation: "Tierärztin",
      interests: ["Pferde", "Krimis", "Kochen"],
      lifestyle: ["influencer"],
      looks: { bodyType: "athletic build", outfit: "sportswear", setting: "in a park with a dog on a leash" },
      style: { replyLength: "lang", warmth: 0.9 },
    });
    expect(edited.spec.name).toBe("Juna");
    expect(edited.profile.occupation).toBe("Tierärztin");
    expect(edited.spec.occupationHint).toBe("Tierärztin");
    expect(edited.profile.photo.outfit).toBe("sportswear");
    expect(edited.spec.lifestyle).toEqual(["influencer"]);
    expect(edited.spec.style.warmth).toBe(0.9);
    // Wunschspanne wandert mit dem Alter mit
    expect(edited.spec.ageRange[0] - original.spec.ageRange[0]).toBe(30 - original.spec.age);
    expect(validateCharacter({ ...edited, version: 1 })).toBeTruthy();
    // Original unverändert (rein funktional)
    expect(original.spec.name).not.toBe("Juna");
  });

  it("zählt und benennt Änderungen und erkennt Fotorelevanz", () => {
    const e = { name: "X", looks: { glasses: true }, style: { emoji: "nie" as const } };
    expect(countEdits(e)).toBe(3);
    expect(editLabels(e)).toEqual(["Name", "Brille", "Emojis"]);
    expect(affectsPhoto(e)).toBe(true);
    expect(affectsPhoto({ name: "X" })).toBe(false);
  });

  it("validiert Vorgaben streng", () => {
    expect(validateEdits({ age: 25, looks: { glasses: true } })).toEqual({ age: 25, looks: { glasses: true } });
    expect(() => validateEdits({ age: 17 })).toThrow();
    expect(() => validateEdits({ style: { warmth: 2 } })).toThrow();
    expect(() => validateEdits({ lookingFor: [] })).toThrow();
    expect(() => validateEdits({ interests: ["nur eins"] })).toThrow();
    expect(validateEdits({ unknown: 1 })).toEqual({});
  });
});
