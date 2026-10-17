import { describeError } from "../../shared/errors";
import { INTENT_LABEL, type Character } from "../../shared/types";
import { hasCredentials } from "../credentials";
import { clear, h } from "../dom";
import { engine, type DeckEntry } from "../engine";
import { aiBadge, orientationLabel, spinner, type Ctx, type Mounted } from "./common";
import { pencilButton } from "./editor";

const SWIPE_THRESHOLD = 110;

export function profileDetails(c: Character): HTMLElement {
  const { spec, profile } = c;
  return h(
    "div",
    { class: "profile-details" },
    h("p", { class: "bio" }, profile.bio),
    h("div", { class: "chips" }, profile.interests.map((i) => h("span", { class: "chip" }, i))),
    h(
      "dl",
      { class: "facts" },
      h("dt", {}, "Sucht"),
      h("dd", {}, INTENT_LABEL[spec.intent]),
      h("dt", {}, "Orientierung"),
      h("dd", {}, orientationLabel(spec.gender, spec.lookingFor)),
      h("dt", {}, "Wohnort"),
      h("dd", {}, `${spec.city} (fiktiv)`),
    ),
  );
}

function imageArea(ctx: Ctx, c: Character): HTMLElement {
  const box = h("div", { class: "card-image" }, h("div", { class: "placeholder", "aria-hidden": "true" }, c.spec.name.slice(0, 1)));
  const status = h("div", { class: "image-status" });
  box.append(status, h("div", { class: "card-badge" }, aiBadge()), pencilButton(ctx, c, "on-image"));

  void engine.ensureImageUrl(c.id).then((url) => {
    if (url) {
      box.querySelector(".placeholder")?.remove();
      box.prepend(h("img", { src: url, alt: `KI-generiertes Profilfoto von ${c.spec.name}`, draggable: "false" }));
    }
    if (engine.isImageLoading(c.id)) {
      status.append(spinner(url ? "Neues Foto wird erzeugt …" : "Bild wird erzeugt …"));
      return;
    }
    const err = engine.imageErrors.get(c.id);
    if (url && !err) return;
    status.append(
      h("p", { class: "small" }, err ? `${url ? "Neues Foto" : "Bild"} fehlgeschlagen. ${err}` : "Noch kein Bild."),
      hasCredentials()
        ? h(
            "button",
            {
              class: "btn btn-small",
              onclick: (ev: Event) => {
                ev.stopPropagation();
                void engine.loadImage(c, true);
              },
            },
            "Bild erneut versuchen",
          )
        : "",
    );
  });
  return box;
}

function card(ctx: Ctx, entry: DeckEntry): HTMLElement {
  const c = entry.character;
  return h(
    "article",
    { class: "card", "aria-label": `Profil von ${c.spec.name}` },
    imageArea(ctx, c),
    h(
      "div",
      { class: "card-body" },
      h("h2", {}, `${c.spec.name}, ${c.spec.age}`),
      h("p", { class: "meta" }, `${c.profile.occupation} · ${c.spec.city}`),
      profileDetails(c),
    ),
  );
}

