// Profil-Editor („Realität umschreiben“): mehrere Bereiche mit direkten Vorgaben, freier
// Anweisung an die KI, Überraschung und Verlauf. Gesetzte Vorgaben sind verbindlich.

import { WRITING_HABITS } from "../../shared/casting";
import { affectsPhoto, countEdits } from "../../shared/edits";
import { describeError } from "../../shared/errors";
import { ValidationError, validateEdits } from "../../shared/schema";
import {
  ATTRACTIVENESS,
  EMOJI_USES,
  GENDERS,
  GENDER_LABEL,
  INTENTS,
  INTENT_LABEL,
  REPLY_LENGTHS,
  RESPONSIVENESS,
  TEMPERAMENTS,
  type Character,
  type CharacterEdits,
  type Lifestyle,
} from "../../shared/types";
import { toErrorInfo } from "../api";
import { hasCredentials } from "../credentials";
import { clear, h } from "../dom";
import { engine } from "../engine";
import { spinner, timeLabel, type Ctx } from "./common";

// Hinweise, die eine Figur minderjährig machen würden. Der Worker begrenzt das Alter zusätzlich hart.
const MINOR_HINT = /\b(1[0-7]|[1-9])\s*(jahre|jährig|j\.)|\bminderjährig|\bteenager\b|\bteen\b/i;

type Preset = readonly [label: string, value: string];

const HAIR: Preset[] = [
  ["Lange blonde Haare", "long blonde hair"],
  ["Lange dunkle Haare", "long dark brown hair"],
  ["Kurze rote Haare", "short red hair"],
  ["Schwarze Locken", "black curly hair"],
  ["Brauner Bob", "brown bob haircut"],
  ["Pixie-Cut", "short pixie cut"],
  ["Undercut", "undercut hairstyle"],
  ["Buzz Cut", "buzz cut"],
  ["Pastellfarben", "dyed pastel pink hair"],
  ["Man Bun", "man bun"],
  ["Mit Vollbart", "short hair and a full beard"],
  ["Afro", "natural afro hair"],
];
const BODY: Preset[] = [
  ["Schlank", "slim build"],
  ["Durchschnittlich", "average build"],
  ["Sportlich", "athletic build"],
  ["Muskulös", "muscular build"],
  ["Kurvig", "curvy build"],
  ["Kräftig", "stocky build"],
  ["Mollig", "plus-size build"],
  ["Groß & schlaksig", "tall and lanky build"],
];
const OUTFIT: Preset[] = [
  ["Hoodie & Jeans", "hoodie and jeans"],
  ["Elegant", "elegant evening outfit"],
  ["Business", "business casual blazer"],
  ["Sportlich", "sportswear"],
  ["Streetwear", "streetwear with sneakers"],
  ["Vintage", "vintage thrift-store outfit"],
  ["Outdoor", "outdoor jacket and hiking gear"],
  ["Festival", "colorful festival outfit"],
];
const SETTING: Preset[] = [
  ["Café", "in a café by the window holding a cappuccino"],
  ["Strand", "at a windy beach in casual clothes"],
  ["Wandern", "on a forest hiking trail with a backpack"],
  ["Party", "at a friend's birthday party indoors, warm lighting"],
  ["Spiegel-Selfie", "mirror selfie in a small apartment hallway"],
  ["Konzert", "at an open-air concert in daylight"],
  ["Dachterrasse", "at a rooftop terrace with a city view"],
  ["Küche", "in a kitchen cooking pasta"],
  ["Park", "in a park on a picnic blanket"],
  ["Bibliothek", "in a university library"],
  ["Mit Hund", "in a park with a dog on a leash"],
  ["Winter", "at a Christmas market in winter clothes"],
];
const PHOTO_STYLE: Preset[] = [
  ["Selfie", "front camera selfie, slightly off-center framing"],
  ["Von Freund:in", "casual photo taken by a friend"],
  ["Hochwertig", "well-lit, well-composed portrait"],
  ["Abendlicht", "photo with warm evening light"],
  ["Körnig", "slightly grainy smartphone photo"],
];
const HUMOR: Preset[] = [
  ["Trocken", "Trockener Humor, sagt lustige Dinge mit ernstem Gesicht."],
  ["Albern", "Albern und verspielt, lacht gern über sich selbst."],
  ["Sarkastisch", "Sarkastisch, manchmal etwas spitz."],
  ["Selbstironisch", "Selbstironisch und entwaffnend ehrlich."],
  ["Wortspiele", "Liebt Wortspiele und schlechte Witze."],
  ["Eher ernst", "Eher ernst, Humor zeigt sich erst mit der Zeit."],
];
const WRITING: Preset[] = WRITING_HABITS.map((w) => [w.charAt(0).toUpperCase() + w.slice(1), w] as const);
const IDEAS = [
  "Hat gerade einen neuen Job angefangen.",
  "Ist vor kurzem in eine andere Stadt gezogen.",
  "Hat ein neues Hobby entdeckt und redet ständig davon.",
  "Kommt frisch aus einer Trennung.",
  "Ist gerade von einer langen Reise zurück.",
  "Hat sich einen komplett neuen Look zugelegt.",
  "Ist deutlich selbstbewusster geworden.",
  "Ist schüchterner und nachdenklicher geworden.",
  "Hat einen Hund adoptiert.",
  "Gründet gerade ein kleines eigenes Business.",
];
const LIFESTYLE_OPTIONS: Preset[] = [
  ["Influencer:in", "influencer"],
  ["Creator (Abo-Plattform)", "onlyfans"],
  ["Statusorientiert", "status"],
];
const TEMPERAMENT_LABEL = { introvertiert: "Introvertiert", ambivertiert: "Mal so, mal so", extrovertiert: "Extrovertiert" } as const;
const ATTR_LABEL = { unauffällig: "Unauffällig", durchschnittlich: "Durchschnittlich", attraktiv: "Attraktiv", "sehr attraktiv": "Sehr attraktiv" } as const;
const LENGTH_LABEL = { kurz: "Kurz", mittel: "Mittel", lang: "Ausführlich" } as const;
const EMOJI_LABEL = { nie: "Nie", selten: "Selten", oft: "Oft" } as const;
const TEMPO_LABEL = { schnell: "Schnell", mittel: "Normal", langsam: "Langsam" } as const;

