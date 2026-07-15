(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { DEFAULTS } = App.config;
  const THREE = window.THREE;

  if (!THREE || !THREE.OrbitControls) {
    throw new Error("Three.js failed to initialize. Make sure the vendor files are present.");
  }

  const byId = (id) => document.getElementById(id);
  const elements = {
    appShell: byId("appShell"),
    canvas: byId("visualizer"),
    hudCanvas: byId("hudCanvas"),
    viewportLogo: byId("viewportLogo"),
    viewport: byId("viewport"),
    viewportFrame: byId("viewportFrame"),
    sidebar: byId("sidebar"),
    sidebarToggle: byId("sidebarToggle"),
    sidebarToggleIcon: byId("sidebarToggleIcon"),
    openSidebar: byId("openSidebar"),
    closeSidebar: byId("closeSidebar"),
    undoButton: byId("undoButton"),
    redoButton: byId("redoButton"),
    shortcutsButton: byId("shortcutsButton"),
    diagnosticsButton: byId("diagnosticsButton"),

    fileInput: byId("audioFile"),
    fileDrop: byId("fileDrop"),
    fileButtonText: byId("audioFileButtonText"),
    fileButtonCopy: byId("audioFileButtonCopy"),
    audioLoadProgress: byId("audioLoadProgress"),
    audioLoadProgressBar: byId("audioLoadProgressBar"),
    audioLoadProgressPercent: byId("audioLoadProgressPercent"),
    audioLoadStage: byId("audioLoadStage"),
    dropOverlay: byId("dropOverlay"),
    dropOverlayFile: byId("dropOverlayFile"),
    audio: byId("audio"),
    audioStatus: byId("audioStatus"),
    trackCard: byId("trackCard"),
    trackName: byId("trackName"),
    trackDetails: byId("trackDetails"),
    trackFormat: byId("trackFormat"),
    trackSize: byId("trackSize"),
    trackDuration: byId("trackDuration"),
    trackSampleRate: byId("trackSampleRate"),
    trackChannels: byId("trackChannels"),
    playButton: byId("playButton"),
    playIcon: byId("playIcon"),
    stopButton: byId("stopButton"),
    resetViewButton: byId("resetViewButton"),
    loopEditorButton: byId("loopEditorButton"),
    loopStatus: byId("loopStatus"),
    seek: byId("seek"),
    currentTime: byId("currentTime"),
    duration: byId("duration"),
    volume: byId("volume"),
    volumeValue: byId("volumeValue"),
    muteToggle: byId("muteToggle"),
    emptyState: byId("emptyState"),

    resetVisuals: byId("resetVisuals"),
    resetCamera: byId("resetCamera"),
    resetHud: byId("resetHud"),
    resetExport: byId("resetExport"),
    resetAll: byId("resetAll"),
    lineColor: byId("lineColor"),
    lineColorValue: byId("lineColorValue"),
    fftSize: byId("fftSize"),
    amplitudeMode: byId("amplitudeMode"),
    colorMode: byId("colorMode"),
    renderMode: byId("renderMode"),
    transientHighlight: byId("transientHighlight"),

    autoCamera: byId("autoCamera"),
    cameraPreset: byId("cameraPreset"),
    cameraMotion: byId("cameraMotion"),
    cameraFollowSource: byId("cameraFollowSource"),
    addCameraKeyframe: byId("addCameraKeyframe"),
    clearCameraKeyframes: byId("clearCameraKeyframes"),
    cameraKeyframeStatus: byId("cameraKeyframeStatus"),
    showGrid: byId("showGrid"),

    qualityPreset: byId("qualityPreset"),
    showFps: byId("showFps"),
    showAnalysisReadout: byId("showAnalysisReadout"),
    viewportFormat: byId("viewportFormat"),
    showHud: byId("showHud"),
    hudSpectrum: byId("hudSpectrum"),
    hudWaveform: byId("hudWaveform"),
    hudLevels: byId("hudLevels"),
    hudFrame: byId("hudFrame"),
    hudFrequencyLabels: byId("hudFrequencyLabels"),
    safeAreaMode: byId("safeAreaMode"),
    safeAreaAffectsHud: byId("safeAreaAffectsHud"),

    outputPreset: byId("outputPreset"),
    exportMode: byId("exportMode"),
    exportRange: byId("exportRange"),
    exportStartControl: byId("exportStartControl"),
    exportEndControl: byId("exportEndControl"),
    exportStart: byId("exportStart"),
    exportEnd: byId("exportEnd"),
    exportFileName: byId("exportFileName"),
    exportResolution: byId("exportResolution"),
    videoFormat: byId("videoFormat"),
    videoFps: byId("videoFps"),
    videoBitrate: byId("videoBitrate"),
    exportVideo: byId("exportVideo"),
    exportPng: byId("exportPng"),
    exportSettings: byId("exportSettings"),
    importSettingsButton: byId("importSettingsButton"),
    importSettingsInput: byId("importSettingsInput"),
    exportStatus: byId("exportStatus"),
    exportEstimateDuration: byId("exportEstimateDuration"),
    exportEstimateSize: byId("exportEstimateSize"),
    exportEstimateTime: byId("exportEstimateTime"),
    exportProgress: byId("exportProgress"),
    exportProgressTitle: byId("exportProgressTitle"),
    exportProgressPercent: byId("exportProgressPercent"),
    exportProgressBar: byId("exportProgressBar"),
    exportProgressTime: byId("exportProgressTime"),
    exportProgressFrame: byId("exportProgressFrame"),
    exportProgressEta: byId("exportProgressEta"),

    fftReadout: byId("fftReadout"),
    binsReadout: byId("binsReadout"),
    energyReadout: byId("energyReadout"),
    peakReadout: byId("peakReadout"),
    viewportHud: document.querySelector(".viewport__hud"),
    analysisReadoutBlocks: document.querySelectorAll(".analysis-readout-block"),
    fpsBlock: byId("fpsBlock"),
    fpsReadout: byId("fpsReadout"),

    shortcutsModal: byId("shortcutsModal"),
    diagnosticsModal: byId("diagnosticsModal"),
    capabilityGrid: byId("capabilityGrid"),
    errorModal: byId("errorModal"),
    errorTitle: byId("errorTitle"),
    errorMessage: byId("errorMessage"),
    errorSuggestions: byId("errorSuggestions"),
    contextLossOverlay: byId("contextLossOverlay"),
    contextLossTitle: byId("contextLossTitle"),
    contextLossMessage: byId("contextLossMessage"),
    reloadRendererButton: byId("reloadRendererButton"),
  };

  const state = {
    ...DEFAULTS,
    audioContext: null,
    analyser: null,
    mediaSource: null,
    exportAudioDestination: null,
    frequencyData: null,
    waveformData: null,
    decodedAudioBuffer: null,
    loopWaveformPeaks: null,
    loopReady: false,
    loopWrapPending: false,
    audioLoadToken: 0,
    spectrumOutput: null,
    spectrumSampled: null,
    spectrumMap: null,
    spectrumMapKey: "",
    lastSpectrum: null,
    objectUrl: null,
    loadedFileName: "",
    loadedFileSize: 0,
    loadedFileType: "",
    loadedFileExtension: "",
    loadedSampleRate: 0,
    loadedChannels: 0,
    trackPeak: 1,
    hasAudio: false,
    isPlaying: false,
    isSeeking: false,
    isLoadingAudio: false,
    spectrogramMesh: null,
    spectrogramPositionAttribute: null,
    spectrogramHead: 0,
    nextAnalysisTime: 0,
    lastFrameTime: performance.now(),
    energy: 0,
    peak: 0,
    bassEnergy: 0,
    peakFrequency: 0.5,
    smoothedEnergy: 0,
    energyAverage: 0.02,
    adaptiveGain: 1,
    previousPeak: 0,
    beatFlash: 0,
    transientFlash: 0,
    spectralCentroid: 0.5,
    dragDepth: 0,
    fpsFrameCount: 0,
    fpsLastUpdate: performance.now(),
    currentFps: 0,
    autoQualityScale: 1,
    sidebarCollapsed: false,
    cameraKeyframes: [],
    cameraMotionPhase: 0,
    cameraBasePosition: null,
    cameraBaseTarget: null,
    exportActive: false,
    exportCancelled: false,
    exportProgress: 0,
    exportPlaybackTimeOverride: null,
    exportRangeStart: 0,
    exportRangeEnd: 0,
    exportStartedAt: 0,
    exportFrameIndex: 0,
    exportTotalFrames: 0,
    contextLost: false,
    undoStack: [],
    redoStack: [],
    applyingSnapshot: false,
    lastSnapshotKey: "",
    hudLastRenderAt: 0,
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030303);
  scene.fog = new THREE.FogExp2(0x030303, 0.0065);

  const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 1200);
  const renderer = new THREE.WebGLRenderer({
    canvas: elements.canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.enablePan = true;
  controls.minDistance = 55;
  controls.maxDistance = 500;
  controls.target.set(0, 8, -44);

  const visualRoot = new THREE.Group();
  scene.add(visualRoot);

  const grid = new THREE.GridHelper(220, 22, 0x2c2c2c, 0x151515);
  grid.position.set(0, -0.8, -55);
  grid.material.transparent = true;
  grid.material.opacity = 0.48;
  grid.visible = state.showGrid;
  visualRoot.add(grid);

  const horizonGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-110, 0, -150),
    new THREE.Vector3(110, 0, -150),
  ]);
  const horizonMaterial = new THREE.LineBasicMaterial({ color: 0x282828, transparent: true, opacity: 0.8 });
  const horizon = new THREE.Line(horizonGeometry, horizonMaterial);
  visualRoot.add(horizon);

  const beatLight = new THREE.PointLight(0xff2a1a, 0, 260, 2);
  beatLight.position.set(0, 55, -18);
  scene.add(beatLight);

  function setInitialCamera() {
    camera.position.set(0, state.cameraHeight, state.cameraDistance - 82);
    controls.target.set(0, 8, -44);
    controls.update();
    state.cameraBasePosition = camera.position.clone();
    state.cameraBaseTarget = controls.target.clone();
  }

  setInitialCamera();

  App.core = {
    THREE,
    elements,
    state,
    scene,
    camera,
    renderer,
    controls,
    visualRoot,
    grid,
    horizon,
    beatLight,
    setInitialCamera,
  };
})();
