# OOS-UI-02 — Execution Plan: Navy–Gold Studio Redesign + Gemini Auto Model Discovery & Fallback

- **Date:** 2026-11-19
- **Repository:** `https://github.com/quocan050302/out-of-step-studio`
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline Commit SHA:** `ec4de1340bfedefa9b4dd98b9f9d37a9315be9ce`

---

## 1. Source Audit Summary

### Existing Repository State (`ec4de13`)
- **`app/server.mjs` (358 lines, monolith):**
  - Serves `app/dist/` (or fallback `app/public/`) and handles `GET/POST /api/settings`, `POST /api/test-connection`, `POST /api/script`, `POST /api/check-still`, `POST /api/tts`.
  - Stores settings in gitignored `app/data/settings.json`; masks keys via `maskKey()`.
  - Hardcodes single-shot calls to `s.gemini.textModel || "gemini-3.8-flash"`, `visionModel`, and `ttsModel` (`gemini-3.8-flash-tts`) with zero model discovery, zero capability filtering, zero 503 retry/backoff, and zero fallback when high-tier models return `503 UNAVAILABLE`.
  - Non-atomic `fs.writeFileSync` on `settings.json`; server-side `POST /api/settings` previously accepted arbitrary string keys and only relied on frontend filtering to preserve blank `apiKey`.
- **`app/src/App.jsx` (373 lines, monolith) & `app/src/styles.css` (131 lines):**
  - Combines `Dashboard`, `ScriptPanel`, `StillPanel`, `ProviderCard`, `SettingsPanel`, and `App` in one file.
  - `.main` constrained to `max-width: 980px`, `.form` to `560px`, `.cards-single` to `640px` — leaving >50% empty dead space on 1440px–1920px desktop monitors.
  - Raw red error strings (`Gemini HTTP 503: ...`), hardcoded `"1–3 min"` copy, no drag-and-drop or client-side size validation on Still Check, no model discovery/ranking/health visibility, and stacked static sidebar on mobile.
- **`engine/` & `pipeline/`:**
  - Remotion + Three.js (`CowboyShort`, 894 frames) and Python audio mix (`pipeline/make_mix.py`). **Strict invariant:** untouched (`0` files modified).

### Empirical Discovery Verification (`GET /v1beta/models`)
Live schema inspection confirmed paginated responses (`nextPageToken`) returning 65 models with fields `name` (`models/...`), `version`, `displayName`, `description`, `inputTokenLimit`, `outputTokenLimit`, `thinking`, and `supportedGenerationMethods`. Crucially, specialized models (`*-image` / Nano Banana, `lyria-*`, `*-tts`, `*-transcribe`, `antigravity-*`, `deep-research-*`, `*-robotics-*`, `*-computer-use-*`, `gemma-*`) ALSO list `generateContent` in `supportedGenerationMethods`, proving why strict capability classification + deprecation filtering (`[Rerouted]` / `Deprecated`) is mandatory rather than naive `methods.includes("generateContent")`.

---

## 2. Concrete Module & Function Call Graph

### Backend (`app/server.mjs` + `app/server/*.mjs`)
1. **`app/server/settings-store.mjs`**
   - `defaultSettings()` — backward-compatible schema (`gemini`, `openai`, `anthropic`, `elevenlabs`) + `selectionMode` (`"auto"` | `"manual"`), `modelPolicy` (`"quality"` | `"balanced"` | `"fast"`), `includePreview` (`false` default).
   - `loadSettings(dataDir)` / `saveSettings(dataDir, settings)` / `updateProviderSettings(dataDir, provider, fields)` — strict field allowlist, preserves existing `apiKey` when blank string submitted, serialized write lock + atomic temp-file-and-rename persistence.
   - `loadRuntimeState(dataDir)` / `saveRuntimeState(dataDir, state)` — persists non-secret verified effective model timestamps and sanitized recent trails keyed by SHA-256 `keyFingerprint(apiKey)`.
   - `maskKey(key)` / `maskedSettings(settings, health)` — masks key (`••••••••` + last 5 chars), never leaks full key.
