# Funkenflug – KI-Dating-Prototyp (Cloudflare Workers)

Deutschsprachiger Dating-Prototyp, in dem **alle Profile, Fotos und Gespräche KI-generiert** sind.
Profile entdecken, liken oder ablehnen, gegenseitige Matches (die Figuren entscheiden selbst) und
charaktertreue Chats. Nur für Erwachsene (18+, Selbstauskunft, keine verifizierte Altersprüfung).

- **Ein einziger Worker** liefert die Oberfläche (statische Assets) und fünf feste API-Routen aus.
- **Keine Datenbank, kein App-Konto, kein Cloudflare-Login**: Daten liegen lokal im Browser (IndexedDB).
- **Workers AI über die REST-API** mit den Zugangsdaten der Person, die die App benutzt.
- TypeScript, keine Laufzeit-Abhängigkeiten. Dev-Abhängigkeiten: `wrangler`, `typescript`, `esbuild`, `vitest`, `@cloudflare/workers-types`.

## Modelle

Zentral in `src/shared/config.ts`:

| Zweck | Modell | Aufruf |
|---|---|---|
| Profile, Eindruck beim Like, Chats | `@cf/google/gemma-4-26b-a4b-it` | JSON-Body (Chat-Completions: `messages`, `max_tokens`, `temperature`, `seed`, `chat_template_kwargs.enable_thinking=false`) |
| Profilbilder | `@cf/black-forest-labs/flux-2-klein-4b` | **multipart/form-data** (`FormData`): `prompt`, `width=512`, `height=512`, `seed` |

Schema-Prüfung: Die Doku-Seiten von developers.cloudflare.com waren aus der Entwicklungsumgebung nicht
erreichbar. Geprüft wurde daher gegen die offiziellen Typdefinitionen in `@cloudflare/workers-types@5.20261016.1`
(Gemma 4: Chat-Completions-Ein-/Ausgabe, `enable_thinking` standardmäßig `true`; FLUX.2 klein 4B: Multipart-Input,
Ausgabe `{ image: base64 }`) und den offiziellen Cloudflare-Changelog zu FLUX.2 klein 4B (nur Multipart, Breite/Höhe 256–1920,
optional `seed`, Schritte fest auf 4).

## Projektstruktur

```
wrangler.jsonc            Worker-Konfiguration (Assets, Build-Schritt, Observability aus)
public/                   index.html, styles.css, _headers (CSP), app.js (gebaut, nicht eingecheckt)
src/shared/               von Worker und Browser gemeinsam genutzt
  config.ts               Modellnamen, Limits, Mindestalter
  types.ts                Datentypen
  schema.ts               Laufzeit-Validierung (Eingaben streng, Modellantworten tolerant gekürzt)
  casting.ts              deterministische Eckdaten neuer Charaktere (Vielfalt, seltene Varianten)
  matching.ts             Entscheidung der Figur über ein Like
  rng.ts, json.ts, errors.ts
src/worker/
  index.ts                Router: /api/character, /api/image, /api/evaluate, /api/chat, /api/rewrite
  cloudflare.ts           Upstream-Aufrufe (nur api.cloudflare.com, redirect:"manual", Fehler-Mapping)
  prompts.ts              Prompts (Profil, Bild, Eindruck, Chat-System-Prompt je Charakter)
src/client/
  main.ts, views/*        Oberfläche (Vanilla-TS, kein Framework, nur textContent); views/editor.ts = Stift
  engine.ts               Profilvorrat, Likes, simulierte Verzögerungen, Antworten
  chatlogic.ts            reine Chatlogik (Kontext, Interesse, Erinnerungen, Auflösen)
  db.ts                   IndexedDB
  credentials.ts          Tokens – nur in einer Modul-Variablen
  api.ts                  Aufrufe an den Worker (begrenzte Parallelität)
test/                     Vitest-Tests
```

## Lokale Entwicklung

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm run dev          # baut den Client und startet wrangler dev auf http://localhost:8787
```

Für lokale Entwicklung ist kein Cloudflare-Login nötig (keine Bindings). Die App fragt im Browser nach
Account-ID und Token; der lokale Worker ruft damit direkt `api.cloudflare.com` auf.

Prüfen:

```bash
npm run check        # Typprüfung (Worker + Client), Tests, Client-Build
```

## Veröffentlichung

Ich habe die App **nicht** veröffentlicht. Schritte:

```bash
npx wrangler login               # einmalig, mit dem Konto, auf dem der Worker laufen soll
npm run deploy                   # = wrangler deploy (führt vorher npm run build:client aus)
```

Danach ist die App unter `https://ki-dating-prototyp.<dein-subdomain>.workers.dev` erreichbar. Es werden
keine Bindings, kein KV/D1 und keine kostenpflichtigen Tarife angelegt. Statische Assets und der Worker
laufen im Workers-Free-Tarif. `npx wrangler deploy --dry-run` wurde erfolgreich getestet.

