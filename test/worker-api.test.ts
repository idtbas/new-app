import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../src/shared/errors";
import { handleApi } from "../src/worker/index";
import { ACCOUNT_ID, IMAGE_TOKEN, TEXT_TOKEN, credentials, makeCharacter, profile, user } from "./fixtures";

interface Captured {
  url: string;
  init: RequestInit;
  bodyText: string;
}

function captureFetch(responder: (call: number) => Response | Promise<Response>): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const bodyText = typeof init.body === "string" ? init.body : init.body instanceof FormData ? await new Request("https://x/", { method: "POST", body: init.body }).text() : "";
    calls.push({ url, init, bodyText });
    return responder(calls.length);
  });
  return calls;
}

function chatCompletion(content: string): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], result: { choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function cfError(status: number, codes: number[]): Response {
  // Absichtlich sensible Inhalte im Fehlertext, die nie durchgereicht werden dürfen.
  return new Response(
    JSON.stringify({ success: false, errors: codes.map((code) => ({ code, message: `secret detail ${IMAGE_TOKEN} ${TEXT_TOKEN}` })), result: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function apiRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://app.example", ...headers },
    body: JSON.stringify(body),
  });
}

async function read(res: Response): Promise<{ status: number; text: string; json: any }> {
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

afterEach(() => vi.unstubAllGlobals());

const character = makeCharacter();

describe("Token-Schutz und Eingabevalidierung", () => {
  it("lehnt fehlende Zugangsdaten ab, ohne Cloudflare aufzurufen", async () => {
    const calls = captureFetch(() => chatCompletion("{}"));
    const r = await read(await handleApi(apiRequest("/api/evaluate", { character, user })));
    expect(r.status).toBe(400);
    expect(r.json.error.kind).toBe("missing_credentials");
    expect(calls).toHaveLength(0);
  });

  it("lehnt Tokens mit Zeilenumbruch (Header-Injection) ab und gibt den Wert nicht zurück", async () => {
    const calls = captureFetch(() => chatCompletion("{}"));
    const evil = `${IMAGE_TOKEN}\r\nX-Evil: 1`;
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials: { accountId: ACCOUNT_ID, imageToken: evil }, character, user })));
    expect(r.status).toBe(400);
    expect(r.text).not.toContain(IMAGE_TOKEN);
    expect(calls).toHaveLength(0);
  });

  it("lehnt ungültige Account-IDs ab (keine Pfadmanipulation)", async () => {
    const calls = captureFetch(() => chatCompletion("{}"));
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials: { accountId: "../../zones", imageToken: IMAGE_TOKEN }, character, user })));
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("lehnt fremde Origins, GET und URL-Parameter ab", async () => {
    captureFetch(() => chatCompletion("{}"));
    expect((await handleApi(apiRequest("/api/evaluate", { credentials, character, user }, { Origin: "https://evil.example" }))).status).toBe(403);
    expect((await handleApi(new Request("https://app.example/api/evaluate"))).status).toBe(405);
    expect((await handleApi(new Request("https://app.example/api/evaluate?token=x", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }))).status).toBe(400);
  });

  it("lehnt Charaktere unter 18 ab", async () => {
    const calls = captureFetch(() => chatCompletion("{}"));
    const young = { ...character, spec: { ...character.spec, age: 17 } };
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials, character: young, user })));
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("schickt Tokens nur im Authorization-Header, nie im Prompt, und nutzt den Text-Token für Text", async () => {
    const calls = captureFetch(() => chatCompletion('{"impression": 1, "reason": "passt"}'));
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials: { ...credentials, textToken: TEXT_TOKEN }, character, user })));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, data: { impression: 1 } });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect((c.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEXT_TOKEN}`);
    expect(c.init.redirect).toBe("manual");
    expect(c.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/google/gemma-4-26b-a4b-it`);
    expect(c.bodyText).not.toContain(TEXT_TOKEN);
    expect(c.bodyText).not.toContain(IMAGE_TOKEN);
    expect(c.bodyText).not.toContain(ACCOUNT_ID);
    const sent = JSON.parse(c.bodyText);
    expect(sent.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(sent.messages[0].role).toBe("system");
  });

  it("nutzt ohne Text-Token den Bild-Token auch für Text", async () => {
    const calls = captureFetch(() => chatCompletion('{"impression": 0}'));
    await handleApi(apiRequest("/api/evaluate", { credentials, character, user }));
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${IMAGE_TOKEN}`);
  });

  it("schickt beim Bild weder Token noch Account-ID im Multipart-Body", async () => {
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0) + "x".repeat(300));
    const calls = captureFetch(() => new Response(JSON.stringify({ success: true, result: { image: jpeg } }), { headers: { "content-type": "application/json" } }));
    const r = await read(await handleApi(apiRequest("/api/image", { credentials: { ...credentials, textToken: TEXT_TOKEN }, character })));
    expect(r.status).toBe(200);
    expect(r.json.data.mime).toBe("image/jpeg");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${IMAGE_TOKEN}`);
    expect(calls[0]!.bodyText).not.toContain(IMAGE_TOKEN);
    expect(calls[0]!.bodyText).not.toContain(ACCOUNT_ID);
    expect(calls[0]!.bodyText).toContain("clearly an adult");
  });
});

