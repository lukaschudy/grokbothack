import { Composition } from "remotion";
import { Demo, DURATION } from "./Composition";
import { FPS } from "./data";

export const RemotionRoot: React.FC = () => <Composition id="Demo" component={Demo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />;
