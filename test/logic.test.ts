import { describe, expect, it } from "vitest";
import { applyDecision, applyTurn, buildHistory, staggerTimes } from "../src/client/chatlogic";
import { newRelation, type StoredMessage } from "../src/client/model";
import { castCharacter } from "../src/shared/casting";
import { extractJsonObject } from "../src/shared/json";
import { decide, sharedInterests } from "../src/shared/matching";
import { parseChatTurn, parseGeneratedProfile, validateCharacter, validateUserProfile } from "../src/shared/schema";
import type { Character, UserProfile } from "../src/shared/types";
import { imagePrompt } from "../src/worker/prompts";
import { makeCharacter, profile, user } from "./fixtures";

const NOW = 1_800_000_000_000;

describe("Casting / konsistente Charaktere", () => {
  it("ist deterministisch: gleicher Seed -> identische Eckdaten", () => {
    expect(castCharacter(4242, user)).toEqual(castCharacter(4242, user));
    expect(castCharacter(4242, user).id).toBe(castCharacter(4242, user).id);
  });

  it("erzeugt nur Erwachsene in der Wunschspanne, die das Geschlecht der Person suchen", () => {
    for (let seed = 1; seed < 2000; seed++) {
      const s = castCharacter(seed, user);
      expect(s.age).toBeGreaterThanOrEqual(18);
      expect(s.age).toBeGreaterThanOrEqual(user.ageMin);
      expect(s.age).toBeLessThanOrEqual(user.ageMax);
      expect(user.lookingFor).toContain(s.gender);
      expect(s.lookingFor).toContain(user.gender);
      expect(s.ageRange[0]).toBeGreaterThanOrEqual(18);
    }
  });

  it("hält auch bei Altersspanne 18–18 die Untergrenze ein", () => {
    const s = castCharacter(7, { ...user, ageMin: 18, ageMax: 18 });
    expect(s.age).toBe(18);
    expect(s.lifestyle).not.toContain("onlyfans");
  });

  it("ist vielfältig und seltene Varianten sind selten, aber vorhanden", () => {
    const both: UserProfile = { ...user, lookingFor: ["frau", "mann"] };
    const N = 6000;
    const specs = Array.from({ length: N }, (_, i) => castCharacter(i * 7919 + 1, both));
    const share = (pred: (s: (typeof specs)[number]) => boolean) => specs.filter(pred).length / N;
    expect(share((s) => s.lifestyle.includes("influencer"))).toBeGreaterThan(0.04);
    expect(share((s) => s.lifestyle.includes("influencer"))).toBeLessThan(0.1);
    expect(share((s) => s.lifestyle.includes("onlyfans"))).toBeGreaterThan(0.015);
    expect(share((s) => s.lifestyle.includes("onlyfans"))).toBeLessThan(0.07);
    expect(share((s) => s.lifestyle.includes("status"))).toBeGreaterThan(0.03);
    expect(share((s) => s.lifestyle.includes("status"))).toBeLessThan(0.09);
    expect(share((s) => s.lifestyle.length === 0)).toBeGreaterThan(0.8);
    // Seltene Lebensstile nicht an ein Geschlecht gekoppelt.
    const statusShare = (g: string) => specs.filter((s) => s.gender === g && s.lifestyle.includes("status")).length / specs.filter((s) => s.gender === g).length;
    expect(Math.abs(statusShare("frau") - statusShare("mann"))).toBeLessThan(0.03);
    // Vielfalt bei Archetypen, Attraktivität und Namen.
    expect(new Set(specs.map((s) => s.archetype)).size).toBeGreaterThanOrEqual(9);
    expect(new Set(specs.map((s) => s.looks.attractiveness)).size).toBe(4);
    expect(new Set(specs.map((s) => s.name)).size).toBeGreaterThan(100);
  });

  it("vermeidet bereits vergebene Namen", () => {
    const first = castCharacter(99, user);
    const second = castCharacter(99, user, { usedNames: new Set([first.name]) });
    expect(second.name).not.toBe(first.name);
  });

  it("Bild-Prompt beschreibt eindeutig Erwachsene und filtert unpassende Begriffe", () => {
    const base = makeCharacter(5, { ageMin: 18, ageMax: 19 });
    const c: Character = { ...base, profile: { ...base.profile, photo: { outfit: "sexy lingerie", hair: "teen girl braids", details: "smile" } } };
    const p = imagePrompt(c);
    expect(p).toContain("early twenties");
    expect(p).toContain("clearly an adult");
    expect(p).not.toMatch(/lingerie|sexy|teen|girl/i);
  });
});

