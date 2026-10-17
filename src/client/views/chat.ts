import { hasCredentials } from "../credentials";
import * as db from "../db";
import { clear, h } from "../dom";
import { engine } from "../engine";
import { aiBadge, avatar, timeLabel, type Ctx, type Mounted } from "./common";
import { profileDetails } from "./discover";
import { pencilButton } from "./editor";

export function chatView(ctx: Ctx, id: string): Mounted {
  const header = h("div", { class: "chat-header" });
  const profileBox = h("div", { class: "chat-profile", hidden: true });
  const list = h("div", { class: "messages", role: "log", "aria-live": "polite" });
  const status = h("div", { class: "chat-status" });
  const input = h("textarea", { rows: 1, maxlength: 1000, placeholder: "Nachricht schreiben …", "aria-label": "Nachricht" });
  const send = h("button", { class: "btn btn-primary send", "aria-label": "Senden" }, "Senden");
  const composer = h("div", { class: "composer" }, input, send);
  const el = h("section", { class: "chat" }, header, profileBox, list, status, composer);

  let renderedCount = -1;
  let headerStatus = "";

  async function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    autosize();
    await engine.sendMessage(id, text);
    input.focus();
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  });

  async function renderHeader() {
    const c = await db.getCharacter(id);
    const r = await db.getRelation(id);
    if (!c || !r) {
      ctx.go({ name: "matches" });
      return;
    }
    // Neu zeichnen bei Statuswechsel oder umgeschriebener Realität (neue Version, neues Foto).
    const sig = `${r.status}:${c.version ?? 0}:${r.imageVersion ?? 0}`;
    if (headerStatus === sig) return;
    headerStatus = sig;
    clear(header);
    header.append(
      h("button", { class: "btn btn-ghost back", "aria-label": "Zurück zu den Matches", onclick: () => ctx.go({ name: "matches" }) }, "‹"),
      avatar(c),
      h("div", { class: "chat-title" }, h("strong", {}, `${c.spec.name}, ${c.spec.age}`), aiBadge()),
      h(
        "button",
        {
          class: "btn btn-ghost btn-small",
          onclick: () => {
            profileBox.hidden = !profileBox.hidden;
          },
        },
        "Profil",
      ),
      r.status === "matched"
        ? h(
            "button",
            {
              class: "btn btn-ghost btn-small",
              onclick: async () => {
                if (confirm(`Match mit ${c.spec.name} wirklich auflösen?`)) await engine.unmatchByUser(id);
              },
            },
            "Auflösen",
          )
        : "",
    );
    clear(profileBox);
    profileBox.append(
      h("div", { class: "chat-profile-head" }, h("p", { class: "meta" }, `${c.profile.occupation} · ${c.spec.city}`), pencilButton(ctx, c)),
      profileDetails(c),
    );
  }

  async function render() {
    const c = await db.getCharacter(id);
    const r = await db.getRelation(id);
    if (!c || !r) return;
    const now = Date.now();
    const msgs = (await db.messagesFor(id)).filter((m) => m.at <= now);

    if (msgs.length !== renderedCount) {
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      clear(list);
      if (msgs.length === 0) list.append(h("p", { class: "muted center" }, `Ihr habt gematcht. Schreib ${c.spec.name} etwas – oder warte ab, ob ${c.spec.name} sich meldet.`));
      for (const m of msgs) {
        if (m.from === "system") {
          list.append(h("p", { class: "system-msg" }, m.text));
          continue;
        }
        list.append(h("div", { class: `bubble ${m.from === "user" ? "mine" : "theirs"}` }, h("span", {}, m.text), h("time", {}, timeLabel(m.at))));
      }
      if (nearBottom || renderedCount === -1 || msgs.at(-1)?.from === "user") list.scrollTop = list.scrollHeight;
      renderedCount = msgs.length;
    }

    clear(status);
    const ended = r.status !== "matched" || r.chatEnded;
    if (engine.typing.has(id)) {
      status.append(h("p", { class: "typing" }, `${c.spec.name} schreibt …`));
    } else if (!ended && engine.jobBlocked(r)) {
      status.append(
        h("p", { class: "error-text small" }, "Die Antwort konnte nicht erzeugt werden."),
        h("button", { class: "btn btn-small", onclick: () => void engine.retryJob(id) }, "Erneut versuchen"),
      );
    }
    if (!ended && !hasCredentials()) {
      status.append(
        h("p", { class: "small muted" }, "Ohne Zugangsdaten können keine Antworten erzeugt werden."),
        h("button", { class: "btn btn-small", onclick: () => ctx.go({ name: "credentials", returnTo: { name: "chat", id } }) }, "Zugangsdaten eingeben"),
      );
    }
    input.disabled = ended;
    send.disabled = ended;
    input.placeholder = ended ? "Dieser Chat ist beendet." : "Nachricht schreiben …";

    await engine.markRead(id);
  }

  void renderHeader().then(render);
  return {
    el,
    refresh: () => {
      void renderHeader().then(render);
    },
  };
}
