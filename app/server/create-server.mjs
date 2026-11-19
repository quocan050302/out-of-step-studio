import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DISCOVERY_TTL_MS,
  DEFAULT_GEMINI_BASE,
  classifyGeminiModel,
  createModelCatalogService,
  rankGeminiModels,
} from "./gemini-models.mjs";
import {
  ModelHealthRegistry,
  classifyGeminiError,
  createGeminiExecutionEngine,
  validateConnectionReply,
  validateScriptResponse,
  validateStillVerdict,
  validateTtsAudio,
} from "./gemini-transport.mjs";
import {
  atomicWriteBufferSync,
  keyFingerprint,
  loadRuntimeState,
  loadSettings,
  maskedSettings,
  redactSecrets,
  saveRuntimeState,
  updateProviderSettings,
  withDataDirLock,
} from "./settings-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIR = path.resolve(__dirname, "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, obj) {
  if (res.writableEnded) return;
  const body = JSON.stringify(obj);
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        const err = new Error("Request body too large (limit 12 MB)");
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("Invalid JSON request body.");
    err.statusCode = 400;
    throw err;
  }
}

function createRequestAbortSignal(res) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
}

function buildRankedMap(models, settings) {
  const policy = settings?.gemini?.modelPolicy || "quality";
  const includePreview = Boolean(settings?.gemini?.includePreview);
  return {
    text: rankGeminiModels(models, { capability: "text", policy, includePreview }),
    vision: rankGeminiModels(models, { capability: "vision", policy, includePreview }),
    tts: rankGeminiModels(models, { capability: "tts", policy, includePreview }),
  };
}

function sanitizeCatalogForClient(models) {
  return models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    version: m.version,
    tier: m.tier,
    familyVersion: m.familyVersion,
    isPreview: m.isPreview,
    isStable: m.isStable,
    isRollingAlias: m.isRollingAlias,
    costTier: m.costTier,
    inputTokenLimit: m.inputTokenLimit,
    outputTokenLimit: m.outputTokenLimit,
    capabilities: m.capabilities,
    exclusionReason: m.exclusionReason,
    candidateOnly: m.candidateOnly !== false,
    verificationState: m.verificationState || "unverified_candidate",
    capabilityConfidence: m.capabilityConfidence || "medium",
    ...(m.rank ? { rank: m.rank } : {}),
    ...(m.rankSource ? { rankSource: m.rankSource } : {}),
    ...(m.rankRationale ? { rankRationale: m.rankRationale } : {}),
  }));
}

