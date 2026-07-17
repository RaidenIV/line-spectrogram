(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { THREE, elements, state, visualRoot, controls, camera, beatLight } = App.core;
  const { CONSTANTS } = App.config;
  const { SPECTROGRAM_WIDTH, SPECTROGRAM_GROUP_Z, SCALE_LERP_FACTOR } = CONSTANTS;
  const { clamp, lerp } = App.utils;

  const colorModeIds = { single: 0, frequency: 1, amplitude: 2, depth: 3 };
  const isPointMode = () => state.renderMode === "points";
  const isSurfaceMode = () => state.renderMode === "wire" || state.renderMode === "solid";
  let offlineFftReal = null;
  let offlineFftImag = null;
  let offlineFftMagnitudes = null;

  function clearSpectrogram(disposeResources = true) {
    if (!state.spectrogramMesh) return;
    if (disposeResources) {
      state.spectrogramMesh.geometry.dispose();
      state.spectrogramMesh.material.dispose();
    }
    visualRoot.remove(state.spectrogramMesh);
    state.spectrogramMesh = null;
    state.spectrogramPositionAttribute = null;
  }

  function createSpectrogramMaterial() {
    const isPoints = state.renderMode === "points";
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uColor: { value: new THREE.Color(state.lineColor) },
        uOpacity: { value: state.lineOpacity },
        uHead: { value: 0 },
        uHistoryLines: { value: state.historyLines },
        uDepthSpan: { value: state.historyDepth },
        uRowSpacing: { value: state.rowSpacing },
        uDepthCurve: { value: state.depthCurve },
        uDepthOpacity: { value: state.depthOpacity },
        uDepthBrightness: { value: state.depthBrightness },
        uDepthHeightDecay: { value: state.depthHeightDecay },
        uDepthFog: { value: state.depthFog },
        uColorMode: { value: colorModeIds[state.colorMode] || 0 },
        uHeightScale: { value: state.heightScale },
        uTransient: { value: 0 },
        uPointMode: { value: isPoints ? 1 : 0 },
        uOrderedRows: { value: isSurfaceMode() ? 1 : 0 },
        uPointSize: { value: Math.max(1, state.lineWidth * 7) },
      },
      vertexShader: `
        attribute float historySlot;
        uniform float uHead;
        uniform float uHistoryLines;
        uniform float uDepthSpan;
        uniform float uRowSpacing;
        uniform float uDepthCurve;
        uniform float uDepthHeightDecay;
        uniform float uHeightScale;
        uniform float uPointSize;
        uniform float uOrderedRows;
        varying float vAge;
        varying float vFrequency;
        varying float vAmplitude;
        #include <fog_pars_vertex>

        void main() {
          float age = uOrderedRows > 0.5
            ? historySlot
            : mod(historySlot - uHead + uHistoryLines, uHistoryLines);
          float normalizedAge = age / max(1.0, uHistoryLines - 1.0);
          float curvedAge = pow(normalizedAge, max(0.05, uDepthCurve));
          vec3 transformed = position;
          transformed.z = -curvedAge * uDepthSpan * uRowSpacing;
          transformed.y *= max(0.0, 1.0 - normalizedAge * uDepthHeightDecay);
          vAge = normalizedAge;
          vFrequency = clamp((position.x / ${SPECTROGRAM_WIDTH.toFixed(1)}) + 0.5, 0.0, 1.0);
          vAmplitude = clamp(abs(position.y) / max(1.0, uHeightScale), 0.0, 1.0);
          vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = uPointSize;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uDepthOpacity;
        uniform float uDepthBrightness;
        uniform float uDepthFog;
        uniform float uTransient;
        uniform int uColorMode;
        uniform float uPointMode;
        varying float vAge;
        varying float vFrequency;
        varying float vAmplitude;
        #include <common>
        #include <fog_pars_fragment>

        vec3 frequencyColor(float amount) {
          vec3 low = vec3(0.08, 0.24, 1.0);
          vec3 mid = vec3(0.75, 0.08, 1.0);
          vec3 high = vec3(1.0, 0.12, 0.03);
          return amount < 0.5
            ? mix(low, mid, amount * 2.0)
            : mix(mid, high, (amount - 0.5) * 2.0);
        }

        void main() {
          if (uPointMode > 0.5 && distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
          vec3 color = uColor;
          if (uColorMode == 1) color = frequencyColor(vFrequency);
          else if (uColorMode == 2) color = mix(uColor * 0.22, min(vec3(1.0), uColor * 1.8), vAmplitude);
          else if (uColorMode == 3) color = mix(min(vec3(1.0), uColor * 1.3), vec3(0.06, 0.07, 0.09), vAge);

          float brightness = mix(1.0, max(0.02, uDepthBrightness), vAge);
          float alphaFade = mix(1.0, max(0.0, 1.0 - vAge), uDepthOpacity);
          float fogFade = 1.0 - vAge * uDepthFog;
          color *= brightness * (1.0 + uTransient * 0.55);
          gl_FragColor = vec4(color, uOpacity * alphaFade * fogFade);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: state.renderMode !== "solid",
      depthWrite: state.renderMode === "solid",
      blending: state.renderMode === "solid" ? THREE.NormalBlending : THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      // Keep the spectrogram color independent of camera distance.
      // Age-based depth fading remains controlled by uDepthFog above.
      fog: false,
      toneMapped: false,
      wireframe: state.renderMode === "wire",
    });
    return material;
  }

  function createSpectrogramGeometry() {
    const bins = state.frequencyBins;
    const rows = state.historyLines;

    if (isPointMode() || isSurfaceMode()) {
      const totalVertices = rows * bins;
      const positions = new Float32Array(totalVertices * 3);
      const historySlots = new Uint16Array(totalVertices);
      for (let row = 0; row < rows; row += 1) {
        for (let index = 0; index < bins; index += 1) {
          const vertex = row * bins + index;
          const offset = vertex * 3;
          positions[offset] = (index / Math.max(1, bins - 1) - 0.5) * SPECTROGRAM_WIDTH;
          positions[offset + 1] = 0;
          positions[offset + 2] = 0;
          historySlots[vertex] = row;
        }
      }
      const geometry = new THREE.BufferGeometry();
      const positionAttribute = new THREE.BufferAttribute(positions, 3);
      positionAttribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute("position", positionAttribute);
      geometry.setAttribute("historySlot", new THREE.BufferAttribute(historySlots, 1));

      if (isSurfaceMode()) {
        const indexCount = Math.max(0, rows - 1) * Math.max(0, bins - 1) * 6;
        const indices = totalVertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
        let write = 0;
        for (let row = 0; row < rows - 1; row += 1) {
          for (let index = 0; index < bins - 1; index += 1) {
            const current = row * bins + index;
            const nextRow = current + bins;
            indices[write++] = current;
            indices[write++] = nextRow;
            indices[write++] = current + 1;
            indices[write++] = current + 1;
            indices[write++] = nextRow;
            indices[write++] = nextRow + 1;
          }
        }
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      return geometry;
    }

    const verticesPerRow = bins * 2;
    const totalVertices = rows * verticesPerRow;
    const positions = new Float32Array(totalVertices * 3);
    const historySlots = new Uint16Array(totalVertices);
    const indexCount = rows * Math.max(0, bins - 1) * 6;
    const indices = totalVertices > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    const widthScale = state.renderMode === "lines" ? 0.38 : 1;
    const halfWidth = state.lineWidth * widthScale / 2;

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

  function rebuildSpectrogram(options = {}) {
    clearSpectrogram(options.dispose !== false);
    const geometry = createSpectrogramGeometry();
    const material = createSpectrogramMaterial();
    const object = state.renderMode === "points"
      ? new THREE.Points(geometry, material)
      : new THREE.Mesh(geometry, material);
    object.position.z = SPECTROGRAM_GROUP_Z;
    object.frustumCulled = false;
    visualRoot.add(object);
    state.spectrogramMesh = object;
    state.spectrogramPositionAttribute = geometry.getAttribute("position");
    state.spectrogramHead = 0;
    state.spectrumMapKey = "";
    elements.binsReadout.textContent = String(state.frequencyBins);
    resetSpectrogramData();
    applyAppearance();
  }

  function resetSpectrogramData() {
    const attribute = state.spectrogramPositionAttribute;
    if (attribute) {
      const positions = attribute.array;
      if (isPointMode() || isSurfaceMode()) {
        for (let vertex = 0; vertex < positions.length / 3; vertex += 1) positions[vertex * 3 + 1] = 0;
      } else {
        const widthScale = state.renderMode === "lines" ? 0.38 : 1;
        const halfWidth = state.lineWidth * widthScale / 2;
        const totalPoints = state.historyLines * state.frequencyBins;
        for (let index = 0; index < totalPoints; index += 1) {
          const upper = index * 6 + 1;
          positions[upper] = halfWidth;
          positions[upper + 3] = -halfWidth;
        }
      }
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, positions.length);
      attribute.needsUpdate = true;
    }
    state.spectrogramHead = 0;
    if (state.spectrogramMesh) state.spectrogramMesh.material.uniforms.uHead.value = 0;
    state.energy = 0;
    state.peak = 0;
    state.bassEnergy = 0;
    state.peakFrequency = 0.5;
    state.smoothedEnergy = 0;
    state.energyAverage = 0.02;
    state.adaptiveGain = 1;
    state.previousPeak = 0;
    state.beatFlash = 0;
    state.transientFlash = 0;
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
      const mappedRatio = state.logFrequency ? (Math.exp(ratio * Math.log(13)) - 1) / 12 : ratio;
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

  function applyAmplitudeProcessing(output) {
    let currentPeak = 0;
    for (let index = 0; index < output.length; index += 1) currentPeak = Math.max(currentPeak, output[index]);

    let gain = state.inputGain;
    if (state.amplitudeMode === "track") {
      gain *= 0.9 / Math.max(0.08, state.trackPeak || 1);
    } else if (state.amplitudeMode === "adaptive") {
      const target = clamp(0.76 / Math.max(0.04, currentPeak), 0.35, 7);
      state.adaptiveGain += (target - state.adaptiveGain) * (target > state.adaptiveGain ? 0.06 : 0.015);
      gain *= state.adaptiveGain;
    }

    const floor = clamp(state.noiseFloor, 0, 0.95);
    const exponent = clamp(60 / Math.max(12, state.dynamicRange), 0.35, 3);
    for (let index = 0; index < output.length; index += 1) {
      const lifted = clamp((output[index] * gain - floor) / Math.max(0.001, 1 - floor), 0, 1);
      output[index] = Math.pow(lifted, exponent);
    }
    return output;
  }

  function sampleSpectrum(outputLength) {
    ensureSpectrumSamplingMap(outputLength);
    const output = state.spectrumOutput;
    output.fill(0);
    if (!state.analyser || !state.frequencyData) return output;

    state.analyser.getByteFrequencyData(state.frequencyData);
    if ((state.showHud || state.exportActive) && state.waveformData) state.analyser.getByteTimeDomainData(state.waveformData);

    const source = state.frequencyData;
    const sampled = state.spectrumSampled;
    const { starts, ends, centers, radii, inverseWeightSums, mirrorIndices } = state.spectrumMap;
    for (let index = 0; index < sampled.length; index += 1) {
      const center = centers[index];
      const radius = radii[index];
      let sum = 0;
      for (let sourceIndex = starts[index]; sourceIndex <= ends[index]; sourceIndex += 1) {
        const distance = Math.abs(sourceIndex - center) / Math.max(1, radius);
        sum += source[sourceIndex] * Math.max(0.1, 1 - distance * 0.65);
      }
      sampled[index] = sum * inverseWeightSums[index] / 255;
    }
    if (mirrorIndices) {
      for (let index = 0; index < outputLength; index += 1) output[index] = sampled[mirrorIndices[index]];
    } else output.set(sampled);
    applyAmplitudeProcessing(output);
    state.lastSpectrum = output;
    return output;
  }

  function updateMetricsAndGeometry(spectrum) {
    let energySum = 0;
    let weightedFrequency = 0;
    let frequencyWeight = 0;
    let peak = 0;
    let peakIndex = 0;
    let bassSum = 0;
    const bassCount = Math.max(1, Math.floor(spectrum.length * 0.18));

    for (let index = 0; index < spectrum.length; index += 1) {
      const value = spectrum[index];
      energySum += value * value;
      if (index < bassCount) bassSum += value * value;
      if (value > peak) {
        peak = value;
        peakIndex = index;
      }
      weightedFrequency += index * value;
      frequencyWeight += value;
    }

    const rms = Math.sqrt(energySum / Math.max(1, spectrum.length));
    state.energy = rms;
    state.peak = peak;
    state.bassEnergy = Math.sqrt(bassSum / bassCount);
    state.peakFrequency = peakIndex / Math.max(1, spectrum.length - 1);
    state.smoothedEnergy += (rms - state.smoothedEnergy) * 0.22;
    state.energyAverage += (rms - state.energyAverage) * 0.025;
    state.spectralCentroid = frequencyWeight > 0
      ? weightedFrequency / frequencyWeight / Math.max(1, spectrum.length - 1)
      : 0.5;

    const isBeat = rms > Math.max(0.075, state.energyAverage * 1.38) && peak > 0.32;
    if (isBeat) state.beatFlash = 1;
    const transientThreshold = Math.max(0.02, state.previousPeak * state.transientSensitivity);
    if (peak > transientThreshold && peak - state.previousPeak > 0.035) state.transientFlash = 1;
    state.previousPeak += (peak - state.previousPeak) * 0.32;

    const attribute = state.spectrogramPositionAttribute;
    if (!attribute || !state.spectrogramMesh) return;
    const uniforms = state.spectrogramMesh.material.uniforms;
    uniforms.uTransient.value = state.transientHighlight ? state.transientFlash * state.transientIntensity : 0;

    const positions = attribute.array;
    const beatBoost = state.beatPulse ? state.beatFlash * 0.16 : 0;
    const transientBoost = state.transientHighlight ? state.transientFlash * state.transientIntensity : 0;
    const denominator = Math.max(1, state.frequencyBins - 1);
    const heightFor = (index) => {
      const shaped = Math.pow(spectrum[index], 1.7);
      const bassBias = 1 + (1 - index / denominator) * beatBoost;
      return shaped * state.heightScale * bassBias * (1 + transientBoost);
    };

    if (isSurfaceMode()) {
      const rowStride = state.frequencyBins * 3;
      positions.copyWithin(rowStride, 0, rowStride * Math.max(0, state.historyLines - 1));
      for (let index = 0; index < state.frequencyBins; index += 1) positions[index * 3 + 1] = heightFor(index);
      state.spectrogramHead = 0;
      uniforms.uHead.value = 0;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, positions.length);
      attribute.needsUpdate = true;
    } else if (isPointMode()) {
      state.spectrogramHead = (state.spectrogramHead - 1 + state.historyLines) % state.historyLines;
      uniforms.uHead.value = state.spectrogramHead;
      const rowOffset = state.spectrogramHead * state.frequencyBins * 3;
      for (let index = 0; index < state.frequencyBins; index += 1) positions[rowOffset + index * 3 + 1] = heightFor(index);
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(rowOffset, state.frequencyBins * 3);
      attribute.needsUpdate = true;
    } else {
      state.spectrogramHead = (state.spectrogramHead - 1 + state.historyLines) % state.historyLines;
      uniforms.uHead.value = state.spectrogramHead;
      const rowOffset = state.spectrogramHead * state.frequencyBins * 6;
      const widthScale = state.renderMode === "lines" ? 0.38 : 1;
      const halfWidth = state.lineWidth * widthScale * (1 + transientBoost * 0.7) / 2;
      for (let index = 0; index < state.frequencyBins; index += 1) {
        const height = heightFor(index);
        const upper = rowOffset + index * 6 + 1;
        positions[upper] = height + halfWidth;
        positions[upper + 3] = height - halfWidth;
      }
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(rowOffset, state.frequencyBins * 6);
      attribute.needsUpdate = true;
    }
    elements.energyReadout.textContent = rms.toFixed(2);
    elements.peakReadout.textContent = peak.toFixed(2);
  }

  function analyzeFrame() {
    updateMetricsAndGeometry(sampleSpectrum(state.frequencyBins));
  }

  function ensureOfflineFft(size) {
    if (offlineFftReal?.length === size) return;
    offlineFftReal = new Float32Array(size);
    offlineFftImag = new Float32Array(size);
    offlineFftMagnitudes = new Float32Array(size / 2);
  }

  function fftInPlace(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i += 1) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    for (let length = 2; length <= n; length <<= 1) {
      const angle = -2 * Math.PI / length;
      const wLengthReal = Math.cos(angle);
      const wLengthImag = Math.sin(angle);
      for (let start = 0; start < n; start += length) {
        let wReal = 1;
        let wImag = 0;
        for (let offset = 0; offset < length / 2; offset += 1) {
          const even = start + offset;
          const odd = even + length / 2;
          const oddReal = real[odd] * wReal - imag[odd] * wImag;
          const oddImag = real[odd] * wImag + imag[odd] * wReal;
          const evenReal = real[even];
          const evenImag = imag[even];
          real[even] = evenReal + oddReal;
          imag[even] = evenImag + oddImag;
          real[odd] = evenReal - oddReal;
          imag[odd] = evenImag - oddImag;
          const nextWReal = wReal * wLengthReal - wImag * wLengthImag;
          wImag = wReal * wLengthImag + wImag * wLengthReal;
          wReal = nextWReal;
        }
      }
    }
  }

  function sampleDecodedSpectrumAtTime(timeSeconds, outputLength = state.frequencyBins) {
    const buffer = state.decodedAudioBuffer;
    const output = new Float32Array(outputLength);
    if (!buffer) return output;
    const fftSize = Math.min(4096, Math.max(512, 2 ** Math.round(Math.log2(Math.min(state.fftSize, 4096)))));
    ensureOfflineFft(fftSize);
    const centerSample = Math.round(clamp(timeSeconds, 0, buffer.duration) * buffer.sampleRate);
    const startSample = centerSample - Math.floor(fftSize / 2);
    let rmsSum = 0;

    for (let index = 0; index < fftSize; index += 1) {
      const sampleIndex = startSample + index;
      let value = 0;
      if (sampleIndex >= 0 && sampleIndex < buffer.length) {
        for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) value += buffer.getChannelData(channel)[sampleIndex] || 0;
        value /= Math.max(1, buffer.numberOfChannels);
      }
      rmsSum += value * value;
      const windowValue = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / Math.max(1, fftSize - 1));
      offlineFftReal[index] = value * windowValue;
      offlineFftImag[index] = 0;
    }
    fftInPlace(offlineFftReal, offlineFftImag);
    let maximum = 1e-9;
    for (let index = 0; index < offlineFftMagnitudes.length; index += 1) {
      const magnitude = Math.hypot(offlineFftReal[index], offlineFftImag[index]);
      offlineFftMagnitudes[index] = magnitude;
      maximum = Math.max(maximum, magnitude);
    }
    const envelope = clamp(Math.sqrt(rmsSum / fftSize) * 4.2, 0, 1);
    const effectiveLength = state.mirrorFrequency ? Math.ceil(outputLength / 2) : outputLength;
    const sampled = new Float32Array(effectiveLength);
    for (let index = 0; index < effectiveLength; index += 1) {
      const ratio = index / Math.max(1, effectiveLength - 1);
      const mapped = state.logFrequency ? (Math.exp(ratio * Math.log(13)) - 1) / 12 : ratio;
      const position = mapped * (offlineFftMagnitudes.length - 1) * 0.88;
      const lower = Math.floor(position);
      const upper = Math.min(offlineFftMagnitudes.length - 1, lower + 1);
      sampled[index] = lerp(offlineFftMagnitudes[lower], offlineFftMagnitudes[upper], position - lower) / maximum * envelope;
    }
    if (state.mirrorFrequency) {
      for (let index = 0; index < outputLength; index += 1) {
        const distance = Math.abs(index - (outputLength - 1) / 2);
        const normalized = 1 - distance / Math.max(1, (outputLength - 1) / 2);
        output[index] = sampled[Math.min(sampled.length - 1, Math.floor(normalized * (sampled.length - 1)))];
      }
    } else output.set(sampled);
    applyAmplitudeProcessing(output);
    return output;
  }

  function analyzeOfflineAtTime(timeSeconds) {
    const spectrum = sampleDecodedSpectrumAtTime(timeSeconds, state.frequencyBins);
    state.lastSpectrum = spectrum;
    updateMetricsAndGeometry(spectrum);
    if (state.waveformData && state.decodedAudioBuffer) {
      const channel = state.decodedAudioBuffer.getChannelData(0);
      const center = Math.floor(clamp(timeSeconds / state.decodedAudioBuffer.duration, 0, 1) * channel.length);
      for (let index = 0; index < state.waveformData.length; index += 1) {
        const sourceIndex = clamp(center + index - Math.floor(state.waveformData.length / 2), 0, channel.length - 1);
        state.waveformData[index] = Math.round(clamp(channel[sourceIndex] * 0.5 + 0.5, 0, 1) * 255);
      }
    }
    return spectrum;
  }

  function updateLineWidths() {
    const attribute = state.spectrogramPositionAttribute;
    if (!attribute || isPointMode() || isSurfaceMode()) {
      if (state.spectrogramMesh) state.spectrogramMesh.material.uniforms.uPointSize.value = Math.max(1, state.lineWidth * 7);
      return;
    }
    const positions = attribute.array;
    const widthScale = state.renderMode === "lines" ? 0.38 : 1;
    const halfWidth = state.lineWidth * widthScale / 2;
    const totalPoints = state.historyLines * state.frequencyBins;
    for (let index = 0; index < totalPoints; index += 1) {
      const upper = index * 6 + 1;
      const center = (positions[upper] + positions[upper + 3]) / 2;
      positions[upper] = center + halfWidth;
      positions[upper + 3] = center - halfWidth;
    }
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, positions.length);
    attribute.needsUpdate = true;
    state.spectrogramMesh.material.uniforms.uPointSize.value = Math.max(1, state.lineWidth * 7);
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

  function applyAppearance() {
    const material = state.spectrogramMesh?.material;
    if (!material?.uniforms) return;
    const uniforms = material.uniforms;
    uniforms.uOpacity.value = state.lineOpacity;
    uniforms.uDepthSpan.value = state.historyDepth;
    uniforms.uRowSpacing.value = state.rowSpacing;
    uniforms.uDepthCurve.value = state.depthCurve;
    uniforms.uDepthOpacity.value = state.depthOpacity;
    uniforms.uDepthBrightness.value = state.depthBrightness;
    uniforms.uDepthHeightDecay.value = state.depthHeightDecay;
    uniforms.uDepthFog.value = state.depthFog;
    uniforms.uColorMode.value = colorModeIds[state.colorMode] || 0;
    uniforms.uHeightScale.value = state.heightScale;
    uniforms.uPointSize.value = Math.max(1, state.lineWidth * 7);
  }

  function applyLineOpacity() {
    applyAppearance();
  }

  function applySmoothing() {
    if (state.analyser) state.analyser.smoothingTimeConstant = state.smoothing;
  }

  function getCameraFollowValue() {
    if (state.cameraFollowSource === "energy") return clamp(state.smoothedEnergy * 1.8, 0, 1);
    if (state.cameraFollowSource === "bass") return clamp(state.bassEnergy * 1.8, 0, 1);
    if (state.cameraFollowSource === "peakFrequency") return state.peakFrequency;
    return state.spectralCentroid;
  }

  function interpolateCameraKeyframes(timeSeconds) {
    const keyframes = state.cameraKeyframes;
    if (keyframes.length < 2) return false;
    const duration = Math.max(0.001, Number(elements.audio.duration) || keyframes[keyframes.length - 1].time || 1);
    const time = clamp(timeSeconds, 0, duration);
    let right = keyframes.findIndex((keyframe) => keyframe.time >= time);
    if (right <= 0) right = 1;
    if (right < 0) right = keyframes.length - 1;
    const left = Math.max(0, right - 1);
    const a = keyframes[left];
    const b = keyframes[right];
    const amount = clamp((time - a.time) / Math.max(0.001, b.time - a.time), 0, 1);
    camera.position.set(
      lerp(a.position[0], b.position[0], amount),
      lerp(a.position[1], b.position[1], amount),
      lerp(a.position[2], b.position[2], amount),
    );
    controls.target.set(
      lerp(a.target[0], b.target[0], amount),
      lerp(a.target[1], b.target[1], amount),
      lerp(a.target[2], b.target[2], amount),
    );
    return true;
  }

  function updateVisualDynamics(delta, forcedTime = null) {
    state.beatFlash = Math.max(0, state.beatFlash - delta * 3.4);
    state.transientFlash = Math.max(0, state.transientFlash - delta * state.transientDecay);
    const targetScale = state.beatPulse ? 1 + state.beatFlash * 0.018 : 1;
    const nextScale = visualRoot.scale.x + (targetScale - visualRoot.scale.x) * SCALE_LERP_FACTOR;
    visualRoot.scale.setScalar(nextScale);
    beatLight.intensity = state.beatPulse ? state.beatFlash * 3.2 : 0;
    if (state.spectrogramMesh) state.spectrogramMesh.material.uniforms.uTransient.value = state.transientHighlight ? state.transientFlash * state.transientIntensity : 0;

    const time = forcedTime ?? elements.audio.currentTime ?? 0;
    state.cameraMotionPhase += delta * state.cameraMotionSpeed;
    if (state.cameraMotion === "keyframes" && interpolateCameraKeyframes(time)) {
      controls.update();
      return;
    }

    const basePosition = state.cameraBasePosition || camera.position;
    const baseTarget = state.cameraBaseTarget || controls.target;
    if (state.cameraMotion === "slowOrbit") {
      const radius = Math.max(40, state.cameraDistance * 0.62);
      camera.position.x = baseTarget.x + Math.sin(state.cameraMotionPhase) * radius;
      camera.position.z = baseTarget.z + Math.cos(state.cameraMotionPhase) * radius;
      camera.position.y += (state.cameraHeight - camera.position.y) * 0.03;
    } else if (state.cameraMotion === "forwardDrift") {
      camera.position.z = basePosition.z - (Math.sin(state.cameraMotionPhase) * 0.5 + 0.5) * 45;
    } else if (state.cameraMotion === "sideSweep") {
      camera.position.x = basePosition.x + Math.sin(state.cameraMotionPhase) * 72;
    }

    if ((state.autoCamera || state.cameraMotion === "audioFollow") && (state.isPlaying || forcedTime !== null)) {
      const followValue = getCameraFollowValue();
      const targetX = (followValue - 0.5) * 42 * state.cameraDrift;
      controls.target.x += (targetX - controls.target.x) * 0.025;
      camera.position.x += (targetX * 0.65 - camera.position.x) * 0.012;
    }
  }

  App.analysis = {
    rebuildSpectrogram,
    resetSpectrogramData,
    analyzeFrame,
    analyzeOfflineAtTime,
    sampleDecodedSpectrumAtTime,
    updateLineWidths,
    applyFftSize,
    applyLineColor,
    applyLineOpacity,
    applyAppearance,
    applySmoothing,
    updateVisualDynamics,
  };
})();
