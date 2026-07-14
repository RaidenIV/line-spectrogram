(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state, controls, grid } = App.core;
  const { DEFAULTS, CONSTANTS } = App.config;
  const { setRangeFill } = App.utils;

  function animate(now) {
    requestAnimationFrame(animate);

    const delta = Math.min(CONSTANTS.MAX_FRAME_DELTA, (now - state.lastFrameTime) / 1000);
    state.lastFrameTime = now;

    if (state.showFps) {
      state.fpsFrameCount += 1;
      const elapsed = now - state.fpsLastUpdate;
      if (elapsed >= 500) {
        state.currentFps = state.fpsFrameCount * 1000 / elapsed;
        elements.fpsReadout.textContent = String(Math.round(state.currentFps));
        state.fpsFrameCount = 0;
        state.fpsLastUpdate = now;
      }
    }

    if (state.isPlaying && now >= state.nextAnalysisTime) {
      App.analysis.analyzeFrame();
      state.nextAnalysisTime = now + 1000 / Math.max(1, state.scrollSpeed);
    }

    App.loop.enforceSelectedLoop();
    App.analysis.updateVisualDynamics(delta);
    controls.update();
    App.renderer.renderLive();

    if (state.exportActive) App.exporting.captureVideoFrame(now);
    else App.hud.renderPreview();
  }

  function bindPlaybackEvents() {
    elements.fileInput.addEventListener("change", (event) => {
      App.loader.loadAudioFile(event.target.files?.[0]);
      event.target.value = "";
    });

    elements.playButton.addEventListener("click", App.playback.togglePlayback);
    elements.stopButton.addEventListener("click", App.playback.stopPlayback);
    elements.loopButton.addEventListener("click", App.loop.openEditor);

    elements.volume.addEventListener("input", () => App.playback.setVolume(elements.volume.value));
    elements.muteToggle.addEventListener("change", () => App.playback.setMuted(elements.muteToggle.checked));

    elements.seek.addEventListener("pointerdown", () => {
      state.isSeeking = true;
    });
    elements.seek.addEventListener("input", App.playback.previewSeek);
    elements.seek.addEventListener("change", App.playback.commitSeek);
    elements.seek.addEventListener("pointerup", App.playback.commitSeek);

    elements.audio.addEventListener("timeupdate", () => {
      App.loop.enforceSelectedLoop();
      App.playback.updateSeekUi();
    });
    elements.audio.addEventListener("play", App.playback.handlePlay);
    elements.audio.addEventListener("pause", App.playback.handlePause);
    elements.audio.addEventListener("ended", () => {
      App.playback.handlePause();
      App.exporting.handleAudioEnded();
    });
  }

  function bindViewportEvents() {
    elements.fullscreenButton.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) await elements.viewport.requestFullscreen();
        else await document.exitFullscreen();
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
      if (state.isLoadingAudio) return;
      state.dragDepth += 1;
      elements.dropOverlay.classList.add("is-visible");
      elements.fileDrop.classList.add("is-dragging");
    });

    window.addEventListener("dragover", () => {
      if (state.isLoadingAudio) return;
      elements.dropOverlay.classList.add("is-visible");
      elements.fileDrop.classList.add("is-dragging");
    });

    window.addEventListener("dragleave", () => {
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) App.loader.clearDragUi();
    });

    window.addEventListener("drop", (event) => {
      App.loader.clearDragUi();
      if (!state.isLoadingAudio) App.loader.loadAudioFile(event.dataTransfer?.files?.[0]);
    });

    window.addEventListener("keydown", (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

      if (document.getElementById("loopEditorOverlay")) return;

      if (event.code === "Space" && !isTyping) {
        event.preventDefault();
        App.playback.togglePlayback();
      }

      if (event.code === "Escape") {
        elements.sidebar.classList.remove("is-open");
        if (state.exportActive) App.exporting.stopVideoExport(true);
      }
    });
  }

  function bindResizeEvents() {
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => App.renderer.queueResize())
      : null;

    if (observer) {
      observer.observe(elements.viewport);
      observer.observe(elements.viewportFrame);
    }

    window.addEventListener("resize", () => {
      App.renderer.fitViewportFrame();
      App.renderer.queueResize();
    });

    window.addEventListener("beforeunload", () => {
      observer?.disconnect();
      App.loop.closeEditor();
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      if (state.exportActive) App.exporting.stopVideoExport(true);
    });
  }

  function initialize() {
    App.controlsUi.initializeControls();
    App.exporting.initializeExportControls();
    bindPlaybackEvents();
    bindViewportEvents();
    bindResizeEvents();

    App.playback.setVolume(DEFAULTS.volume);
    App.playback.setMuted(DEFAULTS.muted);
    App.playback.setLoop(false);
    App.loop.syncLoopButton();
    App.playback.setTransportEnabled(false);
    App.playback.updatePlaybackUi();

    for (const input of document.querySelectorAll(".range")) setRangeFill(input);
    document.documentElement.style.setProperty("--accent", state.lineColor);
    grid.visible = state.showGrid;
    App.analysis.applyLineColor();
    App.analysis.rebuildSpectrogram();
    App.renderer.setViewportFormat(state.viewportFormat);
    App.renderer.resizeRenderer();
    App.hud.updateDependentControls();
    requestAnimationFrame(animate);
  }

  initialize();
})();