## Zugangsdaten in der App

- **Account-ID**: Cloudflare-Dashboard, Account-Startseite bzw. „Workers & Pages“ → „Account-Details“/„API“.
  Sie steht in der API-Adresse `…/accounts/<Account-ID>/ai/run/…` und muss zum Token gehören.
- **API-Token**: „Mein Profil → API-Tokens → Token erstellen“, z. B. Vorlage „Workers AI“
  (Kontoberechtigung Workers AI: Lesen + Bearbeiten).
- **Optional ein separater Text-Token**; leer = Bild-Token wird auch für Text verwendet.

## Datenspeicherung und flüchtige Token-Verarbeitung

**Lokal (IndexedDB `ki-dating`, nur in diesem Browser):** Altersbestätigung, eigenes Profil, Account-ID,
generierte Charaktere (Eckdaten + Profil), Profilbilder (Blob), Beziehungsstatus inkl. einmalig gespeicherter
Match-Entscheidung, Chatverläufe und Erinnerungsnotizen. „Profil → Alle lokalen Daten löschen“ löscht die
komplette Datenbank.

**Tokens** existieren nur in einer JavaScript-Variablen der geöffneten Seite (`src/client/credentials.ts`):
- nicht in localStorage, sessionStorage, Cookies, IndexedDB oder URLs; Eingabefelder werden nach dem Übernehmen geleert,
  kein `<form>`-Element (damit Passwortmanager nichts speichern wollen);
- pro Anfrage im **JSON-Body** an den eigenen Worker (nicht in Headern, nicht in URLs, CSP `connect-src 'self'`);
- der Worker nutzt sie nur im `Authorization`-Header genau einer Anfrage an `api.cloudflare.com`, folgt keinen
  Weiterleitungen (`redirect: "manual"`), protokolliert keine Inhalte (Workers-Observability ist aus), gibt nie
  Upstream-Fehlertexte weiter (nur HTTP-Status und numerische Codes) und schreibt Tokens nie in Prompts;
- nach dem Neuladen müssen sie erneut eingegeben werden. Ohne Tokens lassen sich gespeicherte Matches und Chats ansehen.

Der Worker hält keinen Zustand im Speicher.

## Wie die Figuren funktionieren

- **Casting** (`casting.ts`): Ein zufälliger Seed bestimmt deterministisch Name, Alter (18–40, innerhalb der
  Wunschspanne), Geschlecht/Orientierung, fiktiven Wohnort, Lebenssituation, Temperament, Aussehen, Fotostil und
  Chat-Stil (Länge, Emojis, Antworttempo, Initiative, Wählerischkeit). Seltene Lebensstile – Influencer (~7 %),
  erwachsene OnlyFans-Creator (~4 %, erst ab 19), stark statusorientiert (~6 %) – werden **unabhängig von Geschlecht
  und Herkunft** gewürfelt und überlagern eine normale Lebenssituation. Herkunft beeinflusst nur Vornamen und Aussehen.
- **Ausformulierung**: Gemma erzeugt Beruf, Bio, Interessen, Persönlichkeit, Humor, Werte, Partnerwünsche, Dealbreaker,
  Grenzen, Sprach-Eigenheiten, Hintergrund und Fotostichworte als JSON. Das wird gegen ein Schema validiert
  (bei ungültigem JSON genau ein zweiter Versuch). Die Eckdaten kommen immer aus dem Casting, nie aus der Modellantwort.
- **Bild**: Prompt aus Eckdaten + Fotostichworten, „clearly an adult“, vollständig bekleidet, alltägliche Situation,
  unterschiedliche Attraktivität/Körperformen, kein Prominenter; unpassende Begriffe werden herausgefiltert.
  Unter 21 wird bewusst „early twenties“ beschrieben. Stabiler Seed pro Charakter.
- **Konsistenz**: Ein Charakter wird einmal erzeugt und gespeichert (inkl. Bild) und verändert sich nie von selbst.

## Realität umschreiben (✎-Editor)

Jede Profilkarte und der Profilbereich jedes Chats haben einen Stift. Er öffnet einen Editor mit sieben Bereichen:

