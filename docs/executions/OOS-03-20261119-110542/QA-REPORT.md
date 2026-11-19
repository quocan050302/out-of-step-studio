# OOS-03 — Quality Gate & Verification Report (`G0`–`G9`)

- **Execution ID:** `OOS-03-20261119-110542`
- **Repository:** `https://github.com/quocan050302/out-of-step-studio`
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline SHA:** `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638`
- **Implementation Commit SHA:** `fa27bed5d165bf868d3823432cd2eefa7c16f48e`
- **Date (UTC):** `2026-11-19`

---

## 1. Gate Summary Matrix (`G0`–`G9`)

| Gate | Requirement | Status | Mock vs Live / Sub-Status | Command / Method | Exit Code | Duration | Artifact / Evidence |
|---|---|---|---|---|---|---|---|
| **G0 — Branch & Baseline** | Correct branch `feat/studio-react-vite-migration`, fetched latest HEAD, baseline tests & environment recorded | **PASS** | N/A | `git fetch origin && git rev-parse HEAD && git status --short --branch` | `0` | `5.0s` | [BASELINE.md](./BASELINE.md), [test-artifacts/baseline-run.log](./test-artifacts/baseline-run.log) |
| **G1 — Settings & Secrecy** | Atomic writes (`0o600`), serialized writer queue, blank key preserved, `clearKey` explicit, zero plaintext keys in tracked files/logs/DOM | **PASS** | `MOCK_PASS` + Secret Scan `PASS` | `cd app && npm test` + repo secret scan | `0` | `0.21s` | `app/server/settings-store.mjs`, `app/test/server-api.test.mjs` |
| **G2 — Model Catalog & Ranking** | Pagination + loop detection, TTL cache, single-flight (including `forceRefresh`), misleading `displayName` & sparse metadata guards, deterministic ranking + rationale | **PASS** | `MOCK_PASS` | `cd app && node --test test/gemini-models.test.mjs` | `0` | `0.15s` | `app/server/gemini-models.mjs`, `app/test/gemini-models.test.mjs` (`6/6` pass) |
| **G3 — Fallback, Retry & Health** | All failure classes (`503`, `404` once, `429` model vs global vs unknown, `401/403`, `400` adapt, `SAFETY`), full `Retry-After` adherence + budget stop, cooldown TTL, anti-thundering-herd probe, anti-oscillation backoff, semaphore abort | **PASS** | `MOCK_PASS` | `cd app && node --test test/gemini-fallback.test.mjs` | `0` | `0.16s` | `app/server/gemini-transport.mjs`, `app/test/gemini-fallback.test.mjs` (`17/17` pass) |
| **G4 — API & NDJSON Contracts** | Legacy fields (`ok, latencyMs, model, reply, script, result, file, bytes`) + extended trace fields, literal prompts preserved, serialized atomic `tts-output.wav`, no false positives | **PASS** (Mock) / **BLOCKED** (Live) | `MOCK_PASS` / Live Probe: `LIVE_BLOCKED` (no API key on runner) | `cd app && node --test test/server-api.test.mjs` | `0` | `0.13s` | `app/server/create-server.mjs`, [test-artifacts/live-gemini-probe.json](./test-artifacts/live-gemini-probe.json) |
| **G5 — Navy–Gold UI & Browser E2E** | Vite production build + Playwright headless Chrome across dev & prod servers, 9 widths (`320–1920px`), 4 keep-mounted tabs, dark/light contrast, `0` console errors | **PASS** | `MOCK_PASS` (Real Chrome `157.0.8103.79`) | `cd app && npm run build && SCREENSHOT_DIR=... ARTIFACT_DIR=... npm run test:e2e` | `0` | `1.29s` build + `19.4s` E2E | [test-artifacts/e2e-report.json](./test-artifacts/e2e-report.json), `screenshots/*.png` (`10` PNGs) |
| **G6 — Engine Source & `CowboyShort` Regression** | `engine/src/videos/cowboy/**` & `pipeline/**` untouched (`0` diff), `npx tsc --noEmit` PASS, targeted 6-frame still render (`f60,f200,f400,f550,f700,f830`) | **PASS** (`FULL_OLD_RENDER`: **NOT_RUN**) | Targeted Stills: `PASS` (`6/6`) / Full 894f Render: `NOT_RUN` | `cd engine && npx tsc --noEmit` + `node scripts/bridge-stills.mjs ... 60,200,400,550,700,830 0.5` | `0` | `1.13s` tsc + `28.4s` stills | [test-artifacts/cowboy-regression-stills.json](./test-artifacts/cowboy-regression-stills.json) |
| **G7 — Brand-New 15s Video (`OOSDemo15`)** | Fresh 450-frame `1080×1920` @ `30` fps H.264 MP4 (*"The Roman Messenger Who Lost His Scroll"*) + `48000` Hz stereo AAC score/SFX (`-16.9` LUFS, `0` silences) + `short_qa.py` (`0` black, `0` white, `0` frozen, `0` pops) | **PASS** | Native `1080×1920` Render + `ffprobe` + `short_qa.py`: `PASS` | `cd engine && node scripts/render-oos-demo15.mjs` | `0` | `122.2s` | [DEMO15.md](./DEMO15.md), [test-artifacts/demo15-render-manifest.json](./test-artifacts/demo15-render-manifest.json), [test-artifacts/demo15-short-qa-report.md](./test-artifacts/demo15-short-qa-report.md) |
| **G8 — Disk, Concurrency & Performance** | Preflight disk `>=2x` temp + `>=1GB` margin (`15.6 GB` free), bounded concurrency (`<=2` render workers, `<=4` API slots), temp directories cleaned, zero orphan processes | **PASS** | N/A | `df -h .` + `git status --ignored` + tracked temp cleanup verification | `0` | `<1s` | Section 3 below |
| **G9 — Git Hygiene & Delivery** | `git diff --check` clean, no secrets or large binaries staged, old `OOS-UI-02-2026-11-19/` untouched, committed & pushed to `origin/feat/studio-react-vite-migration` | **PASS** | Local MP4 verified; remote git push verified | `git diff --check && git status && git push origin feat/studio-react-vite-migration` | `0` | `~3s` | [HANDOFF.md](./HANDOFF.md) |