export function pencilButton(ctx: Ctx, c: Character, extraClass = ""): HTMLElement {
  return h(
    "button",
    {
      class: `edit-btn ${extraClass}`.trim(),
      "aria-label": `Realität von ${c.spec.name} umschreiben`,
      title: "Profil bearbeiten",
      onclick: (ev: Event) => {
        ev.stopPropagation();
        openEditor(ctx, c);
      },
    },
    "✎",
  );
}

// ---------------------------------------------------------------------------
// Entwurf: nur Felder, die sich vom Original unterscheiden

type Path = string; // z. B. "name" oder "looks.hairHint"

class Draft {
  readonly edits: Record<string, unknown> = {};
  constructor(private readonly onChange: () => void) {}

  set(path: Path, value: unknown, original: unknown): void {
    const [a, b] = path.split(".") as [string, string | undefined];
    const same = JSON.stringify(value) === JSON.stringify(original);
    if (b === undefined) {
      if (same) delete this.edits[a];
      else this.edits[a] = value;
    } else {
      const group = (this.edits[a] ?? {}) as Record<string, unknown>;
      if (same) delete group[b];
      else group[b] = value;
      if (Object.keys(group).length === 0) delete this.edits[a];
      else this.edits[a] = group;
    }
    this.onChange();
  }

  get result(): CharacterEdits {
    return JSON.parse(JSON.stringify(this.edits)) as CharacterEdits;
  }
}

// ---------------------------------------------------------------------------
// Bausteine

function section(title: string, ...children: (HTMLElement | null)[]): HTMLElement {
  return h("div", { class: "ed-field" }, h("div", { class: "label" }, title), ...children.filter((c): c is HTMLElement => c !== null));
}

function textControl(
  draft: Draft,
  label: string,
  path: Path,
  original: string,
  opts: { max: number; multiline?: boolean; presets?: Preset[]; hint?: string } = { max: 120 },
): HTMLElement {
  const input = opts.multiline
    ? h("textarea", { rows: 4, maxlength: opts.max, "aria-label": label }, original)
    : h("input", { type: "text", maxlength: opts.max, value: original, "aria-label": label });
  const update = () => {
    const v = input.value.trim();
    draft.set(path, v === "" ? original : v, original);
  };
  input.addEventListener("input", update);
  const chips = opts.presets
    ? h(
        "div",
        { class: "chips" },
        opts.presets.map(([l, v]) =>
          h(
            "button",
            {
              class: "chip chip-btn",
              type: "button",
              onclick: () => {
                input.value = v;
                update();
              },
            },
            l,
          ),
        ),
      )
    : null;
  return section(label, chips, input, opts.hint ? h("small", { class: "hint" }, opts.hint) : null);
}

