import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_STILL_FILE_BYTES,
  api,
  connectionStatus,
  formatBytes,
  formatScriptForClipboard,
  scriptTotalSeconds,
  scriptWordCount,
  streamTestConnection,
  validateImageFile,
} from "../src/lib/studio.mjs";

test("connection pill retains no-key precedence", () => {
  assert.equal(connectionStatus(null, null).className, "pill pill-unknown");
  assert.equal(connectionStatus(null, null).text, "Gemini: not tested");
  assert.equal(connectionStatus({ gemini: { hasKey: false } }, { ok: true }).text, "Gemini: no key saved");
});

test("connection pill carries over last persisted test status and freshness", () => {
  const providers = { gemini: { hasKey: true } };
  assert.equal(connectionStatus(providers, null).text, "Gemini: key saved, not tested");
  assert.equal(connectionStatus(providers, { ok: true }).className, "pill pill-ok");
  assert.equal(connectionStatus(providers, { ok: false }).className, "pill pill-bad");

  // Testing in-progress state
  assert.equal(connectionStatus(providers, null, { testing: true }).state, "testing");

  // Degraded fallback state
  const fb = connectionStatus(
    providers,
    { ok: true, downgraded: true, model: "gemini-3.8-flash", at: 10_000 },
    { now: 20_000 },
  );
  assert.equal(fb.state, "degraded-fallback");
  assert.equal(fb.className, "pill pill-warn");

  // Stale cached localStorage test (>30 min old) does not masquerade as freshly verified
  const stale = connectionStatus(
    providers,
    { ok: true, at: 1_000 },
    { now: 1_000 + 45 * 60 * 1000 },
  );
  assert.equal(stale.state, "stale");
  assert.equal(stale.className, "pill pill-stale");

  // Blocked auth/quota state
  const blocked = connectionStatus(providers, { ok: false, reasonCategory: "quota_global" });
  assert.equal(blocked.state, "blocked");
});

test("script word count, duration, and clipboard formatting preserve fallbacks", () => {
  const beats = [
    { text: "first second", estSec: 2.5 },
    { text: "third fourth", estSec: 3.0 },
  ];
  assert.equal(scriptWordCount({ beats, totalWords: 17 }), 17);
  assert.equal(scriptWordCount({ beats }), 4);
  assert.equal(scriptWordCount({ beats, totalWords: 0 }), 0);
  assert.equal(scriptTotalSeconds({ beats }), 5.5);

  const clip = formatScriptForClipboard({ title: "Bridge Lesson", beats }, "gemini-3.8-flash");
  assert.match(clip, /# Bridge Lesson/);
  assert.match(clip, /1\. \[2\.5s\] first second/);
  assert.match(clip, /gemini-3\.8-flash/);
});

test("validateImageFile enforces MIME type, non-empty size, and 12MB base64 ceiling", () => {
  assert.equal(validateImageFile(null).ok, false);
  assert.equal(validateImageFile({ type: "application/pdf", size: 1024 }).ok, false);
  assert.equal(validateImageFile({ type: "image/png", size: 0 }).ok, false);
  assert.equal(
    validateImageFile({ type: "image/jpeg", size: MAX_STILL_FILE_BYTES + 100 }).ok,
    false,
  );
  assert.equal(validateImageFile({ type: "image/png", size: 250_000 }).ok, true);
  assert.equal(formatBytes(1536), "1.5 KB");
});

test("api() and streamTestConnection() handle non-JSON errors and NDJSON chunks", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("<html>502 Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" });
    await assert.rejects(() => api("/api/settings"), /non-JSON response \(HTTP 502\)/);

    const encoder = new TextEncoder();
    const chunks = [
      '{"type":"progress","event":{"stage":"discovering","message":"Discovering"}}\n{"type":"prog',
      'ress","event":{"stage":"attempt_start","message":"Testing Pro"}}\n',
      '{"type":"result","data":{"ok":true,"model":"gemini-3.8-flash","reply":"OK","latencyMs":120}}\n',
    ];
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(ctrl) {
            for (const c of chunks) ctrl.enqueue(encoder.encode(c));
            ctrl.close();
          },
        }),
        { status: 200, headers: { "content-type": "application/x-ndjson" } },
      );

    const events = [];
    const res = await streamTestConnection({ onProgress: (e) => events.push(e.stage) });
    assert.deepEqual(events, ["discovering", "attempt_start"]);
    assert.equal(res.ok, true);
    assert.equal(res.model, "gemini-3.8-flash");
  } finally {
    globalThis.fetch = origFetch;
  }
});
