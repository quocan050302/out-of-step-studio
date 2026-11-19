import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStudioServer } from "../server.mjs";

const MOCK_MODELS = [
  {
    name: "models/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.8-flash-tts",
    displayName: "Gemini 3.8 Flash TTS",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 8192,
    outputTokenLimit: 16384,
  },
];

async function startEphemeralStudio(fetchImpl) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oos-http-test-"));
  const studio = createStudioServer({
    dataDir,
    fetchImpl,
    sleepImpl: async () => {},
    baseRetryDelayMs: 5,
    maxRetryDelayMs: 10,
  });
  await new Promise((resolve) => studio.server.listen(0, "127.0.0.1", resolve));
  const { port } = studio.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    dataDir,
    async close() {
      await new Promise((resolve) => studio.server.close(resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test("HTTP server preserves all legacy contracts, supports NDJSON streaming, and redacts keys", async () => {
  const fakeSecret = "AIzaHttpIntegrationSecretKey54321";

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/models")) {
      return new Response(JSON.stringify({ models: MOCK_MODELS }), { status: 200 });
    }
    const model = decodeURIComponent(/\/models\/([^:]+):generateContent/.exec(u.pathname)?.[1] || "");
    const body = JSON.parse(init.body || "{}");
    if (model === "gemini-2.5-pro") {
      return new Response(
        JSON.stringify({
          error: { code: 503, status: "UNAVAILABLE", message: `Overloaded (${fakeSecret})` },
        }),
        { status: 503 },
      );
    }
    if (body.generationConfig?.responseModalities?.includes("AUDIO")) {
      const pcm = Buffer.alloc(2400, 2);
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "audio/L16", data: pcm.toString("base64") } }] } },
          ],
        }),
        { status: 200 },
      );
    }
    const textPrompt = body.contents?.[0]?.parts?.[0]?.text || "";
    if (textPrompt.includes("Reply with exactly: OK")) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }),
        { status: 200 },
      );
    }
    if (textPrompt.includes("visual QA checker")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: '{"verdict":"FAIL","issues":["Left character clipped"],"summary":"Edge clip."}' }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"title":"Out of Step","beats":[{"text":"Twelve cowboys marched.","estSec":3.4}],"totalWords":3}',
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const env = await startEphemeralStudio(fetchImpl);
  try {
    // 1. Initial GET /api/settings
    const r0 = await fetch(`${env.baseUrl}/api/settings`).then((r) => r.json());
    assert.equal(r0.ok, true);
    assert.equal(r0.providers.gemini.hasKey, false);
    assert.equal(r0.providers.openai.status, "not integrated yet");

    // 2. Save Gemini key + verify masking & blank preservation
    const saveRes = await fetch(`${env.baseUrl}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini", fields: { apiKey: fakeSecret } }),
    }).then((r) => r.json());
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.providers.gemini.hasKey, true);
    assert.equal(saveRes.providers.gemini.apiKey, "••••••••54321");
    assert.ok(!JSON.stringify(saveRes).includes(fakeSecret));

    // 3. Unintegrated provider test-connection
    const unint = await fetch(`${env.baseUrl}/api/test-connection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai" }),
    }).then((r) => r.json());
    assert.deepEqual(unint, { ok: false, error: "not integrated yet" });

    // 4. NDJSON streaming test-connection (Pro 503 -> Flash OK, secret redacted from attempt messages)
    const ndjsonRaw = await fetch(`${env.baseUrl}/api/test-connection`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ provider: "gemini", stream: true }),
    }).then((r) => r.text());
    assert.ok(!ndjsonRaw.includes(fakeSecret), "Secret must be redacted from stream output");
    const lines = ndjsonRaw.trim().split("\n").map((l) => JSON.parse(l));
    const finalMsg = lines.find((l) => l.type === "result");
    assert.equal(finalMsg.data.ok, true);
    assert.equal(finalMsg.data.model, "gemini-3.8-flash");
    assert.equal(finalMsg.data.preferredModel, "gemini-2.5-pro");
    assert.equal(finalMsg.data.downgraded, true);
    assert.equal(finalMsg.data.reply, "OK");

    // 5. POST /api/script
    const badScript = await fetch(`${env.baseUrl}/api/script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "   " }),
    });
    assert.equal(badScript.status, 400);

    const scriptRes = await fetch(`${env.baseUrl}/api/script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "resonance on bridges", durationSec: 30 }),
    }).then((r) => r.json());
    assert.equal(scriptRes.ok, true);
    assert.equal(scriptRes.model, "gemini-3.8-flash");
    assert.equal(scriptRes.script.title, "Out of Step");

    // 6. POST /api/check-still
    const stillRes = await fetch(`${env.baseUrl}/api/check-still`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: Buffer.from("fakeimg").toString("base64"),
        mimeType: "image/png",
        shotNote: "front medium shot",
      }),
    }).then((r) => r.json());
    assert.equal(stillRes.ok, true);
    assert.equal(stillRes.result.verdict, "FAIL");
    assert.deepEqual(stillRes.result.issues, ["Left character clipped"]);

    // 7. POST /api/tts
    const ttsRes = await fetch(`${env.baseUrl}/api/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Break step on the bridge.", voiceName: "Kore" }),
    }).then((r) => r.json());
    assert.equal(ttsRes.ok, true);
    assert.equal(ttsRes.model, "gemini-3.8-flash-tts");
    assert.equal(ttsRes.bytes, 44 + 2400);
    assert.ok(fs.existsSync(path.join(env.dataDir, "tts-output.wav")));

    // 8. GET /api/gemini/models & /api/gemini/status
    const modelsRes = await fetch(`${env.baseUrl}/api/gemini/models`).then((r) => r.json());
    assert.equal(modelsRes.ok, true);
    assert.equal(modelsRes.ranked.text[0].id, "gemini-2.5-pro");
    assert.equal(modelsRes.ranked.tts[0].id, "gemini-3.8-flash-tts");

    const statusRes = await fetch(`${env.baseUrl}/api/gemini/status`).then((r) => r.json());
    assert.equal(statusRes.ok, true);
    assert.equal(statusRes.hasKey, true);
  } finally {
    await env.close();
  }
});

test("OOS-03 golden contracts: literal prompts, token budgets, clearKey, concurrent settings saves, and parallel TTS writes", async () => {
  const capturedBodies = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/models")) {
      return new Response(JSON.stringify({ models: MOCK_MODELS }), { status: 200 });
    }
    const model = decodeURIComponent(/\/models\/([^:]+):generateContent/.exec(u.pathname)?.[1] || "");
    const body = JSON.parse(init.body || "{}");
    capturedBodies.push({ model, body });

    if (body.generationConfig?.responseModalities?.includes("AUDIO")) {
      const pcm = Buffer.alloc(3600, 3);
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ inlineData: { mimeType: "audio/L16", data: pcm.toString("base64") } }] } },
          ],
        }),
        { status: 200 },
      );
    }
    const textPrompt = body.contents?.[0]?.parts?.[0]?.text || "";
    if (textPrompt.includes("Reply with exactly: OK")) {
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }),
        { status: 200 },
      );
    }
    if (textPrompt.includes("visual QA checker")) {
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"verdict":"PASS","issues":[],"summary":"Good frame."}' }] } },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '{"title":"Golden Prompt Check","beats":[{"text":"One steady narrator line.","estSec":3.5}],"totalWords":4}',
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
  };

  const env = await startEphemeralStudio(fetchImpl);
  try {
    // 1. Concurrent POST /api/settings across multiple providers & fields
    await Promise.all([
      fetch(`${env.baseUrl}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "gemini", fields: { apiKey: "AIzaConcurrentKeyAlpha12345" } }),
      }),
      fetch(`${env.baseUrl}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", fields: { apiKey: "sk-openai-test-99999" } }),
      }),
      fetch(`${env.baseUrl}/api/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "gemini", fields: { modelPolicy: "balanced" } }),
      }),
    ]);

    const afterConcurrent = await fetch(`${env.baseUrl}/api/settings`).then((r) => r.json());
    assert.equal(afterConcurrent.ok, true);
    assert.equal(afterConcurrent.providers.gemini.hasKey, true);
    assert.equal(afterConcurrent.providers.gemini.modelPolicy, "balanced");
    assert.equal(afterConcurrent.providers.openai.hasKey, true);

    // 2. Verify exact literal prompts and maxOutputTokens for test-connection (512), script 30s & 60s (4096), check-still (2048)
    await fetch(`${env.baseUrl}/api/test-connection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini" }),
    });
    const connCall = capturedBodies.at(-1);
    assert.equal(connCall.body.contents[0].parts[0].text, "Reply with exactly: OK");
    assert.equal(connCall.body.generationConfig.maxOutputTokens, 512);

    await fetch(`${env.baseUrl}/api/script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "pendulum sync", durationSec: 60 }),
    });
    const script60Call = capturedBodies.at(-1);
    const expectedPrompt60 =
      `Write narration for a vertical (9:16) cartoon story short in the style of "Out of Step": ` +
      `a true-or-plausible little lesson retold with gentle deadpan humour, one steady English narrator, no captions. ` +
      `Topic: pendulum sync. Target duration 60 seconds at ~3.5 words/second (~210 words total), about 16 beats. ` +
      `Structure the beats like: hook, setting, rising action, snap/surprise, deadpan line, plain-language explanation, callback. ` +
      `Return ONLY JSON, no markdown, in exactly this shape: ` +
      `{"title":"...","beats":[{"text":"...","estSec":3.5}],"totalWords":123}`;
    assert.equal(script60Call.body.contents[0].parts[0].text, expectedPrompt60);
    assert.equal(script60Call.body.generationConfig.maxOutputTokens, 4096);

    await fetch(`${env.baseUrl}/api/check-still`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        imageBase64: Buffer.from("img").toString("base64"),
        mimeType: "image/jpeg",
        shotNote: "wide bridge view",
      }),
    });
    const stillCall = capturedBodies.at(-1);
    const expectedStillPrompt =
      `You are the visual QA checker for a cartoon short frame. ` +
      `Shot intent: wide bridge view. ` +
      `Check: characters readable and not clipped by frame edges or props, no rendering glitches, ` +
      `no blank/black areas, composition matches the shot intent. ` +
      `Return ONLY JSON, no markdown: {"verdict":"PASS" or "FAIL","issues":["..."],"summary":"one short sentence"}`;
    assert.equal(stillCall.body.contents[0].parts[0].text, expectedStillPrompt);
    assert.equal(stillCall.body.generationConfig.maxOutputTokens, 2048);

    // 3. Parallel POST /api/tts writes serialize atomically without corrupting tts-output.wav or leaving .tmp files
    const ttsPromises = Array.from({ length: 4 }, (_, i) =>
      fetch(`${env.baseUrl}/api/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `Parallel line ${i}` }),
      }).then((r) => r.json()),
    );
    const ttsResults = await Promise.all(ttsPromises);
    for (const r of ttsResults) {
      assert.equal(r.ok, true);
      assert.equal(r.file, "app/data/tts-output.wav");
      assert.equal(r.bytes, 44 + 3600);
    }
    const wavDisk = fs.readFileSync(path.join(env.dataDir, "tts-output.wav"));
    assert.equal(wavDisk.length, 44 + 3600);
    assert.equal(wavDisk.toString("ascii", 0, 4), "RIFF");
    const leftoverTmp = fs.readdirSync(env.dataDir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftoverTmp, []);

    // 4. clearKey: true explicitly removes the saved key
    const cleared = await fetch(`${env.baseUrl}/api/settings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini", fields: { clearKey: true } }),
    }).then((r) => r.json());
    assert.equal(cleared.ok, true);
    assert.equal(cleared.providers.gemini.hasKey, false);
    assert.equal(cleared.providers.gemini.apiKey, "");
  } finally {
    await env.close();
  }
});
