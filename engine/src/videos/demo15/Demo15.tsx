import React from "react";
import { AbsoluteFill, Audio, getInputProps, staticFile, useCurrentFrame } from "remotion";
import {
  CypressTree,
  GovernorCharacter,
  GovernorPortico,
  MerchantCart,
  MessengerCharacter,
  PapyrusScroll,
  RomanSkyAndHills,
  RomanStreetParallax,
  StoryCaptionCard,
  WindGustOverlay,
} from "./art";
import {
  computeCameraTransform,
  computeCaptionOpacity,
  computeRunnerKinematics,
  computeScrollPose,
  computeWindParticles,
  invLerp,
  lerp,
  smootherstep,
} from "./motion";
import { DEMO15_FRAMES, getShotAtFrame } from "./story";

export { DEMO15_FRAMES };

const INK = "#1E1510";

const Shot1Hook: React.FC<{ frame: number }> = ({ frame }) => {
  const shocked = frame >= 14;
  const reach = smootherstep(invLerp(14, 38, frame));
  const Scroll = computeScrollPose(frame);

  const pose = {
    phase: 0,
    hipLeftDeg: -8,
    kneeLeftDeg: 14,
    hipRightDeg: 12,
    kneeRightDeg: 10,
    shoulderLeftDeg: lerp(-48, -112, reach),
    elbowLeftDeg: lerp(-35, -18, reach),
    shoulderRightDeg: lerp(-54, -124, reach),
    elbowRightDeg: lerp(-42, -12, reach),
    torsoLeanDeg: lerp(4, 14, reach),
    bobY: Math.sin(frame * 0.3) * 6,
    headTiltDeg: lerp(-4, -18, reach),
  };

  return (
    <g>
      <RomanSkyAndHills frame={frame} scrollX={frame * 3} variant="closeup" />
      <RomanStreetParallax frame={frame} scrollX={frame * 4} showFountain={false} />

      {/* Terrace Balustrade */}
      <rect x={-120} y={1240} width={1320} height={45} fill="#EFE2C8" stroke={INK} strokeWidth={4} />
      <rect x={-120} y={1285} width={1320} height={640} fill="#D8C5A6" stroke={INK} strokeWidth={4} />

      {/* Close-up Messenger Marcus */}
      <MessengerCharacter
        x={330}
        y={1315}
        scale={1.82}
        frame={frame}
        pose={pose}
        expression={shocked ? "shocked" : "focused"}
        windStrength={shocked ? 1.55 : 0.75}
      />

      {/* Comic Shock Lines around Head when Wind Strikes */}
      {frame >= 14 && frame <= 44 && (
        <g
          transform="translate(360, 820)"
          opacity={1 - invLerp(14, 44, frame)}
          stroke="#FFF3B8"
          strokeWidth={6}
          strokeLinecap="round"
        >
          <line x1={-135} y1={-95} x2={-175} y2={-135} />
          <line x1={-40} y1={-145} x2={-50} y2={-195} />
          <line x1={75} y1={-130} x2={115} y2={-175} />
        </g>
      )}

      {/* Wax-Sealed Papyrus Scroll */}
      <PapyrusScroll pose={Scroll} />
    </g>
  );
};

