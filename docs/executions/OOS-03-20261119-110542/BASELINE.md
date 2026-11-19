# OOS-03 — Baseline Audit & Function Contract Map

- **Captured At (UTC):** `2026-11-19T11:05:42Z`
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline HEAD SHA:** `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638`
- **Remote `origin/feat/studio-react-vite-migration` SHA:** `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638`
- **Working Tree Status at Start:** Clean (`0` modified, `0` untracked tracked-scope files)

---

## 1. Environment, Tooling & Resource Preflight

| Property | Measured Value | Notes |
|---|---|---|
| OS / Architecture | macOS (Apple clang 13.1.6, 8 CPU cores, 16 GB RAM / `17179869184` bytes) | Darwin |
| Node.js / npm | `v22.22.3` / `10.9.8` | Satisfies `>=20.19.0` |
| Python | `Python 3.13.0` (`numpy`, `PIL` installed) | Used by `short_qa.py` and audio synthesis |
| FFmpeg / FFprobe | `ffmpeg 6.0` / `ffprobe 4.4-tessus` | H.264, AAC, `ebur128`, `silencedetect` available |
| Local Browser Binaries | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (`157.0.8103.79`), `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` (`157.0.4341.60`) | Installed locally |
| Free Disk Space (`df -h .`) | `17 GiB` available on `/System/Volumes/Data` | Temp footprint for 450-frame render + QA sheets projected `< 250 MB` (`>60x` safety margin; `>1 GB` margin satisfied) |
| Gitignored Paths (`.gitignore`) | `node_modules/`, `remotion-tmp/`, `out/`, `app/data/`, `app/dist/`, `.env`, `*.wav`, `*.mp3`, `*.mp4` | `app/data/settings.json` absent at baseline (`hasKey: false`); `GEMINI_API_KEY` env unset |

---

## 2. Unmodified Baseline Command Execution Results

Full raw output saved in [test-artifacts/baseline-run.log](./test-artifacts/baseline-run.log).

| Step | Command | Exit Code | Duration | Baseline Observation |
|---|---|---|---|---|
| 1 | `cd app && npm ci --no-audit --no-fund` | `0` | `3073 ms` | `67` packages installed cleanly from `app/package-lock.json` |
| 2 | `cd app && npm test` | `0` | `359 ms` | `24/24` tests pass (`167.4 ms` test runner time) |
| 3 | `cd app && npm run build` | `0` | `1871 ms` | Vite `v7.3.8` built `app/dist/` (`2143` modules) |
| 4 | `cd app && npm run test:e2e` | `0` (SKIPPED!) | `461 ms` | **Defect found:** `app/test/e2e-ui.mjs` lacks macOS Chrome paths in `BROWSER_CANDIDATES` and exits `0` with `SKIP e2e-ui` instead of running or failing closed; also hardcodes `docs/executions/OOS-UI-02-2026-11-19/` as default artifact target |
| 5 | `cd engine && npm ci --no-audit --no-fund` | `0` | `4576 ms` | `271` packages installed cleanly from `engine/package-lock.json` |
| 6 | `cd engine && npx tsc --noEmit` | `0` | `1135 ms` | Zero TypeScript errors |

### Baseline Config Discrepancy Noted (Section 3 Check)
- In `app/server/gemini-transport.mjs`, `createGeminiExecutionEngine()` defaults to:
  `maxCandidates = 3`, `maxTotalRequests = 6`, `maxRetriesPerCandidate = 2`, `overallDeadlineMs = 300_000`, `attemptTimeoutMs = 285_000`, `maxConcurrent = 4`.
- In `app/server/create-server.mjs`, `createStudioServer()` defaulted to `maxCandidates = Number(process.env.GEMINI_MAX_CANDIDATES || 4)` and `maxTotalRequests = Number(process.env.GEMINI_MAX_REQUESTS || 8)`.
- **Resolution in OOS-03:** Align `createStudioServer()` defaults with `createGeminiExecutionEngine()` (`maxCandidates = 3`, `maxTotalRequests = 6`) unless explicitly overridden via options/env, and document both truthfully.

---

## 3. Source Call-Graph & Contract Tables (`Function -> Callers -> Input/Output -> Persisted state -> Original behavior -> Allowed change -> Test`)

