# OOS-UI-02 — Execution Record: Navy–Gold Studio Redesign & Gemini Auto Model Discovery/Fallback

- **Execution ID:** `OOS-UI-02-2026-11-19`
- **Repository:** `https://github.com/quocan050302/out-of-step-studio`
- **Branch:** `feat/studio-react-vite-migration`
- **Baseline Commit:** `ec4de1340bfedefa9b4dd98b9f9d37a9315be9ce`

---

## 1. Summary of Changes

1. **Navy–Gold Responsive Studio Redesign (`app/src/`):**
   - Replaced the monolithic `app/src/App.jsx` and cramped `max-width: 980px` / `640px` single-column stylesheet with a tokenized Navy–Gold design system (`#081321` canvas, `#101D30` sidebar, `#13233A` surface, `#182A43` raised cards, `#E9B75D` gold primary accents) plus a balanced high-contrast Light theme.
   - Desktop workspace expands cleanly up to `1440px` (`>=1280px` active main width on `1650px` displays), featuring a collapsible sidebar rail, contextual topbar with active model & connection badges, a 5-stage Production Pipeline Stepper on Dashboard, 2-column Script & Still Check workspaces, and a 2-panel Google Gemini Control Center + 3-column unintegrated provider grid in Settings.
   - Mobile (`320px–768px`) converts the sidebar into an accessible slide-over drawer (`Escape` + backdrop close) paired with a sticky 4-tab bottom quick-navigation bar (`>=44px` touch targets, zero horizontal overflow).
   - Added real drag-and-drop + client-side `8.50 MB` file validation on Still Check (preventing base64 payloads from silently hitting the `12 MB` server body limit), real clipboard export (`Copy script`), elapsed timers + `Cancel` (`AbortController`), and structured fallback/error recovery banners.

2. **Server-Side Gemini Automatic Model Discovery, Deterministic Ranking & 503 Fallback (`app/server/`):**
   - `GET /v1beta/models` pagination (`nextPageToken`) with `x-goog-api-key` header only, SHA-256 key-fingerprint TTL cache, single-flight coalescing, and automatic cache invalidation when the saved API key changes.
   - Capability-specific classification & deterministic ranking (`text`, `vision`, `tts`), filtering out embeddings, live-only `bidiGenerateContent`, Nano Banana `-image`, `lyria-*`, `-transcribe`, specialized/deprecated `[Rerouted]` agents, and isolating `-tts` speech models exclusively to `POST /api/tts`.
   - Shared `runGeminiWithFallback` execution engine across `/api/test-connection`, `/api/script`, `/api/check-still`, and `/api/tts` with bounded exponential backoff + jitter, `Retry-After` / `RetryInfo` adherence, per-model cooldowns with automatic recovery back to the preferred model once cooldown expires, and real output validators.

3. **Zero Changes to Render & Audio Pipelines:**
   - `engine/` (Remotion + Three.js `CowboyShort`) and `pipeline/` (`make_mix.py`, `words.json`, `beats.txt`) remain 100% untouched.

---

## 2. Full Integration Map (`Old -> New -> Caller -> Tests`)

