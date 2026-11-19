import React from "react";
import {
  RunnerPose,
  ScrollPose,
  WindParticle,
  computeCapeWavePath,
  computeRunnerKinematics,
  invLerp,
  lerp,
  smootherstep,
} from "./motion";

const INK = "#1E1510";

export const RomanSkyAndHills: React.FC<{
  frame: number;
  scrollX?: number;
  variant?: "street" | "portico" | "closeup";
}> = ({ frame, scrollX = 0, variant = "street" }) => {
  const cloudShift1 = ((frame * 1.8 + scrollX * 0.12) % 1400) - 200;
  const cloudShift2 = ((frame * 1.2 + 520 + scrollX * 0.08) % 1400) - 200;
  const sunPulse = 1 + Math.sin(frame * 0.12) * 0.03;
  const hillShift = -(scrollX * 0.18) % 1080;

  return (
    <g>
      <defs>
        <linearGradient id="roman-sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82B8" />
          <stop offset="48%" stopColor="#7BB8DC" />
          <stop offset="85%" stopColor="#F6D79E" />
          <stop offset="100%" stopColor="#F4B97A" />
        </linearGradient>
        <linearGradient id="terracotta-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#DF7248" />
          <stop offset="100%" stopColor="#B44B27" />
        </linearGradient>
        <linearGradient id="marble-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF9EC" />
          <stop offset="100%" stopColor="#DFD0B5" />
        </linearGradient>
        <linearGradient id="papyrus-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDF2D0" />
          <stop offset="50%" stopColor="#F4DFAC" />
          <stop offset="100%" stopColor="#E2C482" />
        </linearGradient>
      </defs>

      {/* Sky Canvas */}
      <rect x={-120} y={-120} width={1320} height={1520} fill="url(#roman-sky-grad)" />

      {/* Warm Afternoon Sun & Rotating Rays */}
      <g transform={`translate(${variant === "portico" ? 230 : 830}, 270) scale(${sunPulse})`}>
        <circle r={145} fill="#FBE5A2" opacity={0.28} />
        <circle r={104} fill="#FDE9B0" opacity={0.48} />
        <circle r={72} fill="#FFF5D4" stroke="#F4C361" strokeWidth={4} />
      </g>

      {/* Drifting Mediterranean Clouds */}
      <g transform={`translate(${1000 - cloudShift1}, 230)`} opacity={0.86}>
        <path
          d="M 0 40 Q 30 0 85 12 Q 130 -18 185 10 Q 235 8 250 42 Z"
          fill="#FFF8E8"
          stroke={INK}
          strokeWidth={3}
        />
      </g>
      <g transform={`translate(${1050 - cloudShift2}, 360) scale(0.85)`} opacity={0.78}>
        <path
          d="M 0 42 Q 40 2 95 14 Q 145 -16 205 14 Q 250 12 265 44 Z"
          fill="#FFF5DE"
          stroke={INK}
          strokeWidth={3}
        />
      </g>

      {/* Distant Sabine Hills & Cypress Silhouettes */}
      <g transform={`translate(${hillShift}, 0)`}>
        <path
          d="M -200 1060 Q 140 830 480 960 T 1160 910 T 1820 970 L 2360 1060 L 2360 1320 L -200 1320 Z"
          fill="#8AA37B"
          stroke={INK}
          strokeWidth={3.5}
        />
        {/* Distant Aqueduct Arches */}
        {Array.from({ length: 14 }, (_, i) => {
          const ax = -120 + i * 165;
          return (
            <g key={i} transform={`translate(${ax}, 770)`}>
              <rect x={0} y={0} width={165} height={24} fill="#D9C6A5" stroke={INK} strokeWidth={3} />
              <path
                d="M 0 24 L 0 155 L 34 155 L 34 78 A 48 48 0 0 1 131 78 L 131 155 L 165 155 L 165 24 Z"
                fill="#E7D7BA"
                stroke={INK}
                strokeWidth={3}
              />
            </g>
          );
        })}
      </g>
    </g>
  );
};

export const CypressTree: React.FC<{
  x: number;
  y: number;
  scale?: number;
  frame: number;
  seed?: number;
}> = ({ x, y, scale = 1, frame, seed = 1 }) => {
  const sway = Math.sin(frame * 0.22 + seed) * 14 + Math.cos(frame * 0.15 + seed * 2) * 6;
  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      <rect x={-12} y={-50} width={24} height={55} fill="#6B442A" stroke={INK} strokeWidth={3.5} />
      <path
        d={`M -46 -45 Q ${-50 + sway * 0.3} -180 ${sway} -330 Q ${50 + sway * 0.4} -180 46 -45 Z`}
        fill="#2E5E3E"
        stroke={INK}
        strokeWidth={4}
      />
      <path
        d={`M -20 -65 Q ${-18 + sway * 0.3} -180 ${sway * 0.9} -295`}
        fill="none"
        stroke="#4B855B"
        strokeWidth={5}
        strokeLinecap="round"
      />
    </g>
  );
};

