// Pure frame-deterministic animation primitives, camera choreography, character kinematics,
// cloth wave solver, and scroll trajectory for OOSDemo15 ("The Roman Messenger Who Lost His Scroll").
// Zero Math.random() or Date.now() calls: every value is a pure function of frame f in [0, 449].

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

export const invLerp = (a: number, b: number, v: number): number =>
  Math.abs(b - a) < 1e-6 ? 0 : clamp01((v - a) / (b - a));

export const smootherstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

export const easeOutCubic = (t: number): number => {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
};

export const easeInOutQuad = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};

export const easeOutBack = (t: number, overshoot = 1.45): number => {
  const x = clamp01(t) - 1;
  return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
};

export const seededUnit = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return x - Math.floor(x);
};

export interface CameraTransform {
  panX: number;
  panY: number;
  scale: number;
  rotateDeg: number;
}

export function computeCameraTransform(frame: number): CameraTransform {
  const f = Math.max(0, Math.min(449, frame));

  // Shot 1 (0..59): Tight close-up on scroll & hands, then whip-dolly right/up as wind snatches scroll at f14
  if (f < 60) {
    const pre = smootherstep(invLerp(0, 14, f));
    const gust = smootherstep(invLerp(14, 59, f));
    const shake = f >= 14 && f <= 26 ? Math.sin((f - 14) * 1.9) * Math.exp(-(f - 14) * 0.22) * 8 : 0;
    return {
      panX: lerp(18, -52, gust) + shake,
      panY: lerp(10, 38, gust) - pre * 8,
      scale: lerp(1.06, 1.18, pre) * lerp(1.0, 0.96, gust),
      rotateDeg: lerp(-0.8, 2.2, gust) + shake * 0.08,
    };
  }

  // Shot 2 (60..149): Smooth lateral tracking camera following Marcus running down the Roman avenue
  if (f < 150) {
    const u = invLerp(60, 149, f);
    const s = smootherstep(u);
    const bob = Math.sin((f - 60) * 0.42) * 5;
    return {
      panX: lerp(35, -35, s),
      panY: lerp(6, -12, s) + bob,
      scale: lerp(1.02, 1.12, s),
      rotateDeg: lerp(-1.1, 1.1, s),
    };
  }

  // Shot 3 (150..269): Approach cart (150..197) -> insert under cart axle (198..235) -> exit scramble (236..269)
  if (f < 270) {
    const insertIn = smootherstep(invLerp(192, 202, f));
    const insertOut = smootherstep(invLerp(232, 242, f));
    const inInsert = insertIn * (1 - insertOut);
    const u = invLerp(150, 269, f);
    const basePanX = lerp(28, -42, smootherstep(u));
    const basePanY = lerp(8, -18, smootherstep(u));
    const baseScale = lerp(1.03, 1.11, smootherstep(u));
    return {
      panX: lerp(basePanX, 12, inInsert),
      panY: lerp(basePanY, -24, inInsert),
      scale: lerp(baseScale, 1.17, inInsert),
      rotateDeg: lerp(-0.9 + u * 1.8, -2.1, inInsert),
    };
  }

  // Shot 4 (270..389): Portico catch (270..314) -> smooth push-in on unrolled scroll "WATCH OUT FOR WIND" (315..389)
  if (f < 390) {
    const reveal = smootherstep(invLerp(312, 336, f));
    const holdCreep = invLerp(336, 389, f) * 0.04;
    return {
      panX: lerp(22, 0, reveal),
      panY: lerp(14, -10, reveal) - holdCreep * 120,
      scale: lerp(1.01, 1.09, reveal) + holdCreep,
      rotateDeg: lerp(-0.6, 0.4, reveal),
    };
  }

  // Shot 5 (390..449): Callback gust snatches scroll again; camera drifts upward slightly with continuous living breeze
  const u5 = invLerp(390, 449, f);
  const s5 = smootherstep(u5);
  const gustShake = f >= 395 && f <= 410 ? Math.sin((f - 395) * 1.7) * Math.exp(-(f - 395) * 0.2) * 7 : 0;
  return {
    panX: lerp(0, -24, s5) + gustShake,
    panY: lerp(-6, 26, s5),
    scale: lerp(1.03, 1.11, s5),
    rotateDeg: lerp(0.4, -1.4, s5),
  };
}

export interface RunnerPose {
  phase: number;
  hipLeftDeg: number;
  kneeLeftDeg: number;
  hipRightDeg: number;
  kneeRightDeg: number;
  shoulderLeftDeg: number;
  elbowLeftDeg: number;
  shoulderRightDeg: number;
  elbowRightDeg: number;
  torsoLeanDeg: number;
  bobY: number;
  headTiltDeg: number;
}

