// Pure frontend helpers mirror the old app/public/app.js contract.
export const PROVIDER_LABELS = {
  gemini: "Google Gemini (AI Studio)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  elevenlabs: "ElevenLabs",
};

export async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export function readLastGeminiTest() {
  try {
    return JSON.parse(localStorage.getItem("oos-gemini-test") || "null");
  } catch {
    return null;
  }
}

export function connectionStatus(providers, lastTest) {
  if (!providers) return { className: "pill pill-unknown", text: "Gemini: not tested" };
  const gemini = providers.gemini || {};
  if (!gemini.hasKey) return { className: "pill", text: "Gemini: no key saved" };
  if (lastTest?.ok) return { className: "pill pill-ok", text: "Gemini: connected (last test OK)" };
  if (lastTest && !lastTest.ok) return { className: "pill pill-bad", text: "Gemini: last test failed" };
  return { className: "pill", text: "Gemini: key saved, not tested" };
}

export function scriptWordCount(script) {
  return script.totalWords ?? script.beats.reduce(
    (n, beat) => n + String(beat.text).split(/\s+/).length, 0,
  );
}