### Table 3.1 — Settings & Persistence (`app/server/settings-store.mjs`)

| Function | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `defaultSettings()` | `coerceSettingsObject`, tests | `() -> SettingsObject` | None | Returns 4 providers (`gemini`, `openai`, `anthropic`, `elevenlabs`); `selectionMode: "auto"`, `modelPolicy: "quality"`, `includePreview: false`, `textModel/visionModel: "gemini-3.8-flash"`, `ttsModel: "gemini-3.8-flash-tts"` | Keep exact defaults unchanged | `gemini-fallback.test.mjs`, `server-api.test.mjs` |
| `keyFingerprint(apiKey)` | `updateProviderSettings`, `createModelCatalogService`, `ModelHealthRegistry`, `createStudioServer` | `(string) -> string` (16-hex SHA-256 prefix or `""`) | Saved as `keyFp` in `runtime-state.json` | Returns first 16 hex chars of SHA-256 of trimmed key | Keep unchanged | `gemini-models.test.mjs` |
| `maskKey(key)` / `maskedSettings(settings, geminiHealth)` | `createStudioServer` (`GET/POST /api/settings`) | `(settings, health) -> MaskedProviders` | None | Masks key as `••••••••` + last 5 chars, adds `hasKey`, `status: "not integrated yet"` for non-Gemini | Keep exact contract; never expose raw `apiKey` | `gemini-fallback.test.mjs`, `server-api.test.mjs` |
| `redactSecrets(input, extraSecrets)` | `fetchGeminiModelCatalog`, `geminiGenerate`, `runGeminiWithFallback`, `createStudioServer` | `(string, string[]) -> string` | None | Redacts explicit secret strings (`>=6` chars) and `AIza[0-9A-Za-z_-]{20,}` patterns | Also redact URL query `key=...` patterns if any appear in error strings | `server-api.test.mjs`, `gemini-models.test.mjs` |
| `loadSettings(dataDir)` / `saveSettings(dataDir, settings)` | `createStudioServer`, `updateProviderSettings` | `(dataDir, obj?) -> SettingsObject` | `app/data/settings.json` (mode `0o600`, atomic temp + rename) | Coerces fields, writes atomically via `.tmp` + `fs.renameSync` | Clean up orphan `.tmp` on write failure; support serialized lock | `gemini-fallback.test.mjs` |
| `updateProviderSettings(dataDir, provider, fields)` | `createStudioServer` (`POST /api/settings`) | `(dataDir, provider, fields) -> Promise<{settings, geminiKeyChanged, geminiConfigChanged, keyFp}>` | `app/data/settings.json` | Serializes updates per `dataDir` via `withDataDirLock`; blank `apiKey` preserves existing key; `clearKey: true` clears key; validates `selectionMode`, `modelPolicy`, model IDs | Also return `geminiConfigChanged` when `selectionMode`, `modelPolicy`, `includePreview`, or manual model IDs change so health registry can invalidate stale policy assumptions | `gemini-fallback.test.mjs`, `server-api.test.mjs` |
| `loadRuntimeState(dataDir)` / `saveRuntimeState(dataDir, state)` | `createStudioServer`, `ModelHealthRegistry` | `(dataDir, state?) -> RuntimeState` | `app/data/runtime-state.json` | Loads/saves `{ keyFp, verified, recentTrails }` | Serialize writes through `withDataDirLock`/atomic write and strip any accidental sensitive fields | `gemini-fallback.test.mjs` |

### Table 3.2 — Model Discovery (`app/server/gemini-models.mjs`)

