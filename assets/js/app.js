(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state, controls, grid } = App.core;
  const { DEFAULTS, CONSTANTS } = App.config;
  const { setRangeFill } = App.utils;

  function isOfflineExportRunning() {
    return state.exportActive && elements.exportMode?.value === "offline";
  }

  function animate(now) {
    requestAnimationFrame(animate);
    const delta = Math.min(CONSTANTS.MAX_FRAME_DELTA, (now - state.lastFrameTime) / 1000);
    state.lastFrameTime = now;

    if (state.showFps || state.qualityPreset === "auto") {
      state.fpsFrameCount += 1;
      const elapsed = now - state.fpsLastUpdate;
      if (elapsed >= 500) {
        state.currentFps = state.fpsFrameCount * 1000 / elapsed;
        if (state.showFps) elements.fpsReadout.textContent = String(Math.round(state.currentFps));
        state.fpsFrameCount = 0;
        state.fpsLastUpdate = now;
        App.renderer.updateAutoQuality();
      }
    }

    if (!isOfflineExportRunning()) {
      if (state.isPlaying && now >= state.nextAnalysisTime) {
        App.analysis.analyzeFrame();
        state.nextAnalysisTime = now + 1000 / Math.max(1, state.scrollSpeed);
      }
      App.loop.enforceSelectedLoop();
      App.analysis.updateVisualDynamics(delta);
    }

    controls.update();
    App.renderer.renderLive();
    if (state.exportActive && elements.exportMode?.value === "realtime") App.exporting.captureVideoFrame(now);
    else App.hud.renderPreview();
  }

  function bindPlaybackEvents() {
    elements.fileInput.addEventListener("change", (event) => {
      App.loader.loadAudioFile(event.target.files?.[0]);
      event.target.value = "";
    });
    elements.playButton.addEventListener("click", App.playback.togglePlayback);
    elements.stopButton.addEventListener("click", App.playback.stopPlayback);
    elements.resetViewButton.addEventListener("click", App.controlsUi.resetCameraControls);
    elements.loopEditorButton.addEventListener("click", App.loop.openEditor);
    elements.volume.addEventListener("pointerdown", () => App.stateManager.record("Change volume"));
    elements.volume.addEventListener("input", () => App.playback.setVolume(elements.volume.value));
    elements.muteToggle.addEventListener("pointerdown", () => App.stateManager.record("Toggle mute"));
    elements.muteToggle.addEventListener("keydown", (event) => {
      if ([" ", "Enter"].includes(event.key)) App.stateManager.record("Toggle mute");
    });
    elements.muteToggle.addEventListener("change", () => {
      App.playback.setMuted(elements.muteToggle.checked);
    });
    elements.seek.addEventListener("pointerdown", () => { state.isSeeking = true; });
    elements.seek.addEventListener("input", App.playback.previewSeek);
    elements.seek.addEventListener("change", App.playback.commitSeek);
    elements.seek.addEventListener("pointerup", App.playback.commitSeek);
    elements.audio.addEventListener("timeupdate", () => {
      App.loop.enforceSelectedLoop();
      App.playback.updateSeekUi();
      App.exporting.updateExportEstimate();
    });
    elements.audio.addEventListener("play", App.playback.handlePlay);
    elements.audio.addEventListener("pause", App.playback.handlePause);
    elements.audio.addEventListener("ended", () => {
      App.playback.handlePause();
      App.exporting.handleAudioEnded();
    });
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await elements.viewport.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      console.error(error);
      App.diagnostics.showError("FULLSCREEN COULD NOT START", error.message, ["Try the F shortcut again after clicking inside the page."]);
    }
  }

  function modalIsOpen() {
    return [elements.shortcutsModal, elements.diagnosticsModal, elements.errorModal].some((modal) => modal && !modal.hidden);
  }

  function toggleStateFromShortcut(key, input, callback) {
    App.stateManager.record(`Toggle ${key}`);
    state[key] = !state[key];
    if (input) input.checked = state[key];
    callback?.();
  }

  function handleKeyboardShortcut(event) {
    const target = event.target;
    const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    const loopOpen = Boolean(document.getElementById("loopEditorOverlay"));

    if (event.key === "Escape") {
      elements.sidebar.classList.remove("is-open");
      if (state.exportActive) App.exporting.stopVideoExport(true);
      for (const modal of [elements.shortcutsModal, elements.diagnosticsModal, elements.errorModal]) {
        if (modal && !modal.hidden) App.diagnostics.closeModal(modal);
      }
      return;
    }

    if (loopOpen || isTyping || modalIsOpen()) return;
    const ctrl = event.ctrlKey || event.metaKey;

    if (ctrl && event.code === "KeyZ") {
      event.preventDefault();
      if (event.shiftKey) App.stateManager.redo();
      else App.stateManager.undo();
      return;
    }
    if (ctrl && event.code === "KeyE") {
      event.preventDefault();
      App.exporting.toggleVideoExport();
      return;
    }
    if (ctrl && event.code === "KeyP") {
      event.preventDefault();
      App.exporting.exportPng();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      App.playback.togglePlayback();
    } else if (event.code === "KeyF" && !event.repeat) {
      event.preventDefault();
      toggleFullscreen();
    } else if (event.code === "KeyR" && !event.repeat) {
      event.preventDefault();
      App.controlsUi.resetCameraControls();
    } else if (event.code === "KeyL" && !event.repeat) {
      event.preventDefault();
      if (!elements.loopEditorButton.disabled) App.loop.openEditor();
    } else if (event.code === "KeyG" && !event.repeat) {
      event.preventDefault();
      toggleStateFromShortcut("showGrid", elements.showGrid, () => { grid.visible = state.showGrid; });
    } else if (event.code === "KeyH" && !event.repeat) {
      event.preventDefault();
      toggleStateFromShortcut("showHud", elements.showHud, App.hud.updateDependentControls);
    } else if (event.code === "KeyM" && !event.repeat) {
      event.preventDefault();
      App.stateManager.record("Toggle mute");
      App.playback.setMuted(!state.muted);
    } else if (event.key === "?" || (event.code === "Slash" && event.shiftKey)) {
      event.preventDefault();
      App.diagnostics.openModal(elements.shortcutsModal);
    }
  }

  function bindViewportEvents() {
    const preventDragDefaults = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) window.addEventListener(eventName, preventDragDefaults, false);

    window.addEventListener("dragenter", (event) => {
      if (state.isLoadingAudio) return;
      state.dragDepth += 1;
      App.loader.updateDragFile(event.dataTransfer?.items?.[0]?.getAsFile?.());
      elements.dropOverlay.classList.add("is-visible");
      elements.fileDrop.classList.add("is-dragging");
    });
    window.addEventListener("dragover", (event) => {
      if (state.isLoadingAudio) return;
      App.loader.updateDragFile(event.dataTransfer?.files?.[0]);
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
    window.addEventListener("keydown", handleKeyboardShortcut);
  }

  function bindResizeEvents() {
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => App.renderer.queueResize()) : null;
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
    App.diagnostics.initialize();
    App.stateManager.initialize();
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
    App.renderer.resizeRenderer(true);
    App.hud.updateDependentControls();
    requestAnimationFrame(animate);
  }

  initialize();
})();