export const RomanStreetParallax: React.FC<{
  frame: number;
  scrollX: number;
  showFountain?: boolean;
}> = ({ frame, scrollX, showFountain = true }) => {
  const buildingOffset = -(scrollX * 0.55) % 1360;
  const roadOffset = -(scrollX * 1.15) % 220;

  return (
    <g>
      {/* Midground Cypress Trees */}
      {Array.from({ length: 7 }, (_, i) => (
        <CypressTree
          key={i}
          x={((i * 290 - scrollX * 0.35) % 1800) - 220}
          y={1040}
          scale={0.9 + (i % 3) * 0.14}
          frame={frame}
          seed={i * 3.1}
        />
      ))}

      {/* Roman Insulae Buildings */}
      {[0, 1360].map((tileShift) => (
        <g key={tileShift} transform={`translate(${buildingOffset + tileShift}, 0)`}>
          {/* Villa 1: Warm Ochre Stucco */}
          <g transform="translate(-80, 560)">
            <rect x={0} y={60} width={410} height={470} fill="#F1C987" stroke={INK} strokeWidth={4} />
            <polygon points="-24,60 205,-30 434,60" fill="url(#terracotta-grad)" stroke={INK} strokeWidth={4} />
            {[65, 235].map((wx) => (
              <g key={wx} transform={`translate(${wx}, 135)`}>
                <rect x={0} y={0} width={96} height={130} rx={48} fill="#463227" stroke={INK} strokeWidth={4} />
                <rect x={-8} y={125} width={112} height={16} fill="#E5D4B7" stroke={INK} strokeWidth={3} />
              </g>
            ))}
            {/* Arched Colonnade Base */}
            {[40, 175, 310].map((ax) => (
              <path
                key={ax}
                d={`M ${ax} 470 L ${ax} 365 A 36 36 0 0 1 ${ax + 72} 365 L ${ax + 72} 470 Z`}
                fill="#5A3E2E"
                stroke={INK}
                strokeWidth={3.5}
              />
            ))}
          </g>

          {/* Villa 2: Sienna Facade with Banner */}
          <g transform="translate(380, 510)">
            <rect x={0} y={70} width={450} height={510} fill="#E48F65" stroke={INK} strokeWidth={4} />
            <polygon points="-20,70 470,70 435,5 15,5" fill="url(#terracotta-grad)" stroke={INK} strokeWidth={4} />
            {[70, 200, 330].map((wx) => (
              <rect
                key={wx}
                x={wx}
                y={135}
                width={66}
                height={105}
                rx={33}
                fill="#3E2A20"
                stroke={INK}
                strokeWidth={3.5}
              />
            ))}
            {/* Hanging Laundry / Street Garland swaying in wind */}
            <path
              d={`M 40 280 Q 225 ${325 + Math.sin(frame * 0.25) * 18} 410 280`}
              fill="none"
              stroke={INK}
              strokeWidth={3.5}
            />
            {[95, 175, 255, 335].map((gx, gi) => {
              const swing = Math.sin(frame * 0.3 + gi) * 10;
              return (
                <polygon
                  key={gx}
                  points={`${gx},296 ${gx + 34},298 ${gx + 26 + swing},355 ${gx - 6 + swing},352`}
                  fill={gi % 2 === 0 ? "#C93B3B" : "#F3C65F"}
                  stroke={INK}
                  strokeWidth={3}
                />
              );
            })}
          </g>

          {/* Villa 3: Travertine Temple Annex */}
          <g transform="translate(880, 540)">
            <rect x={0} y={60} width={420} height={490} fill="#EFE2C8" stroke={INK} strokeWidth={4} />
            <polygon points="-24,60 210,-36 444,60" fill="#CE5A34" stroke={INK} strokeWidth={4} />
            <circle cx={210} cy={22} r={22} fill="#E8B14A" stroke={INK} strokeWidth={3.5} />
            {[55, 155, 255, 345].map((cx) => (
              <rect
                key={cx}
                x={cx}
                y={60}
                width={28}
                height={480}
                fill="url(#marble-grad)"
                stroke={INK}
                strokeWidth={3.5}
              />
            ))}
          </g>
        </g>
      ))}

      {/* Splashing Marble Fountain in the Plaza */}
      {showFountain && (
        <g transform={`translate(${660 - ((scrollX * 0.72) % 1500)}, 960)`}>
          {/* Basin */}
          <ellipse cx={0} cy={80} rx={155} ry={34} fill="#D5C4A6" stroke={INK} strokeWidth={4} />
          <rect x={-145} y={35} width={290} height={48} fill="url(#marble-grad)" stroke={INK} strokeWidth={4} />
          <ellipse cx={0} cy={35} rx={145} ry={28} fill="#5EB7E2" stroke={INK} strokeWidth={4} />
          {/* Pedestal */}
          <rect x={-26} y={-55} width={52} height={90} fill="url(#marble-grad)" stroke={INK} strokeWidth={4} />
          <ellipse cx={0} cy={-55} rx={68} ry={18} fill="#EAE0CC" stroke={INK} strokeWidth={4} />
          {/* Animated Water Jets */}
          {[-1, 1].map((dir) => {
            const jetLift = Math.sin(frame * 0.45 + dir) * 14;
            return (
              <path
                key={dir}
                d={`M 0 -62 Q ${dir * 65} ${-155 + jetLift} ${dir * 105} 28`}
                fill="none"
                stroke="#B8ECFF"
                strokeWidth={8}
                strokeLinecap="round"
              />
            );
          })}
          {/* Animated Splash Droplets */}
          {Array.from({ length: 6 }, (_, di) => {
            const u = ((frame * 0.08 + di * 0.17) % 1);
            const side = di % 2 === 0 ? 1 : -1;
            const dx = side * (25 + u * 95);
            const dy = -60 - Math.sin(u * Math.PI) * 85 + u * 85;
            return <circle key={di} cx={dx} cy={dy} r={6} fill="#E1F8FF" stroke={INK} strokeWidth={2} />;
          })}
        </g>
      )}

      {/* Cobblestone Street & Curb */}
      <g transform="translate(0, 1070)">
        <rect x={-150} y={0} width={1380} height={42} fill="#D6C3A4" stroke={INK} strokeWidth={4} />
        <rect x={-150} y={42} width={1380} height={850} fill="#B89F7D" stroke={INK} strokeWidth={4} />
        {/* Scrolling Cobblestone Courses */}
        {[110, 235, 380, 540, 710].map((ry, rIdx) => (
          <g key={ry} transform={`translate(${roadOffset + (rIdx % 2) * 110}, ${ry})`}>
            <line x1={-320} y1={0} x2={1520} y2={0} stroke="#8D7556" strokeWidth={3.5} />
            {Array.from({ length: 10 }, (_, ci) => {
              const cx = -240 + ci * 220;
              return (
                <g key={ci}>
                  <rect
                    x={cx}
                    y={10}
                    width={185}
                    height={56 + rIdx * 10}
                    rx={18}
                    fill={ci % 2 === 0 ? "#C6AF8E" : "#AC9372"}
                    stroke="#755E42"
                    strokeWidth={3}
                  />
                </g>
              );
            })}
          </g>
        ))}
      </g>
    </g>
  );
};

