import { VALID_MODEL_ID_RE, keyFingerprint, redactSecrets } from "./settings-store.mjs";

export const DEFAULT_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_DISCOVERY_TTL_MS = 5 * 60 * 1000;
export const MAX_DISCOVERY_PAGES = 20;

const TIER_SCORES_BY_POLICY = {
  quality: { pro: 300, flash: 200, "flash-lite": 100 },
  balanced: { flash: 300, "flash-lite": 200, pro: 100 },
  fast: { "flash-lite": 300, flash: 200, pro: 100 },
};

export function normalizeModelId(rawName) {
  const raw = String(rawName || "").trim();
  if (!raw) {
    const err = new Error("Model identifier is empty.");
    err.code = "INVALID_MODEL_ID";
    throw err;
  }
  const stripped = raw.replace(/^models\//i, "");
  if (!VALID_MODEL_ID_RE.test(stripped)) {
    const err = new Error(`Invalid model identifier: "${stripped.slice(0, 64)}"`);
    err.code = "INVALID_MODEL_ID";
    throw err;
  }
  return stripped;
}

function parseFamilyVersion(id) {
  const m = /^gemini-(?:omni-)?(\d+(?:\.\d+)?)(?=-|$)/i.exec(id);
  if (!m) return 0;
  const num = Number.parseFloat(m[1]);
  return Number.isFinite(num) ? num : 0;
}

function parseRevision(id) {
  const m = /-(\d{3})$/.exec(id);
  return m ? Number.parseInt(m[1], 10) : 0;
}

export function classifyGeminiModel(rawModel) {
  if (!rawModel || typeof rawModel !== "object") {
    return null;
  }
  let id;
  try {
    id = normalizeModelId(rawModel.name || rawModel.id || rawModel.baseModelId || "");
  } catch {
    return null;
  }

  const displayName = String(rawModel.displayName || id).trim();
  const description = String(rawModel.description || "").trim();
  const version = String(rawModel.version || "").trim();
  const methodsRaw = Array.isArray(rawModel.supportedGenerationMethods)
    ? rawModel.supportedGenerationMethods
    : Array.isArray(rawModel.supportedActions)
      ? rawModel.supportedActions
      : [];
  const methods = methodsRaw.map((m) => String(m));
  const inputTokenLimit = Number.isFinite(Number(rawModel.inputTokenLimit))
    ? Number(rawModel.inputTokenLimit)
    : null;
  const outputTokenLimit = Number.isFinite(Number(rawModel.outputTokenLimit))
    ? Number(rawModel.outputTokenLimit)
    : null;
  const thinking = rawModel.thinking === true;

  const metaText = `${displayName} ${description}`;
  const supportsGenerateContent = methods.includes("generateContent");
  const isDeprecated = /\b(deprecated|decommissioned|discontinued|rerouted|obsolete|sunset)\b/i.test(metaText);
  const isEmbedding = methods.includes("embedContent") || /embedding/i.test(id);
  const isLiveOnly =
    (!supportsGenerateContent && methods.includes("bidiGenerateContent")) ||
    /-(live|native-audio)(?:-|$)/i.test(id);
  const isImageGen =
    /(-image(?:-|$)|^imagen(?:-|$)|nano-banana)/i.test(id) ||
    /\b(nano banana|image generation)\b/i.test(metaText);
  const isVideoOrMusic =
    /^(veo|lyria)(?:-|$)/i.test(id) ||
    methods.includes("bidiGenerateMusic") ||
    methods.includes("predictLongRunning");
  const isTranscribeOnly = /-transcribe(?:-|$)/i.test(id);
  const isSpecializedAgent =
    /^(antigravity|deep-research|aqa)(?:-|$)|-(robotics|computer-use|customtools|decision)(?:-|$)/i.test(id) ||
    (!supportsGenerateContent && methods.includes("generateAnswer")) ||
    methods.includes("createDecision");

  const explicitModalities = Array.isArray(rawModel.supportedOutputModalities)
    ? rawModel.supportedOutputModalities.map((x) => String(x).toUpperCase())
    : null;
  const explicitInputModalities = Array.isArray(rawModel.supportedInputModalities)
    ? rawModel.supportedInputModalities.map((x) => String(x).toUpperCase())
    : null;

  const hasTtsId = /-tts(?:-|$)/i.test(id);
  const displayMentionsTts = /\btts\b|text-to-speech/i.test(displayName);
  const explicitAudioOnly = Boolean(
    explicitModalities && explicitModalities.includes("AUDIO") && !explicitModalities.includes("TEXT"),
  );
  const explicitNoAudio = Boolean(explicitModalities && !explicitModalities.includes("AUDIO"));
  const explicitNoText = Boolean(explicitModalities && !explicitModalities.includes("TEXT"));

  const isTts =
    supportsGenerateContent &&
    !explicitNoAudio &&
    (hasTtsId || explicitAudioOnly);

  const misleadingDisplayName =
    (displayMentionsTts && !isTts) ||
    (/\bpro\b/i.test(displayName) && /-flash-lite(?:-|$)/i.test(id)) ||
    (/\bflash-lite\b/i.test(displayName) && /-pro(?:-|$)/i.test(id));

  const isGemma = /^gemma-/i.test(id);
  const isExperimentalCodename =
    /^gemini-\d+(?:\.\d+)?-(argon|carbon|hydrogen|neon|helium|xenon|krypton)(?:-|$)/i.test(id);

  let tier = "other";
  if (isTts) {
    if (/-pro(?:-|$)/i.test(id)) tier = "pro";
    else if (/-flash-lite(?:-|$)/i.test(id)) tier = "flash-lite";
    else tier = "flash";
  } else if (/^gemini-(?:omni-)?(?:\d+(?:\.\d+)?-)?pro(?:-|$)/i.test(id)) {
    tier = "pro";
  } else if (/^gemini-(?:omni-)?(?:\d+(?:\.\d+)?-)?flash-lite(?:-|$)/i.test(id)) {
    tier = "flash-lite";
  } else if (/^gemini-(?:omni-)?(?:\d+(?:\.\d+)?-)?flash(?!-lite)(?:-|$)/i.test(id)) {
    tier = "flash";
  } else if (isGemma) {
    tier = "gemma";
  } else if (isExperimentalCodename) {
    tier = "experimental";
  }

  const isPreview =
    /-(preview|exp|experimental)(?:-|$)/i.test(id) ||
    /\b(preview|experimental)\b/i.test(displayName) ||
    isExperimentalCodename;
  const isRollingAlias = /-latest$/i.test(id);
  const isOmni = /^gemini-omni-/i.test(id);
  const familyVersion = parseFamilyVersion(id);
  const revision = parseRevision(id);

  let exclusionReason = null;
  if (!supportsGenerateContent) exclusionReason = "no_generate_content";
  else if (isDeprecated) exclusionReason = "deprecated_or_rerouted";
  else if (isEmbedding) exclusionReason = "embedding_only";
  else if (isLiveOnly) exclusionReason = "live_streaming_only";
  else if (isImageGen) exclusionReason = "image_generation_only";
  else if (isVideoOrMusic) exclusionReason = "media_generation_only";
  else if (isTranscribeOnly) exclusionReason = "transcription_only";
  else if (isSpecializedAgent) exclusionReason = "specialized_agent";
  else if (!isTts && explicitNoText) exclusionReason = "unsupported_output_modality";

  const isCanonicalTier = tier === "pro" || tier === "flash" || tier === "flash-lite";
  const textEligible = exclusionReason === null && !isTts && !explicitNoText && isCanonicalTier;

  const legacyTextOnly = /^gemini-1\.0-pro(?:-|$)/i.test(id) || id === "gemini-pro";
  const explicitlyNoImage =
    /\btext-only\b/i.test(metaText) ||
    Boolean(explicitInputModalities && !explicitInputModalities.includes("IMAGE"));
  const hasExplicitImageInput = Boolean(explicitInputModalities && explicitInputModalities.includes("IMAGE"));
  // Conservative vision eligibility: require either explicit IMAGE input modality or known >=32k multimodal token limit.
  const visionTokenEligible = hasExplicitImageInput || (inputTokenLimit !== null && inputTokenLimit >= 32768);
  const visionEligible =
    textEligible && !legacyTextOnly && !explicitlyNoImage && visionTokenEligible;

  const ttsEligible = exclusionReason === null && isTts;

  const costTier = tier === "pro" ? "high" : tier === "flash" ? "standard" : "low";
  const hasKnownMetadata = inputTokenLimit !== null || explicitModalities !== null || explicitInputModalities !== null;
  const capabilityConfidence =
    misleadingDisplayName || !hasKnownMetadata
      ? "low"
      : explicitModalities || explicitInputModalities
        ? "high"
        : "medium";

  return {
    id,
    name: `models/${id}`,
    displayName,
    version,
    description: description.slice(0, 240),
    supportedGenerationMethods: methods,
    inputTokenLimit,
    outputTokenLimit,
    thinking,
    tier,
    familyVersion,
    revision,
    isPreview,
    isStable: !isPreview,
    isRollingAlias,
    isOmni,
    isDeprecated,
    isTts,
    costTier,
    candidateOnly: true,
    verificationState: "unverified_candidate",
    capabilityConfidence,
    exclusionReason:
      exclusionReason ||
      (!isTts && !isCanonicalTier ? (isGemma ? "open_weights_gemma" : "non_canonical_tier") : null),
    capabilities: {
      text: textEligible,
      vision: visionEligible,
      tts: ttsEligible,
    },
  };
}

export function rankGeminiModels(
  catalog,
  { capability = "text", policy = "quality", includePreview = false } = {},
) {
  const tierMap = TIER_SCORES_BY_POLICY[policy] || TIER_SCORES_BY_POLICY.quality;
  const items = Array.isArray(catalog)
    ? catalog.map((m) => (m?.capabilities ? m : classifyGeminiModel(m))).filter(Boolean)
    : [];

  const capMatched = items.filter((m) => m.capabilities?.[capability] === true);
  const stableItems = capMatched.filter((m) => m.isStable);
  // Include preview models if explicitly opted in, OR as emergency fallback when zero stable models exist for this capability.
  const pool = includePreview || stableItems.length === 0 ? capMatched : stableItems;

  const scored = pool.slice().sort((a, b) => {
    // Modern Gemini generations (2.0+ and rolling -latest) always outrank legacy 1.x models
    const eraRank = (m) => (m.familyVersion === 0 || m.familyVersion >= 2.0 ? 2 : 1);
    const eraDiff = eraRank(b) - eraRank(a);
    if (eraDiff !== 0) return eraDiff;

    const tierDiff = (tierMap[b.tier] || 0) - (tierMap[a.tier] || 0);
    if (tierDiff !== 0) return tierDiff;

    // Within same tier: concrete stable > rolling stable alias (-latest) > preview
    const stabilityRank = (m) => (m.isStable ? (m.isRollingAlias ? 1 : 2) : 0);
    const stabDiff = stabilityRank(b) - stabilityRank(a);
    if (stabDiff !== 0) return stabDiff;

    // Prefer mainline Gemini over Omni sub-variants within same tier/stability
    if (a.isOmni !== b.isOmni) return a.isOmni ? 1 : -1;

    // Higher family version first (e.g. 3.8 > 3.7 > 3.5 > 2.5)
    if (b.familyVersion !== a.familyVersion) return b.familyVersion - a.familyVersion;

    // Higher sub-revision first (e.g. -002 > -001)
    if (b.revision !== a.revision) return b.revision - a.revision;

    // Deterministic lexical tie-breaker independent of API response order
    return a.id.localeCompare(b.id);
  });

  return scored.map((m, index) => {
    const stabilityLabel = m.isStable ? (m.isRollingAlias ? "rolling-alias" : "versioned-stable") : "preview";
    return {
      ...m,
      rank: index + 1,
      rankSource: "tier_heuristic_candidate",
      rankRationale: `policy=${policy}; capability=${capability}; tier=${m.tier}; stability=${stabilityLabel}; family=${m.familyVersion || "rolling"} (catalog candidate only; runtime probe verifies execution)`,
    };
  });
}

function parseRetryDelayMsFromPayload(json, retryAfterHeader) {
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

export async function fetchGeminiModelCatalog(
  apiKey,
  {
    baseUrl = DEFAULT_GEMINI_BASE,
    fetchImpl = globalThis.fetch,
    signal,
    timeoutMs = 20_000,
    pageSize = 100,
  } = {},
) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) {
    const err = new Error("No Gemini API key saved. Add one in Settings.");
    err.status = 0;
    err.code = "NO_API_KEY";
    throw err;
  }

  const seenIds = new Map();
  const seenTokens = new Set();
  let pageToken = "";
  let pagesFetched = 0;
  let loopDetected = false;
  let paginationTruncated = false;

  while (pagesFetched < MAX_DISCOVERY_PAGES) {
    if (signal?.aborted) {
      const abortErr = new DOMException("Operation aborted", "AbortError");
      throw abortErr;
    }

    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/models`);
    url.searchParams.set("pageSize", String(pageSize));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const reqSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);

    let res;
    try {
      res = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { "x-goog-api-key": cleanKey },
        signal: reqSignal,
      });
    } catch (fetchErr) {
      if (signal?.aborted) throw fetchErr;
      const err = new Error(
        `Unable to reach Gemini Models API: ${redactSecrets(fetchErr?.message || fetchErr, [cleanKey])}`,
      );
      err.cause = fetchErr;
      err.isTimeout = fetchErr?.name === "TimeoutError" || fetchErr?.name === "AbortError";
      throw err;
    }

    const rawText = await res.text();
    let json = null;
    try {
      json = JSON.parse(rawText);
    } catch {
      const err = new Error(
        `Gemini Models API returned non-JSON (HTTP ${res.status}): ${redactSecrets(rawText.slice(0, 200), [cleanKey])}`,
      );
      err.status = res.status;
      err.code = "NON_JSON";
      throw err;
    }

    if (!res.ok) {
      const msg = redactSecrets(json?.error?.message || rawText.slice(0, 240), [cleanKey]);
      const err = new Error(`Gemini HTTP ${res.status}: ${msg}`);
      err.status = res.status;
      err.grpcStatus = String(json?.error?.status || "");
      err.retryAfterMs = parseRetryDelayMsFromPayload(json, res.headers?.get?.("retry-after"));
      err.errorDetails = Array.isArray(json?.error?.details) ? json.error.details : [];
      throw err;
    }

    pagesFetched += 1;
    const rawModels = Array.isArray(json?.models) ? json.models : [];
    for (const rawModel of rawModels) {
      const classified = classifyGeminiModel(rawModel);
      if (classified && !seenIds.has(classified.id)) {
        seenIds.set(classified.id, classified);
      }
    }

    const next = typeof json?.nextPageToken === "string" ? json.nextPageToken.trim() : "";
    if (!next) break;
    if (seenTokens.has(next)) {
      loopDetected = true;
      break;
    }
    if (pagesFetched >= MAX_DISCOVERY_PAGES) {
      paginationTruncated = true;
      break;
    }
    seenTokens.add(next);
    pageToken = next;
  }

  // Sort deterministically by id so catalog order never depends on network pagination order
  const models = Array.from(seenIds.values()).sort((a, b) => a.id.localeCompare(b.id));
  return {
    models,
    pagesFetched,
    totalDiscovered: models.length,
    loopDetected,
    paginationTruncated,
  };
}

export function createModelCatalogService({
  baseUrl = DEFAULT_GEMINI_BASE,
  fetchImpl = globalThis.fetch,
  cacheTtlMs = DEFAULT_DISCOVERY_TTL_MS,
  clock = () => Date.now(),
  timeoutMs = 20_000,
  pageSize = 100,
} = {}) {
  const cacheByKey = new Map();
  const inflightByKey = new Map();

  function invalidate(apiKey = null) {
    if (!apiKey) {
      cacheByKey.clear();
      return;
    }
    const fp = keyFingerprint(apiKey);
    cacheByKey.delete(fp);
  }

  function getCachedSnapshot(apiKey) {
    const fp = keyFingerprint(apiKey);
    if (!fp) return null;
    const entry = cacheByKey.get(fp);
    if (!entry) return null;
    return {
      ...entry,
      stale: clock() - entry.syncedAt >= cacheTtlMs,
    };
  }

  function awaitWithSignal(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) {
      return Promise.reject(new DOMException("Operation aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException("Operation aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (val) => {
          signal.removeEventListener("abort", onAbort);
          resolve(val);
        },
        (err) => {
          signal.removeEventListener("abort", onAbort);
          reject(err);
        },
      );
    });
  }

  async function listGeminiModels(apiKey, { signal, forceRefresh = false } = {}) {
    const cleanKey = String(apiKey || "").trim();
    if (!cleanKey) {
      const err = new Error("No Gemini API key saved. Add one in Settings.");
      err.code = "NO_API_KEY";
      throw err;
    }
    if (signal?.aborted) {
      throw new DOMException("Operation aborted", "AbortError");
    }
    const fp = keyFingerprint(cleanKey);
    const now = clock();

    if (!forceRefresh) {
      const cached = cacheByKey.get(fp);
      if (cached && now - cached.syncedAt < cacheTtlMs) {
        return { ...cached, fromCache: true };
      }
    }

    const inflightKey = fp;
    if (inflightByKey.has(inflightKey)) {
      const shared = await awaitWithSignal(inflightByKey.get(inflightKey), signal);
      return { ...shared, fromCache: !forceRefresh, coalesced: true };
    }

    const promise = (async () => {
      const fetched = await fetchGeminiModelCatalog(cleanKey, {
        baseUrl,
        fetchImpl,
        timeoutMs,
        pageSize,
      });
      const entry = {
        keyFp: fp,
        models: fetched.models,
        totalDiscovered: fetched.totalDiscovered,
        pagesFetched: fetched.pagesFetched,
        loopDetected: fetched.loopDetected,
        paginationTruncated: fetched.paginationTruncated,
        syncedAt: clock(),
      };
      cacheByKey.set(fp, entry);
      return entry;
    })();

    inflightByKey.set(inflightKey, promise);
    try {
      const out = await awaitWithSignal(promise, signal);
      return { ...out, fromCache: false };
    } finally {
      if (inflightByKey.get(inflightKey) === promise) {
        inflightByKey.delete(inflightKey);
      }
    }
  }

  return {
    listGeminiModels,
    getCachedSnapshot,
    invalidate,
  };
}
