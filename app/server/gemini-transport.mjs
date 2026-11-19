import crypto from "node:crypto";
import {
  DEFAULT_GEMINI_BASE,
  normalizeModelId,
  rankGeminiModels,
} from "./gemini-models.mjs";
import { keyFingerprint, redactSecrets } from "./settings-store.mjs";

const QUALITY_TIER_ORDER = { pro: 3, flash: 2, "flash-lite": 1, other: 0 };

export function geminiText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((p) => typeof p?.text === "string")
    .map((p) => p.text)
    .join("");
}

export function parseJsonLoose(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

export function wavWrapPcm16(pcm, sampleRate = 24000, channels = 1) {
  if (!Buffer.isBuffer(pcm) || pcm.length < 2 || pcm.length % (channels * 2) !== 0) {
    const err = new Error("Invalid PCM16 audio buffer returned by model.");
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function parseRetryDelayMs(json, retryAfterHeader) {
  if (retryAfterHeader) {
    const sec = Number.parseFloat(retryAfterHeader);
    if (Number.isFinite(sec) && sec >= 0) return Math.round(sec * 1000);
  }
  const details = Array.isArray(json?.error?.details) ? json.error.details : [];
  for (const d of details) {
    if (typeof d?.retryDelay === "string") {
      const m = /^(\d+(?:\.\d+)?)(ms|s)$/i.exec(d.retryDelay.trim());
      if (m) {
        const val = Number.parseFloat(m[1]);
        return m[2].toLowerCase() === "ms" ? Math.round(val) : Math.round(val * 1000);
      }
    }
  }
  const msgMatch = /retry in (\d+(?:\.\d+)?)s/i.exec(String(json?.error?.message || ""));
  if (msgMatch) return Math.round(Number.parseFloat(msgMatch[1]) * 1000);
  return null;
}

function inspectQuotaScope(json, fallbackMessage = "") {
  const details = Array.isArray(json?.error?.details) ? json.error.details : [];
  const msg = String(json?.error?.message || fallbackMessage || "");
  const parts = [msg];
  let hasModelDimension = false;
  for (const d of details) {
    if (Array.isArray(d?.violations)) {
      for (const v of d.violations) {
        if (v?.quotaDimensions?.model) hasModelDimension = true;
        parts.push(String(v?.quotaId || ""), String(v?.quotaMetric || ""), JSON.stringify(v?.quotaDimensions || {}));
      }
    }
  }
  const combined = parts.join(" ");
  if (
    /\b(per[_ -]?day|daily|GenerateRequestsPerDay|plan and billing|billing account|billing details|project[_ -]?quota|global[_ -]?quota|account quota)\b/i.test(
      combined,
    ) &&
    !/PerMinutePerProjectPerModel/i.test(combined)
  ) {
    return "global";
  }
  if (
    hasModelDimension ||
    /\b(PerMinutePerProjectPerModel|PerModel|per[_ -]?model|RPM|TPM|requests per minute|tokens per minute|for model|model rate limit)\b/i.test(
      combined,
    )
  ) {
    return "model";
  }
  return "unknown";
}

export async function geminiGenerate({
  apiKey,
  model,
  parts,
  generationConfig,
  baseUrl = DEFAULT_GEMINI_BASE,
  timeoutMs = 285_000,
  signal,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
}) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) {
    const err = new Error("No Gemini API key saved. Add one in Settings.");
    err.code = "NO_API_KEY";
    throw err;
  }

  const normalizedModel = normalizeModelId(model);
  if (signal?.aborted) {
    throw new DOMException("Operation aborted", "AbortError");
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const url = `${baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(normalizedModel)}:generateContent`;

  const t0 = clock();
  let res;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": cleanKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        ...(generationConfig ? { generationConfig } : {}),
      }),
      signal: combinedSignal,
    });
  } catch (fetchErr) {
    if (signal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }
    const isTimeout =
      timeoutSignal.aborted ||
      fetchErr?.name === "TimeoutError" ||
      /timed?\s*out/i.test(String(fetchErr?.message || ""));
    const err = new Error(
      isTimeout
        ? `Gemini request timed out after ${Math.round(timeoutMs / 1000)}s on ${normalizedModel}.`
        : `Gemini network error on ${normalizedModel}: ${redactSecrets(fetchErr?.message || fetchErr, [cleanKey])}`,
    );
    err.isTimeout = isTimeout;
    err.status = isTimeout ? 408 : 0;
    err.latencyMs = Math.max(0, clock() - t0);
    throw err;
  }

  const latencyMs = Math.max(0, clock() - t0);
  const rawText = await res.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    const err = new Error(
      `Gemini returned non-JSON (HTTP ${res.status}): ${redactSecrets(rawText.slice(0, 240), [cleanKey])}`,
    );
    err.status = res.status;
    err.code = "NON_JSON";
    err.latencyMs = latencyMs;
    throw err;
  }

  if (!res.ok) {
    const msg = redactSecrets(json?.error?.message || rawText.slice(0, 280), [cleanKey]);
    const err = new Error(`Gemini HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.grpcStatus = String(json?.error?.status || "");
    err.retryAfterMs = parseRetryDelayMs(json, res.headers?.get?.("retry-after"));
    err.quotaScope = res.status === 429 ? inspectQuotaScope(json) : null;
    err.errorDetails = Array.isArray(json?.error?.details) ? json.error.details : [];
    err.latencyMs = latencyMs;
    throw err;
  }

  const blockReason = json?.promptFeedback?.blockReason;
  const finishReason = json?.candidates?.[0]?.finishReason;
  if (
    blockReason ||
    ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(String(finishReason || ""))
  ) {
    const err = new Error(
      `Gemini blocked generation due to content policy (${blockReason || finishReason}).`,
    );
    err.status = 200;
    err.code = "SAFETY_BLOCKED";
    err.latencyMs = latencyMs;
    throw err;
  }

  return {
    status: res.status,
    data: json,
    latencyMs,
  };
}

export function classifyGeminiError(err) {
  const status = Number(err?.status || 0);
  const grpc = String(err?.grpcStatus || "").toUpperCase();
  const code = String(err?.code || "");
  const msg = String(err?.message || err || "");

  if (code === "NO_API_KEY") {
    return {
      category: "no_key",
      retryable: false,
      fallbackEligible: false,
      maxRetries: 0,
      summary: "No Gemini API key saved. Add one in Settings.",
    };
  }

  if (err?.name === "AbortError") {
    return {
      category: "aborted",
      retryable: false,
      fallbackEligible: false,
      maxRetries: 0,
      summary: "Request cancelled.",
    };
  }

  if (
    status === 401 ||
    grpc === "UNAUTHENTICATED" ||
    /API_KEY_INVALID|api key not valid|invalid authentication credentials/i.test(msg)
  ) {
    return {
      category: "auth",
      retryable: false,
      fallbackEligible: false,
      maxRetries: 0,
      summary: "Invalid Gemini API key or authentication rejected. Check your key in Google AI Studio.",
    };
  }

  if (status === 403 || grpc === "PERMISSION_DENIED") {
    return {
      category: "permission",
      retryable: false,
      fallbackEligible: false,
      maxRetries: 0,
      summary: "Permission or billing denied (HTTP 403). Verify project access and AI Studio billing.",
    };
  }

  if (status === 429 || grpc === "RESOURCE_EXHAUSTED") {
    const scope = err?.quotaScope || inspectQuotaScope({ error: { details: err?.errorDetails, message: msg } }, msg);
    const isGlobal =
      scope === "global" ||
      (Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 60_000);
    if (isGlobal) {
      return {
        category: "quota_global",
        quotaScope: "global",
        retryable: false,
        fallbackEligible: false,
        maxRetries: 0,
        summary: "Project or daily Gemini quota exhausted (HTTP 429). Check plan/quota in Google AI Studio.",
      };
    }
    if (scope === "unknown") {
      const hasBoundedRetryAfter =
        Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 0 && err.retryAfterMs <= 60_000;
      return {
        category: hasBoundedRetryAfter ? "rate_limited_model" : "quota_global",
        quotaScope: "unknown",
        retryable: hasBoundedRetryAfter,
        fallbackEligible: false,
        maxRetries: hasBoundedRetryAfter ? 1 : 0,
        cooldownMs: Math.max(err?.retryAfterMs || 0, 45_000),
        summary: hasBoundedRetryAfter
          ? "Gemini rate limit reached (HTTP 429, scope unknown); honoring Retry-After without model-hopping."
          : "Gemini quota or rate limit reached (HTTP 429, scope unknown); halting to avoid bypassing project quota.",
      };
    }
    return {
      category: "rate_limited_model",
      quotaScope: "model",
      retryable: true,
      fallbackEligible: true,
      maxRetries: 1,
      cooldownMs: Math.max(err?.retryAfterMs || 0, 45_000),
      summary: "Model rate limit reached (HTTP 429); respecting Retry-After or switching eligible model.",
    };
  }

  if (
    status === 503 ||
    status === 529 ||
    grpc === "UNAVAILABLE" ||
    /high demand|overloaded|service unavailable/i.test(msg)
  ) {
    return {
      category: "overload",
      retryable: true,
      fallbackEligible: true,
      maxRetries: 2,
      cooldownMs: 90_000,
      summary: "Model overloaded (HTTP 503); retrying briefly then falling back to next eligible model.",
    };
  }

  if (
    status === 404 ||
    grpc === "NOT_FOUND" ||
    /not found for API version|not supported for generateContent/i.test(msg)
  ) {
    return {
      category: "unsupported",
      retryable: false,
      fallbackEligible: true,
      rediscoverOnce: true,
      maxRetries: 0,
      cooldownMs: 300_000,
      summary: "Model unavailable or unsupported (HTTP 404); refreshing catalog.",
    };
  }

  if (code === "SAFETY_BLOCKED") {
    return {
      category: "safety",
      retryable: false,
      fallbackEligible: false,
      maxRetries: 0,
      summary: msg,
    };
  }

  if (code === "INVALID_OUTPUT") {
    return {
      category: "invalid_output",
      retryable: false,
      fallbackEligible: false,
      maxRetries: 0,
      summary: msg,
    };
  }

  if (status === 400 || grpc === "INVALID_ARGUMENT" || code === "INVALID_MODEL_ID") {
    const adaptConfig = /\b(maxOutputTokens|thinkingConfig|thinking_config|generationConfig|generation_config)\b/i.test(
      msg,
    );
    return {
      category: "invalid_request",
      retryable: false,
      fallbackEligible: false,
      adaptConfig,
      maxRetries: 0,
      summary: msg,
    };
  }

  if (err?.isTimeout || status === 408 || grpc === "DEADLINE_EXCEEDED") {
    return {
      category: "timeout",
      retryable: true,
      fallbackEligible: true,
      maxRetries: 1,
      cooldownMs: 30_000,
      summary: msg,
    };
  }

  if (status >= 500 || code === "NON_JSON" || status === 0) {
    return {
      category: "transient",
      retryable: true,
      fallbackEligible: true,
      maxRetries: 1,
      cooldownMs: 20_000,
      summary: msg,
    };
  }

  return {
    category: "fatal",
    retryable: false,
    fallbackEligible: false,
    maxRetries: 0,
    summary: msg,
  };
}

function defaultSleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Operation aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Operation aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function retryWithBackoff(
  operation,
  {
    maxRetries = 2,
    baseDelayMs = 600,
    maxDelayMs = 4_000,
    maxRetryWaitMs = Math.max(maxDelayMs * 4, 30_000),
    rng = Math.random,
    sleepImpl = defaultSleep,
    clock = () => Date.now(),
    deadlineAt = Infinity,
    signal,
    onRetry,
  } = {},
) {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (err) {
      const info = classifyGeminiError(err);
      const allowedRetries = Math.min(maxRetries, info.maxRetries ?? 0);
      if (!info.retryable || attempt > allowedRetries) {
        err.classificationInfo = info;
        err.attemptsUsed = attempt;
        throw err;
      }

      const exp = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.round(exp * (0.2 + 0.3 * rng()));
      let waitMs = Math.min(maxDelayMs, exp + jitter);
      if (Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 0) {
        // Never retry earlier than Retry-After; if Retry-After exceeds budget, stop and report.
        if (err.retryAfterMs > maxRetryWaitMs) {
          err.classificationInfo = info;
          err.attemptsUsed = attempt;
          err.retryAfterExceededBudget = true;
          throw err;
        }
        waitMs = Math.max(waitMs, err.retryAfterMs);
      }

      const remaining = deadlineAt - clock();
      if (remaining <= waitMs + 50) {
        err.classificationInfo = info;
        err.attemptsUsed = attempt;
        if (Number.isFinite(err?.retryAfterMs) && err.retryAfterMs > 0) {
          err.retryAfterExceededBudget = true;
        }
        throw err;
      }

      if (onRetry) {
        onRetry({ attempt, nextAttempt: attempt + 1, waitMs, classification: info.category, error: err });
      }
      await sleepImpl(waitMs, signal);
    }
  }
}

export const DEFAULT_VERIFIED_TTL_MS = 30 * 60 * 1000;

export class ModelHealthRegistry {
  constructor({
    clock = () => Date.now(),
    initialState = null,
    onPersist = null,
    verifiedTtlMs = DEFAULT_VERIFIED_TTL_MS,
  } = {}) {
    this.clock = clock;
    this.verifiedTtlMs = verifiedTtlMs;
    this.cooldowns = new Map(); // `${keyFp}:${modelId}` -> { until, reason, statusCode, updatedAt, streak }
    this.failureStreaks = new Map(); // `${keyFp}:${modelId}` -> { count, lastAt }
    this.recentlyCooledModels = new Set(); // `${keyFp}:${modelId}`
    this.recoveryProbes = new Set(); // `${keyFp}:${modelId}`
    this.verified = new Map(); // `${keyFp}:${capability}` -> { effectiveModel, preferredModel, downgraded, reason, verifiedAt, latencyMs }
    this.recentTrails = [];
    this.activeKeyFp = "";
    this.onPersist = onPersist;

    if (initialState && typeof initialState === "object") {
      this.activeKeyFp = String(initialState.keyFp || "");
      if (initialState.verified && typeof initialState.verified === "object" && this.activeKeyFp) {
        for (const [cap, val] of Object.entries(initialState.verified)) {
          if (val && typeof val === "object" && val.effectiveModel) {
            this.verified.set(`${this.activeKeyFp}:${cap}`, { ...val });
          }
        }
      }
      if (Array.isArray(initialState.recentTrails)) {
        this.recentTrails = initialState.recentTrails.slice(0, 15);
      }
    }
  }

  syncKeyFingerprint(keyFp) {
    if (keyFp && this.activeKeyFp && this.activeKeyFp !== keyFp) {
      this.cooldowns.clear();
      this.failureStreaks.clear();
      this.recentlyCooledModels.clear();
      this.recoveryProbes.clear();
      this.verified.clear();
      this.recentTrails = [];
    } else if (!keyFp && this.activeKeyFp) {
      this.cooldowns.clear();
      this.failureStreaks.clear();
      this.recentlyCooledModels.clear();
      this.recoveryProbes.clear();
      this.verified.clear();
      this.recentTrails = [];
    }
    this.activeKeyFp = keyFp || "";
  }

  invalidateVerified(keyFp = null) {
    if (!keyFp) {
      this.verified.clear();
    } else {
      for (const k of Array.from(this.verified.keys())) {
        if (k.startsWith(`${keyFp}:`)) this.verified.delete(k);
      }
    }
    this._persist();
  }

  markCooldown(keyFp, modelId, { durationMs = 60_000, reason = "overload", statusCode = 503 } = {}) {
    if (!keyFp || !modelId || durationMs <= 0) return;
    const now = this.clock();
    const key = `${keyFp}:${modelId}`;
    const prevStreak = this.failureStreaks.get(key);
    const streak =
      prevStreak && now - prevStreak.lastAt < 10 * 60 * 1000 ? prevStreak.count + 1 : 1;
    this.failureStreaks.set(key, { count: streak, lastAt: now });

    // Anti-oscillation backoff when a model repeatedly fails after recovery
    const multiplier = reason === "unsupported" ? 1 : Math.min(4, 1.5 ** (streak - 1));
    const effectiveDurationMs = Math.min(600_000, Math.round(durationMs * multiplier));

    this.recentlyCooledModels.add(key);
    this.recoveryProbes.delete(key);
    this.cooldowns.set(key, {
      until: now + effectiveDurationMs,
      durationMs: effectiveDurationMs,
      reason,
      statusCode,
      streak,
      updatedAt: now,
    });
  }

  getCooldown(keyFp, modelId) {
    if (!keyFp || !modelId) return null;
    const key = `${keyFp}:${modelId}`;
    const entry = this.cooldowns.get(key);
    if (!entry) return null;
    if (this.clock() >= entry.until) {
      this.cooldowns.delete(key);
      return null;
    }
    return entry;
  }

  needsRecoveryProbe(keyFp, modelId) {
    if (!keyFp || !modelId) return false;
    const key = `${keyFp}:${modelId}`;
    return this.recentlyCooledModels.has(key) && !this.getCooldown(keyFp, modelId);
  }

  isRecoveryProbeInFlight(keyFp, modelId) {
    if (!keyFp || !modelId) return false;
    return this.recoveryProbes.has(`${keyFp}:${modelId}`);
  }

  tryAcquireRecoveryProbe(keyFp, modelId) {
    if (!keyFp || !modelId) return false;
    const key = `${keyFp}:${modelId}`;
    if (this.recoveryProbes.has(key)) return false;
    this.recoveryProbes.add(key);
    return true;
  }

  releaseRecoveryProbe(keyFp, modelId) {
    if (!keyFp || !modelId) return;
    this.recoveryProbes.delete(`${keyFp}:${modelId}`);
  }

  recordVerifiedSuccess(
    keyFp,
    capability,
    { effectiveModel, preferredModel, downgraded, reason, latencyMs },
  ) {
    if (!keyFp || !capability || !effectiveModel) return;
    this.syncKeyFingerprint(keyFp);
    const modelKey = `${keyFp}:${effectiveModel}`;
    this.cooldowns.delete(modelKey);
    this.failureStreaks.delete(modelKey);
    this.recentlyCooledModels.delete(modelKey);
    this.recoveryProbes.delete(modelKey);
    this.verified.set(`${keyFp}:${capability}`, {
      effectiveModel,
      preferredModel: preferredModel || effectiveModel,
      downgraded: Boolean(downgraded),
      reason: reason || null,
      latencyMs: Number(latencyMs || 0),
      verifiedAt: this.clock(),
    });
    this._persist();
  }

  getVerified(keyFp, capability) {
    if (!keyFp || !capability) return null;
    const key = `${keyFp}:${capability}`;
    const entry = this.verified.get(key);
    if (!entry) return null;
    if (Number.isFinite(entry.verifiedAt) && this.clock() - entry.verifiedAt >= this.verifiedTtlMs) {
      this.verified.delete(key);
      return null;
    }
    return entry;
  }

  recordTrail(trail) {
    this.recentTrails.unshift(trail);
    if (this.recentTrails.length > 15) {
      this.recentTrails.length = 15;
    }
    this._persist();
  }

  _persist() {
    if (!this.onPersist) return;
    const verifiedObj = {};
    for (const [k, v] of this.verified.entries()) {
      const [fp, cap] = k.split(":");
      if (fp === this.activeKeyFp && cap) {
        verifiedObj[cap] = v;
      }
    }
    this.onPersist({
      keyFp: this.activeKeyFp,
      verified: verifiedObj,
      recentTrails: this.recentTrails,
    });
  }

  getSanitizedSummary(keyFp, settings, rankedByCapability = {}) {
    const out = {};
    for (const cap of ["text", "vision", "tts"]) {
      const ranked = rankedByCapability[cap] || [];
      const manualField =
        cap === "text" ? "textModel" : cap === "vision" ? "visionModel" : "ttsModel";
      const isManual = settings?.gemini?.selectionMode === "manual";
      const selectedModel = settings?.gemini?.[manualField] || ranked[0]?.id || null;
      const preferred = isManual
        ? selectedModel
        : ranked[0]?.id || selectedModel || null;
      const ver = keyFp ? this.getVerified(keyFp, cap) : null;
      const prefCooldown = keyFp && preferred ? this.getCooldown(keyFp, preferred) : null;

      let activeModel = preferred;
      let statusReason = null;
      if (prefCooldown && ver?.effectiveModel && !this.getCooldown(keyFp, ver.effectiveModel)) {
        activeModel = ver.effectiveModel;
        statusReason = `Preferred model ${preferred} cooling down (${prefCooldown.reason})`;
      } else if (ver?.effectiveModel && isManual && ver.effectiveModel === preferred) {
        activeModel = ver.effectiveModel;
      } else if (!isManual && ver?.effectiveModel && !prefCooldown) {
        // Preferred has recovered from cooldown -> auto-upgrade back to preferred, while showing last verified info
        activeModel = preferred;
      }

      out[cap] = {
        capability: cap,
        selectionMode: isManual ? "manual" : "auto",
        selectedModel,
        preferredModel: preferred,
        effectiveModel: activeModel,
        activeModel,
        verifiedModel: ver?.effectiveModel || null,
        verifiedAt: ver?.verifiedAt || null,
        lastLatencyMs: ver?.latencyMs ?? null,
        downgraded: Boolean(activeModel && preferred && activeModel !== preferred),
        reason: statusReason || (ver?.downgraded && prefCooldown ? ver.reason : null),
        preferredCooldownUntil: prefCooldown?.until || null,
        eligibleCount: ranked.length,
      };
    }

    return {
      selectionMode: settings?.gemini?.selectionMode || "auto",
      modelPolicy: settings?.gemini?.modelPolicy || "quality",
      includePreview: Boolean(settings?.gemini?.includePreview),
      capabilities: out,
      recentTrails: keyFp ? this.recentTrails.slice(0, 10) : [],
    };
  }
}

export function chooseCandidateList({
  capability,
  settings,
  catalogModels = [],
  healthRegistry,
  keyFp,
  maxCandidates = 3,
}) {
  const mode = settings?.gemini?.selectionMode || "auto";
  const policy = settings?.gemini?.modelPolicy || "quality";
  const includePreview = Boolean(settings?.gemini?.includePreview);
  const manualField =
    capability === "text" ? "textModel" : capability === "vision" ? "visionModel" : "ttsModel";
  const configuredModel = settings?.gemini?.[manualField] || "";

  const ranked = rankGeminiModels(catalogModels, { capability, policy, includePreview });
  const verified = healthRegistry?.getVerified(keyFp, capability);

  function partitionByHealth(items, preferredId) {
    const healthy = [];
    const deferredProbing = [];
    const coolingTransient = [];
    const coolingUnsupported = [];

    for (const m of items) {
      const cd = healthRegistry?.getCooldown(keyFp, m.id);
      if (cd) {
        if (cd.reason === "unsupported") {
          coolingUnsupported.push(m);
        } else {
          coolingTransient.push(m);
        }
      } else if (
        healthRegistry?.needsRecoveryProbe?.(keyFp, m.id) &&
        healthRegistry?.isRecoveryProbeInFlight?.(keyFp, m.id)
      ) {
        deferredProbing.push(m);
      } else {
        healthy.push(m);
      }
    }

    const prefCooldown = preferredId ? healthRegistry?.getCooldown(keyFp, preferredId) : null;
    const prefDeferred =
      preferredId &&
      healthRegistry?.needsRecoveryProbe?.(keyFp, preferredId) &&
      healthRegistry?.isRecoveryProbeInFlight?.(keyFp, preferredId);

    // If preferred is cooling down or already being probed by a concurrent caller, promote verified healthy model to front
    if ((prefCooldown || prefDeferred) && verified?.effectiveModel) {
      const idx = healthy.findIndex((m) => m.id === verified.effectiveModel);
      if (idx > 0) {
        const [hit] = healthy.splice(idx, 1);
        healthy.unshift(hit);
      }
    }

    // Never place a cooling model ahead of a healthy model; skip known 404 unsupported while catalog is unchanged
    const ordered = [...healthy, ...deferredProbing, ...coolingTransient];
    const finalPool = ordered.length > 0 ? ordered : coolingUnsupported;
    const cooldownPromoted = Boolean(
      preferredId && finalPool.length > 0 && finalPool[0].id !== preferredId && (prefCooldown || prefDeferred),
    );
    const cooldownReason = prefCooldown
      ? prefCooldown.reason
      : prefDeferred
        ? "recovery_probe_in_flight"
        : null;

    return {
      ordered: finalPool,
      cooldownPromoted,
      cooldownReason,
    };
  }

  if (mode === "manual" && configuredModel) {
    const catalogHit = catalogModels.find((m) => m.id === configuredModel);
    const incompatibleManual =
      (catalogHit?.capabilities && catalogHit.capabilities[capability] === false) ||
      (capability === "tts" && !catalogHit && !/-tts(?:-|$)/i.test(configuredModel)) ||
      (capability !== "tts" && /-tts(?:-|$)/i.test(configuredModel)) ||
      (capability === "vision" && (/^gemini-1\.0-pro(?:-|$)/i.test(configuredModel) || configuredModel === "gemini-pro"));

    const manualMeta =
      catalogHit || {
        id: configuredModel,
        tier: /-pro(?:-|$)/i.test(configuredModel)
          ? "pro"
          : /-flash-lite(?:-|$)/i.test(configuredModel)
            ? "flash-lite"
            : "flash",
      };
    const manualCeiling = QUALITY_TIER_ORDER[manualMeta.tier] ?? 2;
    // Never auto-upgrade above the user's chosen manual model tier
    const fallbacks = ranked.filter(
      (m) =>
        m.id !== configuredModel &&
        !m.isRollingAlias &&
        (QUALITY_TIER_ORDER[m.tier] ?? 0) <= manualCeiling,
    );
    const combined = incompatibleManual
      ? fallbacks.map((m, idx) => ({ ...m, rank: idx + 1 }))
      : [
          { id: configuredModel, rank: 1, tier: manualMeta.tier, manual: true },
          ...fallbacks.map((m, idx) => ({ ...m, rank: idx + 2 })),
        ];
    const preferredModel = combined[0]?.id || configuredModel;
    const { ordered, cooldownPromoted, cooldownReason } = partitionByHealth(combined, preferredModel);
    return {
      selectedModel: configuredModel,
      preferredModel,
      rankedAll: ranked,
      candidates: ordered.slice(0, maxCandidates),
      cooldownPromoted,
      cooldownReason,
    };
  }

  // Deduplicate rolling -latest aliases when concrete versioned models of the same tier already exist ahead of them
  const seenConcreteTiers = new Set();
  const deduped = [];
  for (const m of ranked) {
    if (!m.isRollingAlias) {
      seenConcreteTiers.add(m.tier);
      deduped.push(m);
    } else if (!seenConcreteTiers.has(m.tier)) {
      deduped.push(m);
    }
  }

  if (deduped.length === 0) {
    return {
      selectedModel: configuredModel || null,
      preferredModel: configuredModel || null,
      rankedAll: ranked,
      candidates: [],
      cooldownPromoted: false,
      cooldownReason: null,
    };
  }

  // Diversify fallback candidates across tiers first (e.g. Pro #1 -> Flash #1 -> Flash-Lite #1 -> remaining ranked)
  // so minor version siblings of an overloaded tier never starve lower-tier fallback pools.
  const firstPerTier = [];
  const remainder = [];
  const seenTierHead = new Set();
  for (const m of deduped) {
    if ((m.familyVersion === 0 || m.familyVersion >= 2.0) && !seenTierHead.has(m.tier)) {
      seenTierHead.add(m.tier);
      firstPerTier.push(m);
    } else {
      remainder.push(m);
    }
  }
  const tierDiversified = [...firstPerTier, ...remainder];

  const preferredModel = tierDiversified[0].id;
  const { ordered, cooldownPromoted, cooldownReason } = partitionByHealth(tierDiversified, preferredModel);

  return {
    selectedModel: configuredModel || preferredModel,
    preferredModel,
    rankedAll: ranked,
    candidates: ordered.slice(0, maxCandidates),
    cooldownPromoted,
    cooldownReason,
  };
}

function createSemaphore(limit = 4) {
  let active = 0;
  const queue = [];
  return async function acquire(signal) {
    if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
    if (active < limit) {
      active += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active -= 1;
          const next = queue.shift();
          if (next) next();
        }
      };
    }
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        const idx = queue.indexOf(wake);
        if (idx >= 0) queue.splice(idx, 1);
        reject(new DOMException("Operation aborted", "AbortError"));
      };
      const wake = () => {
        signal?.removeEventListener("abort", onAbort);
        active += 1;
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(wake);
    });
    let released = false;
    return () => {
      if (!released) {
        released = true;
        active -= 1;
        const next = queue.shift();
        if (next) next();
      }
    };
  };
}

export function validateConnectionReply(json) {
  const reply = geminiText(json).trim();
  const normalized = reply.replace(/^["'`\s]+|["'`\s.!,]+$/g, "");
  if (!reply || normalized.toUpperCase() !== "OK") {
    const err = new Error(
      reply
        ? `Model returned unexpected verification reply: "${reply.slice(0, 60)}"`
        : "Model returned an empty response (expected \"OK\").",
    );
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  return { reply: reply.slice(0, 100) };
}

export function validateScriptResponse(json) {
  let parsed;
  try {
    parsed = parseJsonLoose(geminiText(json));
  } catch (parseErr) {
    const err = new Error(`Model did not return valid JSON script: ${parseErr.message}`);
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
    const err = new Error("Model did not return a non-empty beats array.");
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const beats = parsed.beats.map((b, idx) => {
    const text = typeof b?.text === "string" ? b.text.trim() : "";
    const estSec = Number(b?.estSec);
    if (!text || !Number.isFinite(estSec) || estSec <= 0) {
      const err = new Error(`Script beat #${idx + 1} is malformed (requires non-empty text and finite positive estSec).`);
      err.code = "INVALID_OUTPUT";
      throw err;
    }
    return { text, estSec };
  });

  const totalEstSec = beats.reduce((sum, b) => sum + b.estSec, 0);
  if (!Number.isFinite(totalEstSec) || totalEstSec <= 0 || totalEstSec > 600) {
    const err = new Error(`Script total estimated duration (${totalEstSec}s) is outside valid bounds.`);
    err.code = "INVALID_OUTPUT";
    throw err;
  }

  const computedWords = beats.reduce(
    (sum, b) => sum + b.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  if (parsed.totalWords !== undefined && parsed.totalWords !== null) {
    const reportedWords = Number(parsed.totalWords);
    if (!Number.isFinite(reportedWords) || reportedWords <= 0) {
      const err = new Error("Script totalWords must be a finite positive number.");
      err.code = "INVALID_OUTPUT";
      throw err;
    }
  }

  const totalWords =
    parsed.totalWords !== undefined && parsed.totalWords !== null
      ? Number(parsed.totalWords)
      : computedWords;

  return {
    script: {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Untitled",
      beats,
      totalWords,
    },
  };
}

export function validateStillVerdict(json) {
  let parsed;
  try {
    parsed = parseJsonLoose(geminiText(json));
  } catch (parseErr) {
    const err = new Error(`Vision model did not return valid JSON verdict: ${parseErr.message}`);
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const verdict = String(parsed?.verdict || "").trim().toUpperCase();
  if (verdict !== "PASS" && verdict !== "FAIL") {
    const err = new Error(`Vision model returned invalid verdict "${String(parsed?.verdict || "")}".`);
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const issues = Array.isArray(parsed?.issues)
    ? parsed.issues.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const summary = typeof parsed?.summary === "string" ? parsed.summary.trim() : "";
  return {
    result: {
      verdict,
      issues,
      summary,
    },
  };
}

const MAX_TTS_PCM_BYTES = 24000 * 2 * 300; // 5 minutes at 24 kHz mono PCM16
const MIN_TTS_PCM_BYTES = 48; // >= 1 ms at 24 kHz mono PCM16

export function validateTtsAudio(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const audioPart = parts.find((x) => typeof x?.inlineData?.data === "string" && x.inlineData.data.trim().length > 0);
  if (!audioPart) {
    const err = new Error("Model returned no audio data (TTS may be unavailable for this model/account).");
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const cleanB64 = audioPart.inlineData.data.replace(/\s+/g, "");
  if (!cleanB64 || cleanB64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanB64)) {
    const err = new Error("Model returned malformed base64 audio data.");
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const pcm = Buffer.from(cleanB64, "base64");
  if (pcm.length < MIN_TTS_PCM_BYTES || pcm.length % 2 !== 0) {
    const err = new Error(`Invalid PCM16 audio buffer length (${pcm.length} bytes).`);
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  if (pcm.length > MAX_TTS_PCM_BYTES) {
    const err = new Error(`TTS audio buffer exceeds maximum bounded duration (${pcm.length} bytes).`);
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const hasNonZeroSample = pcm.some((byte) => byte !== 0);
  if (!hasNonZeroSample) {
    const err = new Error("Model returned silent all-zero PCM audio buffer.");
    err.code = "INVALID_OUTPUT";
    throw err;
  }
  const wav = wavWrapPcm16(pcm, 24000, 1);
  return { pcm, wav };
}

export function createGeminiExecutionEngine({
  catalogService,
  healthRegistry,
  baseUrl = DEFAULT_GEMINI_BASE,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  rng = Math.random,
  sleepImpl,
  maxCandidates = 3,
  maxTotalRequests = 6,
  maxRetriesPerCandidate = 2,
  baseRetryDelayMs = 600,
  maxRetryDelayMs = 4_000,
  overallDeadlineMs = 300_000,
  attemptTimeoutMs = 285_000,
  maxConcurrent = 4,
} = {}) {
  const acquireSlot = createSemaphore(maxConcurrent);

  async function runGeminiWithFallback({
    action = "request",
    capability = "text",
    settings,
    payloadFactory,
    validate,
    onProgress,
    signal,
  }) {
    const traceId = crypto.randomBytes(6).toString("hex");
    const startedAt = clock();
    const deadlineAt = startedAt + overallDeadlineMs;
    const apiKey = String(settings?.gemini?.apiKey || "").trim();
    const keyFp = keyFingerprint(apiKey);
    healthRegistry.syncKeyFingerprint(keyFp);

    const emit = (type, detail = {}) => {
      if (onProgress) {
        onProgress({ traceId, action, capability, timestamp: clock(), stage: type, ...detail });
      }
    };

    if (!apiKey) {
      const message = "No Gemini API key saved. Add one in Settings.";
      return {
        ok: false,
        traceId,
        capability,
        latencyMs: 0,
        reasonCategory: "no_key",
        error: message,
        attemptedModels: [],
      };
    }

    const attemptedModels = [];
    let totalRequests = 0;
    let rediscoveredOnce = false;
    let releaseSlot = () => {};

    try {
      releaseSlot = await acquireSlot(signal);
      emit("discovering", { message: "Discovering accessible Gemini models for this API key…" });

      let catalogRes;
      try {
        catalogRes = await catalogService.listGeminiModels(apiKey, { signal });
      } catch (discErr) {
        const info = classifyGeminiError(discErr);
        const safeError = redactSecrets(discErr?.message || info.summary, [apiKey]);
        const failResult = {
          ok: false,
          traceId,
          capability,
          latencyMs: Math.max(0, clock() - startedAt),
          reasonCategory: info.category,
          error: safeError,
          attemptedModels: [],
        };
        healthRegistry.recordTrail({
          traceId,
          action,
          capability,
          at: clock(),
          ok: false,
          reasonCategory: info.category,
          attemptedModels: [],
        });
        return failResult;
      }

      let selection = chooseCandidateList({
        capability,
        settings,
        catalogModels: catalogRes.models,
        healthRegistry,
        keyFp,
        maxCandidates,
      });

      if (selection.candidates.length === 0) {
        const msg =
          capability === "tts"
            ? "No Gemini TTS audio models are available for this API key/account."
            : `No eligible Gemini ${capability} models found in your account catalog.`;
        return {
          ok: false,
          traceId,
          capability,
          latencyMs: Math.max(0, clock() - startedAt),
          reasonCategory: "unsupported",
          error: msg,
          preferredModel: selection.preferredModel,
          attemptedModels: [],
        };
      }

      emit("selected_candidates", {
        preferredModel: selection.preferredModel,
        candidates: selection.candidates.map((c) => c.id),
        cooldownPromoted: selection.cooldownPromoted,
        message: `Selected ${selection.candidates[0].id} (${settings.gemini.selectionMode === "manual" ? "manual" : settings.gemini.modelPolicy} policy)`,
      });

      let candidateQueue = selection.candidates.slice();
      const triedIds = new Set();
      let fallbackTriggerReason = selection.cooldownPromoted
        ? selection.cooldownReason || "preferred_model_in_cooldown"
        : null;
      let lastError = null;
      let lastClassification = null;

      while (candidateQueue.length > 0 && totalRequests < maxTotalRequests) {
        if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
        if (clock() >= deadlineAt) {
          lastClassification = { category: "timeout", summary: "Overall request deadline exceeded." };
          lastError = new Error("Overall request deadline exceeded while waiting for Gemini.");
          break;
        }

        const candidate = candidateQueue.shift();
        if (!candidate || triedIds.has(candidate.id)) continue;
        triedIds.add(candidate.id);

        let acquiredProbe = false;
        if (healthRegistry?.needsRecoveryProbe?.(keyFp, candidate.id)) {
          acquiredProbe = healthRegistry.tryAcquireRecoveryProbe(keyFp, candidate.id);
          if (!acquiredProbe && candidateQueue.length > 0) {
            // Another concurrent request is already probing this recovering candidate -> use next healthy candidate
            fallbackTriggerReason = fallbackTriggerReason || "recovery_probe_in_flight";
            continue;
          }
        }

        let configAdapted = false;

        let lastCandidateAttemptErr = null;
        try {
          const candidateOutcome = await retryWithBackoff(
            async (attemptNum) => {
              if (totalRequests >= maxTotalRequests) {
                if (lastCandidateAttemptErr) throw lastCandidateAttemptErr;
                const capErr = new Error("Maximum request budget reached for this operation.");
                capErr.status = 503;
                throw capErr;
              }
              totalRequests += 1;
              const attemptStarted = clock();
              emit("attempt_start", {
                model: candidate.id,
                rank: candidate.rank,
                attempt: attemptNum,
                message: `Testing ${candidate.id} (attempt ${attemptNum})…`,
              });

              const remainingBudgetMs = Math.max(1_000, deadlineAt - clock());
              const thisTimeoutMs = Math.min(attemptTimeoutMs, remainingBudgetMs);
              const payload = payloadFactory({ model: candidate.id, adapted: configAdapted });

              try {
                const response = await geminiGenerate({
                  apiKey,
                  model: candidate.id,
                  parts: payload.parts,
                  generationConfig: payload.generationConfig,
                  baseUrl,
                  timeoutMs: thisTimeoutMs,
                  signal,
                  fetchImpl,
                  clock,
                });

                const validated = validate(response.data, candidate.id);
                const elapsedMs = Math.max(0, clock() - attemptStarted);

                attemptedModels.push({
                  model: candidate.id,
                  rank: candidate.rank,
                  attempt: attemptNum,
                  startedAt: attemptStarted,
                  elapsedMs,
                  statusCode: response.status,
                  classification: configAdapted ? "ok_adapted" : "ok",
                  outcome: "success",
                  ...(configAdapted ? { configAdapted: true } : {}),
                });

                return { response, validated, configAdapted };
              } catch (attemptErr) {
                lastCandidateAttemptErr = attemptErr;
                const elapsedMs = Math.max(0, clock() - attemptStarted);
                const info = classifyGeminiError(attemptErr);

                attemptedModels.push({
                  model: candidate.id,
                  rank: candidate.rank,
                  attempt: attemptNum,
                  startedAt: attemptStarted,
                  elapsedMs,
                  ...(attemptErr?.status ? { statusCode: attemptErr.status } : {}),
                  ...(attemptErr?.grpcStatus ? { errorCode: attemptErr.grpcStatus } : {}),
                  classification: info.category,
                  outcome: "failed",
                  message: redactSecrets(String(attemptErr?.message || info.summary).slice(0, 180), [apiKey]),
                });

                // One-time generationConfig adaptation if model rejected an optional generationConfig field
                if (info.adaptConfig && !configAdapted && totalRequests < maxTotalRequests) {
                  configAdapted = true;
                  const adaptedPayload = payloadFactory({ model: candidate.id, adapted: true });
                  if (adaptedPayload.adaptedApplied) {
                    totalRequests += 1;
                    const retryStart = clock();
                    emit("config_adaptation", {
                      model: candidate.id,
                      attempt: attemptNum + 1,
                      message: `${candidate.id} rejected optional generationConfig field; adapting config once…`,
                    });
                    try {
                      const response2 = await geminiGenerate({
                        apiKey,
                        model: candidate.id,
                        parts: adaptedPayload.parts,
                        generationConfig: adaptedPayload.generationConfig,
                        baseUrl,
                        timeoutMs: Math.min(attemptTimeoutMs, Math.max(1_000, deadlineAt - clock())),
                        signal,
                        fetchImpl,
                        clock,
                      });
                      const validated2 = validate(response2.data, candidate.id);
                      attemptedModels.push({
                        model: candidate.id,
                        rank: candidate.rank,
                        attempt: attemptNum + 1,
                        startedAt: retryStart,
                        elapsedMs: Math.max(0, clock() - retryStart),
                        statusCode: response2.status,
                        classification: "ok_adapted",
                        outcome: "success",
                        configAdapted: true,
                      });
                      return { response: response2, validated: validated2, configAdapted: true };
                    } catch (adaptErr) {
                      lastCandidateAttemptErr = adaptErr;
                      const adaptInfo = classifyGeminiError(adaptErr);
                      attemptedModels.push({
                        model: candidate.id,
                        rank: candidate.rank,
                        attempt: attemptNum + 1,
                        startedAt: retryStart,
                        elapsedMs: Math.max(0, clock() - retryStart),
                        ...(adaptErr?.status ? { statusCode: adaptErr.status } : {}),
                        ...(adaptErr?.grpcStatus ? { errorCode: adaptErr.grpcStatus } : {}),
                        classification: adaptInfo.category,
                        outcome: "failed",
                        configAdapted: true,
                        message: redactSecrets(
                          String(adaptErr?.message || adaptInfo.summary).slice(0, 180),
                          [apiKey],
                        ),
                      });
                      throw adaptErr;
                    }
                  }
                }

                throw attemptErr;
              }
            },
            {
              maxRetries: maxRetriesPerCandidate,
              baseDelayMs: baseRetryDelayMs,
              maxDelayMs: maxRetryDelayMs,
              rng,
              sleepImpl,
              clock,
              deadlineAt,
              signal,
              onRetry: ({ nextAttempt, waitMs, classification }) => {
                emit("retry_scheduled", {
                  model: candidate.id,
                  nextAttempt,
                  waitMs,
                  classification,
                  message: `${candidate.id} returned ${classification}; retrying in ${(waitMs / 1000).toFixed(1)}s…`,
                });
              },
            },
          );

          const totalLatencyMs = Math.max(0, clock() - startedAt);
          const preferredModel = selection.preferredModel || candidate.id;
          const downgraded = candidate.id !== preferredModel;
          const reason = downgraded ? fallbackTriggerReason || "model_overloaded" : null;
          const warningParts = [];
          if (downgraded) {
            warningParts.push(
              `Preferred model ${preferredModel} was unavailable (${reason.replace(/_/g, " ")}); fulfilled by ${candidate.id}.`,
            );
          }
          if (candidateOutcome.configAdapted) {
            warningParts.push(
              `Optional generationConfig parameter was adapted once after HTTP 400 validation feedback on ${candidate.id}.`,
            );
          }
          const warning = warningParts.length > 0 ? warningParts.join(" ") : null;

          healthRegistry.recordVerifiedSuccess(keyFp, capability, {
            effectiveModel: candidate.id,
            preferredModel,
            downgraded,
            reason,
            latencyMs: totalLatencyMs,
          });

          healthRegistry.recordTrail({
            traceId,
            action,
            capability,
            at: clock(),
            ok: true,
            preferredModel,
            effectiveModel: candidate.id,
            downgraded,
            reason,
            ...(candidateOutcome.configAdapted ? { configAdapted: true } : {}),
            latencyMs: totalLatencyMs,
            attemptedModels,
          });

          emit("completed", {
            effectiveModel: candidate.id,
            preferredModel,
            downgraded,
            ...(candidateOutcome.configAdapted ? { configAdapted: true } : {}),
            latencyMs: totalLatencyMs,
            message: downgraded
              ? `Connected via fallback model ${candidate.id} (preferred ${preferredModel} overloaded).`
              : `Verified ${candidate.id}.`,
          });

          return {
            ok: true,
            traceId,
            capability,
            latencyMs: totalLatencyMs,
            model: candidate.id,
            actualModel: candidate.id,
            selectedModel: selection.selectedModel || candidate.id,
            effectiveModel: candidate.id,
            preferredModel,
            downgraded,
            reason,
            ...(candidateOutcome.configAdapted ? { configAdapted: true } : {}),
            ...(warning ? { warning } : {}),
            attemptedModels,
            ...candidateOutcome.validated,
          };
        } catch (candErr) {
          if (candErr?.name === "AbortError" || signal?.aborted) {
            throw new DOMException("Operation aborted", "AbortError");
          }

          const info = candErr.classificationInfo || classifyGeminiError(candErr);
          lastError = candErr;
          lastClassification = info;

          if (info.cooldownMs) {
            healthRegistry.markCooldown(keyFp, candidate.id, {
              durationMs: info.cooldownMs,
              reason: info.category,
              statusCode: candErr?.status || 0,
            });
          }

          // Stale catalog 404 -> rediscover once and rebuild remaining candidate queue
          if (info.rediscoverOnce && !rediscoveredOnce) {
            rediscoveredOnce = true;
            emit("rediscovering", {
              failedModel: candidate.id,
              message: `${candidate.id} returned 404; refreshing model catalog…`,
            });
            try {
              catalogRes = await catalogService.listGeminiModels(apiKey, {
                signal,
                forceRefresh: true,
              });
              selection = chooseCandidateList({
                capability,
                settings,
                catalogModels: catalogRes.models,
                healthRegistry,
                keyFp,
                maxCandidates: maxCandidates + 1,
              });
              candidateQueue = selection.candidates.filter((c) => !triedIds.has(c.id));
            } catch {
              // Keep existing queue if refresh fails
            }
          }

          if (!info.fallbackEligible || candidateQueue.length === 0 || totalRequests >= maxTotalRequests) {
            break;
          }

          fallbackTriggerReason = info.category;
          const nextModel = candidateQueue.find((c) => !triedIds.has(c.id));
          if (nextModel) {
            emit("fallback_switch", {
              fromModel: candidate.id,
              toModel: nextModel.id,
              reason: info.category,
              message: `${candidate.id} unavailable (${info.category}); trying next eligible model ${nextModel.id}…`,
            });
          }
        } finally {
          if (acquiredProbe) {
            healthRegistry?.releaseRecoveryProbe?.(keyFp, candidate.id);
          }
        }
      }

      const totalLatencyMs = Math.max(0, clock() - startedAt);
      const reasonCategory = lastClassification?.category || "fatal";
      const safeError = redactSecrets(
        lastError?.message || lastClassification?.summary || "Gemini request failed.",
        [apiKey],
      );

      healthRegistry.recordTrail({
        traceId,
        action,
        capability,
        at: clock(),
        ok: false,
        preferredModel: selection.preferredModel,
        reasonCategory,
        latencyMs: totalLatencyMs,
        attemptedModels,
      });

      emit("failed", {
        reasonCategory,
        error: safeError,
        message: safeError,
      });

      return {
        ok: false,
        traceId,
        capability,
        latencyMs: totalLatencyMs,
        model: attemptedModels.at(-1)?.model || selection.preferredModel || null,
        preferredModel: selection.preferredModel || null,
        downgraded: false,
        reasonCategory,
        error: safeError,
        guidanceUrl:
          reasonCategory === "quota_global" || reasonCategory === "rate_limited_model"
            ? "https://ai.google.dev/gemini-api/docs/rate-limits"
            : "https://ai.google.dev/gemini-api/docs/troubleshooting",
        attemptedModels,
      };
    } catch (outerErr) {
      if (outerErr?.name === "AbortError" || signal?.aborted) {
        return {
          ok: false,
          traceId,
          capability,
          aborted: true,
          latencyMs: Math.max(0, clock() - startedAt),
          reasonCategory: "aborted",
          error: "Request cancelled.",
          attemptedModels,
        };
      }
      const safeError = redactSecrets(outerErr?.message || outerErr, [apiKey]);
      return {
        ok: false,
        traceId,
        capability,
        latencyMs: Math.max(0, clock() - startedAt),
        reasonCategory: "fatal",
        error: safeError,
        attemptedModels,
      };
    } finally {
      releaseSlot();
    }
  }

  return {
    runGeminiWithFallback,
  };
}
