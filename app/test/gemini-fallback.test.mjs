import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createModelCatalogService } from "../server/gemini-models.mjs";
import {
  ModelHealthRegistry,
  chooseCandidateList,
  createGeminiExecutionEngine,
  retryWithBackoff,
  validateConnectionReply,
  validateScriptResponse,
  validateStillVerdict,
  validateTtsAudio,
} from "../server/gemini-transport.mjs";
import {
  defaultSettings,
  keyFingerprint,
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

test("OOS-03: Retry-After never retries early, stops when exceeding budget, and unknown-scope 429 does not model-hop", async () => {
  // 1. Retry-After of 6s (> maxDelayMs*2 = 4s) is honored in full (never clamped down to 4s)
  const sleeps = [];
  let attempts = 0;
  const res = await retryWithBackoff(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error("Gemini HTTP 429: RPM limit for model");
        err.status = 429;
        err.quotaScope = "model";
        err.retryAfterMs = 6_000;
        throw err;
      }
      return "OK";
    },
    {
      maxRetries: 1,
      baseDelayMs: 200,
      maxDelayMs: 2_000,
      sleepImpl: async (ms) => sleeps.push(ms),
    },
  );
  assert.equal(res, "OK");
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 6_000);

  // 2. Retry-After exceeding budget (45s > 30s maxRetryWaitMs) stops immediately without sleeping or retrying early
  const budgetSleeps = [];
  await assert.rejects(
    () =>
      retryWithBackoff(
        async () => {
          const err = new Error("Gemini HTTP 429: RPM limit for model");
          err.status = 429;
          err.quotaScope = "model";
          err.retryAfterMs = 45_000;
          throw err;
        },
        {
          maxRetries: 2,
          baseDelayMs: 200,
          maxDelayMs: 2_000,
          maxRetryWaitMs: 10_000,
          sleepImpl: async (ms) => budgetSleeps.push(ms),
        },
      ),
    (err) => err.retryAfterExceededBudget === true && err.attemptsUsed === 1,
  );
  assert.equal(budgetSleeps.length, 0);

  // 3. Unknown-scope 429 without PerModel indicator halts without hopping to fallback models
  const hUnknown429 = makeTestHarness({
    routeGenerate: () =>
      errorResponse(429, "RESOURCE_EXHAUSTED", "Resource has been exhausted (e.g. check quota)."),
  });
  const outUnknown = await hUnknown429.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: hUnknown429.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  assert.equal(outUnknown.ok, false);
  assert.equal(outUnknown.reasonCategory, "quota_global");
  assert.equal(hUnknown429.generateCalls.length, 1);
});

