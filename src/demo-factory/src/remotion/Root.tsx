import React from 'react';
import {Composition} from 'remotion';
import {DEMO_COMPOSITION, defaultDemoProps, demoDurationInFrames} from './composition';
import {DemoVideo} from './DemoVideo';

export const RemotionRoot: React.FC = () => (
  <Composition
    id={DEMO_COMPOSITION.id}
    component={DemoVideo}
    width={DEMO_COMPOSITION.width}
    height={DEMO_COMPOSITION.height}
    fps={DEMO_COMPOSITION.fps}
    durationInFrames={30}
    defaultProps={defaultDemoProps}
    calculateMetadata={({props}) => ({
      fps: props.fps,
      durationInFrames: demoDurationInFrames(props),
    })}
  />
);