const Shot2Chase: React.FC<{ frame: number }> = ({ frame }) => {
  const localF = frame - 60;
  const scrollX = localF * 15;
  const runnerPose = computeRunnerKinematics(frame, 2.75, 1.08);
  const runnerX = lerp(250, 415, smootherstep(invLerp(60, 149, frame))) + Math.sin(localF * 0.2) * 18;
  const scrollPose = computeScrollPose(frame);

  // Foreground occlusion column sweeping across frame edge for 2.5D depth
  const fgColumnX = 1280 - ((localF * 26) % 1680);

  return (
    <g>
      <RomanSkyAndHills frame={frame} scrollX={scrollX} variant="street" />
      <RomanStreetParallax frame={frame} scrollX={scrollX} showFountain={true} />

      {/* Running Dust Puffs Behind Sandals */}
      {Array.from({ length: 4 }, (_, i) => {
        const age = ((localF * 0.14 + i * 0.25) % 1);
        const dx = runnerX - 75 - age * 140;
        const dy = 1255 - Math.sin(age * Math.PI) * 28;
        const r = 14 + age * 26;
        return (
          <circle
            key={i}
            cx={dx}
            cy={dy}
            r={r}
            fill="#EFE3CC"
            opacity={(1 - age) * 0.65}
            stroke={INK}
            strokeWidth={2.5}
          />
        );
      })}

      {/* Sprinting Messenger Marcus */}
      <MessengerCharacter
        x={runnerX}
        y={1115}
        scale={1.18}
        frame={frame}
        pose={runnerPose}
        expression="running"
        windStrength={1.45}
      />

      {/* Runaway Scroll surfing on wind ahead */}
      <PapyrusScroll pose={scrollPose} />

      {/* Foreground Occlusion Column Silhouette (soft edge framing) */}
      <g transform={`translate(${fgColumnX}, 0)`} opacity={0.9}>
        <rect x={-48} y={-80} width={96} height={2080} fill="#3B281D" stroke={INK} strokeWidth={4} />
        <line x1={-18} y1={-80} x2={-18} y2={2000} stroke="#543B2B" strokeWidth={6} />
      </g>
    </g>
  );
};

const Shot3Escalation: React.FC<{ frame: number }> = ({ frame }) => {
  const localF = frame - 150;
  const scrollPose = computeScrollPose(frame);

  // Smooth blend into fast low-angle under-cart insert (f198..235)
  const insertIn = smootherstep(invLerp(194, 202, frame));
  const insertOut = smootherstep(invLerp(232, 240, frame));
  const insertWeight = insertIn * (1 - insertOut);

  // Wide street approach & exit (150..197 and 236..269)
  const isExit = frame >= 236;
  const approachU = smootherstep(invLerp(150, 196, frame));
  const exitU = smootherstep(invLerp(236, 269, frame));
  const runnerX = isExit ? lerp(430, 610, exitU) : lerp(175, 410, approachU);

  const widePose = isExit
    ? computeRunnerKinematics(frame, 2.8, 1.1)
    : {
        // Comic braking / skidding anticipation pose
        phase: 0,
        hipLeftDeg: -38,
        kneeLeftDeg: 22,
        hipRightDeg: 44,
        kneeRightDeg: 18,
        shoulderLeftDeg: -75,
        elbowLeftDeg: -25,
        shoulderRightDeg: -95,
        elbowRightDeg: -20,
        torsoLeanDeg: lerp(14, -14, approachU),
        bobY: Math.sin(localF * 0.4) * 8,
        headTiltDeg: lerp(-4, 12, approachU),
      };

  return (
    <g>
      {/* Base Wide Cart Layer */}
      <g opacity={1 - insertWeight}>
        <RomanSkyAndHills frame={frame} scrollX={1350 + localF * 6} variant="street" />
        <RomanStreetParallax frame={frame} scrollX={1350 + localF * 8} showFountain={false} />

        {/* Merchant Amphora Cart */}
        <MerchantCart x={690} y={1105} frame={frame} scale={1.14} />

        {/* Skid Dust Clouds at Marcus's Sandals */}
        {!isExit &&
          [0, 1, 2].map((di) => {
            const p = ((localF * 0.12 + di * 0.33) % 1);
            return (
              <circle
                key={di}
                cx={runnerX + 45 + p * 65}
                cy={1265 - p * 22}
                r={18 + p * 24}
                fill="#F3E6CE"
                opacity={(1 - p) * 0.72}
                stroke={INK}
                strokeWidth={2.5}
              />
            );
          })}

        <MessengerCharacter
          x={runnerX}
          y={1115}
          scale={1.16}
          frame={frame}
          pose={widePose}
          expression={isExit ? "running" : "shocked"}
          windStrength={1.35}
        />

        <PapyrusScroll pose={scrollPose} />
      </g>

      {/* Fast Low-Angle Under-Cart Insert Close-Up (f198..235) */}
      {insertWeight > 0.01 && (
        <g opacity={insertWeight}>
          <RomanSkyAndHills frame={frame} scrollX={1600 + localF * 4} variant="closeup" />
          {/* Low-Angle Cobblestone Floor & Deep Cart Shadow */}
          <rect x={-120} y={880} width={1320} height={1040} fill="#9C8464" stroke={INK} strokeWidth={4} />
          <ellipse cx={540} cy={1170} rx={520} ry={170} fill="#463523" opacity={0.58} />

          {/* Oversized Cart Underside & Spoked Wheels */}
          <rect x={-80} y={520} width={1240} height={110} fill="#7B4E2D" stroke={INK} strokeWidth={5} />
          {[210, 870].map((wx, wi) => (
            <g key={wx} transform={`translate(${wx}, 980) rotate(${Math.sin(frame * 0.4 + wi) * 8}) scale(2.15)`}>
              <circle r={78} fill="none" stroke="#6B4224" strokeWidth={20} />
              <circle r={88} fill="none" stroke={INK} strokeWidth={4} />
              {[0, 45, 90, 135].map((ang) => (
                <line
                  key={ang}
                  x1={-68}
                  y1={0}
                  x2={68}
                  y2={0}
                  stroke="#8B5A36"
                  strokeWidth={10}
                  transform={`rotate(${ang})`}
                />
              ))}
              <circle r={22} fill="#C68E4E" stroke={INK} strokeWidth={4} />
            </g>
          ))}

          {/* Marcus Peering & Reaching Under the Cart Axle */}
          <MessengerCharacter
            x={210}
            y={1090}
            scale={1.42}
            frame={frame}
            pose={{
              phase: 0,
              hipLeftDeg: -55,
              kneeLeftDeg: 65,
              hipRightDeg: 45,
              kneeRightDeg: 55,
              shoulderLeftDeg: -95,
              elbowLeftDeg: -10,
              shoulderRightDeg: -108 + Math.sin(frame * 0.6) * 12,
              elbowRightDeg: -8,
              torsoLeanDeg: 46,
              bobY: Math.sin(frame * 0.45) * 10,
              headTiltDeg: -22,
            }}
            expression="shocked"
            windStrength={1.3}
          />

          {/* Scroll Bouncing Between the Wheels */}
          <PapyrusScroll pose={scrollPose} />
        </g>
      )}
    </g>
  );
};

