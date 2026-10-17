import { validateUserProfile } from "../shared/schema";
import type { UserProfile } from "../shared/types";
import * as db from "./db";
import { clear, h } from "./dom";
import { engine } from "./engine";
import { chatView } from "./views/chat";
import { avatar, type Ctx, type Mounted, type View } from "./views/common";
import { discoverView } from "./views/discover";
import { matchesView, totalUnread } from "./views/matches";
import { blockedView, credentialsView, gateView, profileFormView } from "./views/onboarding";
import { profileView } from "./views/profile";

const root = document.getElementById("app")!;
const main = h("main", { id: "main" });
const toasts = h("div", { class: "toasts", "aria-live": "polite" });
const modalHost = h("div", { class: "modal-host" });
const matchBadge = h("span", { class: "badge nav-badge", hidden: true });

const tabs: { view: View; label: string; icon: string }[] = [
  { view: { name: "discover" }, label: "Entdecken", icon: "◎" },
  { view: { name: "matches" }, label: "Matches", icon: "♥" },
  { view: { name: "profile" }, label: "Profil", icon: "☺" },
];

const nav = h(
  "nav",
  { class: "tabbar", "aria-label": "Hauptnavigation" },
  tabs.map((t) =>
    h(
      "button",
      { class: "tab", "data-view": t.view.name, onclick: () => ctx.go(t.view) },
      h("span", { class: "tab-icon", "aria-hidden": "true" }, t.icon),
      h("span", {}, t.label),
      t.view.name === "matches" ? matchBadge : null,
    ),
  ),
);

const topbar = h(
  "header",
  { class: "topbar" },
  h("span", { class: "brand" }, "Funkenflug"),
  h("span", { class: "topbar-note" }, "Alle Profile sind KI-generiert"),
);

root.append(topbar, main, nav, toasts, modalHost);

let current: Mounted | null = null;
let user: UserProfile | null = null;

const ctx: Ctx = {
  go(view) {
    void show(view);
  },
  toast(msg) {
    const t = h("div", { class: "toast", role: "status" }, msg);
    toasts.append(t);
    setTimeout(() => t.remove(), msg.length > 80 ? 9000 : 4000);
  },
  modal(content) {
    const backdrop = h("div", { class: "modal-backdrop" }, h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, content));
    modalHost.append(backdrop);
    return () => backdrop.remove();
  },
};

async function show(view: View): Promise<void> {
  const settings = await db.getSettings();
  user = settings.user ?? null;
  current?.destroy?.();
  clear(main);

  const inApp = ["discover", "matches", "chat", "profile"].includes(view.name);
  nav.hidden = !inApp;
  root.classList.toggle("in-chat", view.name === "chat");
  for (const b of nav.querySelectorAll<HTMLElement>(".tab")) {
    const active = b.dataset.view === view.name || (view.name === "chat" && b.dataset.view === "matches");
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }

  switch (view.name) {
    case "gate":
      current = gateView(ctx);
      break;
    case "blocked":
      current = blockedView();
      break;
    case "onboarding":
      current = profileFormView(ctx, { next: { name: "credentials" }, title: "Dein Profil", submitLabel: "Weiter" });
      break;
    case "editProfile":
      current = profileFormView(ctx, { existing: user ?? undefined, next: { name: "profile" }, title: "Profil bearbeiten", submitLabel: "Speichern" });
      break;
    case "credentials":
      current = credentialsView(ctx, view.returnTo ?? { name: "discover" }, settings.accountId, user !== null);
      break;
    case "discover":
      current = discoverView(ctx);
      break;
    case "matches":
      current = matchesView(ctx);
      break;
    case "chat":
      current = chatView(ctx, view.id);
      break;
    case "profile":
      current = user ? profileView(ctx, user) : profileFormView(ctx, { next: { name: "profile" }, title: "Dein Profil", submitLabel: "Speichern" });
      break;
  }
  main.append(current.el);
  main.scrollTop = 0;
  void updateBadge();
}

async function updateBadge(): Promise<void> {
  const n = await totalUnread();
  matchBadge.hidden = n === 0;
  matchBadge.textContent = String(n);
}

engine.onChange(() => {
  current?.refresh?.();
  void updateBadge();
});
engine.onToast((msg) => ctx.toast(msg));
engine.onMatch(async (id) => {
  const c = await db.getCharacter(id);
  if (!c) return;
  const close = ctx.modal(
    h(
      "div",
      { class: "match-modal" },
      h("h2", {}, "Es ist ein Match!"),
      avatar(c, "m"),
      h("p", {}, `${c.spec.name} hat dein Like erwidert.`),
      h(
        "div",
        { class: "stack" },
        h(
          "button",
          {
            class: "btn btn-primary btn-block",
            onclick: () => {
              close();
              ctx.go({ name: "chat", id });
            },
          },
          "Nachricht schreiben",
        ),
        h("button", { class: "btn btn-ghost btn-block", onclick: () => close() }, "Weiter entdecken"),
      ),
    ),
  );
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    current?.refresh?.();
    void engine.tick();
  } else {
    engine.schedule(); // stoppt den Timer, solange die Seite verborgen ist
  }
});

async function boot(): Promise<void> {
  if (!("indexedDB" in window)) {
    main.append(h("section", { class: "panel narrow" }, h("h1", {}, "Nicht unterstützt"), h("p", {}, "Dieser Browser unterstützt keine lokale Datenbank (IndexedDB).")));
    return;
  }
  let settings: db.Settings;
  try {
    settings = await db.getSettings();
  } catch {
    main.append(
      h(
        "section",
        { class: "panel narrow" },
        h("h1", {}, "Speicher nicht verfügbar"),
        h("p", {}, "Die lokale Datenbank konnte nicht geöffnet werden (z. B. im privaten Modus mancher Browser oder wenn die App in einem anderen Tab gerade aktualisiert wird)."),
      ),
    );
    return;
  }
  if (settings.user) {
    try {
      engine.setUser(validateUserProfile(settings.user));
    } catch {
      settings.user = undefined;
    }
  }
  if (!settings.ageConfirmed || !settings.aiAcknowledged) return show({ name: "gate" });
  if (!settings.user) return show({ name: "onboarding" });
  // Nach dem Neuladen sind Tokens weg: zuerst Zugangsdaten abfragen.
  await show({ name: "credentials", returnTo: { name: "discover" } });
  void engine.tick();
}

void boot();