| Legacy Function / Component | New Module & Export | Primary Callers | Automated Test Coverage |
|---|---|---|---|
| `defaultSettings`, `loadSettings`, `saveSettings`, `maskKey`, `maskedSettings` (`app/server.mjs`) | `app/server/settings-store.mjs` (`defaultSettings`, `loadSettings`, `saveSettings`, `updateProviderSettings`, `maskKey`, `maskedSettings`, `redactSecrets`, `keyFingerprint`) | `app/server/create-server.mjs`, re-exported by `app/server.mjs` | `test/gemini-fallback.test.mjs` (D3 #22), `test/server-api.test.mjs` |
| *(New)* Model discovery & ranking | `app/server/gemini-models.mjs` (`normalizeModelId`, `classifyGeminiModel`, `rankGeminiModels`, `fetchGeminiModelCatalog`, `createModelCatalogService`) | `app/server/create-server.mjs`, `app/server/gemini-transport.mjs` | `test/gemini-models.test.mjs` (D3 #02, #03, #15, #19, #20, #23) |
| `geminiGenerate`, `geminiText`, `parseJsonLoose`, `wavWrapPcm16` (`app/server.mjs`) | `app/server/gemini-transport.mjs` (+ `classifyGeminiError`, `retryWithBackoff`, `ModelHealthRegistry`, `chooseCandidateList`, `createGeminiExecutionEngine`, `validateConnectionReply`, `validateScriptResponse`, `validateStillVerdict`, `validateTtsAudio`) | `app/server/create-server.mjs` (`/api/test-connection`, `/api/script`, `/api/check-still`, `/api/tts`) | `test/gemini-fallback.test.mjs` (D3 #01–#24), `test/server-api.test.mjs` |
| HTTP `server` routes & `serveStatic` (`app/server.mjs`) | `app/server/create-server.mjs` (`createStudioServer`) + CLI entrypoint `app/server.mjs` | `node app/server.mjs`, `app/dev.mjs`, test harnesses | `test/server-api.test.mjs`, `test/e2e-ui.mjs` |
| `api`, `readLastGeminiTest`, `connectionStatus`, `scriptWordCount` (`app/src/lib/studio.mjs`) | `app/src/lib/studio.mjs` (+ `streamTestConnection`, `validateImageFile`, `formatScriptForClipboard`, `formatBytes`, `formatRelativeTime`) | `useGeminiStudio.js`, `ScriptPage.jsx`, `StillCheckPage.jsx`, `SettingsPage.jsx` | `test/studio.test.mjs`, `test/e2e-ui.mjs` |
| Monolithic `Dashboard`, `ScriptPanel`, `StillPanel`, `ProviderCard`, `SettingsPanel`, `App` (`app/src/App.jsx`) | `components/{Sidebar,Topbar}.jsx`, `pages/{DashboardPage,ScriptPage,StillCheckPage,SettingsPage}.jsx`, `hooks/useGeminiStudio.js`, `App.jsx` | `app/src/main.jsx` | `test/e2e-ui.mjs` |

---

## 3. Deterministic Model Ranking Policy & Examples

Given any discovered `GET /v1beta/models` catalog (independent of API response order):

1. **Allowlist & Eligibility Filter:**
   - Strip single `models/` prefix and validate `/^[a-z0-9][a-z0-9._-]{0,127}$/i`.
   - Require `supportedGenerationMethods` (or `supportedActions`) to include `generateContent`.
   - Exclude deprecated/rerouted models, embeddings (`embedContent`), live-only (`bidiGenerateContent`), image-generation (`-image` / Nano Banana / `imagen`), music/video (`lyria` / `veo`), transcription-only (`-transcribe`), and specialized agents (`antigravity`, `deep-research`, `aqa`, `robotics`, `computer-use`, `customtools`, `decision`).
   - **Capability partitioning:**
     - `text`: canonical Gemini `pro` / `flash` / `flash-lite` text/multimodal models (excluding `-tts`).
     - `vision`: `text`-eligible multimodal Gemini models with image support (`>=32k` input context, excluding text-only `gemini-1.0-pro`).
     - `tts`: exclusively `-tts` / `AUDIO` speech synthesis models (never selects Pro text models).
2. **Comparator Order:**
   1. Generation era: modern Gemini (`2.0+` and rolling `-latest`) > legacy `1.x`.
   2. Policy tier priority:
      - `quality` (*Highest quality*, default): `Pro > Flash > Flash-Lite`
      - `balanced`: `Flash > Flash-Lite > Pro`
      - `fast`: `Flash-Lite > Flash > Pro`
   3. Stability: concrete versioned stable > rolling `-latest` stable alias > preview (preview included when `includePreview: true` or when zero stable models exist for that capability).
   4. Mainline Gemini > `gemini-omni-*` sub-variants.
   5. Descending `familyVersion` (e.g., `3.8 > 3.7 > 3.6 > 3.5 > 2.5`) and sub-revision (`-002 > -001`).
   6. Lexical `id` tie-breaker (`a.id.localeCompare(b.id)`).

**Example (`quality` policy, `includePreview: false` on live 65-model catalog):**
- `text` & `vision`: `gemini-2.5-pro` -> `gemini-3.8-flash` -> `gemini-3.7-flash` -> `gemini-3.6-flash` -> `gemini-3.5-flash` -> `gemini-2.5-flash` -> `gemini-3.5-flash-lite` ... (rolling `-latest` aliases deduplicated behind concrete versioned models during fallback traversal).
- `tts`: `gemini-3.8-flash-tts` -> `gemini-3.8-flash-lite-tts`.

---

## 4. Reproducing Verification

```bash
cd app
npm ci --no-audit --no-fund
npm test
npm run build
npm run test:e2e

cd ../engine
npx tsc --noEmit
```

Artifacts in this folder:
- [PLAN.md](./PLAN.md) — Source audit, call graph, API preservation matrix, resource budgets.
- [QA-REPORT.md](./QA-REPORT.md) — Gate-by-gate execution matrix, durations, BEFORE/AFTER visual audit, and live Gemini probe truth.
- `screenshots/before/` & `screenshots/after/` — Desktop (`1650px`) & Mobile (`390px`, `320px`) screenshots using synthetic fixtures only.
- `test-artifacts/` — `baseline-snapshot.json`, `e2e-report.json`, `live-gemini-probe.json` (secrets redacted), and `manifest.json`.
