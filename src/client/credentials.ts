// Zugangsdaten existieren ausschließlich in dieser Modul-Variablen (Arbeitsspeicher der Seite).
// Kein localStorage, kein sessionStorage, keine Cookies, keine IndexedDB, keine URL.
// Nach einem Neuladen der Seite sind sie weg und müssen erneut eingegeben werden.

import type { Credentials } from "../shared/types";

let current: Credentials | null = null;

export function setCredentials(c: Credentials): void {
  current = { ...c };
}

export function getCredentials(): Credentials | null {
  return current;
}

export function hasCredentials(): boolean {
  return current !== null;
}

export function clearCredentials(): void {
  current = null;
}
