import { GENDER_LABEL, type Character, type Gender } from "../../shared/types";
import { h } from "../dom";
import { engine } from "../engine";

export type View =
  | { name: "gate" }
  | { name: "blocked" }
  | { name: "onboarding" }
  | { name: "credentials"; returnTo?: View }
  | { name: "discover" }
  | { name: "matches" }
  | { name: "chat"; id: string }
  | { name: "profile" }
  | { name: "editProfile" };

export interface Mounted {
  el: HTMLElement;
  /** Wird bei Änderungen der Engine aufgerufen. */
  refresh?: () => void;
  destroy?: () => void;
}

export interface Ctx {
  go(view: View): void;
  toast(msg: string): void;
  modal(content: HTMLElement): () => void;
}

export function aiBadge(): HTMLElement {
  return h("span", { class: "ai-badge", title: "Dieses Profil ist vollständig KI-generiert" }, "KI-Charakter");
}

/** Avatar mit Bild aus IndexedDB (falls vorhanden), sonst Initiale. */
export function avatar(c: Character, size: "s" | "m" = "s"): HTMLElement {
  const el = h("div", { class: `avatar avatar-${size}`, "aria-hidden": "true" }, c.spec.name.slice(0, 1));
  void engine.ensureImageUrl(c.id).then((url) => {
    if (!url) return;
    el.textContent = "";
    el.append(h("img", { src: url, alt: "" }));
  });
  return el;
}

export function orientationLabel(own: Gender, lookingFor: readonly Gender[]): string {
  const set = new Set(lookingFor);
  if (set.size >= 2) return "Bi/Pan";
  const only = lookingFor[0];
  if (!only) return "";
  if (own === "nichtbinaer" || only === "nichtbinaer") return `Interessiert an: ${GENDER_LABEL[only]}`;
  return only === own ? (own === "frau" ? "Lesbisch" : "Schwul") : "Hetero";
}

export function spinner(text: string): HTMLElement {
  return h("div", { class: "status-line", role: "status" }, h("span", { class: "spinner", "aria-hidden": "true" }), text);
}

export function timeLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