export const MerchantCart: React.FC<{
  x: number;
  y: number;
  frame: number;
  scale?: number;
}> = ({ x, y, frame, scale = 1 }) => {
  const wheelWobble = Math.sin(frame * 0.35) * 4;
  const awningFlap = Math.sin(frame * 0.42) * 14;

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      {/* Dynamic Cast Shadow beneath Cart */}
      <ellipse cx={10} cy={148} rx={270} ry={34} fill="#5C4832" opacity={0.48} />

      {/* Back Wheel */}
      <g transform={`translate(135, 62) rotate(${wheelWobble * 1.4})`}>
        <circle r={74} fill="none" stroke="#5A3820" strokeWidth={18} />
        <circle r={83} fill="none" stroke={INK} strokeWidth={4} />
        <circle r={65} fill="none" stroke={INK} strokeWidth={3.5} />
        {[0, 45, 90, 135].map((ang) => (
          <line
            key={ang}
            x1={-65}
            y1={0}
            x2={65}
            y2={0}
            stroke="#6F472B"
            strokeWidth={9}
            transform={`rotate(${ang})`}
          />
        ))}
        <circle r={18} fill="#8C6239" stroke={INK} strokeWidth={4} />
      </g>

      {/* Terracotta Amphorae Cargo */}
      {[-115, -35, 45, 120].map((ax, idx) => (
        <g key={ax} transform={`translate(${ax}, -58) rotate(${(idx - 1.5) * 5})`}>
          <ellipse cx={0} cy={10} rx={36} ry={52} fill="#C95B35" stroke={INK} strokeWidth={4} />
          <rect x={-14} y={-56} width={28} height={28} fill="#D86A43" stroke={INK} strokeWidth={4} />
          <ellipse cx={0} cy={-56} rx={20} ry={7} fill="#E6815B" stroke={INK} strokeWidth={3.5} />
          <path
            d="M -14 -46 Q -42 -36 -32 -4 M 14 -46 Q 42 -36 32 -4"
            fill="none"
            stroke="#B44B27"
            strokeWidth={7}
            strokeLinecap="round"
          />
        </g>
      ))}

      {/* Wooden Cart Bed & Side Rails */}
      <rect x={-210} y={-24} width={420} height={46} rx={8} fill="#9A683E" stroke={INK} strokeWidth={4.5} />
      <line x1={-205} y1={-2} x2={205} y2={-2} stroke={INK} strokeWidth={3} />
      {[-165, -85, -5, 75, 155].map((px) => (
        <rect key={px} x={px} y={-78} width={16} height={56} fill="#7E512D" stroke={INK} strokeWidth={3.5} />
      ))}
      <rect x={-200} y={-86} width={400} height={16} rx={5} fill="#B27B4D" stroke={INK} strokeWidth={4} />
      {/* Cart Shafts */}
      <path d="M 190 2 L 330 48 L 325 64 L 185 18 Z" fill="#7E512D" stroke={INK} strokeWidth={4} />

      {/* Posts & Flapping Striped Awning */}
      <rect x={-185} y={-275} width={14} height={195} fill="#6E4526" stroke={INK} strokeWidth={3.5} />
      <rect x={175} y={-275} width={14} height={195} fill="#6E4526" stroke={INK} strokeWidth={3.5} />
      <path
        d={`M -215 -275 Q 0 ${-325 + awningFlap * 0.5} 215 -275 L 228 ${-220 + awningFlap} Q 0 ${-245 - awningFlap} -225 ${-220 + awningFlap * 0.7} Z`}
        fill="#D6453A"
        stroke={INK}
        strokeWidth={4}
      />
      <path
        d={`M -110 -288 L 0 -295 L 110 -288 L 115 ${-228 + awningFlap * 0.6} L -115 ${-228 + awningFlap * 0.6} Z`}
        fill="#F6E3BA"
        stroke={INK}
        strokeWidth={3.5}
      />

      {/* Front Wheel */}
      <g transform={`translate(-85, 62) rotate(${wheelWobble})`}>
        <circle r={78} fill="none" stroke="#7A4E2D" strokeWidth={20} />
        <circle r={88} fill="none" stroke={INK} strokeWidth={4.5} />
        <circle r={68} fill="none" stroke={INK} strokeWidth={3.5} />
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
    </g>
  );
};

