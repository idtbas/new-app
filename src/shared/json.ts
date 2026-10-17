// Holt ein JSON-Objekt aus einer Modellantwort, auch wenn es in ```json-Blöcke
// oder etwas Begleittext verpackt ist. Gibt bei Misserfolg undefined zurück.
export function extractJsonObject(text: string): unknown {
  let s = text.trim();
  // Eventuelle Denk-Blöcke entfernen, falls das Modell sie trotz Abschaltung ausgibt.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  const candidate = s.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Häufiger Modellfehler: Komma vor schließender Klammer.
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}
