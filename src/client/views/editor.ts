import { describeError } from "../../shared/errors";
import type { Character } from "../../shared/types";
import { toErrorInfo } from "../api";
import { hasCredentials } from "../credentials";
import { h } from "../dom";
import { engine } from "../engine";
import { spinner, type Ctx } from "./common";

// Hinweise, die eine Figur minderjährig machen würden. Der Worker begrenzt das Alter zusätzlich hart.
const MINOR_HINT = /\b(1[0-7]|[1-9])\s*(jahre|jährig|j\.)|\bminderjährig|\bteenager\b|\bteen\b/i;

export function pencilButton(ctx: Ctx, c: Character, extraClass = ""): HTMLElement {
  return h(
    "button",
    {
      class: `edit-btn ${extraClass}`.trim(),
      "aria-label": `Realität von ${c.spec.name} umschreiben`,
      title: "Beschreibung bearbeiten",
      onclick: (ev: Event) => {
        ev.stopPropagation();
        openRewriteEditor(ctx, c);
      },
    },
    "✎",
  );
}

export function openRewriteEditor(ctx: Ctx, c: Character): void {
  const text = h("textarea", { rows: 7, maxlength: 600, "aria-label": "Neue Beschreibung" }, c.profile.bio);
  const literal = h("input", { type: "checkbox", id: "rewrite-literal" });
  const error = h("p", { class: "form-error", role: "alert" });
  const status = h("div", { class: "editor-status" });
  const save = h("button", { class: "btn btn-primary btn-block" }, "Speichern & Realität ändern");
  const cancel = h("button", { class: "btn btn-ghost btn-block" }, "Abbrechen");

  const box = h(
    "div",
    { class: "editor" },
    h("h2", {}, `Realität von ${c.spec.name} umschreiben`),
    h(
      "p",
      { class: "small muted" },
      "Ändere die Beschreibung, wie du willst – etwa Beruf, Wohnort, Hobbys, Charakter oder Aussehen. Nach dem Speichern passt die KI die ganze Person daran an, auch ihr Foto. Alle Figuren bleiben erwachsen; explizite Inhalte werden ignoriert.",
    ),
    text,
    h("label", { class: "check", for: "rewrite-literal" }, literal, h("span", {}, "Meinen Text wörtlich als Bio übernehmen")),
    error,
    status,
    h("div", { class: "stack" }, save, cancel),
  );
  const close = ctx.modal(box);
  cancel.addEventListener("click", () => close());
  text.addEventListener("input", () => (error.textContent = ""));

  save.addEventListener("click", async () => {
    const value = text.value.trim();
    error.textContent = "";
    if (value.length < (literal.checked ? 20 : 10)) {
      error.textContent = `Bitte mindestens ${literal.checked ? 20 : 10} Zeichen schreiben.`;
      return;
    }
    if (literal.checked && value.length > 500) {
      error.textContent = "Für die wörtliche Übernahme höchstens 500 Zeichen.";
      return;
    }
    if (MINOR_HINT.test(value)) {
      error.textContent = "Alle Figuren in dieser App sind mindestens 18 Jahre alt.";
      return;
    }
    if (!hasCredentials()) {
      error.textContent = "Zum Umschreiben werden deine Cloudflare-Zugangsdaten benötigt (Profil → Zugangsdaten).";
      return;
    }
    save.disabled = true;
    cancel.disabled = true;
    text.disabled = true;
    status.append(spinner("Die KI schreibt die Realität um …"));
    try {
      const changes = await engine.rewriteCharacter(c.id, value, literal.checked);
      close();
      ctx.toast(`${changes || "Profil umgeschrieben."} Neues Foto wird erzeugt …`);
    } catch (err) {
      error.textContent = describeError(toErrorInfo(err));
      status.textContent = "";
      save.disabled = false;
      cancel.disabled = false;
      text.disabled = false;
    }
  });
  text.focus();
}
