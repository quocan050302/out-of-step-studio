import assert from "node:assert/strict";
import test from "node:test";
import { connectionStatus, scriptWordCount } from "../src/lib/studio.mjs";

test("connection pill retains no-key precedence", () => {
  assert.deepEqual(connectionStatus(null, null), { className: "pill pill-unknown", text: "Gemini: not tested" });
  assert.equal(connectionStatus({ gemini: { hasKey: false } }, { ok: true }).text, "Gemini: no key saved");
});

test("connection pill carries over last persisted test status", () => {
  const providers = { gemini: { hasKey: true } };
  assert.equal(connectionStatus(providers, null).text, "Gemini: key saved, not tested");
  assert.equal(connectionStatus(providers, { ok: true }).className, "pill pill-ok");
  assert.equal(connectionStatus(providers, { ok: false }).className, "pill pill-bad");
});

test("script word count preserves API totalWords and legacy fallback", () => {
  const beats = [{ text: "first second" }, { text: "third fourth" }];
  assert.equal(scriptWordCount({ beats, totalWords: 17 }), 17);
  assert.equal(scriptWordCount({ beats }), 4);
  assert.equal(scriptWordCount({ beats, totalWords: 0 }), 0);
});
