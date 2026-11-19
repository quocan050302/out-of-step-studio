# Out of Step — PROGRESS

Pipeline: script (DONE) → voice → shot plan → stills → sound → render → QA

## Step 1 — Scaffold DONE
- project/ npm: remotion 4.0.545, @remotion/cli+bundler+renderer+three 4.0.545, three 0.187, react 19, @react-three/fiber 9, postprocessing 6.39, TS + @types. Install OK (~55 s).
- templates/bridge → src/videos/cowboy/, templates/scripts → scripts/, templates/audio → audio-src/
- src/index.ts + Root.tsx: composition id **CowboyShort**, 1080x1920, 30 fps, duration from story TOTAL.
- bridge-stills.mjs fixed for Linux: Windows browserExecutable REMOVED (Remotion Chromium headless shell), gl:"swangle", composition id CowboyShort.
- Kenney kit: NOT fetched. Attempts: kenney.nl 403, GitHub code search API rate-limited. world.ts tolerates missing GLBs (catch→filtered), build.ts code-draws vegetation. Proceeding without kit — trees/stalls/carts/windmill props will be absent; code-drawn world remains.

## Step 2 — Voice DONE
- Voice: Husky Campfire = avocado_v2:briggs, English, steady.
- Pass 1 at speed 100: raw total 39.552 s — outside 28–32 s. Adjusted ONCE: regenerated all 9 beats at speed 130 → raw 31.200 s.
- Per-beat trimmed (silence pad 0.06 s), concat gaps 0.14 s, head 0.25 s, tail 0.45 s → **voice/voice.wav 48 kHz mono, 29.772 s**.
- voice/words.json: beats with start/end + word timings interpolated within beat proportional to word length (trial method, documented in the file).
- Beat boundaries (s): 1:0.250–3.977, 2:4.117–7.622, 3:7.762–9.103, 4:9.243–11.365, 5:11.505–14.873, 6:15.013–18.448, 7:18.588–21.566, 8:21.706–25.318, 9:25.458–29.322.
- **Film TOTAL = 894 frames (29.8 s).**

## Step 3 — Shot plan / adaptation DONE (tsc PASS, zero errors)
Shots (frames @30fps):
- S1 0–119 hook: S1a wide 3/4 → S1b MS (keys 0/60)
- S2 119–341 setting+action1-2: front MS S5a/S5b re-based (119/230), townsfolk on
- S3 341–446 action3: S3a low front (341) → S3b boots CU (385)
- S4 446–647 snap+deadpan: side S4a (446) → S4b cut (540) + roll
- S5 647–760 explain: park swing S12a/S12b re-based (647/705), golden light
- S6 760–894 callback: tourists S15a/S15b re-based (760/800), townsfolk on
- story.ts: COUNT 74→24; amp() re-keyed (0 in S1–2, grows S3, max 0.5 S4); bridgeState drop=0/snap=0 always, zero bounce S5–6; SNAP/DROP0/DROP1=999/999/1000 (never); FLASH_AT=9999 (off); XFADE {5:8, 6:8}; KICKS=[[15.01,1.0]]; DOF re-based; FOREGROUND only park bush 647–760.
- cast.ts: exprMarch re-keyed ids 1–4 with film times; SWAPS re-keyed; Eli = i 0 with OFFICER outfit; tourists t0=25.3, all cowboy outfits, no shako/icecream props; CHEER re-keyed [3.9–5.5],[25.6–27.5]; PUSH0 48.79→21.9 (swing pushes in beat 8); park() staged on id 5; NEW hatFly: Eli's cowboy hat arcs to the river in S4 from 15.2 s and floats with a ripple ring.
- toon.ts: NEW "cowboy"/"cowboy_tall" hat in hatOn (wide brim, dented crown, red band for tall); soldier() = western jackets (4 browns/tans), dark pants, brown boots, hat cowboy, rifle false, red sash accent on v%4==2; OFFICER (Eli) = dark brown jacket, cowboy_tall, gold buttons, red sash, moustache, stout.
- world.ts: SUN_SHOT={5:{az:-30,el:18}} (park); creakFx added for S4 (14.4–17.5 s) at chain positions; sign stays hidden (id>=14 never).
- `npx tsc --noEmit` in cowboy folder: **PASS (no errors)**.

