# OOS-UI-02 — QA & Acceptance Report

- **Date:** 2026-11-19
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline Commit:** `ec4de1340bfedefa9b4dd98b9f9d37a9315be9ce`

---

## 1. Acceptance Gate Matrix (D10 & Section E)

| Gate | Requirement | Status | Command / Method | Exit Code | Duration | Evidence |
|---|---|---|---|---|---|---|
| **G1 — Deterministic Install** | `npm ci` from committed `app/package-lock.json` | **PASS** | `cd app && npm ci --no-audit --no-fund` | `0` | `~6s` | `app/package-lock.json` |
| **G2 — Unit, Ranking & 24 Fallback Scenarios** | All D3 `#01`–`#24` scenarios + pure helper tests | **PASS** | `cd app && npm test` | `0` | `~0.21s` | `app/test/{studio,gemini-models,gemini-fallback,server-api}.test.mjs` (`24/24` pass) |
| **G3 — Production Build** | Vite client bundle builds cleanly into `app/dist/` | **PASS** | `cd app && npm run build` | `0` | `~1.9s` | `2143` modules transformed (`6.02 kB` gzip CSS, `89.29 kB` gzip JS) |
| **G4 — Browser E2E & Responsive Matrix** | Both dev Vite & prod `server.mjs`; 4 tabs keep-mounted state; theme reload; file validation; 9 widths (`320–1920px`); WCAG AA contrast; 0 console errors | **PASS** | `cd app && npm run test:e2e` | `0` | `~12s` | `test-artifacts/e2e-report.json` (`36` viewport/tab checks, `0` console errors) |
| **G5 — Visual Regression (BEFORE vs AFTER)** | Navy–Gold desktop (`1650px`) & mobile (`390px`, `320px`) screenshots captured & visually audited | **PASS** | Playwright headless Chrome + visual inspection | `0` | `~8s` | `screenshots/before/*` (8 PNGs) & `screenshots/after/*` (10 PNGs) |
| **G6 — Controlled Live Gemini Probe (`D9`)** | Real `GET /v1beta/models` + bounded `POST /api/test-connection` against live Google API | **PASS** | Isolated temp `dataDir` probe (`maxCandidates: 3`) | `0` | `2.90s` | `test-artifacts/live-gemini-probe.json`: discovered `65` models; `gemini-2.5-pro` (`404`) -> `gemini-3.8-flash` (`503`) -> `gemini-3.5-flash-lite` (`200 OK`, reply `"OK"`, `downgraded: true`) |
| **G7 — Engine & Pipeline Invariant (`D6`)** | `engine/` & `pipeline/` untouched; TypeScript check passes | **PASS** | `cd engine && npx tsc --noEmit` + `git diff engine/ pipeline/` | `0` | `~3.8s` | `0` files modified in `engine/` or `pipeline/` |
| **G8 —Engine Full Video Render Parity** | Full 894-frame video re-render / audio re-mix | **NOT RUN** | Intentionally skipped per D6 & D7 (`engine/` and `pipeline/` have `0` code diffs) | N/A | N/A | `git diff --stat engine pipeline` empty |
| **G9 — Secret & Hygiene Audit** | Zero real API keys in code, screenshots, fixtures, or git | **PASS** | Synthetic fixtures in all screenshots/tests + secret grep scan | `0` | `<1s` | `test-artifacts/manifest.json` |

---

## 2. Defects Caught & Fixed During QA

1. **Legacy `1.x` Model Ranking Edge Case (`gemini-models.mjs`):**
   - *Symptom:* Unit test `D3 #04` caught legacy `gemini-1.0-pro` ranking ahead of modern `gemini-3.8-flash` under `Pro > Flash` comparator.
   - *Fix:* Added generation-era comparator (`familyVersion >= 2.0` and rolling `-latest` outrank legacy `1.x` models). Re-tested: `24/24` pass.
2. **React 19 Async Event Reset (`SettingsPage.jsx`):**
   - *Symptom:* Playwright E2E caught `event.currentTarget.reset()` throwing after `await onSave(...)` because `settingsEpoch` remounted the form.
   - *Fix:* Captured `const formEl = event.currentTarget` synchronously before `await` and checked `formEl?.isConnected`, plus added `useEffect` state sync when `providers.gemini` loads asynchronously.
3. **Desktop `.mobile-only` Specificity & Favicon 404 (`layout.css`, `index.html`):**
   - *Symptom:* Visual inspection of initial `after` screenshots caught `.icon-btn` overriding `.mobile-only` on desktop, and E2E console error monitor caught missing `/favicon.ico` 404.
   - *Fix:* Enforced `.mobile-only { display: none !important }` above `768px`, moved `MobileBottomNav` to sticky flow end inside `.app-shell-body`, and added inline Navy–Gold SVG favicon in `app/index.html`. Re-verified visually: `0` console errors and crisp desktop/mobile screenshots.
4. **Multi-Version Tier Crowding on Live 65-Model Catalog (`gemini-transport.mjs`):**
   - *Symptom:* Live probe against Google's 65-model catalog showed `gemini-3.8-flash`, `gemini-3.7-flash`, and `gemini-3.6-flash` simultaneously experiencing `503` high demand, consuming candidate slots before `flash-lite` was reached.
   - *Fix:* Added tier-head diversification in `chooseCandidateList` (`Pro #1 -> Flash #1 -> Flash-Lite #1 -> remaining ranked`), enabling live fallback to succeed on `gemini-3.5-flash-lite` in `2.9s`.

---

## 3. Before vs After Layout Metrics (`1650×960` Desktop)

- **BEFORE (`ec4de13`):** `.main` capped at `980px`, Settings cards capped at `640px` (`~39%` horizontal utilization on `1650px` monitor; `>60%` empty space on right), raw single-line red `503` error, stacked mobile sidebar.
- **AFTER (`OOS-UI-02`):** `.main` expands to `1394px` (`max-width: 1440px`), 2-panel Settings Control Center + 3-column secondary provider row, 2-column Script & Still Check workspaces, 5-stage Dashboard pipeline stepper, Dark contrast `16.4:1` body / `10.8:1` primary CTA, Light contrast `15.2:1` body / `5.05:1` primary CTA.