export function computeRunnerKinematics(frame: number, cyclesPerSec = 2.6, strideScale = 1.0): RunnerPose {
  const t = frame / 30;
  const phase = (t * cyclesPerSec) % 1;
  const angle = phase * Math.PI * 2;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);

  const hipAmp = 42 * strideScale;
  const hipLeftDeg = sinA * hipAmp;
  const hipRightDeg = -sinA * hipAmp;

  // Knee bends backward (positive) during recovery and push-off
  const kneeLeftDeg = Math.max(8, (0.55 - 0.45 * cosA) * 68 * strideScale);
  const kneeRightDeg = Math.max(8, (0.55 + 0.45 * cosA) * 68 * strideScale);

  // Opposite arm swing to legs
  const armAmp = 46 * strideScale;
  const shoulderLeftDeg = -sinA * armAmp - 10;
  const shoulderRightDeg = sinA * armAmp - 10;
  const elbowLeftDeg = -52 - Math.max(0, -sinA) * 28 * strideScale;
  const elbowRightDeg = -52 - Math.max(0, sinA) * 28 * strideScale;

  // Double-frequency vertical bounce (2 steps per cycle)
  const bobY = -Math.abs(Math.sin(angle)) * 22 * strideScale + 8;
  const torsoLeanDeg = 16 * strideScale + Math.sin(angle * 2) * 3.5;
  const headTiltDeg = -6 + Math.cos(angle * 2) * 4;

  return {
    phase,
    hipLeftDeg,
    kneeLeftDeg,
    hipRightDeg,
    kneeRightDeg,
    shoulderLeftDeg,
    elbowLeftDeg,
    shoulderRightDeg,
    elbowRightDeg,
    torsoLeanDeg,
    bobY,
    headTiltDeg,
  };
}

export function computeCapeWavePath(
  frame: number,
  anchorX: number,
  anchorY: number,
  length = 175,
  windStrength = 1.0,
  direction: -1 | 1 = -1,
): string {
  const w1 = Math.sin(frame * 0.34) * 24 * windStrength;
  const w2 = Math.cos(frame * 0.28 + 1.1) * 38 * windStrength;
  const w3 = Math.sin(frame * 0.41 + 2.3) * 30 * windStrength;

  const x1 = anchorX + direction * (length * 0.35);
  const y1 = anchorY - 12 + w1;
  const x2 = anchorX + direction * (length * 0.72);
  const y2 = anchorY + 6 + w2;
  const xEnd = anchorX + direction * length;
  const yEnd = anchorY + 18 + w3;

  const thickness = 56;
  const bx2 = x2 + direction * 8;
  const by2 = y2 + thickness + w1 * 0.5;
  const bx1 = x1;
  const by1 = y1 + thickness * 0.75;

  return [
    `M ${anchorX.toFixed(1)} ${anchorY.toFixed(1)}`,
    `C ${x1.toFixed(1)} ${y1.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}, ${xEnd.toFixed(1)} ${yEnd.toFixed(1)}`,
    `L ${(xEnd - direction * 12).toFixed(1)} ${(yEnd + thickness * 0.85).toFixed(1)}`,
    `C ${bx2.toFixed(1)} ${by2.toFixed(1)}, ${bx1.toFixed(1)} ${by1.toFixed(1)}, ${anchorX.toFixed(1)} ${(anchorY + 26).toFixed(1)}`,
    "Z",
  ].join(" ");
}

export interface ScrollPose {
  x: number;
  y: number;
  rotateDeg: number;
  scale: number;
  unrollProgress: number; // 0 = rolled & sealed, 1 = fully unrolled showing message
  ribbonFlutter: number;
}

