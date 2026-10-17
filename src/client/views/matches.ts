import type { Character } from "../../shared/types";
import { unreadCount } from "../chatlogic";
import * as db from "../db";
import { clear, h } from "../dom";
import { engine } from "../engine";
import type { Relation, StoredMessage } from "../model";
import { aiBadge, avatar, timeLabel, type Ctx, type Mounted } from "./common";

interface Row {
  c: Character;
  r: Relation;
  msgs: StoredMessage[];
}

async function loadRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const r of await db.allRelations()) {
    if (r.status === "unseen" || r.status === "passed") continue;
    const c = await db.getCharacter(r.id);
    if (c) rows.push({ c, r, msgs: await db.messagesFor(r.id) });
  }
  return rows;
}

export async function totalUnread(): Promise<number> {
  const now = Date.now();
  let n = 0;
  for (const r of await db.allRelations()) {
    if (r.status !== "matched" && r.status !== "unmatched") continue;
    n += unreadCount(r, await db.messagesFor(r.id), now);
  }
  return n;
}

function lastVisible(msgs: StoredMessage[], now: number): StoredMessage | undefined {
  return msgs.filter((m) => m.at <= now).at(-1);
}

export function matchesView(ctx: Ctx): Mounted {
  const el = h("section", { class: "panel" });

  async function render() {
    const rows = await loadRows();
    const now = Date.now();
    clear(el);

    const matched = rows.filter((x) => x.r.status === "matched").sort((a, b) => activity(b, now) - activity(a, now));
    const likes = rows.filter((x) => ["awaiting", "pending", "rejected"].includes(x.r.status)).sort((a, b) => (b.r.likedAt ?? 0) - (a.r.likedAt ?? 0));
    const ended = rows.filter((x) => x.r.status === "unmatched");

    el.append(h("h1", {}, "Matches"));
    if (matched.length === 0) {
      el.append(h("p", { class: "muted" }, "Noch keine Matches. Ein Like führt nur zu einem Match, wenn die Figur es erwidert."));
    } else {
      el.append(h("ul", { class: "list" }, matched.map((row) => matchItem(ctx, row, now))));
    }

    if (likes.length > 0) {
      el.append(h("h2", {}, "Gesendete Likes"), h("ul", { class: "list" }, likes.map((row) => likeItem(row))));
    }
    if (ended.length > 0) {
      el.append(h("h2", {}, "Beendet"), h("ul", { class: "list" }, ended.map((row) => matchItem(ctx, row, now))));
    }
  }

  void render();
  return { el, refresh: () => void render() };
}

function activity(row: Row, now: number): number {
  return lastVisible(row.msgs, now)?.at ?? row.r.matchedAt ?? 0;
}

function matchItem(ctx: Ctx, { c, r, msgs }: Row, now: number): HTMLElement {
  const last = lastVisible(msgs, now);
  const unread = unreadCount(r, msgs, now);
  const preview = engine.typing.has(c.id)
    ? `${c.spec.name} schreibt …`
    : last
      ? `${last.from === "user" ? "Du: " : ""}${last.text}`
      : "Neues Match – schreib etwas!";
  return h(
    "li",
    {},
    h(
      "button",
      { class: "list-item", onclick: () => ctx.go({ name: "chat", id: c.id }) },
      avatar(c),
      h(
        "span",
        { class: "list-text" },
        h("span", { class: "list-title" }, `${c.spec.name}, ${c.spec.age}`, " ", aiBadge()),
        h("span", { class: "list-sub" }, preview),
      ),
      h("span", { class: "list-side" }, last ? timeLabel(last.at) : "", unread > 0 ? h("span", { class: "badge", "aria-label": `${unread} ungelesen` }, String(unread)) : null),
    ),
  );
}

function likeItem({ c, r }: Row): HTMLElement {
  let status: string;
  let action: HTMLElement | null = null;
  if (r.status === "rejected") status = "Kein Match";
  else if (r.status === "pending") status = "Noch keine Rückmeldung";
  else if (engine.evaluating.has(c.id)) status = "Rückmeldung wird abgefragt …";
  else if (engine.jobBlocked(r)) {
    status = "Rückmeldung konnte nicht abgefragt werden";
    action = h("button", { class: "btn btn-small", onclick: () => void engine.retryJob(c.id) }, "Erneut versuchen");
  } else status = "Noch keine Rückmeldung";
  return h(
    "li",
    {},
    h(
      "div",
      { class: "list-item static" },
      avatar(c),
      h("span", { class: "list-text" }, h("span", { class: "list-title" }, `${c.spec.name}, ${c.spec.age}`), h("span", { class: "list-sub" }, status)),
      action,
    ),
  );
}
