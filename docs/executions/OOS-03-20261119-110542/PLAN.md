# OOS-03 — Technical Execution Plan

- **Execution ID:** `OOS-03-20261119-110542`
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline SHA:** `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638`

---

## Phase 1: Gemini Reliability Hardening (`app/server/`) & Unit/Mock Matrix (`app/test/`)

### 1.1 `app/server/gemini-models.mjs`
- **`classifyGeminiModel(rawModel)`:**
  - Require `generateContent` in `supportedGenerationMethods` or `supportedActions`.
  - Guard against misleading `displayName`: a model is `isTts` only when `/-tts(?:-|$)/i.test(id)` (and `supportedOutputModalities` does not exclude `AUDIO`) OR `supportedOutputModalities` explicitly specifies `AUDIO` without `TEXT`. A non-`-tts` text model whose `displayName` mentions `"TTS"` is flagged with `capabilityConfidence: "low"` and not misrouted to `tts`.
  - Exclude models whose `supportedOutputModalities` lacks `TEXT` from `text` and `vision`.
  - Add `candidateOnly: true`, `verificationState: "unverified_candidate"`, and `capabilityConfidence` (`"high"` | `"medium"` | `"low"`) on every classified catalog item to reflect that `listModels` is a candidate catalog and runtime probe is required for verification.
- **`fetchGeminiModelCatalog(apiKey, options)`:**
  - Record `loopDetected` when a repeated `nextPageToken` is encountered and `paginationTruncated` when `MAX_DISCOVERY_PAGES` is reached with a remaining token.
- **`createModelCatalogService(options)`:**
  - Coalesce concurrent `forceRefresh: true` requests started while an in-flight refresh for the same `keyFingerprint` is already running, eliminating duplicate `GET /v1beta/models` network calls under concurrent refresh bursts.
  - Race caller `signal` against the shared in-flight promise so an individual caller that aborts rejects immediately with `AbortError` without cancelling the shared fetch for other active callers.
- **`rankGeminiModels(catalog, options)`:**
  - Attach `rankSource: "tier_heuristic_candidate"` and human-readable `rankRationale` to each ranked item.

### 1.2 `app/server/gemini-transport.mjs`
- **`inspectQuotaScope(json)` & `classifyGeminiError(err)`:**
  - Classify `429` into three scopes:
    - `"global"`: explicit daily/project/billing/account quota indicators or `retryAfterMs > 60_000` -> `category: "quota_global"`, `retryable: false`, `fallbackEligible: false`.
    - `"model"`: explicit per-model indicators (`PerModel`, `per-model`, `per model`, `RPM`, `TPM`, `model rate limit`, `quotaDimensions.model`) -> `category: "rate_limited_model"`, `retryable: true`, `fallbackEligible: true`, `maxRetries: 1`.
    - `"unknown"`: ambiguous 429 without per-model indicators -> conservative classification: if a short `Retry-After` (`<= 60_000 ms`) is provided, allow at most `1` same-model retry after honoring `Retry-After`, but set `fallbackEligible: false` so the engine never hops across models to bypass potentially global/project quota.
- **`retryWithBackoff(operation, options)`:**
  - Never clamp `waitMs` below `err.retryAfterMs`.
  - If `err.retryAfterMs` exceeds `maxRetryWaitMs` (default `Math.max(maxDelayMs * 4, 30_000)`) or exceeds remaining `deadlineAt - clock() - 50`, stop immediately (`err.retryAfterExceededBudget = true`) and throw rather than sleeping a shorter interval and retrying early contrary to `Retry-After`.
- **`ModelHealthRegistry`:**
  - Add `verifiedTtlMs` (default `30 * 60 * 1000`); expire stale verified records automatically in `getVerified()`.
  - Track consecutive cooldown count per `${keyFp}:${modelId}` to apply bounded exponential cooldown multiplier (`1x -> 1.5x -> 2x`, capped at `10 min`) when a model repeatedly fails immediately after recovery (anti-oscillation). Reset streak on verified success.
  - Track `recoveryProbes = new Set()` (`${keyFp}:${modelId}`) via `tryAcquireRecoveryProbe` / `releaseRecoveryProbe` so when a preferred model's cooldown expires under concurrent traffic, only one request probes the recovering model while concurrent requests use the healthy verified fallback (anti-thundering-herd).
  - Expose distinct `selectedModel`, `preferredModel`, `effectiveModel`, `activeModel`, and `verifiedModel` in `getSanitizedSummary()`.
- **`chooseCandidateList(options)`:**
  - Partition `healthy` vs `coolingTransient` vs `coolingUnsupported` across ALL candidate positions in both `auto` and `manual` modes so a cooling model is never placed ahead of a healthy model, and known `404 unsupported` models are skipped while the catalog is unchanged and healthy candidates exist.
  - Return `cooldownReason` from the preferred model's active cooldown when `cooldownPromoted` is true.
- **`createGeminiExecutionEngine(options).runGeminiWithFallback`:**
  - Default `maxCandidates = 3`, `maxTotalRequests = 6`, `maxRetriesPerCandidate = 2`, `overallDeadlineMs = 300_000`, `attemptTimeoutMs = 285_000`, `maxConcurrent = 4`.
  - Ensure config-adaptation attempts (on `400` generationConfig field errors) record both success and failure in `attemptedModels`, and surface `configAdapted: true` + `warning` when adaptation is used.
  - Release any acquired recovery probe lock and semaphore slot in `finally`.
- **Validators (`validateConnectionReply`, `validateScriptResponse`, `validateStillVerdict`, `validateTtsAudio`):**
  - `validateScriptResponse`: enforce `estSec > 0` (finite positive), validate `totalWords` is positive when present (or compute coherent word count), and check total estimated duration is positive and bounded (`<= 600s`).
  - `validateTtsAudio`: validate base64 format, even PCM16 byte length (`>= 48` bytes and `<= 14.4 MB`), and non-zero audio content (reject all-zero silent buffer).

