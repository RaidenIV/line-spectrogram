(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { THREE, elements, state, visualRoot, controls, camera, beatLight } = App.core;
  const { CONSTANTS } = App.config;
  const {
    SPECTROGRAM_DEPTH,
    SPECTROGRAM_WIDTH,
    SPECTROGRAM_GROUP_Z,
    SCALE_LERP_FACTOR,
  } = CONSTANTS;

  function clearSpectrogram() {
    if (!state.spectrogramMesh) return;
    state.spectrogramMesh.geometry.dispose();
    state.spectrogramMesh.material.dispose();
    visualRoot.remove(state.spectrogramMesh);
    state.spectrogramMesh = null;
    state.spectrogramPositionAttribute = null;
  }

  function createSpectrogramMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
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

      for (let index = 0; index < bins; index += 1) {
        const ratio = index / Math.max(1, bins - 1);
        const x = (ratio - 0.5) * SPECTROGRAM_WIDTH;
        const upper = rowPositionOffset + index * 6;
        const lower = upper + 3;
        const upperVertex = rowVertexOffset + index * 2;

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
      for (let index = 0; index < bins - 1; index += 1) {
        const vertex = rowVertexOffset + index * 2;
        const offset = rowIndexOffset + index * 6;
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
    elements.binsReadout.textContent = String(state.frequencyBins);
    resetSpectrogramData();
  }

  function resetSpectrogramData() {
    const attribute = state.spectrogramPositionAttribute;
    if (attribute) {
      const positions = attribute.array;
      const halfWidth = state.lineWidth / 2;
      const totalPoints = state.historyLines * state.frequencyBins;

      for (let index = 0; index < totalPoints; index += 1) {
        const upper = index * 6 + 1;
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
    state.lastSpectrum = null;
    if (state.waveformData) state.waveformData.fill(128);
    elements.energyReadout.textContent = "0.00";
    elements.peakReadout.textContent = "0.00";
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

    for (let index = 0; index < effectiveLength; index += 1) {
      const ratio = index / Math.max(1, effectiveLength - 1);
      const mappedRatio = state.logFrequency
        ? (Math.exp(ratio * Math.log(13)) - 1) / 12
        : ratio;
      const center = mappedRatio * (usableBins - 1);
      const radius = Math.max(1, Math.floor(usableBins / effectiveLength / 2));
      const start = Math.max(0, Math.floor(center) - radius);
      const end = Math.min(usableBins - 1, Math.ceil(center) + radius);
      let weightSum = 0;

      for (let sourceIndex = start; sourceIndex <= end; sourceIndex += 1) {
        const distance = Math.abs(sourceIndex - center) / Math.max(1, radius);
        weightSum += Math.max(0.1, 1 - distance * 0.65);
      }

      starts[index] = start;
      ends[index] = end;
      centers[index] = center;
      radii[index] = radius;
      inverseWeightSums[index] = 1 / Math.max(weightSum, 1);
    }

    if (mirrorIndices) {
      for (let index = 0; index < outputLength; index += 1) {
        const distanceFromCenter = Math.abs(index - (outputLength - 1) / 2);
        const normalized = 1 - distanceFromCenter / Math.max(1, (outputLength - 1) / 2);
        mirrorIndices[index] = Math.min(effectiveLength - 1, Math.floor(normalized * (effectiveLength - 1)));
      }
    }

    state.spectrumMap = { starts, ends, centers, radii, inverseWeightSums, mirrorIndices };
    state.spectrumMapKey = key;
  }

  function sampleSpectrum(outputLength) {
    ensureSpectrumSamplingMap(outputLength);
    const output = state.spectrumOutput;
    output.fill(0);
    if (!state.analyser || !state.frequencyData) return output;

    state.analyser.getByteFrequencyData(state.frequencyData);
    if ((state.showHud || state.exportActive) && state.waveformData) {
      state.analyser.getByteTimeDomainData(state.waveformData);
    }

    const source = state.frequencyData;
    const sampled = state.spectrumSampled;
    const { starts, ends, centers, radii, inverseWeightSums, mirrorIndices } = state.spectrumMap;

    for (let index = 0; index < sampled.length; index += 1) {
      const center = centers[index];
      const radius = radii[index];
      let sum = 0;

      for (let sourceIndex = starts[index]; sourceIndex <= ends[index]; sourceIndex += 1) {
        const distance = Math.abs(sourceIndex - center) / Math.max(1, radius);
        const weight = Math.max(0.1, 1 - distance * 0.65);
        sum += source[sourceIndex] * weight;
      }

      sampled[index] = sum * inverseWeightSums[index] / 255;
    }

    if (mirrorIndices) {
      for (let index = 0; index < outputLength; index += 1) output[index] = sampled[mirrorIndices[index]];
    } else {
      output.set(sampled);
    }

    state.lastSpectrum = output;
    return output;
  }

  function analyzeFrame() {
    const spectrum = sampleSpectrum(state.frequencyBins);
    let energySum = 0;
    let weightedFrequency = 0;
    let frequencyWeight = 0;
    let peak = 0;

    for (let index = 0; index < spectrum.length; index += 1) {
      const value = spectrum[index];
      energySum += value * value;
      if (value > peak) peak = value;
      weightedFrequency += index * value;
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

    for (let index = 0; index < state.frequencyBins; index += 1) {
      const value = spectrum[index];
      const shaped = Math.pow(value, 1.7);
      const bassBias = 1 + (1 - index / denominator) * beatBoost;
      const height = shaped * state.heightScale * bassBias;
      const upper = rowOffset + index * 6 + 1;
      const lower = upper + 3;
      positions[upper] = height + halfWidth;
      positions[lower] = height - halfWidth;
    }

    attribute.clearUpdateRanges();
    attribute.addUpdateRange(rowOffset, state.frequencyBins * 6);
    attribute.needsUpdate = true;
    elements.energyReadout.textContent = rms.toFixed(2);
    elements.peakReadout.textContent = peak.toFixed(2);
  }

  function updateLineWidths() {
    const attribute = state.spectrogramPositionAttribute;
    if (!attribute) return;

    const positions = attribute.array;
    const halfWidth = state.lineWidth / 2;
    const totalPoints = state.historyLines * state.frequencyBins;

    for (let index = 0; index < totalPoints; index += 1) {
      const upper = index * 6 + 1;
      const lower = upper + 3;
      const center = (positions[upper] + positions[lower]) / 2;
      positions[upper] = center + halfWidth;
      positions[lower] = center - halfWidth;
    }

    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, positions.length);
    attribute.needsUpdate = true;
  }

  function applyFftSize() {
    if (state.analyser) {
      state.analyser.fftSize = state.fftSize;
      state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
      state.waveformData = new Uint8Array(state.analyser.fftSize);
      state.waveformData.fill(128);
    }
    state.spectrumMapKey = "";
    elements.fftReadout.textContent = String(state.fftSize);
  }

  function applyLineColor() {
    document.documentElement.style.setProperty("--accent", state.lineColor);
    beatLight.color.set(state.lineColor);
    if (state.spectrogramMesh) state.spectrogramMesh.material.uniforms.uColor.value.set(state.lineColor);
  }

  function applyLineOpacity() {
    if (state.spectrogramMesh) state.spectrogramMesh.material.uniforms.uOpacity.value = state.lineOpacity;
  }

  function applySmoothing() {
    if (state.analyser) state.analyser.smoothingTimeConstant = state.smoothing;
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

  App.analysis = {
    rebuildSpectrogram,
    resetSpectrogramData,
    analyzeFrame,
    updateLineWidths,
    applyFftSize,
    applyLineColor,
    applyLineOpacity,
    applySmoothing,
    updateVisualDynamics,
  };
})();