| Function | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `normalizeModelId(rawName)` | `classifyGeminiModel`, `geminiGenerate` | `(string) -> string` (throws `INVALID_MODEL_ID`) | None | Strips leading `models/` once, validates `VALID_MODEL_ID_RE` | Keep strict single strip & regex validation | `gemini-models.test.mjs` |
| `classifyGeminiModel(rawModel)` | `fetchGeminiModelCatalog`, `rankGeminiModels`, `createStudioServer` | `(rawModel) -> ClassifiedModel \| null` | Cached in memory per `keyFp` | Classifies `text`, `vision`, `tts` capabilities, `tier`, `familyVersion`, `isPreview`, `exclusionReason` | Prevent misleading `displayName` from misclassifying non-TTS models as TTS or overriding explicit modalities; add `candidateOnly: true`, `verificationState: "unverified_candidate"`, `capabilityConfidence` | `gemini-models.test.mjs` |
| `fetchGeminiModelCatalog(apiKey, opts)` | `createModelCatalogService.listGeminiModels` | `(apiKey, opts) -> Promise<{models, pagesFetched, totalDiscovered, loopDetected, paginationTruncated}>` | None | Paginates `GET /v1beta/models` up to `MAX_DISCOVERY_PAGES=20` with `x-goog-api-key` header, deduplicates IDs, detects token loops | Expose `loopDetected` and `paginationTruncated` metadata; preserve error classification & secret redaction | `gemini-models.test.mjs` |
| `createModelCatalogService(opts)` | `createStudioServer`, tests | `(opts) -> {listGeminiModels, getCachedSnapshot, invalidate}` | In-memory `cacheByKey` & `inflightByKey` | Key-fingerprint TTL cache (`5 min`), single-flight for non-forced requests | Coalesce concurrent `forceRefresh` calls started in-flight; abort individual waiting caller immediately when its `signal` aborts without breaking other coalesced callers | `gemini-models.test.mjs` |

### Table 3.3 — Model Ranking (`app/server/gemini-models.mjs`)

| Function | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `rankGeminiModels(catalog, {capability, policy, includePreview})` | `chooseCandidateList`, `buildRankedMap` (`create-server.mjs`) | `(catalog, opts) -> RankedModel[]` | None | Filters by capability & preview opt-in (with emergency preview fallback if 0 stable exist); sorts by era (`>=2.0` > `1.x`), policy tier (`quality`/`balanced`/`fast`), stability (`concrete` > `-latest` > `preview`), mainline > omni, `familyVersion` desc, `revision` desc, lexical `id` | Add explicit `rankSource: "tier_heuristic_candidate"` and `rankRationale` explaining why the model ranked at `#k` and that tier rank is a candidate heuristic pending runtime probe | `gemini-models.test.mjs` |

### Table 3.4 — Execution & Error/Retry Engine (`app/server/gemini-transport.mjs`)

| Function | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `geminiGenerate(opts)` | `runGeminiWithFallback` | `(opts) -> Promise<{status, data, latencyMs}>` | None | POSTs `:generateContent` with `x-goog-api-key`, timeout + caller `AbortSignal`, parses JSON/errors, detects safety blocks | Cap error excerpts, preserve `quotaScope` (`global`, `model`, `unknown`) and `retryAfterMs` | `gemini-fallback.test.mjs` |
| `classifyGeminiError(err)` | `retryWithBackoff`, `runGeminiWithFallback`, `createStudioServer` | `(Error) -> ClassificationInfo` | None | Maps HTTP/gRPC/error codes to categories (`no_key`, `aborted`, `auth`, `permission`, `quota_global`, `rate_limited_model`, `overload`, `unsupported`, `safety`, `invalid_output`, `invalid_request`, `timeout`, `transient`, `fatal`) | Distinguish `429` `model` vs `global` vs `unknown` scope: unknown scope honours short `Retry-After` if present but sets `fallbackEligible: false` so fallback never attempts to bypass project/account quota | `gemini-fallback.test.mjs` |
| `retryWithBackoff(operation, opts)` | `runGeminiWithFallback` | `(fn, opts) -> Promise<T>` | None | Exponential backoff + jitter; clamped `Retry-After` to `maxDelayMs * 2` | **Fix:** Never clamp `waitMs` below `err.retryAfterMs`; if `err.retryAfterMs` exceeds `maxRetryWaitMs` or remaining deadline budget, stop immediately and throw with `retryAfterExceededBudget = true` | `gemini-fallback.test.mjs` |
| `chooseCandidateList(opts)` | `runGeminiWithFallback` | `(opts) -> {preferredModel, selectedModel, rankedAll, candidates, cooldownPromoted, cooldownReason}` | Reads `ModelHealthRegistry` | Manual mode pins configured model + same/lower tier fallbacks; auto mode deduplicates `-latest` behind concrete models and diversifies tier heads | Partition `healthy` before `coolingTransient` across ALL positions (both auto and manual); exclude known `404 unsupported` cooling models while healthy candidates exist; guard recovery probe with single-probe lock to prevent thundering herd | `gemini-fallback.test.mjs` |
| `createGeminiExecutionEngine(opts).runGeminiWithFallback` | `createStudioServer` (4 action routes) | `(opts) -> Promise<ExecutionOutcome>` | Updates `ModelHealthRegistry` | Enforces semaphore (`maxConcurrent=4`), `maxCandidates=3`, `maxTotalRequests=6`, `overallDeadlineMs=300_000`, 404 one-time rediscovery, 400 config adaptation | Record failed config-adapted attempts in `attemptedModels`; surface warning + `configAdapted: true` when adaptation succeeds; release recovery probe lock in `finally`; ensure `reason` reflects actual failed attempt or cooldown category | `gemini-fallback.test.mjs` |
| `validateConnectionReply` / `validateScriptResponse` / `validateStillVerdict` / `validateTtsAudio` | `createStudioServer` / `runGeminiWithFallback` | `(json) -> ValidatedPayload` (throws `INVALID_OUTPUT`) | None | Validates `"OK"`, JSON `beats`, `PASS`/`FAIL` verdict, base64 PCM -> WAV | Require `estSec > 0` and positive coherent `totalWords` in `validateScriptResponse`; reject empty/all-zero silent PCM or odd/oversized buffers in `validateTtsAudio` | `gemini-fallback.test.mjs` |

