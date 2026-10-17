// Aufrufe an den eigenen Worker. Begrenzte Parallelität, keine automatischen Wiederholungen
// (der Worker wiederholt nur unbrauchbare Modellantworten genau einmal).

import { LIMITS } from "../shared/config";
import type { ApiErrorInfo, ErrorKind } from "../shared/errors";
import { ERROR_TITLES } from "../shared/errors";
import type { Character, CharacterEdits, CharacterSpec, ChatMode, ChatTurnResult, HistoryEntry, ImageResult, Impression, RewriteResult, UserProfile } from "../shared/types";
import { getCredentials } from "./credentials";

export class ApiError extends Error {
  constructor(readonly info: ApiErrorInfo) {
    super(info.message);
    this.name = "ApiError";
  }
}

export function toErrorInfo(err: unknown): ApiErrorInfo {
  if (err instanceof ApiError) return err.info;
  return { kind: "bad_request", message: "Unerwarteter Fehler in der App." };
}

class Limiter {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const textLimiter = new Limiter(LIMITS.maxParallelText);
const imageLimiter = new Limiter(LIMITS.maxParallelImage);

const KNOWN_KINDS = new Set(Object.keys(ERROR_TITLES));

function sanitizeInfo(raw: unknown, httpStatus: number): ApiErrorInfo {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const kind = typeof r.kind === "string" && KNOWN_KINDS.has(r.kind) ? (r.kind as ErrorKind) : "upstream";
  const info: ApiErrorInfo = {
    kind,
    message: typeof r.message === "string" ? r.message.slice(0, 400) : `Unbekannter Fehler (HTTP ${httpStatus} vom App-Server).`,
  };
  if (typeof r.upstreamStatus === "number") info.upstreamStatus = r.upstreamStatus;
  if (Array.isArray(r.cfCodes)) info.cfCodes = r.cfCodes.filter((c): c is number => typeof c === "number").slice(0, 5);
  if (r.noResponse === true) info.noResponse = true;
  return info;
}

async function post<T>(path: string, payload: Record<string, unknown>, limiter: Limiter): Promise<T> {
  const credentials = getCredentials();
  if (!credentials) {
    throw new ApiError({ kind: "missing_credentials", message: "Bitte Account-ID und API-Token eingeben (Profil → Zugangsdaten)." });
  }
  return limiter.run(async () => {
    let res: Response;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Tokens nur im Request-Body an den eigenen Worker – nie in URL oder Headern.
        body: JSON.stringify({ ...payload, credentials }),
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(LIMITS.clientTimeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ApiError({ kind: "timeout", message: "Der App-Server hat nicht rechtzeitig geantwortet." });
      }
      throw new ApiError({
        kind: "worker_unreachable",
        message: navigator.onLine ? "Keine Verbindung zum App-Server." : "Das Gerät ist offline.",
      });
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      throw new ApiError({ kind: "worker_unreachable", message: `Unerwartete Antwort vom App-Server (HTTP ${res.status}).` });
    }
    const d = data as { ok?: unknown; data?: unknown; error?: unknown };
    if (d.ok !== true) throw new ApiError(sanitizeInfo(d.error, res.status));
    return d.data as T;
  });
}

export const api = {
  character: (spec: CharacterSpec) => post<Character>("/api/character", { spec }, textLimiter),
  image: (character: Character) => post<ImageResult>("/api/image", { character }, imageLimiter),
  evaluate: (character: Character, user: UserProfile) => post<Impression>("/api/evaluate", { character, user }, textLimiter),
  chat: (args: { character: Character; user: UserProfile; mode: ChatMode; interest: number; memory: string[]; history: HistoryEntry[] }) =>
    post<ChatTurnResult>("/api/chat", args, textLimiter),
  rewrite: (args: { character: Character; edits: CharacterEdits; instruction: string; literalBio: boolean; surprise: boolean }) =>
    post<RewriteResult>("/api/rewrite", args, textLimiter),
};
