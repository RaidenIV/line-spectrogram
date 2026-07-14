(function () {
"use strict";

const THREE = window.THREE;
if (!THREE || !THREE.OrbitControls) {
  throw new Error("Three.js failed to initialize. Make sure the vendor files are present.");
}
const { OrbitControls } = THREE;

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
  beatPulse: true,
  cameraDistance: 190,
  cameraHeight: 68,
  cameraDrift: 0.45,
  autoCamera: false,
  showGrid: false,
  showFps: false,
});

const SPECTROGRAM_DEPTH = 142;
const SPECTROGRAM_WIDTH = 118;
const SPECTROGRAM_GROUP_Z = -5;
const MAX_FRAME_DELTA = 0.05;
const SCALE_LERP_FACTOR = 0.18;

const dom = {
  canvas: document.querySelector("#visualizer"),
  viewport: document.querySelector("#viewport"),
  sidebar: document.querySelector("#sidebar"),
  openSidebar: document.querySelector("#openSidebar"),
  closeSidebar: document.querySelector("#closeSidebar"),
  fileInput: document.querySelector("#audioFile"),
  fileDrop: document.querySelector("#fileDrop"),
  dropOverlay: document.querySelector("#dropOverlay"),
  audio: document.querySelector("#audio"),
  audioStatus: document.querySelector("#audioStatus"),
  trackCard: document.querySelector("#trackCard"),
  trackName: document.querySelector("#trackName"),
  trackDetails: document.querySelector("#trackDetails"),
  playButton: document.querySelector("#playButton"),
  playIcon: document.querySelector("#playIcon"),
  stopButton: document.querySelector("#stopButton"),
  loopButton: document.querySelector("#loopButton"),
  seek: document.querySelector("#seek"),
  currentTime: document.querySelector("#currentTime"),
  duration: document.querySelector("#duration"),
  volume: document.querySelector("#volume"),
  volumeValue: document.querySelector("#volumeValue"),
  liveDot: document.querySelector("#liveDot"),
  liveStatus: document.querySelector("#liveStatus"),
  emptyState: document.querySelector("#emptyState"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
  resetVisuals: document.querySelector("#resetVisuals"),
  resetCamera: document.querySelector("#resetCamera"),
  lineColor: document.querySelector("#lineColor"),
  lineColorValue: document.querySelector("#lineColorValue"),
  fftSize: document.querySelector("#fftSize"),
  autoCamera: document.querySelector("#autoCamera"),
  showFps: document.querySelector("#showFps"),
  exportSettings: document.querySelector("#exportSettings"),
  fftReadout: document.querySelector("#fftReadout"),
  binsReadout: document.querySelector("#binsReadout"),
  energyReadout: document.querySelector("#energyReadout"),
  peakReadout: document.querySelector("#peakReadout"),
  fpsBlock: document.querySelector("#fpsBlock"),
  fpsReadout: document.querySelector("#fpsReadout"),
};

const controlDefinitions = {
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
};

const toggleNames = ["logFrequency", "mirrorFrequency", "beatPulse", "autoCamera", "showGrid", "showFps"];

const state = {
  ...DEFAULTS,
  audioContext: null,
  analyser: null,
  mediaSource: null,
  frequencyData: null,
  spectrumOutput: null,
  spectrumSampled: null,
  spectrumMap: null,
  spectrumMapKey: "",
  objectUrl: null,
  hasAudio: false,
  isPlaying: false,
  isSeeking: false,
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
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030303);
scene.fog = new THREE.FogExp2(0x030303, 0.0065);

const camera = new THREE.PerspectiveCamera(47, 1, 0.1, 1200);
const renderer = new THREE.WebGLRenderer({
  canvas: dom.canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
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

function setRangeFill(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  const percentage = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--range-fill", `${percentage}%`);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function updatePlaybackUi() {
  dom.playIcon.classList.toggle("is-pause", state.isPlaying);
  dom.playButton.setAttribute("aria-label", state.isPlaying ? "Pause" : "Play");
  dom.trackCard.classList.toggle("is-playing", state.isPlaying);
  dom.liveDot.classList.toggle("is-live", state.isPlaying);
  dom.liveStatus.textContent = state.isPlaying ? "ANALYZING LIVE" : state.hasAudio ? "PAUSED" : "READY";
  dom.audioStatus.textContent = state.isPlaying ? "LIVE" : state.hasAudio ? "READY" : "NO FILE";
  dom.audioStatus.classList.toggle("is-ready", state.hasAudio);
}

function setTransportEnabled(enabled) {
  dom.playButton.disabled = !enabled;
  dom.stopButton.disabled = !enabled;
  dom.loopButton.disabled = !enabled;
  dom.seek.disabled = !enabled;
}

function initializeAudioGraph() {
  if (state.audioContext) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("This browser does not support the Web Audio API.");
  }

  state.audioContext = new AudioContextClass();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = state.fftSize;
  state.analyser.minDecibels = -92;
  state.analyser.maxDecibels = -8;
  state.analyser.smoothingTimeConstant = state.smoothing;

  state.mediaSource = state.audioContext.createMediaElementSource(dom.audio);
  state.mediaSource.connect(state.analyser);
  state.analyser.connect(state.audioContext.destination);

  state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
  state.spectrumMapKey = "";
  dom.fftReadout.textContent = String(state.analyser.fftSize);
}

async function ensureAudioContextRunning() {
  initializeAudioGraph();
  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
}

function clearSpectrogram() {
  if (!state.spectrogramMesh) return;
  state.spectrogramMesh.geometry.dispose();
  state.spectrogramMesh.material.dispose();
  visualRoot.remove(state.spectrogramMesh);
  state.spectrogramMesh = null;
  state.spectrogramPositionAttribute = null;
}

function createSpectrogramMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(state.lineColor) },
      uOpacity: { value: state.lineOpacity },
      uHead: { value: 0 },
      uHistoryLines: { value: state.historyLines },
      uDepthSpan: { value: SPECTROGRAM_DEPTH },
    },
    vertexShader: `
      attribute float historySlot;
      uniform float uHead;
      uniform float uHistoryLines;
      uniform float uDepthSpan;
      varying float vHistoryFade;
      #include <fog_pars_vertex>

      void main() {
        float age = mod(historySlot - uHead + uHistoryLines, uHistoryLines);
        float normalizedAge = age / max(1.0, uHistoryLines - 1.0);
        vec3 transformed = position;
        transformed.z = -normalizedAge * uDepthSpan;
        vHistoryFade = 1.0 - normalizedAge * 0.7;
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vHistoryFade;
      #include <common>
      #include <fog_pars_fragment>

      void main() {
        gl_FragColor = vec4(uColor, uOpacity * vHistoryFade);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,
  });

  return material;
}

function createSpectrogramGeometry() {
  const bins = state.frequencyBins;
  const rows = state.historyLines;
  const verticesPerRow = bins * 2;
  const totalVertices = rows * verticesPerRow;
  const positions = new Float32Array(totalVertices * 3);
  const historySlots = new Uint16Array(totalVertices);
  const indexCount = rows * Math.max(0, bins - 1) * 6;
  const indices = totalVertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  const halfWidth = state.lineWidth / 2;

  for (let row = 0; row < rows; row += 1) {
    const rowVertexOffset = row * verticesPerRow;
    const rowPositionOffset = rowVertexOffset * 3;

    for (let i = 0; i < bins; i += 1) {
      const ratio = i / Math.max(1, bins - 1);
      const x = (ratio - 0.5) * SPECTROGRAM_WIDTH;
      const upper = rowPositionOffset + i * 6;
      const lower = upper + 3;
      const upperVertex = rowVertexOffset + i * 2;

      positions[upper] = x;
      positions[upper + 1] = halfWidth;
      positions[upper + 2] = 0;
      positions[lower] = x;
      positions[lower + 1] = -halfWidth;
      positions[lower + 2] = 0;
      historySlots[upperVertex] = row;
      historySlots[upperVertex + 1] = row;
    }

    const rowIndexOffset = row * Math.max(0, bins - 1) * 6;
    for (let i = 0; i < bins - 1; i += 1) {
      const vertex = rowVertexOffset + i * 2;
      const offset = rowIndexOffset + i * 6;
      indices[offset] = vertex;
      indices[offset + 1] = vertex + 1;
      indices[offset + 2] = vertex + 2;
      indices[offset + 3] = vertex + 1;
      indices[offset + 4] = vertex + 3;
      indices[offset + 5] = vertex + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("historySlot", new THREE.BufferAttribute(historySlots, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function rebuildSpectrogram() {
  clearSpectrogram();

  const geometry = createSpectrogramGeometry();
  const material = createSpectrogramMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = SPECTROGRAM_GROUP_Z;
  mesh.frustumCulled = false;
  visualRoot.add(mesh);

  state.spectrogramMesh = mesh;
  state.spectrogramPositionAttribute = geometry.getAttribute("position");
  state.spectrogramHead = 0;
  state.spectrumMapKey = "";

  dom.binsReadout.textContent = String(state.frequencyBins);
  resetSpectrogramData();
}

function resetSpectrogramData() {
  const attribute = state.spectrogramPositionAttribute;
  if (attribute) {
    const positions = attribute.array;
    const halfWidth = state.lineWidth / 2;
    const totalPoints = state.historyLines * state.frequencyBins;

    for (let i = 0; i < totalPoints; i += 1) {
      const upper = i * 6 + 1;
      const lower = upper + 3;
      positions[upper] = halfWidth;
      positions[lower] = -halfWidth;
    }

    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, positions.length);
    attribute.needsUpdate = true;
  }

  state.spectrogramHead = 0;
  if (state.spectrogramMesh) state.spectrogramMesh.material.uniforms.uHead.value = 0;
  state.energy = 0;
  state.peak = 0;
  state.smoothedEnergy = 0;
  state.energyAverage = 0.02;
  state.beatFlash = 0;
  dom.energyReadout.textContent = "0.00";
  dom.peakReadout.textContent = "0.00";
}

function ensureSpectrumSamplingMap(outputLength) {
  const sourceLength = state.frequencyData?.length || 0;
  const effectiveLength = state.mirrorFrequency ? Math.ceil(outputLength / 2) : outputLength;
  const key = `${sourceLength}:${outputLength}:${effectiveLength}:${state.logFrequency ? 1 : 0}:${state.mirrorFrequency ? 1 : 0}`;
  if (state.spectrumMapKey === key && state.spectrumMap) return;

  state.spectrumOutput = new Float32Array(outputLength);
  state.spectrumSampled = new Float32Array(effectiveLength);

  const usableBins = Math.max(2, Math.floor(sourceLength * 0.88));
  const starts = new Uint16Array(effectiveLength);
  const ends = new Uint16Array(effectiveLength);
  const centers = new Float32Array(effectiveLength);
  const radii = new Uint16Array(effectiveLength);
  const inverseWeightSums = new Float32Array(effectiveLength);
  const mirrorIndices = state.mirrorFrequency ? new Uint16Array(outputLength) : null;

  for (let i = 0; i < effectiveLength; i += 1) {
    const ratio = i / Math.max(1, effectiveLength - 1);
    const mappedRatio = state.logFrequency
      ? (Math.exp(ratio * Math.log(13)) - 1) / 12
      : ratio;
    const center = mappedRatio * (usableBins - 1);
    const radius = Math.max(1, Math.floor(usableBins / effectiveLength / 2));
    const start = Math.max(0, Math.floor(center) - radius);
    const end = Math.min(usableBins - 1, Math.ceil(center) + radius);
    let weightSum = 0;

    for (let index = start; index <= end; index += 1) {
      const distance = Math.abs(index - center) / Math.max(1, radius);
      weightSum += Math.max(0.1, 1 - distance * 0.65);
    }

    starts[i] = start;
    ends[i] = end;
    centers[i] = center;
    radii[i] = radius;
    inverseWeightSums[i] = 1 / Math.max(weightSum, 1);
  }

  if (mirrorIndices) {
    for (let i = 0; i < outputLength; i += 1) {
      const distanceFromCenter = Math.abs(i - (outputLength - 1) / 2);
      const normalized = 1 - distanceFromCenter / Math.max(1, (outputLength - 1) / 2);
      mirrorIndices[i] = Math.min(effectiveLength - 1, Math.floor(normalized * (effectiveLength - 1)));
    }
  }

  state.spectrumMap = {
    starts,
    ends,
    centers,
    radii,
    inverseWeightSums,
    mirrorIndices,
  };
  state.spectrumMapKey = key;
}

function sampleSpectrum(outputLength) {
  ensureSpectrumSamplingMap(outputLength);
  const output = state.spectrumOutput;
  output.fill(0);
  if (!state.analyser || !state.frequencyData) return output;

  state.analyser.getByteFrequencyData(state.frequencyData);

  const source = state.frequencyData;
  const sampled = state.spectrumSampled;
  const { starts, ends, centers, radii, inverseWeightSums, mirrorIndices } = state.spectrumMap;

  for (let i = 0; i < sampled.length; i += 1) {
    const center = centers[i];
    const radius = radii[i];
    let sum = 0;

    for (let index = starts[i]; index <= ends[i]; index += 1) {
      const distance = Math.abs(index - center) / Math.max(1, radius);
      const weight = Math.max(0.1, 1 - distance * 0.65);
      sum += source[index] * weight;
    }

    sampled[i] = sum * inverseWeightSums[i] / 255;
  }

  if (mirrorIndices) {
    for (let i = 0; i < outputLength; i += 1) output[i] = sampled[mirrorIndices[i]];
  } else {
    output.set(sampled);
  }

  return output;
}

function analyzeFrame() {
  const spectrum = sampleSpectrum(state.frequencyBins);
  let energySum = 0;
  let weightedFrequency = 0;
  let frequencyWeight = 0;
  let peak = 0;

  for (let i = 0; i < spectrum.length; i += 1) {
    const value = spectrum[i];
    energySum += value * value;
    if (value > peak) peak = value;
    weightedFrequency += i * value;
    frequencyWeight += value;
  }

  const rms = Math.sqrt(energySum / Math.max(1, spectrum.length));
  state.energy = rms;
  state.peak = peak;
  state.smoothedEnergy += (rms - state.smoothedEnergy) * 0.22;
  state.energyAverage += (rms - state.energyAverage) * 0.025;
  state.spectralCentroid = frequencyWeight > 0
    ? weightedFrequency / frequencyWeight / Math.max(1, spectrum.length - 1)
    : 0.5;

  const isBeat = rms > Math.max(0.075, state.energyAverage * 1.38) && peak > 0.32;
  if (isBeat) state.beatFlash = 1;

  const attribute = state.spectrogramPositionAttribute;
  if (!attribute || !state.spectrogramMesh) return;

  state.spectrogramHead = (state.spectrogramHead - 1 + state.historyLines) % state.historyLines;
  state.spectrogramMesh.material.uniforms.uHead.value = state.spectrogramHead;

  const positions = attribute.array;
  const rowOffset = state.spectrogramHead * state.frequencyBins * 6;
  const beatBoost = state.beatPulse ? state.beatFlash * 0.16 : 0;
  const halfWidth = state.lineWidth / 2;
  const denominator = Math.max(1, state.frequencyBins - 1);

  for (let i = 0; i < state.frequencyBins; i += 1) {
    const value = spectrum[i];
    const shaped = Math.pow(value, 1.7);
    const bassBias = 1 + (1 - i / denominator) * beatBoost;
    const height = shaped * state.heightScale * bassBias;
    const upper = rowOffset + i * 6 + 1;
    const lower = upper + 3;
    positions[upper] = height + halfWidth;
    positions[lower] = height - halfWidth;
  }

  attribute.clearUpdateRanges();
  attribute.addUpdateRange(rowOffset, state.frequencyBins * 6);
  attribute.needsUpdate = true;
  dom.energyReadout.textContent = rms.toFixed(2);
  dom.peakReadout.textContent = peak.toFixed(2);
}

function updateLineWidths() {
  const attribute = state.spectrogramPositionAttribute;
  if (!attribute) return;

  const positions = attribute.array;
  const halfWidth = state.lineWidth / 2;
  const totalPoints = state.historyLines * state.frequencyBins;

  for (let i = 0; i < totalPoints; i += 1) {
    const upper = i * 6 + 1;
    const lower = upper + 3;
    const center = (positions[upper] + positions[lower]) / 2;
    positions[upper] = center + halfWidth;
    positions[lower] = center - halfWidth;
  }

  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, positions.length);
  attribute.needsUpdate = true;
}

function updateFpsVisibility() {
  dom.fpsBlock.classList.toggle("is-hidden", !state.showFps);
  dom.fpsBlock.setAttribute("aria-hidden", String(!state.showFps));
}

function updateVisualDynamics(delta) {
  state.beatFlash = Math.max(0, state.beatFlash - delta * 3.4);

  const targetScale = state.beatPulse ? 1 + state.beatFlash * 0.018 : 1;
  const nextScale = visualRoot.scale.x + (targetScale - visualRoot.scale.x) * SCALE_LERP_FACTOR;
  visualRoot.scale.setScalar(nextScale);
  beatLight.intensity = state.beatPulse ? state.beatFlash * 3.2 : 0;

  if (state.autoCamera && state.isPlaying) {
    const targetX = (state.spectralCentroid - 0.5) * 42 * state.cameraDrift;
    controls.target.x += (targetX - controls.target.x) * 0.025;
    camera.position.x += (targetX * 0.65 - camera.position.x) * 0.012;
  }
}

const cameraDirection = new THREE.Vector3();

function updateCameraFromControls() {
  const direction = cameraDirection.subVectors(camera.position, controls.target).normalize();
  const horizontal = Math.sqrt(Math.max(0.001, 1 - direction.y * direction.y));
  const azimuth = Math.atan2(direction.x, direction.z);
  const distance = state.cameraDistance;
  const elevation = state.cameraHeight;

  camera.position.set(
    controls.target.x + Math.sin(azimuth) * horizontal * distance,
    elevation,
    controls.target.z + Math.cos(azimuth) * horizontal * distance,
  );
  controls.update();
}

let rendererWidth = 0;
let rendererHeight = 0;
let resizeFrame = 0;

function resizeRenderer() {
  resizeFrame = 0;
  const width = dom.viewport.clientWidth;
  const height = dom.viewport.clientHeight;
  if (width === rendererWidth && height === rendererHeight) return;

  rendererWidth = width;
  rendererHeight = height;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function queueRendererResize() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(resizeRenderer);
}

function animate(now) {
  requestAnimationFrame(animate);

  const delta = Math.min(MAX_FRAME_DELTA, (now - state.lastFrameTime) / 1000);
  state.lastFrameTime = now;

  if (state.showFps) {
    state.fpsFrameCount += 1;
    const fpsElapsed = now - state.fpsLastUpdate;
    if (fpsElapsed >= 500) {
      state.currentFps = state.fpsFrameCount * 1000 / fpsElapsed;
      dom.fpsReadout.textContent = String(Math.round(state.currentFps));
      state.fpsFrameCount = 0;
      state.fpsLastUpdate = now;
    }
  }

  if (state.isPlaying && now >= state.nextAnalysisTime) {
    analyzeFrame();
    state.nextAnalysisTime = now + 1000 / Math.max(1, state.scrollSpeed);
  }

  updateVisualDynamics(delta);
  controls.update();
  renderer.render(scene, camera);
}

function updateSeekUi() {
  if (state.isSeeking) return;
  const duration = dom.audio.duration;
  const ratio = Number.isFinite(duration) && duration > 0 ? dom.audio.currentTime / duration : 0;
  dom.seek.value = String(Math.round(ratio * 1000));
  dom.currentTime.textContent = formatTime(dom.audio.currentTime);
  setRangeFill(dom.seek);
}

async function togglePlayback() {
  if (!state.hasAudio) return;

  try {
    await ensureAudioContextRunning();
    if (dom.audio.paused) {
      await dom.audio.play();
    } else {
      dom.audio.pause();
    }
  } catch (error) {
    console.error(error);
    dom.liveStatus.textContent = "PLAYBACK ERROR";
  }
}

function stopPlayback() {
  dom.audio.pause();
  dom.audio.currentTime = 0;
  resetSpectrogramData();
  updateSeekUi();
}

function loadAudioFile(file) {
  const supportedExtension = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(file?.name || "");
  const supportedMime = Boolean(file?.type && file.type.startsWith("audio/"));

  if (!file || (!supportedMime && !supportedExtension)) {
    dom.liveStatus.textContent = "UNSUPPORTED FILE";
    dom.audioStatus.textContent = "ERROR";
    return;
  }

  dom.audio.pause();
  state.isPlaying = false;
  state.hasAudio = false;
  setTransportEnabled(false);
  updatePlaybackUi();

  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
  }

  state.objectUrl = URL.createObjectURL(file);
  dom.audio.preload = "auto";
  dom.audio.src = state.objectUrl;
  dom.audio.volume = Number(dom.volume.value);

  dom.audioStatus.textContent = "LOADING";
  dom.audioStatus.classList.remove("is-ready");
  dom.liveStatus.textContent = "LOADING AUDIO";
  dom.emptyState.classList.add("is-hidden");
  dom.trackName.textContent = file.name.replace(/\.[^.]+$/, "");
  dom.trackDetails.textContent = `${file.name.split(".").pop().toUpperCase()} • ${formatBytes(file.size)}`;
  resetSpectrogramData();
  dom.audio.load();
}

function markAudioReady() {
  if (!dom.audio.src) return;
  state.hasAudio = true;
  state.isPlaying = !dom.audio.paused;
  setTransportEnabled(true);
  updatePlaybackUi();
  dom.duration.textContent = formatTime(dom.audio.duration);
  updateSeekUi();
}

function bindControl(name, definition) {
  const input = document.querySelector(`#${name}`);
  const output = document.querySelector(`#${name}Value`);
  if (!input || !output) return;

  const updateDisplay = (value) => {
    output.textContent = definition.format(value);
    setRangeFill(input);
  };

  const applyValue = (commitRebuild = false) => {
    const parsedValue = definition.parser(input.value);
    updateDisplay(parsedValue);

    if (definition.rebuild && !commitRebuild) return;
    state[name] = parsedValue;

    if (name === "smoothing" && state.analyser) {
      state.analyser.smoothingTimeConstant = state.smoothing;
    } else if (name === "lineWidth") {
      updateLineWidths();
    } else if (name === "lineOpacity" && state.spectrogramMesh) {
      state.spectrogramMesh.material.uniforms.uOpacity.value = state.lineOpacity;
    } else if (name === "cameraDistance" || name === "cameraHeight") {
      updateCameraFromControls();
    }

    if (definition.rebuild && commitRebuild) rebuildSpectrogram();
  };

  input.addEventListener("input", () => applyValue(false));
  input.addEventListener("change", () => applyValue(true));
  updateDisplay(state[name]);
}

