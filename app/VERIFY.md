# Studio app — verification log (2026-11-19, this build machine)

Server: `node app/server.mjs` on PORT=4173, Node 24, zero npm dependencies.
Gemini defaults (from ListModels, HTTP 200 in 0.9s; 65 models, 50 generateContent-capable):
text/vision = `gemini-3.8-flash`, TTS = `gemini-3.8-flash-tts` (dedicated TTS model in the list).

| Check | Result | Evidence |
|---|---|---|
| GET / | PASS | HTTP 200, 4452 bytes, `<title>Out of Step — Studio</title>`, "Settings" present |
| GET /api/settings (no key) | PASS | 4 providers; gemini integrated, others `"status":"not integrated yet"` |
| POST /api/settings (save Gemini key) | PASS | Response masked `••••••••fhNwA`, `hasKey:true`; full key absent from response (asserted); key written only to `app/data/settings.json` (gitignored) |
| GET /api/settings (after save) | PASS | Masked key + models `gemini-3.8-flash` / `gemini-3.8-flash-tts` |
| POST /api/test-connection (gemini) | PASS | `{"ok":true,"latencyMs":270259,"model":"gemini-3.8-flash","reply":"OK"}` — slow (~4.5 min) but inside the 300s timeout |
| POST /api/test-connection (other providers) | PASS | Returns `{"ok":false,"error":"not integrated yet"}` (by design) |
| POST /api/script (topic "a cowboy who learns to share", 30s) | PASS (2nd attempt) | 1st attempt: Gemini HTTP 503 "This model is currently experiencing high demand" — surfaced verbatim as `{ok:false,error}`. Retry: `ok:true`, title "The Frontier Skillet", 9 beats with estSec, `totalWords:102` |
| POST /api/check-still (stills/s_200.jpg, shot note: front MS of column marching) | PASS | `ok:true`, verdict `FAIL`, issues: ["Foreground characters are clipped by the left and right frame edges"], summary present — a plausible, real QA catch |
| POST /api/tts ("Howdy, partner. Mind your step on that bridge.") | PASS | `ok:true`, model `gemini-3.8-flash-tts`, saved `app/data/tts-output.wav` 172,872 bytes; ffprobe: pcm_s16le, 24000 Hz, mono, 3.60s |

Notes:
- Gemini generateContent latency from this VM is minutes-scale (test-connection 270s);
  the UI warns about 1–3 minute waits. Server-side timeout is 300s.
- No API key appears in this file or anywhere in the repo outside `app/data/settings.json`.
