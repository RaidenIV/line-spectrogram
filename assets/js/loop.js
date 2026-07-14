(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { clamp, formatTime } = App.utils;

  const LOOP_MIN_SECONDS = 0.05;
  const BPM_MIN = 40;
  const BPM_MAX = 300;
  const DEFAULT_PEAK_COUNT = 4096;

  let modal = null;
  let modalContext = null;
  let modalGain = null;
  let modalSource = null;
  let modalAnimation = 0;
  let modalResizeObserver = null;
  let modalDocumentMove = null;
  let modalDocumentUp = null;
  let modalDocumentKey = null;

  let editor = null;

  function getTrackDuration() {
    const duration = Number(elements.audio.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
    return Number(state.decodedAudioBuffer?.duration) || 0;
  }

  function getLoopBeatDuration(bpm = state.loopBpm) {
    const tempo = Number(bpm);
    return tempo > 0 ? 60 / tempo : 0;
  }

  function getLoopBarDuration(bpm = state.loopBpm) {
    return getLoopBeatDuration(bpm) * 4;
  }

  function getSelectedLoopRange() {
    const trackDuration = getTrackDuration();
    if (!state.loopReady || trackDuration <= 0) {
      return { start: 0, end: trackDuration, duration: trackDuration };
    }

    const start = clamp(Number(state.loopStart) || 0, 0, trackDuration);
    const end = clamp(Number(state.loopEnd) || trackDuration, start, trackDuration);
    return { start, end, duration: Math.max(0, end - start) };
  }

  function hasPartialLoopSelection() {
    const trackDuration = getTrackDuration();
    const range = getSelectedLoopRange();
    return Boolean(
      state.loopReady &&
      range.duration > LOOP_MIN_SECONDS &&
      range.duration < trackDuration - 0.01
    );
  }

  function updateAudioLoopMode() {
    // A selected region is enforced manually so the media element can loop a
    // subsection. Native loop remains reserved for a full-track loop.
    elements.audio.loop = Boolean(state.audioLoop && !hasPartialLoopSelection());
  }

  function setLoopStatus(message, tone = "idle") {
    if (!elements.loopStatus) return;
    elements.loopStatus.textContent = message;
    elements.loopStatus.dataset.tone = tone;
  }

  function syncLoopButton() {
    const duration = getTrackDuration();
    const range = getSelectedLoopRange();
    const enabled = Boolean(state.loopReady && state.decodedAudioBuffer && duration > 0);
    const active = Boolean(enabled && state.audioLoop && hasPartialLoopSelection());

    elements.loopButton.disabled = !enabled;
    elements.loopButton.classList.toggle("loop-active", active);
    elements.loopButton.setAttribute("aria-pressed", String(active));
    elements.loopButton.setAttribute(
      "aria-label",
      enabled ? (active ? "Edit active loop region" : "Open loop editor") : "Loop editor unavailable"
    );
    elements.loopButton.title = enabled
      ? (active ? "Edit active loop region" : "Open loop editor")
      : "Load a decodable audio file to create a loop";

    if (elements.loopEditorButton) {
      elements.loopEditorButton.disabled = !enabled;
      elements.loopEditorButton.classList.toggle("is-active", active);
      elements.loopEditorButton.textContent = !enabled
        ? "LOOP EDITOR UNAVAILABLE"
        : active
          ? "EDIT ACTIVE LOOP"
          : "OPEN LOOP EDITOR";
      elements.loopEditorButton.setAttribute("aria-pressed", String(active));
      elements.loopEditorButton.title = elements.loopButton.title;
    }

    if (!enabled) {
      setLoopStatus("Load and analyze audio to create a loop.", "idle");
    } else if (!state.audioLoop) {
      setLoopStatus("Loop off. Open the editor to select a region.", "idle");
    } else if (active) {
      setLoopStatus(
        `Loop on · ${formatTime(range.start)}–${formatTime(range.end)} · ${range.duration.toFixed(2)} s`,
        "active"
      );
    } else {
      setLoopStatus("Full-track loop enabled.", "active");
    }
  }

  function buildWaveformPeaks(buffer, peakCount = DEFAULT_PEAK_COUNT) {
    if (!buffer || buffer.length <= 0) return null;

    const count = Math.max(256, Math.floor(peakCount));
    const peaks = new Float32Array(count);
    const channels = Array.from(
      { length: buffer.numberOfChannels },
      (_, channelIndex) => buffer.getChannelData(channelIndex)
    );
    const samplesPerPeak = Math.max(1, buffer.length / count);

    for (let peakIndex = 0; peakIndex < count; peakIndex += 1) {
      const start = Math.floor(peakIndex * samplesPerPeak);
      const end = Math.min(
        buffer.length,
        Math.max(start + 1, Math.floor((peakIndex + 1) * samplesPerPeak))
      );
      const stride = Math.max(1, Math.floor((end - start) / 160));
      let peak = 0;

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += stride) {
        for (const channel of channels) {
          peak = Math.max(peak, Math.abs(channel[sampleIndex] || 0));
        }
      }
      peaks[peakIndex] = peak;
    }

    return peaks;
  }

  function initializeLoopSelection(buffer) {
    const duration = Number(buffer?.duration) || 0;
    state.decodedAudioBuffer = buffer || null;
    state.loopReady = duration > 0;
    state.audioLoop = false;
    state.loopStart = 0;
    state.loopBpm = Number(state.loopBpm) || 125;
    state.loopBars = Math.max(1, Math.round(Number(state.loopBars) || 4));
    state.loopSnap = true;
    state.loopEnd = Math.min(
      duration,
      Math.max(LOOP_MIN_SECONDS, getLoopBarDuration(state.loopBpm) * state.loopBars)
    );
    state.loopWaveformPeaks = buildWaveformPeaks(buffer);
    updateAudioLoopMode();
    syncLoopButton();
  }

  function resetLoopState() {
    closeEditor();
    state.audioLoop = false;
    state.loopStart = 0;
    state.loopEnd = 0;
    state.loopReady = false;
    state.loopWrapPending = false;
    state.decodedAudioBuffer = null;
    state.loopWaveformPeaks = null;
    elements.audio.loop = false;
    syncLoopButton();
  }

  function applyLoop(start, end, options = {}) {
    const duration = getTrackDuration();
    if (!state.loopReady || duration <= 0) return;

    const nextStart = clamp(Number(start) || 0, 0, duration);
    const nextEnd = clamp(Number(end) || duration, nextStart + LOOP_MIN_SECONDS, duration);
    state.loopStart = nextStart;
    state.loopEnd = nextEnd;
    state.loopBpm = clamp(Number(options.bpm) || state.loopBpm || 125, BPM_MIN, BPM_MAX);
    state.loopBars = Math.max(1, Math.round(Number(options.bars) || state.loopBars || 4));
    state.loopSnap = options.snap !== undefined ? Boolean(options.snap) : state.loopSnap;
    state.audioLoop = nextEnd - nextStart >= LOOP_MIN_SECONDS;

    updateAudioLoopMode();

    if (
      state.audioLoop &&
      (elements.audio.currentTime < nextStart || elements.audio.currentTime >= nextEnd)
    ) {
      elements.audio.currentTime = nextStart;
      App.analysis.resetSpectrogramData();
      App.playback.updateSeekUi();
    }

    syncLoopButton();
  }

  function clearLoop() {
    const duration = getTrackDuration();
    state.audioLoop = false;
    state.loopStart = 0;
    state.loopEnd = duration;
    elements.audio.loop = false;
    syncLoopButton();
  }

  function enforceSelectedLoop() {
    if (
      state.exportActive ||
      !state.audioLoop ||
      !hasPartialLoopSelection() ||
      elements.audio.paused ||
      elements.audio.ended ||
      state.loopWrapPending
    ) {
      return;
    }

    const range = getSelectedLoopRange();
    if (
      elements.audio.currentTime < range.start - 0.04 ||
      elements.audio.currentTime >= range.end - 0.012
    ) {
      const overflow = elements.audio.currentTime >= range.end
        ? Math.max(0, elements.audio.currentTime - range.end)
        : 0;
      const wrappedTime = clamp(
        range.start + overflow,
        range.start,
        Math.max(range.start, range.end - 0.001)
      );

      state.loopWrapPending = true;
      elements.audio.currentTime = wrappedTime;
      App.analysis.resetSpectrogramData();
      App.playback.updateSeekUi();
      window.setTimeout(() => {
        state.loopWrapPending = false;
      }, 120);
    }
  }

  async function detectBpm(buffer) {
    if (!buffer) throw new Error("No decoded audio is available.");

    const sampleRate = buffer.sampleRate;
    const maxLength = Math.min(buffer.length, Math.floor(sampleRate * 90));
    const mono = new Float32Array(maxLength);

    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
      const channel = buffer.getChannelData(channelIndex);
      for (let index = 0; index < maxLength; index += 1) mono[index] += channel[index] || 0;
    }
    if (buffer.numberOfChannels > 1) {
      const scale = 1 / buffer.numberOfChannels;
      for (let index = 0; index < maxLength; index += 1) mono[index] *= scale;
    }

    let filtered = mono;
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (OfflineContext) {
      try {
        const offline = new OfflineContext(1, maxLength, sampleRate);
        const sourceBuffer = offline.createBuffer(1, maxLength, sampleRate);
        sourceBuffer.getChannelData(0).set(mono);
        const source = offline.createBufferSource();
        const lowPass = offline.createBiquadFilter();
        lowPass.type = "lowpass";
        lowPass.frequency.value = 180;
        lowPass.Q.value = 0.8;
        source.buffer = sourceBuffer;
        source.connect(lowPass);
        lowPass.connect(offline.destination);
        source.start(0);
        const rendered = await offline.startRendering();
        filtered = rendered.getChannelData(0);
      } catch (error) {
        console.warn("BPM low-pass preprocessing was unavailable; using the mono signal.", error);
      }
    }

    const hopSize = 512;
    const frameCount = Math.max(1, Math.floor(filtered.length / hopSize));
    const energy = new Float32Array(frameCount);
    let maximumEnergy = 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      const offset = frame * hopSize;
      let sum = 0;
      for (let index = 0; index < hopSize; index += 1) {
        const sample = filtered[offset + index] || 0;
        sum += sample * sample;
      }
      energy[frame] = sum;
      maximumEnergy = Math.max(maximumEnergy, sum);
    }

    if (maximumEnergy > 0) {
      for (let index = 0; index < energy.length; index += 1) energy[index] /= maximumEnergy;
    }

    const framesPerSecond = sampleRate / hopSize;
    const minimumLag = Math.max(2, Math.floor(framesPerSecond * 60 / 200));
    const maximumLag = Math.min(
      frameCount - 1,
      Math.ceil(framesPerSecond * 60 / 60)
    );

    let bestLag = minimumLag;
    let bestCorrelation = -Infinity;
    for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
      let correlation = 0;
      const limit = frameCount - lag;
      for (let index = 0; index < limit; index += 1) {
        correlation += energy[index] * energy[index + lag];
      }
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    let tempo = bestLag > 0 ? 60 * framesPerSecond / bestLag : state.loopBpm;
    while (tempo < 80) tempo *= 2;
    while (tempo > 160) tempo /= 2;
    return clamp(Math.round(tempo || 125), BPM_MIN, BPM_MAX);
  }

  function formatPreciseTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const remainder = (safe % 60).toFixed(3).padStart(6, "0");
    return `${minutes}:${remainder}`;
  }

  function createEditorState() {
    const buffer = state.decodedAudioBuffer;
    const duration = Number(buffer?.duration) || 0;
    const activeRange = getSelectedLoopRange();
    const hasExistingLoop = Boolean(state.audioLoop && activeRange.duration > LOOP_MIN_SECONDS);
    const bpm = clamp(Number(state.loopBpm) || 125, BPM_MIN, BPM_MAX);
    const bars = Math.max(1, Math.round(Number(state.loopBars) || 4));
    const defaultEnd = Math.min(duration, getLoopBarDuration(bpm) * bars);

    return {
      buffer,
      duration,
      peaks: state.loopWaveformPeaks || buildWaveformPeaks(buffer),
      bpm,
      bars,
      snap: state.loopSnap !== false,
      start: hasExistingLoop ? activeRange.start : 0,
      end: hasExistingLoop ? activeRange.end : Math.max(LOOP_MIN_SECONDS, defaultEnd),
      zoomStart: 0,
      zoomEnd: duration,
      previewTime: hasExistingLoop ? activeRange.start : 0,
      previewPlaying: false,
      previewLoop: true,
      previewVolume: Math.round(state.volume * 100),
      previewMuted: state.muted,
      forceLoopStart: true,
      dragType: "",
      dragStartX: 0,
      dragInitialStart: 0,
      dragInitialEnd: 0,
      width: 0,
      height: 0,
      minimapWidth: 0,
      minimapHeight: 0,
      wasMainPlaying: !elements.audio.paused,
      hasExistingLoop,
      dragMoved: false,
    };
  }

  function buildEditorMarkup() {
    return `
      <div class="loop-editor" role="dialog" aria-modal="true" aria-labelledby="loopEditorTitle">
        <header class="loop-editor__header">
          <div>
            <p class="loop-editor__eyebrow">AUDIO LOOP EDITOR</p>
            <h2 id="loopEditorTitle">Loop Region</h2>
          </div>
          <button class="loop-editor__icon-button" id="loopEditorClose" type="button" aria-label="Close loop editor">×</button>
        </header>

        <section class="loop-editor__wave-section">
          <div class="loop-editor__section-header">
            <span>WAVEFORM / LOOP REGION</span>
            <div class="loop-editor__zoom-controls" aria-label="Waveform zoom controls">
              <button type="button" id="loopZoomOut" aria-label="Zoom out">−</button>
              <output id="loopZoomLevel">1.0×</output>
              <button type="button" id="loopZoomIn" aria-label="Zoom in">+</button>
              <button type="button" id="loopZoomFit">FIT</button>
            </div>
          </div>

          <div class="loop-editor__waveform" id="loopWaveformWrap">
            <canvas id="loopWaveformCanvas"></canvas>
            <div class="loop-editor__playhead" id="loopPlayhead" aria-hidden="true"></div>
            <button class="loop-editor__handle loop-editor__handle--start" id="loopStartHandle" type="button" aria-label="Adjust loop start">
              <span id="loopStartTag">0:00.000</span>
            </button>
            <button class="loop-editor__handle loop-editor__handle--end" id="loopEndHandle" type="button" aria-label="Adjust loop end">
              <span id="loopEndTag">0:00.000</span>
            </button>
            <div class="loop-editor__analysis" id="loopAnalysisStatus">
              <span class="loop-editor__analysis-dots" aria-hidden="true"><i></i><i></i><i></i></span>
              <span>Analyzing tempo…</span>
            </div>
          </div>

          <button class="loop-editor__minimap" id="loopMinimapWrap" type="button" aria-label="Move waveform zoom window">
            <canvas id="loopMinimapCanvas"></canvas>
          </button>

          <button class="loop-editor__progress" id="loopProgress" type="button" aria-label="Seek preview">
            <span id="loopProgressFill"></span>
          </button>
          <div class="loop-editor__time-row">
            <span id="loopPreviewTime">0:00.000</span>
            <span id="loopTrackDuration">0:00.000</span>
          </div>
        </section>

        <section class="loop-editor__controls">
          <div class="loop-editor__control-block">
            <span class="loop-editor__label">PREVIEW</span>
            <div class="loop-editor__transport">
              <button class="loop-editor__button loop-editor__button--primary" id="loopPreviewPlay" type="button">▶ PLAY</button>
              <button class="loop-editor__button" id="loopPreviewStop" type="button">■ STOP</button>
            </div>
            <label class="loop-editor__toggle-row" for="loopPreviewToggle">
              <span>Loop Preview</span>
              <input id="loopPreviewToggle" type="checkbox" checked />
            </label>
            <label class="loop-editor__toggle-row" for="loopForceStart">
              <span>Always Start At Loop</span>
              <input id="loopForceStart" type="checkbox" checked />
            </label>
            <div class="loop-editor__volume-row">
              <button id="loopPreviewMute" type="button" aria-label="Mute loop preview">VOL</button>
              <input id="loopPreviewVolume" type="range" min="0" max="100" value="85" aria-label="Loop preview volume" />
              <output id="loopPreviewVolumeValue">85%</output>
            </div>
          </div>

          <div class="loop-editor__control-block">
            <span class="loop-editor__label">TEMPO</span>
            <label class="loop-editor__field" for="loopBpmInput">
              <span>BPM</span>
              <input id="loopBpmInput" type="number" min="40" max="300" step="1" value="125" />
            </label>
            <button class="loop-editor__button" id="loopDetectBpm" type="button">DETECT BPM</button>
            <label class="loop-editor__toggle-row" for="loopSnapToggle">
              <span>Snap To Beats</span>
              <input id="loopSnapToggle" type="checkbox" checked />
            </label>
          </div>

          <div class="loop-editor__control-block">
            <span class="loop-editor__label">LENGTH</span>
            <div class="loop-editor__stepper">
              <button id="loopBarsDecrease" type="button" aria-label="Decrease loop bars">−</button>
              <input id="loopBarsInput" type="number" min="1" max="999" value="4" aria-label="Loop length in bars" />
              <span>BARS</span>
              <button id="loopBarsIncrease" type="button" aria-label="Increase loop bars">+</button>
            </div>
            <div class="loop-editor__range-info" id="loopRangeInfo">0.00s → 0.00s</div>
          </div>
        </section>

        <div class="loop-editor__stats">
          <span>RATE <strong id="loopSampleRate">—</strong></span>
          <span>DURATION <strong id="loopDurationStat">—</strong></span>
          <span>LOOP <strong id="loopRangeStat">—</strong></span>
          <span>BEAT <strong id="loopBeatStat">—</strong></span>
        </div>

        <footer class="loop-editor__actions">
          <button class="loop-editor__button" id="loopCancel" type="button">CANCEL</button>
          <button class="loop-editor__button" id="loopClear" type="button">CLEAR LOOP</button>
          <button class="loop-editor__button loop-editor__button--accent" id="loopApply" type="button">APPLY LOOP</button>
        </footer>
      </div>
    `;
  }

  function query(id) {
    return modal?.querySelector(`#${id}`) || null;
  }

  function timeToX(time) {
    if (!editor || editor.zoomEnd <= editor.zoomStart || editor.width <= 0) return 0;
    return ((time - editor.zoomStart) / (editor.zoomEnd - editor.zoomStart)) * editor.width;
  }

  function xToTime(x) {
    if (!editor || editor.width <= 0) return 0;
    const ratio = clamp(x / editor.width, 0, 1);
    return editor.zoomStart + ratio * (editor.zoomEnd - editor.zoomStart);
  }

  function snapTime(time) {
    if (!editor?.snap || editor.bpm <= 0) return time;
    const beat = getLoopBeatDuration(editor.bpm);
    return beat > 0 ? Math.round(time / beat) * beat : time;
  }

  function updateEditorStats() {
    if (!editor) return;
    const duration = Math.max(0, editor.end - editor.start);
    query("loopStartTag").textContent = formatPreciseTime(editor.start);
    query("loopEndTag").textContent = formatPreciseTime(editor.end);
    query("loopRangeInfo").textContent = `${editor.start.toFixed(2)}s → ${editor.end.toFixed(2)}s · ${duration.toFixed(3)}s`;
    query("loopRangeStat").textContent = `${editor.start.toFixed(2)}–${editor.end.toFixed(2)}s`;
    query("loopBeatStat").textContent = `${getLoopBeatDuration(editor.bpm).toFixed(3)}s`;
    query("loopBpmInput").value = String(Math.round(editor.bpm));
    query("loopBarsInput").value = String(editor.bars);
    query("loopBarsInput").max = String(maximumBarsFrom(editor.start));
    query("loopSnapToggle").checked = editor.snap;
  }

  function updateHandles() {
    if (!editor || editor.width <= 0) return;
    const startPercent = clamp(timeToX(editor.start) / editor.width * 100, 0, 100);
    const endPercent = clamp(timeToX(editor.end) / editor.width * 100, 0, 100);
    query("loopStartHandle").style.left = `${startPercent}%`;
    query("loopEndHandle").style.left = `${endPercent}%`;
    updateEditorStats();
  }

  function drawWaveform() {
    if (!editor) return;
    const canvas = query("loopWaveformCanvas");
    if (!canvas || editor.width <= 0 || editor.height <= 0) return;
    const context = canvas.getContext("2d");
    const width = editor.width;
    const height = editor.height;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#080808";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(255,255,255,0.055)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, height / 2 + 0.5);
    context.lineTo(width, height / 2 + 0.5);
    context.stroke();

    if (!editor.peaks || !editor.buffer) return;

    if (editor.bpm > 0) {
      const beatDuration = getLoopBeatDuration(editor.bpm);
      let beatTime = Math.floor(editor.zoomStart / beatDuration) * beatDuration;
      let beatIndex = Math.round(beatTime / beatDuration);
      for (; beatTime <= editor.zoomEnd; beatTime += beatDuration, beatIndex += 1) {
        const x = timeToX(beatTime);
        const isBar = beatIndex % 4 === 0;
        context.strokeStyle = isBar ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
        context.beginPath();
        context.moveTo(x + 0.5, 0);
        context.lineTo(x + 0.5, height);
        context.stroke();
      }
    }

    const selectionStartX = timeToX(editor.start);
    const selectionEndX = timeToX(editor.end);
    context.fillStyle = "rgba(255,42,26,0.09)";
    context.fillRect(selectionStartX, 0, selectionEndX - selectionStartX, height);

    const peakCount = editor.peaks.length;
    const duration = editor.duration;
    const visibleStartIndex = Math.floor(editor.zoomStart / duration * peakCount);
    const visibleEndIndex = Math.ceil(editor.zoomEnd / duration * peakCount);
    const visibleCount = Math.max(1, visibleEndIndex - visibleStartIndex);

    for (let x = 0; x < width; x += 1) {
      const index = Math.min(
        peakCount - 1,
        visibleStartIndex + Math.floor(x / Math.max(1, width - 1) * visibleCount)
      );
      const peak = editor.peaks[index] || 0;
      const sampleTime = xToTime(x);
      const selected = sampleTime >= editor.start && sampleTime <= editor.end;
      const lineHeight = Math.max(1, peak * height * 0.86);
      context.fillStyle = selected
        ? `rgba(255,${Math.round(82 + peak * 80)},${Math.round(58 + peak * 48)},${0.62 + peak * 0.34})`
        : `rgba(120,120,120,${0.22 + peak * 0.45})`;
      context.fillRect(x, (height - lineHeight) / 2, 1, lineHeight);
    }

    context.strokeStyle = "rgba(255,42,26,0.92)";
    context.lineWidth = 1;
    for (const x of [selectionStartX, selectionEndX]) {
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
    }
  }

  function drawMinimap() {
    if (!editor) return;
    const canvas = query("loopMinimapCanvas");
    if (!canvas || editor.minimapWidth <= 0 || editor.minimapHeight <= 0) return;
    const context = canvas.getContext("2d");
    const width = editor.minimapWidth;
    const height = editor.minimapHeight;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#080808";
    context.fillRect(0, 0, width, height);
    if (!editor.peaks || editor.duration <= 0) return;

    for (let x = 0; x < width; x += 1) {
      const peakIndex = Math.min(
        editor.peaks.length - 1,
        Math.floor(x / Math.max(1, width - 1) * editor.peaks.length)
      );
      const peak = editor.peaks[peakIndex] || 0;
      const time = x / width * editor.duration;
      const selected = time >= editor.start && time <= editor.end;
      const lineHeight = Math.max(1, peak * height * 0.82);
      context.fillStyle = selected
        ? `rgba(255,42,26,${0.35 + peak * 0.5})`
        : `rgba(130,130,130,${0.18 + peak * 0.42})`;
      context.fillRect(x, (height - lineHeight) / 2, 1, lineHeight);
    }

    const windowX = editor.zoomStart / editor.duration * width;
    const windowWidth = (editor.zoomEnd - editor.zoomStart) / editor.duration * width;
    context.fillStyle = "rgba(255,255,255,0.045)";
    context.fillRect(windowX, 0, windowWidth, height);
    context.strokeStyle = "rgba(255,255,255,0.42)";
    context.strokeRect(windowX + 0.5, 0.5, Math.max(1, windowWidth - 1), height - 1);

    const playheadX = editor.previewTime / editor.duration * width;
    context.strokeStyle = "rgba(255,255,255,0.68)";
    context.beginPath();
    context.moveTo(playheadX + 0.5, 0);
    context.lineTo(playheadX + 0.5, height);
    context.stroke();
  }

  function updatePlayhead() {
    if (!editor) return;
    query("loopPreviewTime").textContent = formatPreciseTime(editor.previewTime);
    const progress = editor.duration > 0 ? clamp(editor.previewTime / editor.duration, 0, 1) : 0;
    query("loopProgressFill").style.width = `${progress * 100}%`;

    const x = timeToX(editor.previewTime);
    const playhead = query("loopPlayhead");
    playhead.style.left = `${x}px`;
    playhead.hidden = x < 0 || x > editor.width;
    drawMinimap();
  }

  function updateZoomLabel() {
    if (!editor) return;
    const visibleDuration = Math.max(0.001, editor.zoomEnd - editor.zoomStart);
    const zoom = editor.duration / visibleDuration;
    query("loopZoomLevel").textContent = `${zoom < 10 ? zoom.toFixed(1) : zoom.toFixed(0)}×`;
  }

  function setZoomWindow(start, end) {
    if (!editor || editor.duration <= 0) return;
    const minimumWidth = Math.max(0.1, editor.duration / 64);
    const width = clamp(end - start, minimumWidth, editor.duration);
    let nextStart = clamp(start, 0, Math.max(0, editor.duration - width));
    let nextEnd = nextStart + width;
    if (nextEnd > editor.duration) {
      nextEnd = editor.duration;
      nextStart = Math.max(0, nextEnd - width);
    }
    editor.zoomStart = nextStart;
    editor.zoomEnd = nextEnd;
    updateZoomLabel();
    updateHandles();
    drawWaveform();
    drawMinimap();
    updatePlayhead();
  }

  function zoomAroundX(x, factor) {
    if (!editor) return;
    const anchor = xToTime(x);
    const currentWidth = editor.zoomEnd - editor.zoomStart;
    const nextWidth = clamp(currentWidth / factor, editor.duration / 64, editor.duration);
    const relative = currentWidth > 0 ? (anchor - editor.zoomStart) / currentWidth : 0.5;
    setZoomWindow(anchor - nextWidth * relative, anchor + nextWidth * (1 - relative));
  }

  function resizeEditorCanvases() {
    if (!editor || !modal) return;
    const waveformWrap = query("loopWaveformWrap");
    const minimapWrap = query("loopMinimapWrap");
    if (!waveformWrap || !minimapWrap) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const waveformRect = waveformWrap.getBoundingClientRect();
    const minimapRect = minimapWrap.getBoundingClientRect();
    editor.width = Math.max(1, waveformRect.width);
    editor.height = Math.max(1, waveformRect.height);
    editor.minimapWidth = Math.max(1, minimapRect.width);
    editor.minimapHeight = Math.max(1, minimapRect.height);

    const waveformCanvas = query("loopWaveformCanvas");
    waveformCanvas.width = Math.round(editor.width * dpr);
    waveformCanvas.height = Math.round(editor.height * dpr);
    waveformCanvas.style.width = `${editor.width}px`;
    waveformCanvas.style.height = `${editor.height}px`;
    waveformCanvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);

    const minimapCanvas = query("loopMinimapCanvas");
    minimapCanvas.width = Math.round(editor.minimapWidth * dpr);
    minimapCanvas.height = Math.round(editor.minimapHeight * dpr);
    minimapCanvas.style.width = `${editor.minimapWidth}px`;
    minimapCanvas.style.height = `${editor.minimapHeight}px`;
    minimapCanvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);

    drawWaveform();
    drawMinimap();
    updateHandles();
    updatePlayhead();
  }

  function maximumBarsFrom(start = editor?.start || 0) {
    if (!editor || editor.bpm <= 0) return 999;
    const barDuration = getLoopBarDuration(editor.bpm);
    return Math.max(1, Math.floor((editor.duration - start) / barDuration + 1e-6));
  }

  function applyBarsToRange() {
    if (!editor) return;
    editor.bars = clamp(Math.round(editor.bars), 1, maximumBarsFrom(editor.start));
    const desiredDuration = Math.min(
      editor.duration,
      getLoopBarDuration(editor.bpm) * editor.bars
    );
    if (editor.start + desiredDuration > editor.duration) {
      editor.start = Math.max(0, editor.duration - desiredDuration);
    }
    editor.end = Math.min(editor.duration, editor.start + desiredDuration);
    updateHandles();
    drawWaveform();
    drawMinimap();
    restartPreviewIfPlaying();
  }

  function setHandleTime(type, time) {
    if (!editor) return;
    const snapped = snapTime(time);
    if (type === "start") {
      editor.start = clamp(snapped, 0, editor.end - LOOP_MIN_SECONDS);
    } else if (type === "end") {
      editor.end = clamp(snapped, editor.start + LOOP_MIN_SECONDS, editor.duration);
    } else if (type === "region") {
      const duration = editor.dragInitialEnd - editor.dragInitialStart;
      const offset = snapped - editor.dragInitialStart;
      let start = editor.dragInitialStart + offset;
      start = clamp(start, 0, Math.max(0, editor.duration - duration));
      editor.start = start;
      editor.end = start + duration;
    }

    updateHandles();
    drawWaveform();
    drawMinimap();
    if (editor.previewPlaying && modalSource && editor.previewLoop) {
      modalSource.loopStart = editor.start;
      modalSource.loopEnd = editor.end;
    }
  }

  function beginDrag(type, event) {
    if (!editor) return;
    editor.dragType = type;
    editor.dragStartX = event.clientX;
    editor.dragInitialStart = editor.start;
    editor.dragInitialEnd = editor.end;
    editor.dragMoved = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDocumentMove(event) {
    if (!editor?.dragType) return;
    if (Math.abs(event.clientX - editor.dragStartX) > 2) editor.dragMoved = true;
    const rect = query("loopWaveformWrap").getBoundingClientRect();
    const deltaTime = (event.clientX - editor.dragStartX) / rect.width * (editor.zoomEnd - editor.zoomStart);

    if (editor.dragType === "start") {
      setHandleTime("start", editor.dragInitialStart + deltaTime);
    } else if (editor.dragType === "end") {
      setHandleTime("end", editor.dragInitialEnd + deltaTime);
    } else if (editor.dragType === "region") {
      const duration = editor.dragInitialEnd - editor.dragInitialStart;
      let nextStart = editor.dragInitialStart + deltaTime;
      if (editor.snap) nextStart = snapTime(nextStart);
      nextStart = clamp(nextStart, 0, Math.max(0, editor.duration - duration));
      editor.start = nextStart;
      editor.end = nextStart + duration;
      updateHandles();
      drawWaveform();
      drawMinimap();
    }
  }

  function handleDocumentUp() {
    if (!editor?.dragType) return;
    editor.dragType = "";
    restartPreviewIfPlaying();
  }

  function getPreviewTime() {
    if (!editor?.previewPlaying || !modalContext) return editor?.previewTime || 0;
    const elapsed = modalContext.currentTime - editor.previewContextStartedAt;
    if (editor.previewLoop) {
      const loopDuration = editor.end - editor.start;
      if (loopDuration > 0) {
        return editor.start + (((elapsed - editor.start) % loopDuration) + loopDuration) % loopDuration;
      }
    }
    return Math.min(editor.duration, elapsed);
  }

  function animatePreview() {
    if (!editor?.previewPlaying) return;
    editor.previewTime = getPreviewTime();
    updatePlayhead();
    modalAnimation = requestAnimationFrame(animatePreview);
  }

  function createPreviewSource(offset) {
    if (!editor || !modalContext || !modalGain) return null;
    const source = modalContext.createBufferSource();
    source.buffer = editor.buffer;
    source.loop = editor.previewLoop;
    if (editor.previewLoop) {
      source.loopStart = editor.start;
      source.loopEnd = editor.end;
    }
    source.connect(modalGain);
    source.start(0, offset);
    source.onended = () => {
      if (!editor?.previewPlaying || editor.previewLoop) return;
      stopPreview(false);
    };
    return source;
  }

  async function playPreview() {
    if (!editor || !modalContext) return;
    if (modalContext.state === "suspended") await modalContext.resume();
    if (editor.forceLoopStart || (editor.previewLoop && (editor.previewTime < editor.start || editor.previewTime >= editor.end))) {
      editor.previewTime = editor.start;
    }

    modalSource?.stop();
    modalSource = createPreviewSource(editor.previewTime);
    editor.previewContextStartedAt = modalContext.currentTime - editor.previewTime;
    editor.previewPlaying = true;
    query("loopPreviewPlay").textContent = "Ⅱ PAUSE";
    query("loopPreviewPlay").classList.add("is-playing");
    cancelAnimationFrame(modalAnimation);
    modalAnimation = requestAnimationFrame(animatePreview);
  }

  function pausePreview() {
    if (!editor?.previewPlaying) return;
    editor.previewTime = getPreviewTime();
    editor.previewPlaying = false;
    if (modalSource) {
      modalSource.onended = null;
      try { modalSource.stop(); } catch (_) {}
      modalSource = null;
    }
    cancelAnimationFrame(modalAnimation);
    modalAnimation = 0;
    query("loopPreviewPlay").textContent = "▶ PLAY";
    query("loopPreviewPlay").classList.remove("is-playing");
    updatePlayhead();
  }

  function stopPreview(resetToLoop = true) {
    if (!editor) return;
    pausePreview();
    editor.previewTime = resetToLoop ? editor.start : Math.min(editor.previewTime, editor.duration);
    updatePlayhead();
  }

  function restartPreviewIfPlaying() {
    if (!editor?.previewPlaying) return;
    pausePreview();
    editor.previewTime = editor.start;
    playPreview().catch(console.error);
  }

  function seekPreview(time) {
    if (!editor) return;
    const wasPlaying = editor.previewPlaying;
    if (wasPlaying) pausePreview();
    editor.previewTime = clamp(time, 0, editor.duration);
    updatePlayhead();
    if (wasPlaying) playPreview().catch(console.error);
  }

  async function runBpmDetection() {
    if (!editor) return;
    const status = query("loopAnalysisStatus");
    const detectButton = query("loopDetectBpm");
    status.hidden = false;
    detectButton.disabled = true;
    try {
      editor.bpm = await detectBpm(editor.buffer);
      applyBarsToRange();
    } catch (error) {
      console.error(error);
    } finally {
      status.hidden = true;
      detectButton.disabled = false;
      updateEditorStats();
      drawWaveform();
    }
  }

  function wireEditorEvents() {
    query("loopEditorClose").addEventListener("click", closeEditor);
    query("loopCancel").addEventListener("click", closeEditor);
    query("loopClear").addEventListener("click", () => {
      clearLoop();
      closeEditor();
    });
    query("loopApply").addEventListener("click", () => {
      applyLoop(editor.start, editor.end, {
        bpm: editor.bpm,
        bars: editor.bars,
        snap: editor.snap,
      });
      closeEditor();
    });

    query("loopPreviewPlay").addEventListener("click", () => {
      if (editor.previewPlaying) pausePreview();
      else playPreview().catch(console.error);
    });
    query("loopPreviewStop").addEventListener("click", () => stopPreview(true));
    query("loopPreviewToggle").addEventListener("change", (event) => {
      editor.previewLoop = event.target.checked;
      restartPreviewIfPlaying();
    });
    query("loopForceStart").addEventListener("change", (event) => {
      editor.forceLoopStart = event.target.checked;
    });
    query("loopPreviewMute").addEventListener("click", () => {
      editor.previewMuted = !editor.previewMuted;
      if (modalGain) modalGain.gain.value = editor.previewMuted ? 0 : editor.previewVolume / 100;
      query("loopPreviewMute").classList.toggle("is-muted", editor.previewMuted);
      query("loopPreviewMute").textContent = editor.previewMuted ? "MUTE" : "VOL";
    });
    query("loopPreviewVolume").addEventListener("input", (event) => {
      editor.previewVolume = clamp(Number(event.target.value), 0, 100);
      query("loopPreviewVolumeValue").textContent = `${editor.previewVolume}%`;
      if (modalGain && !editor.previewMuted) modalGain.gain.value = editor.previewVolume / 100;
    });

    const commitBpm = () => {
      const next = clamp(Number(query("loopBpmInput").value) || editor.bpm, BPM_MIN, BPM_MAX);
      editor.bpm = next;
      applyBarsToRange();
    };
    query("loopBpmInput").addEventListener("change", commitBpm);
    query("loopBpmInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    });
    query("loopDetectBpm").addEventListener("click", () => runBpmDetection());
    query("loopSnapToggle").addEventListener("change", (event) => {
      editor.snap = event.target.checked;
      updateEditorStats();
    });

    const commitBars = () => {
      editor.bars = Math.max(1, Math.round(Number(query("loopBarsInput").value) || editor.bars));
      applyBarsToRange();
    };
    query("loopBarsInput").addEventListener("change", commitBars);
    query("loopBarsInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.currentTarget.blur();
    });
    query("loopBarsDecrease").addEventListener("click", () => {
      editor.bars = Math.max(1, editor.bars - 1);
      applyBarsToRange();
    });
    query("loopBarsIncrease").addEventListener("click", () => {
      editor.bars = Math.min(maximumBarsFrom(editor.start), editor.bars + 1);
      applyBarsToRange();
    });

    query("loopZoomIn").addEventListener("click", () => zoomAroundX(editor.width / 2, 2));
    query("loopZoomOut").addEventListener("click", () => zoomAroundX(editor.width / 2, 0.5));
    query("loopZoomFit").addEventListener("click", () => setZoomWindow(0, editor.duration));
    query("loopWaveformWrap").addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      zoomAroundX(event.clientX - rect.left, event.deltaY < 0 ? 1.6 : 0.625);
    }, { passive: false });
    query("loopWaveformWrap").addEventListener("click", (event) => {
      if (editor.dragType || editor.dragMoved) {
        editor.dragMoved = false;
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      seekPreview(xToTime(event.clientX - rect.left));
    });
    query("loopProgress").addEventListener("click", (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      seekPreview((event.clientX - rect.left) / rect.width * editor.duration);
    });
    query("loopMinimapWrap").addEventListener("click", (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const center = (event.clientX - rect.left) / rect.width * editor.duration;
      const width = editor.zoomEnd - editor.zoomStart;
      setZoomWindow(center - width / 2, center + width / 2);
    });

    query("loopStartHandle").addEventListener("pointerdown", (event) => beginDrag("start", event));
    query("loopEndHandle").addEventListener("pointerdown", (event) => beginDrag("end", event));
    query("loopStartHandle").addEventListener("click", (event) => event.stopPropagation());
    query("loopEndHandle").addEventListener("click", (event) => event.stopPropagation());
    query("loopWaveformCanvas").addEventListener("pointerdown", (event) => {
      const rect = query("loopWaveformWrap").getBoundingClientRect();
      const time = xToTime(event.clientX - rect.left);
      if (time >= editor.start && time <= editor.end) beginDrag("region", event);
    });

    modalDocumentMove = handleDocumentMove;
    modalDocumentUp = handleDocumentUp;
    document.addEventListener("pointermove", modalDocumentMove);
    document.addEventListener("pointerup", modalDocumentUp);

    modalDocumentKey = (event) => {
      if (!modal) return;
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeEditor();
      } else if (event.code === "Space" && !typing) {
        event.preventDefault();
        event.stopPropagation();
        if (editor.previewPlaying) pausePreview();
        else playPreview().catch(console.error);
      }
    };
    document.addEventListener("keydown", modalDocumentKey, true);
  }

  function openEditor() {
    if (modal || state.exportActive || !state.loopReady || !state.decodedAudioBuffer) return;

    elements.audio.pause();
    editor = createEditorState();
    modal = document.createElement("div");
    modal.className = "loop-editor-overlay";
    modal.id = "loopEditorOverlay";
    modal.innerHTML = buildEditorMarkup();
    document.body.appendChild(modal);

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      modalContext = new AudioContextClass();
      modalGain = modalContext.createGain();
      modalGain.gain.value = editor.previewMuted ? 0 : editor.previewVolume / 100;
      modalGain.connect(modalContext.destination);
    }

    query("loopPreviewVolume").value = String(editor.previewVolume);
    query("loopPreviewVolumeValue").textContent = `${editor.previewVolume}%`;
    query("loopPreviewMute").classList.toggle("is-muted", editor.previewMuted);
    query("loopPreviewMute").textContent = editor.previewMuted ? "MUTE" : "VOL";
    query("loopBpmInput").value = String(Math.round(editor.bpm));
    query("loopBarsInput").value = String(editor.bars);
    query("loopBarsInput").max = String(maximumBarsFrom(editor.start));
    query("loopSnapToggle").checked = editor.snap;
    query("loopTrackDuration").textContent = formatPreciseTime(editor.duration);
    query("loopSampleRate").textContent = `${editor.buffer.sampleRate} HZ`;
    query("loopDurationStat").textContent = formatTime(editor.duration);
    query("loopAnalysisStatus").hidden = true;

    wireEditorEvents();
    updateZoomLabel();
    updateEditorStats();

    modalResizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(resizeEditorCanvases)
      : null;
    modalResizeObserver?.observe(query("loopWaveformWrap"));
    modalResizeObserver?.observe(query("loopMinimapWrap"));
    window.setTimeout(resizeEditorCanvases, 30);

    query("loopEditorClose").focus();
    if (!editor.hasExistingLoop) runBpmDetection();
  }

  function closeEditor() {
    if (!modal) return;
    pausePreview();
    modalResizeObserver?.disconnect();
    modalResizeObserver = null;
    if (modalDocumentMove) document.removeEventListener("pointermove", modalDocumentMove);
    if (modalDocumentUp) document.removeEventListener("pointerup", modalDocumentUp);
    if (modalDocumentKey) document.removeEventListener("keydown", modalDocumentKey, true);
    modalDocumentMove = null;
    modalDocumentUp = null;
    modalDocumentKey = null;
    try { modalContext?.close(); } catch (_) {}
    modalContext = null;
    modalGain = null;
    modalSource = null;
    modal.remove();
    modal = null;
    editor = null;
    (elements.loopEditorButton || elements.loopButton).focus();
  }

  App.loop = {
    getLoopBeatDuration,
    getLoopBarDuration,
    getSelectedLoopRange,
    hasPartialLoopSelection,
    updateAudioLoopMode,
    syncLoopButton,
    buildWaveformPeaks,
    initializeLoopSelection,
    resetLoopState,
    applyLoop,
    clearLoop,
    enforceSelectedLoop,
    detectBpm,
    openEditor,
    closeEditor,
  };
})();
