// Aufrufe an die Cloudflare-REST-API (Workers AI). Nur feste Modelle, nur api.cloudflare.com.
// Tokens werden ausschließlich im Authorization-Header dieser einen Anfrage verwendet.

import { CF_API_ORIGIN, IMAGE_SIZE, LIMITS, MODELS } from "../shared/config";
import type { ApiErrorInfo, ErrorKind } from "../shared/errors";

export type ModelKey = keyof typeof MODELS;

export type UpstreamResult<T> = { ok: true; value: T } | { ok: false; error: ApiErrorInfo };

const ACCOUNT_ID = /^[a-f0-9]{32}$/;

/** Baut die einzige erlaubte Upstream-URL. Wirft bei allem, was davon abweicht. */
export function modelUrl(accountId: string, model: ModelKey): string {
  if (!ACCOUNT_ID.test(accountId)) throw new Error("ungültige Account-ID");
  const url = `${CF_API_ORIGIN}/client/v4/accounts/${accountId}/ai/run/${MODELS[model]}`;
  if (new URL(url).origin !== CF_API_ORIGIN) throw new Error("unerlaubter Host");
  return url;
}

function fail(kind: ErrorKind, message: string, extra: Partial<ApiErrorInfo> = {}): { ok: false; error: ApiErrorInfo } {
  return { ok: false, error: { kind, message, ...extra } };
}

/** Liest nur numerische Fehlercodes aus der Cloudflare-Antwort, keine Texte. */
function extractCodes(body: unknown): number[] {
  if (typeof body !== "object" || body === null) return [];
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  const codes: number[] = [];
  for (const e of errors) {
    const code = (e as { code?: unknown } | null)?.code;
    if (typeof code === "number" && Number.isInteger(code) && codes.length < 5) codes.push(code);
  }
  return codes;
}

export function classifyHttpError(status: number, cfCodes: number[]): ApiErrorInfo {
  const base = { upstreamStatus: status, cfCodes };
  const has = (...c: number[]) => c.some((x) => cfCodes.includes(x));
  if (status >= 300 && status < 400) {
    return { kind: "redirect", message: "Cloudflare hat auf eine andere Adresse umgeleitet. Aus Sicherheitsgründen wird Weiterleitungen nicht gefolgt.", ...base };
  }
  if (status === 401) {
    return { kind: "invalid_credentials", message: "Der API-Token wurde nicht akzeptiert. Bitte prüfen, ob er vollständig kopiert wurde und noch gültig ist.", ...base };
  }
  if (status === 403) {
    return { kind: "forbidden", message: "Der Token ist gültig, darf aber Workers AI für diese Account-ID nicht nutzen. Prüfe die Berechtigung „Workers AI“ und ob Token und Account-ID zusammengehören.", ...base };
  }
  if (status === 404 || has(7003, 7000)) {
    return { kind: "not_found", message: "Konto oder Modell wurde nicht gefunden. Prüfe die Account-ID.", ...base };
  }
  if (status === 429 || has(3036, 3040)) {
    if (has(3036)) {
      return { kind: "quota", message: "Das tägliche Workers-AI-Kontingent dieses Kontos ist aufgebraucht. Später erneut versuchen oder Tarif prüfen.", ...base };
    }
    return { kind: "rate_limit", message: "Zu viele Anfragen in kurzer Zeit oder das Kontingent ist erreicht. Bitte etwas warten.", ...base };
  }
  if (status === 408 || status === 504 || status === 524) {
    return { kind: "timeout", message: "Cloudflare hat die Anfrage wegen Zeitüberschreitung abgebrochen.", ...base };
  }
  if (status >= 500) {
    return { kind: "upstream", message: "Bei Cloudflare ist ein Serverfehler aufgetreten. Bitte später erneut versuchen.", ...base };
  }
  if (has(5007)) {
    return { kind: "not_found", message: "Das konfigurierte Modell ist für dieses Konto nicht verfügbar.", ...base };
  }
  if (has(6003, 6111, 6100, 9106, 9109, 10000)) {
    return { kind: "invalid_credentials", message: "Cloudflare hat die Zugangsdaten abgelehnt.", ...base };
  }
  return { kind: "upstream_rejected", message: "Cloudflare hat die Anfrage abgelehnt.", ...base };
}

interface RawCall {
  url: string;
  token: string;
  body: BodyInit;
  /** Nur für JSON-Bodies. Bei FormData wird bewusst KEIN Content-Type gesetzt. */
  contentType?: string;
  timeoutMs: number;
}