const Shot4Payoff: React.FC<{ frame: number }> = ({ frame }) => {
  const scrollPose = computeScrollPose(frame);
  const caught = frame >= 294;
  const unrolled = smootherstep(invLerp(312, 336, frame));
  const marcusArrival = smootherstep(invLerp(270, 302, frame));

  const marcusPose =
    frame < 300
      ? computeRunnerKinematics(frame, 2.2, 1 - marcusArrival * 0.75)
      : {
          phase: 0,
          hipLeftDeg: -10,
          kneeLeftDeg: 14,
          hipRightDeg: 14,
          kneeRightDeg: 12,
          shoulderLeftDeg: lerp(-20, -45, unrolled),
          elbowLeftDeg: lerp(-35, -65, unrolled),
          shoulderRightDeg: lerp(-25, -52, unrolled),
          elbowRightDeg: lerp(-40, -70, unrolled),
          torsoLeanDeg: lerp(12, 4, unrolled),
          bobY: Math.sin(frame * 0.24) * 6,
          headTiltDeg: lerp(-4, -10, unrolled),
        };

  return (
    <g>
      <RomanSkyAndHills frame={frame} scrollX={2100 + (frame - 270) * 2} variant="portico" />
      <CypressTree x={115} y={1120} scale={1.15} frame={frame} seed={2.1} />
      <CypressTree x={985} y={1120} scale={1.1} frame={frame} seed={5.4} />
      <GovernorPortico frame={frame} />

      {/* Messenger Marcus arriving breathless on left */}
      <MessengerCharacter
        x={lerp(130, 275, marcusArrival)}
        y={1145}
        scale={1.16}
        frame={frame}
        pose={marcusPose}
        expression={unrolled > 0.6 ? "shocked" : "breathless"}
        windStrength={0.95}
      />

      {/* Dignified Governor Aurelius on portico steps catching & unrolling scroll */}
      <GovernorCharacter
        x={785}
        y={1095}
        scale={1.24}
        frame={frame}
        expression={unrolled > 0.5 ? "reading_eyebrow" : caught ? "catching" : "calm"}
        armOpenProgress={unrolled}
      />

      {/* Scroll landing in Governor's hand & unrolling to reveal "WATCH OUT FOR WIND" */}
      <PapyrusScroll pose={scrollPose} />
    </g>
  );
};

