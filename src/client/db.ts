// IndexedDB-Speicher für Profile, Bilder, Beziehungen und Chats.
// Hier werden NIE API-Tokens gespeichert (siehe Settings-Typ: kein Feld dafür).

import type { Character, UserProfile } from "../shared/types";
import type { HistoryEntry, Relation, StoredImage, StoredMessage } from "./model";

const DB_NAME = "ki-dating";
// Version 2: zusätzlicher Speicher "history" für frühere Versionen umgeschriebener Figuren.
const DB_VERSION = 2;

/** Alles, was im Key-Value-Speicher liegen darf. Bewusst ohne Token-Felder. */
export interface Settings {
  ageConfirmed?: boolean;
  aiAcknowledged?: boolean;
  user?: UserProfile;
  /** Account-ID ist kein Geheimnis und wird zur Bequemlichkeit gemerkt. */
  accountId?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      // Bestehende Daten bleiben erhalten: nur fehlende Speicher anlegen.
      if (ev.oldVersion < 1) {
        db.createObjectStore("kv", { keyPath: "key" });
        db.createObjectStore("characters", { keyPath: "id" });
        db.createObjectStore("images", { keyPath: "id" });
        db.createObjectStore("relations", { keyPath: "id" });
        const messages = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
        messages.createIndex("charId", "charId", { unique: false });
      }
      if (ev.oldVersion < 2) {
        const history = db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
        history.createIndex("charId", "charId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB konnte nicht geöffnet werden"));
    req.onblocked = () => reject(new Error("IndexedDB ist durch einen anderen Tab blockiert"));
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB-Fehler"));
  });
}

async function store(name: string, mode: IDBTransactionMode = "readonly"): Promise<IDBObjectStore> {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

const SETTING_KEYS: readonly (keyof Settings)[] = ["ageConfirmed", "aiAcknowledged", "user", "accountId"];

export async function getSettings(): Promise<Settings> {
  const rows = (await wrap((await store("kv")).getAll())) as { key: keyof Settings; value: unknown }[];
  const out: Settings = {};
  for (const r of rows) {
    if (SETTING_KEYS.includes(r.key)) (out as Record<string, unknown>)[r.key] = r.value;
  }
  return out;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  if (!SETTING_KEYS.includes(key)) throw new Error("Unbekannte Einstellung");
  await wrap((await store("kv", "readwrite")).put({ key, value }));
}

export async function getCharacter(id: string): Promise<Character | undefined> {
  return (await wrap((await store("characters")).get(id))) as Character | undefined;
}

export async function allCharacters(): Promise<Character[]> {
  return (await wrap((await store("characters")).getAll())) as Character[];
}

export async function putCharacter(c: Character): Promise<void> {
  await wrap((await store("characters", "readwrite")).put(c));
}

/** Charakter und Beziehung atomar anlegen. Ein existierender Charakter wird nie überschrieben. */
export async function addCharacterWithRelation(c: Character, r: Relation): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["characters", "relations"], "readwrite");
    tx.objectStore("characters").add(c);
    tx.objectStore("relations").add(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Speichern fehlgeschlagen"));
    tx.onabort = () => reject(tx.error ?? new Error("Speichern abgebrochen"));
  });
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return (await wrap((await store("images")).get(id))) as StoredImage | undefined;
}

export async function putImage(img: StoredImage): Promise<void> {
  await wrap((await store("images", "readwrite")).put(img));
}

export async function getRelation(id: string): Promise<Relation | undefined> {
  return (await wrap((await store("relations")).get(id))) as Relation | undefined;
}

export async function allRelations(): Promise<Relation[]> {
  return (await wrap((await store("relations")).getAll())) as Relation[];
}

export async function putRelation(r: Relation): Promise<void> {
  await wrap((await store("relations", "readwrite")).put(r));
}

export async function messagesFor(charId: string): Promise<StoredMessage[]> {
  const idx = (await store("messages")).index("charId");
  const list = (await wrap(idx.getAll(IDBKeyRange.only(charId)))) as StoredMessage[];
  return list.sort((a, b) => a.at - b.at || (a.id ?? 0) - (b.id ?? 0));
}

export async function addMessage(m: StoredMessage): Promise<void> {
  await wrap((await store("messages", "readwrite")).add(m));
}

export async function historyFor(charId: string): Promise<HistoryEntry[]> {
  const idx = (await store("history")).index("charId");
  const list = (await wrap(idx.getAll(IDBKeyRange.only(charId)))) as HistoryEntry[];
  return list.sort((a, b) => b.savedAt - a.savedAt);
}

export async function getHistoryEntry(id: number): Promise<HistoryEntry | undefined> {
  return (await wrap((await store("history")).get(id))) as HistoryEntry | undefined;
}

/** Legt eine frühere Version ab und behält höchstens `keep` Einträge pro Figur. */
export async function addHistory(entry: HistoryEntry, keep: number): Promise<void> {
  await wrap((await store("history", "readwrite")).add(entry));
  const all = await historyFor(entry.charId);
  const s = await store("history", "readwrite");
  for (const old of all.slice(keep)) if (old.id !== undefined) s.delete(old.id);
}

/** Löscht die komplette lokale Datenbank dieser App. */
export async function deleteEverything(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error("Löschen fehlgeschlagen"));
    req.onblocked = () => resolve();
  });
}
