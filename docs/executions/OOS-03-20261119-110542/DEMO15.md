# OOS-03 — 15-Second Production Demo Documentation (`OOSDemo15`)

- **Composition ID:** `OOSDemo15` (registered in `engine/src/Root.tsx` alongside preserved `CowboyShort`)
- **Title:** *"The Roman Messenger Who Lost His Scroll"*
- **Genre / Tone:** Original light comedy, explicitly fictional (`ORIGINAL FICTIONAL COMEDY · NOT HISTORICAL FACT`), general animation demonstration.
- **Specifications:** `1080×1920` (9:16 vertical), `30` fps (`30/1`), `450` frames (`15.000` seconds), H.264 (`yuv420p`, CRF 16) + stereo AAC audio (`48000` Hz, `2` channels, `192` kbps).

---

## 1. Per-Shot Storyboard & Animation Techniques

| Shot | Frames (Seconds) | Beat | Visual Staging & Camera Choreography | Code Animation Primitives (`engine/src/videos/demo15/`) | Timed Audio & Foley SFX (`synth_demo15_audio.py`) |
|---|---|---|---|---|---|
| **Shot 1** | `0–59` (`0.0s–2.0s`) | **HOOK** | Close-up on courier Marcus holding a crimson-ribboned, gold-wax-sealed papyrus scroll. At `f14`, a swirling wind gust rips the scroll from his fingers; camera whip-tracks upward-right as his eyes widen and hands scramble at empty air. | `Shot1Hook` (`Demo15.tsx`), `computeScrollPose`, `computeCapeWavePath`, `computeCameraTransform` (`motion.ts`) | A-Dorian lyre pluck + resonant filtered wind whoosh (`0.44s`) + papyrus flutter burst (`0.50s`) |
| **Shot 2** | `60–149` (`2.0s–5.0s`) | **CHASE** | Lateral tracking shot down a Roman avenue with 4-layer parallax (Sabine hills & aqueduct arches, terracotta insulae & splashing marble fountain, perspective cobblestones, foreground occlusion column silhouettes). Marcus sprints in full articulated run cycle chasing the tumbling scroll. | `Shot2Chase`, `RomanStreetParallax`, `computeRunnerKinematics` (`2.75` Hz stride, opposite arm/leg swing, knee bend, double-frequency vertical bounce) | Energetic lyre & frame-drum groove + rhythmic sandal footsteps (`5.5` steps/s) + splashing fountain water pass (`2.95s`) |
| **Shot 3** | `150–269` (`5.0s–9.0s`) | **ESCALATION** | Scroll dives beneath a merchant's wooden amphora cart (`f150–197`) as Marcus skids in comic anticipation; fast low-angle insert close-up under the cart axle & spoked wheels (`f198–235`) as Marcus peers and reaches under; scroll rockets out the far side (`f236–269`). | `Shot3Escalation`, `MerchantCart`, smooth 8-frame camera whip-zoom transition (`f194–202` and `f232–240`) | Accelerating footsteps + leather sandal skid (`5.58s`) + hollow wooden axle clunks + upward gust launch (`7.82s`) |
| **Shot 4** | `270–389` (`9.0s–13.0s`) | **PAYOFF** | On the marble steps of `CURIA · VENTUS`, dignified Governor Aurelius calmly catches the falling scroll (`f294`) as breathless Marcus halts on the left. At `f312–336`, the scroll unrolls above their heads to reveal **`"WATCH OUT FOR WIND"`** in bold readable English; strong reaction staging. | `Shot4Payoff`, `GovernorPortico`, `GovernorCharacter`, `PapyrusScroll` (`unrollProgress: 0 -> 1`) | Scroll catch thump (`9.80s`) + crisp parchment unroll rustle (`10.40s`) + 4-note major lyre payoff chime stinger (`11.05s`) |
| **Shot 5** | `390–449` (`13.0s–15.0s`) | **CALLBACK** | At `f395`, a cheeky second wind gust snatches the open scroll right out of the Governor's hands into the sky. Both watch it fly off while capes, togas, wind ribbons, leaves, and cypress trees sway continuously through `f449` as Marcus gives a deadpan comic shrug. | `Shot5Callback`, continuous `WindGustOverlay` & `CypressTree` sway, `shrugAmount` interpolation (`f406–430`) | Second wind gust snatch (`13.15s`) + papyrus flutter + deadpan double-pluck cadence (`14.15s–14.55s`) |