test("OOS-03: safety block stops immediately, failed config adaptation records both attempts, and validators enforce strict contracts", async () => {
  // 1. Safety block stops with 0 retries and 0 fallback
  const hSafety = makeTestHarness({
    routeGenerate: () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  const safetyOut = await hSafety.engine.runGeminiWithFallback({
    action: "script",
    capability: "text",
    settings: hSafety.settings,
    payloadFactory: () => ({ parts: [{ text: "Write narration" }] }),
    validate: validateScriptResponse,
  });
  assert.equal(safetyOut.ok, false);
  assert.equal(safetyOut.reasonCategory, "safety");
  assert.equal(hSafety.generateCalls.length, 1);

  // 2. Config adaptation failure records BOTH initial 400 and adapted 400 in attemptedModels
  const hAdaptFail = makeTestHarness({
    routeGenerate: () =>
      errorResponse(400, "INVALID_ARGUMENT", "Invalid generationConfig maxOutputTokens value"),
  });
  const adaptFailOut = await hAdaptFail.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: hAdaptFail.settings,
    payloadFactory: ({ adapted }) => ({
      parts: [{ text: "Reply with exactly: OK" }],
      generationConfig: adapted ? undefined : { maxOutputTokens: 512 },
      adaptedApplied: Boolean(adapted),
    }),
    validate: validateConnectionReply,
  });
  assert.equal(adaptFailOut.ok, false);
  assert.equal(adaptFailOut.attemptedModels.length, 2);
  assert.equal(adaptFailOut.attemptedModels[1].configAdapted, true);

  // 3. Validators: estSec <= 0, totalWords <= 0, silent PCM, and odd PCM rejected
  assert.throws(
    () =>
      validateScriptResponse({
        candidates: [
          {
            content: {
              parts: [{ text: '{"title":"Zero Sec","beats":[{"text":"Hello world","estSec":0}],"totalWords":2}' }],
            },
          },
        ],
      }),
    /finite positive estSec/,
  );
  assert.throws(
    () =>
      validateScriptResponse({
        candidates: [
          {
            content: {
              parts: [{ text: '{"title":"Bad Words","beats":[{"text":"Hello world","estSec":3}],"totalWords":0}' }],
            },
          },
        ],
      }),
    /finite positive number/,
  );
  assert.throws(
    () =>
      validateTtsAudio({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "audio/L16", data: Buffer.alloc(480, 0).toString("base64") } }],
            },
          },
        ],
      }),
    /silent all-zero PCM/,
  );
  assert.throws(
    () =>
      validateTtsAudio({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "audio/L16", data: Buffer.alloc(10, 1).toString("base64") } }],
            },
          },
        ],
      }),
    /Invalid PCM16 audio buffer length/,
  );

  // 4. FAIL verdict in validateStillVerdict is a valid QA result (not an exception)
  const failVerdict = validateStillVerdict({
    candidates: [
      {
        content: {
          parts: [{ text: '{"verdict":"fail","issues":[" Scroll clipped at right edge "],"summary":"Clipped."}' }],
        },
      },
    ],
  });
  assert.equal(failVerdict.result.verdict, "FAIL");
  assert.deepEqual(failVerdict.result.issues, ["Scroll clipped at right edge"]);
});