const Shot5Callback: React.FC<{ frame: number }> = ({ frame }) => {
  const scrollPose = computeScrollPose(frame);
  const snatched = frame >= 395;
  const shrug = smootherstep(invLerp(406, 430, frame));

  const marcusCallbackPose = {
    phase: 0,
    hipLeftDeg: -8,
    kneeLeftDeg: 10,
    hipRightDeg: 10,
    kneeRightDeg: 10,
    shoulderLeftDeg: -24,
    elbowLeftDeg: -38,
    shoulderRightDeg: -28,
    elbowRightDeg: -42,
    torsoLeanDeg: Math.sin(frame * 0.18) * 3,
    bobY: Math.sin(frame * 0.22) * 5,
    headTiltDeg: lerp(-10, 6, shrug),
  };

  return (
    <g>
      <RomanSkyAndHills frame={frame} scrollX={2400 + (frame - 390) * 5} variant="portico" />
      <CypressTree x={115} y={1120} scale={1.15} frame={frame} seed={2.1} />
      <CypressTree x={985} y={1120} scale={1.1} frame={frame} seed={5.4} />
      <GovernorPortico frame={frame} />

      {/* Marcus watching scroll fly off & giving a deadpan comic shrug */}
      <MessengerCharacter
        x={285}
        y={1145}
        scale={1.18}
        frame={frame}
        pose={marcusCallbackPose}
        expression={snatched ? "deadpan_shrug" : "shocked"}
        windStrength={1.65}
        shrugAmount={shrug}
      />

      {/* Governor Aurelius left empty-handed with windblown deadpan reaction */}
      <GovernorCharacter
        x={775}
        y={1095}
        scale={1.24}
        frame={frame}
        expression={snatched ? "windblown_deadpan" : "reading_eyebrow"}
        armOpenProgress={lerp(1, 0.35, smootherstep(invLerp(395, 420, frame)))}
      />

      {/* Open scroll snatched into the Roman sky by the callback gust */}
      <PapyrusScroll pose={scrollPose} />
    </g>
  );
};

export const Demo15Short: React.FC = () => {
  const rawFrame = useCurrentFrame();
  const frame = Math.max(0, Math.min(DEMO15_FRAMES - 1, rawFrame));
  const shot = getShotAtFrame(frame);
  const cam = computeCameraTransform(frame);
  const particles = computeWindParticles(frame, 14);
  const captionOpacity = computeCaptionOpacity(frame, shot.a, shot.b);

  const props = getInputProps() as { includeRemotionAudio?: boolean };
  const windIntensity =
    (frame >= 12 && frame <= 58) || frame >= 394 ? 1.35 : 0.85;

  return (
    <AbsoluteFill style={{ backgroundColor: "#141F30", overflow: "hidden" }}>
      {props?.includeRemotionAudio && <Audio src={staticFile("demo15-mix.wav")} />}

      <svg
        viewBox="0 0 1080 1920"
        width="100%"
        height="100%"
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        {/* Camera Rig Transform */}
        <g
          transform={`translate(540, 960) scale(${cam.scale.toFixed(4)}) rotate(${cam.rotateDeg.toFixed(3)}) translate(${(-540 + cam.panX).toFixed(2)}, ${(-960 + cam.panY).toFixed(2)})`}
        >
          {shot.id === 1 && <Shot1Hook frame={frame} />}
          {shot.id === 2 && <Shot2Chase frame={frame} />}
          {shot.id === 3 && <Shot3Escalation frame={frame} />}
          {shot.id === 4 && <Shot4Payoff frame={frame} />}
          {shot.id === 5 && <Shot5Callback frame={frame} />}

          {/* Continuous Wind Ribbons & Leaves across all 450 frames */}
          <WindGustOverlay frame={frame} particles={particles} intensity={windIntensity} />
        </g>

        {/* Timed Safe-Area Editorial Caption & Fictional Disclaimer Badge */}
        <StoryCaptionCard
          shotNumber={shot.id}
          shotKey={shot.key}
          caption={shot.caption}
          opacity={captionOpacity}
          showTitleBadge={shot.id === 1 || shot.id === 5}
        />
      </svg>
    </AbsoluteFill>
  );
};