function resetVisualControls() {
  for (const [name, definition] of Object.entries(controlDefinitions)) {
    if (["cameraDistance", "cameraHeight", "cameraDrift"].includes(name)) continue;
    const input = document.querySelector(`#${name}`);
    input.value = String(DEFAULTS[name]);
    state[name] = DEFAULTS[name];
    const output = document.querySelector(`#${name}Value`);
    output.textContent = definition.format(DEFAULTS[name]);
    setRangeFill(input);
  }

  dom.fftSize.value = String(DEFAULTS.fftSize);
  state.fftSize = DEFAULTS.fftSize;
  applyFftSize();

  dom.lineColor.value = DEFAULTS.lineColor;
  state.lineColor = DEFAULTS.lineColor;
  dom.lineColorValue.textContent = DEFAULTS.lineColor.toUpperCase();
  document.documentElement.style.setProperty("--accent", DEFAULTS.lineColor);

  for (const name of ["logFrequency", "mirrorFrequency", "beatPulse"]) {
    const input = document.querySelector(`#${name}`);
    input.checked = DEFAULTS[name];
    state[name] = DEFAULTS[name];
  }

  if (state.analyser) state.analyser.smoothingTimeConstant = state.smoothing;
  rebuildSpectrogram();
}

function resetCameraControls() {
  for (const name of ["cameraDistance", "cameraHeight", "cameraDrift"]) {
    const definition = controlDefinitions[name];
    const input = document.querySelector(`#${name}`);
    input.value = String(DEFAULTS[name]);
    state[name] = DEFAULTS[name];
    const output = document.querySelector(`#${name}Value`);
    output.textContent = definition.format(DEFAULTS[name]);
    setRangeFill(input);
  }

  dom.autoCamera.checked = DEFAULTS.autoCamera;
  state.autoCamera = DEFAULTS.autoCamera;
  setInitialCamera();
}