/** Führt den eigentlichen fetch aus. Folgt keinen Weiterleitungen. */
async function rawCall(call: RawCall): Promise<UpstreamResult<Response>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${call.token}`, Accept: "application/json" };
  if (call.contentType) headers["Content-Type"] = call.contentType;
  let res: Response;
  try {
    res = await fetch(call.url, {
      method: "POST",
      headers,
      body: call.body,
      // Weiterleitungen werden nicht verfolgt – so kann der Token nie an einen anderen Host gehen.
      // ("error" vermeiden: hat in der Ziel-Laufzeit zu Verbindungsfehlern geführt.)
      redirect: "manual",
      signal: AbortSignal.timeout(call.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return fail("timeout", `Keine Antwort innerhalb von ${Math.round(call.timeoutMs / 1000)} Sekunden.`, { noResponse: true });
    }
    // Fehlertext absichtlich nicht weitergeben.
    return fail("network", "Die Verbindung zu Cloudflare ist fehlgeschlagen.", { noResponse: true });
  }
  // In Workers liefert redirect:"manual" die echte 3xx-Antwort; im Browser-Standard wäre es "opaqueredirect".
  if ((res.type as string) === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    return { ok: false, error: classifyHttpError(res.status || 302, []) };
  }
  return { ok: true, value: res };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Text

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextOptions {
  maxTokens: number;
  temperature: number;
  seed?: number;
}

/** Holt den Text aus verschiedenen möglichen Antwortformen (Chat-Completions bevorzugt). */
export function extractText(result: unknown): { text: string; truncated: boolean } | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const r = result as Record<string, unknown>;
  const choices = r.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const c = choices[0] as { message?: { content?: unknown }; finish_reason?: unknown };
    const content = c.message?.content;
    if (typeof content === "string") return { text: content, truncated: c.finish_reason === "length" };
    if (Array.isArray(content)) {
      const text = content
        .map((p) => (typeof p === "object" && p && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
        .join("");
      return { text, truncated: c.finish_reason === "length" };
    }
  }
  if (typeof r.response === "string") return { text: r.response, truncated: false };
  if (typeof r.response === "object" && r.response !== null) return { text: JSON.stringify(r.response), truncated: false };
  if (typeof r.output_text === "string") return { text: r.output_text, truncated: false };
  return undefined;
}

export async function runText(accountId: string, token: string, messages: ChatMessage[], opts: TextOptions): Promise<UpstreamResult<string>> {
  const body = {
    messages,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    // Kein „Thinking“: spart Neurons und verhindert Denktext in der Antwort.
    chat_template_kwargs: { enable_thinking: false },
  };
  const call = await rawCall({
    url: modelUrl(accountId, "text"),
    token,
    body: JSON.stringify(body),
    contentType: "application/json",
    timeoutMs: LIMITS.textTimeoutMs,
  });
  if (!call.ok) return call;
  const res = call.value;
  const json = await readJson(res);
  if (!res.ok) return { ok: false, error: classifyHttpError(res.status, extractCodes(json)) };
  const envelope = json as { success?: unknown; result?: unknown } | undefined;
  if (!envelope || envelope.success === false) {
    return fail("model_output", "Cloudflare meldete keinen Erfolg, obwohl die Anfrage angenommen wurde.", {
      upstreamStatus: res.status,
      cfCodes: extractCodes(json),
    });
  }
  const extracted = extractText(envelope.result);
  if (!extracted || extracted.text.trim() === "") {
    return fail("model_output", "Das Textmodell hat keine verwertbare Antwort geliefert.", { upstreamStatus: res.status });
  }
  if (extracted.truncated) {
    return fail("model_output", "Die Antwort des Textmodells wurde abgeschnitten.", { upstreamStatus: res.status });
  }
  return { ok: true, value: extracted.text };
}

// ---------------------------------------------------------------------------
// Bild

/** Baut den Multipart-Body für FLUX. Content-Type inkl. boundary setzt fetch selbst. */
export function buildImageForm(prompt: string, seed: number): FormData {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(IMAGE_SIZE.width));
  form.append("height", String(IMAGE_SIZE.height));
  form.append("seed", String(seed));
  return form;
}

function sniffMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  return undefined;
}

function base64ToBytesPrefix(b64: string, n: number): Uint8Array | undefined {
  try {
    const bin = atob(b64.slice(0, Math.ceil(n / 3) * 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function runImage(
  accountId: string,
  token: string,
  prompt: string,
  seed: number,
): Promise<UpstreamResult<{ mime: "image/jpeg" | "image/png" | "image/webp"; base64: string }>> {
  const call = await rawCall({
    url: modelUrl(accountId, "image"),
    token,
    body: buildImageForm(prompt, seed),
    timeoutMs: LIMITS.imageTimeoutMs,
  });
  if (!call.ok) return call;
  const res = call.value;
  const ct = res.headers.get("content-type") ?? "";

  if (!res.ok) {
    const json = ct.includes("json") ? await readJson(res) : undefined;
    return { ok: false, error: classifyHttpError(res.status, extractCodes(json)) };
  }

  // Manche Bildmodelle liefern Binärdaten direkt; FLUX.2 liefert JSON mit Base64.
  if (ct.startsWith("image/")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const mime = sniffMime(buf);
    if (!mime || buf.length > LIMITS.maxImageBytes) {
      return fail("model_output", "Das Bildmodell hat keine gültige Bilddatei geliefert.", { upstreamStatus: res.status });
    }
    return { ok: true, value: { mime, base64: bytesToBase64(buf) } };
  }

  const json = (await readJson(res)) as { success?: unknown; result?: { image?: unknown } } | undefined;
  const image = json?.result?.image;
  if (!json || json.success === false || typeof image !== "string" || image.length < 100) {
    return fail("model_output", "Das Bildmodell hat keine Bilddaten geliefert.", { upstreamStatus: res.status, cfCodes: extractCodes(json) });
  }
  const b64 = image.replace(/^data:image\/[a-z]+;base64,/, "").replace(/\s+/g, "");
  if (b64.length * 0.75 > LIMITS.maxImageBytes || !/^[A-Za-z0-9+/]+=*$/.test(b64)) {
    return fail("model_output", "Die Bilddaten des Modells sind ungültig.", { upstreamStatus: res.status });
  }
  const head = base64ToBytesPrefix(b64, 12);
  const mime = head ? sniffMime(head) : undefined;
  if (!mime) return fail("model_output", "Die Bilddaten des Modells haben ein unbekanntes Format.", { upstreamStatus: res.status });
  return { ok: true, value: { mime, base64: b64 } };
}
