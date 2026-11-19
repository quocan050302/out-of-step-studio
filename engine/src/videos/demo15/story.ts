// Source-of-truth storyboard, shot timing, captions, and QA metadata for OOSDemo15:
// "The Roman Messenger Who Lost His Scroll" (450 frames @ 30 fps = 15.000s, 1080x1920 vertical 9:16).
// Original light comedy, explicitly fictional, not presented as established Roman history.

export const DEMO15_ID = "OOSDemo15";
export const DEMO15_TITLE = "The Roman Messenger Who Lost His Scroll";
export const DEMO15_SUBTITLE = "An Original Fictional Comedy Short";
export const DEMO15_FPS = 30;
export const DEMO15_FRAMES = 450;
export const DEMO15_WIDTH = 1080;
export const DEMO15_HEIGHT = 1920;
export const DEMO15_DURATION_SEC = DEMO15_FRAMES / DEMO15_FPS;

export type Demo15ShotId = 1 | 2 | 3 | 4 | 5;
export type Demo15ShotKey = "HOOK" | "CHASE" | "ESCALATION" | "PAYOFF" | "CALLBACK";

export interface Demo15ShotDef {
  id: Demo15ShotId;
  key: Demo15ShotKey;
  a: number; // inclusive start frame
  b: number; // exclusive end frame
  startSec: number;
  endSec: number;
  summary: string;
  cameraNote: string;
  actingNote: string;
  caption: string;
}

export const DEMO15_SHOTS: Demo15ShotDef[] = [
  {
    id: 1,
    key: "HOOK",
    a: 0,
    b: 60,
    startSec: 0,
    endSec: 2,
    summary: "Close-up of wax-sealed papyrus scroll torn from messenger Marcus's hands by a sudden Roman wind gust.",
    cameraNote: "Tight close-up framing on hands and scroll, quick whip-track upward right as the gust strikes at f14.",
    actingNote: "Marcus grips the sealed scroll proudly, then gasps with wide eyes and scrambling fingers as wind snatches it.",
    caption: "A Roman messenger had one job: deliver a sealed scroll. Then the wind stole it.",
  },
  {
    id: 2,
    key: "CHASE",
    a: 60,
    b: 150,
    startSec: 2,
    endSec: 5,
    summary: "Marcus sprints down a sunny Roman street past a splashing fountain while his crimson cape flows in the wind.",
    cameraNote: "Dynamic lateral tracking shot with 4-layer parallax (aqueduct, insulae + fountain, cobbles, foreground columns).",
    actingNote: "Full articulated run cycle, forward lean, billowing cape, determined expression chasing the tumbling scroll.",
    caption: "He chased it past a fountain, cape flying down the avenue...",
  },
  {
    id: 3,
    key: "ESCALATION",
    a: 150,
    b: 270,
    startSec: 5,
    endSec: 9,
    summary: "The scroll dives beneath a merchant's amphora cart; fast low-angle axle insert as Marcus reaches under and misses.",
    cameraNote: "Tracking approach (f150-195) -> whip zoom into under-cart wheel insert (f196-236) -> pull out exit launch (f237-269).",
    actingNote: "Comic braking skid with dust puffs, upside-down peering face under cart axle, scramble as scroll rockets out.",
    caption: "...under a merchant's cart, and straight toward the governor's steps!",
  },
  {
    id: 4,
    key: "PAYOFF",
    a: 270,
    b: 390,
    startSec: 9,
    endSec: 13,
    summary: "Scroll lands neatly in Governor Aurelius's hand; unrolled papyrus reveals the warning: 'WATCH OUT FOR WIND'.",
    cameraNote: "Portico two-shot catch (f270-314) -> smooth push-in on unrolling parchment reveal and dual reaction staging (f315-389).",
    actingNote: "Governor calmly catches scroll and unrolls it; raised-eyebrow deadpan vs breathless messenger's jaw-drop.",
    caption: "The governor unrolled it. The message said: “Watch out for wind.”",
  },
  {
    id: 5,
    key: "CALLBACK",
    a: 390,
    b: 450,
    startSec: 13,
    endSec: 15,
    summary: "A cheeky second gust snatches the open scroll out of the governor's hands into the sky; shared deadpan reaction.",
    cameraNote: "Medium two-shot with upward tilt drift following the escaping scroll while characters hold living windblown motion.",
    actingNote: "Scroll rips away at f396; togas, capes, and cypress trees sway continuously as both exchange a synchronized blink and shrug.",
    caption: "One gust later, they both understood.",
  },
];

export const DEMO15_NARRATION_SCRIPT =
  "A Roman messenger had one job: deliver a sealed scroll. Then the wind stole it. " +
  "He chased it past a fountain, under a cart, and straight into the governor’s hands. " +
  "The governor unrolled it. The message said: “Watch out for wind.” " +
  "One gust later, they both understood.";

export function getShotAtFrame(frame: number): Demo15ShotDef {
  const f = Math.max(0, Math.min(DEMO15_FRAMES - 1, Math.floor(frame)));
  return DEMO15_SHOTS.find((s) => f >= s.a && f < s.b) ?? DEMO15_SHOTS[DEMO15_SHOTS.length - 1];
}

export function buildShotPlanJson() {
  return {
    compositionId: DEMO15_ID,
    title: DEMO15_TITLE,
    subtitle: DEMO15_SUBTITLE,
    fictionalDisclaimer: "Explicitly fictional light comedy created for animation demonstration; not historical fact.",
    width: DEMO15_WIDTH,
    height: DEMO15_HEIGHT,
    fps: DEMO15_FPS,
    durationInFrames: DEMO15_FRAMES,
    durationSec: DEMO15_DURATION_SEC,
    narrationScript: DEMO15_NARRATION_SCRIPT,
    shots: DEMO15_SHOTS.map((s) => ({
      id: s.id,
      key: s.key,
      a: s.a,
      b: s.b,
      startSec: s.startSec,
      endSec: s.endSec,
      summary: s.summary,
      cameraNote: s.cameraNote,
      actingNote: s.actingNote,
      caption: s.caption,
    })),
    // Planned sub-shot camera transitions for short_qa.py pop filter
    xfade: [
      [57, 63],
      [147, 153],
      [193, 203],
      [233, 243],
      [267, 273],
      [311, 321],
      [387, 393],
    ],
    planned: [
      [13, 17],
      [58, 62],
      [148, 152],
      [194, 202],
      [234, 242],
      [268, 272],
      [312, 320],
      [388, 398],
    ],
  };
}
