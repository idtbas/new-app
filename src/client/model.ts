import type { Decision } from "../shared/matching";
import type { Character } from "../shared/types";

export type RelationStatus =
  | "unseen" // im Stapel, noch nicht bewertet
  | "passed" // vom Nutzer abgelehnt
  | "awaiting" // geliket, Figur hat noch nicht entschieden (z. B. Aufruf fehlgeschlagen)
  | "pending" // Figur ist unentschlossen, Ergebnis steht fest, wird später sichtbar
  | "rejected" // Figur hat das Like nicht erwidert
  | "matched"
  | "unmatched";

export interface Relation {
  id: string;
  createdAt: number;
  status: RelationStatus;
  imageState: "none" | "ready" | "failed";
  /** Version des Charakters, zu der das gespeicherte Bild gehört (fehlt = 0). */
  imageVersion?: number;
  likedAt?: number;
  decision?: Decision;
  matchedAt?: number;
  /** Interesse der Figur 0..10 (intern, nie angezeigt). */
  interest: number;
  memory: string[];
  chatEnded: boolean;
  endedBy?: "user" | "char";
  replyDueAt?: number;
  openerDueAt?: number;
  lastReadAt: number;
  /** Fehlgeschlagene automatische Versuche des aktuellen Jobs. */
  jobFailures: number;
  retryAfter?: number;
}

export interface StoredMessage {
  id?: number;
  charId: string;
  from: "user" | "char" | "system";
  text: string;
  /** Zeitpunkt, ab dem die Nachricht sichtbar ist (simulierte Verzögerung). */
  at: number;
}

/** Frühere Version einer umgeschriebenen Figur (inkl. Foto), für „Rückgängig“. */
export interface HistoryEntry {
  id?: number;
  charId: string;
  savedAt: number;
  character: Character;
  image?: Blob;
}

export interface StoredImage {
  id: string;
  blob: Blob;
}

export function newRelation(id: string, now: number): Relation {
  return {
    id,
    createdAt: now,
    status: "unseen",
    imageState: "none",
    interest: 5,
    memory: [],
    chatEnded: false,
    lastReadAt: now,
    jobFailures: 0,
  };
}
