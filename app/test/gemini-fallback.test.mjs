import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createModelCatalogService } from "../server/gemini-models.mjs";
import {
  ModelHealthRegistry,
  createGeminiExecutionEngine,
  validateConnectionReply,
  validateScriptResponse,
  validateStillVerdict,
  validateTtsAudio,
} from "../server/gemini-transport.mjs";
import {
  defaultSettings,
  loadSettings,
  maskedSettings,
  saveSettings,
  updateProviderSettings,
} from "../server/settings-store.mjs";

const CATALOG_FIXTURE = [
  {
    name: "models/gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash-Lite",
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
    name: "models/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-1.0-pro",
    displayName: "Gemini 1.0 Pro",
    description: "Legacy text-only model",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 30720,
    outputTokenLimit: 2048,
  },
  {
    name: "models/gemini-3.8-flash-tts",
    displayName: "Gemini 3.8 Flash TTS",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 8192,
    outputTokenLimit: 16384,
  },
  {
    name: "models/gemini-3.8-flash-lite-tts",
    displayName: "Gemini 3.8 Flash Lite TTS",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 8192,
    outputTokenLimit: 16384,
  },
];

function makeSeededRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeTestHarness({ routeGenerate, catalogPages = [{ models: CATALOG_FIXTURE }] } = {}) {
  let now = 1_700_000_000_000;
  const sleeps = [];
  const generateCalls = [];
  let listCalls = 0;

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/models") && (!init.method || init.method === "GET")) {
      listCalls += 1;
      const pageIdx = Number(u.searchParams.get("pageToken") || 0);
      const page = catalogPages[pageIdx] || { models: [] };
      return new Response(JSON.stringify(page), { status: 200 });
    }
    const match = /\/models\/([^:]+):generateContent$/.exec(u.pathname);
    const model = decodeURIComponent(match?.[1] || "");
    const body = init.body ? JSON.parse(init.body) : {};
    generateCalls.push({ model, body, headers: init.headers });
    now += 25;
    return routeGenerate({ model, body, callIndex: generateCalls.length, signal: init.signal });
  };

  const healthRegistry = new ModelHealthRegistry({ clock: () => now });
  const catalogService = createModelCatalogService({
    fetchImpl,
    clock: () => now,
  });
  const engine = createGeminiExecutionEngine({
    catalogService,
    healthRegistry,
    fetchImpl,
    clock: () => now,
    rng: makeSeededRng(7),
    sleepImpl: async (ms, signal) => {
      if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
      sleeps.push(ms);
      now += ms;
    },
    maxCandidates: 3,
    maxTotalRequests: 8,
    maxRetriesPerCandidate: 2,
    baseRetryDelayMs: 200,
    maxRetryDelayMs: 2_000,
  });

  const settings = defaultSettings();
  settings.gemini.apiKey = "AIzaSyntheticKeyForUnitTestsOnly99999";

  return {
    engine,
    healthRegistry,
    catalogService,
    settings,
    sleeps,
    generateCalls,
    getListCalls: () => listCalls,
    advanceClock: (ms) => {
      now += ms;
    },
  };
}

function okTextResponse(text) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function errorResponse(status, grpcStatus, message, extra = {}, headers = {}) {
  return new Response(
    JSON.stringify({
      error: {
        code: status,
        status: grpcStatus,
        message,
        ...extra,
      },
    }),
    { status, headers: { "content-type": "application/json", ...headers } },
  );
}

test("D3 #01: missing API key makes zero network calls and returns not connected", async () => {
  const h = makeTestHarness({
    routeGenerate: () => okTextResponse("OK"),
  });
  h.settings.gemini.apiKey = "";

  const out = await h.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });

  assert.equal(out.ok, false);
  assert.equal(out.reasonCategory, "no_key");
  assert.equal(h.getListCalls(), 0);
  assert.equal(h.generateCalls.length, 0);
});

test("D3 #04: Pro 503 retries bounded times then falls back to Flash with real trail", async () => {
  const h = makeTestHarness({
    routeGenerate: ({ model }) => {
      if (model === "gemini-2.5-pro") {
        return errorResponse(503, "UNAVAILABLE", "This model is currently experiencing high demand");
      }
      return okTextResponse("OK");
    },
  });

  const out = await h.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });

  assert.equal(out.ok, true);
  assert.equal(out.preferredModel, "gemini-2.5-pro");
  assert.equal(out.effectiveModel, "gemini-3.8-flash");
  assert.equal(out.downgraded, true);
  // 1 initial + 2 retries on Pro = 3 failed attempts, then 1 success on Flash = 4 attempts
  assert.equal(out.attemptedModels.length, 4);
  assert.equal(out.attemptedModels.filter((a) => a.model === "gemini-2.5-pro").length, 3);
  assert.equal(out.attemptedModels.at(-1).model, "gemini-3.8-flash");
  assert.equal(out.attemptedModels.at(-1).outcome, "success");
  assert.equal(h.sleeps.length, 2);
});