describe("Weitergabe von Cloudflare-Status und Fehlerarten", () => {
  const cases: [string, Response | (() => never), string, number | undefined][] = [
    ["401", cfError(401, [10000]), "invalid_credentials", 401],
    ["403", cfError(403, [10000]), "forbidden", 403],
    ["404 / 7003", cfError(404, [7003]), "not_found", 404],
    ["429 Rate-Limit", cfError(429, [3040]), "rate_limit", 429],
    ["429 Kontingent", cfError(429, [3036]), "quota", 429],
    ["500", cfError(500, []), "upstream", 500],
    ["504", cfError(504, []), "timeout", 504],
  ];

  for (const [label, response, kind, status] of cases) {
    it(`${label} -> ${kind}`, async () => {
      const calls = captureFetch(() => (response as Response).clone());
      const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials: { ...credentials, textToken: TEXT_TOKEN }, character, user })));
      expect(r.status).toBe(502);
      expect(r.json.ok).toBe(false);
      expect(r.json.error.kind).toBe(kind);
      expect(r.json.error.upstreamStatus).toBe(status);
      // Keine Upstream-Texte, keine Tokens in der Antwort.
      expect(r.text).not.toContain("secret detail");
      expect(r.text).not.toContain(IMAGE_TOKEN);
      expect(r.text).not.toContain(TEXT_TOKEN);
      // Fehler werden nicht automatisch wiederholt.
      expect(calls).toHaveLength(1);
    });
  }

  it("gibt numerische Fehlercodes weiter", async () => {
    captureFetch(() => cfError(401, [10000, 9109]));
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials, character, user })));
    expect(r.json.error.cfCodes).toEqual([10000, 9109]);
    expect(describeError(r.json.error)).toContain("Cloudflare-HTTP-Status 401");
    expect(describeError(r.json.error)).toContain("10000, 9109");
  });

  it("folgt keinen Weiterleitungen", async () => {
    const calls = captureFetch(() => new Response(null, { status: 302, headers: { Location: "https://evil.example/steal" } }));
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials, character, user })));
    expect(r.json.error.kind).toBe("redirect");
    expect(r.json.error.upstreamStatus).toBe(302);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith("https://api.cloudflare.com/")).toBe(true);
  });

  it("meldet Netzwerkfehler ausdrücklich als 'keine HTTP-Antwort'", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError(`connect failed ${IMAGE_TOKEN}`);
    });
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials, character, user })));
    expect(r.json.error.kind).toBe("network");
    expect(r.json.error.noResponse).toBe(true);
    expect(r.json.error.upstreamStatus).toBeUndefined();
    expect(describeError(r.json.error)).toContain("keine HTTP-Antwort");
    expect(r.text).not.toContain(IMAGE_TOKEN);
  });

  it("meldet Zeitüberschreitungen", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials, character, user })));
    expect(r.json.error.kind).toBe("timeout");
    expect(r.json.error.noResponse).toBe(true);
  });
});