export const GovernorPortico: React.FC<{ frame: number }> = ({ frame }) => {
  const bannerWave = Math.sin(frame * 0.28) * 14;
  return (
    <g>
      {/* Marble Portico Platform & Steps */}
      <rect x={-120} y={1180} width={1320} height={740} fill="#D9C7A9" stroke={INK} strokeWidth={4} />
      {[0, 1, 2].map((step) => (
        <rect
          key={step}
          x={140 - step * 55}
          y={1110 + step * 48}
          width={880 + step * 110}
          height={48}
          fill={step % 2 === 0 ? "#F6ECDC" : "#E6D7BE"}
          stroke={INK}
          strokeWidth={4}
        />
      ))}

      {/* Back Sanctuary Wall */}
      <rect x={220} y={320} width={720} height={790} fill="#E5D4B8" stroke={INK} strokeWidth={4} />
      <rect x={440} y={470} width={280} height={640} fill="#462F24" stroke={INK} strokeWidth={4.5} />
      <rect x={456} y={486} width={248} height={624} fill="none" stroke="#D79F4B" strokeWidth={4} />

      {/* Hanging Imperial Velvet Drapes swaying in breeze */}
      {[-1, 1].map((side) => (
        <path
          key={side}
          d={`M ${580 + side * 150} 370 L ${580 + side * 235} 370 L ${580 + side * 245 + bannerWave} 940 L ${580 + side * 165 + bannerWave} 920 Z`}
          fill="#6C2346"
          stroke={INK}
          strokeWidth={4}
        />
      ))}

      {/* Fluted Corinthian Columns */}
      {[235, 375, 765, 905].map((cx) => (
        <g key={cx} transform={`translate(${cx}, 320)`}>
          <rect x={-44} y={745} width={88} height={45} rx={6} fill="#F8F0E0" stroke={INK} strokeWidth={4} />
          <rect x={-32} y={45} width={64} height={700} fill="url(#marble-grad)" stroke={INK} strokeWidth={4} />
          <line x1={-12} y1={55} x2={-12} y2={735} stroke="#C6B598" strokeWidth={3} />
          <line x1={12} y1={55} x2={12} y2={735} stroke="#C6B598" strokeWidth={3} />
          <rect x={-46} y={0} width={92} height={45} rx={8} fill="#F8F0E0" stroke={INK} strokeWidth={4} />
        </g>
      ))}

      {/* Classical Pediment Header */}
      <polygon points="150,320 580,130 1010,320" fill="#F6ECDA" stroke={INK} strokeWidth={4.5} />
      <polygon points="215,302 580,162 945,302" fill="#DECAA9" stroke={INK} strokeWidth={3.5} />
      <text
        x={580}
        y={272}
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="bold"
        fontSize={30}
        fill="#5C3D28"
        letterSpacing={3}
      >
        CURIA · VENTUS
      </text>
    </g>
  );
};

export type MessengerExpression =
  | "focused"
  | "shocked"
  | "running"
  | "skidding"
  | "peering"
  | "breathless"
  | "deadpan_shrug";