describe("Matching", () => {
  const c = makeCharacter(31337);

  it("ist deterministisch für gleiche Eingaben", () => {
    expect(decide({ character: c, user, impression: 1, now: NOW })).toEqual(decide({ character: c, user, impression: 1, now: NOW }));
  });

  it("lehnt ab, wenn das Geschlecht nicht gesucht wird", () => {
    const notLooking: Character = { ...c, spec: { ...c.spec, lookingFor: ["frau"] } };
    const d = decide({ character: notLooking, user, impression: 2, now: NOW });
    expect(d.outcome).toBe("pass");
    expect(d.finalOutcome).toBe("pass");
  });

  it("ist kein Münzwurf: passende Profile werden deutlich häufiger erwidert", () => {
    const good = { liked: 0 };
    const bad = { liked: 0 };
    const badUser: UserProfile = { ...user, intent: "locker", interests: ["Shoppen"], bio: "hi" };
    for (let seed = 1; seed <= 400; seed++) {
      const ch = makeCharacter(seed);
      const fit: Character = { ...ch, spec: { ...ch.spec, intent: "beziehung", ageRange: [20, 35] } };
      if (decide({ character: fit, user, impression: 1, now: NOW }).finalOutcome === "like") good.liked++;
      if (decide({ character: fit, user: badUser, impression: -2, now: NOW }).finalOutcome === "like") bad.liked++;
    }
    expect(good.liked / 400).toBeGreaterThan(0.6);
    expect(bad.liked / 400).toBeLessThan(0.1);
  });

  it("ist bei wählerischen Figuren strenger", () => {
    let easy = 0;
    let picky = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const ch = makeCharacter(seed);
      if (decide({ character: { ...ch, spec: { ...ch.spec, style: { ...ch.spec.style, pickiness: 0.1 } } }, user, impression: 0, now: NOW }).finalOutcome === "like") easy++;
      if (decide({ character: { ...ch, spec: { ...ch.spec, style: { ...ch.spec.style, pickiness: 0.95 } } }, user, impression: 0, now: NOW }).finalOutcome === "like") picky++;
    }
    expect(easy).toBeGreaterThan(picky);
  });

  it("legt bei Unentschlossenheit das spätere Ergebnis vorab fest", () => {
    let found = false;
    for (let seed = 1; seed <= 500 && !found; seed++) {
      const ch = makeCharacter(seed);
      const d = decide({ character: ch, user, impression: 0, now: NOW });
      if (d.outcome !== "pending") continue;
      found = true;
      expect(d.resolveAt).toBeGreaterThan(NOW);
      const rel = applyDecision(newRelation(ch.id, NOW), ch, d, NOW);
      expect(rel.status).toBe("pending");
      const later = applyDecision(rel, ch, d, d.resolveAt!);
      expect(later.status).toBe(d.finalOutcome === "like" ? "matched" : "rejected");
      // Gespeicherte Entscheidung bleibt unverändert.
      expect(later.decision).toEqual(d);
    }
    expect(found).toBe(true);
  });

  it("Annahme -> Match mit Anfangsinteresse, Ablehnung -> rejected", () => {
    const like = applyDecision(newRelation(c.id, NOW), c, { ...decide({ character: c, user, impression: 2, now: NOW }), outcome: "like", finalOutcome: "like" }, NOW);
    expect(like.status).toBe("matched");
    expect(like.interest).toBeGreaterThanOrEqual(3);
    const pass = applyDecision(newRelation(c.id, NOW), c, { ...decide({ character: c, user, impression: -2, now: NOW }), outcome: "pass", finalOutcome: "pass" }, NOW);
    expect(pass.status).toBe("rejected");
  });

  it("erkennt überlappende Interessen grob", () => {
    expect(sharedInterests(["Bouldern", "Wandern"], ["Bouldern in der Halle", "wandern im Harz", "Kochen"])).toBe(2);
    expect(sharedInterests(["Schach"], ["Fußball"])).toBe(0);
  });
});

