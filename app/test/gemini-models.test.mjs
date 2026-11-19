import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyGeminiModel,
  createModelCatalogService,
  fetchGeminiModelCatalog,
  normalizeModelId,
  rankGeminiModels,
} from "../server/gemini-models.mjs";

const SAMPLE_RAW_MODELS = [
  {
    name: "models/gemini-embedding-001",
    displayName: "Gemini Embedding 001",
    supportedGenerationMethods: ["embedContent", "countTokens"],
    inputTokenLimit: 2048,
    outputTokenLimit: 1,
  },
  {
    name: "models/gemini-3.8-live",
    displayName: "Gemini 3.8 Live",
    supportedGenerationMethods: ["bidiGenerateContent"],
    inputTokenLimit: 131072,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3-pro-image",
    displayName: "Nano Banana Pro",
    description: "Gemini 3 Pro Image",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 131072,
    outputTokenLimit: 32768,
  },
  {
    name: "models/lyria-3.5",
    displayName: "Lyria 3.5",
    description: "Music Generation model",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/deep-research-pro-preview-12-2025",
    displayName: "Deep Research Pro Preview [Rerouted]",
    description: "Deprecated preview agent; automatically rerouting traffic",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-2.5-flash-lite",
    displayName: "Gemini 2.5 Flash-Lite",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash Lite",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.7-flash",
    displayName: "Gemini 3.7 Flash",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-pro-latest",
    displayName: "Gemini Pro Latest",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
  },
  {
    name: "models/gemini-3.1-pro-preview",
    displayName: "Gemini 3.1 Pro Preview",
    supportedGenerationMethods: ["generateContent", "countTokens"],
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
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 8192,
    outputTokenLimit: 16384,
  },
  {
    name: "models/gemini-3.8-flash-lite-tts",
    displayName: "Gemini 3.8 Flash Lite TTS",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 8192,
    outputTokenLimit: 16384,
  },
  {
    name: "models/gemini-2.5-pro-preview-tts",
    displayName: "Gemini 2.5 Pro Preview TTS",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 8192,
    outputTokenLimit: 16384,
  },
];

test("normalizeModelId strips single models/ prefix and rejects unsafe IDs", () => {
  assert.equal(normalizeModelId("models/gemini-2.5-pro"), "gemini-2.5-pro");
  assert.equal(normalizeModelId("gemini-3.8-flash"), "gemini-3.8-flash");
  assert.throws(() => normalizeModelId("models/models/gemini-2.5-pro"), /Invalid model identifier/);
  assert.throws(() => normalizeModelId("../v1alpha/secret"), /Invalid model identifier/);
  assert.throws(() => normalizeModelId(""), /empty/);
});

test("D3 #02 & #15: multi-page discovery + capability classification excludes non-matching models", async () => {
  const pages = [
    { models: SAMPLE_RAW_MODELS.slice(0, 6), nextPageToken: "tok_2" },
    { models: SAMPLE_RAW_MODELS.slice(6, 12), nextPageToken: "tok_3" },
    { models: SAMPLE_RAW_MODELS.slice(12) },
  ];
  let calls = 0;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const token = u.searchParams.get("pageToken") || "";
    calls += 1;
    const idx = token === "" ? 0 : token === "tok_2" ? 1 : 2;
    return new Response(JSON.stringify(pages[idx]), { status: 200 });
  };

  const service = createModelCatalogService({ fetchImpl });
  const res = await service.listGeminiModels("AIzaFakeTestKey1234567890123456");
  assert.equal(calls, 3);
  assert.equal(res.pagesFetched, 3);
  assert.equal(res.totalDiscovered, SAMPLE_RAW_MODELS.length);

  const textRanked = rankGeminiModels(res.models, { capability: "text", policy: "quality" }).map((m) => m.id);
  const visionRanked = rankGeminiModels(res.models, { capability: "vision", policy: "quality" }).map((m) => m.id);
  const ttsRanked = rankGeminiModels(res.models, { capability: "tts", policy: "quality" }).map((m) => m.id);

  // Embeddings, live, Nano Banana image-gen, Lyria music, deprecated agents, and TTS are excluded from text
  for (const excluded of [
    "gemini-embedding-001",
    "gemini-3.8-live",
    "gemini-3-pro-image",
    "lyria-3.5",
    "deep-research-pro-preview-12-2025",
    "gemini-3.8-flash-tts",
  ]) {
    assert.ok(!textRanked.includes(excluded), `Expected ${excluded} excluded from text`);
  }

  // Legacy text-only gemini-1.0-pro is eligible for text but excluded from vision
  assert.ok(textRanked.includes("gemini-1.0-pro"));
  assert.ok(!visionRanked.includes("gemini-1.0-pro"));

  // TTS includes ONLY audio TTS models, never Pro text
  assert.deepEqual(ttsRanked, ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]);
  assert.ok(!ttsRanked.includes("gemini-2.5-pro"));
});