test("D3 #05: Pro 503 -> Flash 503 -> Flash-Lite succeeds and stops immediately", async () => {
  const h = makeTestHarness({
    routeGenerate: ({ model }) => {
      if (model === "gemini-2.5-pro" || model === "gemini-3.8-flash") {
        return errorResponse(503, "UNAVAILABLE", "Service overloaded");
      }
      return okTextResponse("OK.");
    },
  });

  const out = await h.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });

  assert.equal(out.ok, true);
  assert.equal(out.effectiveModel, "gemini-2.5-flash-lite");
  assert.equal(out.downgraded, true);
  // Never touched gemini-1.0-pro after Flash-Lite succeeded
  assert.ok(!h.generateCalls.some((c) => c.model === "gemini-1.0-pro"));
});

test("D3 #06: HTTP 200 with empty or non-OK body fails verification", async () => {
  const h = makeTestHarness({
    routeGenerate: () => okTextResponse(""),
  });

  const out = await h.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });

  assert.equal(out.ok, false);
  assert.equal(out.reasonCategory, "invalid_output");
  assert.equal(h.generateCalls.length, 1);
});

test("D3 #07 & #08: 401 invalid key and 403 permission denied make zero fallback attempts", async () => {
  for (const [code, grpc] of [
    [401, "UNAUTHENTICATED"],
    [403, "PERMISSION_DENIED"],
  ]) {
    const h = makeTestHarness({
      routeGenerate: () => errorResponse(code, grpc, "Auth or billing rejected"),
    });
    const out = await h.engine.runGeminiWithFallback({
      action: "test-connection",
      capability: "text",
      settings: h.settings,
      payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
      validate: validateConnectionReply,
    });
    assert.equal(out.ok, false);
    assert.equal(out.reasonCategory, code === 401 ? "auth" : "permission");
    assert.equal(h.generateCalls.length, 1);
  }
});

test("D3 #09 & #10: 429 model-level obeys RetryInfo while 429 global quota halts immediately", async () => {
  // Model-level 429 with RetryInfo 1.2s -> sleeps >=1200ms then succeeds on retry/fallback
  const hModel = makeTestHarness({
    routeGenerate: ({ model, callIndex }) => {
      if (model === "gemini-2.5-pro" && callIndex === 1) {
        return errorResponse(429, "RESOURCE_EXHAUSTED", "RPM limit for model", {
          details: [
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1.2s" },
            {
              "@type": "type.googleapis.com/google.rpc.QuotaFailure",
              violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel" }],
            },
          ],
        });
      }
      return okTextResponse("OK");
    },
  });

  const okOut = await hModel.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: hModel.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  assert.equal(okOut.ok, true);
  assert.ok(hModel.sleeps[0] >= 1200);

  // Project/Daily global quota -> stops immediately with 1 call, zero fallback
  const hGlobal = makeTestHarness({
    routeGenerate: () =>
      errorResponse(
        429,
        "RESOURCE_EXHAUSTED",
        "You exceeded your current quota, please check your plan and billing details.",
      ),
  });
  const globalOut = await hGlobal.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: hGlobal.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  assert.equal(globalOut.ok, false);
  assert.equal(globalOut.reasonCategory, "quota_global");
  assert.equal(hGlobal.generateCalls.length, 1);
});

test("D3 #11: 400 generationConfig parameter mismatch adapts once; malformed payload does not fallback", async () => {
  const hAdapt = makeTestHarness({
    routeGenerate: ({ body }) => {
      if (body.generationConfig?.maxOutputTokens) {
        return errorResponse(400, "INVALID_ARGUMENT", "Unknown field maxOutputTokens in generationConfig");
      }
      return okTextResponse("OK");
    },
  });

  const adapted = await hAdapt.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: hAdapt.settings,
    payloadFactory: ({ adapted: isAdapted }) => ({
      parts: [{ text: "Reply with exactly: OK" }],
      generationConfig: isAdapted ? undefined : { maxOutputTokens: 512 },
      adaptedApplied: Boolean(isAdapted),
    }),
    validate: validateConnectionReply,
  });
  assert.equal(adapted.ok, true);
  assert.equal(adapted.effectiveModel, "gemini-2.5-pro");
  assert.equal(adapted.downgraded, false);

  const hBadPrompt = makeTestHarness({
    routeGenerate: () => errorResponse(400, "INVALID_ARGUMENT", "Inline image payload is corrupted"),
  });
  const badOut = await hBadPrompt.engine.runGeminiWithFallback({
    action: "check-still",
    capability: "vision",
    settings: hBadPrompt.settings,
    payloadFactory: () => ({ parts: [{ text: "check" }] }),
    validate: validateStillVerdict,
  });
  assert.equal(badOut.ok, false);
  assert.equal(badOut.reasonCategory, "invalid_request");
  assert.equal(hBadPrompt.generateCalls.length, 1);
});

