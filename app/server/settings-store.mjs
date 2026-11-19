import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PROVIDERS = ["gemini", "openai", "anthropic", "elevenlabs"];
export const SELECTION_MODES = ["auto", "manual"];
export const MODEL_POLICIES = ["quality", "balanced", "fast"];
export const VALID_MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

const ALLOWED_PROVIDER_FIELDS = {
  gemini: new Set([
    "apiKey",
    "textModel",
    "visionModel",
    "ttsModel",
    "selectionMode",
    "modelPolicy",
    "includePreview",
  ]),
  openai: new Set(["apiKey"]),
  anthropic: new Set(["apiKey"]),
  elevenlabs: new Set(["apiKey"]),
};

const writeQueues = new Map();

export function defaultSettings() {
  return {
    gemini: {
      apiKey: "",
      textModel: "gemini-3.8-flash",
      visionModel: "gemini-3.8-flash",
      ttsModel: "gemini-3.8-flash-tts",
      selectionMode: "auto",
      modelPolicy: "quality",
      includePreview: false,
      integrated: true,
    },
    openai: { apiKey: "", integrated: false },
    anthropic: { apiKey: "", integrated: false },
    elevenlabs: { apiKey: "", integrated: false },
  };
}

export function keyFingerprint(apiKey) {
  const clean = String(apiKey || "").trim();
  if (!clean) return "";
  return crypto.createHash("sha256").update(clean).digest("hex").slice(0, 16);
}

export function maskKey(key) {
  const clean = String(key || "");
  if (!clean) return "";
  return "••••••••" + clean.slice(-5);
}

export function redactSecrets(input, extraSecrets = []) {
  let text = String(input ?? "");
  for (const secret of extraSecrets) {
    const s = String(secret || "").trim();
    if (s.length >= 6) {
      text = text.split(s).join("[REDACTED]");
    }
  }
  text = text.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]");
  return text;
}

export function normalizeModelSettingValue(raw) {
  const trimmed = String(raw || "").trim().replace(/^models\//i, "");
  if (!trimmed) return "";
  if (!VALID_MODEL_ID_RE.test(trimmed)) {
    throw new Error(`Invalid model identifier format: "${trimmed.slice(0, 48)}"`);
  }
  return trimmed;
}

function coerceSettingsObject(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;

  for (const p of PROVIDERS) {
    const src = raw[p];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    const allowed = ALLOWED_PROVIDER_FIELDS[p];
    for (const [k, v] of Object.entries(src)) {
      if (!allowed.has(k)) continue;
      if (k === "includePreview") {
        base[p].includePreview = v === true || v === "true";
      } else if (k === "selectionMode") {
        if (SELECTION_MODES.includes(String(v))) base[p].selectionMode = String(v);
      } else if (k === "modelPolicy") {
        if (MODEL_POLICIES.includes(String(v))) base[p].modelPolicy = String(v);
      } else if (k === "textModel" || k === "visionModel" || k === "ttsModel") {
        if (typeof v === "string" && v.trim()) {
          const candidate = v.trim().replace(/^models\//i, "");
          if (VALID_MODEL_ID_RE.test(candidate)) base[p][k] = candidate;
        }
      } else if (typeof v === "string") {
        base[p][k] = v.trim();
      }
    }
    base[p].integrated = p === "gemini";
  }
  return base;
}

export function loadSettings(dataDir) {
  const file = path.join(dataDir, "settings.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return coerceSettingsObject(raw);
  } catch {
    return defaultSettings();
  }
}

function atomicWriteJsonSync(filePath, obj) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const nonce = crypto.randomBytes(6).toString("hex");
  const tmpFile = `${filePath}.${process.pid}.${nonce}.tmp`;
  const payload = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmpFile, payload, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpFile, filePath);
}

export function withDataDirLock(dataDir, fn) {
  const key = path.resolve(dataDir);
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.then(() => fn(), () => fn());
  writeQueues.set(
    key,
    next.finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    }),
  );
  return next;
}

