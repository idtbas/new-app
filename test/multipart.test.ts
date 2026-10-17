import { afterEach, describe, expect, it, vi } from "vitest";
import { buildImageForm, runImage } from "../src/worker/cloudflare";
import { ACCOUNT_ID, IMAGE_TOKEN } from "./fixtures";

// 1x1-JPEG-Header genügt für die Formatprüfung.
const JPEG_B64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1) + "x".repeat(200));

afterEach(() => vi.unstubAllGlobals());

describe("FLUX-Multipart", () => {
  it("serialisiert prompt, width, height als echte multipart/form-data mit boundary", async () => {
    const form = buildImageForm("a photo", 42);
    expect(form).toBeInstanceOf(FormData);
    // So serialisiert fetch den Body: Content-Type inklusive boundary wird automatisch erzeugt.
    const req = new Request("https://api.cloudflare.com/x", { method: "POST", body: form });
    const ct = req.headers.get("content-type") ?? "";
    const m = /^multipart\/form-data; boundary=(.+)$/.exec(ct);
    expect(m).not.toBeNull();
    const boundary = m![1]!;
    const body = await req.text();
    expect(body).toContain(`--${boundary}\r\n`);
    expect(body).toContain(`--${boundary}--`);
    expect(body).toMatch(/Content-Disposition: form-data; name="prompt"\r\n\r\na photo\r\n/);
    expect(body).toMatch(/name="width"\r\n\r\n512\r\n/);
    expect(body).toMatch(/name="height"\r\n\r\n512\r\n/);
    expect(body).toMatch(/name="seed"\r\n\r\n42\r\n/);
    expect(body).not.toContain("{"); // kein JSON
  });

  it("setzt keinen eigenen Content-Type, nutzt redirect manual und nur die feste URL", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true, result: { image: JPEG_B64 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const res = await runImage(ACCOUNT_ID, IMAGE_TOKEN, "portrait", 7);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.mime).toBe("image/jpeg");
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-2-klein-4b`);
    expect(init.redirect).toBe("manual");
    expect(init.body).toBeInstanceOf(FormData);
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("content-type");
    expect(headers.Authorization).toBe(`Bearer ${IMAGE_TOKEN}`);
  });

  it("akzeptiert auch eine binäre Bildantwort", async () => {
    vi.stubGlobal("fetch", async () => new Response(Uint8Array.from(atob(JPEG_B64), (c) => c.charCodeAt(0)), { status: 200, headers: { "content-type": "image/jpeg" } }));
    const res = await runImage(ACCOUNT_ID, IMAGE_TOKEN, "portrait", 7);
    expect(res.ok).toBe(true);
  });

  it("lehnt Nicht-Bilddaten ab", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true, result: { image: btoa("<html>" + "x".repeat(200)) } }), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await runImage(ACCOUNT_ID, IMAGE_TOKEN, "portrait", 7);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("model_output");
  });
});