export function computeScrollPose(frame: number): ScrollPose {
  const f = Math.max(0, Math.min(449, frame));
  const ribbonFlutter = Math.sin(f * 0.48) * 18 + Math.cos(f * 0.31) * 10;

  // Shot 1 (0..59): Held in Marcus's hands until f14, then snatched upward-right by the wind gust
  if (f < 60) {
    if (f < 14) {
      const tremble = Math.sin(f * 0.9) * 3;
      return {
        x: 565 + tremble,
        y: 1055 + Math.cos(f * 0.7) * 4,
        rotateDeg: -12 + tremble * 0.7,
        scale: 1.25,
        unrollProgress: 0,
        ribbonFlutter,
      };
    }
    const u = invLerp(14, 59, f);
    const e = easeOutCubic(u);
    return {
      x: lerp(565, 910, e) + Math.sin(u * Math.PI * 3) * 42,
      y: lerp(1055, 390, e) - Math.sin(u * Math.PI) * 110,
      rotateDeg: -12 + e * 520,
      scale: lerp(1.25, 0.82, e),
      unrollProgress: 0,
      ribbonFlutter: ribbonFlutter * 1.5,
    };
  }

  // Shot 2 (60..149): Tumbling ahead of Marcus down the street on wind waves
  if (f < 150) {
    const u = invLerp(60, 149, f);
    return {
      x: lerp(680, 860, smootherstep(u)) + Math.sin((f - 60) * 0.22) * 55,
      y: 780 + Math.sin((f - 60) * 0.19) * 135 + Math.cos((f - 60) * 0.35) * 35,
      rotateDeg: (f - 60) * 11,
      scale: 0.92 + Math.sin((f - 60) * 0.15) * 0.08,
      unrollProgress: 0,
      ribbonFlutter: ribbonFlutter * 1.4,
    };
  }

  // Shot 3 (150..269): Dives under merchant's cart (150..197), bounces between wheels (198..235), rockets out (236..269)
  if (f < 270) {
    if (f < 198) {
      const u = invLerp(150, 197, f);
      const s = smootherstep(u);
      return {
        x: lerp(310, 690, s),
        y: lerp(690, 1290, s) - Math.sin(u * Math.PI) * 90,
        rotateDeg: (f - 150) * 14,
        scale: lerp(0.95, 0.78, s),
        unrollProgress: 0,
        ribbonFlutter,
      };
    }
    if (f < 236) {
      const u = invLerp(198, 235, f);
      return {
        x: lerp(420, 820, smootherstep(u)),
        y: 1120 + Math.sin(u * Math.PI * 3) * 55,
        rotateDeg: -25 + u * 380,
        scale: 1.15,
        unrollProgress: 0,
        ribbonFlutter: ribbonFlutter * 1.3,
      };
    }
    const u = invLerp(236, 269, f);
    const e = easeOutCubic(u);
    return {
      x: lerp(680, 940, e),
      y: lerp(1260, 470, e) - Math.sin(u * Math.PI) * 120,
      rotateDeg: (f - 236) * 16,
      scale: lerp(0.85, 0.95, e),
      unrollProgress: 0,
      ribbonFlutter: ribbonFlutter * 1.6,
    };
  }

  // Shot 4 (270..389): Drops into Governor's outstretched hand (270..294), then unrolls (312..335) to show message
  if (f < 390) {
    if (f < 295) {
      const u = invLerp(270, 294, f);
      const e = easeOutBack(u, 1.2);
      return {
        x: lerp(790, 625, e),
        y: lerp(360, 880, e),
        rotateDeg: lerp(210, -6, easeOutCubic(u)),
        scale: lerp(0.88, 1.0, easeOutCubic(u)),
        unrollProgress: 0,
        ribbonFlutter,
      };
    }
    const unroll = smootherstep(invLerp(312, 336, f));
    const gentleBreeze = Math.sin(f * 0.25) * 4;
    return {
      x: lerp(625, 535, unroll) + gentleBreeze,
      y: lerp(880, 540, unroll) + Math.cos(f * 0.2) * 4,
      rotateDeg: lerp(-6, 0, unroll) + gentleBreeze * 0.2,
      scale: lerp(1.0, 0.94, unroll),
      unrollProgress: unroll,
      ribbonFlutter,
    };
  }

  // Shot 5 (390..449): At f395, second wind gust snatches the open scroll out of Governor's hands into the sky!
  if (f < 395) {
    return {
      x: 535 + Math.sin(f * 0.3) * 5,
      y: 540 + Math.cos(f * 0.25) * 4,
      rotateDeg: Math.sin(f * 0.3) * 2,
      scale: 0.94,
      unrollProgress: 1,
      ribbonFlutter,
    };
  }
  const u = invLerp(395, 449, f);
  const e = easeOutCubic(u);
  return {
    x: lerp(535, 910, e) + Math.sin(u * Math.PI * 4) * 55,
    y: lerp(540, 220, e) - Math.sin(u * Math.PI) * 95,
    rotateDeg: e * 410,
    scale: lerp(0.94, 0.54, e),
    unrollProgress: lerp(1.0, 0.35, e),
    ribbonFlutter: ribbonFlutter * 1.7,
  };
}

export interface WindParticle {
  id: number;
  x: number;
  y: number;
  rotateDeg: number;
  scale: number;
  hue: "olive" | "gold" | "petal";
}

export function computeWindParticles(frame: number, count = 14): WindParticle[] {
  const out: WindParticle[] = [];
  const hues: WindParticle["hue"][] = ["olive", "gold", "petal"];
  for (let i = 0; i < count; i += 1) {
    const speed = 11 + seededUnit(i * 7 + 1) * 14;
    const xBase = seededUnit(i * 13 + 3) * 1320;
    const yBase = 240 + seededUnit(i * 19 + 5) * 1240;
    const x = ((xBase + frame * speed) % 1320) - 120;
    const y = yBase + Math.sin(frame * 0.14 + i * 1.7) * (36 + (i % 4) * 14);
    const rotateDeg = (frame * (6 + (i % 5) * 3) + i * 47) % 360;
    const scale = 0.7 + seededUnit(i * 29 + 11) * 0.65;
    out.push({
      id: i,
      x,
      y,
      rotateDeg,
      scale,
      hue: hues[i % hues.length],
    });
  }
  return out;
}

export function computeCaptionOpacity(frame: number, shotStart: number, shotEnd: number): number {
  const fadeIn = shotStart === 0 ? 1 : smootherstep(invLerp(shotStart, shotStart + 8, frame));
  const fadeOut = shotEnd >= 450 ? 1 : 1 - smootherstep(invLerp(shotEnd - 8, shotEnd, frame));
  return clamp01(fadeIn * fadeOut);
}