describe("Modellantworten", () => {
  it("wiederholt ungültiges JSON genau einmal und meldet dann model_output", async () => {
    const calls = captureFetch(() => chatCompletion("Klar! Hier ist ein Profil: Lena ist toll."));
    const r = await read(await handleApi(apiRequest("/api/character", { credentials, spec: character.spec })));
    expect(r.status).toBe(502);
    expect(r.json.error.kind).toBe("model_output");
    expect(calls).toHaveLength(2);
  });

  it("lehnt schema-widriges JSON ab (fehlende Felder)", async () => {
    captureFetch(() => chatCompletion(JSON.stringify({ occupation: "x", bio: "zu kurz" })));
    const r = await read(await handleApi(apiRequest("/api/character", { credentials, spec: character.spec })));
    expect(r.json.error.kind).toBe("model_output");
    expect(r.json.error.message).toContain("Schema");
  });

  it("übernimmt gültige Profile und behält die vorgegebenen Eckdaten", async () => {
    captureFetch(() => chatCompletion("```json\n" + JSON.stringify({ ...profile, age: 16, name: "Anders" }) + "\n```"));
    const r = await read(await handleApi(apiRequest("/api/character", { credentials, spec: character.spec })));
    expect(r.status).toBe(200);
    expect(r.json.data.spec).toEqual(character.spec);
    expect(r.json.data.profile.bio).toBe(profile.bio);
    expect(r.json.data.id).toBe(character.spec.id);
  });

  it("meldet abgeschnittene Antworten als unbrauchbar", async () => {
    captureFetch(
      () =>
        new Response(JSON.stringify({ success: true, result: { choices: [{ message: { content: '{"impression":' }, finish_reason: "length" }] } }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const r = await read(await handleApi(apiRequest("/api/evaluate", { credentials, character, user })));
    expect(r.json.error.kind).toBe("model_output");
  });

  it("erzeugt für denselben Charakter immer denselben Bild-Seed und Prompt", async () => {
    const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0) + "x".repeat(300));
    const calls = captureFetch(() => new Response(JSON.stringify({ success: true, result: { image: jpeg } }), { headers: { "content-type": "application/json" } }));
    await handleApi(apiRequest("/api/image", { credentials, character }));
    await handleApi(apiRequest("/api/image", { credentials, character }));
    const strip = (s: string) => s.replace(/-{2,}[^\r\n]+/g, "");
    expect(strip(calls[0]!.bodyText)).toBe(strip(calls[1]!.bodyText));
  });
});

describe("Chat-Kontexte", () => {
  it("baut den Prompt nur aus dem übergebenen Verlauf und dem eigenen Charakter", async () => {
    const calls = captureFetch(() => chatCompletion('{"messages":["joa, klingt gut"],"interest_change":0,"action":"none","memory":[]}'));
    const other = makeCharacter(999);
    await handleApi(
      apiRequest("/api/chat", {
        credentials,
        character,
        user,
        mode: "reply",
        interest: 5,
        memory: ["arbeitet als Bauingenieur"],
        history: [{ from: "user", text: "Kletterst du auch draußen?" }],
      }),
    );
    const sent = JSON.parse(calls[0]!.bodyText);
    const all = sent.messages.map((m: { content: string }) => m.content).join("\n");
    expect(all).toContain(`Du bist ${character.spec.name}`);
    expect(all).toContain("Kletterst du auch draußen?");
    expect(all).toContain("arbeitet als Bauingenieur");
    if (other.spec.name !== character.spec.name) expect(all).not.toContain(`Du bist ${other.spec.name}`);
  });

  it("verlangt bei 'reply' eine Nutzernachricht", async () => {
    const calls = captureFetch(() => chatCompletion("{}"));
    const r = await handleApi(apiRequest("/api/chat", { credentials, character, user, mode: "reply", interest: 5, memory: [], history: [] }));
    expect(r.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
