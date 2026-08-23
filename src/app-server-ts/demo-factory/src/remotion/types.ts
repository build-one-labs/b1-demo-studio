export type Caption = {text: string; startMs: number; endMs: number};

/**
 * A stretch of the clip recorded in real time but played back compressed —
 * a live wait (an agent building, an analysis running) squeezed into the
 * narration's budget. Times are clip-relative milliseconds.
 */
export type Timelapse = {fromMs: number; toMs: number; targetMs: number};

export type DemoScene = {
  id: string;
  title: string;
  clipAsset: string;
  narrationAsset: string;
  narrationOffsetMs: number;
  recordedDurationMs: number;
  /** Playback length: recorded length minus what the timelapses compress away. */
  effectiveDurationMs?: number;
  timelapses?: Timelapse[];
  captions: Caption[];
};

export type DemoVideoProps = {
  title: string;
  fps: number;
  branding: {
    productName: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    showCaptions: boolean;
    showSceneTitles: boolean;
  };
  scenes: DemoScene[];
};

