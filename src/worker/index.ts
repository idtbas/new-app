// Einziger Worker: liefert statische Assets aus und stellt vier feste API-Routen bereit.
// Kein Zustand im Worker-Speicher, keine Protokollierung von Request-Inhalten.

import { LIMITS } from "../shared/config";
import type { ApiErrorInfo } from "../shared/errors";
import { extractJsonObject } from "../shared/json";
import { hashString } from "../shared/rng";
import {
  ValidationError,
  parseChatTurn,
  parseGeneratedProfile,
  parseImpression,
  parseRewrite,
  validateCharacter,
  validateEdits,
  validateInstruction,
  validateCredentials,
  validateHistory,
  validateMemory,
  validateSpec,
  validateUserProfile,
} from "../shared/schema";
import { applyEdits, countEdits, editLabels } from "../shared/edits";
import type { Character, CharacterEdits, ChatMode, Credentials, UserProfile } from "../shared/types";
import { runImage, runText, type ChatMessage, type TextOptions, type UpstreamResult } from "./cloudflare";
import { characterMessages, chatMessages, imagePrompt, impressionMessages, rewriteMessages } from "./prompts";

export interface Env {
  ASSETS: Fetcher;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function errorResponse(error: ApiErrorInfo, status: number): Response {
  return json({ ok: false, error }, status);
}

function badRequest(message: string): Response {
  return errorResponse({ kind: "bad_request", message }, 400);
}

/** Upstream-Fehler werden als 502 an den Client gegeben; der echte Cloudflare-Status steht in upstreamStatus. */
function upstreamFailure(error: ApiErrorInfo): Response {
  return errorResponse(error, 502);
}

function textToken(c: Credentials): string {
  return c.textToken ?? c.imageToken;
}

/**
 * Ruft das Textmodell auf und parst/validiert JSON. Bei unbrauchbarer Antwort genau
 * ein zweiter Versuch – keine weiteren automatischen Wiederholungen.
 */
async function textJson<T>(
  creds: Credentials,
  messages: ChatMessage[],
  opts: TextOptions,
  parse: (v: unknown) => T,
): Promise<UpstreamResult<T>> {
  let lastError: ApiErrorInfo | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await runText(creds.accountId, textToken(creds), messages, {
      ...opts,
      // Beim zweiten Versuch etwas mehr Platz und etwas weniger Zufall.
      maxTokens: attempt === 0 ? opts.maxTokens : Math.round(opts.maxTokens * 1.5),
      temperature: attempt === 0 ? opts.temperature : Math.max(0.2, opts.temperature - 0.3),
      seed: opts.seed !== undefined ? (opts.seed + attempt) >>> 0 : undefined,
    });
    if (!res.ok) {
      // Nur unbrauchbare Modellausgaben werden wiederholt, keine Auth-/Kontingent-/Netzwerkfehler.
      if (res.error.kind !== "model_output") return res;
      lastError = res.error;
      continue;
    }
    const parsed = extractJsonObject(res.value);
    if (parsed === undefined) {
      lastError = { kind: "model_output", message: "Das Textmodell hat kein gültiges JSON geliefert." };
      continue;
    }
    try {
      return { ok: true, value: parse(parsed) };
    } catch (err) {
      const detail = err instanceof ValidationError ? ` (${err.path}: ${err.reason})` : "";
      lastError = { kind: "model_output", message: `Die Modellantwort entspricht nicht dem erwarteten Schema${detail}.` };
    }
  }
  return { ok: false, error: lastError ?? { kind: "model_output", message: "Unbekannter Modellfehler." } };
}

// ---------------------------------------------------------------------------
// Routen

async function handleCharacter(body: Record<string, unknown>, creds: Credentials): Promise<Response> {
  const spec = validateSpec(body.spec);
  const res = await textJson(creds, characterMessages(spec), { maxTokens: 1400, temperature: 0.9, seed: spec.seed }, parseGeneratedProfile);
  if (!res.ok) return upstreamFailure(res.error);
  const character: Character = { id: spec.id, createdAt: Date.now(), spec, profile: res.value };
  return json({ ok: true, data: character });
}

async function handleImage(body: Record<string, unknown>, creds: Credentials): Promise<Response> {
  const character = validateCharacter(body.character);
  // Stabiler Bild-Seed pro Charakter und Version: Ein erneuter Versuch erzeugt dasselbe Gesicht,
  // eine umgeschriebene Realität (neue Version) ein neues.
  const version = character.version ? `:v${character.version}` : "";
  const seed = hashString(`image:${character.id}:${character.spec.seed}${version}`) % 2_147_483_647;
  const res = await runImage(creds.accountId, creds.imageToken, imagePrompt(character), seed);
  if (!res.ok) return upstreamFailure(res.error);
  return json({ ok: true, data: res.value });
}

