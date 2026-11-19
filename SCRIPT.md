# Out of Step — a cowboy cartoon 3D short (30 s trial)

Facts & source (skill pipeline step 1):
- The break-step lesson is real: on 12 April 1831 the Broughton Suspension Bridge near
  Manchester collapsed while soldiers of the 60th Rifle Corps marched across it in step;
  the rhythmic footfalls fed the bridge's bounce (resonance). Afterwards, soldiers were
  ordered to break step when crossing bridges — a rule still taught today.
  Sources: standard histories of the Broughton bridge collapse (1831); resonance /
  break-step rule summarised in references/STYLE_BIBLE.md of the cartoon-3d-short skill.
- Our story transfers that true lesson to an original fictional Texas trail crew in 1883.
  Story, characters and voice are our own (per skill rules). No captions/labels in video.
  English narration only, one steady tone.

Format: vertical 9:16, 1080x1920 composition, final render 2K 1440x2560 (--scale 1.3333), 30 fps, ~30 s (900 frames).

## Narration script (9 beats, 107 words, target ~3.5 words/s)

1. HOOK:    "Twelve cowboys nearly bounced a river bridge into the water, just by walking in perfect time."
2. SETTING: "Texas, eighteen eighty-three. Eli, their leader, was proud of his rhythm."
3. ACTION1: "He crossed first. Tap, tap, tap."
4. ACTION2: "Behind him, every boot landed together."
5. ACTION3: "The bridge began to bounce, gently, then like a clothesline in a storm."
6. SNAP:    "A chain sang. A plank jumped. Eli's hat sailed into the river."
7. DEADPAN: "Luckily, the cowboys stayed dry. Unluckily, the fish kept the hat."
8. EXPLAIN: "A steady beat feeds a bounce, like pushing a swing at the same moment, every time."
9. CALLBACK:"So cowboys learned to cross out of step. Eli still keeps perfect time, on dry land."

## Shot plan (6 shots, 900 frames — final frame boundaries to be re-timed to the
## measured per-beat voice durations, keeping this order and these visuals)

- Shot 1 (hook):    wide aerial of the painted river town + chain bridge, day; the cowboy column enters the bridge.
- Shot 2 (setting + action 1-2): front medium shot of Eli + front rows in cowboy hats, marching in step, grinning/whistling.
- Shot 3 (action 3): boot-level close-up, then side view; the deck bounce visibly grows.
- Shot 4 (snap + deadpan): wide side view, bounce at max, a hat flies off toward the river; cowboys shocked, then dazed grins. NO collapse, nobody falls in.
- Shot 5 (explain): golden-hour park swing shot (existing PARK/swing staging), a kid on a swing pushed at the same moment each time.
- Shot 6 (callback): cowboys stroll back across the bridge OUT of step (tourists/stroll mode, own pace), relaxed; Eli on the bank, smiling, hatless.

Character adaptation: soldiers -> cowboys. Add a "cowboy" hat (wide brim + pinched crown)
in toon.ts hatOn/hatBehind, western outfits (brown/tan jackets, vests, neckerchief-red accent,
dark pants, brown boots) in cast.ts/toon.ts outfit table. Reduce column COUNT from 74 to 24
(12 cowboys x visual rows is fine at 24 cards for depth; front row is Eli + mates).
Bridge physics: reuse amp()/bounce with per-shot tau mapping so bounce is ~0 in shots 1-2,
grows through shot 3, peaks in shot 4, zero in shots 5-6. No snap/drop (bridgeState drop=0, snap=0 always).