test("D3 #12: 404 from stale catalog triggers bounded one-time rediscovery", async () => {
  let listCount = 0;
  let now = 1_700_000_000_000;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/models")) {
      listCount += 1;
      const models =
        listCount === 1
          ? [
              {
                name: "models/gemini-2.9-pro",
                displayName: "Gemini 2.9 Pro",
                supportedGenerationMethods: ["generateContent"],
                inputTokenLimit: 1048576,
              },
            ]
          : [
              {
                name: "models/gemini-3.8-flash",
                displayName: "Gemini 3.8 Flash",
                supportedGenerationMethods: ["generateContent"],
                inputTokenLimit: 1048576,
              },
            ];
      return new Response(JSON.stringify({ models }), { status: 200 });
    }
    if (u.pathname.includes("gemini-2.9-pro")) {
      return errorResponse(404, "NOT_FOUND", "models/gemini-2.9-pro is not found for API version v1beta");
    }
    return okTextResponse("OK");
  };

  const healthRegistry = new ModelHealthRegistry({ clock: () => now });
  const catalogService = createModelCatalogService({ fetchImpl, clock: () => now });
  const engine = createGeminiExecutionEngine({ catalogService, healthRegistry, fetchImpl, clock: () => now });
  const settings = defaultSettings();
  settings.gemini.apiKey = "AIzaSynthetic404TestKey123456789";

  const out = await engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });

  assert.equal(out.ok, true);
  assert.equal(listCount, 2);
  assert.equal(out.effectiveModel, "gemini-3.8-flash");
});

test("D3 #13 & #14: non-JSON/timeout errors stay bounded and all-fail never reports green", async () => {
  const h = makeTestHarness({
    routeGenerate: () => new Response("<html>Gateway Timeout</html>", { status: 504 }),
  });

  const out = await h.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });

  assert.equal(out.ok, false);
  assert.equal(out.reasonCategory, "transient");
  assert.ok(out.attemptedModels.length >= 2);
  assert.ok(h.generateCalls.length <= 8);
});

