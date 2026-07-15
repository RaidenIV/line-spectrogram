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

    amplitudeMode: "adaptive",
    inputGain: 1,
    noiseFloor: 0.025,
    dynamicRange: 60,
    colorMode: "single",
    depthOpacity: 0.7,
    depthBrightness: 0.62,
    depthHeightDecay: 0,
    depthFog: 0.24,
    rowSpacing: 1,
    historyDepth: 142,
    depthCurve: 1,
    renderMode: "ribbons",
    transientHighlight: false,
    transientSensitivity: 1.35,
    transientIntensity: 0.35,
    transientDecay: 4.2,

    cameraDistance: 190,
    cameraHeight: 68,
    cameraDrift: 0.45,
    autoCamera: false,
    cameraFollowSource: "spectralCentroid",
    cameraPreset: "elevated",
    cameraMotion: "static",
    cameraMotionSpeed: 0.12,
    showGrid: false,

    showFps: false,
    showAnalysisReadout: true,
    viewportFormat: "responsive",
    showHud: false,
    hudSpectrum: true,
    hudWaveform: true,
    hudLevels: true,
    hudFrame: true,
    hudFrequencyLabels: true,
    hudOpacity: 0.9,
    hudScale: 1,
    safeAreaMode: "off",
    safeAreaAffectsHud: false,

    qualityPreset: "balanced",
    volume: 1,
    muted: false,
    audioLoop: false,
    loopStart: 0,
    loopEnd: 0,
    loopBpm: 125,
    loopBars: 4,
    loopSnap: true,

    outputPreset: "custom",
    exportFileName: "waterfall-spectrogram",
    exportResolution: "4k",
    videoFormat: "mp4",
    videoFps: 60,
    videoBitrate: 24,
    exportMode: "realtime",
    exportRange: "full",
    exportStart: 0,
    exportEnd: 0,
  });

  const CONTROL_DEFINITIONS = Object.freeze({
    heightScale: { parser: Number, format: (value) => String(Math.round(value)), rebuild: false },
    historyLines: { parser: Number, format: (value) => String(Math.round(value)), rebuild: true },
    frequencyBins: { parser: Number, format: (value) => String(Math.round(value)), rebuild: true },
    smoothing: { parser: Number, format: (value) => Number(value).toFixed(2), rebuild: false },
    scrollSpeed: { parser: Number, format: (value) => `${Math.round(value)} FPS`, rebuild: false },
    lineWidth: { parser: Number, format: (value) => Number(value).toFixed(2), rebuild: false },
    lineOpacity: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    inputGain: { parser: Number, format: (value) => `${Number(value).toFixed(2)}×`, rebuild: false },
    noiseFloor: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    dynamicRange: { parser: Number, format: (value) => `${Math.round(value)} dB`, rebuild: false },
    depthOpacity: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    depthBrightness: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    depthHeightDecay: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    depthFog: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    rowSpacing: { parser: Number, format: (value) => `${Number(value).toFixed(2)}×`, rebuild: false },
    historyDepth: { parser: Number, format: (value) => String(Math.round(value)), rebuild: false },
    depthCurve: { parser: Number, format: (value) => Number(value).toFixed(2), rebuild: false },
    transientSensitivity: { parser: Number, format: (value) => `${Number(value).toFixed(2)}×`, rebuild: false },
    transientIntensity: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    transientDecay: { parser: Number, format: (value) => Number(value).toFixed(1), rebuild: false },
    cameraDistance: { parser: Number, format: (value) => String(Math.round(value)), rebuild: false },
    cameraHeight: { parser: Number, format: (value) => String(Math.round(value)), rebuild: false },
    cameraDrift: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    cameraMotionSpeed: { parser: Number, format: (value) => Number(value).toFixed(2), rebuild: false },
    hudOpacity: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
    hudScale: { parser: Number, format: (value) => `${Math.round(value * 100)}%`, rebuild: false },
  });

  const CAMERA_PRESETS = Object.freeze({
    front: { position: [0, 40, 122], target: [0, 10, -46] },
    elevated: { position: [0, 68, 108], target: [0, 8, -44] },
    lowHorizon: { position: [0, 24, 126], target: [0, 7, -58] },
    isometric: { position: [112, 82, 84], target: [0, 8, -48] },
    side: { position: [160, 48, -42], target: [0, 8, -55] },
    top: { position: [0, 220, -42], target: [0, 0, -60] },
    cinematic: { position: [-78, 58, 114], target: [0, 12, -56] },
  });

  const QUALITY_PRESETS = Object.freeze({
    performance: { historyLines: 80, frequencyBins: 56, pixelRatio: 1, hudFps: 20 },
    balanced: { historyLines: 160, frequencyBins: 96, pixelRatio: 1.5, hudFps: 30 },
    high: { historyLines: 208, frequencyBins: 144, pixelRatio: 2, hudFps: 45 },
    maximum: { historyLines: 260, frequencyBins: 192, pixelRatio: 2.5, hudFps: 60 },
  });

  const OUTPUT_PRESETS = Object.freeze({
    youtube4k: { viewportFormat: "landscape", exportResolution: "4k", videoFps: 60, videoBitrate: 24, safeAreaMode: "title", hudScale: 1 },
    youtube1080: { viewportFormat: "landscape", exportResolution: "1080", videoFps: 60, videoBitrate: 16, safeAreaMode: "title", hudScale: 1 },
    instagramReel: { viewportFormat: "portrait", exportResolution: "1080", videoFps: 30, videoBitrate: 10, safeAreaMode: "social", hudScale: 1.12 },
    tiktok: { viewportFormat: "portrait", exportResolution: "1080", videoFps: 30, videoBitrate: 10, safeAreaMode: "social", hudScale: 1.12 },
    squarePost: { viewportFormat: "square", exportResolution: "1080", videoFps: 30, videoBitrate: 10, safeAreaMode: "90", hudScale: 1.05 },
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
    MAX_UNDO_STATES: 60,
    SETTINGS_VERSION: 3,
  });

  App.config = {
    DEFAULTS,
    CONTROL_DEFINITIONS,
    CAMERA_PRESETS,
    QUALITY_PRESETS,
    OUTPUT_PRESETS,
    CONSTANTS,
  };
})();