## Step 4 — Stills
- [ ] pending

## Step 5 — Sound
- [ ] pending

## Step 6 — Render + QA
- [ ] pending

## Step 4 — Stills (round 1) + fixes
- BLOCKER FOUND & FIXED (environment): @react-three/postprocessing <EffectComposer> renders BLANK on this VM (bisected: plain R3F OK; wrapper composer blank in all variants — tone-only, ink-only, MSAA 0, UnsignedByte). Remotion's own Chrome download also blocked; using local Playwright Chrome Headless Shell (~/.cache/ms-playwright/chromium_headless_shell-1255) via browserExecutable in bridge-stills.mjs, gl swangle + --enable-unsafe-swiftshader.
- FIX: Bridge.tsx now drives the SAME postprocessing passes manually (EffectComposer from `postprocessing`, RenderPass → InkPass → EffectPass(lens pre) → EffectPass(lens main) → EffectPass(bloom) → EffectPass(NEUTRAL tone) → EffectPass(grade), MSAA 4, useFrame priority 1). Verified rendering. tsc PASS after wrapping lens effects in their own EffectPasses.
- Stills round 1 (scale 0.5, frames 60/200/400/550/700/830):
  - S2 f200 PASS: big front-row faces, Eli (moustache, dark skin tone, front right), cowboy hats with red bands read clearly.
  - S3 f400 PARTIAL: read as front MS, not boots CU; nervous expressions OK.
  - S4 f550 PASS: side view over river, deck + water visible; rail crosses some faces (known weakness, inherited geometry).
  - S5 f700 PASS: swing kid with TWO ropes + plank + kid readable (readability trap avoided), parent pushing, golden light. Weakness: foreground bush blob large at bottom-right (~20% corner, out of focus — reads as framing bush).
  - S6 f830 PASS: out-of-step stroll on bridge, relaxed smiles, townsfolk on far bank.
  - S1 f60 FAIL (blocker): camera behind bridge tower — stone pillar fills frame, cowboys tiny at edge.
- FIX ROUND (one): march shots 1–4 tau = t + 5.65 (column starts just inside the north tower, reaches mid-span at snap); amp/stomp re-keyed to tau domain; S3b boots CU lowered/closer (y +0.28, dist 2.4 m); SFX boot times shifted to t frac .35/.85 to match marchPhase(tau). Re-rendering stills 60/400/500.

## Step 5 — Sound DONE
- audio/mix.wav: 48 kHz stereo, exactly 29.800 s (film length). NOT template mix.py — custom numpy synth (audio/make_mix.py):
  - Voice: voice.wav unchanged in content, loudnormed as part of final mix.
  - Music: original plucked-string arpeggio (D/G/A roots) + low thump/brush shuffle, gain 0.55 with voice-activity ducking envelope (floor 0.25).
  - SFX: boot taps every 0.5 s during march (t 0.35–21.35, amplitude grows 0.10→0.16), chain creak + sing at 15.01 s, splash at 17.2 s (hat landing), swing creaks at pushes 21.9/23.45/25.0 s.
  - Loudness: ffmpeg loudnorm to I=-14 → measured integrated **-14.4 LUFS** (ebur128), TP -1.5.
