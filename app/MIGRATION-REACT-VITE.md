# React + Vite Studio Migration & OOS-UI-02 Redesign Record

- **Base branch:** `main` (`8ba41d9a6e40b985408b01158ab761efee9718aa`)
- **Active branch:** `feat/studio-react-vite-migration`
- **OOS-UI-02 Upgrade (2026-11-19):** Navy–Gold responsive SaaS redesign + server-side Gemini automatic model discovery, capability ranking, and bounded 503 fallback.

---

## Architecture Boundary

- **`app/src/` (React + Vite frontend):**
  - Modularized into `components/{Sidebar,Topbar}.jsx`, `pages/{DashboardPage,ScriptPage,StillCheckPage,SettingsPage}.jsx`, `hooks/useGeminiStudio.js`, `lib/studio.mjs`, and CSS design-system layers `styles/{tokens,layout,components}.css`.
  - Full-width desktop layout (`max-width: 1440px`), collapsible sidebar rail, contextual topbar, 2-column Script/Still Check workspaces, 2-panel Gemini Control Center in Settings, and mobile slide-over drawer + sticky bottom quick-navigation (`320px–768px`).
- **`app/server.mjs` + `app/server/*.mjs` (Zero external npm runtime dependencies):**
  - `settings-store.mjs`: atomic file writes, strict field allowlist, blank API key preservation, SHA-256 key fingerprinting, secret redaction.
  - `gemini-models.mjs`: paginated `GET /v1beta/models` discovery (`nextPageToken`), model ID allowlist normalization, capability classification (`text`, `vision`, `tts`), deterministic ranking (`quality` / `balanced` / `fast` policies + preview opt-in), single-flight discovery + TTL cache.
  - `gemini-transport.mjs`: unified `geminiGenerate`, `classifyGeminiError`, `retryWithBackoff` (exponential backoff + jitter + `Retry-After` / `RetryInfo`), `ModelHealthRegistry` (temporary cooldown + auto-recovery back to preferred model), shared `runGeminiWithFallback` across `/api/test-connection`, `/api/script`, `/api/check-still`, and `/api/tts`, plus strict output validators.
  - `create-server.mjs`: serves `app/dist/` in production (falling back to `app/public/`), supports both legacy JSON and live NDJSON progress streaming on `POST /api/test-connection`, and exposes additive `GET /api/gemini/status`, `GET /api/gemini/models`, and `POST /api/gemini/discover`.
- **`engine/` & `pipeline/`:** Completely untouched (`0` files modified). `app/public/` legacy files preserved as pre-build fallback.

---

## Behavioral Invariants Preserved

1. **Navigation & Keep-Mounted State:** Dashboard, Script, Still Check, Settings remain mounted via `.panel-host` so unsaved form inputs, image previews, and generated results survive tab switches.
2. **Theme:** Dark Navy–Gold default, Light theme supported, persisted under `localStorage["oos-theme"]`, WCAG AA contrast verified programmatically.
3. **Settings & Secret Hygiene:** `GET/POST /api/settings` masks keys (`••••••••` + last 5 chars), blank `apiKey` preserves saved key on both client and server, unintegrated providers (`openai`, `anthropic`, `elevenlabs`) remain `"not integrated yet"`.
4. **Honest Connection Verification:** `POST /api/test-connection` requires a real `generateContent` `"OK"` reply before marking connected (`listModels` HTTP 200 alone never marks connected); stale cached `oos-gemini-test` entries (>30m) display relative age rather than masquerading as freshly verified.
5. **Script, Vision QA & Experimental TTS:** Prompts, beat schema, `PASS`/`FAIL` vision verdict contract, and 24 kHz mono PCM16 WAV wrapping (`app/data/tts-output.wav`) preserved 100%, now backed by capability-matched automatic fallback and output schema validation.

---

## Commands

```bash
cd app
npm ci               # deterministic install from committed lockfile
npm run dev          # starts Node API on :4173 and Vite on http://127.0.0.1:5173
npm test             # 24 unit, ranking, fallback, and HTTP API tests
npm run build        # writes production bundle to app/dist/
npm run test:e2e     # Playwright headless Chrome E2E across 9 widths + visual QA
npm start            # serves built UI and API on http://localhost:4173
```

---

## Verification Gates (Executed 2026-11-19)

- [x] `npm ci` and `npm run build` complete cleanly with zero errors.
- [x] `npm test` passes (`24/24` tests covering model ranking, all 24 fallback/error/quota/abort scenarios, settings migration, and HTTP API contracts).
- [x] `npm run test:e2e` passes (`36` viewport/tab assertions across `320, 375, 390, 430, 768, 1024, 1440, 1650, 1920` px, zero horizontal overflow, zero console/page errors, both Vite dev and production built server verified).
- [x] Theme persistence across reload + programmatic WCAG AA contrast checks verified in Dark & Light modes.
- [x] BEFORE vs AFTER desktop & mobile screenshots captured and visually inspected (`docs/executions/OOS-UI-02-2026-11-19/screenshots/`).
- [x] Empty API key preserves existing key; full API key asserted absent from DOM, responses, streams, and logs.
- [x] `engine/` TypeScript check (`npx tsc --noEmit`) passes; `git diff engine/ pipeline/` is empty.
