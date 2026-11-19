// Out of Step Studio — backend (Node 24, zero dependencies: node:http + node:fs only).
// All AI steps go through Google Gemini (AI Studio API key), server-side only.
// The API key lives ONLY in app/data/settings.json (gitignored) and is never
// sent to the browser; /api/settings returns keys masked.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const BUILT_DIR = path.join(__dirname, "dist");
// Use the Vite build in production, with the legacy assets as pre-build fallback.
const STATIC_DIR = fs.existsSync(path.join(BUILT_DIR, "index.html")) ? BUILT_DIR : PUBLIC_DIR;
const DATA_DIR = path.join(__dirname, "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const PORT = Number(process.env.PORT || 4173);
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TIMEOUT_MS = 300_000; // Gemini can take minutes from this host.

const PROVIDERS = ["gemini", "openai", "anthropic", "elevenlabs"];

function defaultSettings() {
  return {
    gemini: {
      apiKey: "",
      textModel: "gemini-3.8-flash",
      visionModel: "gemini-3.8-flash",
      // Experimental: ListModels (2026-11-19) shows a dedicated TTS model for this account.
      ttsModel: "gemini-3.8-flash-tts",
      integrated: true,
    },
    openai: { apiKey: "", integrated: false },
    anthropic: { apiKey: "", integrated: false },
    elevenlabs: { apiKey: "", integrated: false },
  };
}

function loadSettings() {
  const base = defaultSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    for (const p of PROVIDERS) {
      if (raw[p] && typeof raw[p] === "object") {
        for (const [k, v] of Object.entries(raw[p])) {
          if (typeof v === "string") base[p][k] = v;
        }
      }
    }
  } catch {
    /* no settings file yet — defaults */
  }
  return base;
}

function saveSettings(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

function maskKey(key) {
  if (!key) return "";
  return "••••••••" + key.slice(-5);
}

function maskedSettings(s) {
  const out = {};
  for (const p of PROVIDERS) {
    out[p] = { ...s[p], integrated: s[p].integrated === true };
    out[p].apiKey = maskKey(s[p].apiKey || "");
    out[p].hasKey = Boolean(s[p].apiKey);
    if (!s[p].integrated) out[p].status = "not integrated yet";
  }
  return out;
}

// ---------- Gemini ----------

async function geminiGenerate({ model, parts, generationConfig }) {
  const s = loadSettings();
  const key = s.gemini.apiKey;
  if (!key) throw new Error("No Gemini API key saved. Add one in Settings.");
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      ...(generationConfig ? { generationConfig } : {}),
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 300);
    throw new Error(`Gemini HTTP ${res.status}: ${msg}`);
  }
  return json;
}

function geminiText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("");
}

