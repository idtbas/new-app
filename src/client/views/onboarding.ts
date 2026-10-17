import { MIN_AGE } from "../../shared/config";
import { ValidationError, isPlausibleAccountId, isPlausibleToken, validateUserProfile } from "../../shared/schema";
import { GENDERS, GENDER_LABEL, INTENTS, INTENT_LABEL, type Credentials, type UserProfile } from "../../shared/types";
import { clearCredentials, hasCredentials, setCredentials } from "../credentials";
import * as db from "../db";
import { h } from "../dom";
import { engine } from "../engine";
import type { Ctx, Mounted, View } from "./common";

// ---------------------------------------------------------------------------
// Altersbestätigung + KI-Hinweis

export function gateView(ctx: Ctx): Mounted {
  const ack = h("input", { type: "checkbox", id: "ai-ack" });
  const yes = h("button", { class: "btn btn-primary btn-block", disabled: true }, "Ich bin mindestens 18 Jahre alt");
  ack.addEventListener("change", () => (yes.disabled = !ack.checked));
  yes.addEventListener("click", async () => {
    await db.setSetting("ageConfirmed", true);
    await db.setSetting("aiAcknowledged", true);
    const s = await db.getSettings();
    ctx.go(s.user ? { name: "credentials" } : { name: "onboarding" });
  });
  const no = h("button", { class: "btn btn-ghost btn-block", onclick: () => ctx.go({ name: "blocked" }) }, "Ich bin jünger als 18");

  const el = h(
    "section",
    { class: "panel narrow" },
    h("h1", {}, "Willkommen"),
    h("p", { class: "lead" }, "Ein Dating-Prototyp mit ausschließlich KI-generierten Profilen."),
    h(
      "div",
      { class: "notice" },
      h("strong", {}, "Wichtig: "),
      "Alle Dating-Profile, Fotos und Gespräche in dieser App werden von einer KI erzeugt. Hier gibt es keine echten Menschen, und niemand liest deine Nachrichten außer dem KI-Modell.",
    ),
    h(
      "div",
      { class: "notice" },
      h("strong", {}, "Nur für Erwachsene (18+). "),
      "Die folgende Bestätigung ist eine Selbstauskunft und keine verifizierte Altersprüfung.",
    ),
    h("label", { class: "check", for: "ai-ack" }, ack, h("span", {}, "Mir ist bewusst, dass alle Profile und Gespräche KI-generiert sind.")),
    h("div", { class: "stack" }, yes, no),
  );
  return { el };
}

export function blockedView(): Mounted {
  return {
    el: h(
      "section",
      { class: "panel narrow" },
      h("h1", {}, "Kein Zugang"),
      h("p", {}, "Diese App richtet sich ausschließlich an Erwachsene ab 18 Jahren."),
    ),
  };
}

// ---------------------------------------------------------------------------
// Eigenes Profil

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h("div", { class: "field" }, h("label", {}, h("span", { class: "label" }, label), input), hint ? h("small", { class: "hint" }, hint) : null);
}

function radioGroup<T extends string>(name: string, options: readonly T[], labels: Record<T, string>, selected?: T): HTMLElement {
  return h(
    "div",
    { class: "choices", role: "radiogroup" },
    options.map((o) =>
      h("label", { class: "choice" }, h("input", { type: "radio", name, value: o, checked: o === selected }), h("span", {}, labels[o])),
    ),
  );
}

function checkGroup<T extends string>(name: string, options: readonly T[], labels: Record<T, string>, selected: readonly T[]): HTMLElement {
  return h(
    "div",
    { class: "choices" },
    options.map((o) =>
      h("label", { class: "choice" }, h("input", { type: "checkbox", name, value: o, checked: selected.includes(o) }), h("span", {}, labels[o])),
    ),
  );
}

