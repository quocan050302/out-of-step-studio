## React + Vite Studio (Navy–Gold UI + Gemini Auto Model Discovery & Fallback)

The web Studio is authored in **React + Vite** (`app/src/`) with a modular Node backend (`app/server.mjs` + `app/server/`). It automatically discovers accessible Gemini models via `GET /v1beta/models`, ranks eligible candidates by capability (`text`, `vision`, `tts`), and performs bounded exponential-backoff retries + graceful fallback on `503 UNAVAILABLE` overload — while keeping the Remotion video engine (`engine/`) and Python audio pipeline (`pipeline/`) completely untouched.

```bash
cd app
npm ci               # deterministic install from committed package-lock.json
npm run dev          # http://127.0.0.1:5173 (Vite UI) + API on http://localhost:4173
npm test             # unit + model ranking + 24 fallback scenarios + HTTP API tests
npm run build        # production Vite bundle -> app/dist/
npm run test:e2e     # headless Chromium E2E + responsive/contrast visual checks
npm start            # production UI + API on http://localhost:4173
```

Node.js 20.19+ required. Do not place API keys in `VITE_*` variables; save them through **Settings**. Keys remain masked in all API responses and are persisted exclusively in gitignored `app/data/settings.json`.

Migration & verification details: [app/MIGRATION-REACT-VITE.md](app/MIGRATION-REACT-VITE.md), [app/VERIFY.md](app/VERIFY.md), and [docs/executions/OOS-UI-02-2026-11-19/README.md](docs/executions/OOS-UI-02-2026-11-19/README.md).

---

# Out of Step — Cowboy Cartoon Short Studio

**Out of Step** is a 30-second vertical (9:16) cartoon story short — twelve cowboys nearly
bounce a river bridge into the water just by walking in perfect time (a retelling of the real
1831 Broughton bridge break-step lesson) — plus **Studio**, a small web app that wraps the
production pipeline.

## Architecture: AI writes and checks, code renders

| Step | How | Where |
|---|---|---|
| Script | **AI — Google Gemini** writes timed narration beats from a topic | Studio app (`/api/script`) |
| Voice / TTS | **AI — Google Gemini** TTS (experimental) | Studio app (`/api/tts`) |
| Still check | **AI — Google Gemini vision** returns PASS/FAIL + issues for a rendered frame | Studio app (`/api/check-still`) |
| Render | **Pure code — no AI.** three.js inside Remotion; characters are 2D canvas-drawn "bean heads" in a 3D world; music/SFX synthesized in Python | `engine/` |
| Mix | Python (numpy) voice + score + SFX mix | `pipeline/make_mix.py` |

Every pixel of the film is drawn by code. Gemini is used only where a human used to sit:
writing the script, voicing it, and eyeballing frames for QA.

## Legacy Studio server (no frontend build)

```bash
node app/server.mjs          # Node API, serves Vite build if available
# open http://localhost:4173  (PORT env var overrides 4173)
```

1. Go to **Settings**, paste your Google AI Studio API key, Save, then **Test connection**.
2. **Script** — enter a topic, pick 30s/60s, Generate. (Gemini can take 1–3 minutes to answer.)
3. **Still Check** — upload a rendered frame plus a shot note, get a verdict.
4. Settings for OpenAI / Anthropic / ElevenLabs keys exist but are **not integrated yet**.

Keys are stored only in `app/data/settings.json` on your machine. That file is gitignored
and is **never** committed to this repository; the API returns keys masked.

## Render the film

```bash
cd engine
npm ci
npx remotion studio src/index.ts     # browse the CowboyShort composition (1080×1920, 30 fps, 894 frames)
node scripts/bridge-stills.mjs       # QA stills
./render-preview.sh                  # chunked preview render (see render-*.sh)
python3 scripts/short_qa.py          # black/frozen-frame + loudness QA
```

Media in `engine/public/` (voice WAV, generated props) is produced locally and gitignored —
see `engine/public/README.md`. The final mix pipeline lives in `pipeline/`
(`make_mix.py`, with `words.json` beat timings and `beats.txt`).

## Production docs

- `SCRIPT.md` — the film's script, facts and shot plan.
- `PRODUCTION-PROGRESS.md` — the step-by-step production log, including measured render
  rates and the environment workarounds found on the build machine.

## Attribution & license

The render engine in `engine/` is derived from the templates of
[**claude-animated-shorts**](https://github.com/mromidev/claude-animated-shorts) by mromidev
(the `cartoon-3d-short` skill), adapted for this cowboy production: cowboy hats and western
outfits in `toon.ts`/`cast.ts`, a 24-cowboy column, bounce-only bridge physics, a hat-fly gag,
and a park-swing + out-of-step stroll shot set.

The upstream project is MIT-licensed — see `UPSTREAM-LICENSE` (Copyright (c) 2026 Mr omi).
Original material in this repo (the Studio app, the Out of Step script and production docs)
is likewise released under the MIT License.