| Bereich | Möglichkeiten |
|---|---|
| Story | Bio bearbeiten (optional wörtlich), freie Anweisung „Was soll in ihrem/seinem Leben passieren?“, Ideen-Vorschläge, 🎲 Überrasch mich |
| Basis | Name, Alter (18–40), Wohnort, Beruf, Geschlecht, interessiert an, Dating-Absicht, Interessen, Werte |
| Aussehen | Frisur, Körperbau, Ausstrahlung, Brille, Outfit, Foto-Szene, Fotostil (mit Vorlagen), „Nur neues Foto“ |
| Persönlichkeit | Temperament, Charakterzüge, Humor, Regler für Wärme, Wählerischkeit, Initiative |
| Chat-Stil | Antwortlänge, Emojis, Antworttempo, Schreibstil |
| Lebensstil | Influencer:in, Creator (Abo-Plattform), statusorientiert |
| Verlauf | bis zu 8 frühere Versionen inkl. Foto wiederherstellen |

- **Mit KI** (Schalter „KI passt den Rest stimmig an“, bzw. immer bei Anweisung/Überraschung): `/api/rewrite`
  trägt deine Vorgaben ein, Gemma gleicht alle übrigen Details stimmig an, danach werden deine Vorgaben
  erneut erzwungen – festgelegte Werte gewinnen immer.
- **Ohne KI**: Vorgaben werden sofort lokal übernommen, ohne API-Aufruf und ohne Kosten.
- **Foto**: Ein neues Foto wird erzeugt, wenn „Neues Foto erzeugen“ aktiv ist (automatisch bei Aussehens-, Alters- oder
  Geschlechtsänderungen, Anweisungen und Überraschungen). Das alte Foto bleibt sichtbar, bis das neue fertig ist.
- **Leitplanken**: Alter hart 18–40 (Editor und Worker), Hinweise auf Minderjährige werden abgelehnt, keine expliziten
  Inhalte, keine realen Personen, Bild-Prompt bleibt „clearly an adult, fully clothed“.
- ID, Seed und Erstellungszeit bleiben; jede Änderung erhöht die Version. Gespeicherte Match-Entscheidungen bleiben,
  Chats laufen mit der neuen Realität weiter (mit Hinweis im Chat). Der Verlauf liegt im IndexedDB-Speicher `history`
  (Datenbank-Version 2; ältere Daten werden beim Upgrade übernommen).

## Matching

Ein Like erzeugt nie automatisch ein Match. Die Figur bewertet das Nutzerprofil aus ihrer Sicht (KI-Eindruck −2…+2,
geseedet), kombiniert mit nachvollziehbaren Faktoren: gesuchtes Geschlecht, Altersspanne, Dating-Absicht,
gemeinsame Interessen, Mühe bei der Selbstbeschreibung, eigene Wählerischkeit und eine begrenzte, geseedete
Zufallsvariation. Ergebnis: **erwidert**, **nicht erwidert** oder **unentschlossen** (das spätere Ergebnis steht
bereits fest und wird nach 1–5 Minuten sichtbar). Die Entscheidung wird gespeichert und nie neu berechnet;
ein Profil kann nur einmal bewertet werden. Scores werden nirgends angezeigt; abgelehnte Likes erscheinen neutral als „Kein Match“.

## Chats

Jeder Chat hat einen eigenen System-Prompt aus dem gespeicherten Charakter, plus Profil der Person, Erinnerungsnotizen
und die letzten 24 Nachrichten **nur dieses Chats**. Das Modell liefert JSON mit 0–3 Nachrichten (0 = antwortet
vorerst nicht), Interessenänderung, Aktion (`none`/`end_conversation`/`unmatch`) und neuen Erinnerungen. Figuren
antworten unterschiedlich schnell (simulierte Verzögerung je nach Antworttempo und Interesse), schreiben teils
mehrere kurze Nachrichten, können zuerst schreiben, Grenzen setzen, das Gespräch beenden oder das Match auflösen.
Explizite sexuelle Inhalte, Links, Kontaktdaten und Geldbitten sind im Prompt ausgeschlossen; ernsthaft gefragt,
bestätigen Figuren, dass sie KI-Figuren sind. Verzögerungen werden nur bei geöffneter App verarbeitet –
„schreibt …“ erscheint nur, während tatsächlich eine Antwort erzeugt wird.

## Fehler und Kosten

Fehlerarten mit deutschen Meldungen: fehlende/ungültige Zugangsdaten (401), fehlende Berechtigung (403),
Konto/Modell nicht gefunden, Rate-Limit (429) und aufgebrauchtes Kontingent (Code 3036), Zeitüberschreitung,
echter Netzwerkfehler („Von Cloudflare ist keine HTTP-Antwort eingegangen“), unerwartete Weiterleitung,
Cloudflare-Serverfehler und unbrauchbare Modellantworten. Angezeigt werden der echte Cloudflare-HTTP-Status und
numerische Fehlercodes. Bei Zugangs-/Kontingentfehlern pausieren automatische Aufrufe, bis neue Zugangsdaten eingegeben werden.

