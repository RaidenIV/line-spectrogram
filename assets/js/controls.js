(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state, grid, setInitialCamera, controls, camera } = App.core;
  const { DEFAULTS, CONTROL_DEFINITIONS, QUALITY_PRESETS } = App.config;
  const { setRangeFill } = App.utils;

  const visualToggleNames = ["logFrequency", "mirrorFrequency", "beatPulse", "transientHighlight"];
  const hudToggleNames = ["showFps", "showAnalysisReadout", "showHud", "hudSpectrum", "hudWaveform", "hudLevels", "hudFrame", "hudFrequencyLabels", "safeAreaAffectsHud"];
  const visualSelectNames = ["amplitudeMode", "colorMode", "renderMode"];
  const cameraSelectNames = ["cameraPreset", "cameraMotion", "cameraFollowSource"];

  function armHistory(element, label) {
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
    element.addEventListener("change", () => {
      element.dataset.historyArmed = "false";
    });
    element.addEventListener("blur", () => {
      element.dataset.historyArmed = "false";
    });
  }

  function updateViewportHudVisibility() {
    const hidden = !state.showAnalysisReadout && !state.showFps;
    elements.viewportHud.classList.toggle("is-hidden", hidden);
    elements.viewportHud.setAttribute("aria-hidden", String(hidden));
  }

  function updateAnalysisReadoutVisibility() {
    for (const block of elements.analysisReadoutBlocks) {
      block.classList.toggle("is-hidden", !state.showAnalysisReadout);
      block.setAttribute("aria-hidden", String(!state.showAnalysisReadout));
    }
    updateViewportHudVisibility();
  }

  function updateFpsVisibility() {
    elements.fpsBlock.classList.toggle("is-hidden", !state.showFps);
    elements.fpsBlock.setAttribute("aria-hidden", String(!state.showFps));
    updateViewportHudVisibility();
  }

  function applyRangeSideEffect(name) {
    if (name === "smoothing") App.analysis.applySmoothing();
    else if (name === "lineWidth") App.analysis.updateLineWidths();
    else if (["lineOpacity", "depthOpacity", "depthBrightness", "depthHeightDecay", "depthFog", "rowSpacing", "historyDepth", "depthCurve", "heightScale"].includes(name)) App.analysis.applyAppearance();
    else if (name === "cameraDistance" || name === "cameraHeight") App.renderer.updateCameraFromControls();
    else if (name === "hudOpacity" || name === "hudScale") App.hud.renderPreview(true);
  }

  function applyRangeValue(name, definition, commitRebuild) {
    const input = document.getElementById(name);
    const output = document.getElementById(`${name}Value`);
    const value = definition.parser(input.value);
    output.textContent = definition.format(value);
    setRangeFill(input);
    if (definition.rebuild && !commitRebuild) return;
    state[name] = value;
    applyRangeSideEffect(name);
    if (definition.rebuild && commitRebuild) App.analysis.rebuildSpectrogram();
    App.exporting?.updateExportEstimate();
  }

  function bindRangeControls() {
    for (const [name, definition] of Object.entries(CONTROL_DEFINITIONS)) {
      const input = document.getElementById(name);
      const output = document.getElementById(`${name}Value`);
      if (!input || !output) continue;
      input.value = String(state[name]);
      output.textContent = definition.format(state[name]);
      setRangeFill(input);
      armHistory(input, `Change ${input.closest(".control")?.querySelector("label")?.textContent || name}`);
      input.addEventListener("input", () => applyRangeValue(name, definition, false));
      input.addEventListener("change", () => applyRangeValue(name, definition, true));
    }
  }

  function bindSelect(element, stateKey, callback) {
    if (!element) return;
    element.value = String(state[stateKey]);
    armHistory(element, `Change ${element.closest(".control")?.querySelector("label")?.textContent || stateKey}`);
    element.addEventListener("change", () => {
      state[stateKey] = element.value;
      callback?.(element.value);
    });
  }

  function bindToggle(name, callback) {
    const input = document.getElementById(name);
    if (!input) return;
    input.checked = Boolean(state[name]);
    armHistory(input, `Toggle ${input.closest("label")?.querySelector("strong")?.textContent || name}`);
    input.addEventListener("change", () => {
      state[name] = input.checked;
      callback?.(input.checked);
    });
  }

  function bindVisualControls() {
    elements.fftSize.value = String(state.fftSize);
    armHistory(elements.fftSize, "Change FFT size");
    elements.fftSize.addEventListener("change", () => {
      state.fftSize = Number(elements.fftSize.value);
      App.analysis.applyFftSize();
    });

    elements.lineColor.value = state.lineColor;
    elements.lineColorValue.textContent = state.lineColor.toUpperCase();
    armHistory(elements.lineColor, "Change line color");
    elements.lineColor.addEventListener("input", () => {
      state.lineColor = elements.lineColor.value;
      elements.lineColorValue.textContent = state.lineColor.toUpperCase();
      App.analysis.applyLineColor();
    });

    bindSelect(elements.amplitudeMode, "amplitudeMode");
    bindSelect(elements.colorMode, "colorMode", App.analysis.applyAppearance);
    bindSelect(elements.renderMode, "renderMode", () => App.analysis.rebuildSpectrogram());

    for (const name of visualToggleNames) {
      bindToggle(name, () => {
        if (name === "logFrequency" || name === "mirrorFrequency") state.spectrumMapKey = "";
      });
    }
  }

  function updateCameraKeyframeStatus() {
    const count = state.cameraKeyframes.length;
    elements.cameraKeyframeStatus.textContent = `${count} camera keyframe${count === 1 ? "" : "s"}`;
  }

  function syncCameraRangeOutputs() {
    for (const name of ["cameraDistance", "cameraHeight"]) {
      const definition = CONTROL_DEFINITIONS[name];
      const input = document.getElementById(name);
      const output = document.getElementById(`${name}Value`);
      input.value = String(state[name]);
      output.textContent = definition.format(state[name]);
      setRangeFill(input);
    }
  }

  function bindCameraControls() {
    bindSelect(elements.cameraPreset, "cameraPreset", (value) => {
      App.renderer.applyCameraPreset(value);
      syncCameraRangeOutputs();
    });
    bindSelect(elements.cameraMotion, "cameraMotion");
    bindSelect(elements.cameraFollowSource, "cameraFollowSource");
    bindToggle("autoCamera");
    bindToggle("showGrid", () => { grid.visible = state.showGrid; });

    elements.addCameraKeyframe.addEventListener("click", () => {
      App.stateManager?.record("Add camera keyframe");
      App.renderer.addCameraKeyframe();
      updateCameraKeyframeStatus();
    });
    elements.clearCameraKeyframes.addEventListener("click", () => {
      if (!state.cameraKeyframes.length) return;
      App.stateManager?.record("Clear camera keyframes");
      App.renderer.clearCameraKeyframes();
      updateCameraKeyframeStatus();
    });
    controls.addEventListener("start", () => App.stateManager?.record("Move camera"));
    controls.addEventListener("end", () => {
      state.cameraPreset = "custom";
      state.cameraBasePosition = camera.position.clone();
      state.cameraBaseTarget = controls.target.clone();
    });
    updateCameraKeyframeStatus();
  }

  function applyQualityPreset(value, record = false) {
    if (record) App.stateManager?.record(`Apply ${value} quality`);
    state.qualityPreset = value;
    elements.qualityPreset.value = value;
    if (value !== "auto") {
      const preset = QUALITY_PRESETS[value];
      if (preset) {
        state.historyLines = preset.historyLines;
        state.frequencyBins = preset.frequencyBins;
        for (const name of ["historyLines", "frequencyBins"]) {
          const definition = CONTROL_DEFINITIONS[name];
          const input = document.getElementById(name);
          const output = document.getElementById(`${name}Value`);
          input.value = String(state[name]);
          output.textContent = definition.format(state[name]);
          setRangeFill(input);
        }
        App.analysis.rebuildSpectrogram();
      }
    } else {
      state.autoQualityScale = 1;
    }
    App.renderer.resizeRenderer(true);
  }

  function bindHudControls() {
    bindSelect(elements.viewportFormat, "viewportFormat", App.renderer.setViewportFormat);
    elements.qualityPreset.value = state.qualityPreset;
    armHistory(elements.qualityPreset, "Change quality preset");
    elements.qualityPreset.addEventListener("change", () => applyQualityPreset(elements.qualityPreset.value));
    bindSelect(elements.safeAreaMode, "safeAreaMode", () => App.hud.updateDependentControls());

    for (const name of hudToggleNames) {
      bindToggle(name, () => {
        if (name === "showFps") {
          state.fpsFrameCount = 0;
          state.fpsLastUpdate = performance.now();
          elements.fpsReadout.textContent = "0";
          updateFpsVisibility();
        }
        if (name === "showAnalysisReadout") updateAnalysisReadoutVisibility();
        if (["showHud", "hudSpectrum", "hudWaveform", "hudLevels", "hudFrame", "hudFrequencyLabels", "safeAreaAffectsHud"].includes(name)) App.hud.updateDependentControls();
      });
    }
    updateAnalysisReadoutVisibility();
    updateFpsVisibility();
    App.hud.updateDependentControls();
  }

  function syncAllControls(options = {}) {
    for (const [name, definition] of Object.entries(CONTROL_DEFINITIONS)) {
      const input = document.getElementById(name);
      const output = document.getElementById(`${name}Value`);
      if (!input || !output) continue;
      input.value = String(state[name]);
      output.textContent = definition.format(state[name]);
      setRangeFill(input);
    }
    elements.fftSize.value = String(state.fftSize);
    elements.lineColor.value = state.lineColor;
    elements.lineColorValue.textContent = state.lineColor.toUpperCase();
    for (const name of visualSelectNames) document.getElementById(name).value = state[name];
    for (const name of visualToggleNames) document.getElementById(name).checked = Boolean(state[name]);
    elements.cameraPreset.value = [...elements.cameraPreset.options].some((option) => option.value === state.cameraPreset) ? state.cameraPreset : "elevated";
    elements.cameraMotion.value = state.cameraMotion;
    elements.cameraFollowSource.value = state.cameraFollowSource;
    elements.autoCamera.checked = state.autoCamera;
    elements.showGrid.checked = state.showGrid;
    grid.visible = state.showGrid;
    elements.viewportFormat.value = state.viewportFormat;
    elements.qualityPreset.value = state.qualityPreset;
    elements.safeAreaMode.value = state.safeAreaMode;
    for (const name of hudToggleNames) document.getElementById(name).checked = Boolean(state[name]);

    App.analysis.applyFftSize();
    App.analysis.applyLineColor();
    App.analysis.applySmoothing();
    if (options.rebuild) App.analysis.rebuildSpectrogram();
    else App.analysis.applyAppearance();
    App.renderer.setViewportFormat(state.viewportFormat);
    App.renderer.resizeRenderer(true);
    updateAnalysisReadoutVisibility();
    updateFpsVisibility();
    App.hud.updateDependentControls();
    updateCameraKeyframeStatus();
    App.playback.setVolume(state.volume);
    App.playback.setMuted(state.muted);
    App.playback.setLoop(state.audioLoop);
    App.loop?.syncLoopButton();
    App.exporting?.syncExportControlsFromState();
  }

  function resetVisualControls() {
    App.stateManager?.record("Reset visualization");
    const visualKeys = [
      "heightScale", "historyLines", "frequencyBins", "fftSize", "smoothing", "scrollSpeed", "lineWidth", "lineOpacity", "lineColor",
      "logFrequency", "mirrorFrequency", "beatPulse", "amplitudeMode", "inputGain", "noiseFloor", "dynamicRange", "colorMode", "depthOpacity",
      "depthBrightness", "depthHeightDecay", "depthFog", "rowSpacing", "historyDepth", "depthCurve", "renderMode", "transientHighlight",
      "transientSensitivity", "transientIntensity", "transientDecay",
    ];
    for (const key of visualKeys) state[key] = DEFAULTS[key];
    syncAllControls({ rebuild: true });
  }

  function resetCameraControls() {
    App.stateManager?.record("Reset camera");
    for (const key of ["cameraDistance", "cameraHeight", "cameraDrift", "autoCamera", "cameraFollowSource", "cameraPreset", "cameraMotion", "cameraMotionSpeed", "showGrid"]) state[key] = DEFAULTS[key];
    state.cameraKeyframes = [];
    setInitialCamera();
    syncAllControls();
  }

  function resetHudControls() {
    App.stateManager?.record("Reset viewport and HUD");
    for (const key of ["showFps", "showAnalysisReadout", "viewportFormat", "showHud", "hudSpectrum", "hudWaveform", "hudLevels", "hudFrame", "hudFrequencyLabels", "hudOpacity", "hudScale", "safeAreaMode", "safeAreaAffectsHud", "qualityPreset"]) state[key] = DEFAULTS[key];
    syncAllControls();
  }

  function resetExportControls() {
    App.stateManager?.record("Reset export");
    for (const key of ["outputPreset", "exportFileName", "exportResolution", "videoFormat", "videoFps", "videoBitrate", "exportMode", "exportRange", "exportStart", "exportEnd"]) state[key] = DEFAULTS[key];
    App.exporting.syncExportControlsFromState();
  }

  function initializeCollapsiblePanels() {
    for (const panel of document.querySelectorAll("[data-collapsible]")) {
      const button = panel.querySelector(".panel__toggle");
      const content = panel.querySelector(".panel__content");
      const name = panel.dataset.sectionName || "section";
      if (!button || !content) continue;
      const update = (collapsed) => {
        panel.classList.toggle("is-collapsed", collapsed);
        button.setAttribute("aria-expanded", String(!collapsed));
        button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${name}`);
        button.title = `${collapsed ? "Expand" : "Collapse"} ${name}`;
        content.setAttribute("aria-hidden", String(collapsed));
        content.inert = collapsed;
        requestAnimationFrame(App.renderer.fitViewportFrame);
      };
      button.addEventListener("click", () => update(!panel.classList.contains("is-collapsed")));
      update(panel.classList.contains("is-collapsed"));
    }
  }

  function updateSidebarToggle() {
    elements.appShell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    elements.sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    elements.sidebarToggle.setAttribute("aria-label", state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
    elements.sidebarToggle.title = state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
    elements.sidebarToggleIcon.textContent = state.sidebarCollapsed ? "›" : "‹";
    requestAnimationFrame(App.renderer.fitViewportFrame);
    window.setTimeout(App.renderer.fitViewportFrame, 210);
  }

  function initializeSidebar() {
    elements.sidebarToggle.addEventListener("click", () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      updateSidebarToggle();
    });
    elements.openSidebar.addEventListener("click", () => elements.sidebar.classList.add("is-open"));
    elements.closeSidebar.addEventListener("click", () => elements.sidebar.classList.remove("is-open"));
    updateSidebarToggle();
  }

  function initializeControls() {
    bindRangeControls();
    bindVisualControls();
    bindCameraControls();
    bindHudControls();
    initializeCollapsiblePanels();
    initializeSidebar();
    elements.resetVisuals.addEventListener("click", resetVisualControls);
    elements.resetCamera.addEventListener("click", resetCameraControls);
    elements.resetHud.addEventListener("click", resetHudControls);
    elements.resetExport.addEventListener("click", resetExportControls);
    elements.resetAll.addEventListener("click", () => {
      if (window.confirm("Reset all visualization, camera, HUD, and export settings to their defaults?")) App.stateManager.resetAll();
    });
  }

  App.controlsUi = {
    initializeControls,
    syncAllControls,
    resetVisualControls,
    resetCameraControls,
    resetHudControls,
    resetExportControls,
    applyQualityPreset,
    updateFpsVisibility,
    updateAnalysisReadoutVisibility,
    updateSidebarToggle,
    updateCameraKeyframeStatus,
  };
})();
