# Out of Step Studio — build progress (the Studio app + repo assembly)

Started 2026-11-19 ~15:08 +07. (The film's own production log is PRODUCTION-PROGRESS.md.)

- [x] Sources surveyed: cartoon-cowboy-trial (project/, audio/make_mix.py, voice/words.json + beats.txt — no voice.txt exists), upstream claude-animated-shorts.
- [x] Upstream LICENSE = MIT (Copyright 2026 Mr omi) → repo PUBLIC; UPSTREAM-LICENSE copied + attribution in README.
- [x] Gemini ListModels → HTTP 200 in 0.9s; 65 models, 50 generateContent-capable. Defaults: text/vision = gemini-3.8-flash; TTS = gemini-3.8-flash-tts (dedicated TTS model in list).
- [x] App backend (app/server.mjs, zero deps, port 4173)
- [x] App frontend (dark default + toggle, sidebar: Dashboard/Script/Still Check/Settings)
- [x] Verify endpoints — ALL PASS (details in app/VERIFY.md): settings mask, test-connection ok (270s, reply "OK"), script ok on retry after a real Gemini 503 (9 beats, "The Frontier Skillet"), check-still ok (verdict FAIL + real issue), tts ok (real 24kHz WAV, 3.6s). Server stopped after verification.
- [x] Repo assembly (engine/ 39 files, pipeline/ 3 files, SCRIPT.md, PRODUCTION-PROGRESS.md, UPSTREAM-LICENSE)
- [x] Secrecy grep (zero matches for the key prefix outside app/data/settings.json; settings.json excluded from push — verified 2026-11-19)
- [!] GitHub: get_me PASS (quocan050302). create_repository BLOCKED: "403 Resource not accessible by integration" — the Muse GitHub App is not installed on the account; repo does not already exist (search total_count 0). Install URL: https://github.com/apps/meta-muse-ai/installations/new — push (55 files, 3 commits planned) resumes as soon as the app is installed.
- [x] GitHub push COMPLETE 2026-11-19 ~15:31 +07: user created the empty public repo manually (integration tokens cannot create repos on personal accounts), app access granted, 3 push-files commits landed on main: f1fc4b77 (app, 5 files), 36bee591 (engine, 42 files), cae26243 (pipeline + docs, 9 files). Verified via API: commits listed, README.md content read back, app/data/settings.json confirmed ABSENT from the repo.