test("D3 #16, #17, #18 & #24: cooldown reuse across script/still/tts, output validators, and auto-upgrade recovery", async () => {
  let proHealthy = false;
  const h = makeTestHarness({
    routeGenerate: ({ model, body }) => {
      if (model === "gemini-2.5-pro" && !proHealthy) {
        return errorResponse(503, "UNAVAILABLE", "High demand on Pro");
      }
      if (body.generationConfig?.responseModalities?.includes("AUDIO")) {
        const pcm = Buffer.alloc(4800, 1); // 0.1s at 24kHz mono 16-bit
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ inlineData: { mimeType: "audio/L16", data: pcm.toString("base64") } }] } },
            ],
          }),
          { status: 200 },
        );
      }
      const promptText = body.contents?.[0]?.parts?.[0]?.text || "";
      if (promptText.includes("Reply with exactly: OK")) {
        return okTextResponse("OK");
      }
      if (promptText.includes("visual QA checker")) {
        return okTextResponse('{"verdict":"PASS","issues":[],"summary":"Clean framing."}');
      }
      return okTextResponse(
        '{"title":"The Pendulum Wall","beats":[{"text":"Two clocks hung side by side.","estSec":3.2}],"totalWords":6}',
      );
    },
  });

  // 1. Test connection falls back from Pro -> Flash
  const conn = await h.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  assert.equal(conn.ok, true);
  assert.equal(conn.effectiveModel, "gemini-3.8-flash");

  // 2. Subsequent /api/script immediately uses healthy Flash while Pro is in cooldown (0 wasted calls on Pro!)
  const callsBeforeScript = h.generateCalls.length;
  const scriptOut = await h.engine.runGeminiWithFallback({
    action: "script",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Write narration..." }] }),
    validate: validateScriptResponse,
  });
  assert.equal(scriptOut.ok, true);
  assert.equal(scriptOut.actualModel, "gemini-3.8-flash");
  assert.equal(scriptOut.preferredModel, "gemini-2.5-pro");
  assert.equal(scriptOut.downgraded, true);
  assert.equal(h.generateCalls.length - callsBeforeScript, 1);

  // 3. Vision resolver skips cooling Pro and routes to Flash
  const stillOut = await h.engine.runGeminiWithFallback({
    action: "check-still",
    capability: "vision",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "You are the visual QA checker" }] }),
    validate: validateStillVerdict,
  });
  assert.equal(stillOut.ok, true);
  assert.equal(stillOut.actualModel, "gemini-3.8-flash");
  assert.equal(stillOut.result.verdict, "PASS");

  // 4. TTS resolver selects ONLY TTS model and validates WAV header
  const ttsOut = await h.engine.runGeminiWithFallback({
    action: "tts",
    capability: "tts",
    settings: h.settings,
    payloadFactory: () => ({
      parts: [{ text: "Hello partner" }],
      generationConfig: { responseModalities: ["AUDIO"] },
    }),
    validate: validateTtsAudio,
  });
  assert.equal(ttsOut.ok, true);
  assert.equal(ttsOut.actualModel, "gemini-3.8-flash-tts");
  assert.equal(ttsOut.wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(ttsOut.wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(ttsOut.wav.readUInt32LE(24), 24000);
  assert.equal(ttsOut.wav.length, 44 + 4800);

  // 5. D3 #24: Advance clock past 90s cooldown and mark Pro healthy -> auto-upgrades back to Pro!
  h.advanceClock(95_000);
  proHealthy = true;
  const recovered = await h.engine.runGeminiWithFallback({
    action: "script",
    capability: "text",
    settings: h.settings,
    payloadFactory: () => ({ parts: [{ text: "Write narration..." }] }),
    validate: validateScriptResponse,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.actualModel, "gemini-2.5-pro");
  assert.equal(recovered.downgraded, false);
});

test("D3 #17 & #18: bad schema or missing TTS inlineData fails validation cleanly", () => {
  assert.throws(
    () =>
      validateScriptResponse({
        candidates: [{ content: { parts: [{ text: '{"title":"No beats"}' }] } }],
      }),
    /non-empty beats array/,
  );
  assert.throws(
    () =>
      validateStillVerdict({
        candidates: [{ content: { parts: [{ text: '{"verdict":"UNSURE","issues":[]}' }] } }],
      }),
    /invalid verdict/,
  );
  assert.throws(
    () =>
      validateTtsAudio({
        candidates: [{ content: { parts: [{ text: "I am a text model, no audio." }] } }],
      }),
    /no audio data/,
  );
});

test("D3 #21: AbortController cancels in-flight retry/request without persisting fake verification", async () => {
  const controller = new AbortController();
  const h = makeTestHarness({
    routeGenerate: () => {
      controller.abort();
      return errorResponse(503, "UNAVAILABLE", "Overloaded");
    },
  });

  const out = await h.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: h.settings,
    signal: controller.signal,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });

  assert.equal(out.ok, false);
  assert.equal(out.aborted, true);
  assert.equal(h.generateCalls.length, 1);
  assert.equal(h.healthRegistry.recentTrails.length, 0);
});

test("D3 #22 & #23: blank key preservation, legacy schema migration, secret masking, and manual ceiling", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oos-settings-test-"));
  try {
    const secretKey = "AIzaSuperSecretNeverLeakKey98765";
    // Legacy schema without selectionMode/modelPolicy
    fs.writeFileSync(
      path.join(tmpDir, "settings.json"),
      JSON.stringify({
        gemini: {
          apiKey: secretKey,
          textModel: "gemini-3.8-flash",
          visionModel: "gemini-3.8-flash",
          ttsModel: "gemini-3.8-flash-tts",
        },
      }),
    );

    const migrated = loadSettings(tmpDir);
    assert.equal(migrated.gemini.selectionMode, "auto");
    assert.equal(migrated.gemini.modelPolicy, "quality");
    assert.equal(migrated.gemini.apiKey, secretKey);

    // Saving blank apiKey preserves existing secretKey
    const { settings: afterBlank } = await updateProviderSettings(tmpDir, "gemini", {
      apiKey: "   ",
      selectionMode: "manual",
      textModel: "gemini-3.8-flash",
    });
    assert.equal(afterBlank.gemini.apiKey, secretKey);
    assert.equal(afterBlank.gemini.selectionMode, "manual");

    const masked = JSON.stringify(maskedSettings(afterBlank));
    assert.ok(!masked.includes(secretKey), "Full secret key must never appear in maskedSettings");
    assert.ok(masked.includes("••••••••98765"));

    // Manual mode never upgrades to higher tier (gemini-2.5-pro)
    const h = makeTestHarness({
      routeGenerate: () => okTextResponse("OK"),
    });
    saveSettings(tmpDir, afterBlank);
    const out = await h.engine.runGeminiWithFallback({
      action: "test-connection",
      capability: "text",
      settings: afterBlank,
      payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
      validate: validateConnectionReply,
    });
    assert.equal(out.ok, true);
    assert.equal(out.effectiveModel, "gemini-3.8-flash");
    assert.equal(h.generateCalls[0].model, "gemini-3.8-flash");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
