# OOS-03 — Execution Record: Gemini Reliability Hardening, Regression/Backtest & Brand-New 15s Video (`OOSDemo15`)

- **Execution ID:** `OOS-03-20261119-110542`
- **Repository:** `https://github.com/quocan050302/out-of-step-studio`
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline Commit SHA:** `3958dc6ed94ee1e3ad71fab14c9f4606c1f8d638`
- **Execution Started (UTC):** `2026-11-19T11:05:42Z`

---

## 1. Execution Scope & Priorities

1. **P0 — Gemini Reliability Hardening (`app/server/`):**
   - Capability-accurate model classification (`text`, `vision`, `tts`) with explicit `candidateOnly: true` / `verificationState: "unverified_candidate"` metadata, confidence labels on ambiguous/misleading display names, and strict modality guards.
   - Single-flight catalog discovery (including concurrent `forceRefresh` coalescing and immediate caller-side `AbortSignal` rejection), pagination loop detection, and key-scoped TTL cache.
   - Deterministic model ranking with explicit `rankSource` and `rankRationale`, tier diversity, and exclusion of known `404 unsupported` models while catalog snapshot is unchanged.
   - Truthful error classification & retry engine: `Retry-After` never clamped below server-requested delay (if `Retry-After` exceeds retry/deadline budget, fail-closed rather than retrying early), conservative handling of unknown-scope `429` errors (never model-hop to bypass global/project quota), single-probe cooldown recovery to prevent thundering herd, exponential cooldown backoff on rapid repeat failures to prevent oscillation, TTL expiry on `verified` model state, and strict `attemptedModels` recording (including failed config-adapted attempts).
   - Hardened action validators (`validateConnectionReply`, `validateScriptResponse` with positive `estSec` and coherent `totalWords`, `validateStillVerdict`, `validateTtsAudio` rejecting zero/silent or malformed PCM buffers) and serialized atomic `tts-output.wav` publication.

2. **P0 — Navy–Gold React + Vite UI & CowboyShort Invariants (`app/src/`, `engine/`, `pipeline/`):**
   - Preserve the Navy–Gold UI design system, 4-tab keep-mounted workspace (`Dashboard`, `Script`, `Still Check`, `Settings`), localStorage keys (`oos-theme`, `oos-gemini-test`), and all legacy API response fields (`ok`, `latencyMs`, `model`, `reply`, `script`, `result`, `file`, `bytes`).
   - Fix macOS browser discovery and fail-closed enforcement in `app/test/e2e-ui.mjs`, and isolate default E2E output paths so `docs/executions/OOS-UI-02-2026-11-19/` is never overwritten.
   - Keep `CowboyShort` (`894` frames, `30` fps, `1080x1920`), `engine/src/videos/cowboy/**`, and `pipeline/**` 100% untouched; only add `OOSDemo15` registration in `engine/src/Root.tsx` alongside dedicated demo files under `engine/src/videos/demo15/` and `engine/scripts/`.

3. **P0 — Brand-New 15-Second Animated Short (`OOSDemo15` — *"The Roman Messenger Who Lost His Scroll"*):**
   - Code-rendered 9:16 vertical short (`1080x1920`, `30` fps, `450` frames = `15.000s`) with original synthesized score + Foley SFX (`48 kHz` stereo WAV mixed into AAC audio track) and timed on-screen storytelling cards/captions.
   - Tangible outputs in `out/oos-03/demo15/`: `final_15s_1080x1920.mp4`, `preview_15s_540x960.mp4`, `shot-plan.json`, representative stills, and `short_qa.py` frame-by-frame QA report & contact sheets.

---

## 2. Documents in This Execution Folder

- [BASELINE.md](./BASELINE.md) — Environment snapshot, baseline command outputs, and full 8-table function/caller/state/contract inventory.
- [PLAN.md](./PLAN.md) — Detailed technical plan for Phase 1–5 changes, concurrency/disk budgets, and verification strategy.
- [REGRESSION-MATRIX.md](./REGRESSION-MATRIX.md) — Complete unit, catalog, fallback, HTTP/NDJSON, UI E2E, live-provider, and engine regression matrix.
- [DEMO15.md](./DEMO15.md) — Storyboard, animation architecture, audio synthesis, render commands, `ffprobe` & `short_qa.py` proof, and SHA-256 checksums for *"The Roman Messenger Who Lost His Scroll"*.
- [QA-REPORT.md](./QA-REPORT.md) — Gate-by-gate (`G0`–`G9`) PASS / FAIL / BLOCKED / NOT_RUN evidence report.
- [HANDOFF.md](./HANDOFF.md) — Concise Vietnamese final engineering handoff.
