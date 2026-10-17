import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRewrite, validateCharacter } from "../src/shared/schema";
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
  it("liefert die umgeschriebene Figur, ohne Token im Prompt", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return chatCompletion(JSON.stringify(rewritten()));
    });
    const res = await handleApi(apiRequest({ credentials, character: original, description: "Sie ist Pilotin, hat rote Haare und trägt Brille.", literal: false }));
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(json.data.character.spec.name).toBe("Mara");
    expect(json.data.character.version).toBe(1);
    expect(bodies[0]).toContain("Sie ist Pilotin");
    expect(bodies[0]).not.toContain(IMAGE_TOKEN);
  });

  it("übernimmt bei 'wörtlich' den Text exakt als Bio", async () => {
    vi.stubGlobal("fetch", async () => chatCompletion(JSON.stringify(rewritten())));
    const text = "Ich bin jetzt Pilotin und liebe Nachtflüge über die Ostsee.";
    const res = await handleApi(apiRequest({ credentials, character: original, description: text, literal: true }));
    expect(((await res.json()) as any).data.character.profile.bio).toBe(text);
  });

  it("lehnt zu kurze Beschreibungen ohne Cloudflare-Aufruf ab", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await handleApi(apiRequest({ credentials, character: original, description: "kurz", literal: false }));
    expect(res.status).toBe(400);
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
