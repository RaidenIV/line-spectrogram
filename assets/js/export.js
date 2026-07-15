(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { THREE, elements, state, camera, controls } = App.core;
  const { DEFAULTS, OUTPUT_PRESETS, CONSTANTS } = App.config;
  const {
    parseResolution,
    sanitizeFileName,
    downloadBlob,
    dateStamp,
    setStatus,
    formatTime,
    formatBytes,
    estimateFileSizeBytes,
    clamp,
    sleep,
  } = App.utils;

  let exportCanvas = null;
  let exportContext = null;
  let exportStream = null;
  let recorder = null;
  let recordedChunks = [];
  let nextCaptureTime = 0;
  let playbackSnapshot = null;
  let activeMimeType = "";
  let exportFrameSerial = 0;
  let capturePulseTimer = 0;
  let pngExportActive = false;
  let offlineAbortController = null;

  function armExportHistory(element, label) {
    if (!element) return;
    const capture = () => {
      if (element.dataset.historyArmed === "true") return;
      App.stateManager?.record(label);
      element.dataset.historyArmed = "true";
    };
    element.addEventListener("pointerdown", capture);
    element.addEventListener("keydown", (event) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " ", "Enter"].includes(event.key)) capture();
    });
    element.addEventListener("change", () => { element.dataset.historyArmed = "false"; });
    element.addEventListener("blur", () => { element.dataset.historyArmed = "false"; });
  }

  function mimeCandidatesForFormat(format) {
    if (format === "mp4") {
      return [
        "video/mp4;codecs=h264,aac",
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
      ];
    }
    return [
      "video/x-matroska;codecs=vp9,opus",
      "video/x-matroska;codecs=vp8,opus",
      "video/x-matroska",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
  }

  function getSupportedMimeTypeForFormat(format) {
    return mimeCandidatesForFormat(format).find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
  }

  function getRequestedMimeType() {
    return getSupportedMimeTypeForFormat(elements.videoFormat.value);
  }

  function extensionForFormat(format) {
    return format === "mp4" ? "mp4" : "mkv";
  }

  function setExportControlsDisabled(disabled) {
    for (const element of [
      elements.outputPreset,
      elements.exportMode,
      elements.exportRange,
      elements.exportStart,
      elements.exportEnd,
      elements.exportFileName,
      elements.exportResolution,
      elements.videoFormat,
      elements.videoFps,
      elements.videoBitrate,
      elements.exportPng,
      elements.exportSettings,
      elements.importSettingsButton,
      elements.resetAll,
      elements.resetExport,
    ]) {
      if (element) element.disabled = disabled;
    }
  }

  function setPngExportActive(active) {
    pngExportActive = active;
    elements.exportVideo.disabled = active;
    elements.exportPng.disabled = active;
    elements.exportSettings.disabled = active;
  }

  function createExportRenderer(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const targetRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    targetRenderer.outputColorSpace = THREE.SRGBColorSpace;
    targetRenderer.setPixelRatio(1);
    targetRenderer.setSize(width, height, false);
    return targetRenderer;
  }

  function createCompositeCanvas(width, height, attach = true) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.setAttribute("aria-hidden", "true");
    if (attach) {
      canvas.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:0;";
      document.body.appendChild(canvas);
    }
    return canvas;
  }

  function pulseCaptureCanvas() {
    if (!exportCanvas || !exportContext) return;
    exportFrameSerial += 1;
    const value = exportFrameSerial % 2 === 0 ? 3 : 4;
    exportContext.fillStyle = `rgb(${value},${value},${value})`;
    exportContext.fillRect(exportCanvas.width - 1, exportCanvas.height - 1, 1, 1);
  }

  function renderLiveCompositeFrame(width, height, forceFrameChange = false) {
    if (!exportCanvas || !exportContext) return;
    exportContext.clearRect(0, 0, width, height);
    exportContext.drawImage(elements.canvas, 0, 0, width, height);
    App.hud.drawHud(exportContext, width, height, false, false);
    if (forceFrameChange) pulseCaptureCanvas();
  }

  function getExportRange() {
    const duration = Number(elements.audio.duration) || Number(state.decodedAudioBuffer?.duration) || 0;
    if (duration <= 0) return { start: 0, end: 0, duration: 0, label: "No audio" };
    if (state.exportRange === "loop") {
      if (!state.audioLoop || !App.loop.hasPartialLoopSelection()) {
        return { start: 0, end: duration, duration, label: "Full track" };
      }
      const range = App.loop.getSelectedLoopRange();
      return { start: range.start, end: range.end, duration: range.duration, label: "Active loop" };
    }
    if (state.exportRange === "custom") {
      const start = clamp(Number(elements.exportStart.value) || 0, 0, duration);
      const end = clamp(Number(elements.exportEnd.value) || duration, start, duration);
      return { start, end, duration: Math.max(0, end - start), label: "Custom range" };
    }
    return { start: 0, end: duration, duration, label: "Full track" };
  }

  function validateExportRange(range = getExportRange()) {
    if (!range.duration || range.duration < 0.05) {
      throw new Error("The selected export range is empty. Choose a valid start and end time.");
    }
    return range;
  }

  function updateCustomRangeVisibility() {
    const custom = elements.exportRange.value === "custom";
    elements.exportStartControl.hidden = !custom;
    elements.exportEndControl.hidden = !custom;
  }

  function updateExportEstimate() {
    const range = getExportRange();
    const { width, height } = parseResolution(elements.exportResolution.value, state.viewportFormat);
    const fps = Number(elements.videoFps.value) || 30;
    const bitrate = Number(elements.videoBitrate.value) || 16;
    const size = estimateFileSizeBytes(range.duration, bitrate);
    const pixelFactor = width * height / (1920 * 1080);
    const fpsFactor = fps / 30;
    const modeFactor = elements.exportMode.value === "offline" ? Math.max(0.45, pixelFactor * fpsFactor * 0.42) : 1;
    const timeSeconds = range.duration * modeFactor;
    elements.exportEstimateDuration.textContent = formatTime(range.duration, range.duration >= 3600);
    elements.exportEstimateSize.textContent = range.duration ? formatBytes(size) : "—";
    elements.exportEstimateTime.textContent = range.duration
      ? elements.exportMode.value === "realtime"
        ? `~${formatTime(timeSeconds, timeSeconds >= 3600)} real time`
        : `~${formatTime(timeSeconds, timeSeconds >= 3600)} estimated`
      : "—";
  }

  function showProgress({ title = "EXPORTING VIDEO", progress = 0, elapsed = 0, total = 0, frame = 0, totalFrames = 0, eta = 0 }) {
    const percent = Math.round(clamp(progress, 0, 1) * 100);
    elements.exportProgress.hidden = false;
    elements.exportProgressTitle.textContent = title;
    elements.exportProgressPercent.textContent = `${percent}%`;
    elements.exportProgressBar.value = percent;
    elements.exportProgressTime.textContent = `${formatTime(elapsed, total >= 3600)} / ${formatTime(total, total >= 3600)}`;
    elements.exportProgressFrame.textContent = totalFrames > 0 ? `${frame.toLocaleString()} / ${totalFrames.toLocaleString()}` : "REAL TIME";
    elements.exportProgressEta.textContent = eta > 0 ? formatTime(eta, eta >= 3600) : percent >= 100 ? "Complete" : "Calculating…";
  }

  function hideProgress() {
    elements.exportProgress.hidden = true;
  }

  function cleanupExportResources() {
    if (exportStream) for (const track of exportStream.getTracks()) track.stop();
    exportStream = null;
    window.clearInterval(capturePulseTimer);
    capturePulseTimer = 0;
    exportCanvas?.remove();
    exportCanvas = null;
    exportContext = null;
    recorder = null;
    recordedChunks = [];
    nextCaptureTime = 0;
    exportFrameSerial = 0;
  }

  function capturePlaybackSnapshot() {
    return {
      currentTime: elements.audio.currentTime,
      paused: elements.audio.paused,
      audioLoop: state.audioLoop,
      loopStart: state.loopStart,
      loopEnd: state.loopEnd,
      loopBpm: state.loopBpm,
      loopBars: state.loopBars,
      loopSnap: state.loopSnap,
      cameraPosition: camera.position.toArray(),
      cameraTarget: controls.target.toArray(),
    };
  }

  async function restorePlaybackSnapshot() {
    const snapshot = playbackSnapshot;
    playbackSnapshot = null;
    state.exportPlaybackTimeOverride = null;
    if (!snapshot) return;
    elements.audio.pause();
    state.audioLoop = snapshot.audioLoop;
    state.loopStart = snapshot.loopStart;
    state.loopEnd = snapshot.loopEnd;
    state.loopBpm = snapshot.loopBpm;
    state.loopBars = snapshot.loopBars;
    state.loopSnap = snapshot.loopSnap;
    App.loop.updateAudioLoopMode();
    App.loop.syncLoopButton();
    camera.position.fromArray(snapshot.cameraPosition);
    controls.target.fromArray(snapshot.cameraTarget);
    controls.update();
    state.cameraBasePosition = camera.position.clone();
    state.cameraBaseTarget = controls.target.clone();
    if (Number.isFinite(elements.audio.duration)) elements.audio.currentTime = Math.min(snapshot.currentTime, elements.audio.duration || snapshot.currentTime);
    App.analysis.resetSpectrogramData();
    App.playback.updateSeekUi();
    if (!snapshot.paused && state.hasAudio) {
      try {
        await App.playback.ensureAudioContextRunning();
        await elements.audio.play();
      } catch (error) {
        console.error(error);
      }
    }
  }

  async function finalizeVideoExport(cancelled) {
    state.exportActive = false;
    state.exportCancelled = cancelled;
    setExportControlsDisabled(false);
    elements.exportVideo.textContent = "EXPORT VIDEO";
    elements.exportVideo.classList.remove("is-recording");

    if (!cancelled && recordedChunks.length) {
      const blob = new Blob(recordedChunks, { type: activeMimeType || "video/webm" });
      const fileName = `${sanitizeFileName(elements.exportFileName.value)}-${dateStamp()}.${extensionForFormat(elements.videoFormat.value)}`;
      downloadBlob(blob, fileName);
      setStatus(elements.exportStatus, `Video exported: ${fileName}`);
      showProgress({ title: "EXPORT COMPLETE", progress: 1, elapsed: state.exportRangeEnd - state.exportRangeStart, total: state.exportRangeEnd - state.exportRangeStart, eta: 0 });
    } else if (cancelled) {
      setStatus(elements.exportStatus, "Video export cancelled.");
      hideProgress();
    } else {
      setStatus(elements.exportStatus, "Video export failed: no encoded data was produced.", true);
      hideProgress();
    }
    cleanupExportResources();
    await restorePlaybackSnapshot();
    App.playback.updatePlaybackUi();
    updateExportEstimate();
  }

  async function startRealTimeVideoExport() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error("Real-time video export is not supported by this browser.");
    }
    activeMimeType = getRequestedMimeType();
    if (!activeMimeType) throw new Error(`No supported ${elements.videoFormat.value.toUpperCase()} encoder was found in this browser.`);

    await App.playback.ensureAudioContextRunning();
    await App.hud.ensureLogoReady();
    const range = validateExportRange();
    const { width, height } = parseResolution(elements.exportResolution.value, state.viewportFormat);
    const fps = Number(elements.videoFps.value);
    const bitrate = Number(elements.videoBitrate.value) * 1_000_000;

    exportCanvas = createCompositeCanvas(width, height);
    exportContext = exportCanvas.getContext("2d", { alpha: false });
    renderLiveCompositeFrame(width, height, true);
    const videoStream = exportCanvas.captureStream(fps);
    const audioTrack = state.exportAudioDestination?.stream.getAudioTracks()[0];
    const tracks = [...videoStream.getVideoTracks()];
    if (audioTrack) tracks.push(audioTrack.clone());
    exportStream = new MediaStream(tracks);
    recordedChunks = [];
    recorder = new MediaRecorder(exportStream, { mimeType: activeMimeType, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 });
    recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) recordedChunks.push(event.data); });
    recorder.addEventListener("error", (event) => {
      console.error(event.error || event);
      setStatus(elements.exportStatus, `Video export error: ${event.error?.message || "encoder failure"}`, true);
    });
    recorder.addEventListener("stop", () => finalizeVideoExport(state.exportCancelled).catch(console.error), { once: true });

    playbackSnapshot = capturePlaybackSnapshot();
    state.exportActive = true;
    state.exportCancelled = false;
    state.exportProgress = 0;
    state.exportRangeStart = range.start;
    state.exportRangeEnd = range.end;
    state.exportStartedAt = performance.now();
    setExportControlsDisabled(true);
    elements.exportVideo.textContent = "CANCEL VIDEO EXPORT";
    elements.exportVideo.classList.add("is-recording");
    state.audioLoop = false;
    elements.audio.loop = false;
    App.loop.syncLoopButton();
    elements.audio.pause();
    elements.audio.currentTime = range.start;
    App.analysis.resetSpectrogramData();
    recorder.start(1000);
    nextCaptureTime = performance.now();
    capturePulseTimer = window.setInterval(pulseCaptureCanvas, 1000 / Math.max(1, fps));
    renderLiveCompositeFrame(width, height, true);
    await elements.audio.play();
    setStatus(elements.exportStatus, `Exporting ${range.label} at ${width} × ${height} and ${fps} FPS.`);
    showProgress({ title: "EXPORTING VIDEO", progress: 0, elapsed: 0, total: range.duration, totalFrames: Math.ceil(range.duration * fps), frame: 0 });
    App.playback.updatePlaybackUi();
  }

  async function loadMp4Muxer() {
    try {
      return await import("https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm");
    } catch (error) {
      throw new Error("The offline MP4 muxer could not be loaded. Check your internet connection or use Real Time export.");
    }
  }

  async function selectAvcConfig(width, height, bitrate, fps) {
    const codecs = ["avc1.640033", "avc1.4d0033", "avc1.42001f"];
    for (const codec of codecs) {
      const config = { codec, width, height, bitrate, framerate: fps, latencyMode: "quality", avc: { format: "avc" } };
      try {
        const result = await VideoEncoder.isConfigSupported(config);
        if (result.supported) return result.config;
      } catch (_) {}
    }
    throw new Error("The browser does not provide a compatible H.264 encoder for the selected resolution and frame rate.");
  }

  async function encodeOfflineAudio(audioEncoder, buffer, start, end) {
    const sampleRate = buffer.sampleRate;
    const channels = Math.min(2, Math.max(1, buffer.numberOfChannels));
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.min(buffer.length, Math.ceil(end * sampleRate));
    const blockSize = 2048;
    let timestamp = 0;
    for (let offset = startSample; offset < endSample; offset += blockSize) {
      if (offlineAbortController?.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      const frames = Math.min(blockSize, endSample - offset);
      const planar = new Float32Array(frames * channels);
      for (let channel = 0; channel < channels; channel += 1) {
        const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
        planar.set(source.subarray(offset, offset + frames), channel * frames);
      }
      const audioData = new AudioData({ format: "f32-planar", sampleRate, numberOfFrames: frames, numberOfChannels: channels, timestamp, data: planar });
      audioEncoder.encode(audioData);
      audioData.close();
      timestamp += Math.round(frames / sampleRate * 1_000_000);
      while (audioEncoder.encodeQueueSize > 8) await sleep(0);
    }
  }

  async function startOfflineVideoExport() {
    if (elements.videoFormat.value !== "mp4") throw new Error("High Quality Offline export currently requires MP4. Select MP4 or use Real Time mode for MKV.");
    if (!state.decodedAudioBuffer) throw new Error("High Quality Offline export requires decoded audio. Load a WAV or MP3 file that supports waveform analysis.");
    if (!window.VideoEncoder || !window.AudioEncoder || !window.VideoFrame || !window.AudioData) {
      throw new Error("High Quality Offline export requires WebCodecs support. Use a current version of Chrome or Edge.");
    }

    const range = validateExportRange();
    const { width, height } = parseResolution(elements.exportResolution.value, state.viewportFormat);
    const fps = Number(elements.videoFps.value);
    const bitrate = Number(elements.videoBitrate.value) * 1_000_000;
    const totalFrames = Math.max(1, Math.ceil(range.duration * fps));
    const frameDurationUs = Math.round(1_000_000 / fps);
    const muxerLibrary = await loadMp4Muxer();
    const videoConfig = await selectAvcConfig(width, height, bitrate, fps);
    const audioConfigResult = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: state.decodedAudioBuffer.sampleRate, numberOfChannels: Math.min(2, state.decodedAudioBuffer.numberOfChannels), bitrate: 192000 });
    if (!audioConfigResult.supported) throw new Error("The browser does not provide an AAC audio encoder required for offline MP4 export.");

    playbackSnapshot = capturePlaybackSnapshot();
    state.exportActive = true;
    state.exportCancelled = false;
    state.exportRangeStart = range.start;
    state.exportRangeEnd = range.end;
    state.exportStartedAt = performance.now();
    state.exportFrameIndex = 0;
    state.exportTotalFrames = totalFrames;
    offlineAbortController = new AbortController();
    setExportControlsDisabled(true);
    elements.exportVideo.textContent = "CANCEL VIDEO EXPORT";
    elements.exportVideo.classList.add("is-recording");
    elements.audio.pause();
    App.analysis.resetSpectrogramData();

    const offscreenRenderer = createExportRenderer(width, height);
    const composite = createCompositeCanvas(width, height, false);
    const context = composite.getContext("2d", { alpha: false });
    const target = new muxerLibrary.ArrayBufferTarget();
    const muxer = new muxerLibrary.Muxer({
      target,
      video: { codec: "avc", width, height },
      audio: { codec: "aac", sampleRate: state.decodedAudioBuffer.sampleRate, numberOfChannels: Math.min(2, state.decodedAudioBuffer.numberOfChannels) },
      fastStart: "in-memory",
    });
    let encoderError = null;
    const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (error) => { encoderError = error; } });
    const audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (error) => { encoderError = error; } });
    videoEncoder.configure(videoConfig);
    audioEncoder.configure(audioConfigResult.config);

    try {
      const audioPromise = encodeOfflineAudio(audioEncoder, state.decodedAudioBuffer, range.start, range.end);
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
        if (offlineAbortController.signal.aborted) throw new DOMException("Export cancelled", "AbortError");
        if (encoderError) throw encoderError;
        const time = Math.min(range.end, range.start + frameIndex / fps);
        state.exportPlaybackTimeOverride = time;
        App.analysis.analyzeOfflineAtTime(time);
        App.analysis.updateVisualDynamics(1 / fps, time);
        App.renderer.renderSceneTo(offscreenRenderer, camera, width, height, true);
        context.clearRect(0, 0, width, height);
        context.drawImage(offscreenRenderer.domElement, 0, 0, width, height);
        App.hud.drawHud(context, width, height, false, false);
        const videoFrame = new VideoFrame(composite, { timestamp: frameIndex * frameDurationUs, duration: frameDurationUs });
        videoEncoder.encode(videoFrame, { keyFrame: frameIndex % Math.max(1, fps * 2) === 0 });
        videoFrame.close();
        state.exportFrameIndex = frameIndex + 1;
        const progress = (frameIndex + 1) / totalFrames;
        const wallElapsed = (performance.now() - state.exportStartedAt) / 1000;
        const eta = progress > 0.005 ? wallElapsed / progress - wallElapsed : 0;
        showProgress({ title: "OFFLINE EXPORT", progress, elapsed: time - range.start, total: range.duration, frame: frameIndex + 1, totalFrames, eta });
        setStatus(elements.exportStatus, `Rendering frame ${(frameIndex + 1).toLocaleString()} of ${totalFrames.toLocaleString()} — ${Math.round(progress * 100)}%`);
        while (videoEncoder.encodeQueueSize > 6) await sleep(0);
        if (frameIndex % 3 === 0) await sleep(0);
      }
      await audioPromise;
      await videoEncoder.flush();
      await audioEncoder.flush();
      muxer.finalize();
      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const fileName = `${sanitizeFileName(elements.exportFileName.value)}-${dateStamp()}.mp4`;
      downloadBlob(blob, fileName);
      setStatus(elements.exportStatus, `Offline MP4 exported: ${fileName}`);
      showProgress({ title: "EXPORT COMPLETE", progress: 1, elapsed: range.duration, total: range.duration, frame: totalFrames, totalFrames, eta: 0 });
    } finally {
      videoEncoder.close();
      audioEncoder.close();
      offscreenRenderer.dispose();
      offscreenRenderer.forceContextLoss?.();
      composite.width = 1;
      composite.height = 1;
      state.exportActive = false;
      state.exportPlaybackTimeOverride = null;
      offlineAbortController = null;
      setExportControlsDisabled(false);
      elements.exportVideo.textContent = "EXPORT VIDEO";
      elements.exportVideo.classList.remove("is-recording");
      await restorePlaybackSnapshot();
      App.playback.updatePlaybackUi();
      updateExportEstimate();
    }
  }

  async function startVideoExport() {
    if (state.exportActive || pngExportActive) return;
    if (!state.hasAudio) {
      App.diagnostics?.showError("AUDIO REQUIRED", "Load an audio file before exporting video.", ["Choose or drop a local audio file in the Audio Source section."]);
      return;
    }
    try {
      if (elements.exportMode.value === "offline") await startOfflineVideoExport();
      else await startRealTimeVideoExport();
    } catch (error) {
      console.error(error);
      const cancelled = error?.name === "AbortError";
      state.exportActive = false;
      setExportControlsDisabled(false);
      elements.exportVideo.textContent = "EXPORT VIDEO";
      elements.exportVideo.classList.remove("is-recording");
      cleanupExportResources();
      await restorePlaybackSnapshot();
      if (cancelled) {
        setStatus(elements.exportStatus, "Video export cancelled.");
        hideProgress();
      } else {
        setStatus(elements.exportStatus, `Video export failed: ${error.message}`, true);
        App.diagnostics?.showError(
          "VIDEO EXPORT COULD NOT START",
          error.message,
          ["Try 1080 resolution or a lower frame rate.", "Use Real Time mode when High Quality Offline is unavailable.", "Choose MP4 for Offline mode or MKV for Real Time mode."]
        );
      }
    }
  }

  function stopVideoExport(cancelled = false) {
    if (!state.exportActive) return;
    state.exportCancelled = cancelled;
    if (offlineAbortController) {
      offlineAbortController.abort();
      return;
    }
    elements.audio.pause();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else finalizeVideoExport(cancelled).catch(console.error);
  }

  function toggleVideoExport() {
    if (state.exportActive) stopVideoExport(true);
    else startVideoExport();
  }

  function captureVideoFrame(now) {
    if (!state.exportActive || !exportCanvas || elements.exportMode.value !== "realtime") return;
    const fps = Number(elements.videoFps.value) || 30;
    if (now < nextCaptureTime) return;
    nextCaptureTime = now + 1000 / fps;
    const { width, height } = parseResolution(elements.exportResolution.value, state.viewportFormat);
    renderLiveCompositeFrame(width, height, true);
    const elapsed = clamp(elements.audio.currentTime - state.exportRangeStart, 0, state.exportRangeEnd - state.exportRangeStart);
    const total = state.exportRangeEnd - state.exportRangeStart;
    const progress = total > 0 ? elapsed / total : 0;
    state.exportProgress = progress;
    const wallElapsed = (now - state.exportStartedAt) / 1000;
    const eta = progress > 0.01 ? wallElapsed / progress - wallElapsed : total - elapsed;
    const totalFrames = Math.ceil(total * fps);
    const frame = Math.min(totalFrames, Math.round(elapsed * fps));
    showProgress({ title: "EXPORTING VIDEO", progress, elapsed, total, frame, totalFrames, eta });
    setStatus(elements.exportStatus, `Exporting ${width} × ${height} at ${fps} FPS — ${Math.round(progress * 100)}%`);
    if (elements.audio.currentTime >= state.exportRangeEnd - 0.012) stopVideoExport(false);
  }

  function handleAudioEnded() {
    if (state.exportActive && elements.exportMode.value === "realtime") stopVideoExport(false);
  }

  async function exportPng() {
    if (state.exportActive || pngExportActive) return;
    let pngRenderer = null;
    let pngCanvas = null;
    setPngExportActive(true);
    setStatus(elements.exportStatus, "Preparing PNG export...");
    try {
      await App.hud.ensureLogoReady();
      const { width, height } = parseResolution(elements.exportResolution.value, state.viewportFormat);
      pngRenderer = createExportRenderer(width, height);
      pngCanvas = createCompositeCanvas(width, height);
      const context = pngCanvas.getContext("2d", { alpha: false });
      App.renderer.renderSceneTo(pngRenderer, camera, width, height, true);
      context.drawImage(pngRenderer.domElement, 0, 0, width, height);
      App.hud.drawHud(context, width, height, false, false);
      pngCanvas.toBlob((blob) => {
        pngRenderer.dispose();
        pngRenderer.forceContextLoss?.();
        pngCanvas.remove();
        setPngExportActive(false);
        if (!blob) {
          setStatus(elements.exportStatus, "PNG export failed.", true);
          return;
        }
        const fileName = `${sanitizeFileName(elements.exportFileName.value)}-${dateStamp()}.png`;
        downloadBlob(blob, fileName);
        setStatus(elements.exportStatus, `PNG exported: ${fileName}`);
      }, "image/png");
    } catch (error) {
      pngRenderer?.dispose();
      pngRenderer?.forceContextLoss?.();
      pngCanvas?.remove();
      setPngExportActive(false);
      console.error(error);
      setStatus(elements.exportStatus, `PNG export failed: ${error.message}`, true);
      App.diagnostics?.showError("PNG EXPORT FAILED", error.message, ["Try a lower export resolution.", "Confirm that hardware acceleration is enabled."]);
    }
  }

  function exportSettingsJson() {
    const settings = App.stateManager?.serializableSettings() || {};
    settings.exportFileName = elements.exportFileName.value;
    settings.exportResolution = elements.exportResolution.value;
    settings.videoFormat = elements.videoFormat.value;
    settings.videoFps = Number(elements.videoFps.value);
    settings.videoBitrate = Number(elements.videoBitrate.value);
    const payload = { app: "Waterfall Spectrogram", version: CONSTANTS.SETTINGS_VERSION, exportedAt: new Date().toISOString(), settings };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const fileName = `${sanitizeFileName(elements.exportFileName.value)}-settings-${dateStamp()}.json`;
    downloadBlob(blob, fileName);
    setStatus(elements.exportStatus, `JSON exported: ${fileName}`);
  }

  function applyOutputPreset(value, record = true) {
    if (record) App.stateManager?.record(`Apply ${value} output preset`);
    state.outputPreset = value;
    elements.outputPreset.value = value;
    const preset = OUTPUT_PRESETS[value];
    if (!preset) {
      updateExportEstimate();
      return;
    }
    Object.assign(state, preset);
    App.renderer.setViewportFormat(state.viewportFormat);
    elements.viewportFormat.value = state.viewportFormat;
    elements.exportResolution.value = state.exportResolution;
    elements.videoFps.value = String(state.videoFps);
    elements.videoBitrate.value = String(state.videoBitrate);
    elements.safeAreaMode.value = state.safeAreaMode;
    document.getElementById("hudScale").value = String(state.hudScale);
    document.getElementById("hudScaleValue").textContent = `${Math.round(state.hudScale * 100)}%`;
    App.hud.updateDependentControls();
    updateExportEstimate();
  }

  function syncExportControlsFromState() {
    elements.outputPreset.value = state.outputPreset;
    elements.exportMode.value = state.exportMode;
    elements.exportRange.value = state.exportRange;
    elements.exportStart.value = String(state.exportStart || 0);
    elements.exportEnd.value = String(state.exportEnd || 0);
    elements.exportFileName.value = state.exportFileName;
    elements.exportResolution.value = state.exportResolution;
    elements.videoFormat.value = state.videoFormat;
    elements.videoFps.value = String(state.videoFps);
    elements.videoBitrate.value = String(state.videoBitrate);
    updateCustomRangeVisibility();
    updateExportEstimate();
  }

  function initializeExportControls() {
    syncExportControlsFromState();
    for (const [element, label] of [
      [elements.outputPreset, "Change output preset"],
      [elements.exportMode, "Change export mode"],
      [elements.exportRange, "Change export range"],
      [elements.exportStart, "Change export start"],
      [elements.exportEnd, "Change export end"],
      [elements.exportFileName, "Change export filename"],
      [elements.exportResolution, "Change export resolution"],
      [elements.videoFormat, "Change video format"],
      [elements.videoFps, "Change video frame rate"],
      [elements.videoBitrate, "Change video bitrate"],
    ]) armExportHistory(element, label);
    for (const option of elements.videoFormat.options) option.disabled = !getSupportedMimeTypeForFormat(option.value);
    if (elements.videoFormat.selectedOptions[0]?.disabled) {
      const supported = [...elements.videoFormat.options].find((option) => !option.disabled);
      if (supported) elements.videoFormat.value = supported.value;
    }
    state.videoFormat = elements.videoFormat.value;

    elements.outputPreset.addEventListener("change", () => applyOutputPreset(elements.outputPreset.value));
    elements.exportMode.addEventListener("change", () => { state.exportMode = elements.exportMode.value; updateExportEstimate(); });
    elements.exportRange.addEventListener("change", () => { state.exportRange = elements.exportRange.value; updateCustomRangeVisibility(); updateExportEstimate(); });
    elements.exportStart.addEventListener("input", () => { state.exportStart = Number(elements.exportStart.value) || 0; updateExportEstimate(); });
    elements.exportEnd.addEventListener("input", () => { state.exportEnd = Number(elements.exportEnd.value) || 0; updateExportEstimate(); });
    elements.exportFileName.addEventListener("input", () => { state.exportFileName = elements.exportFileName.value; });
    elements.exportResolution.addEventListener("change", () => { state.exportResolution = elements.exportResolution.value; state.outputPreset = "custom"; elements.outputPreset.value = "custom"; updateExportEstimate(); });
    elements.videoFormat.addEventListener("change", () => { state.videoFormat = elements.videoFormat.value; updateExportEstimate(); });
    elements.videoFps.addEventListener("change", () => { state.videoFps = Number(elements.videoFps.value); updateExportEstimate(); });
    elements.videoBitrate.addEventListener("change", () => { state.videoBitrate = Number(elements.videoBitrate.value); updateExportEstimate(); });
    elements.exportVideo.addEventListener("click", toggleVideoExport);
    elements.exportPng.addEventListener("click", exportPng);
    elements.exportSettings.addEventListener("click", exportSettingsJson);
    updateExportEstimate();
  }

  App.exporting = {
    initializeExportControls,
    syncExportControlsFromState,
    applyOutputPreset,
    updateExportEstimate,
    getExportRange,
    getSupportedMimeTypeForFormat,
    toggleVideoExport,
    startVideoExport,
    stopVideoExport,
    captureVideoFrame,
    handleAudioEnded,
    exportPng,
    exportSettingsJson,
  };
})();
