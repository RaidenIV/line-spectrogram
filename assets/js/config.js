(function () {
  "use strict";

  const App = window.SpectrogramApp = window.SpectrogramApp || {};

  const DEFAULTS = Object.freeze({
    heightScale: 42,
    historyLines: 160,
    frequencyBins: 96,
    fftSize: 2048,
    smoothing: 0.78,
    scrollSpeed: 30,
    lineWidth: 0.28,
    lineOpacity: 0.72,
    lineColor: "#ff2a1a",
    logFrequency: true,
    mirrorFrequency: false,
    beatPulse: false,
    cameraDistance: 190,
    cameraHeight: 68,
    cameraDrift: 0.45,
    autoCamera: false,
    showGrid: false,
    showFps: false,
    showAnalysisReadout: true,
    viewportFormat: "responsive",
    showHud: false,
    hudSpectrum: true,
    hudWaveform: true,
    hudLevels: true,
    hudFrame: true,
    volume: 1,
    muted: false,
    audioLoop: false,
    loopStart: 0,
    loopEnd: 0,
    loopBpm: 125,
    loopBars: 4,
    loopSnap: true,
    exportFileName: "waterfall-spectrogram",
    exportResolution: "4k",
    videoFormat: "mp4",
    videoFps: 60,
    videoBitrate: 24,
  });

  const CONTROL_DEFINITIONS = Object.freeze({
    heightScale: { parser: Number, format: (value) => String(Math.round(value)), rebuild: false },
    historyLines: { parser: Number, format: (value) => String(Math.round(value)), rebuild: true },
    frequencyBins: { parser: Number, format: (value) => String(Math.round(value)), rebuild: true },
    smoothing: { parser: Number, format: (value) => Number(value).toFixed(2), rebuild: false },
    scrollSpeed: { parser: Number, format: (value) => `${Math.round(value)} FPS`, rebuild: false },
    lineWidth: { parser: Number, format: (value) => Number(value).toFixed(2), rebuild: false },
    lineOpacity: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    cameraDistance: { parser: Number, format: (value) => String(Math.round(value)), rebuild: false },
    cameraHeight: { parser: Number, format: (value) => String(Math.round(value)), rebuild: false },
    cameraDrift: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
  });

  const CONSTANTS = Object.freeze({
    SPECTROGRAM_DEPTH: 142,
    SPECTROGRAM_WIDTH: 118,
    SPECTROGRAM_GROUP_Z: -5,
    MAX_FRAME_DELTA: 0.05,
    SCALE_LERP_FACTOR: 0.18,
    BASELINE_VIEWPORT_ASPECT: 16 / 9,
    BASELINE_CAMERA_VERTICAL_FOV: 47,
    HUD_FONT: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
  });

  App.config = { DEFAULTS, CONTROL_DEFINITIONS, CONSTANTS };
})();