export const MessengerCharacter: React.FC<{
  x: number;
  y: number;
  scale?: number;
  frame: number;
  pose?: RunnerPose;
  expression?: MessengerExpression;
  windStrength?: number;
  shrugAmount?: number;
}> = ({
  x,
  y,
  scale = 1,
  frame,
  pose,
  expression = "running",
  windStrength = 1,
  shrugAmount = 0,
}) => {
  const p = pose ?? computeRunnerKinematics(frame, 2.5, 0.2);
  const capePath = computeCapeWavePath(frame, -18, -170, 195, windStrength, -1);
  const blink = frame % 75 >= 71;

  return (
    <g transform={`translate(${x}, ${y + p.bobY}) scale(${scale})`}>
      {/* Ground Character Shadow */}
      <ellipse cx={0} cy={145 - p.bobY} rx={74} ry={18} fill="#4A3826" opacity={0.42} />

      <g transform={`rotate(${p.torsoLeanDeg})`}>
        {/* Flowing Crimson Chlamys / Cape */}
        <path d={capePath} fill="#C42B2B" stroke={INK} strokeWidth={4} />
        <path
          d={computeCapeWavePath(frame + 4, -18, -158, 165, windStrength * 0.85, -1)}
          fill="none"
          stroke="#E85C4A"
          strokeWidth={4}
        />

        {/* Back Arm (Left) */}
        <g transform={`translate(8, -152) rotate(${p.shoulderLeftDeg - shrugAmount * 28})`}>
          <rect x={-13} y={0} width={26} height={66} rx={12} fill="#E69E6C" stroke={INK} strokeWidth={4} />
          <g transform={`translate(0, 56) rotate(${p.elbowLeftDeg - shrugAmount * 35})`}>
            <rect x={-11} y={0} width={22} height={58} rx={10} fill="#E69E6C" stroke={INK} strokeWidth={4} />
            <circle cx={0} cy={60} r={14} fill="#E69E6C" stroke={INK} strokeWidth={4} />
          </g>
        </g>

        {/* Back Leg (Left) */}
        <g transform={`translate(-8, -32) rotate(${p.hipLeftDeg})`}>
          <rect x={-16} y={0} width={32} height={78} rx={14} fill="#D98E5C" stroke={INK} strokeWidth={4} />
          <g transform={`translate(0, 70) rotate(${p.kneeLeftDeg})`}>
            <rect x={-14} y={0} width={28} height={74} rx={12} fill="#D98E5C" stroke={INK} strokeWidth={4} />
            {/* Roman Caligae Sandal */}
            <line x1={-13} y1={22} x2={13} y2={28} stroke="#6E3F21" strokeWidth={4} />
            <line x1={-13} y1={42} x2={13} y2={48} stroke="#6E3F21" strokeWidth={4} />
            <path d="M -18 68 L 32 68 Q 42 68 42 82 L -18 82 Z" fill="#6E3F21" stroke={INK} strokeWidth={4} />
          </g>
        </g>

        {/* Front Leg (Right) */}
        <g transform={`translate(10, -32) rotate(${p.hipRightDeg})`}>
          <rect x={-16} y={0} width={32} height={78} rx={14} fill="#EEAA77" stroke={INK} strokeWidth={4} />
          <g transform={`translate(0, 70) rotate(${p.kneeRightDeg})`}>
            <rect x={-14} y={0} width={28} height={74} rx={12} fill="#EEAA77" stroke={INK} strokeWidth={4} />
            <line x1={-13} y1={22} x2={13} y2={28} stroke="#6E3F21" strokeWidth={4} />
            <line x1={-13} y1={42} x2={13} y2={48} stroke="#6E3F21" strokeWidth={4} />
            <path d="M -18 68 L 32 68 Q 42 68 42 82 L -18 82 Z" fill="#7D4826" stroke={INK} strokeWidth={4} />
          </g>
        </g>

        {/* Roman Tunic & Leather Belt */}
        <path
          d="M -42 -175 L 42 -175 L 54 -22 L -52 -22 Z"
          fill="#F5EAD4"
          stroke={INK}
          strokeWidth={4.5}
        />
        <rect x={-48} y={-40} width={98} height={14} fill="#D99B38" stroke={INK} strokeWidth={3.5} />
        <rect x={-47} y={-95} width={94} height={20} rx={6} fill="#7B4625" stroke={INK} strokeWidth={4} />
        <circle cx={6} cy={-85} r={11} fill="#EBB448" stroke={INK} strokeWidth={3.5} />
        {/* Courier Satchel Strap */}
        <line x1={-34} y1={-172} x2={34} y2={-45} stroke="#6B3C1E" strokeWidth={9} />
        <circle cx={-24} cy={-164} r={14} fill="#EBB448" stroke={INK} strokeWidth={4} />

        {/* Front Arm (Right) */}
        <g transform={`translate(-10, -150) rotate(${p.shoulderRightDeg + shrugAmount * 28})`}>
          <rect x={-13} y={0} width={26} height={66} rx={12} fill="#F2AE7B" stroke={INK} strokeWidth={4} />
          <g transform={`translate(0, 56) rotate(${p.elbowRightDeg - shrugAmount * 35})`}>
            <rect x={-11} y={0} width={22} height={58} rx={10} fill="#F2AE7B" stroke={INK} strokeWidth={4} />
            <circle cx={0} cy={60} r={14} fill="#F2AE7B" stroke={INK} strokeWidth={4} />
          </g>
        </g>

        {/* Neck & Articulated Head */}
        <g transform={`translate(4, -188) rotate(${p.headTiltDeg})`}>
          <rect x={-14} y={-10} width={28} height={28} rx={8} fill="#E8A06E" stroke={INK} strokeWidth={4} />
          <ellipse cx={4} cy={-54} rx={48} ry={52} fill="#F4B281" stroke={INK} strokeWidth={4.5} />
          {/* Ear */}
          <circle cx={-38} cy={-50} r={13} fill="#E8A06E" stroke={INK} strokeWidth={4} />
          {/* Curly Dark Roman Hair */}
          <path
            d="M -42 -68 Q -48 -108 -8 -108 Q 28 -115 50 -86 Q 30 -92 10 -86 Q -18 -92 -34 -64 Z"
            fill="#3A2316"
            stroke={INK}
            strokeWidth={4}
          />
          {/* Courier Headband & Winged Crest */}
          <path d="M -44 -76 Q 4 -86 50 -74" fill="none" stroke="#C42B2B" strokeWidth={10} />
          <path
            d={`M -44 -76 Q ${-76 - windStrength * 14} ${-86 + Math.sin(frame * 0.45) * 14} -95 -64`}
            fill="none"
            stroke="#C42B2B"
            strokeWidth={7}
            strokeLinecap="round"
          />
          {/* Small Courier Wing Emblem on Temple */}
          <path
            d="M -10 -78 Q -32 -104 -48 -96 Q -34 -80 -14 -74 Z"
            fill="#F9D26A"
            stroke={INK}
            strokeWidth={3}
          />

          {/* Eyes & Brows by Expression */}
          {blink ? (
            <g>
              <line x1={4} y1={-56} x2={24} y2={-56} stroke={INK} strokeWidth={4} strokeLinecap="round" />
              <line x1={30} y1={-56} x2={46} y2={-56} stroke={INK} strokeWidth={4} strokeLinecap="round" />
            </g>
          ) : (
            <g>
              <ellipse
                cx={15}
                cy={-56}
                rx={10}
                ry={expression === "shocked" ? 14 : 11}
                fill="#FFFFFF"
                stroke={INK}
                strokeWidth={3.5}
              />
              <ellipse
                cx={38}
                cy={-56}
                rx={9}
                ry={expression === "shocked" ? 13 : 10}
                fill="#FFFFFF"
                stroke={INK}
                strokeWidth={3.5}
              />
              <circle
                cx={expression === "deadpan_shrug" ? 13 : 18}
                cy={expression === "shocked" ? -58 : -55}
                r={5}
                fill={INK}
              />
              <circle
                cx={expression === "deadpan_shrug" ? 36 : 41}
                cy={expression === "shocked" ? -58 : -55}
                r={4.5}
                fill={INK}
              />
            </g>
          )}

          {/* Expressive Eyebrows */}
          {expression === "shocked" ? (
            <g>
              <path d="M 2 -76 Q 15 -88 26 -76" fill="none" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
              <path d="M 29 -76 Q 39 -88 49 -75" fill="none" stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
            </g>
          ) : expression === "deadpan_shrug" ? (
            <g>
              <line x1={3} y1={-68} x2={25} y2={-67} stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
              <line x1={30} y1={-70} x2={48} y2={-73} stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
            </g>
          ) : (
            <g>
              <line x1={3} y1={-73} x2={25} y2={-67} stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
              <line x1={29} y1={-67} x2={48} y2={-72} stroke={INK} strokeWidth={4.5} strokeLinecap="round" />
            </g>
          )}

          {/* Roman Nose */}
          <path d="M 28 -55 L 42 -40 L 27 -37" fill="#E8A06E" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />

          {/* Expressive Mouth */}
          {expression === "shocked" || expression === "breathless" ? (
            <ellipse cx={22} cy={-23} rx={11} ry={13} fill="#5C1D1D" stroke={INK} strokeWidth={3.5} />
          ) : expression === "deadpan_shrug" ? (
            <path d="M 10 -24 Q 24 -20 36 -27" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          ) : (
            <path d="M 12 -24 Q 24 -16 36 -24" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
          )}

          {/* Comic Sweat Drop when straining / breathless */}
          {(expression === "shocked" || expression === "breathless" || expression === "running") && (
            <path
              d={`M -22 ${-82 + ((frame * 2) % 18)} Q -30 ${-68 + ((frame * 2) % 18)} -22 ${-64 + ((frame * 2) % 18)} Q -14 ${-68 + ((frame * 2) % 18)} -22 ${-82 + ((frame * 2) % 18)} Z`}
              fill="#7ED6FF"
              stroke={INK}
              strokeWidth={2.5}
            />
          )}
        </g>
      </g>
    </g>
  );
};