export function profileFormView(ctx: Ctx, opts: { existing?: UserProfile; next: View; title: string; submitLabel: string }): Mounted {
  const u = opts.existing;
  const name = h("input", { type: "text", maxlength: 40, value: u?.name ?? "", autocomplete: "nickname" });
  const age = h("input", { type: "number", min: MIN_AGE, max: 99, inputmode: "numeric", value: u?.age ?? "" });
  const ageMin = h("input", { type: "number", min: MIN_AGE, max: 99, inputmode: "numeric", value: u?.ageMin ?? MIN_AGE });
  const ageMax = h("input", { type: "number", min: MIN_AGE, max: 99, inputmode: "numeric", value: u?.ageMax ?? 30 });
  const interests = h("input", { type: "text", maxlength: 300, value: u?.interests.join(", ") ?? "", placeholder: "z. B. Bouldern, Kochen, Indie-Konzerte" });
  const bio = h("textarea", { maxlength: 500, rows: 4, placeholder: "Ein paar Sätze über dich" }, u?.bio ?? "");
  const error = h("p", { class: "form-error", role: "alert" });

  const genderGroup = radioGroup("gender", GENDERS, GENDER_LABEL, u?.gender);
  const lookingGroup = checkGroup("lookingFor", GENDERS, GENDER_LABEL, u?.lookingFor ?? []);
  const intentGroup = radioGroup("intent", INTENTS, INTENT_LABEL, u?.intent);

  const submit = h("button", { class: "btn btn-primary btn-block" }, opts.submitLabel);
  submit.addEventListener("click", async () => {
    const checked = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value);
    const raw = {
      name: name.value,
      age: Number(age.value),
      gender: checked(genderGroup)[0],
      lookingFor: checked(lookingGroup),
      ageMin: Number(ageMin.value),
      ageMax: Number(ageMax.value),
      interests: interests.value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
      bio: bio.value,
      intent: checked(intentGroup)[0],
    };
    try {
      const profile = validateUserProfile(raw);
      await db.setSetting("user", profile);
      engine.setUser(profile);
      ctx.go(opts.next);
    } catch (err) {
      error.textContent = err instanceof ValidationError ? friendlyValidation(err) : "Bitte Eingaben prüfen.";
    }
  });

  const el = h(
    "section",
    { class: "panel narrow" },
    h("h1", {}, opts.title),
    field("Anzeigename", name),
    field("Alter", age, "Mindestens 18."),
    h("fieldset", {}, h("legend", {}, "Ich bin"), genderGroup),
    h("fieldset", {}, h("legend", {}, "Ich interessiere mich für"), lookingGroup),
    h("fieldset", {}, h("legend", {}, "Altersspanne"), h("div", { class: "row" }, field("von", ageMin), field("bis", ageMax))),
    h("fieldset", {}, h("legend", {}, "Ich suche"), intentGroup),
    field("Interessen", interests, "Mit Kommas trennen."),
    field("Über mich", bio),
    error,
    submit,
  );
  return { el };
}

const FIELD_NAMES: Record<string, string> = {
  "user.name": "Anzeigename",
  "user.age": "Alter",
  "user.gender": "Geschlecht",
  "user.lookingFor": "Gesuchte Geschlechter",
  "user.ageMin": "Altersspanne (von)",
  "user.ageMax": "Altersspanne (bis)",
  "user.interests": "Interessen",
  "user.bio": "Über mich",
  "user.intent": "Dating-Absicht",
};

function friendlyValidation(err: ValidationError): string {
  const key = Object.keys(FIELD_NAMES).find((k) => err.path === k || err.path.startsWith(`${k}[`));
  return `${key ? FIELD_NAMES[key] : err.path}: ${err.reason}.`;
}

// ---------------------------------------------------------------------------
// Zugangsdaten (nur im Arbeitsspeicher)

