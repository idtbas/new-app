// Zentrale Konfiguration. Modellnamen werden nur hier geändert, nirgends sonst.

export const MODELS = {
  /** Profilgenerierung, Charakter-Eindruck und Chats. */
  text: "@cf/google/gemma-4-26b-a4b-it",
  /** Profilbilder. Erwartet multipart/form-data (prompt, width, height, optional seed). */
  image: "@cf/black-forest-labs/flux-2-klein-4b",
} as const;

/** Einziger erlaubter Upstream-Host. Der Worker ruft nichts anderes auf. */
export const CF_API_ORIGIN = "https://api.cloudflare.com";

export const IMAGE_SIZE = { width: 512, height: 512 } as const;

export const LIMITS = {
  /** Maximale Größe eines Requests an den Worker (Bytes). */
  maxRequestBytes: 96_000,
  /** Zeitlimits für Upstream-Aufrufe im Worker (ms). */
  textTimeoutMs: 60_000,
  imageTimeoutMs: 90_000,
  /** Clientseitiges Zeitlimit, etwas länger als im Worker. */
  clientTimeoutMs: 100_000,
  /** Maximale Bildgröße der Upstream-Antwort (Bytes, dekodiert). */
  maxImageBytes: 6_000_000,
  /** Wie viele fertige, ungesehene Profile höchstens vorrätig sein sollen. */
  prefetchProfiles: 3,
  /** Wie viele Chatnachrichten als Kontext an das Modell gehen. */
  chatHistory: 24,
  /** Wie viele Erinnerungsnotizen pro Chat gespeichert werden. */
  memoryNotes: 14,
  /** Gleichzeitige Aufrufe aus dem Browser. */
  maxParallelText: 2,
  maxParallelImage: 1,
} as const;

/** Mindestalter für Nutzer und Charaktere. Nicht konfigurierbar nach unten. */
export const MIN_AGE = 18;
export const MAX_AGE = 99;
/** Generierte Charaktere bewegen sich in diesem Rahmen (Zielgruppe junge Erwachsene). */
export const CHARACTER_MAX_AGE = 40;