function parseJsonLoose(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

// ---------- HTTP plumbing ----------

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Request body too large (limit 12 MB)"));
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
  return JSON.parse(raw);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  rel = decodeURIComponent(rel.split("?")[0]);
  const file = path.resolve(STATIC_DIR, "." + rel);
  if (!(file === STATIC_DIR || file.startsWith(STATIC_DIR + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

// ---------- Routes ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (p === "/api/settings" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, providers: maskedSettings(loadSettings()) });
    }

    if (p === "/api/settings" && req.method === "POST") {
      const body = await readJsonBody(req);
      const { provider, fields } = body || {};
      if (!PROVIDERS.includes(provider) || !fields || typeof fields !== "object") {
        return sendJson(res, 400, { ok: false, error: "Expected {provider, fields}." });
      }
      const s = loadSettings();
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === "string") s[provider][k] = v.trim();
      }
      saveSettings(s);
      return sendJson(res, 200, { ok: true, providers: maskedSettings(loadSettings()) });
    }

    if (p === "/api/test-connection" && req.method === "POST") {
      const body = await readJsonBody(req);
      const provider = body?.provider || "gemini";
      if (provider !== "gemini") {
        return sendJson(res, 200, { ok: false, error: "not integrated yet" });
      }
      const s = loadSettings();
      const model = s.gemini.textModel || "gemini-3.8-flash";
      const t0 = Date.now();
      try {
        const json = await geminiGenerate({
          model,
          parts: [{ text: "Reply with exactly: OK" }],
          // >=512: Gemini "thinking" tokens count against maxOutputTokens.
          generationConfig: { maxOutputTokens: 512 },
        });
        return sendJson(res, 200, {
          ok: true,
          latencyMs: Date.now() - t0,
          model,
          reply: geminiText(json).trim().slice(0, 100),
        });
      } catch (e) {
        return sendJson(res, 200, { ok: false, latencyMs: Date.now() - t0, model, error: String(e.message || e) });
      }
    }

    if (p === "/api/script" && req.method === "POST") {
      const body = await readJsonBody(req);
      const topic = String(body?.topic || "").trim();
      const durationSec = [30, 60].includes(Number(body?.durationSec)) ? Number(body.durationSec) : 30;
      if (!topic) return sendJson(res, 400, { ok: false, error: "topic is required" });
      const s = loadSettings();
      const model = s.gemini.textModel || "gemini-3.8-flash";
      const targetWords = Math.round(durationSec * 3.5);
      const beats = durationSec <= 30 ? 9 : 16;
      const prompt =
        `Write narration for a vertical (9:16) cartoon story short in the style of "Out of Step": ` +
        `a true-or-plausible little lesson retold with gentle deadpan humour, one steady English narrator, no captions. ` +
        `Topic: ${topic}. Target duration ${durationSec} seconds at ~3.5 words/second (~${targetWords} words total), about ${beats} beats. ` +
        `Structure the beats like: hook, setting, rising action, snap/surprise, deadpan line, plain-language explanation, callback. ` +
        `Return ONLY JSON, no markdown, in exactly this shape: ` +
        `{"title":"...","beats":[{"text":"...","estSec":3.5}],"totalWords":123}`;
      try {
        const json = await geminiGenerate({
          model,
          parts: [{ text: prompt }],
          generationConfig: { maxOutputTokens: 4096 },
        });
        const parsed = parseJsonLoose(geminiText(json));
        if (!parsed || !Array.isArray(parsed.beats)) throw new Error("Model did not return a beats array.");
        return sendJson(res, 200, { ok: true, model, script: parsed });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: String(e.message || e) });
      }
    }

    if (p === "/api/check-still" && req.method === "POST") {
      const body = await readJsonBody(req);
      const imageBase64 = String(body?.imageBase64 || "");
      const mimeType = String(body?.mimeType || "image/jpeg");
      const shotNote = String(body?.shotNote || "").trim();
      if (!imageBase64) return sendJson(res, 400, { ok: false, error: "imageBase64 is required" });
      const s = loadSettings();
      const model = s.gemini.visionModel || "gemini-3.8-flash";
      const prompt =
        `You are the visual QA checker for a cartoon short frame. ` +
        (shotNote ? `Shot intent: ${shotNote}. ` : "") +
        `Check: characters readable and not clipped by frame edges or props, no rendering glitches, ` +
        `no blank/black areas, composition matches the shot intent. ` +
        `Return ONLY JSON, no markdown: {"verdict":"PASS" or "FAIL","issues":["..."],"summary":"one short sentence"}`;
      try {
        const json = await geminiGenerate({
          model,
          parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }],
          generationConfig: { maxOutputTokens: 2048 },
        });
        const parsed = parseJsonLoose(geminiText(json));
        return sendJson(res, 200, { ok: true, model, result: parsed });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: String(e.message || e) });
      }
    }

    // EXPERIMENTAL: Gemini TTS. Availability depends on the models the account
    // can access; errors are returned verbatim — success is never faked.
    if (p === "/api/tts" && req.method === "POST") {
      const body = await readJsonBody(req);
      const text = String(body?.text || "").trim();
      const voiceName = String(body?.voiceName || "Kore").trim();
      if (!text) return sendJson(res, 400, { ok: false, error: "text is required" });
      const s = loadSettings();
      const model = s.gemini.ttsModel || "gemini-3.8-flash";
      try {
        const key = s.gemini.apiKey;
        if (!key) throw new Error("No Gemini API key saved. Add one in Settings.");
        const res2 = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            },
          }),
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        });
        const raw = await res2.text();
        let json;
        try { json = JSON.parse(raw); } catch { throw new Error(`TTS returned non-JSON (HTTP ${res2.status})`); }
        if (!res2.ok) throw new Error(`Gemini HTTP ${res2.status}: ${json?.error?.message || raw.slice(0, 300)}`);
        const parts = json?.candidates?.[0]?.content?.parts || [];
        const audioPart = parts.find((x) => x.inlineData?.data);
        if (!audioPart) throw new Error("Model returned no audio data (TTS may be unavailable for this model/account).");
        const pcm = Buffer.from(audioPart.inlineData.data, "base64");
        // Gemini TTS returns raw L16 PCM, 24 kHz mono — wrap in a WAV header.
        const wav = wavWrapPcm16(pcm, 24000, 1);
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const file = path.join(DATA_DIR, "tts-output.wav");
        fs.writeFileSync(file, wav);
        return sendJson(res, 200, { ok: true, model, file: "app/data/tts-output.wav", bytes: wav.length });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: String(e.message || e) });
      }
    }

    if (p.startsWith("/api/")) return sendJson(res, 404, { ok: false, error: "Unknown endpoint" });
    return serveStatic(req, res, p);
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
});

function wavWrapPcm16(pcm, sampleRate, channels) {
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

server.listen(PORT, () => {
  console.log(`Out of Step Studio listening on http://localhost:${PORT}`);
});
