export type Caption = {text: string; startMs: number; endMs: number};

export type DemoScene = {
  id: string;
  title: string;
  clipAsset: string;
  narrationAsset: string;
  narrationOffsetMs: number;
  recordedDurationMs: number;
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

