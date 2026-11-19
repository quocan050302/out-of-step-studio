import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Composition, registerRoot, continueRender, delayRender, useCurrentFrame } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { World, loadKit } from "../videos/cowboy/world";
import { Kit } from "../videos/cowboy/build";

const Inner: React.FC<{ id: number; kit: Kit }> = ({ id, kit }) => {
  const f = useCurrentFrame();
  const { camera, scene } = useThree();
  const world = useMemo(() => new World(kit), [kit]);
  world.update(id, f, camera as THREE.PerspectiveCamera, scene);
  return <primitive object={world.root} dispose={null} />;
};
const Scene: React.FC = () => {
  const [kit, setKit] = useState<Kit | null>(null);
  const [handle] = useState(() => delayRender("kit2"));
  useEffect(() => { loadKit().then((k) => { console.log("KIT LOADED", Object.keys(k).length); setKit(k); continueRender(handle); }).catch((e) => { console.log("KIT ERROR", String(e)); continueRender(handle); }); }, [handle]);
  if (!kit) return <AbsoluteFill style={{ background: "#ff00ff" }} />;
  return (
    <AbsoluteFill style={{ background: "#cfe3f2" }}>
      <ThreeCanvas width={1080} height={1920} camera={{ fov: 40, near: 0.2, far: 1500 }}>
        <Inner id={2} kit={kit} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
const Root: React.FC = () => <Composition id="DebugWorld" component={Scene} durationInFrames={894} fps={30} width={1080} height={1920} />;
registerRoot(Root);