test("D3 #03 & #23: ranking is deterministic regardless of API order and respects policy/preview", () => {
  const forward = rankGeminiModels(SAMPLE_RAW_MODELS, {
    capability: "text",
    policy: "quality",
    includePreview: false,
  }).map((m) => m.id);

  const reversed = rankGeminiModels(SAMPLE_RAW_MODELS.slice().reverse(), {
    capability: "text",
    policy: "quality",
    includePreview: false,
  }).map((m) => m.id);

  assert.deepEqual(forward, reversed);
  // Highest quality picks concrete stable Pro first, NOT first item in SAMPLE_RAW_MODELS
  assert.equal(forward[0], "gemini-2.5-pro");
  assert.equal(forward[1], "gemini-pro-latest");
  assert.equal(forward[2], "gemini-3.8-flash");
  assert.ok(!forward.includes("gemini-3.1-pro-preview"));

  // With includePreview: true, preview Pro is included behind stable Pro
  const withPreview = rankGeminiModels(SAMPLE_RAW_MODELS, {
    capability: "text",
    policy: "quality",
    includePreview: true,
  }).map((m) => m.id);
  assert.ok(withPreview.includes("gemini-3.1-pro-preview"));
  assert.equal(withPreview[0], "gemini-2.5-pro");

  // Balanced policy prefers Flash > Flash-Lite > Pro
  const balanced = rankGeminiModels(SAMPLE_RAW_MODELS, {
    capability: "text",
    policy: "balanced",
  }).map((m) => m.id);
  assert.equal(balanced[0], "gemini-3.8-flash");

  // Fast policy prefers Flash-Lite > Flash > Pro
  const fast = rankGeminiModels(SAMPLE_RAW_MODELS, {
    capability: "text",
    policy: "fast",
  }).map((m) => m.id);
  assert.equal(fast[0], "gemini-3.5-flash-lite");
});

test("D3 #19 & #20: catalog service caches within TTL, coalesces single-flight, and invalidates per key", async () => {
  let now = 1_000_000;
  let networkHits = 0;

  const fetchImpl = async () => {
    networkHits += 1;
    await new Promise((r) => setTimeout(r, 15));
    return new Response(JSON.stringify({ models: SAMPLE_RAW_MODELS.slice(5, 10) }), { status: 200 });
  };

  const service = createModelCatalogService({
    fetchImpl,
    clock: () => now,
    cacheTtlMs: 60_000,
  });

  // Single-flight coalescing across concurrent callers
  const [a, b, c] = await Promise.all([
    service.listGeminiModels("key-alpha-123456"),
    service.listGeminiModels("key-alpha-123456"),
    service.listGeminiModels("key-alpha-123456"),
  ]);
  assert.equal(networkHits, 1);
  assert.equal(a.totalDiscovered, b.totalDiscovered);
  assert.equal(b.totalDiscovered, c.totalDiscovered);

  // Within TTL -> served from cache
  now += 30_000;
  const cached = await service.listGeminiModels("key-alpha-123456");
  assert.equal(cached.fromCache, true);
  assert.equal(networkHits, 1);

  // Different API key -> cache miss
  await service.listGeminiModels("key-bravo-654321");
  assert.equal(networkHits, 2);

  // TTL expired -> refetches
  now += 61_000;
  const expired = await service.listGeminiModels("key-alpha-123456");
  assert.equal(expired.fromCache, false);
  assert.equal(networkHits, 3);

  // Explicit forceRefresh -> refetches immediately
  const forced = await service.listGeminiModels("key-alpha-123456", { forceRefresh: true });
  assert.equal(forced.fromCache, false);
  assert.equal(networkHits, 4);
});

test("classifyGeminiModel respects SDK supportedActions alias", () => {
  const m = classifyGeminiModel({
    name: "models/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    supportedActions: ["generateContent"],
    inputTokenLimit: 1048576,
  });
  assert.equal(m.capabilities.text, true);
  assert.equal(m.capabilities.vision, true);
  assert.equal(m.candidateOnly, true);
  assert.equal(m.verificationState, "unverified_candidate");
});

