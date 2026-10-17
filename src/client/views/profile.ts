import { GENDER_LABEL, INTENT_LABEL, type UserProfile } from "../../shared/types";
import { clearCredentials, getCredentials } from "../credentials";
import * as db from "../db";
import { h } from "../dom";
import { engine } from "../engine";
import type { Ctx, Mounted } from "./common";

export function profileView(ctx: Ctx, user: UserProfile): Mounted {
  const creds = getCredentials();
  const credLine = creds
    ? `Im Arbeitsspeicher: Account-ID …${creds.accountId.slice(-4)}, ${creds.textToken ? "getrennte Tokens für Bild und Text" : "ein Token für Bild und Text"}.`
    : "Keine Zugangsdaten im Arbeitsspeicher.";

  const el = h(
    "section",
    { class: "panel narrow" },
    h("h1", {}, "Dein Profil"),
    h(
      "dl",
      { class: "facts" },
      h("dt", {}, "Name"),
      h("dd", {}, `${user.name}, ${user.age}`),
      h("dt", {}, "Ich bin"),
      h("dd", {}, GENDER_LABEL[user.gender]),
      h("dt", {}, "Interessiert an"),
      h("dd", {}, `${user.lookingFor.map((g) => GENDER_LABEL[g]).join(", ")}, ${user.ageMin}–${user.ageMax} Jahre`),
      h("dt", {}, "Ich suche"),
      h("dd", {}, INTENT_LABEL[user.intent]),
      h("dt", {}, "Interessen"),
      h("dd", {}, user.interests.join(", ")),
      h("dt", {}, "Über mich"),
      h("dd", {}, user.bio),
    ),
    h("button", { class: "btn btn-block", onclick: () => ctx.go({ name: "editProfile" }) }, "Profil bearbeiten"),
    h("p", { class: "small muted" }, "Änderungen gelten für neue Profile und neue Likes. Bereits getroffene Entscheidungen bleiben bestehen."),

    h("h2", {}, "Cloudflare-Zugang"),
    h("p", {}, credLine),
    h("button", { class: "btn btn-block", onclick: () => ctx.go({ name: "credentials", returnTo: { name: "profile" } }) }, creds ? "Zugangsdaten ändern" : "Zugangsdaten eingeben"),
    creds
      ? h(
          "button",
          {
            class: "btn btn-ghost btn-block",
            onclick: () => {
              clearCredentials();
              ctx.toast("Zugangsdaten aus dem Arbeitsspeicher entfernt.");
              ctx.go({ name: "profile" });
            },
          },
          "Zugangsdaten entfernen",
        )
      : null,

    h("h2", {}, "Daten & Transparenz"),
    h(
      "ul",
      { class: "small" },
      h("li", {}, "Alle Profile, Fotos und Antworten sind KI-generiert (Workers AI). Es gibt keine echten Personen in dieser App."),
      h("li", {}, "Profile, Bilder, Matches und Chats liegen nur lokal in diesem Browser (IndexedDB). Es gibt keine Server-Datenbank."),
      h("li", {}, "API-Tokens werden nirgends gespeichert und existieren nur, solange diese Seite geöffnet ist."),
      h("li", {}, "Antwortverzögerungen sind simuliert und werden nur verarbeitet, während die App geöffnet ist. Im Hintergrund passiert nichts."),
      h("li", {}, "Workers AI hat ein kontoweites kostenloses Tageskontingent; bei bestehendem Bezahltarif können darüber hinaus Kosten entstehen."),
    ),
    h(
      "button",
      {
        class: "btn btn-danger btn-block",
        onclick: async () => {
          if (!confirm("Alle lokalen App-Daten (Profil, Charaktere, Bilder, Matches, Chats) unwiderruflich löschen?")) return;
          clearCredentials();
          engine.revokeImages();
          await db.deleteEverything();
          location.reload();
        },
      },
      "Alle lokalen Daten löschen",
    ),
  );
  return { el };
}