describe("Getrennte Chatkontexte und Chatlogik", () => {
  const a = makeCharacter(1);
  const b = makeCharacter(2);
  const msgs: StoredMessage[] = [
    { charId: a.id, from: "user", text: "Hallo A", at: NOW - 3000 },
    { charId: b.id, from: "user", text: "Hallo B", at: NOW - 2500 },
    { charId: a.id, from: "char", text: "Hi von A", at: NOW - 2000 },
    { charId: a.id, from: "system", text: "Systemhinweis", at: NOW - 1500 },
    { charId: a.id, from: "char", text: "Noch nicht sichtbar", at: NOW + 5000 },
  ];

  it("enthält nur Nachrichten des eigenen Chats, ohne Systemhinweise und zukünftige Nachrichten", () => {
    expect(buildHistory(a.id, msgs, NOW)).toEqual([
      { from: "user", text: "Hallo A" },
      { from: "char", text: "Hi von A" },
    ]);
    expect(buildHistory(b.id, msgs, NOW)).toEqual([{ from: "user", text: "Hallo B" }]);
  });

  it("staffelt mehrere Nachrichten zeitlich", () => {
    const t = staggerTimes(["eins", "zwei", "drei"], NOW);
    expect(t[0]).toBe(NOW);
    expect(t[1]!).toBeGreaterThan(t[0]!);
    expect(t[2]!).toBeGreaterThan(t[1]!);
  });

  it("verarbeitet Interesse, Erinnerungen und Match-Auflösung", () => {
    const rel = { ...newRelation(a.id, NOW), status: "matched" as const, interest: 2, memory: ["mag Katzen"] };
    const t1 = applyTurn(rel, a, { messages: ["ok"], interestChange: 1, action: "none", memory: ["Mag Katzen", "wohnt in Leipzig"] }, NOW);
    expect(t1.relation.interest).toBe(3);
    expect(t1.relation.memory).toEqual(["mag Katzen", "wohnt in Leipzig"]);
    expect(t1.relation.status).toBe("matched");

    const t2 = applyTurn(rel, a, { messages: ["nee, sorry."], interestChange: -3, action: "none", memory: [] }, NOW);
    expect(t2.relation.status).toBe("unmatched");
    expect(t2.messages.at(-1)!.from).toBe("system");

    const t3 = applyTurn(rel, a, { messages: ["Ich bin dann mal raus."], interestChange: 0, action: "end_conversation", memory: [] }, NOW);
    expect(t3.relation.status).toBe("matched");
    expect(t3.relation.chatEnded).toBe(true);

    const t4 = applyTurn({ ...rel, interest: 8 }, a, { messages: [], interestChange: 0, action: "unmatch", memory: [] }, NOW);
    expect(t4.relation.status).toBe("unmatched");
  });
});

describe("Schema-Validierung", () => {
  it("akzeptiert gültige Profile und kürzt zu lange Texte", () => {
    const long = { ...profile, bio: "a".repeat(900) };
    expect(parseGeneratedProfile(long).bio.length).toBe(500);
  });

  it("lehnt falsche Typen ab", () => {
    expect(() => parseGeneratedProfile({ ...profile, interests: "Bouldern" })).toThrow();
    expect(() => parseGeneratedProfile({ ...profile, photo: undefined })).toThrow();
    expect(() => parseGeneratedProfile(null)).toThrow();
  });

  it("validiert gespeicherte Charaktere inklusive Altersgrenze", () => {
    const c = makeCharacter();
    expect(validateCharacter(c)).toEqual(c);
    expect(() => validateCharacter({ ...c, spec: { ...c.spec, age: 17 } })).toThrow();
    expect(() => validateCharacter({ ...c, id: "c-other-id-123" })).toThrow();
  });

  it("validiert Nutzerprofile (nur ab 18)", () => {
    expect(validateUserProfile(user)).toEqual(user);
    expect(() => validateUserProfile({ ...user, age: 17 })).toThrow();
    expect(() => validateUserProfile({ ...user, ageMin: 16 })).toThrow();
    expect(() => validateUserProfile({ ...user, ageMin: 30, ageMax: 25 })).toThrow();
  });

  it("parst Chat-Antworten tolerant, aber begrenzt", () => {
    const t = parseChatTurn({ messages: ["a", "b", "c", "d", "e"], interest_change: 9, action: "weird" }, "reply");
    expect(t.messages).toHaveLength(4);
    expect(t.interestChange).toBe(2);
    expect(t.action).toBe("none");
    expect(() => parseChatTurn({ messages: [] }, "opener")).toThrow();
    expect(parseChatTurn({ messages: [] }, "reply").messages).toEqual([]);
  });

  it("extrahiert JSON aus Codeblöcken und Begleittext", () => {
    expect(extractJsonObject('Hier:\n```json\n{"a": 1,}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('<think>hm</think>{"b": [1,2]}')).toEqual({ b: [1, 2] });
    expect(extractJsonObject("kein json")).toBeUndefined();
  });
});