test("OOS-03 catalog matrix: no key, duplicate IDs, pagination loop detection, misleading displayName, unknown metadata, and concurrent forceRefresh/abort", async () => {
  // 1. No API key throws NO_API_KEY without network calls
  let hit = 0;
  await assert.rejects(
    () =>
      fetchGeminiModelCatalog("   ", {
        fetchImpl: async () => {
          hit += 1;
          return new Response("{}", { status: 200 });
        },
      }),
    (err) => err.code === "NO_API_KEY",
  );
  assert.equal(hit, 0);

  // 2. Duplicate IDs across pages + pagination loop detection (tok_loop repeats)
  const loopPages = {
    "": {
      models: [
        SAMPLE_RAW_MODELS[5],
        SAMPLE_RAW_MODELS[6],
      ],
      nextPageToken: "tok_loop",
    },
    tok_loop: {
      models: [
        SAMPLE_RAW_MODELS[5], // duplicate ID
        SAMPLE_RAW_MODELS[7],
      ],
      nextPageToken: "tok_loop", // cycle!
    },
  };
  let loopCalls = 0;
  const loopRes = await fetchGeminiModelCatalog("AIzaLoopDetectionTestKey1234567", {
    fetchImpl: async (url) => {
      loopCalls += 1;
      const tok = new URL(url).searchParams.get("pageToken") || "";
      return new Response(JSON.stringify(loopPages[tok]), { status: 200 });
    },
  });
  assert.equal(loopCalls, 2);
  assert.equal(loopRes.loopDetected, true);
  assert.equal(loopRes.totalDiscovered, 3); // deduplicated

  // 3. Misleading displayName: non-TTS text model mentioning "TTS" in displayName must NOT be classified as TTS
  const misleadingTts = classifyGeminiModel({
    name: "models/gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash (TTS Narrator Helper)",
    supportedGenerationMethods: ["generateContent"],
    inputTokenLimit: 1048576,
  });
  assert.equal(misleadingTts.isTts, false);
  assert.equal(misleadingTts.capabilities.tts, false);
  assert.equal(misleadingTts.capabilities.text, true);
  assert.equal(misleadingTts.capabilityConfidence, "low");

  // 4. Unknown/sparse metadata: missing inputTokenLimit and missing supportedInputModalities -> conservative vision=false, confidence=low
  const sparseModel = classifyGeminiModel({
    name: "models/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    supportedGenerationMethods: ["generateContent"],
  });
  assert.equal(sparseModel.capabilities.text, true);
  assert.equal(sparseModel.capabilities.vision, false);
  assert.equal(sparseModel.capabilityConfidence, "low");
  assert.equal(sparseModel.candidateOnly, true);

  // Explicit IMAGE input modality enables vision even if inputTokenLimit is omitted
  const explicitVision = classifyGeminiModel({
    name: "models/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    supportedGenerationMethods: ["generateContent"],
    supportedInputModalities: ["TEXT", "IMAGE"],
    supportedOutputModalities: ["TEXT"],
  });
  assert.equal(explicitVision.capabilities.vision, true);
  assert.equal(explicitVision.capabilityConfidence, "high");

  // 5. rankGeminiModels attaches rankSource and rankRationale
  const rankedWithMeta = rankGeminiModels(SAMPLE_RAW_MODELS, {
    capability: "text",
    policy: "quality",
  });
  assert.equal(rankedWithMeta[0].rankSource, "tier_heuristic_candidate");
  assert.match(rankedWithMeta[0].rankRationale, /catalog candidate only/);

  // 6. Concurrent forceRefresh coalescing + single caller abort isolation
  let refreshHits = 0;
  const svc = createModelCatalogService({
    fetchImpl: async () => {
      refreshHits += 1;
      await new Promise((r) => setTimeout(r, 30));
      return new Response(JSON.stringify({ models: SAMPLE_RAW_MODELS.slice(5, 8) }), { status: 200 });
    },
  });
  const abortCtrl = new AbortController();
  setTimeout(() => abortCtrl.abort(), 5);

  const [abortedOutcome, validOutcome1, validOutcome2] = await Promise.allSettled([
    svc.listGeminiModels("key-coalesce-999", { forceRefresh: true, signal: abortCtrl.signal }),
    svc.listGeminiModels("key-coalesce-999", { forceRefresh: true }),
    svc.listGeminiModels("key-coalesce-999", { forceRefresh: true }),
  ]);
  assert.equal(abortedOutcome.status, "rejected");
  assert.equal(abortedOutcome.reason?.name, "AbortError");
  assert.equal(validOutcome1.status, "fulfilled");
  assert.equal(validOutcome2.status, "fulfilled");
  assert.equal(refreshHits, 1);
});