export type GovernorExpression = "calm" | "catching" | "reading_eyebrow" | "windblown_deadpan";

export const GovernorCharacter: React.FC<{
  x: number;
  y: number;
  scale?: number;
  frame: number;
  expression?: GovernorExpression;
  armOpenProgress?: number;
}> = ({ x, y, scale = 1, frame, expression = "calm", armOpenProgress = 0 }) => {
  const breathe = Math.sin(frame * 0.16) * 4;
  const togaWave = Math.sin(frame * 0.28) * 14;
  const blink = (frame + 25) % 80 >= 76;

  return (
    <g transform={`translate(${x}, ${y + breathe}) scale(${scale})`}>
      <ellipse cx={0} cy={150 - breathe} rx={82} ry={20} fill="#4A3826" opacity={0.42} />

      {/* Toga Praetexta Body & Purple Senatorial Border */}
      <path
        d={`M -54 -185 L 54 -185 L ${68 + togaWave * 0.5} 135 L ${-64 + togaWave * 0.3} 135 Z`}
        fill="#FAF3E3"
        stroke={INK}
        strokeWidth={4.5}
      />
      <path
        d={`M -50 -165 Q 15 -90 ${58 + togaWave * 0.6} -20 L ${64 + togaWave * 0.7} 75 Q -10 25 -56 -55 Z`}
        fill="#EFE3CA"
        stroke={INK}
        strokeWidth={4}
      />
      <path
        d={`M -50 -150 Q 15 -75 ${60 + togaWave * 0.6} -5`}
        fill="none"
        stroke="#6C2346"
        strokeWidth={16}
      />

      {/* Left Arm (Outstretched to catch / unroll scroll) */}
      <g transform={`translate(-46, -152) rotate(${lerp(28, 52, armOpenProgress)})`}>
        <rect x={-16} y={0} width={32} height={76} rx={14} fill="#F0B080" stroke={INK} strokeWidth={4} />
        <circle cx={0} cy={82} r={16} fill="#F0B080" stroke={INK} strokeWidth={4} />
      </g>

      {/* Right Arm */}
      <g transform={`translate(46, -152) rotate(${lerp(-22, -48, armOpenProgress)})`}>
        <rect x={-16} y={0} width={32} height={76} rx={14} fill="#F0B080" stroke={INK} strokeWidth={4} />
        <circle cx={0} cy={82} r={16} fill="#F0B080" stroke={INK} strokeWidth={4} />
      </g>

      {/* Dignified Head with Golden Laurel Wreath */}
      <g transform={`translate(0, -198) rotate(${Math.sin(frame * 0.14) * 2})`}>
        <ellipse cx={0} cy={-56} rx={50} ry={56} fill="#F2B282" stroke={INK} strokeWidth={4.5} />
        {/* Silver-Grey Senator Hair & Beard */}
        <path
          d="M -42 -82 Q 0 -118 46 -82 Q 52 -56 44 -42 Q 32 -78 0 -82 Q -32 -78 -44 -42 Z"
          fill="#D7D2C8"
          stroke={INK}
          strokeWidth={3.5}
        />
        {/* Golden Laurel Wreath */}
        <path d="M -48 -72 Q -6 -104 48 -72" fill="none" stroke="#E5A93B" strokeWidth={10} strokeLinecap="round" />
        {[-36, -18, 0, 18, 36].map((lx) => (
          <ellipse
            key={lx}
            cx={lx}
            cy={-84 - Math.abs(lx) * 0.1}
            rx={11}
            ry={6}
            transform={`rotate(${lx * 0.8}, ${lx}, -84)`}
            fill="#F4C44E"
            stroke={INK}
            strokeWidth={2.5}
          />
        ))}

        {/* Eyes */}
        {blink ? (
          <g>
            <line x1={-34} y1={-56} x2={-12} y2={-56} stroke={INK} strokeWidth={4} strokeLinecap="round" />
            <line x1={6} y1={-56} x2={28} y2={-56} stroke={INK} strokeWidth={4} strokeLinecap="round" />
          </g>
        ) : (
          <g>
            <ellipse cx={-22} cy={-56} rx={10} ry={10} fill="#FFFFFF" stroke={INK} strokeWidth={3.5} />
            <ellipse cx={16} cy={-56} rx={10} ry={10} fill="#FFFFFF" stroke={INK} strokeWidth={3.5} />
            <circle cx={-24} cy={-55} r={4.5} fill={INK} />
            <circle cx={14} cy={-55} r={4.5} fill={INK} />
          </g>
        )}

        {/* Senatorial Eyebrows */}
        <line
          x1={-35}
          y1={expression === "reading_eyebrow" ? -78 : -70}
          x2={-10}
          y2={expression === "reading_eyebrow" ? -72 : -68}
          stroke={INK}
          strokeWidth={5}
          strokeLinecap="round"
        />
        <line x1={6} y1={-68} x2={30} y2={-71} stroke={INK} strokeWidth={5} strokeLinecap="round" />

        {/* Nose & Mustache/Mouth */}
        <path d="M -6 -55 L -16 -38 L -2 -36" fill="#E4A070" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path
          d={
            expression === "windblown_deadpan"
              ? "M -20 -20 L 14 -20"
              : "M -20 -22 Q -3 -16 14 -22"
          }
          fill="none"
          stroke={INK}
          strokeWidth={4}
          strokeLinecap="round"
        />
      </g>
    </g>
  );
};