### 1.3 `app/server/settings-store.mjs` & `app/server/create-server.mjs`
- Align `createStudioServer` defaults with `createGeminiExecutionEngine` (`maxCandidates = 3`, `maxTotalRequests = 6`).
- Serialize `POST /api/tts` file writes to `app/data/tts-output.wav` using `withDataDirLock(dataDir, ...)` and unique `${outFile}.${process.pid}.${nonce}.tmp` temp files so concurrent TTS requests never corrupt `tts-output.wav`.
- When `selectionMode`, `modelPolicy`, or `includePreview` changes in `POST /api/settings`, clear stale downgraded verified state if needed while keeping valid key state.

---

## Phase 2: HTTP Integration, Browser E2E & Live Provider Gate

- Update `app/test/e2e-ui.mjs`:
  - Add macOS Chrome/Chromium/Edge paths to `BROWSER_CANDIDATES`.
  - Default `SCREENSHOT_DIR` and `ARTIFACT_DIR` to `os.tmpdir()` (or `process.env.ARTIFACT_DIR` / `process.env.SCREENSHOT_DIR`) so running `npm run test:e2e` never overwrites `docs/executions/OOS-UI-02-2026-11-19/`.
  - Fail closed (`process.exit(1)`) if no browser binary is found unless `ALLOW_E2E_SKIP=1` is explicitly set.
- Run full Playwright E2E across all 9 mandatory widths (`320, 375, 390, 430, 768, 1024, 1440, 1650, 1920`) and save OOS-03 screenshots & `e2e-report.json` under `docs/executions/OOS-03-20261119-110542/`.
- Check live provider credentials (`app/data/settings.json` / env): since no API key exists on this machine, record `LIVE_BLOCKED` truthfully with diagnostic proof (never fabricate `LIVE_PASS`).

---

## Phase 3: Brand-New 15-Second Video (`OOSDemo15` — *"The Roman Messenger Who Lost His Scroll"*)

- **Additive Composition Registration (`engine/src/Root.tsx`):**
  - Keep `CowboyShort` untouched (`durationInFrames={BRIDGE_FRAMES}`, `fps={30}`, `width={1080}`, `height={1920}`).
  - Register `OOSDemo15` (`durationInFrames={450}`, `fps={30}`, `width={1080}`, `height={1920}`).
- **Modular Scene & Motion Architecture (`engine/src/videos/demo15/`):**
  - `story.ts`: Exact 5-shot storyboard (`0–59` HOOK, `60–149` CHASE, `150–269` ESCALATION, `270–389` PAYOFF, `390–449` CALLBACK), timed captions, camera keyframes, character/scroll trajectories, and exported `DEMO15_SHOT_PLAN`.
  - `motion.ts`: Pure deterministic frame-driven interpolation, spring physics, wind wave solver, limb walk/run cycle kinematics, cloth/cape flutter solver, and dust/leaf particle trajectories.
  - `art.tsx`: Rich hand-crafted editorial 2D/2.5D vector/SVG artwork — Roman street parallax layers (aqueduct arches, terracotta roofs, cypress trees, marble columns, fountain, wooden market cart), articulated messenger character (Marcus) with animated face/eyes/brows/mouth, flowing crimson cape, tunic, sandals, articulated arms/legs, dignified governor (Aurelius) in toga with animated reaction, and the wax-sealed papyrus scroll (both rolled and unrolled with readable `"WATCH OUT FOR WIND"` warning).
  - `Demo15.tsx`: Remotion composition combining the 5 animated shots, dynamic camera moves, lighting/shadow passes, timed narrative story cards, and synced `<Audio>` track.
- **Original Synthesized Score & Foley SFX (`engine/scripts/synth_demo15_audio.py`):**
  - Pure Python + NumPy synthesis at `48000 Hz` stereo (`15.000s`, `720,000` samples):
    - Mediterranean lyre/plucked harp + frame-drum comedy score.
    - Timed Foley SFX matched to exact storyboard frames: wind gust whooshes (`f0–55`, `f392–445`), rapid sandal footsteps (`f60–148`, `f155–210`), papyrus scroll flutter, fountain splash pass (`f95`), wooden cart wheel clunk & skid (`f165–225`), parchment unroll & brass comedic stinger (`f275–330`), and final cheeky gust callback (`f395–449`).
- **Portable Render & QA Verification (`engine/scripts/render-oos-demo15.mjs`):**
  - Auto-detects Chrome on macOS/Linux/Windows, sets isolated temp directory, renders diagnostic stills, renders `out/oos-03/demo15/preview_15s_540x960.mp4` (`scale: 0.5`), renders native `out/oos-03/demo15/final_15s_1080x1920.mp4` (`scale: 1`), runs `ffprobe` verification (`1080x1920`, `30/1` fps, `450` frames, `15.0s`, H.264 + AAC audio), and runs `engine/scripts/short_qa.py`.

---

## Phase 4 & 5: Old Render Regression, Performance/Resource Audit, Git Commit & Push

- Run targeted `CowboyShort` still renders (`f60, f200, f400, f550, f700, f830`) to verify the original 894-frame composition still bundles and renders cleanly without any changes to `engine/src/videos/cowboy/**` or `pipeline/**`.
- Await all tests, verify zero orphan processes or temp leaks, run secret scan, write `REGRESSION-MATRIX.md`, `DEMO15.md`, `QA-REPORT.md`, and `HANDOFF.md`, commit intended files only, and push to `origin/feat/studio-react-vite-migration`.