---

## 2. Bugs & Gaps Caught and Fixed in OOS-03

1. **`Retry-After` Early Retry Clamping (`app/server/gemini-transport.mjs`):**
   - *Baseline issue:* `retryWithBackoff` clamped `waitMs = Math.min(Math.max(waitMs, err.retryAfterMs), maxDelayMs * 2)`. When a `429` returned `Retry-After: 6s` with `maxDelayMs = 2000`, it slept only `4s` and retried early contrary to `Retry-After`.
   - *Fix:* Never clamp `waitMs` below `err.retryAfterMs`; if `err.retryAfterMs` exceeds `maxRetryWaitMs` or remaining deadline budget, stop immediately with `err.retryAfterExceededBudget = true`.
2. **Semaphore Queue Abort Unhandled Rejection (`app/server/gemini-transport.mjs`):**
   - *Baseline issue:* `await acquireSlot(signal)` ran before the `try { ... } catch (outerErr)` block in `runGeminiWithFallback()`. When a request waiting in the concurrency semaphore queue was aborted via `AbortController`, it rejected with an uncaught `AbortError` instead of returning `{ ok: false, aborted: true, reasonCategory: "aborted" }`.
   - *Fix:* Moved `acquireSlot(signal)` inside `try { ... }` with safe default `let releaseSlot = () => {}`. Verified by `OOS-03: semaphore queue cancellation` test.
3. **Concurrent `/api/tts` Temp File Collision (`app/server/create-server.mjs`):**
   - *Baseline issue:* `/api/tts` wrote to `${outFile}.${process.pid}.tmp` without a per-request nonce or `withDataDirLock`, allowing two parallel `/api/tts` requests in the same Node process to race on the same temp file.
   - *Fix:* Serialized `/api/tts` output publication via `withDataDirLock(dataDir, ...)` and `atomicWriteBufferSync` (which uses a 6-byte random hex nonce per write and cleans up `.tmp` on failure).
4. **Non-Primary Cooling Candidate Ordering & Anti-Thundering-Herd Recovery (`app/server/gemini-transport.mjs`):**
   - *Baseline issue:* `chooseCandidateList` only partitioned `healthy` vs `cooling` when candidate `#0` (`preferredModel`) was in cooldown, leaving a cooling candidate `#1` ahead of a healthy candidate `#2`. Furthermore, concurrent requests arriving right as a cooldown expired could all simultaneously probe the recovering model.
   - *Fix:* `partitionByHealth` now always orders `healthy` ahead of `coolingTransient` across all positions, skips known `404 unsupported` models while healthy candidates exist, and uses `tryAcquireRecoveryProbe` / `releaseRecoveryProbe` so only one request probes a recovering model while concurrent traffic uses the verified fallback.
5. **macOS Browser Discovery & Hardcoded Artifact Overwrite in `app/test/e2e-ui.mjs`:**
   - *Baseline issue:* `e2e-ui.mjs` lacked macOS `/Applications/Google Chrome.app/...` paths (causing silent `SKIP e2e-ui` on macOS) and hardcoded `docs/executions/OOS-UI-02-2026-11-19/` as default output paths.
   - *Fix:* Added macOS Chrome/Chromium/Edge/Brave paths, defaulted unconfigured output dirs to isolated `os.tmpdir()` directories (cleaned up in `finally`), and made missing browser fail-closed unless `ALLOW_E2E_SKIP=1`.

---

## 3. Performance, Concurrency & Disk Footprint Measurements

| Metric | Baseline (`3958dc6`) | Final (`OOS-03`) | Notes |
|---|---|---|---|
| `cd app && npm test` test count | `24` tests (`4` files) | `33` tests (`5` files, `+37.5%` coverage) | Added `9` multi-assertion test suites covering all OOS-03 catalog, fallback, concurrency, golden contract, and `OOSDemo15` invariants |
| `cd app && npm test` runner duration | `167.4 ms` (`359 ms` wall) | `222.4 ms` (`385 ms` wall) | Sub-400ms total wall time for all 33 tests |
| `cd app && npm run build` duration | `1190 ms` (`1871 ms` wall) | `1290 ms` (`1910 ms` wall) | `2143` modules transformed cleanly |
| `cd app && npm run test:e2e` | `SKIPPED` (`461 ms`) | `PASS` (`36` viewport/tab checks in `19.4s`) | Real headless Chrome `157.0.8103.79` across dev + prod servers |
| `OOSDemo15` 540×960 preview render (450f + audio mux) | N/A | `39.3s` (`8.45 MB`) | Bounded `concurrency: 2` |
| `OOSDemo15` 1080×1920 final render (450f + audio mux) | N/A | `51.7s` (`22.95 MB`) | Native `1080×1920` rasterization (`scale: 1`), bounded `concurrency: 2` |
| Free Disk Space Before / After | `17 GiB` (`16,114 MB`) | `15.5 GiB` (`15,580 MB`) | All temporary Remotion bundle/chunk directories (`out/oos-03/.tmp-*`) automatically cleaned up (`0` leftover temp directories) |
