// Pure frontend helpers + resilient API/stream transport for Out of Step Studio.

export const PROVIDER_LABELS = {
  gemini: "Google Gemini (AI Studio)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  elevenlabs: "ElevenLabs",
};

export const POLICY_LABELS = {
  quality: {
    title: "Highest quality",
    subtitle: "Pro → Flash → Flash-Lite (default; Pro models use higher quota/cost)",
    badge: "Pro priority",
  },
  balanced: {
    title: "Balanced",
    subtitle: "Flash → Flash-Lite → Pro (recommended for fast iteration)",
    badge: "Flash priority",
  },
  fast: {
    title: "Fast / Economy",
    subtitle: "Flash-Lite → Flash (lowest latency & token cost)",
    badge: "Lite priority",
  },
};

// Server body limit is 12 MB; base64 expands binary by ~33.3% plus JSON envelope.
export const MAX_STILL_FILE_BYTES = Math.floor(8.5 * 1024 * 1024);
export const FRESH_VERIFICATION_WINDOW_MS = 30 * 60 * 1000;

export async function api(path, body, options = {}) {
  const { signal } = options;
  let res;
  try {
    res = await fetch(path, {
      method: body !== undefined ? "POST" : "GET",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new Error(`Network error calling ${path}: ${String(err?.message || err)}`);
  }

  const rawText = await res.text();
  let json;
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(
      `Server returned non-JSON response (HTTP ${res.status}): ${rawText.slice(0, 160).trim() || res.statusText}`,
    );
  }

  if (!res.ok && typeof json?.ok !== "boolean") {
    throw new Error(json?.error || `HTTP ${res.status}: ${res.statusText}`);
  }
  return json;
}

export async function streamTestConnection({ provider = "gemini", signal, onProgress } = {}) {
  const res = await fetch("/api/test-connection", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/x-ndjson, application/json",
    },
    body: JSON.stringify({ provider, stream: true }),
    signal,
  });

  const contentType = String(res.headers.get("content-type") || "");
  if (!contentType.includes("application/x-ndjson") || !res.body) {
    const raw = await res.text();
    return JSON.parse(raw);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult = null;

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        throw new DOMException("Operation aborted", "AbortError");
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIndex;
      while ((nlIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nlIndex).trim();
        buffer = buffer.slice(nlIndex + 1);
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type === "progress" && onProgress && parsed.event) {
          onProgress(parsed.event);
        } else if (parsed.type === "result") {
          finalResult = parsed.data;
        }
      }
    }
    buffer += decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore releaseLock error
    }
  }

  if (buffer.trim() && !finalResult) {
    try {
      const parsed = JSON.parse(buffer.trim());
      if (parsed.type === "result") finalResult = parsed.data;
      else if (typeof parsed.ok === "boolean") finalResult = parsed;
    } catch {
      // ignore trailing fragment
    }
  }

  if (!finalResult) {
    throw new Error("Connection test stream ended without a result payload.");
  }
  return finalResult;
}

export function readLastGeminiTest() {
  try {
    const parsed = JSON.parse(localStorage.getItem("oos-gemini-test") || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function formatRelativeTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const diffSec = Math.max(0, Math.round((now - timestamp) / 1000));
  if (diffSec < 15) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function connectionStatus(providers, lastTest, options = {}) {
  const {
    testing = false,
    now = Date.now(),
    staleAfterMs = FRESH_VERIFICATION_WINDOW_MS,
  } = options;

  if (!providers) {
    return { className: "pill pill-unknown", text: "Gemini: not tested", state: "unknown" };
  }
  const gemini = providers.gemini || {};
  if (!gemini.hasKey) {
    return { className: "pill", text: "Gemini: no key saved", state: "no-key" };
  }
  if (testing) {
    return { className: "pill pill-testing", text: "Gemini: testing…", state: "testing" };
  }

  // Prefer live server verification timestamp if fresher than localStorage
  const serverVerified = gemini.health?.capabilities?.text;
  const effectiveTest =
    lastTest ||
    (serverVerified?.verifiedAt
      ? {
          ok: true,
          at: serverVerified.verifiedAt,
          model: serverVerified.verifiedModel,
          downgraded: serverVerified.downgraded,
        }
      : null);

  if (!effectiveTest) {
    return { className: "pill", text: "Gemini: key saved, not tested", state: "never-tested" };
  }

  if (effectiveTest.ok) {
    const hasTimestamp = Number.isFinite(effectiveTest.at) && effectiveTest.at > 0;
    const isStale = hasTimestamp && now - effectiveTest.at > staleAfterMs;
    if (isStale) {
      return {
        className: "pill pill-stale",
        text: `Gemini: verified ${formatRelativeTime(effectiveTest.at, now)} (re-test)`,
        state: "stale",
        ageLabel: formatRelativeTime(effectiveTest.at, now),
      };
    }
    if (effectiveTest.downgraded) {
      return {
        className: "pill pill-warn",
        text: `Gemini: connected (fallback${effectiveTest.model ? ` · ${effectiveTest.model}` : ""})`,
        state: "degraded-fallback",
        ageLabel: hasTimestamp ? formatRelativeTime(effectiveTest.at, now) : "",
      };
    }
    return {
      className: "pill pill-ok",
      text: "Gemini: connected (last test OK)",
      state: "connected",
      ageLabel: hasTimestamp ? formatRelativeTime(effectiveTest.at, now) : "",
    };
  }

  const category = String(effectiveTest.reasonCategory || "");
  if (category === "auth" || category === "permission" || category === "quota_global") {
    return {
      className: "pill pill-bad",
      text: category === "quota_global" ? "Gemini: quota blocked" : "Gemini: key / access blocked",
      state: "blocked",
    };
  }

  return { className: "pill pill-bad", text: "Gemini: last test failed", state: "failed" };
}

export function scriptWordCount(script) {
  if (!script || typeof script !== "object") return 0;
  return (
    script.totalWords ??
    (Array.isArray(script.beats)
      ? script.beats.reduce(
          (n, beat) => n + String(beat?.text || "").trim().split(/\s+/).filter(Boolean).length,
          0,
        )
      : 0)
  );
}

export function scriptTotalSeconds(script) {
  if (!Array.isArray(script?.beats)) return 0;
  return script.beats.reduce((sum, b) => sum + (Number(b?.estSec) || 0), 0);
}

export function formatScriptForClipboard(script, model) {
  if (!script || !Array.isArray(script.beats)) return "";
  const header = `# ${script.title || "Untitled"}\n# Words: ${scriptWordCount(script)} · Est. ${scriptTotalSeconds(script).toFixed(1)}s${model ? ` · Model: ${model}` : ""}\n`;
  const lines = script.beats.map(
    (beat, idx) => `${idx + 1}. [${Number(beat.estSec || 0).toFixed(1)}s] ${String(beat.text || "").trim()}`,
  );
  return `${header}\n${lines.join("\n")}\n`;
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function validateImageFile(file, maxBytes = MAX_STILL_FILE_BYTES) {
  if (!file) {
    return { ok: false, error: "Choose an image file first." };
  }
  const type = String(file.type || "");
  if (!type.startsWith("image/")) {
    return {
      ok: false,
      error: `Unsupported file type "${type || "unknown"}". Upload a PNG, JPEG, WebP, or GIF image.`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, error: "Selected image file is empty (0 bytes)." };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: `Image is ${formatBytes(file.size)}, which exceeds the ${formatBytes(maxBytes)} upload limit (12 MB base64 request cap). Resize or compress the frame first.`,
    };
  }
  return { ok: true };
}