function choiceControl<T extends string>(draft: Draft, label: string, path: Path, options: readonly T[], labels: Record<T, string>, original: T): HTMLElement {
  let current = original;
  const buttons = options.map((o) => {
    const b = h("button", { class: "seg", type: "button", "aria-pressed": String(o === original) }, labels[o]);
    b.addEventListener("click", () => {
      current = o;
      for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
      draft.set(path, current, original);
    });
    return b;
  });
  return section(label, h("div", { class: "segments", role: "group", "aria-label": label }, buttons));
}

function multiControl(draft: Draft, label: string, path: Path, options: Preset[], original: readonly string[], min: number): HTMLElement {
  const selected = new Set(original);
  const note = h("small", { class: "hint" });
  const buttons = options.map(([l, v]) => {
    const b = h("button", { class: "seg", type: "button", "aria-pressed": String(selected.has(v)) }, l);
    b.addEventListener("click", () => {
      if (selected.has(v)) {
        if (selected.size <= min) {
          note.textContent = "Mindestens eine Auswahl ist nötig.";
          return;
        }
        selected.delete(v);
      } else selected.add(v);
      note.textContent = "";
      b.setAttribute("aria-pressed", String(selected.has(v)));
      // Reihenfolge stabil halten, damit „unverändert“ korrekt erkannt wird.
      const value = options.map(([, x]) => x).filter((x) => selected.has(x));
      const orig = options.map(([, x]) => x).filter((x) => original.includes(x));
      draft.set(path, value, orig);
    });
    return b;
  });
  return section(label, h("div", { class: "segments wrap" }, buttons), note);
}

function tagControl(draft: Draft, label: string, path: Path, original: readonly string[], min: number, max: number, maxLen: number): HTMLElement {
  const tags = [...original];
  const list = h("div", { class: "chips" });
  const note = h("small", { class: "hint" }, `${min} bis ${max}.`);
  const input = h("input", { type: "text", maxlength: maxLen, placeholder: "Neu hinzufügen …", "aria-label": `${label} hinzufügen` });
  const render = () => {
    clear(list);
    for (const [i, t] of tags.entries()) {
      list.append(
        h(
          "span",
          { class: "chip" },
          t,
          h(
            "button",
            {
              class: "chip-x",
              type: "button",
              "aria-label": `${t} entfernen`,
              onclick: () => {
                if (tags.length <= min) {
                  note.textContent = `Mindestens ${min}.`;
                  return;
                }
                tags.splice(i, 1);
                render();
                draft.set(path, [...tags], original);
              },
            },
            "×",
          ),
        ),
      );
    }
  };
  const add = () => {
    const v = input.value.trim();
    if (!v || tags.length >= max || tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    tags.push(v);
    note.textContent = `${min} bis ${max}.`;
    input.value = "";
    render();
    draft.set(path, [...tags], original);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  });
  render();
  return section(
    label,
    list,
    h("div", { class: "row-inline" }, input, h("button", { class: "btn btn-small", type: "button", onclick: add }, "+")),
    note,
  );
}

function sliderControl(draft: Draft, label: string, path: Path, original: number, left: string, right: string): HTMLElement {
  const input = h("input", { type: "range", min: 0, max: 100, step: 5, value: Math.round(original * 100), "aria-label": label });
  input.addEventListener("input", () => draft.set(path, Number(input.value) / 100, Math.round(original * 100) / 100));
  return section(label, input, h("div", { class: "range-labels" }, h("span", {}, left), h("span", {}, right)));
}

function ageControl(draft: Draft, original: number): HTMLElement {
  const out = h("strong", {}, String(original));
  const input = h("input", { type: "range", min: 18, max: 40, step: 1, value: original, "aria-label": "Alter" });
  input.addEventListener("input", () => {
    out.textContent = input.value;
    draft.set("age", Number(input.value), original);
  });
  return section("Alter", h("div", { class: "row-inline" }, input, out), h("small", { class: "hint" }, "Alle Figuren sind mindestens 18."));
}

function toggleControl(draft: Draft, label: string, path: Path, original: boolean): HTMLElement {
  const input = h("input", { type: "checkbox", checked: original });
  input.addEventListener("change", () => draft.set(path, input.checked, original));
  return h("label", { class: "check" }, input, h("span", {}, label));
}