Kosten-Begrenzung: höchstens 3 Profile im Voraus, kein endloses Nachladen, höchstens 2 parallele Text- und 1 Bildaufruf,
keine automatischen Wiederholungen außer einem zweiten Versuch bei ungültigem Modell-JSON, Hintergrundjobs höchstens
2 automatische Versuche. Ein fehlgeschlagenes Bild betrifft nur dieses Profil (Platzhalter + „Bild erneut versuchen“).
Workers AI hat ein kontoweites kostenloses Tageskontingent; bei bestehendem Bezahltarif können Kosten entstehen.

## Teststand – ehrlich

**Automatisiert getestet (`npm test`, 67 Tests):**
- Multipart-Serialisierung inkl. boundary, kein manueller Content-Type, kein JSON-Body, `redirect: "manual"`, feste URL.
- Status-/Fehlerweitergabe für 401, 403, 404/7003, 429/3040, 429/3036, 500, 504, 302 (nicht verfolgt),
  Netzwerkfehler (ohne HTTP-Antwort), Timeout; keine Upstream-Texte oder Tokens in Antworten.
- Token-Schutz: nur im Authorization-Header, nie im Prompt-/Multipart-Body; Text-Token vs. Bild-Token;
  Header-Injection und manipulierte Account-IDs werden abgelehnt.
- Schema-Validierung (inkl. Altersgrenze 18 für Charaktere und Nutzer), JSON-Extraktion, ein Wiederholungsversuch.
- Casting: Determinismus, nur Erwachsene, Vielfalt, Häufigkeit seltener Varianten, keine Kopplung an Geschlecht.
- Matching: Determinismus, kein Münzwurf, Wählerischkeit, vorab festgelegtes Ergebnis bei Unentschlossenheit.
- Getrennte Chatkontexte, Interesse/Erinnerung, Gesprächsende und Match-Auflösung.
- Editor/Umschreiben: Vorgaben gewinnen gegen die KI, Anweisung und Überraschung im Prompt, wörtliche Bio,
  Altersgrenze 18–40, strenge Validierung der Vorgaben, Rückfall bei ungültigen Modellwerten, Versionszähler,
  neuer Bild-Seed, Änderungen ohne KI (rein lokal).

**In der echten Workers-Laufzeit (lokal `wrangler dev`/workerd) geprüft:** Auslieferung der Assets inkl. CSP,
Validierung, Origin-Prüfung, Fehlerweitergabe ohne Token-Leak (Upstream war blockiert → korrekt als
„keine HTTP-Antwort“ gemeldet), FormData-Bildpfad.

**End-to-End in Chromium (iPad- und iPhone-Viewport, Touch) mit simulierten `/api/*`-Antworten:**
Altersbestätigung, Onboarding (Alter < 18 abgelehnt), Profilvorrat (≤ 3), KI-Kennzeichnung, Editor (7 Bereiche,
Ablehnung „16 Jahre“, Änderung mit KI, Änderung ohne KI ohne API-Aufruf, Verlauf wiederherstellen, nur neues Foto),
Datenbank-Upgrade v1 → v2 ohne Datenverlust, Like/Ablehnen per Button,
Match, Chat mit simulierter Verzögerung, keine Tokens in URLs/Headern/Speichern, Neuladen (Tokens weg, Profile/Matches/
Chats identisch), Bildfehler ohne Absturz, Kontingentfehler mit Status und Code, Löschen aller Daten.
Das E2E-Skript lag in einem temporären Verzeichnis und ist nicht Teil des Repos.

**Nicht live bestätigt:** Echte Aufrufe an `api.cloudflare.com` waren aus der Entwicklungsumgebung nicht möglich.
Unbestätigt sind daher auch, wie gut Gemma beim Umschreiben die gesamte Figur stimmig anpasst, sowie: die tatsächliche Antwortform beider Modelle über `/ai/run` (der Code akzeptiert
`choices[].message.content`, `response` und `output_text` bzw. JSON-`image` und Binärbilder), ob `seed` und
`chat_template_kwargs` per REST akzeptiert werden, die Qualität/Einhaltung des JSON-Formats durch Gemma,
Bildqualität und Altersanmutung von FLUX sowie die genaue Zuordnung einzelner Cloudflare-Fehlercodes
(HTTP-Status werden immer angezeigt). Wischgesten wurden nicht auf echten Geräten getestet.

## Bekannte Grenzen

- Kein echtes Mehrbenutzersystem; Daten hängen an Browser und Gerät.
- Simulierte Ereignisse laufen nur bei geöffneter App.
- Die Altersbestätigung ist eine Selbstauskunft.