- FIX ROUND 2 (shot 4 only, climax): S4a/S4b z offsets F+7/F+5.5 (for 74 soldiers) → F+3.3/F+2.8 (mid-column for 24). g_500/g_600 PASS (column centred, shock + dazed/spiral expressions).
- FIX ROUND 3 (hat gag): hatFly used front(t) instead of front(tau) — z was ~9 m behind the column; trajectory also left the side camera's frame. Fixed tau, drift toward mid-column, peak 2.2 m, fixed landing spot, size 0.8 m. i_490 PASS: cowboy hat visibly tumbling off the deck toward the river (bottom-right), creak glyphs over the chain, shocked faces.
- STILLS VERDICT (final): S1 f_60 PASS, S2 s_200 PASS, S3 f_400 PASS (mid-glide MS; boots CU reached at glide end f415+), S4 g_500/g_600/i_490 PASS, S5 s_700 PASS (two ropes + plank + kid), S6 s_830 PASS. No black frames, no camera inside geometry (after S1 fix), no giant foreground blobs (park bush ~20% corner is the only large foreground, out-of-focus framing).
## Step 6 — Render + QA
- [ ] timing test 30 frames @2K, then full render decision
- RENDER RATE (scale 1.0, full post): sustained ~31 s/frame (frames 7→16 in 280 s) → 894 frames ≈ 7.7 h. 2K measured ~56 s/frame earlier (≈14 h) — 2K NOT RUN per brief's >4 h rule. Testing the template's own dpr override (post.dpr=0.5, internal buffer 540x960, output stays 1080x1920) as the preview-quality/speed trade-off.
- USER DECISION 2026-11-19 ~10:09 +07: FAST PREVIEW FIRST, full-quality render continues after.
- Preview config: scale 0.5 (540x960), post chain kept EXCEPT lens blur passes dropped (post.lens/pre=false via inputProps) — the user-approved fallback. Driver: project/render-preview.sh → chunks p1 (0-299), p2 (300-599), p3 (600-893) sequential, log /tmp/preview.log. Started 03:10 UTC.
- Then: upscale preview to 1080x1920 (lanczos+unsharp), mux mix.wav → out/cowboy/preview.mp4, ffprobe + 3-frame sanity check.
- After preview: resume scale-1.0 chunked full render (render-chunk.sh) → final.mp4 + short_qa. NOTE: no scale-1 chunk files exist yet (chunk 1 was killed at frame ~16 before any file was written; dpr test file never completed) — nothing reusable was discarded; the full render starts from frame 0. 2K NOT RUN (measured ~56 s/frame → ~14 h, brief's >4 h rule).
- RATE FINDINGS 2026-11-19 03:10-03:26 UTC (host load avg ~2 on 1.5-core quota; rates fluctuate >10x with other tenants):
  * Preview attempt 1 (scale 0.5, lens off, conc 1): 15.9 s/frame sustained (f3->f20 in 270 s).
  * Lean test (scale 0.5, lens+ink+bloom off): 14.9 s/frame — NO meaningful gain => bottleneck is base scene render + sprite-canvas JS on throttled CPU, NOT the post chain. Ink/bloom therefore KEPT in the preview.
  * Concurrency 2 test: no gain, memory critical (avail 336 MB) — REJECTED, back to concurrency 1.
  * Preview restarted 03:26 UTC with sanctioned config (scale 0.5, lens off only, conc 1, chunks p1/p2/p3). Projected ~16 s/frame -> ~4 h total for 894 frames. (Earlier killed attempts wrote no chunk files; nothing reusable lost.)
- 2026-11-19 ~04:25 UTC: SERVICE RESTART wiped /tmp and killed the preview render at ~frame 180/300 of p1; p1.mp4 was never finalized -> that progress is LOST (no chunk files existed). Recovery: preview driver rewritten resumable (6 chunks q1-q6 of ~150 frames, skip-if-complete via ffprobe frame count), logs now in workspace (out/cowboy/preview-render.log), relaunched 04:26 UTC.
- 2026-11-19 ~06:30 UTC: another service interruption killed the preview render mid-q3 (frame 55/150; q3 not finalized, lost). q1.mp4 + q2.mp4 (frames 0-299) are banked on disk. Driver relaunched 06:30 UTC — it auto-skips q1/q2 and re-renders q3 onward.
