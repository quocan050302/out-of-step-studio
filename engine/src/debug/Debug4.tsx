import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Composition, registerRoot, continueRender, delayRender, useCurrentFrame } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import { World, loadKit } from "../videos/cowboy/world";
import { Kit } from "../videos/cowboy/build";
import { InkPass, noInkFallback } from "../videos/cowboy/ink";
import { GradeEffect, GRADES, GRADE_STRENGTH, gradeFor } from "../videos/cowboy/grade";
import { SHOTS } from "../videos/cowboy/story";

const Inner: React.FC<{ id: number; kit: Kit }> = ({ id, kit }) => {
  const f = useCurrentFrame();
  const { camera, scene, gl } = useThree();
  const world = useMemo(() => new World(kit), [kit]);
  const setup = useMemo(() => {
    const composer = new EffectComposer(gl, { multisampling: 0 });
    const ink = new InkPass(scene, camera as THREE.PerspectiveCamera);
    const grade = new GradeEffect(GRADES.day, GRADE_STRENGTH.day);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(ink);
    composer.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), grade));
    return { composer, ink, grade };
  }, [gl, scene, camera]);
  useEffect(() => () => { setup.composer.dispose(); }, [setup]);
  world.update(id, f, camera as THREE.PerspectiveCamera, scene);
  noInkFallback(world.root);
  gradeFor(setup.grade, SHOTS[id - 1].light);
  useFrame(() => { setup.composer.render(); }, 1);
  return <primitive object={world.root} dispose={null} />;
};
const Scene: React.FC = () => {
  const [kit, setKit] = useState<Kit | null>(null);
  const [handle] = useState(() => delayRender("kit4"));
  useEffect(() => { loadKit().then((k) => { setKit(k); continueRender(handle); }); }, [handle]);
  if (!kit) return <AbsoluteFill style={{ background: "#ff00ff" }} />;
  return (
    <AbsoluteFill style={{ background: "#cfe3f2" }}>
      <ThreeCanvas width={1080} height={1920} shadows gl={{ antialias: false, stencil: false, powerPreference: "high-performance", toneMappingExposure: 1.0 }} camera={{ fov: 40, near: 0.2, far: 1500 }}>
        <Inner id={2} kit={kit} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
const Root: React.FC = () => <Composition id="DebugWorld" component={Scene} durationInFrames={894} fps={30} width={1080} height={1920} />;
registerRoot(Root);
