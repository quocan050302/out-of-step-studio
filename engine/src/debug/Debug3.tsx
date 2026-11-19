import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Composition, registerRoot, continueRender, delayRender, useCurrentFrame, getInputProps } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EffectComposer } from "@react-three/postprocessing";
import { BlendFunction, BloomEffect, ToneMappingEffect, ToneMappingMode } from "postprocessing";
import { World, loadKit } from "../videos/cowboy/world";
import { Kit } from "../videos/cowboy/build";
import { InkPass, noInkFallback } from "../videos/cowboy/ink";
import { LensBlur, GrainEffect } from "../videos/cowboy/lensblur";
import { GradeEffect, GRADES, GRADE_STRENGTH, gradeFor } from "../videos/cowboy/grade";
import { SHOTS, dofAt } from "../videos/cowboy/story";

const makeBloom = () => {
  const b = new BloomEffect({ blendFunction: BlendFunction.ADD, intensity: 0.5, luminanceThreshold: 1.0, luminanceSmoothing: 0.2, mipmapBlur: true, levels: 6, radius: 0.6 });
  const mip = b.mipmapBlurPass;
  const setSize = mip.setSize.bind(mip);
  mip.setSize = (w: number, h: number) => setSize(Math.round((1920 * w) / Math.max(h, 1)), 1920);
  return b;
};
const fwd = new THREE.Vector3(), fpt = new THREE.Vector3();
const Inner: React.FC<{ id: number; kit: Kit }> = ({ id, kit }) => {
  const f = useCurrentFrame();
  const { camera, scene } = useThree();
  const world = useMemo(() => new World(kit), [kit]);
  const target = useMemo(() => new THREE.Vector3(), []);
  const mode = (getInputProps() as { mode?: string }).mode ?? "all";
  const fx = useMemo(() => ({
    ink: new InkPass(scene, camera as THREE.PerspectiveCamera),
    lens: new LensBlur({ maxCoC: 24, nearScale: 1.2 }),
    bloom: makeBloom(),
    tone: new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
    grade: new GradeEffect(GRADES.day, GRADE_STRENGTH.day),
    grain: new GrainEffect({ amount: 0.025, cellPx: 1.5 }),
  }), [camera, scene]);
  useEffect(() => () => fx.ink.dispose(), [fx]);
  const post = (
    <EffectComposer multisampling={mode === "nomsaa" || mode === "ubyte" ? 0 : 4} frameBufferType={mode === "ubyte" ? THREE.UnsignedByteType : THREE.HalfFloatType}>
      {mode === "all" || (mode === "nomsaa" || mode === "ubyte") || mode === "ink" ? <primitive object={fx.ink} dispose={null} /> : null}
      {mode === "all" || (mode === "nomsaa" || mode === "ubyte") ? <primitive object={fx.lens.pre} dispose={null} /> : null}
      {mode === "all" || (mode === "nomsaa" || mode === "ubyte") ? <primitive object={fx.lens.main} dispose={null} /> : null}
      {mode === "all" || (mode === "nomsaa" || mode === "ubyte") ? <primitive object={fx.bloom} dispose={null} /> : null}
      <primitive object={fx.tone} dispose={null} />
      {mode === "all" || (mode === "nomsaa" || mode === "ubyte") || mode === "grade" ? <primitive object={fx.grade} dispose={null} /> : null}
    </EffectComposer>
  );
  const cam = camera as THREE.PerspectiveCamera;
  target.copy(world.update(id, f, cam, scene));
  noInkFallback(world.root);
  const d = dofAt(f);
  cam.getWorldDirection(fwd);
  if (d.focus) fpt.set(...d.focus(f)); else fpt.copy(target);
  fx.lens.focus = Math.max(0.3, fpt.sub(cam.position).dot(fwd));
  fx.lens.cInf = d.cInf;
  gradeFor(fx.grade, SHOTS[id - 1].light);
  return (<><primitive object={world.root} dispose={null} />{post}</>);
};
const Scene: React.FC = () => {
  const [kit, setKit] = useState<Kit | null>(null);
  const [handle] = useState(() => delayRender("kit3"));
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
