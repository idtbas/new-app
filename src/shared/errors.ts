// Fehlerarten, die Worker und Client gemeinsam verwenden.
// Fehlermeldungen werden ausschließlich aus festen Texten erzeugt – niemals aus
// Upstream-Antworttexten, damit keine Tokens oder sensiblen Inhalte durchsickern.

export type ErrorKind =
  | "missing_credentials"
  | "bad_request"
  | "invalid_credentials"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "quota"
  | "timeout"
  | "network"
  | "redirect"
  | "upstream"
  | "upstream_rejected"
  | "model_output"
  | "worker_unreachable";

export interface ApiErrorInfo {
  kind: ErrorKind;
  /** Kurze deutsche Beschreibung, ohne sensible Daten. */
  message: string;
  /** HTTP-Status der Cloudflare-API, falls eine Antwort einging. */
  upstreamStatus?: number;
  /** Numerische Cloudflare-Fehlercodes, falls vorhanden. */
  cfCodes?: number[];
  /** true, wenn von Cloudflare gar keine HTTP-Antwort kam. */
  noResponse?: boolean;
}

export const ERROR_TITLES: Record<ErrorKind, string> = {
  missing_credentials: "Zugangsdaten fehlen",
  bad_request: "Ungültige Anfrage",
  invalid_credentials: "Zugangsdaten ungültig",
  forbidden: "Fehlende Berechtigung",
  not_found: "Konto oder Modell nicht gefunden",
  rate_limit: "Rate-Limit erreicht",
  quota: "Kontingent aufgebraucht",
  timeout: "Zeitüberschreitung",
  network: "Netzwerkfehler",
  redirect: "Unerwartete Weiterleitung",
  upstream: "Cloudflare-Serverfehler",
  upstream_rejected: "Anfrage von Cloudflare abgelehnt",
  model_output: "Unbrauchbare Modellantwort",
  worker_unreachable: "App-Server nicht erreichbar",
};

/** Fehlerarten, bei denen automatische Hintergrundaufrufe pausieren, bis die Person handelt. */
export const BLOCKING_KINDS: readonly ErrorKind[] = [
  "missing_credentials",
  "invalid_credentials",
  "forbidden",
  "not_found",
  "quota",
];

export function describeError(info: ApiErrorInfo): string {
  const parts = [`${ERROR_TITLES[info.kind]}: ${info.message}`];
  if (info.upstreamStatus !== undefined) {
    let s = `Cloudflare-HTTP-Status ${info.upstreamStatus}`;
    if (info.cfCodes && info.cfCodes.length > 0) s += `, Fehlercode${info.cfCodes.length > 1 ? "s" : ""} ${info.cfCodes.join(", ")}`;
    parts.push(s);
  } else if (info.noResponse) {
    parts.push("Von Cloudflare ist keine HTTP-Antwort eingegangen.");
  }
  return parts.join(" – ");
}