2. **`app/server/gemini-models.mjs`**
   - `normalizeModelId(rawName)` — strips leading `models/` once and validates `/^[a-z0-9][a-z0-9._-]{0,127}$/i`.
   - `classifyGeminiModel(rawModel)` — extracts capability eligibility (`text`, `vision`, `tts`), quality tier (`pro`, `flash`, `flash-lite`, `gemma`, `experimental`, `other`), numeric `familyVersion`, `isPreview`, `isRollingAlias`, `isDeprecated`, `costTier`, and `exclusionReason`.
   - `rankGeminiModels(catalog, { capability, policy, includePreview })` — deterministic, order-independent comparator (`Pro > Flash > Flash-Lite` for `quality`; `Flash > Flash-Lite > Pro` for `balanced`; `Flash-Lite > Flash > Pro` for `fast`; concrete versioned stable > rolling `-latest` alias > preview; descending `familyVersion`; lexical `id` tie-breaker).
   - `createModelCatalogService({ fetchImpl, baseUrl, cacheTtlMs })` -> `listGeminiModels(apiKey, { signal, forceRefresh })` — single-flight per `keyFingerprint`, handles `nextPageToken` pagination up to bounded max pages, `x-goog-api-key` header only, TTL cache + invalidation on key change.
3. **`app/server/gemini-transport.mjs`**
   - `geminiGenerate({ apiKey, model, parts, generationConfig, baseUrl, timeoutMs, signal, fetchImpl })` — unified transport returning structured data or throwing sanitized `GeminiTransportError` with parsed HTTP status, gRPC status, `Retry-After` / `RetryInfo` delay, and `QuotaFailure` details.
   - `geminiText(json)` / `parseJsonLoose(text)` / `wavWrapPcm16(pcm, sampleRate, channels)` — preserved and hardened with strict buffer/header checks.
   - `classifyGeminiError(err)` — classifies into `aborted`, `auth` (401 / invalid key), `permission` (403 / billing), `quota_global` (429 daily/project), `rate_limited_model` (429 short RPM/TPM), `overload` (503/529), `unsupported` (404), `invalid_request` (400), `safety`, `invalid_output`, `timeout`, `transient`.
   - `retryWithBackoff(fn, options)` — capped exponential backoff + injectable `rng` jitter + `Retry-After` adherence within overall deadline.
   - `ModelHealthRegistry` — tracks per-model cooldowns (`overload` / `rate_limited_model`), verified `effectiveModel` per capability, automatic promotion back to `preferredModel` once cooldown expires, and sanitized attempt trails.
   - `resolveGeminiModel(...)` & `runGeminiWithFallback(...)` — shared execution engine for `/api/test-connection`, `/api/script`, `/api/check-still`, and `/api/tts` with concurrency semaphore, 404 one-time rediscovery, generationConfig capability adaptation, and real output validators (`validateConnectionReply`, `validateScriptResponse`, `validateStillVerdict`, `validateTtsAudio`).
4. **`app/server/create-server.mjs` & `app/server.mjs`**
   - `createStudioServer(options)` — injectable `dataDir`, `fetchImpl`, `rng`, `clock`, timeouts/budgets for fast deterministic testing.
   - Preserves all existing endpoints (`GET/POST /api/settings`, `POST /api/test-connection` in both JSON and optional `Accept: application/x-ndjson` live progress stream modes, `POST /api/script`, `POST /api/check-still`, `POST /api/tts`) + adds `GET /api/gemini/status`, `GET /api/gemini/models`, `POST /api/gemini/discover`.

### Frontend (`app/src/`)
- `app/src/lib/studio.mjs` — `api()`, `streamNdjson()`, `readLastGeminiTest()`, `connectionStatus()` (with freshness awareness + 7 connection states), `scriptWordCount()`, `validateImageFile()`, `formatBytes()`, `formatRelativeTime()`.
- `app/src/hooks/useGeminiStudio.js` — centralized settings/discovery/status/test-connection state with `AbortController` cleanup.
- `app/src/components/Sidebar.jsx` & `app/src/components/Topbar.jsx` — collapsible desktop rail + accessible mobile drawer/bottom bar + connectivity/model summary topbar.
- `app/src/pages/DashboardPage.jsx`, `ScriptPage.jsx`, `StillCheckPage.jsx`, `SettingsPage.jsx` — modular pages kept mounted via `.panel-host` in `App.jsx` so unsaved form inputs and generated results survive tab navigation.
- `app/src/styles/tokens.css`, `layout.css`, `components.css` (imported by `app/src/styles.css`) — Navy–Gold design system (`#081321` / `#101D30` / `#13233A` / `#182A43` / `#E9B75D`) + balanced warm Light mode.

---

## 3. API Contract Preservation Matrix

