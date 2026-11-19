import React from "react";
import { AbsoluteFill, Composition, registerRoot } from "remotion";
import { ThreeCanvas } from "@remotion/three";
const Scene: React.FC = () => (
  <AbsoluteFill style={{ background: "#ff0000" }}>
    <ThreeCanvas width={1080} height={1920} camera={{ fov: 40, near: 0.2, far: 100, position: [0, 0, 8] }}>
      <ambientLight intensity={1} />
      <mesh>
        <boxGeometry args={[2, 2, 2]} />
        <meshBasicMaterial color="#00ff00" />
      </mesh>
    </ThreeCanvas>
  </AbsoluteFill>
);
const Root: React.FC = () => <Composition id="DebugCube" component={Scene} durationInFrames={30} fps={30} width={1080} height={1920} />;
registerRoot(Root);