async function handleEvaluate(body: Record<string, unknown>, creds: Credentials): Promise<Response> {
  const character = validateCharacter(body.character);
  const user = validateUserProfile(body.user);
  const seed = hashString(`impression:${character.id}:${JSON.stringify(user)}`);
  const res = await textJson(creds, impressionMessages(character, user), { maxTokens: 160, temperature: 0.3, seed }, parseImpression);
  if (!res.ok) return upstreamFailure(res.error);
  return json({ ok: true, data: res.value });
}

async function handleChat(body: Record<string, unknown>, creds: Credentials): Promise<Response> {
  const character = validateCharacter(body.character);
  const user: UserProfile = validateUserProfile(body.user);
  const mode: ChatMode = body.mode === "opener" ? "opener" : "reply";
  const interest = typeof body.interest === "number" && Number.isFinite(body.interest) ? Math.max(0, Math.min(10, Math.round(body.interest))) : 5;
  const memory = validateMemory(body.memory ?? [], LIMITS.memoryNotes);
  const history = validateHistory(body.history ?? [], LIMITS.chatHistory);
  if (mode === "reply" && !history.some((h) => h.from === "user")) {
    return badRequest("Es gibt keine Nachricht, auf die geantwortet werden kann.");
  }
  const res = await textJson(
    creds,
    chatMessages(character, user, mode, interest, memory, history),
    { maxTokens: 500, temperature: 0.9 },
    (v) => parseChatTurn(v, mode),
  );
  if (!res.ok) return upstreamFailure(res.error);
  return json({ ok: true, data: res.value });
}

async function handleRewrite(body: Record<string, unknown>, creds: Credentials): Promise<Response> {
  const original = validateCharacter(body.character);
  const edits = validateEdits(body.edits);
  const instruction = validateInstruction(body.instruction);
  const surprise = body.surprise === true;
  const literalBio = body.literalBio === true && edits.bio !== undefined;
  if (countEdits(edits) === 0 && instruction === "" && !surprise) {
    return badRequest("Es gibt keine Änderung, die umgesetzt werden könnte.");
  }
  // Vorgaben der Person zuerst eintragen, die KI gleicht dann den Rest an.
  const base = applyEdits(original, edits);
  const seed = hashString(`rewrite:${original.id}:${original.version ?? 0}:${JSON.stringify(edits)}:${instruction}:${surprise}`);
  const res = await textJson(
    creds,
    rewriteMessages(base, { fixed: editLabels(edits), instruction, surprise, literalBio, bioWritten: edits.bio !== undefined }),
    { maxTokens: 2200, temperature: surprise ? 0.95 : 0.7, seed },
    (v) => parseRewrite(v, base, Date.now()),
  );
  if (!res.ok) return upstreamFailure(res.error);
  // Festgelegte Werte gewinnen immer, auch wenn das Modell sie verändert hat.
  const enforced: CharacterEdits = literalBio ? edits : { ...edits, bio: undefined };
  const character = applyEdits(res.value.character, enforced);
  return json({ ok: true, data: { character, changes: res.value.changes } });
}

const ROUTES: Record<string, (body: Record<string, unknown>, creds: Credentials) => Promise<Response>> = {
  "/api/character": handleCharacter,
  "/api/image": handleImage,
  "/api/evaluate": handleEvaluate,
  "/api/chat": handleChat,
  "/api/rewrite": handleRewrite,
};

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = ROUTES[url.pathname];
  if (!route) return errorResponse({ kind: "bad_request", message: "Unbekannter API-Pfad." }, 404);
  if (request.method !== "POST") return errorResponse({ kind: "bad_request", message: "Nur POST ist erlaubt." }, 405);

  // Nur Aufrufe von der eigenen Oberfläche annehmen.
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) return errorResponse({ kind: "bad_request", message: "Fremde Herkunft." }, 403);
  if (url.search !== "") return badRequest("Keine URL-Parameter erlaubt.");
  if (!(request.headers.get("Content-Type") ?? "").startsWith("application/json")) {
    return badRequest("JSON erwartet.");
  }

  const raw = await request.text();
  if (raw.length > LIMITS.maxRequestBytes) return errorResponse({ kind: "bad_request", message: "Anfrage zu groß." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return badRequest("Ungültiges JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return badRequest("JSON-Objekt erwartet.");
  const record = body as Record<string, unknown>;

  let creds: Credentials;
  try {
    if (record.credentials === undefined) throw new ValidationError("credentials", "fehlt");
    creds = validateCredentials(record.credentials);
  } catch (err) {
    // Nur Pfad und Grund ausgeben – niemals den übergebenen Wert.
    const reason = err instanceof ValidationError ? `${err.path}: ${err.reason}` : "ungültig";
    return errorResponse({ kind: "missing_credentials", message: `Zugangsdaten fehlen oder sind unvollständig (${reason}).` }, 400);
  }

  try {
    return await route(record, creds);
  } catch (err) {
    if (err instanceof ValidationError) return badRequest(`Ungültige Eingabe (${err.path}: ${err.reason}).`);
    // Unerwarteter Fehler: keine Details nach außen, kein Logging von Inhalten.
    return errorResponse({ kind: "bad_request", message: "Interner Fehler im App-Server." }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