| Endpoint | Legacy Request / Response Contract | Additive Enhancements (Backward Compatible) |
|---|---|---|
| `GET /api/settings` | `{ ok: true, providers: { gemini, openai, anthropic, elevenlabs } }` with masked `apiKey` & `hasKey` | Adds `selectionMode`, `modelPolicy`, `includePreview`, `health` summary under `providers.gemini` |
| `POST /api/settings` | `{ provider, fields }` -> `{ ok: true, providers }` | Atomic write, field allowlist, server-side blank `apiKey` preservation, key-change cache invalidation |
| `POST /api/test-connection` | `{ provider }` -> `{ ok, latencyMs, model, reply, error? }` | Discovers models, tests highest eligible via real `generateContent`, bounded 503 retry + fallback; adds `selectedModel`, `effectiveModel`, `preferredModel`, `downgraded`, `reason`, `warning`, `attemptedModels`, `traceId`; supports NDJSON streaming when requested |
| `POST /api/script` | `{ topic, durationSec }` -> `{ ok, model, script, error? }` | Uses TEXT resolver + fallback; validates `beats` schema; adds `actualModel`, `preferredModel`, `downgraded`, `reason`, `attemptedModels` |
| `POST /api/check-still` | `{ imageBase64, mimeType, shotNote }` -> `{ ok, model, result, error? }` | Uses VISION resolver + fallback; validates `PASS`/`FAIL` verdict + `issues`; adds `actualModel`, `preferredModel`, `downgraded`, `reason` |
| `POST /api/tts` | `{ text, voiceName }` -> `{ ok, model, file, bytes, error? }` | Uses TTS resolver + fallback (audio-capable models only); validates PCM16 + 44-byte WAV header; adds `actualModel`, `preferredModel`, `downgraded` |
| `GET /api/gemini/status` | *(New)* | Returns sanitized health, effective/preferred per capability, cooldowns, recent trails |
| `GET /api/gemini/models` | *(New)* | Returns sanitized discovered catalog + ranked lists per capability |
| `POST /api/gemini/discover` | *(New)* | Forces catalog refresh and returns updated ranked candidates |

---

## 4. Test Matrix, Fixtures & Resource/Disk Budgets

- **Disk Free Verified Before Execution:** `C:` `188.97 GB` free, `D:` `45.21 GB` free.
- **Disk & Temp Safety Budget:**
  - Zero `engine/` full video renders needed (`engine/` code untouched; verified via `npx tsc --noEmit` + `git diff engine/ pipeline/`).
  - Unit & integration tests use `os.tmpdir()` isolated directories (`oos-studio-test-*`) deleted in `after`/`finally` blocks.
  - Browser QA uses pre-installed system Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`) via `playwright-core` (zero 250 MB browser download).
  - Screenshot PNGs compressed/sized cleanly under `docs/executions/OOS-UI-02-2026-11-19/screenshots/` using synthetic fixtures ONLY (zero user `app/data/settings.json` access).
- **Automated Test Suites (`app/test/*.test.mjs`):**
  1. `studio.test.mjs` — frontend pure helpers, freshness/status pill states, word count fallback, file size/MIME validation.
  2. `gemini-models.test.mjs` — model ID allowlist/normalization, multi-page pagination, order-independent deterministic ranking (`quality`/`balanced`/`fast`), preview opt-in, exclusion of embeddings/Nano Banana image/Lyria/TTS/Live/deprecated models, cache TTL & key-change invalidation, single-flight discovery.
  3. `gemini-fallback.test.mjs` — covers all 24 mandatory scenarios (D3 #01–#24): no-key, Pro 503 -> Flash, Pro 503 -> Flash 503 -> Flash-Lite, HTTP 200 empty/non-OK rejection, 401/403 zero fallback, 429 model-level `Retry-After` vs 429 global quota stop, 400 invalid config adapter/no blind fallback, 404 one-time rediscovery, malformed JSON/timeout/network budget, all-fail reporting, independent text/vision/TTS selection, shared effective model across `/api/script` + `/api/check-still` + `/api/tts`, WAV PCM validation, parallel request single-flight/cooldown, `AbortController` cancel, blank key preservation + schema migration, manual selection cap, cooldown recovery auto-upgrade.
  4. `server-api.test.mjs` — end-to-end HTTP contract regression against ephemeral `createStudioServer` instances (JSON + NDJSON streaming + secret redaction assertions).
  5. `ui-e2e.mjs` (invoked by `npm run test:e2e` and included in QA verification) — Playwright headless Chrome across `320, 375, 390, 430, 768, 1024, 1440, 1650, 1920` widths, tab state persistence, theme reload persistence, drag/drop & oversized file rejection, live Test Connection fallback progress, WCAG contrast & zero horizontal overflow, zero console errors, plus BEFORE/AFTER visual evidence capture.