export const PapyrusScroll: React.FC<{ pose: ScrollPose }> = ({ pose }) => {
  const { x, y, rotateDeg, scale, unrollProgress, ribbonFlutter } = pose;

  if (unrollProgress < 0.08) {
    // Rolled & Wax-Sealed Scroll
    return (
      <g transform={`translate(${x}, ${y}) rotate(${rotateDeg}) scale(${scale})`}>
        {/* Fluttering Crimson Ribbons */}
        <path
          d={`M 0 12 Q ${-45 + ribbonFlutter} ${55 + ribbonFlutter * 0.5} ${-85 + ribbonFlutter * 1.2} 72`}
          fill="none"
          stroke="#C42B2B"
          strokeWidth={9}
          strokeLinecap="round"
        />
        <path
          d={`M 6 12 Q ${35 + ribbonFlutter * 0.8} ${62 - ribbonFlutter * 0.4} ${68 + ribbonFlutter} 86`}
          fill="none"
          stroke="#9E1F1F"
          strokeWidth={8}
          strokeLinecap="round"
        />

        {/* Wooden Scroll Finials */}
        <rect x={-118} y={-24} width={236} height={48} rx={12} fill="#8B5A2B" stroke={INK} strokeWidth={4} />
        {/* Rolled Papyrus Cylinder */}
        <rect x={-96} y={-32} width={192} height={64} rx={26} fill="url(#papyrus-grad)" stroke={INK} strokeWidth={4.5} />
        <ellipse cx={-92} cy={0} rx={12} ry={28} fill="#DFC07D" stroke={INK} strokeWidth={3.5} />
        <ellipse cx={92} cy={0} rx={12} ry={28} fill="#DFC07D" stroke={INK} strokeWidth={3.5} />

        {/* Crimson Wrap Band & Gold-Trimmed Wax Seal */}
        <rect x={-18} y={-33} width={36} height={66} fill="#C42B2B" stroke={INK} strokeWidth={3.5} />
        <circle cx={0} cy={4} r={26} fill="#B82020" stroke={INK} strokeWidth={4} />
        <circle cx={0} cy={4} r={18} fill="#E6AD3E" stroke={INK} strokeWidth={3} />
        <text
          x={0}
          y={10}
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontWeight="bold"
          fontSize={16}
          fill={INK}
        >
          S
        </text>
      </g>
    );
  }

  // Unrolling / Open Scroll Reveal ("WATCH OUT FOR WIND")
  const halfW = lerp(95, 345, unrollProgress);
  const halfH = lerp(45, 185, unrollProgress);

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotateDeg}) scale(${scale})`}>
      {/* Drop Shadow */}
      <rect
        x={-halfW + 10}
        y={-halfH + 14}
        width={halfW * 2}
        height={halfH * 2}
        rx={16}
        fill="#2A1D12"
        opacity={0.32}
      />

      {/* Open Papyrus Sheet */}
      <rect
        x={-halfW}
        y={-halfH}
        width={halfW * 2}
        height={halfH * 2}
        rx={12}
        fill="url(#papyrus-grad)"
        stroke={INK}
        strokeWidth={5}
      />

      {/* Left & Right Rolled Wooden Handles */}
      <rect
        x={-halfW - 22}
        y={-halfH - 14}
        width={28}
        height={halfH * 2 + 28}
        rx={12}
        fill="#8B5A2B"
        stroke={INK}
        strokeWidth={4.5}
      />
      <rect
        x={halfW - 6}
        y={-halfH - 14}
        width={28}
        height={halfH * 2 + 28}
        rx={12}
        fill="#8B5A2B"
        stroke={INK}
        strokeWidth={4.5}
      />

      {/* Broken Wax Seal Emblem at Bottom Edge */}
      <circle cx={0} cy={halfH - 6} r={26} fill="#C42B2B" stroke={INK} strokeWidth={4} />
      <circle cx={0} cy={halfH - 6} r={16} fill="#E6AD3E" stroke={INK} strokeWidth={3} />

      {/* Readable English Message inside Safe Area */}
      {unrollProgress > 0.45 && (
        <g opacity={smootherstep(invLerp(0.45, 0.85, unrollProgress))}>
          <text
            x={0}
            y={-halfH + 54}
            textAnchor="middle"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontWeight="bold"
            fontSize={22}
            fill="#7A3E1D"
            letterSpacing={3}
          >
            OFFICIAL SENATE DISPATCH
          </text>
          <line x1={-halfW + 55} y1={-halfH + 72} x2={halfW - 55} y2={-halfH + 72} stroke="#A67942" strokeWidth={3} />
          <text
            x={0}
            y={-12}
            textAnchor="middle"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontWeight="900"
            fontSize={52}
            fill="#1E1510"
            letterSpacing={2}
          >
            WATCH OUT
          </text>
          <text
            x={0}
            y={54}
            textAnchor="middle"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontWeight="900"
            fontSize={56}
            fill="#B82020"
            letterSpacing={3}
          >
            FOR WIND
          </text>
        </g>
      )}
    </g>
  );
};

export const WindGustOverlay: React.FC<{
  frame: number;
  particles: WindParticle[];
  intensity?: number;
}> = ({ frame, particles, intensity = 1 }) => {
  const shift1 = (frame * 34) % 1400;
  const shift2 = (frame * 28 + 480) % 1400;
  const waveY = Math.sin(frame * 0.25) * 26;

  return (
    <g pointerEvents="none">
      {/* Swirling Wind Stream Ribbons */}
      <g opacity={0.55 * intensity}>
        <path
          d={`M ${-320 + shift1} ${540 + waveY} C ${-120 + shift1} ${460 + waveY}, ${140 + shift1} ${620 + waveY}, ${380 + shift1} ${510 + waveY}`}
          fill="none"
          stroke="#FFF9E6"
          strokeWidth={9}
          strokeLinecap="round"
        />
        <path
          d={`M ${-260 + shift2} ${890 - waveY} C ${-40 + shift2} ${810 - waveY}, ${190 + shift2} ${960 - waveY}, ${430 + shift2} ${850 - waveY}`}
          fill="none"
          stroke="#E4F6FF"
          strokeWidth={7}
          strokeLinecap="round"
        />
      </g>

      {/* Windblown Olive Leaves & Golden Petals */}
      {particles.map((p) => {
        const fill = p.hue === "olive" ? "#4F7D47" : p.hue === "gold" ? "#F1C252" : "#E87A5D";
        return (
          <g key={p.id} transform={`translate(${p.x}, ${p.y}) rotate(${p.rotateDeg}) scale(${p.scale})`}>
            <path d="M -16 0 Q 0 -10 16 0 Q 0 10 -16 0 Z" fill={fill} stroke={INK} strokeWidth={2.5} />
          </g>
        );
      })}
    </g>
  );
};

export const StoryCaptionCard: React.FC<{
  shotNumber: number;
  shotKey: string;
  caption: string;
  opacity: number;
  showTitleBadge?: boolean;
}> = ({ shotNumber, shotKey, caption, opacity, showTitleBadge = false }) => {
  return (
    <g>
      {/* Top Safe-Area Title & Fictional Comedy Badge */}
      {showTitleBadge && (
        <g transform="translate(540, 128)" opacity={opacity}>
          <rect
            x={-420}
            y={-44}
            width={840}
            height={112}
            rx={22}
            fill="#141F30"
            fillOpacity={0.9}
            stroke="#E8B14A"
            strokeWidth={3.5}
          />
          <text
            x={0}
            y={-4}
            textAnchor="middle"
            fontFamily="Georgia, 'Times New Roman', serif"
            fontWeight="bold"
            fontSize={31}
            fill="#FFF6E0"
          >
            The Roman Messenger Who Lost His Scroll
          </text>
          <text
            x={0}
            y={38}
            textAnchor="middle"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontWeight="700"
            fontSize={20}
            fill="#E8B14A"
            letterSpacing={2}
          >
            ORIGINAL FICTIONAL COMEDY · NOT HISTORICAL FACT
          </text>
        </g>
      )}

      {/* Lower Safe-Area Narrative Caption Card */}
      <g transform="translate(540, 1650)" opacity={opacity}>
        <rect
          x={-470}
          y={-78}
          width={940}
          height={156}
          rx={24}
          fill="#111C2D"
          fillOpacity={0.93}
          stroke="#E8B14A"
          strokeWidth={4}
        />
        <rect x={-440} y={-56} width={255} height={36} rx={10} fill="#E8B14A" />
        <text
          x={-312}
          y={-31}
          textAnchor="middle"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontWeight="800"
          fontSize={18}
          fill="#111C2D"
          letterSpacing={1.4}
        >
          {`BEAT 0${shotNumber} · ${shotKey}`}
        </text>
        <text
          x={0}
          y={26}
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontWeight="bold"
          fontSize={24}
          fill="#FFF8EA"
        >
          {caption}
        </text>
      </g>
    </g>
  );
};
