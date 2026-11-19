import React from "react";
import { Composition } from "remotion";
import { BridgeShort, BRIDGE_FRAMES } from "./videos/cowboy/Bridge";
import { Demo15Short, DEMO15_FRAMES } from "./videos/demo15/Demo15";

export const Root: React.FC = () => (
  <>
    <Composition id="CowboyShort" component={BridgeShort} durationInFrames={BRIDGE_FRAMES} fps={30} width={1080} height={1920} />
    <Composition id="OOSDemo15" component={Demo15Short} durationInFrames={DEMO15_FRAMES} fps={30} width={1080} height={1920} />
  </>
);