export function createStudioServer({
  appDir = DEFAULT_APP_DIR,
  dataDir = process.env.STUDIO_DATA_DIR || path.join(appDir, "data"),
  geminiBaseUrl = process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  rng = Math.random,
  sleepImpl,
  cacheTtlMs = DEFAULT_DISCOVERY_TTL_MS,
  discoveryTimeoutMs = Number(process.env.GEMINI_DISCOVERY_TIMEOUT_MS || 20_000),
  overallDeadlineMs = Number(process.env.GEMINI_DEADLINE_MS || 300_000),
  attemptTimeoutMs = Number(process.env.GEMINI_ATTEMPT_TIMEOUT_MS || 285_000),
  maxCandidates = Number(process.env.GEMINI_MAX_CANDIDATES || 3),
  maxTotalRequests = Number(process.env.GEMINI_MAX_REQUESTS || 6),
  maxRetriesPerCandidate = Number(process.env.GEMINI_MAX_RETRIES || 2),
  baseRetryDelayMs = Number(process.env.GEMINI_RETRY_BASE_MS || 600),
  maxRetryDelayMs = Number(process.env.GEMINI_RETRY_MAX_MS || 4_000),
  maxConcurrent = Number(process.env.GEMINI_MAX_CONCURRENT || 4),
} = {}) {
  const publicDir = path.join(appDir, "public");
  const builtDir = path.join(appDir, "dist");

  const initialRuntime = loadRuntimeState(dataDir);
  const healthRegistry = new ModelHealthRegistry({
    clock,
    initialState: initialRuntime,
    onPersist: (nextState) => {
      try {
        saveRuntimeState(dataDir, nextState);
      } catch {
        // Non-fatal persistence failure
      }
    },
  });

  const catalogService = createModelCatalogService({
    baseUrl: geminiBaseUrl,
    fetchImpl,
    cacheTtlMs,
    clock,
    timeoutMs: discoveryTimeoutMs,
  });

  const executionEngine = createGeminiExecutionEngine({
    catalogService,
    healthRegistry,
    baseUrl: geminiBaseUrl,
    fetchImpl,
    clock,
    rng,
    sleepImpl,
    maxCandidates,
    maxTotalRequests,
    maxRetriesPerCandidate,
    baseRetryDelayMs,
    maxRetryDelayMs,
    overallDeadlineMs,
    attemptTimeoutMs,
    maxConcurrent,
  });

  function computeHealthSnapshot(settings) {
    const fp = keyFingerprint(settings.gemini.apiKey);
    healthRegistry.syncKeyFingerprint(fp);
    const cached = catalogService.getCachedSnapshot(settings.gemini.apiKey);
    const ranked = cached ? buildRankedMap(cached.models, settings) : {};
    const summary = healthRegistry.getSanitizedSummary(fp, settings, ranked);
    return {
      ...summary,
      catalogSyncedAt: cached?.syncedAt || null,
      catalogStale: cached ? cached.stale : true,
      totalDiscovered: cached?.totalDiscovered ?? null,
    };
  }

  function serveStatic(req, res, urlPath) {
    const staticDir = fs.existsSync(path.join(builtDir, "index.html")) ? builtDir : publicDir;
    let rel = urlPath === "/" ? "/index.html" : urlPath;
    rel = decodeURIComponent(rel.split("?")[0]);
    const file = path.resolve(staticDir, "." + rel);
    if (
      !(file === staticDir || file.startsWith(staticDir + path.sep)) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const p = url.pathname;
    const signal = createRequestAbortSignal(res);

    try {
      if (p === "/api/settings" && req.method === "GET") {
        const s = loadSettings(dataDir);
        const health = computeHealthSnapshot(s);
        return sendJson(res, 200, { ok: true, providers: maskedSettings(s, health) });
      }

      if (p === "/api/settings" && req.method === "POST") {
        const body = await readJsonBody(req);
        const { provider, fields } = body || {};
        try {
          const updated = await updateProviderSettings(dataDir, provider, fields);
          if (updated.geminiKeyChanged) {
            catalogService.invalidate();
            healthRegistry.syncKeyFingerprint(updated.keyFp);
          } else if (updated.geminiConfigChanged) {
            healthRegistry.invalidateVerified(updated.keyFp);
          }
          const health = computeHealthSnapshot(updated.settings);
          return sendJson(res, 200, {
            ok: true,
            providers: maskedSettings(updated.settings, health),
          });
        } catch (err) {
          const code = err?.statusCode || 400;
          return sendJson(res, code, { ok: false, error: String(err.message || err) });
        }
      }

      if (p === "/api/gemini/status" && req.method === "GET") {
        const s = loadSettings(dataDir);
        const health = computeHealthSnapshot(s);
        return sendJson(res, 200, {
          ok: true,
          hasKey: Boolean(s.gemini.apiKey),
          health,
        });
      }

      if (p === "/api/gemini/models" && req.method === "GET") {
        const s = loadSettings(dataDir);
        if (!s.gemini.apiKey) {
          return sendJson(res, 200, {
            ok: true,
            hasKey: false,
            models: [],
            ranked: { text: [], vision: [], tts: [] },
            syncedAt: null,
          });
        }
        const forceRefresh = url.searchParams.get("refresh") === "1";
        try {
          const cat = await catalogService.listGeminiModels(s.gemini.apiKey, {
            signal,
            forceRefresh,
          });
          const ranked = buildRankedMap(cat.models, s);
          return sendJson(res, 200, {
            ok: true,
            hasKey: true,
            fromCache: Boolean(cat.fromCache),
            syncedAt: cat.syncedAt,
            totalDiscovered: cat.totalDiscovered,
            models: sanitizeCatalogForClient(cat.models),
            ranked: {
              text: sanitizeCatalogForClient(ranked.text).map((m, idx) => ({ ...m, rank: idx + 1 })),
              vision: sanitizeCatalogForClient(ranked.vision).map((m, idx) => ({ ...m, rank: idx + 1 })),
              tts: sanitizeCatalogForClient(ranked.tts).map((m, idx) => ({ ...m, rank: idx + 1 })),
            },
            health: computeHealthSnapshot(s),
          });
        } catch (err) {
          const info = classifyGeminiError(err);
          return sendJson(res, 200, {
            ok: false,
            reasonCategory: info.category,
            error: redactSecrets(err?.message || info.summary, [s.gemini.apiKey]),
          });
        }
      }

      if (p === "/api/gemini/discover" && req.method === "POST") {
        const s = loadSettings(dataDir);
        if (!s.gemini.apiKey) {
          return sendJson(res, 200, {
            ok: false,
            reasonCategory: "no_key",
            error: "No Gemini API key saved. Add one in Settings.",
          });
        }
        try {
          const cat = await catalogService.listGeminiModels(s.gemini.apiKey, {
            signal,
            forceRefresh: true,
          });
          const ranked = buildRankedMap(cat.models, s);
          return sendJson(res, 200, {
            ok: true,
            syncedAt: cat.syncedAt,
            pagesFetched: cat.pagesFetched,
            totalDiscovered: cat.totalDiscovered,
            models: sanitizeCatalogForClient(cat.models),
            ranked: {
              text: sanitizeCatalogForClient(ranked.text).map((m, idx) => ({ ...m, rank: idx + 1 })),
              vision: sanitizeCatalogForClient(ranked.vision).map((m, idx) => ({ ...m, rank: idx + 1 })),
              tts: sanitizeCatalogForClient(ranked.tts).map((m, idx) => ({ ...m, rank: idx + 1 })),
            },
            health: computeHealthSnapshot(s),
          });
        } catch (err) {
          const info = classifyGeminiError(err);
          return sendJson(res, 200, {
            ok: false,
            reasonCategory: info.category,
            error: redactSecrets(err?.message || info.summary, [s.gemini.apiKey]),
          });
        }
      }

      if (p === "/api/test-connection" && req.method === "POST") {
        const body = await readJsonBody(req);
        const provider = body?.provider || "gemini";
        if (provider !== "gemini") {
          return sendJson(res, 200, { ok: false, error: "not integrated yet" });
        }

        const s = loadSettings(dataDir);
        const wantsStream =
          body?.stream === true ||
          String(req.headers.accept || "").includes("application/x-ndjson");

        if (wantsStream) {
          res.writeHead(200, {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
          });
          res.flushHeaders?.();
        }

        const out = await executionEngine.runGeminiWithFallback({
          action: "test-connection",
          capability: "text",
          settings: s,
          signal,
          onProgress: wantsStream
            ? (evt) => {
                if (!res.writableEnded) {
                  res.write(JSON.stringify({ type: "progress", event: evt }) + "\n");
                }
              }
            : undefined,
          payloadFactory: ({ adapted }) => ({
            parts: [{ text: "Reply with exactly: OK" }],
            // >=512: Gemini "thinking" tokens count against maxOutputTokens.
            generationConfig: adapted ? undefined : { maxOutputTokens: 512 },
            adaptedApplied: Boolean(adapted),
          }),
          validate: (json) => validateConnectionReply(json),
        });

        const responsePayload = out.ok
          ? {
              ok: true,
              traceId: out.traceId,
              latencyMs: out.latencyMs,
              model: out.effectiveModel,
              selectedModel: out.selectedModel,
              effectiveModel: out.effectiveModel,
              preferredModel: out.preferredModel,
              downgraded: out.downgraded,
              reason: out.reason,
              ...(out.warning ? { warning: out.warning } : {}),
              reply: out.reply,
              attemptedModels: out.attemptedModels,
              health: computeHealthSnapshot(s),
            }
          : {
              ok: false,
              traceId: out.traceId,
              latencyMs: out.latencyMs,
              model: out.model || s.gemini.textModel || "gemini-3.8-flash",
              preferredModel: out.preferredModel || null,
              reasonCategory: out.reasonCategory || "fatal",
              error: out.error,
              ...(out.guidanceUrl ? { guidanceUrl: out.guidanceUrl } : {}),
              attemptedModels: out.attemptedModels || [],
              health: computeHealthSnapshot(s),
            };

        if (wantsStream) {
          if (!res.writableEnded) {
            res.write(JSON.stringify({ type: "result", data: responsePayload }) + "\n");
            res.end();
          }
          return;
        }
        return sendJson(res, 200, responsePayload);
      }

      if (p === "/api/script" && req.method === "POST") {
        const body = await readJsonBody(req);
        const topic = String(body?.topic || "").trim();
        const durationSec = [30, 60].includes(Number(body?.durationSec))
          ? Number(body.durationSec)
          : 30;
        if (!topic) return sendJson(res, 400, { ok: false, error: "topic is required" });

        const s = loadSettings(dataDir);
        const targetWords = Math.round(durationSec * 3.5);
        const beats = durationSec <= 30 ? 9 : 16;
        const prompt =
          `Write narration for a vertical (9:16) cartoon story short in the style of "Out of Step": ` +
          `a true-or-plausible little lesson retold with gentle deadpan humour, one steady English narrator, no captions. ` +
          `Topic: ${topic}. Target duration ${durationSec} seconds at ~3.5 words/second (~${targetWords} words total), about ${beats} beats. ` +
          `Structure the beats like: hook, setting, rising action, snap/surprise, deadpan line, plain-language explanation, callback. ` +
          `Return ONLY JSON, no markdown, in exactly this shape: ` +
          `{"title":"...","beats":[{"text":"...","estSec":3.5}],"totalWords":123}`;

        const out = await executionEngine.runGeminiWithFallback({
          action: "script",
          capability: "text",
          settings: s,
          signal,
          payloadFactory: ({ adapted }) => ({
            parts: [{ text: prompt }],
            generationConfig: adapted ? undefined : { maxOutputTokens: 4096 },
            adaptedApplied: Boolean(adapted),
          }),
          validate: (json) => validateScriptResponse(json),
        });

        if (!out.ok) {
          return sendJson(res, 200, {
            ok: false,
            traceId: out.traceId,
            reasonCategory: out.reasonCategory,
            error: out.error,
            attemptedModels: out.attemptedModels || [],
          });
        }

        return sendJson(res, 200, {
          ok: true,
          traceId: out.traceId,
          model: out.effectiveModel,
          actualModel: out.effectiveModel,
          preferredModel: out.preferredModel,
          downgraded: out.downgraded,
          reason: out.reason,
          ...(out.warning ? { warning: out.warning } : {}),
          latencyMs: out.latencyMs,
          attemptedModels: out.attemptedModels,
          script: out.script,
        });
      }

      if (p === "/api/check-still" && req.method === "POST") {
        const body = await readJsonBody(req);
        const imageBase64 = String(body?.imageBase64 || "").trim();
        const rawMime = String(body?.mimeType || "image/jpeg").trim();
        const mimeType = /^image\/[a-z0-9.+-]+$/i.test(rawMime) ? rawMime : "image/jpeg";
        const shotNote = String(body?.shotNote || "").trim();
        if (!imageBase64) return sendJson(res, 400, { ok: false, error: "imageBase64 is required" });

        const s = loadSettings(dataDir);
        const prompt =
          `You are the visual QA checker for a cartoon short frame. ` +
          (shotNote ? `Shot intent: ${shotNote}. ` : "") +
          `Check: characters readable and not clipped by frame edges or props, no rendering glitches, ` +
          `no blank/black areas, composition matches the shot intent. ` +
          `Return ONLY JSON, no markdown: {"verdict":"PASS" or "FAIL","issues":["..."],"summary":"one short sentence"}`;

        const out = await executionEngine.runGeminiWithFallback({
          action: "check-still",
          capability: "vision",
          settings: s,
          signal,
          payloadFactory: ({ adapted }) => ({
            parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }],
            generationConfig: adapted ? undefined : { maxOutputTokens: 2048 },
            adaptedApplied: Boolean(adapted),
          }),
          validate: (json) => validateStillVerdict(json),
        });

        if (!out.ok) {
          return sendJson(res, 200, {
            ok: false,
            traceId: out.traceId,
            reasonCategory: out.reasonCategory,
            error: out.error,
            attemptedModels: out.attemptedModels || [],
          });
        }

        return sendJson(res, 200, {
          ok: true,
          traceId: out.traceId,
          model: out.effectiveModel,
          actualModel: out.effectiveModel,
          preferredModel: out.preferredModel,
          downgraded: out.downgraded,
          reason: out.reason,
          ...(out.warning ? { warning: out.warning } : {}),
          latencyMs: out.latencyMs,
          attemptedModels: out.attemptedModels,
          result: out.result,
        });
      }

      if (p === "/api/tts" && req.method === "POST") {
        const body = await readJsonBody(req);
        const text = String(body?.text || "").trim();
        const voiceName = String(body?.voiceName || "Kore").trim();
        if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });
        if (!/^[a-z0-9_-]{1,40}$/i.test(voiceName)) {
          return sendJson(res, 400, { ok: false, error: "Invalid voiceName format." });
        }

        const s = loadSettings(dataDir);
        const out = await executionEngine.runGeminiWithFallback({
          action: "tts",
          capability: "tts",
          settings: s,
          signal,
          payloadFactory: () => ({
            parts: [{ text }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            },
          }),
          validate: (json) => validateTtsAudio(json),
        });

        if (!out.ok) {
          return sendJson(res, 200, {
            ok: false,
            traceId: out.traceId,
            reasonCategory: out.reasonCategory,
            error: out.error,
            attemptedModels: out.attemptedModels || [],
          });
        }

        const outFile = path.join(dataDir, "tts-output.wav");
        await withDataDirLock(dataDir, async () => {
          atomicWriteBufferSync(outFile, out.wav, { mode: 0o644 });
        });

        return sendJson(res, 200, {
          ok: true,
          traceId: out.traceId,
          model: out.effectiveModel,
          actualModel: out.effectiveModel,
          preferredModel: out.preferredModel,
          downgraded: out.downgraded,
          reason: out.reason,
          ...(out.warning ? { warning: out.warning } : {}),
          file: "app/data/tts-output.wav",
          bytes: out.wav.length,
          attemptedModels: out.attemptedModels,
        });
      }

      if (p.startsWith("/api/")) {
        return sendJson(res, 404, { ok: false, error: "Unknown endpoint" });
      }
      return serveStatic(req, res, p);
    } catch (e) {
      const s = loadSettings(dataDir);
      const statusCode = e?.statusCode || 500;
      return sendJson(res, statusCode, {
        ok: false,
        error: redactSecrets(String(e?.message || e), [s.gemini.apiKey]),
      });
    }
  });

  return {
    server,
    catalogService,
    healthRegistry,
    executionEngine,
    classifyGeminiModel,
  };
}