### Table 3.5 — Model Health Registry (`app/server/gemini-transport.mjs`)

| Function | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `ModelHealthRegistry` (`markCooldown`, `getCooldown`, `recordVerifiedSuccess`, `getVerified`, `tryAcquireRecoveryProbe`, `getSanitizedSummary`) | `createStudioServer`, `chooseCandidateList`, `runGeminiWithFallback` | Class methods | `app/data/runtime-state.json` | Tracks cooldowns (`${keyFp}:${modelId}`), verified models (`${keyFp}:${capability}`), and recent trails | Add `verifiedTtlMs` (default 30 min) so stale verified fallbacks expire; track consecutive failure count for exponential cooldown backoff (anti-oscillation); add `tryAcquireRecoveryProbe` / `releaseRecoveryProbe` (anti-thundering-herd); expose distinct `selectedModel`, `preferredModel`, `effectiveModel`, `activeModel`, `verifiedModel` | `gemini-fallback.test.mjs` |

### Table 3.6 — HTTP API Routes (`app/server/create-server.mjs`)

| Route | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `GET /api/settings` & `POST /api/settings` | `useGeminiStudio.js`, CLI/tests | JSON `{ ok, providers }` | `app/data/settings.json` | Loads/updates provider settings, masks keys, invalidates catalog/health on key change | Also clear stale policy verified cache when routing policy/mode changes | `server-api.test.mjs` |
| `GET /api/gemini/status`, `GET /api/gemini/models`, `POST /api/gemini/discover` | `useGeminiStudio.js`, tests | JSON `{ ok, models, ranked, health }` | In-memory catalog cache | Returns sanitized catalog, ranked models per capability, and health snapshot | Include `rankSource`, `rankRationale`, `candidateOnly`, and separate `selectedModel`/`preferredModel`/`effectiveModel`/`verifiedModel` in `health` | `server-api.test.mjs` |
| `POST /api/test-connection` | `streamTestConnection` (`studio.mjs`), tests | JSON or `application/x-ndjson` stream | `runtime-state.json` | Runs `"Reply with exactly: OK"` (`maxOutputTokens: 512`) through `runGeminiWithFallback` | Preserve all legacy + extended fields and NDJSON progress events | `server-api.test.mjs` |
| `POST /api/script` | `ScriptPage.jsx`, tests | `{ topic, durationSec: 30\|60 }` -> `{ ok, model, script, ... }` | `runtime-state.json` | Exact literal prompt (`~3.5 words/sec`, `9` or `16` beats, `maxOutputTokens: 4096`) | Preserve prompt verbatim; return `latencyMs`, `model`, `actualModel`, `preferredModel`, `downgraded`, `reason`, `warning`, `attemptedModels`, `script` | `server-api.test.mjs` |
| `POST /api/check-still` | `StillCheckPage.jsx`, tests | `{ imageBase64, mimeType, shotNote }` -> `{ ok, model, result, ... }` | `runtime-state.json` | Exact literal Vision QA prompt (`maxOutputTokens: 2048`), returns `PASS`/`FAIL` verdict as `ok: true` valid QA result | Preserve prompt verbatim and all response fields | `server-api.test.mjs` |
| `POST /api/tts` | CLI/API consumers, tests | `{ text, voiceName: "Kore" }` -> `{ ok, model, file: "app/data/tts-output.wav", bytes, ... }` | `app/data/tts-output.wav`, `runtime-state.json` | Calls TTS model with `AUDIO` modality, writes `tts-output.wav` | Serialize `tts-output.wav` publication with `withDataDirLock` + unique cryptographic nonce temp file so concurrent TTS requests never collide or corrupt the WAV file | `server-api.test.mjs`, `gemini-fallback.test.mjs` |