test("OOS-03: candidate health ordering, verified TTL expiry, anti-thundering-herd recovery probe, anti-oscillation backoff, semaphore abort, and capability guards", async () => {
  let now = 2_000_000_000_000;
  const reg = new ModelHealthRegistry({ clock: () => now, verifiedTtlMs: 60_000 });
  const settings = defaultSettings();
  settings.gemini.apiKey = "AIzaHealthTestKey1234567890";
  const fp = keyFingerprint(settings.gemini.apiKey);

  // 1. Non-primary candidate (#2 gemini-3.8-flash) in cooldown must NOT stay ahead of healthy #3 (gemini-2.5-flash-lite)
  reg.markCooldown(fp, "gemini-3.8-flash", { durationMs: 60_000, reason: "overload", statusCode: 503 });
  const selMidCooling = chooseCandidateList({
    capability: "text",
    settings,
    catalogModels: CATALOG_FIXTURE,
    healthRegistry: reg,
    keyFp: fp,
    maxCandidates: 3,
  });
  assert.equal(selMidCooling.candidates[0].id, "gemini-2.5-pro");
  assert.equal(selMidCooling.candidates[1].id, "gemini-2.5-flash-lite");

  // 2. Known 404 unsupported model is excluded from candidate list while catalog is unchanged and healthy models exist
  reg.markCooldown(fp, "gemini-2.5-pro", { durationMs: 300_000, reason: "unsupported", statusCode: 404 });
  const selSkip404 = chooseCandidateList({
    capability: "text",
    settings,
    catalogModels: CATALOG_FIXTURE,
    healthRegistry: reg,
    keyFp: fp,
    maxCandidates: 3,
  });
  assert.ok(!selSkip404.candidates.some((c) => c.id === "gemini-2.5-pro"));
  assert.equal(selSkip404.candidates[0].id, "gemini-2.5-flash-lite");

  // 3. Verified TTL expiry + anti-oscillation exponential cooldown multiplier
  reg.recordVerifiedSuccess(fp, "text", {
    effectiveModel: "gemini-3.8-flash",
    preferredModel: "gemini-2.5-pro",
    downgraded: true,
    reason: "overload",
    latencyMs: 120,
  });
  assert.equal(reg.getVerified(fp, "text")?.effectiveModel, "gemini-3.8-flash");
  now += 61_000;
  assert.equal(reg.getVerified(fp, "text"), null); // expired after TTL

  reg.markCooldown(fp, "gemini-3.8-flash", { durationMs: 60_000, reason: "overload", statusCode: 503 });
  const firstCd = reg.getCooldown(fp, "gemini-3.8-flash").durationMs;
  reg.markCooldown(fp, "gemini-3.8-flash", { durationMs: 60_000, reason: "overload", statusCode: 503 });
  const secondCd = reg.getCooldown(fp, "gemini-3.8-flash").durationMs;
  assert.ok(secondCd > firstCd, `Expected anti-oscillation backoff (${secondCd} > ${firstCd})`);

  // 4. Manual mode capability guard: never switch TTS to text model or Vision to text-only gemini-1.0-pro
  const manualSettings = defaultSettings();
  manualSettings.gemini.selectionMode = "manual";
  manualSettings.gemini.ttsModel = "gemini-2.5-pro"; // invalid text model for TTS
  manualSettings.gemini.visionModel = "gemini-1.0-pro"; // text-only model for Vision

  const ttsManual = chooseCandidateList({
    capability: "tts",
    settings: manualSettings,
    catalogModels: CATALOG_FIXTURE,
    healthRegistry: reg,
    keyFp: fp,
    maxCandidates: 3,
  });
  assert.ok(ttsManual.candidates.every((c) => c.id.includes("-tts")));

  const visionManual = chooseCandidateList({
    capability: "vision",
    settings: manualSettings,
    catalogModels: CATALOG_FIXTURE,
    healthRegistry: reg,
    keyFp: fp,
    maxCandidates: 3,
  });
  assert.ok(!visionManual.candidates.some((c) => c.id === "gemini-1.0-pro"));

  // 5. Anti-thundering-herd concurrent recovery probe + semaphore cancellation
  let proHealthy = false;
  const hProbe = makeTestHarness({
    routeGenerate: async ({ model }) => {
      if (model === "gemini-2.5-pro" && !proHealthy) {
        return errorResponse(503, "UNAVAILABLE", "Overloaded");
      }
      await new Promise((r) => setTimeout(r, 20));
      return okTextResponse("OK");
    },
  });
  // Put gemini-2.5-pro into cooldown and verify gemini-3.8-flash
  await hProbe.engine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: hProbe.settings,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  // Advance past Pro cooldown and mark Pro healthy
  proHealthy = true;
  hProbe.advanceClock(95_000);
  const callsBeforeConcurrent = hProbe.generateCalls.length;
  const [p1, p2] = await Promise.all([
    hProbe.engine.runGeminiWithFallback({
      action: "test-connection",
      capability: "text",
      settings: hProbe.settings,
      payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
      validate: validateConnectionReply,
    }),
    hProbe.engine.runGeminiWithFallback({
      action: "test-connection",
      capability: "text",
      settings: hProbe.settings,
      payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
      validate: validateConnectionReply,
    }),
  ]);
  assert.equal(p1.ok, true);
  assert.equal(p2.ok, true);
  const concurrentModels = hProbe.generateCalls.slice(callsBeforeConcurrent).map((c) => c.model);
  // Request 1 probes recovering gemini-2.5-pro; Request 2 uses healthy gemini-3.8-flash instead of piling onto Pro
  assert.deepEqual(concurrentModels.sort(), ["gemini-2.5-pro", "gemini-3.8-flash"]);
});