export function credentialsView(ctx: Ctx, returnTo: View, savedAccountId: string | undefined, hasProfile: boolean): Mounted {
  // Bewusst KEIN <form>: verhindert, dass Passwortmanager Tokens speichern wollen.
  const accountId = h("input", {
    type: "text",
    value: savedAccountId ?? "",
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    maxlength: 32,
    placeholder: "32 Zeichen, z. B. 0123abcd…",
  });
  const tokenAttrs = { type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "data-lpignore": "true", "data-1p-ignore": "true" };
  const imageToken = h("input", { ...tokenAttrs, placeholder: "API-Token" });
  const textToken = h("input", { ...tokenAttrs, placeholder: "leer = Bild-Token verwenden" });
  const error = h("p", { class: "form-error", role: "alert" });

  const save = h("button", { class: "btn btn-primary btn-block" }, "Übernehmen und starten");
  save.addEventListener("click", async () => {
    const acc = accountId.value.trim().toLowerCase();
    const img = imageToken.value.trim();
    const txt = textToken.value.trim();
    if (!isPlausibleAccountId(acc)) {
      error.textContent = "Die Account-ID besteht aus 32 Zeichen (0–9, a–f).";
      return;
    }
    if (!isPlausibleToken(img)) {
      error.textContent = "Der Bild-Token fehlt oder enthält ungültige Zeichen (z. B. Leerzeichen).";
      return;
    }
    if (txt !== "" && !isPlausibleToken(txt)) {
      error.textContent = "Der Text-Token enthält ungültige Zeichen.";
      return;
    }
    const creds: Credentials = txt ? { accountId: acc, imageToken: img, textToken: txt } : { accountId: acc, imageToken: img };
    setCredentials(creds);
    // Eingabefelder sofort leeren; die Werte leben nur noch in der Modul-Variablen.
    imageToken.value = "";
    textToken.value = "";
    await db.setSetting("accountId", acc);
    engine.resume();
    ctx.go(returnTo);
  });

  const skip = hasProfile
    ? h(
        "button",
        {
          class: "btn btn-ghost btn-block",
          onclick: () => ctx.go(returnTo),
        },
        hasCredentials() ? "Abbrechen" : "Ohne Zugangsdaten fortfahren (nur Gespeichertes ansehen)",
      )
    : null;

  const forget = hasCredentials()
    ? h(
        "button",
        {
          class: "btn btn-ghost btn-block",
          onclick: () => {
            clearCredentials();
            ctx.toast("Zugangsdaten aus dem Arbeitsspeicher entfernt.");
            ctx.go(returnTo);
          },
        },
        "Zugangsdaten aus dem Speicher entfernen",
      )
    : null;

  const el = h(
    "section",
    { class: "panel narrow" },
    h("h1", {}, "Cloudflare-Zugang"),
    h(
      "p",
      {},
      "Profile, Bilder und Chats werden mit Cloudflare Workers AI über dein eigenes Cloudflare-Konto erzeugt. Ein Cloudflare-Login oder ein App-Konto ist nicht nötig – nur diese Angaben:",
    ),
    h(
      "details",
      { class: "help" },
      h("summary", {}, "Wo finde ich das?"),
      h(
        "ul",
        {},
        h(
          "li",
          {},
          h("strong", {}, "Account-ID: "),
          "Im Cloudflare-Dashboard auf der Startseite deines Kontos (bzw. unter „Workers & Pages“) im Bereich „Account-Details“/„API“. Sie ist Teil der API-Adresse (…/accounts/",
          h("em", {}, "Account-ID"),
          "/ai/run/…) und muss zum Token gehören.",
        ),
        h(
          "li",
          {},
          h("strong", {}, "API-Token: "),
          "Unter „Mein Profil → API-Tokens → Token erstellen“, z. B. mit der Vorlage „Workers AI“. Nötig ist die Kontoberechtigung „Workers AI“ (Lesen und Bearbeiten) für genau dieses Konto.",
        ),
        h("li", {}, "Optional kannst du einen getrennten Token für Text verwenden. Bleibt das Feld leer, wird der Bild-Token auch für Text genutzt."),
      ),
    ),
    field("Account-ID", accountId),
    field("API-Token (Bildgenerierung)", imageToken),
    field("API-Token für Text (optional)", textToken),
    h(
      "div",
      { class: "notice small" },
      h("strong", {}, "Datenschutz: "),
      "Tokens bleiben nur im Arbeitsspeicher dieser geöffneten Seite und werden pro Anfrage an den App-Server (Worker) übergeben, der damit ausschließlich api.cloudflare.com aufruft. Sie werden nicht gespeichert – nach dem Neuladen gibst du sie erneut ein. Die Account-ID wird lokal gemerkt.",
    ),
    h(
      "div",
      { class: "notice small" },
      h("strong", {}, "Kosten: "),
      "Workers AI hat ein kostenloses Tageskontingent, das für das gesamte Konto gilt (laut Cloudflare derzeit 10.000 Neurons pro Tag; bitte aktuelle Preise prüfen). Bilder verbrauchen deutlich mehr als Text. Mit einem bestehenden Bezahltarif (Workers Paid) kann Nutzung über das Kontingent hinaus Kosten verursachen. Die App aktiviert keine Tarife und erzeugt Profile nur bei Bedarf (höchstens drei im Voraus).",
    ),
    error,
    h("div", { class: "stack" }, save, skip, forget),
  );
  return { el };
}
