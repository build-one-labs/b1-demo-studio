import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {Caption, DemoScene, DemoVideoProps, Timelapse} from './types';

const msToFrames = (milliseconds: number, fps: number) => Math.max(1, Math.round((milliseconds / 1000) * fps));

/**
 * The clip cut into playback segments: real time outside the timelapses, and
 * each timelapse squeezed into its narration budget. Output times are
 * scene-local; clip times seek into the source video.
 */
type PlaybackSegment = {outFromMs: number; durationMs: number; clipFromMs: number; rate: number};

const playbackSegments = (scene: DemoScene): PlaybackSegment[] => {
  const clipEndMs = scene.recordedDurationMs;
  const timelapses = [...(scene.timelapses ?? [])].sort((a, b) => a.fromMs - b.fromMs);
  const segments: PlaybackSegment[] = [];
  let clipMs = 0;
  let outMs = 0;
  const push = (durationMs: number, clipFromMs: number, rate: number) => {
    if (durationMs <= 0) return;
    segments.push({outFromMs: outMs, durationMs, clipFromMs, rate});
    outMs += durationMs;
  };
  for (const lapse of timelapses) {
    push(lapse.fromMs - clipMs, clipMs, 1);
    push(lapse.targetMs, lapse.fromMs, (lapse.toMs - lapse.fromMs) / lapse.targetMs);
    clipMs = lapse.toMs;
  }
  push(clipEndMs - clipMs, clipMs, 1);
  return segments;
};

const CaptionOverlay: React.FC<{captions: Caption[]; offsetMs: number}> = ({captions, offsetMs}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const timeMs = (frame / fps) * 1000 - offsetMs;
  const active = captions.find((caption) => timeMs >= caption.startMs && timeMs <= caption.endMs);
  if (!active) return null;
  return (
    <div style={{
      position: 'absolute',
      left: '11%',
      right: '11%',
      bottom: 52,
      display: 'flex',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(7, 12, 28, 0.88)',
        color: '#fff',
        borderRadius: 14,
        padding: '14px 24px',
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: 34,
        fontWeight: 650,
        lineHeight: 1.2,
        textAlign: 'center',
        boxShadow: '0 12px 38px rgba(0,0,0,.32)',
      }}>{active.text}</div>
    </div>
  );
};

const SceneTitle: React.FC<{scene: DemoScene; props: DemoVideoProps}> = ({scene, props}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const revealAt = Math.max(18, msToFrames(scene.narrationOffsetMs, fps));
  const opacity = interpolate(frame, [0, 10, revealAt, revealAt + 12], [1, 1, 1, 0], {extrapolateRight: 'clamp'});
  const translate = interpolate(frame, [0, 14], [16, 0], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill style={{
      background: props.branding.backgroundColor,
      color: props.branding.textColor,
      justifyContent: 'center',
      alignItems: 'center',
      opacity,
      zIndex: 5,
    }}>
      <div style={{transform: `translateY(${translate}px)`, textAlign: 'center', maxWidth: 1450}}>
        <div style={{fontFamily: 'Inter, Arial, sans-serif', fontSize: 28, fontWeight: 700, color: props.branding.accentColor, marginBottom: 22}}>
          {props.branding.productName}
        </div>
        <div style={{fontFamily: 'Inter, Arial, sans-serif', fontSize: 66, lineHeight: 1.08, fontWeight: 760}}>
          {scene.title}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const FastForwardBadge: React.FC<{accentColor: string; rate: number}> = ({accentColor, rate}) => (
  <div style={{
    position: 'absolute',
    left: 28,
    bottom: 130,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 16px',
    borderRadius: 10,
    background: 'rgba(11, 16, 32, .78)',
    color: '#fff',
    font: '700 21px Inter, Arial, sans-serif',
    letterSpacing: '.02em',
  }}>
    <span style={{color: accentColor}}>▶▶</span>
    <span>{`${Math.max(2, Math.round(rate))}× — working live`}</span>
  </div>
);

const Scene: React.FC<{scene: DemoScene; props: DemoVideoProps}> = ({scene, props}) => {
  const {fps} = useVideoConfig();
  const narrationFrame = msToFrames(scene.narrationOffsetMs, fps);
  const segments = playbackSegments(scene);
  return (
    <AbsoluteFill style={{background: props.branding.backgroundColor}}>
      {segments.map((segment) => (
        <Sequence
          key={`${scene.id}-${segment.outFromMs}`}
          from={Math.round((segment.outFromMs / 1000) * fps)}
          durationInFrames={msToFrames(segment.durationMs, fps)}
          name={segment.rate > 1 ? `${scene.id} ×${segment.rate.toFixed(1)}` : undefined}
        >
          <OffthreadVideo
            src={staticFile(scene.clipAsset)}
            muted
            startFrom={Math.round((segment.clipFromMs / 1000) * fps)}
            playbackRate={segment.rate}
          />
          {segment.rate > 1 ? <FastForwardBadge accentColor={props.branding.accentColor} rate={segment.rate} /> : null}
        </Sequence>
      ))}
      <Sequence from={narrationFrame}>
        <Audio src={staticFile(scene.narrationAsset)} />
      </Sequence>
      {props.branding.showCaptions ? <CaptionOverlay captions={scene.captions} offsetMs={scene.narrationOffsetMs} /> : null}
      {props.branding.showSceneTitles ? <SceneTitle scene={scene} props={props} /> : null}
      <div style={{
        position: 'absolute',
        right: 28,
        top: 88,
        padding: '8px 13px',
        borderRadius: 10,
        background: 'rgba(11, 16, 32, .72)',
        color: '#fff',
        font: '700 19px Inter, Arial, sans-serif',
        letterSpacing: '.02em',
      }}>{props.branding.productName}</div>
    </AbsoluteFill>
  );
};

export const DemoVideo: React.FC<DemoVideoProps> = (props) => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{background: props.branding.backgroundColor}}>
      {props.scenes.map((scene) => {
        const duration = msToFrames(scene.effectiveDurationMs ?? scene.recordedDurationMs, props.fps);
        const from = cursor;
        cursor += duration;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} name={scene.title}>
            <Scene scene={scene} props={props} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