export function saveSettings(dataDir, settings) {
  const sanitized = coerceSettingsObject(settings);
  atomicWriteJsonSync(path.join(dataDir, "settings.json"), sanitized);
  return sanitized;
}

export async function updateProviderSettings(dataDir, provider, fields) {
  if (!PROVIDERS.includes(provider) || !fields || typeof fields !== "object" || Array.isArray(fields)) {
    const err = new Error("Expected {provider, fields}.");
    err.statusCode = 400;
    throw err;
  }

  return withDataDirLock(dataDir, async () => {
    const current = loadSettings(dataDir);
    const prevKeyFp = keyFingerprint(current.gemini.apiKey);
    const allowed = ALLOWED_PROVIDER_FIELDS[provider];

    for (const [k, v] of Object.entries(fields)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (k === "clearKey" && v === true) {
        current[provider].apiKey = "";
        continue;
      }
      if (!allowed.has(k)) continue;

      if (k === "apiKey") {
        if (typeof v !== "string") continue;
        const trimmed = v.trim();
        // Blank apiKey preserves existing saved key.
        if (!trimmed) continue;
        current[provider].apiKey = trimmed;
      } else if (k === "includePreview") {
        current[provider].includePreview = v === true || v === "true";
      } else if (k === "selectionMode") {
        const mode = String(v || "").trim();
        if (!SELECTION_MODES.includes(mode)) {
          const err = new Error(`Invalid selectionMode "${mode}". Expected auto or manual.`);
          err.statusCode = 400;
          throw err;
        }
        current[provider].selectionMode = mode;
      } else if (k === "modelPolicy") {
        const policy = String(v || "").trim();
        if (!MODEL_POLICIES.includes(policy)) {
          const err = new Error(`Invalid modelPolicy "${policy}". Expected quality, balanced, or fast.`);
          err.statusCode = 400;
          throw err;
        }
        current[provider].modelPolicy = policy;
      } else if (k === "textModel" || k === "visionModel" || k === "ttsModel") {
        if (typeof v !== "string") continue;
        const normalized = normalizeModelSettingValue(v);
        if (normalized) current[provider][k] = normalized;
      }
    }

    const saved = saveSettings(dataDir, current);
    const nextKeyFp = keyFingerprint(saved.gemini.apiKey);
    return {
      settings: saved,
      geminiKeyChanged: prevKeyFp !== nextKeyFp,
      keyFp: nextKeyFp,
    };
  });
}

export function maskedSettings(settings, geminiHealth = null) {
  const out = {};
  for (const p of PROVIDERS) {
    const src = settings[p] || {};
    out[p] = {
      ...src,
      integrated: src.integrated === true,
      apiKey: maskKey(src.apiKey || ""),
      hasKey: Boolean(src.apiKey),
    };
    if (!src.integrated) {
      out[p].status = "not integrated yet";
    }
    if (p === "gemini" && geminiHealth) {
      out[p].health = geminiHealth;
    }
  }
  return out;
}

export function loadRuntimeState(dataDir) {
  const file = path.join(dataDir, "runtime-state.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") throw new Error("invalid");
    return {
      keyFp: typeof raw.keyFp === "string" ? raw.keyFp : "",
      verified: raw.verified && typeof raw.verified === "object" ? raw.verified : {},
      recentTrails: Array.isArray(raw.recentTrails) ? raw.recentTrails.slice(0, 20) : [],
    };
  } catch {
    return { keyFp: "", verified: {}, recentTrails: [] };
  }
}

export function saveRuntimeState(dataDir, state) {
  const clean = {
    keyFp: String(state?.keyFp || ""),
    verified: state?.verified && typeof state.verified === "object" ? state.verified : {},
    recentTrails: Array.isArray(state?.recentTrails) ? state.recentTrails.slice(0, 20) : [],
  };
  atomicWriteJsonSync(path.join(dataDir, "runtime-state.json"), clean);
  return clean;
}
