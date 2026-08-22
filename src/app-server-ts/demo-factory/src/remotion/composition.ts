import type {DemoVideoProps} from './types';

/**
 * Composition identity and timing, shared by the Remotion entry point
 * (Root.tsx, used by the renderer) and by the B1 web app's native component
 * (DemoFactoryRoot.client.vue), which drives the same DemoVideo through
 * @remotion/player. Both must agree on id, size and duration, so they read it
 * from here rather than each carrying its own copy.
 */
export const DEMO_COMPOSITION = {
  id: 'B1Demo',
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

/**
 * Total frames = the sum of every scene's playback duration, at the run's fps.
 * A scene with timelapses plays shorter than it recorded; effectiveDurationMs
 * carries that, and older manifests without it fall back to the recorded one.
 */
export const demoDurationInFrames = (props: DemoVideoProps): number =>
  Math.max(
    1,
    props.scenes.reduce(
      (sum, scene) =>
        sum + Math.max(1, Math.round(((scene.effectiveDurationMs ?? scene.recordedDurationMs) / 1000) * props.fps)),
      0
    )
  );

export const defaultDemoProps: DemoVideoProps = {
  title: 'B1 Demo',
  fps: DEMO_COMPOSITION.fps,
  branding: {
    productName: 'Build.One',
    accentColor: '#6d5dfc',
    backgroundColor: '#0b1020',
    textColor: '#f7f8ff',
    showCaptions: true,
    showSceneTitles: true,
  },
  scenes: [],
};
