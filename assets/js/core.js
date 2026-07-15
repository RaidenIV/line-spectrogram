(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { DEFAULTS } = App.config;
  const THREE = window.THREE;

  if (!THREE || !THREE.OrbitControls) {
    throw new Error("Three.js failed to initialize. Make sure the vendor files are present.");
  }

  const elements = {
    appShell: document.querySelector("#appShell"),
    canvas: document.querySelector("#visualizer"),
    hudCanvas: document.querySelector("#hudCanvas"),
    viewportLogo: document.querySelector("#viewportLogo"),
    viewport: document.querySelector("#viewport"),
    viewportFrame: document.querySelector("#viewportFrame"),
    sidebar: document.querySelector("#sidebar"),
    sidebarToggle: document.querySelector("#sidebarToggle"),
    sidebarToggleIcon: document.querySelector("#sidebarToggleIcon"),
    openSidebar: document.querySelector("#openSidebar"),
    closeSidebar: document.querySelector("#closeSidebar"),
    fileInput: document.querySelector("#audioFile"),
    fileDrop: document.querySelector("#fileDrop"),
    fileButtonText: document.querySelector("#audioFileButtonText"),
    fileButtonCopy: document.querySelector("#audioFileButtonCopy"),
    audioLoadProgress: document.querySelector("#audioLoadProgress"),
    audioLoadProgressBar: document.querySelector("#audioLoadProgressBar"),
    audioLoadProgressPercent: document.querySelector("#audioLoadProgressPercent"),
    audioLoadStage: document.querySelector("#audioLoadStage"),
    dropOverlay: document.querySelector("#dropOverlay"),
    audio: document.querySelector("#audio"),
    audioStatus: document.querySelector("#audioStatus"),
    trackCard: document.querySelector("#trackCard"),
    trackName: document.querySelector("#trackName"),
    trackDetails: document.querySelector("#trackDetails"),
    playButton: document.querySelector("#playButton"),
    playIcon: document.querySelector("#playIcon"),
    stopButton: document.querySelector("#stopButton"),
    resetViewButton: document.querySelector("#resetViewButton"),
    loopEditorButton: document.querySelector("#loopEditorButton"),
    loopStatus: document.querySelector("#loopStatus"),
    seek: document.querySelector("#seek"),
    currentTime: document.querySelector("#currentTime"),
    duration: document.querySelector("#duration"),
    volume: document.querySelector("#volume"),
    volumeValue: document.querySelector("#volumeValue"),
    muteToggle: document.querySelector("#muteToggle"),
    emptyState: document.querySelector("#emptyState"),
    resetVisuals: document.querySelector("#resetVisuals"),
    resetCamera: document.querySelector("#resetCamera"),
    resetHud: document.querySelector("#resetHud"),
    lineColor: document.querySelector("#lineColor"),
    lineColorValue: document.querySelector("#lineColorValue"),
    fftSize: document.querySelector("#fftSize"),
    autoCamera: document.querySelector("#autoCamera"),
    showGrid: document.querySelector("#showGrid"),
    showFps: document.querySelector("#showFps"),
    showAnalysisReadout: document.querySelector("#showAnalysisReadout"),
    viewportFormat: document.querySelector("#viewportFormat"),
    showHud: document.querySelector("#showHud"),
    hudSpectrum: document.querySelector("#hudSpectrum"),
    hudWaveform: document.querySelector("#hudWaveform"),
    hudLevels: document.querySelector("#hudLevels"),
    hudFrame: document.querySelector("#hudFrame"),
    exportFileName: document.querySelector("#exportFileName"),
    exportResolution: document.querySelector("#exportResolution"),
    videoFormat: document.querySelector("#videoFormat"),
    videoFps: document.querySelector("#videoFps"),
    videoBitrate: document.querySelector("#videoBitrate"),
    exportVideo: document.querySelector("#exportVideo"),
    exportPng: document.querySelector("#exportPng"),
    exportSettings: document.querySelector("#exportSettings"),
    exportStatus: document.querySelector("#exportStatus"),
    fftReadout: document.querySelector("#fftReadout"),
    binsReadout: document.querySelector("#binsReadout"),
    energyReadout: document.querySelector("#energyReadout"),
    peakReadout: document.querySelector("#peakReadout"),
    viewportHud: document.querySelector(".viewport__hud"),
    analysisReadoutBlocks: document.querySelectorAll(".analysis-readout-block"),
    fpsBlock: document.querySelector("#fpsBlock"),
    fpsReadout: document.querySelector("#fpsReadout"),
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
    smoothedEnergy: 0,
    energyAverage: 0.02,
    beatFlash: 0,
    spectralCentroid: 0.5,
    dragDepth: 0,
    fpsFrameCount: 0,
    fpsLastUpdate: performance.now(),
    currentFps: 0,
    sidebarCollapsed: false,
    exportActive: false,
    exportCancelled: false,
    exportProgress: 0,
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
