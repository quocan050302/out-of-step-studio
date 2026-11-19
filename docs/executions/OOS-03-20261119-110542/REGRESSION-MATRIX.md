# OOS-03 — Regression & Backtest Matrix

- **Execution ID:** `OOS-03-20261119-110542`
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline SHA:** `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638`

---

## 1. Golden Contract Tests (Section 4A)

| Contract Area | Test File & Case | Assertion Verified | Result |
|---|---|---|---|
| Settings key masking & 4 providers | `server-api.test.mjs`, `gemini-fallback.test.mjs` (D3 #22) | `gemini`, `openai`, `anthropic`, `elevenlabs` present; `apiKey` masked as `••••••••` + last 5 chars; raw secret absent from JSON/NDJSON/DOM | **MOCK_PASS** |
| Blank `apiKey` preservation & explicit `clearKey: true` | `gemini-fallback.test.mjs` (D3 #22), `server-api.test.mjs` (OOS-03 golden contracts) | Blank/whitespace `apiKey` preserves prior saved key; `clearKey: true` clears `apiKey` to `""` and `hasKey: false` | **MOCK_PASS** |
| Concurrent settings saves & parallel TTS writes | `server-api.test.mjs` (OOS-03 golden contracts) | Parallel `POST /api/settings` and 4 concurrent `POST /api/tts` calls serialize cleanly via `withDataDirLock` + unique nonce `.tmp` files; zero leftover `.tmp` files, valid 44-byte RIFF WAV header | **MOCK_PASS** |
| Original literal prompts & token budgets | `server-api.test.mjs` (OOS-03 golden contracts) | `/api/test-connection` (`"Reply with exactly: OK"`, `maxOutputTokens: 512`), `/api/script` (30s/60s, 9/16 beats, ~3.5 words/sec, exact literal prompt, `maxOutputTokens: 4096`), `/api/check-still` (exact literal QA prompt, `maxOutputTokens: 2048`), `/api/tts` (`voiceName: "Kore"`, `responseModalities: ["AUDIO"]`, 24kHz mono PCM16 WAV -> `app/data/tts-output.wav`) | **MOCK_PASS** |
| Legacy + extended JSON fields | `server-api.test.mjs` | Preserves `ok`, `latencyMs`, `model`, `reply`, `script`, `result`, `file`, `bytes` alongside `traceId`, `preferredModel`, `effectiveModel`, `selectedModel`, `downgraded`, `reason`, `attemptedModels`, `health` | **MOCK_PASS** |
| Frontend theme, localStorage & keep-mounted tabs | `studio.test.mjs`, `e2e-ui.mjs` | `oos-theme` (`dark` default, persists `light` across reload), `oos-gemini-test` freshness window (`30 min`), 4 keep-mounted panels preserve unsaved topic & generated 5-beat script across tab navigation | **MOCK_PASS** |
| Original `CowboyShort` registration unchanged | `demo15.test.mjs`, `engine/src/Root.tsx` | `<Composition id="CowboyShort" component={BridgeShort} durationInFrames={BRIDGE_FRAMES} fps={30} width={1080} height={1920} />` preserved byte-for-byte (`894` frames) | **PASS** |

---

## 2. Model Discovery & Ranking Matrix (Section 4B — `app/test/gemini-models.test.mjs`)

| Scenario | Test Case | Expected Behavior | Result |
|---|---|---|---|
| Missing API key | `OOS-03 catalog matrix` (#1) | Throws `NO_API_KEY` with `0` network calls | **MOCK_PASS** |
| Multi-page pagination (`nextPageToken`) | `D3 #02 & #15` | Fetches all 3 pages (`x-goog-api-key` header only), aggregates 16 raw models | **MOCK_PASS** |
| Duplicate IDs & pagination token loop | `OOS-03 catalog matrix` (#2) | Deduplicates repeated model IDs across pages; breaks cycle when `nextPageToken` repeats (`loopDetected: true`) | **MOCK_PASS** |
| TTL cache, expiry & forced refresh | `D3 #19 & #20` | Serves cached catalog within TTL (`fromCache: true`), refetches after TTL expiry or `forceRefresh: true` | **MOCK_PASS** |
| Concurrent single-flight coalescing & caller abort isolation | `D3 #19 & #20`, `OOS-03 catalog matrix` (#6) | Coalesces concurrent `listGeminiModels` (both normal and `forceRefresh: true`) into `1` network call; an aborting caller rejects immediately with `AbortError` while other coalesced callers succeed | **MOCK_PASS** |
| Key change cache invalidation | `D3 #19 & #20`, `create-server.mjs` | Changing API key invalidates old key fingerprint cache and health state | **MOCK_PASS** |
| Capability filtering (`text`, `vision`, `tts`) | `D3 #02 & #15` | Excludes `embedContent`, `bidiGenerateContent` live-only, Nano Banana `-image`, `lyria`, deprecated `[Rerouted]` agents; isolates `-tts` exclusively to `tts`; excludes legacy text-only `gemini-1.0-pro` from `vision` | **MOCK_PASS** |
| Order-independent deterministic ranking & rationale | `D3 #03 & #23`, `OOS-03 catalog matrix` (#5) | Forward and reversed input catalogs produce identical ranking; attaches `rankSource: "tier_heuristic_candidate"` and `rankRationale` | **MOCK_PASS** |
| Misleading `displayName` & unknown/sparse metadata | `OOS-03 catalog matrix` (#3, #4) | Text model with `"TTS"` in `displayName` is NOT classified as TTS (`capabilityConfidence: "low"`); model missing `inputTokenLimit` and `supportedInputModalities` defaults conservatively to `vision: false`, `candidateOnly: true` | **MOCK_PASS** |

---

## 3. Error Classification, Retry, Fallback & Health Matrix (Section 4C — `app/test/gemini-fallback.test.mjs`)

| Scenario | Test Case | Expected Behavior | Result |
|---|---|---|---|
| `503 -> 200` & `503 -> 503 -> Flash-Lite 200` | `D3 #04`, `D3 #05` | Retries bounded times (`maxRetriesPerCandidate=2`) with exponential backoff + seeded jitter, then falls back down tier list and stops on first valid response | **MOCK_PASS** |
| `404` one-time rediscovery & known `404` skipping | `D3 #12`, `OOS-03 candidate health ordering` (#2) | Refreshes catalog once on `404`, marks model in `unsupported` cooldown (`300s`), and excludes known `404` model on subsequent calls while catalog is unchanged | **MOCK_PASS** |
| Non-primary cooling candidate ordering | `OOS-03 candidate health ordering` (#1) | When `#1` is healthy, `#2` is cooling down, and `#3` is healthy, `#3` is ordered ahead of cooling `#2` | **MOCK_PASS** |
| All candidates `503` fail & request budget cap | `D3 #13 & #14`, `OOS-03 semaphore/budget/deadline` | Enforces `maxTotalRequests` cap strictly; never reports false green when all fail | **MOCK_PASS** |
| `429` per-model `Retry-After` compliance & budget stop | `D3 #09`, `OOS-03 Retry-After` (#1, #2) | Honors full `Retry-After` delay (never clamps `6s` down to `4s`); if `Retry-After` (`45s`) exceeds budget, stops immediately (`retryAfterExceededBudget: true`) without retrying early | **MOCK_PASS** |
| `429` global quota STOP & `429` unknown-scope STOP | `D3 #10`, `OOS-03 Retry-After` (#3) | Project/daily quota and unknown-scope `429` set `fallbackEligible: false` (`1` call, zero model-hopping) | **MOCK_PASS** |
| `401` / `403` auth & permission STOP | `D3 #07 & #08` | Halts immediately (`1` call, zero retries, zero fallback) | **MOCK_PASS** |
| Content policy `SAFETY_BLOCKED` STOP | `OOS-03 safety block` (#1) | Halts immediately with `reasonCategory: "safety"` (`1` call, zero retries, zero fallback) | **MOCK_PASS** |
| `400` invalid request STOP vs one-time config adaptation | `D3 #11`, `OOS-03 safety block` (#2) | Corrupt payload stops after `1` call; `generationConfig` field error adapts once with `configAdapted: true` + `warning`, and records both attempts in `attemptedModels` even if adapted call fails | **MOCK_PASS** |
| Action output validators (`OK`, script beats, still verdict, TTS WAV) | `D3 #06`, `D3 #17 & #18`, `OOS-03 safety block` (#3, #4) | Rejects empty/wrong connection reply, empty beats, `estSec <= 0`, `totalWords <= 0`, invalid verdict, missing/silent/odd PCM audio; accepts `verdict: "FAIL"` as valid `ok: true` QA output | **MOCK_PASS** |
| Verified TTL expiry, auto-recovery, anti-thundering-herd & anti-oscillation | `D3 #24`, `OOS-03 candidate health ordering` (#3, #5) | Verified record expires after `verifiedTtlMs`; expired cooldown auto-upgrades back to preferred model; concurrent requests during recovery send only `1` probe to recovering Pro while routing concurrent traffic to healthy Flash; repeat failure increases cooldown duration (`1.5x`) | **MOCK_PASS** |
| Manual mode capability guard | `OOS-03 candidate health ordering` (#4) | Never uses a text model for `tts` or text-only `gemini-1.0-pro` for `vision` even if misconfigured in manual settings | **MOCK_PASS** |
| Abort during fetch/backoff & semaphore queue cancellation | `D3 #21`, `OOS-03 semaphore/budget/deadline` | `AbortController` cancels in-flight or semaphore-queued request cleanly (`aborted: true`) and releases semaphore slot for subsequent requests | **MOCK_PASS** |

---

## 4. Browser Visual E2E, Live Provider & Engine Regression (Section 4D, 4E, 4F)

| Suite | Scope | Status | Evidence |
|---|---|---|---|
| **HTTP & NDJSON Integration (`server-api.test.mjs`)** | Ephemeral server on random port + isolated `os.tmpdir()` `dataDir`; JSON & `application/x-ndjson` progress stream; secret redaction | **MOCK_PASS** | `app/test/server-api.test.mjs` (`2/2` suites pass) |
| **Visual E2E (`e2e-ui.mjs`)** | Headless Chrome across Vite dev server and production `server.mjs`; 4 tabs, dark/light theme reload, keyboard focus, file size guard, `320, 375, 390, 430, 768, 1024, 1440, 1650, 1920` px widths (`36` checks), `0` console/page errors | **MOCK_PASS** | [test-artifacts/e2e-report.json](./test-artifacts/e2e-report.json) + `10` PNG screenshots in `screenshots/` |
| **Live Gemini Provider Probe (Section 4E)** | Live Google Gemini API check | **LIVE_BLOCKED** | [test-artifacts/live-gemini-probe.json](./test-artifacts/live-gemini-probe.json) — No `app/data/settings.json` or `GEMINI_API_KEY` present on this machine; reported truthfully as `LIVE_BLOCKED` |
| **Old `CowboyShort` Source & Targeted Frame Regression (Section 4F)** | `git diff engine/src/videos/cowboy pipeline` (`0` changes), `npx tsc --noEmit`, and representative still renders `f60, f200, f400, f550, f700, f830` (`540×960`) | **PASS** | [test-artifacts/cowboy-regression-stills.json](./test-artifacts/cowboy-regression-stills.json) (`6/6` stills rendered cleanly, non-black luma `0.3854–0.5948`) |
| **Full 894-Frame `CowboyShort` Video Re-Render** | Full 894-frame 3D video render | **NOT_RUN** | `engine/src/videos/cowboy/**` and `pipeline/**` have `0` changed lines; targeted 6-frame WebGL renders verified; full 894-frame render marked `NOT_RUN` per Section 4F & 6 rules |