test("OOS-03: semaphore queue cancellation, request budget cap, overall deadline exhaustion, and multi-key isolation", async () => {
  let now = 3_000_000_000_000;
  let releaseFirstFetch;
  const firstFetchStarted = new Promise((resolve) => {
    releaseFirstFetch = resolve;
  });
  let gatePromiseResolve;
  const gatePromise = new Promise((resolve) => {
    gatePromiseResolve = resolve;
  });

  let callNum = 0;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/models")) {
      return new Response(JSON.stringify({ models: CATALOG_FIXTURE }), { status: 200 });
    }
    callNum += 1;
    if (callNum === 1) {
      releaseFirstFetch();
      await gatePromise;
    }
    return okTextResponse("OK");
  };

  const reg = new ModelHealthRegistry({ clock: () => now });
  const cat = createModelCatalogService({ fetchImpl, clock: () => now });
  const semEngine = createGeminiExecutionEngine({
    catalogService: cat,
    healthRegistry: reg,
    fetchImpl,
    clock: () => now,
    maxConcurrent: 1,
    maxCandidates: 3,
    maxTotalRequests: 2,
    overallDeadlineMs: 5_000,
  });

  const s1 = defaultSettings();
  s1.gemini.apiKey = "AIzaSemaphoreTestKeyAlpha111111";

  // Start request #1 (occupies the single semaphore slot)
  const req1Promise = semEngine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: s1,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  await firstFetchStarted;

  // Start request #2 (queued on semaphore) and abort it while queued
  const abortQueued = new AbortController();
  const req2Promise = semEngine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: s1,
    signal: abortQueued.signal,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  abortQueued.abort();
  const res2 = await req2Promise;
  assert.equal(res2.ok, false);
  assert.equal(res2.aborted, true);

  // Release request #1 and ensure semaphore is healthy for request #3
  gatePromiseResolve();
  const res1 = await req1Promise;
  assert.equal(res1.ok, true);

  const res3 = await semEngine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: s1,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  assert.equal(res3.ok, true);

  // Enforce maxTotalRequests = 2 budget cap when all candidates return 503
  let budgetCalls = 0;
  const budgetFetch = async (url) => {
    if (new URL(url).pathname.endsWith("/models")) {
      return new Response(JSON.stringify({ models: CATALOG_FIXTURE }), { status: 200 });
    }
    budgetCalls += 1;
    return errorResponse(503, "UNAVAILABLE", "Always overloaded");
  };
  const budgetEngine = createGeminiExecutionEngine({
    catalogService: createModelCatalogService({ fetchImpl: budgetFetch, clock: () => now }),
    healthRegistry: new ModelHealthRegistry({ clock: () => now }),
    fetchImpl: budgetFetch,
    clock: () => now,
    sleepImpl: async (ms) => {
      now += ms;
    },
    maxCandidates: 3,
    maxTotalRequests: 2,
    maxRetriesPerCandidate: 2,
  });
  const budgetRes = await budgetEngine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: s1,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  assert.equal(budgetRes.ok, false);
  assert.equal(budgetCalls, 2);
  assert.equal(budgetRes.attemptedModels.length, 2);

  // Enforce overallDeadlineMs exhaustion
  const deadlineEngine = createGeminiExecutionEngine({
    catalogService: createModelCatalogService({ fetchImpl: budgetFetch, clock: () => now }),
    healthRegistry: new ModelHealthRegistry({ clock: () => now }),
    fetchImpl: async (url) => {
      if (new URL(url).pathname.endsWith("/models")) {
        return new Response(JSON.stringify({ models: CATALOG_FIXTURE }), { status: 200 });
      }
      now += 10_000; // exceed deadline during first attempt
      return errorResponse(503, "UNAVAILABLE", "Slow 503");
    },
    clock: () => now,
    sleepImpl: async (ms) => {
      now += ms;
    },
    overallDeadlineMs: 1_000,
    maxCandidates: 3,
    maxTotalRequests: 6,
  });
  const deadlineRes = await deadlineEngine.runGeminiWithFallback({
    action: "test-connection",
    capability: "text",
    settings: s1,
    payloadFactory: () => ({ parts: [{ text: "Reply with exactly: OK" }] }),
    validate: validateConnectionReply,
  });
  assert.equal(deadlineRes.ok, false);
  assert.equal(deadlineRes.attemptedModels.length, 1);
});