---

## 2. Audio Source Status

- **Score & Foley SFX:** `REAL_SYNTHESIZED` — Procedurally synthesized locally at `48000 Hz` stereo 16-bit PCM (`engine/scripts/synth_demo15_audio.py` -> `out/oos-03/demo15/demo15-mix.wav`, `2,880,044` bytes, SHA-256 `6e6878ab1ff4066dbfbd30db36c61a725179cfa7c8f63d0e294c1a216da8dc0e`).
- **Voice TTS Narration:** `NOT_USED_NO_LIVE_KEY` — No live Gemini API key is configured on this machine (`app/data/settings.json` absent, `GEMINI_API_KEY` unset). Per Section 5 rules, zero fake TTS was fabricated; instead, timed on-screen narrative caption cards (`BEAT 01`–`BEAT 05`) are rendered directly in the lower safe area alongside the original synthesized musical score and timed Foley SFX.

---

## 3. Exact Reproduction Commands

```bash
cd engine
npm ci --no-audit --no-fund
npx tsc --noEmit
node scripts/render-oos-demo15.mjs
```

---

## 4. Tangible Output Deliverables & SHA-256 Checksums

All binary deliverables are verified on the local filesystem under `out/oos-03/demo15/` (gitignored per `.gitignore` `out/` and `*.mp4` rules so binary videos are never committed to Git):

| Deliverable | Relative Path | Size (Bytes) | SHA-256 |
|---|---|---|---|
| **Final 1080×1920 MP4** | `out/oos-03/demo15/final_15s_1080x1920.mp4` | `22,947,400` | `3120d40cfd28d142790287cfec665f39a9f597b845055ff4cc16c54fbb0971ea` |
| **Preview 540×960 MP4** | `out/oos-03/demo15/preview_15s_540x960.mp4` | `8,449,986` | `20b4d5920f6735e9281b9e49d509e0b53afde261ffedb3815f1d3a2049fd1d38` |
| **Master 48kHz Stereo WAV** | `out/oos-03/demo15/demo15-mix.wav` | `2,880,044` | `6e6878ab1ff4066dbfbd30db36c61a725179cfa7c8f63d0e294c1a216da8dc0e` |
| **Shot Plan JSON** | `out/oos-03/demo15/shot-plan.json` (copied to `test-artifacts/demo15-shot-plan.json`) | `2,713` | `d1924250dc24f500e4f62d507e46c2974718ca0928d88e2524c9fdcf03a5be11` |
| **15 Full-Res Stills (1080×1920)** | `out/oos-03/demo15/stills/frame_0000.png` .. `frame_0440.png` | `15` PNG files | Verified non-empty (`1080×1920`) |
| **8 Contact Sheets (60f each)** | `out/oos-03/demo15/qa/sheet_0000.jpg` .. `sheet_0420.jpg` | `8` JPEG sheets | Covers all `450` frames (`0..449`) |

---

## 5. `ffprobe` & `short_qa.py` Frame-by-Frame Verification Proof

Raw output saved in [test-artifacts/demo15-short-qa-report.md](./test-artifacts/demo15-short-qa-report.md) and [test-artifacts/demo15-ffprobe-final.json](./test-artifacts/demo15-ffprobe-final.json):

```text
SPECS 1080x1920 30/1 fps, 450 frames, 15.000 s; audio: aac 48000 Hz 2ch
LOUDNESS I:         -16.9 LUFS | LRA:         1.2 LU | Peak:       -1.5 dBFS
SILENCES none
FRAMES 450; black []; unplanned white []; frozen spans >=12f []
POPS (unplanned frame-diff spikes > 3x local median): []
MOTION mean diff 7.71; frames with diff<0.3 (held): 0 (0%)

PER SHOT  (luma mean / std / p2 / p98 / saturation mean, medians over the shot)
  shot  1 f0-59: 0.602 / 0.224 / 0.139 / 0.910 / 0.384
  shot  2 f60-149: 0.566 / 0.197 / 0.142 / 0.907 / 0.391
  shot  3 f150-269: 0.561 / 0.186 / 0.141 / 0.897 / 0.416
  shot  4 f270-389: 0.654 / 0.245 / 0.154 / 0.956 / 0.309
  shot  5 f390-449: 0.613 / 0.267 / 0.154 / 0.955 / 0.304
```