for (const [name, definition] of Object.entries(controlDefinitions)) {
  bindControl(name, definition);
}

for (const name of toggleNames) {
  const input = document.querySelector(`#${name}`);
  input.checked = state[name];
  input.addEventListener("change", () => {
    state[name] = input.checked;
    if (name === "showGrid") grid.visible = state.showGrid;
    if (name === "showFps") {
      state.fpsFrameCount = 0;
      state.fpsLastUpdate = performance.now();
      dom.fpsReadout.textContent = "0";
      updateFpsVisibility();
    }
  });
}

function applyFftSize() {
  if (state.analyser) {
    state.analyser.fftSize = state.fftSize;
    state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
  }
  state.spectrumMapKey = "";
  dom.fftReadout.textContent = String(state.fftSize);
}

function exportSettingsJson() {
  const settings = {};
  for (const name of Object.keys(DEFAULTS)) settings[name] = state[name];
  settings.volume = Number(dom.volume.value);

  const payload = {
    app: "3D Spectrogram",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
  };

  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `3d-spectrogram-settings-${date}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function initializeCollapsiblePanels() {
  for (const panel of document.querySelectorAll("[data-collapsible]")) {
    const button = panel.querySelector(".panel__toggle");
    const content = panel.querySelector(".panel__content");
    if (!button || !content) continue;

    button.addEventListener("click", () => {
      const isCollapsed = panel.classList.toggle("is-collapsed");
      button.setAttribute("aria-expanded", String(!isCollapsed));
      content.setAttribute("aria-hidden", String(isCollapsed));
      content.inert = isCollapsed;
    });
  }
}

dom.fftSize.addEventListener("change", () => {
  state.fftSize = Number(dom.fftSize.value);
  applyFftSize();
});

dom.exportSettings.addEventListener("click", exportSettingsJson);

dom.lineColor.addEventListener("input", () => {
  state.lineColor = dom.lineColor.value;
  dom.lineColorValue.textContent = state.lineColor.toUpperCase();
  document.documentElement.style.setProperty("--accent", state.lineColor);
  beatLight.color.set(state.lineColor);
  if (state.spectrogramMesh) {
    state.spectrogramMesh.material.uniforms.uColor.value.set(state.lineColor);
  }
});

dom.fileInput.addEventListener("change", (event) => {
  loadAudioFile(event.target.files?.[0]);
  event.target.value = "";
});

dom.playButton.addEventListener("click", togglePlayback);
dom.stopButton.addEventListener("click", stopPlayback);
dom.loopButton.addEventListener("click", () => {
  dom.audio.loop = !dom.audio.loop;
  dom.loopButton.setAttribute("aria-pressed", String(dom.audio.loop));
});

dom.volume.addEventListener("input", () => {
  dom.audio.volume = Number(dom.volume.value);
  dom.volumeValue.textContent = `${Math.round(dom.audio.volume * 100)}%`;
  setRangeFill(dom.volume);
});

dom.seek.addEventListener("pointerdown", () => {
  state.isSeeking = true;
});

dom.seek.addEventListener("input", () => {
  const duration = dom.audio.duration;
  if (!Number.isFinite(duration)) return;
  const previewTime = (Number(dom.seek.value) / 1000) * duration;
  dom.currentTime.textContent = formatTime(previewTime);
  setRangeFill(dom.seek);
});

const commitSeek = () => {
  const duration = dom.audio.duration;
  if (Number.isFinite(duration)) {
    dom.audio.currentTime = (Number(dom.seek.value) / 1000) * duration;
  }
  state.isSeeking = false;
};

dom.seek.addEventListener("change", commitSeek);
dom.seek.addEventListener("pointerup", commitSeek);

dom.audio.addEventListener("loadedmetadata", markAudioReady);
dom.audio.addEventListener("canplay", markAudioReady);

dom.audio.addEventListener("timeupdate", updateSeekUi);
dom.audio.addEventListener("play", () => {
  state.isPlaying = true;
  state.nextAnalysisTime = performance.now();
  updatePlaybackUi();
});

dom.audio.addEventListener("pause", () => {
  state.isPlaying = false;
  updatePlaybackUi();
});

dom.audio.addEventListener("ended", () => {
  state.isPlaying = false;
  updatePlaybackUi();
});

dom.audio.addEventListener("error", () => {
  state.isPlaying = false;
  state.hasAudio = false;
  setTransportEnabled(false);
  const errorCode = dom.audio.error?.code;
  dom.liveStatus.textContent = errorCode === 4 ? "FORMAT NOT SUPPORTED" : "DECODE ERROR";
  dom.audioStatus.textContent = "ERROR";
  dom.audioStatus.classList.remove("is-ready");
  dom.trackCard.classList.remove("is-playing");
});

dom.resetVisuals.addEventListener("click", resetVisualControls);
dom.resetCamera.addEventListener("click", resetCameraControls);

dom.openSidebar.addEventListener("click", () => dom.sidebar.classList.add("is-open"));
dom.closeSidebar.addEventListener("click", () => dom.sidebar.classList.remove("is-open"));

dom.fullscreenButton.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await dom.viewport.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.error(error);
  }
});

const preventDragDefaults = (event) => {
  event.preventDefault();
  event.stopPropagation();
};

for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
  window.addEventListener(eventName, preventDragDefaults, false);
}

window.addEventListener("dragenter", () => {
  state.dragDepth += 1;
  dom.dropOverlay.classList.add("is-visible");
  dom.fileDrop.classList.add("is-dragging");
});

window.addEventListener("dragover", () => {
  dom.dropOverlay.classList.add("is-visible");
  dom.fileDrop.classList.add("is-dragging");
});

window.addEventListener("dragleave", () => {
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) {
    dom.dropOverlay.classList.remove("is-visible");
    dom.fileDrop.classList.remove("is-dragging");
  }
});

window.addEventListener("drop", (event) => {
  state.dragDepth = 0;
  dom.dropOverlay.classList.remove("is-visible");
  dom.fileDrop.classList.remove("is-dragging");
  loadAudioFile(event.dataTransfer?.files?.[0]);
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

  if (event.code === "Space" && !isTyping) {
    event.preventDefault();
    togglePlayback();
  }

  if (event.code === "Escape") {
    dom.sidebar.classList.remove("is-open");
  }
});

const viewportResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(queueRendererResize)
  : null;

if (viewportResizeObserver) {
  viewportResizeObserver.observe(dom.viewport);
} else {
  window.addEventListener("resize", queueRendererResize);
}

window.addEventListener("beforeunload", () => {
  viewportResizeObserver?.disconnect();
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
});

for (const input of document.querySelectorAll(".range")) setRangeFill(input);
dom.volumeValue.textContent = `${Math.round(Number(dom.volume.value) * 100)}%`;
dom.lineColorValue.textContent = state.lineColor.toUpperCase();
document.documentElement.style.setProperty("--accent", state.lineColor);
grid.visible = state.showGrid;
updateFpsVisibility();
initializeCollapsiblePanels();
setTransportEnabled(false);
updatePlaybackUi();
rebuildSpectrogram();
resizeRenderer();
requestAnimationFrame(animate);

})();