/** Wischgesten als Ergänzung zu den Buttons. */
function enableSwipe(el: HTMLElement, onDecide: (action: "like" | "pass") => void): void {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let active = false;
  let horizontal: boolean | null = null;

  el.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    active = true;
    horizontal = null;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
  });
  el.addEventListener("pointermove", (e) => {
    if (!active) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (horizontal === null && Math.abs(mx) + Math.abs(my) > 10) {
      horizontal = Math.abs(mx) > Math.abs(my);
      if (horizontal) el.setPointerCapture(e.pointerId);
    }
    if (!horizontal) return;
    dx = mx;
    el.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
    el.dataset.hint = dx > 40 ? "like" : dx < -40 ? "pass" : "";
  });
  const end = () => {
    if (!active) return;
    active = false;
    if (horizontal && Math.abs(dx) > SWIPE_THRESHOLD) {
      el.style.transition = "transform .2s ease-out";
      el.style.transform = `translateX(${dx > 0 ? 600 : -600}px) rotate(${dx / 10}deg)`;
      onDecide(dx > 0 ? "like" : "pass");
    } else {
      el.style.transition = "transform .2s ease";
      el.style.transform = "";
      el.dataset.hint = "";
      setTimeout(() => (el.style.transition = ""), 220);
    }
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

export function discoverView(ctx: Ctx): Mounted {
  const area = h("div", { class: "deck" });
  const el = h("section", { class: "discover" }, area);
  let busy = false;
  let lastSig = "";

  async function act(id: string, action: "like" | "pass") {
    if (busy) return;
    busy = true;
    try {
      await engine.swipe(id, action);
      if (action === "like") ctx.toast("Like gesendet.");
    } finally {
      busy = false;
      void render();
    }
  }

  async function render(): Promise<void> {
    const deck = await engine.deck();
    const top = deck[0];
    // Nur neu zeichnen, wenn sich etwas Sichtbares geändert hat (verhindert Flackern).
    const sig = JSON.stringify([
      top?.character.id,
      top?.character.version,
      top ? engine.isImageLoading(top.character.id) : null,
      top ? engine.imageErrors.get(top.character.id) : null,
      top?.relation.imageState,
      top?.relation.imageVersion,
      deck.length,
      engine.generating,
      engine.generationError?.message,
      engine.paused?.message,
      hasCredentials(),
    ]);
    if (sig === lastSig) return;
    lastSig = sig;
    clear(area);

    if (top) {
      const cardEl = card(ctx, top);
      enableSwipe(cardEl, (a) => void act(top.character.id, a));
      area.append(
        cardEl,
        h(
          "div",
          { class: "actions" },
          h("button", { class: "round round-pass", "aria-label": "Ablehnen", onclick: () => void act(top.character.id, "pass") }, "✕"),
          h("button", { class: "round round-like", "aria-label": "Liken", onclick: () => void act(top.character.id, "like") }, "♥"),
        ),
        h("p", { class: "small muted center" }, deckStatus(deck.length)),
      );
      return;
    }

    if (!hasCredentials()) {
      area.append(
        h(
          "div",
          { class: "empty" },
          h("p", {}, "Zum Erzeugen neuer Profile werden deine Cloudflare-Zugangsdaten benötigt."),
          h("button", { class: "btn btn-primary", onclick: () => ctx.go({ name: "credentials", returnTo: { name: "discover" } }) }, "Zugangsdaten eingeben"),
        ),
      );
      return;
    }
    if (engine.paused) {
      area.append(
        h(
          "div",
          { class: "empty" },
          h("p", { class: "error-text" }, describeError(engine.paused)),
          h("button", { class: "btn btn-primary", onclick: () => ctx.go({ name: "credentials", returnTo: { name: "discover" } }) }, "Zugangsdaten prüfen"),
          h("button", { class: "btn btn-ghost", onclick: () => engine.resume() }, "Erneut versuchen"),
        ),
      );
      return;
    }
    if (engine.generating) {
      area.append(h("div", { class: "empty" }, spinner("Neue Profile werden erzeugt … das dauert meist einige Sekunden.")));
      return;
    }
    if (engine.generationError) {
      area.append(
        h(
          "div",
          { class: "empty" },
          h("p", { class: "error-text" }, describeError(engine.generationError)),
          h("button", { class: "btn btn-primary", onclick: () => void engine.fillDeck() }, "Erneut versuchen"),
        ),
      );
      return;
    }
    area.append(
      h("div", { class: "empty" }, h("p", {}, "Gerade keine Profile vorrätig."), h("button", { class: "btn btn-primary", onclick: () => void engine.fillDeck() }, "Neue Profile erzeugen")),
    );
  }

  function deckStatus(n: number): string {
    if (engine.generating) return `${n} Profil${n === 1 ? "" : "e"} bereit · weitere werden erzeugt …`;
    return `${n} Profil${n === 1 ? "" : "e"} bereit`;
  }

  void render();
  void engine.fillDeck();
  return {
    el,
    refresh: () => {
      const card = area.querySelector<HTMLElement>(".card");
      if (card && card.style.transform) return; // während einer Wischgeste nicht stören
      void render();
    },
  };
}