// ---------------------------------------------------------------------------
// Editor

export function openEditor(ctx: Ctx, c: Character): void {
  const { spec, profile } = c;
  let photoTouched = false;
  let surprise = false;

  const counter = h("span", { class: "ed-count" });
  const error = h("p", { class: "form-error", role: "alert" });
  const status = h("div", { class: "editor-status" });
  const harmonize = h("input", { type: "checkbox", checked: true });
  const newPhoto = h("input", { type: "checkbox", checked: false });
  newPhoto.addEventListener("change", () => {
    photoTouched = true;
    refresh();
  });
  harmonize.addEventListener("change", () => refresh());

  const instruction = h("textarea", {
    rows: 3,
    maxlength: 600,
    placeholder: "z. B. „Sie hat gerade ihren Job gekündigt und zieht nach Hamburg.“",
    "aria-label": "Was soll passieren?",
  });
  instruction.addEventListener("input", () => refresh());
  const literal = h("input", { type: "checkbox" });

  const save = h("button", { class: "btn btn-primary" }, "Speichern");
  const cancel = h("button", { class: "btn btn-ghost" }, "Abbrechen");

  const draft = new Draft(() => refresh());

  function wantsAi(): boolean {
    return harmonize.checked || instruction.value.trim() !== "" || surprise;
  }

  function refresh() {
    error.textContent = "";
    const edits = draft.result;
    const n = countEdits(edits);
    const extras = [instruction.value.trim() ? "Anweisung" : "", surprise ? "Überraschung" : ""].filter(Boolean);
    counter.textContent =
      n === 0 && extras.length === 0
        ? "Noch keine Änderung"
        : `${n} Änderung${n === 1 ? "" : "en"}${extras.length ? ` + ${extras.join(" + ")}` : ""}${wantsAi() ? " · mit KI" : " · ohne KI"}`;
    if (!photoTouched) newPhoto.checked = affectsPhoto(edits) || surprise || instruction.value.trim() !== "";
    save.disabled = n === 0 && extras.length === 0 && !newPhoto.checked;
  }

  // --- Bereiche ---
  const surpriseBtn = h("button", { class: "btn btn-block surprise", type: "button", "aria-pressed": "false" }, "🎲 Überrasch mich");
  surpriseBtn.addEventListener("click", () => {
    surprise = !surprise;
    surpriseBtn.setAttribute("aria-pressed", String(surprise));
    surpriseBtn.textContent = surprise ? "🎲 Überraschung aktiv – die KI denkt sich eine Wendung aus" : "🎲 Überrasch mich";
    refresh();
  });
  const story = h(
    "div",
    {},
    textControl(draft, "Beschreibung (Bio)", "bio", profile.bio, { max: 500, multiline: true }),
    h("label", { class: "check" }, literal, h("span", {}, "Bio wörtlich übernehmen (sonst formuliert die KI sie im Stil der Figur)")),
    section(
      "Was soll in ihrem/seinem Leben passieren?",
      instruction,
      h(
        "div",
        { class: "chips" },
        IDEAS.map((idea) =>
          h(
            "button",
            {
              class: "chip chip-btn",
              type: "button",
              onclick: () => {
                instruction.value = `${instruction.value.trim()} ${idea}`.trim().slice(0, 600);
                refresh();
              },
            },
            idea.replace(/\.$/, ""),
          ),
        ),
      ),
    ),
    surpriseBtn,
  );

  const basics = h(
    "div",
    {},
    textControl(draft, "Name", "name", spec.name, { max: 40 }),
    ageControl(draft, spec.age),
    textControl(draft, "Wohnort", "city", spec.city, { max: 60, hint: "Am besten ein erfundener Ort." }),
    textControl(draft, "Beruf / Studium", "occupation", profile.occupation, { max: 100 }),
    choiceControl(draft, "Geschlecht", "gender", GENDERS, GENDER_LABEL, spec.gender),
    multiControl(draft, "Interessiert an", "lookingFor", GENDERS.map((g) => [GENDER_LABEL[g], g] as const), spec.lookingFor, 1),
    choiceControl(draft, "Sucht", "intent", INTENTS, INTENT_LABEL, spec.intent),
    tagControl(draft, "Interessen", "interests", profile.interests, 3, 8, 40),
    tagControl(draft, "Werte", "values", profile.values, 1, 6, 60),
  );

  const photoOnly = h("button", { class: "btn btn-block", type: "button" }, "📷 Nur neues Foto (gleiche Person, neues Bild)");
  const looks = h(
    "div",
    {},
    h("p", { class: "small muted" }, "Vorlagen antippen oder selbst beschreiben. Englische Begriffe setzt das Bildmodell am zuverlässigsten um."),
    textControl(draft, "Frisur & Haare", "looks.hairHint", spec.looks.hairHint, { max: 120, presets: HAIR }),
    textControl(draft, "Körperbau", "looks.bodyType", spec.looks.bodyType, { max: 80, presets: BODY }),
    choiceControl(draft, "Ausstrahlung", "looks.attractiveness", ATTRACTIVENESS, ATTR_LABEL, spec.looks.attractiveness),
    toggleControl(draft, "Trägt Brille", "looks.glasses", spec.looks.glasses),
    textControl(draft, "Outfit", "looks.outfit", profile.photo.outfit, { max: 160, presets: OUTFIT }),
    textControl(draft, "Foto-Szene", "looks.setting", spec.looks.setting, { max: 200, presets: SETTING }),
    textControl(draft, "Fotostil", "looks.photoStyle", spec.looks.photoStyle, { max: 200, presets: PHOTO_STYLE }),
    photoOnly,
  );

  const personality = h(
    "div",
    {},
    choiceControl(draft, "Temperament", "temperament", TEMPERAMENTS, TEMPERAMENT_LABEL, spec.temperament),
    tagControl(draft, "Charakterzüge", "traits", profile.traits, 2, 6, 40),
    textControl(draft, "Humor", "humor", profile.humor, { max: 200, presets: HUMOR }),
    sliderControl(draft, "Wärme", "style.warmth", spec.style.warmth, "kühl", "herzlich"),
    sliderControl(draft, "Wählerischkeit", "style.pickiness", spec.style.pickiness, "offen", "sehr wählerisch"),
    sliderControl(draft, "Initiative", "style.initiative", spec.style.initiative, "wartet ab", "schreibt zuerst"),
    h("p", { class: "small muted" }, "Wählerischkeit wirkt nur auf künftige Entscheidungen; gespeicherte Match-Entscheidungen bleiben."),
  );

  const chatStyle = h(
    "div",
    {},
    choiceControl(draft, "Antwortlänge", "style.replyLength", REPLY_LENGTHS, LENGTH_LABEL, spec.style.replyLength),
    choiceControl(draft, "Emojis", "style.emoji", EMOJI_USES, EMOJI_LABEL, spec.style.emoji),
    choiceControl(draft, "Antworttempo", "style.responsiveness", RESPONSIVENESS, TEMPO_LABEL, spec.style.responsiveness),
    textControl(draft, "Schreibstil", "style.writing", spec.style.writing, { max: 160, presets: WRITING }),
  );

  const lifestyle = h(
    "div",
    {},
    multiControl(draft, "Besondere Lebensumstände", "lifestyle", LIFESTYLE_OPTIONS, spec.lifestyle as Lifestyle[], 0),
    h("p", { class: "small muted" }, "Diese Merkmale ergänzen die Person, ersetzen aber nicht ihre Persönlichkeit. Inhalte bleiben immer nicht-explizit."),
  );

  const historyBox = h("div", {}, spinner("Verlauf wird geladen …"));

  const tabs: [string, HTMLElement][] = [
    ["Story", story],
    ["Basis", basics],
    ["Aussehen", looks],
    ["Persönlichkeit", personality],
    ["Chat-Stil", chatStyle],
    ["Lebensstil", lifestyle],
    ["Verlauf", historyBox],
  ];
  const panels = h("div", { class: "ed-panels" });
  const tabButtons = tabs.map(([name, panel], i) => {
    panel.hidden = i !== 0;
    panel.setAttribute("role", "tabpanel");
    panels.append(panel);
    const b = h("button", { class: "ed-tab", role: "tab", type: "button", "aria-selected": String(i === 0) }, name);
    b.addEventListener("click", () => {
      tabs.forEach(([, p], j) => (p.hidden = j !== i));
      tabButtons.forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      panels.scrollTop = 0;
    });
    return b;
  });

  const box = h(
    "div",
    { class: "editor" },
    h("div", { class: "ed-head" }, h("h2", {}, `Realität von ${spec.name} umschreiben`), h("div", { class: "ed-tabs", role: "tablist" }, tabButtons)),
    panels,
    h(
      "div",
      { class: "ed-foot" },
      h("label", { class: "check compact" }, harmonize, h("span", {}, "KI passt den Rest stimmig an")),
      h("label", { class: "check compact" }, newPhoto, h("span", {}, "Neues Foto erzeugen")),
      counter,
      error,
      status,
      h("div", { class: "ed-actions" }, cancel, save),
    ),
  );
  const close = ctx.modal(box);
  cancel.addEventListener("click", () => close());

  async function submit(photoOnlyMode: boolean) {
    const edits = photoOnlyMode ? {} : draft.result;
    const instr = photoOnlyMode ? "" : instruction.value.trim();
    const texts = [instr, edits.bio ?? "", edits.name ?? "", edits.occupation ?? ""].join(" ");
    if (MINOR_HINT.test(texts)) {
      error.textContent = "Alle Figuren in dieser App sind mindestens 18 Jahre alt.";
      return;
    }
    try {
      validateEdits(edits);
    } catch (err) {
      error.textContent = err instanceof ValidationError ? `Bitte prüfen: ${err.path.replace("edits.", "")} – ${err.reason}.` : "Bitte Eingaben prüfen.";
      return;
    }
    if (literal.checked && edits.bio !== undefined && edits.bio.length < 20) {
      error.textContent = "Für die wörtliche Übernahme braucht die Bio mindestens 20 Zeichen.";
      return;
    }
    const useAi = !photoOnlyMode && wantsAi();
    if ((useAi || photoOnlyMode || newPhoto.checked) && !hasCredentials()) {
      error.textContent = "Dafür werden deine Cloudflare-Zugangsdaten benötigt (Profil → Zugangsdaten). Ohne KI und ohne neues Foto geht es auch so.";
      return;
    }
    for (const b of [save, cancel, photoOnly]) b.disabled = true;
    status.append(spinner(useAi ? "Die KI schreibt die Realität um …" : "Wird gespeichert …"));
    try {
      const summary = await engine.editCharacter(c.id, {
        edits,
        instruction: instr,
        literalBio: literal.checked,
        surprise: !photoOnlyMode && surprise,
        harmonize: useAi,
        newPhoto: photoOnlyMode || newPhoto.checked,
      });
      close();
      ctx.toast(`${summary}${photoOnlyMode || newPhoto.checked ? " Neues Foto wird erzeugt …" : ""}`);
    } catch (err) {
      error.textContent = describeError(toErrorInfo(err));
      status.textContent = "";
      for (const b of [save, cancel, photoOnly]) b.disabled = false;
    }
  }

  save.addEventListener("click", () => void submit(false));
  photoOnly.addEventListener("click", () => void submit(true));

  // Verlauf laden
  void engine.history(c.id).then((entries) => {
    clear(historyBox);
    if (entries.length === 0) {
      historyBox.append(h("p", { class: "muted" }, "Noch keine früheren Versionen. Nach dem ersten Umschreiben kannst du hier zurückspringen."));
      return;
    }
    historyBox.append(h("p", { class: "small muted" }, "Frühere Versionen dieser Person. Wiederherstellen legt sie als neue Version an – nichts geht verloren."));
    const list = h("ul", { class: "list" });
    for (const e of entries) {
      const thumb = h("div", { class: "avatar avatar-s", "aria-hidden": "true" }, e.character.spec.name.slice(0, 1));
      if (e.image) {
        const url = URL.createObjectURL(e.image);
        thumb.textContent = "";
        thumb.append(h("img", { src: url, alt: "" }));
      }
      list.append(
        h(
          "li",
          {},
          h(
            "div",
            { class: "list-item static" },
            thumb,
            h(
              "span",
              { class: "list-text" },
              h("span", { class: "list-title" }, `${e.character.spec.name}, ${e.character.spec.age}`),
              h("span", { class: "list-sub" }, `${e.character.profile.occupation} · ${timeLabel(e.savedAt)}`),
            ),
            h(
              "button",
              {
                class: "btn btn-small",
                type: "button",
                onclick: async () => {
                  if (e.id === undefined) return;
                  await engine.restoreVersion(c.id, e.id);
                  close();
                  ctx.toast(`Frühere Version von ${e.character.spec.name} wiederhergestellt.`);
                },
              },
              "Wiederherstellen",
            ),
          ),
        ),
      );
    }
    historyBox.append(list);
  });

  refresh();
}
