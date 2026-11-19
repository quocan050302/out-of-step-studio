import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeCameraTransform,
  computeCapeWavePath,
  computeRunnerKinematics,
  computeScrollPose,
  computeWindParticles,
} from "../../engine/src/videos/demo15/motion.ts";
import {
  DEMO15_DURATION_SEC,
  DEMO15_FPS,
  DEMO15_FRAMES,
  DEMO15_HEIGHT,
  DEMO15_ID,
  DEMO15_SHOTS,
  DEMO15_TITLE,
  DEMO15_WIDTH,
  buildShotPlanJson,
  getShotAtFrame,
} from "../../engine/src/videos/demo15/story.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("OOSDemo15 storyboard covers exactly 450 frames (15.0s @ 30fps, 1080x1920) with 5 contiguous shots", () => {
  assert.equal(DEMO15_ID, "OOSDemo15");
  assert.equal(DEMO15_TITLE, "The Roman Messenger Who Lost His Scroll");
  assert.equal(DEMO15_FPS, 30);
  assert.equal(DEMO15_FRAMES, 450);
  assert.equal(DEMO15_WIDTH, 1080);
  assert.equal(DEMO15_HEIGHT, 1920);
  assert.equal(DEMO15_DURATION_SEC, 15);
  assert.equal(DEMO15_SHOTS.length, 5);

  // Verify exact frame ranges requested by specification:
  // 0-59 HOOK, 60-149 CHASE, 150-269 ESCALATION, 270-389 PAYOFF, 390-449 CALLBACK
  const expectedRanges = [
    [1, "HOOK", 0, 60],
    [2, "CHASE", 60, 150],
    [3, "ESCALATION", 150, 270],
    [4, "PAYOFF", 270, 390],
    [5, "CALLBACK", 390, 450],
  ];
  for (let i = 0; i < expectedRanges.length; i += 1) {
    const [id, key, a, b] = expectedRanges[i];
    const shot = DEMO15_SHOTS[i];
    assert.equal(shot.id, id);
    assert.equal(shot.key, key);
    assert.equal(shot.a, a);
    assert.equal(shot.b, b);
  }

  for (let f = 0; f < DEMO15_FRAMES; f += 1) {
    const s = getShotAtFrame(f);
    assert.ok(f >= s.a && f < s.b, `Frame ${f} mapped to invalid shot ${s.id} [${s.a}, ${s.b})`);
  }

  const plan = buildShotPlanJson();
  assert.equal(plan.durationInFrames, 450);
  assert.equal(plan.shots.length, 5);
});

test("OOSDemo15 motion primitives are pure, deterministic, and finite across all 450 frames", () => {
  for (let f = 0; f < DEMO15_FRAMES; f += 1) {
    const cam1 = computeCameraTransform(f);
    const cam2 = computeCameraTransform(f);
    assert.deepEqual(cam1, cam2, `Camera non-deterministic at frame ${f}`);
    assert.ok(Number.isFinite(cam1.panX) && Number.isFinite(cam1.panY) && cam1.scale > 0.5);

    const run1 = computeRunnerKinematics(f);
    const run2 = computeRunnerKinematics(f);
    assert.deepEqual(run1, run2, `Runner kinematics non-deterministic at frame ${f}`);
    assert.ok(Number.isFinite(run1.hipLeftDeg) && Number.isFinite(run1.bobY));

    const scroll1 = computeScrollPose(f);
    const scroll2 = computeScrollPose(f);
    assert.deepEqual(scroll1, scroll2, `Scroll trajectory non-deterministic at frame ${f}`);
    assert.ok(scroll1.unrollProgress >= 0 && scroll1.unrollProgress <= 1);

    const cape = computeCapeWavePath(f, 0, 0, 180, 1.2, -1);
    assert.ok(cape.startsWith("M ") && cape.endsWith("Z"));

    const particles = computeWindParticles(f, 8);
    assert.equal(particles.length, 8);
  }

  // Scroll must be rolled in Hook (f0), unrolled during Payoff (f355), and carried off in Callback (f440)
  assert.equal(computeScrollPose(5).unrollProgress, 0);
  assert.equal(computeScrollPose(355).unrollProgress, 1);
  assert.ok(computeScrollPose(440).y < computeScrollPose(395).y);
});

test("Engine Root.tsx preserves CowboyShort registration alongside OOSDemo15", () => {
  const rootPath = path.resolve(__dirname, "../../engine/src/Root.tsx");
  const rootSrc = fs.readFileSync(rootPath, "utf8");
  assert.match(
    rootSrc,
    /<Composition id="CowboyShort" component=\{BridgeShort\} durationInFrames=\{BRIDGE_FRAMES\} fps=\{30\} width=\{1080\} height=\{1920\} \/>/,
  );
  assert.match(
    rootSrc,
    /<Composition id="OOSDemo15" component=\{Demo15Short\} durationInFrames=\{DEMO15_FRAMES\} fps=\{30\} width=\{1080\} height=\{1920\} \/>/,
  );
});