### Table 3.7 — Frontend UI (`app/src/**`)

| Module / Component | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `app/src/lib/studio.mjs` (`api`, `streamTestConnection`, `connectionStatus`, `validateImageFile`, `formatScriptForClipboard`) | `useGeminiStudio.js`, pages | Pure helpers & fetch/NDJSON stream | `localStorage["oos-gemini-test"]` | Parses JSON/NDJSON, computes 7 connection states with 30-min staleness window, validates `<8.5 MB` image uploads | Harden `streamTestConnection` reader cancellation on abort/unmount; keep all exports compatible | `studio.test.mjs`, `e2e-ui.mjs` |
| `app/src/App.jsx`, `useGeminiStudio.js`, `pages/{Dashboard,Script,StillCheck,Settings}Page.jsx` | `main.jsx` | React components | `localStorage["oos-theme"]`, `localStorage["oos-sidebar-collapsed"]`, `localStorage["oos-gemini-test"]` | Navy–Gold dark/light theme, 4 keep-mounted panels, model discovery & fallback progress trail | Keep visual design intact; ensure truthful display of `Preferred`, `Active / Effective`, and `Last Verified` states | `e2e-ui.mjs` |

### Table 3.8 — Video Render Engine & Audio Pipeline (`engine/**` & `pipeline/**`)

| File / Module | Callers | Input / Output | Persisted State | Original Behavior (`3958dc6`) | Allowed Change in OOS-03 | Verification Test |
|---|---|---|---|---|---|---|
| `engine/src/videos/cowboy/**`, `pipeline/**` | `engine/src/Root.tsx`, CLI | Remotion + Three.js `CowboyShort` (`894` frames, `30` fps, `1080x1920`) | None in git | Renders 29.8s cowboy suspension bridge short | **ZERO changes allowed** (`git diff engine/src/videos/cowboy pipeline` must be empty) | `npx tsc --noEmit`, git diff check, targeted frame render regression |
| `engine/src/Root.tsx` | `engine/src/index.ts` | Registers Remotion compositions | None | Registers `<Composition id="CowboyShort" ... />` | **Additive only:** register second `<Composition id="OOSDemo15" component={Demo15Short} durationInFrames={450} fps={30} width={1080} height={1920} />` | `npx tsc --noEmit`, `render-oos-demo15.mjs` |
| `engine/src/videos/demo15/{Demo15.tsx,story.ts,art.tsx,motion.ts}` *(New)* | `engine/src/Root.tsx` | Frame-deterministic 450-frame 9:16 cartoon short *"The Roman Messenger Who Lost His Scroll"* | None | N/A (new in OOS-03) | New modular composition + unit tests | `demo15.test.mjs`, `npx tsc --noEmit`, `short_qa.py` |
| `engine/scripts/render-oos-demo15.mjs` & `engine/scripts/synth_demo15_audio.py` *(New)* | CLI | Synthesizes 15.0s 48kHz stereo WAV score/SFX, renders stills, `540x960` preview MP4, and `1080x1920` final MP4 | `out/oos-03/demo15/*` (gitignored) | N/A (new in OOS-03) | New portable render + audio synthesis scripts | `short_qa.py`, `ffprobe` |
