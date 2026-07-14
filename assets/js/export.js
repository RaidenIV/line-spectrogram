(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { THREE, elements, state, camera } = App.core;
  const { DEFAULTS } = App.config;
  const { parseResolution, sanitizeFileName, downloadBlob, dateStamp, setStatus } = App.utils;

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

  function setExportControlsDisabled(disabled) {
    for (const element of [
      elements.exportFileName,
      elements.exportResolution,
      elements.videoFormat,
      elements.videoFps,
      elements.videoBitrate,
      elements.exportPng,
      elements.exportSettings,
    ]) {
      element.disabled = disabled;
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
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    return renderer;
  }

  function createCompositeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;z-index:0;";
    document.body.appendChild(canvas);
    return canvas;
  }

  function pulseCaptureCanvas() {
    if (!exportCanvas || !exportContext) return;
    exportFrameSerial += 1;
    const value = exportFrameSerial % 2 === 0 ? 3 : 4;
    exportContext.fillStyle = `rgb(${value},${value},${value})`;
    exportContext.fillRect(exportCanvas.width - 1, exportCanvas.height - 1, 1, 1);
  }

  function renderCompositeFrame(width, height, forceFrameChange = false) {
    if (!exportCanvas || !exportContext) return;
    exportContext.clearRect(0, 0, width, height);
    exportContext.drawImage(elements.canvas, 0, 0, width, height);
    App.hud.drawHud(exportContext, width, height, false, false);
    if (forceFrameChange) pulseCaptureCanvas();
  }

  function getRequestedMimeType() {
    const requested = elements.videoFormat.value;
    const candidates = [
      requested,
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
  }

  function extensionForMimeType(mimeType) {
    return mimeType.includes("mp4") ? "mp4" : "webm";
  }

  function cleanupExportResources() {
    if (exportStream) {
      for (const track of exportStream.getTracks()) track.stop();
    }
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

  async function restorePlaybackSnapshot() {
    const snapshot = playbackSnapshot;
    playbackSnapshot = null;
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
    if (Number.isFinite(elements.audio.duration)) {
      elements.audio.currentTime = Math.min(snapshot.currentTime, elements.audio.duration || snapshot.currentTime);
    }
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
      const fileName = `${sanitizeFileName(elements.exportFileName.value)}-${dateStamp()}.${extensionForMimeType(activeMimeType)}`;
      downloadBlob(blob, fileName);
      setStatus(elements.exportStatus, `Video exported: ${fileName}`);
    } else if (cancelled) {
      setStatus(elements.exportStatus, "Video export cancelled.");
    } else {
      setStatus(elements.exportStatus, "Video export failed: no encoded data was produced.", true);
    }

    cleanupExportResources();
    await restorePlaybackSnapshot();
    App.playback.updatePlaybackUi();
  }

  async function startVideoExport() {
    if (state.exportActive) return;
    if (pngExportActive) {
      setStatus(elements.exportStatus, "Wait for the PNG export to finish before starting video export.", true);
      return;
    }
    if (!state.hasAudio) {
      setStatus(elements.exportStatus, "Load an audio file before exporting video.", true);
      return;
    }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setStatus(elements.exportStatus, "Video export is not supported by this browser.", true);
      return;
    }

    activeMimeType = getRequestedMimeType();
    if (!activeMimeType) {
      setStatus(elements.exportStatus, "No supported video encoder was found in this browser.", true);
      return;
    }

    try {
      await App.playback.ensureAudioContextRunning();
      await App.hud.ensureLogoReady();
      const { width, height } = parseResolution(elements.exportResolution.value);
      const fps = Number(elements.videoFps.value);
      const bitrate = Number(elements.videoBitrate.value);

      exportCanvas = createCompositeCanvas(width, height);
      exportContext = exportCanvas.getContext("2d", { alpha: false });
      renderCompositeFrame(width, height, true);

      const videoStream = exportCanvas.captureStream(fps);
      const audioTrack = state.exportAudioDestination?.stream.getAudioTracks()[0];
      const tracks = [...videoStream.getVideoTracks()];
      if (audioTrack) tracks.push(audioTrack.clone());
      exportStream = new MediaStream(tracks);

      recordedChunks = [];
      recorder = new MediaRecorder(exportStream, {
        mimeType: activeMimeType,
        videoBitsPerSecond: bitrate,
        audioBitsPerSecond: 192000,
      });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) recordedChunks.push(event.data);
      });
      recorder.addEventListener("error", (event) => {
        console.error(event.error || event);
        setStatus(elements.exportStatus, `Video export error: ${event.error?.message || "encoder failure"}`, true);
      });
      recorder.addEventListener("stop", () => {
        finalizeVideoExport(state.exportCancelled).catch(console.error);
      }, { once: true });

      playbackSnapshot = {
        currentTime: elements.audio.currentTime,
        paused: elements.audio.paused,
        audioLoop: state.audioLoop,
        loopStart: state.loopStart,
        loopEnd: state.loopEnd,
        loopBpm: state.loopBpm,
        loopBars: state.loopBars,
        loopSnap: state.loopSnap,
      };

      state.exportActive = true;
      state.exportCancelled = false;
      state.exportProgress = 0;
      setExportControlsDisabled(true);
      elements.exportVideo.textContent = "CANCEL VIDEO EXPORT";
      elements.exportVideo.classList.add("is-recording");
      state.audioLoop = false;
      elements.audio.loop = false;
      App.loop.syncLoopButton();
      elements.audio.pause();
      elements.audio.currentTime = 0;
      App.analysis.resetSpectrogramData();
      recorder.start(1000);
      nextCaptureTime = performance.now();
      capturePulseTimer = window.setInterval(pulseCaptureCanvas, 1000 / Math.max(1, fps));
      renderCompositeFrame(width, height, true);
      await elements.audio.play();
      setStatus(elements.exportStatus, `Exporting ${width} × ${height} at ${fps} FPS — 0%`);
      App.playback.updatePlaybackUi();
    } catch (error) {
      console.error(error);
      state.exportActive = false;
      setExportControlsDisabled(false);
      elements.exportVideo.textContent = "EXPORT VIDEO";
      cleanupExportResources();
      await restorePlaybackSnapshot();
      setStatus(elements.exportStatus, `Video export failed: ${error.message}`, true);
    }
  }

  function stopVideoExport(cancelled = false) {
    if (!state.exportActive) return;
    state.exportCancelled = cancelled;
    elements.audio.pause();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else finalizeVideoExport(cancelled).catch(console.error);
  }

  function toggleVideoExport() {
    if (state.exportActive) stopVideoExport(true);
    else startVideoExport();
  }

  function captureVideoFrame(now) {
    if (!state.exportActive || !exportCanvas) return;
    const fps = Number(elements.videoFps.value) || 30;
    if (now < nextCaptureTime) return;
    nextCaptureTime = now + 1000 / fps;

    const { width, height } = parseResolution(elements.exportResolution.value);
    renderCompositeFrame(width, height, true);

    const duration = elements.audio.duration;
    const progress = Number.isFinite(duration) && duration > 0
      ? Math.min(1, elements.audio.currentTime / duration)
      : 0;
    state.exportProgress = progress;
    setStatus(elements.exportStatus, `Exporting ${width} × ${height} at ${fps} FPS — ${Math.round(progress * 100)}%`);
  }

  function handleAudioEnded() {
    if (state.exportActive) stopVideoExport(false);
  }

  async function exportPng() {
    if (state.exportActive || pngExportActive) return;
    let pngRenderer = null;
    let pngCanvas = null;
    setPngExportActive(true);
    setStatus(elements.exportStatus, "Preparing PNG export...");
    try {
      await App.hud.ensureLogoReady();
      const { width, height } = parseResolution(elements.exportResolution.value);
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
    }
  }

  function exportSettingsJson() {
    const settings = {};
    for (const name of Object.keys(DEFAULTS)) settings[name] = state[name];
    settings.volume = Number(elements.volume.value);
    settings.muted = elements.muteToggle.checked;
    settings.exportFileName = elements.exportFileName.value;
    settings.exportResolution = elements.exportResolution.value;
    settings.videoFormat = elements.videoFormat.value;
    settings.videoFps = Number(elements.videoFps.value);
    settings.videoBitrate = Number(elements.videoBitrate.value);

    const payload = {
      app: "3D Spectrogram",
      version: 2,
      exportedAt: new Date().toISOString(),
      settings,
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
    const fileName = `${sanitizeFileName(elements.exportFileName.value)}-settings-${dateStamp()}.json`;
    downloadBlob(blob, fileName);
    setStatus(elements.exportStatus, `JSON exported: ${fileName}`);
  }

  function initializeExportControls() {
    elements.exportFileName.value = state.exportFileName;
    elements.exportResolution.value = state.exportResolution;
    elements.videoFps.value = String(state.videoFps);
    elements.videoBitrate.value = String(state.videoBitrate);

    for (const option of elements.videoFormat.options) {
      option.disabled = Boolean(window.MediaRecorder?.isTypeSupported) && !MediaRecorder.isTypeSupported(option.value);
    }
    if (elements.videoFormat.selectedOptions[0]?.disabled) {
      const supported = [...elements.videoFormat.options].find((option) => !option.disabled);
      if (supported) elements.videoFormat.value = supported.value;
    }
    state.videoFormat = elements.videoFormat.value;

    elements.exportFileName.addEventListener("input", () => {
      state.exportFileName = elements.exportFileName.value;
    });
    elements.exportResolution.addEventListener("change", () => {
      state.exportResolution = elements.exportResolution.value;
    });
    elements.videoFormat.addEventListener("change", () => {
      state.videoFormat = elements.videoFormat.value;
    });
    elements.videoFps.addEventListener("change", () => {
      state.videoFps = Number(elements.videoFps.value);
    });
    elements.videoBitrate.addEventListener("change", () => {
      state.videoBitrate = Number(elements.videoBitrate.value);
    });

    elements.exportVideo.addEventListener("click", toggleVideoExport);
    elements.exportPng.addEventListener("click", exportPng);
    elements.exportSettings.addEventListener("click", exportSettingsJson);
  }

  App.exporting = {
    initializeExportControls,
    toggleVideoExport,
    startVideoExport,
    stopVideoExport,
    captureVideoFrame,
    handleAudioEnded,
    exportPng,
    exportSettingsJson,
  };
})();
