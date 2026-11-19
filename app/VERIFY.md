# Studio app — verification log

## OOS-UI-02 Verification (2026-11-19, React + Vite Redesign & Gemini Auto Discovery/Fallback)

Branch: `feat/studio-react-vite-migration` (upgraded from baseline `ec4de1340bfedefa9b4dd98b9f9d37a9315be9ce`).
Full artifacts & screenshots: `docs/executions/OOS-UI-02-2026-11-19/`.

| Gate / Check | Status | Evidence |
|---|---|---|
| `npm ci --no-audit --no-fund` | PASS | Deterministic clean install from `app/package-lock.json` (exit code 0) |
| `npm test` (`test/*.test.mjs`) | PASS | `24/24` tests in `~210 ms`: helper contracts, multi-page `listModels`, order-independent ranking, all 24 D3 fallback/quota/auth/abort/cooldown/recovery scenarios, and HTTP/NDJSON API contracts |
| `npm run build` | PASS | Vite `v7.3.8` production bundle built to `app/dist/` (`0.77 kB` HTML, `28.00 kB` CSS / `6.02 kB` gzip, `290.51 kB` JS / `89.29 kB` gzip, exit code 0) |
| `npm run test:e2e` (`test/e2e-ui.mjs`) | PASS | Headless Chrome E2E across both Vite dev server and production `server.mjs`, `36` viewport/tab checks (`320, 375, 390, 430, 768, 1024, 1440, 1650, 1920` px), zero horizontal overflow, zero console/page errors, WCAG AA contrast verified in Dark (`>12:1` body, `>7:1` CTA) & Light (`>10:1` body, `>4.5:1` CTA) |
| Live Gemini Discovery & Fallback Probe (`D9`) | PASS (with real fallback) | `POST /api/gemini/discover` fetched `65` live models; `POST /api/test-connection` tried Rank #1 `gemini-2.5-pro` (`404 unsupported`, `201 ms`) -> Rank #2 `gemini-3.8-flash` (`503 overload`, `1623 ms`) -> tier-diversified fallback `gemini-3.5-flash-lite` (`200 OK`, replied `"OK"` in `974 ms`, total `2902 ms`, `downgraded: true`) |
| `engine/` TypeScript Backtest | PASS | `cd engine && npx tsc --noEmit` exit code 0; `git diff engine/ pipeline/` empty (`0` files modified) |
| Secret Hygiene Scan | PASS | Zero matches for API key or `AIza` real tokens across tracked files, screenshots, and `test-artifacts/` |

---

## Historical Pre-Migration Log (2026-11-19, original build machine)

Server: `node app/server.mjs` on PORT=4173, Node 24, zero npm dependencies.
Gemini defaults (from ListModels, HTTP 200 in 0.9s; 65 models, 50 generateContent-capable):
text/vision = `gemini-3.8-flash`, TTS = `gemini-3.8-flash-tts` (dedicated TTS model in the list).

| Check | Result | Evidence |
|---|---|---|
| GET / | PASS | HTTP 200, 4452 bytes, `<title>Out of Step — Studio</title>`, "Settings" present |
| GET /api/settings (no key) | PASS | 4 providers; gemini integrated, others `"status":"not integrated yet"` |
| POST /api/settings (save Gemini key) | PASS | Response masked, `hasKey:true`; full key absent from response (asserted); key written only to `app/data/settings.json` (gitignored) |
| GET /api/settings (after save) | PASS | Masked key + models `gemini-3.8-flash` / `gemini-3.8-flash-tts` |
| POST /api/test-connection (gemini) | PASS | `{"ok":true,"latencyMs":270259,"model":"gemini-3.8-flash","reply":"OK"}` — slow (~4.5 min) but inside the 300s timeout |
| POST /api/test-connection (other providers) | PASS | Returns `{"ok":false,"error":"not integrated yet"}` (by design) |
| POST /api/script (topic "a cowboy who learns to share", 30s) | PASS (2nd attempt) | 1st attempt: Gemini HTTP 503 "This model is currently experiencing high demand" — surfaced verbatim as `{ok:false,error}`. Retry: `ok:true`, title "The Frontier Skillet", 9 beats with estSec, `totalWords:102` |
| POST /api/check-still (stills/s_200.jpg, shot note: front MS of column marching) | PASS | `ok:true`, verdict `FAIL`, issues: ["Foreground characters are clipped by the left and right frame edges"], summary present — a plausible, real QA catch |
| POST /api/tts ("Howdy, partner. Mind your step on that bridge.") | PASS | `ok:true`, model `gemini-3.8-flash-tts`, saved `app/data/tts-output.wav` 172,872 bytes; ffprobe: pcm_s16le, 24000 Hz, mono, 3.60s |
