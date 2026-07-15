(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state, grid, setInitialCamera } = App.core;
  const { DEFAULTS, CONTROL_DEFINITIONS } = App.config;
  const { setRangeFill } = App.utils;

  const visualToggleNames = ["logFrequency", "mirrorFrequency", "beatPulse"];
  const hudToggleNames = ["showFps", "showAnalysisReadout", "showHud", "hudSpectrum", "hudWaveform", "hudLevels", "hudFrame"];

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

  function applyRangeValue(name, definition, commitRebuild) {
    const input = document.querySelector(`#${name}`);
    const output = document.querySelector(`#${name}Value`);
    const value = definition.parser(input.value);
    output.textContent = definition.format(value);
    setRangeFill(input);

    if (definition.rebuild && !commitRebuild) return;
    state[name] = value;

    if (name === "smoothing") App.analysis.applySmoothing();
    else if (name === "lineWidth") App.analysis.updateLineWidths();
    else if (name === "lineOpacity") App.analysis.applyLineOpacity();
    else if (name === "cameraDistance" || name === "cameraHeight") App.renderer.updateCameraFromControls();

    if (definition.rebuild && commitRebuild) App.analysis.rebuildSpectrogram();
  }

  function bindRangeControls() {
    for (const [name, definition] of Object.entries(CONTROL_DEFINITIONS)) {
      const input = document.querySelector(`#${name}`);
      const output = document.querySelector(`#${name}Value`);
      if (!input || !output) continue;

      input.value = String(state[name]);
      output.textContent = definition.format(state[name]);
      setRangeFill(input);
      input.addEventListener("input", () => applyRangeValue(name, definition, false));
      input.addEventListener("change", () => applyRangeValue(name, definition, true));
    }
  }

  function bindVisualControls() {
    elements.fftSize.value = String(state.fftSize);
    elements.fftSize.addEventListener("change", () => {
      state.fftSize = Number(elements.fftSize.value);
      App.analysis.applyFftSize();
    });

    elements.lineColor.value = state.lineColor;
    elements.lineColorValue.textContent = state.lineColor.toUpperCase();
    elements.lineColor.addEventListener("input", () => {
      state.lineColor = elements.lineColor.value;
      elements.lineColorValue.textContent = state.lineColor.toUpperCase();
      App.analysis.applyLineColor();
    });

    for (const name of visualToggleNames) {
      const input = document.querySelector(`#${name}`);
      input.checked = state[name];
      input.addEventListener("change", () => {
        state[name] = input.checked;
        if (name === "logFrequency" || name === "mirrorFrequency") state.spectrumMapKey = "";
      });
    }

    elements.autoCamera.checked = state.autoCamera;
    elements.autoCamera.addEventListener("change", () => {
      state.autoCamera = elements.autoCamera.checked;
    });

    elements.showGrid.checked = state.showGrid;
    elements.showGrid.addEventListener("change", () => {
      state.showGrid = elements.showGrid.checked;
      grid.visible = state.showGrid;
    });
  }

  function bindHudControls() {
    elements.viewportFormat.value = state.viewportFormat;
    elements.viewportFormat.addEventListener("change", () => {
      App.renderer.setViewportFormat(elements.viewportFormat.value);
    });

    for (const name of hudToggleNames) {
      const input = document.querySelector(`#${name}`);
      input.checked = state[name];
      input.addEventListener("change", () => {
        state[name] = input.checked;
        if (name === "showFps") {
          state.fpsFrameCount = 0;
          state.fpsLastUpdate = performance.now();
          elements.fpsReadout.textContent = "0";
          updateFpsVisibility();
        }
        if (name === "showAnalysisReadout") updateAnalysisReadoutVisibility();
        if (name === "showHud") App.hud.updateDependentControls();
      });
    }

    updateAnalysisReadoutVisibility();
    updateFpsVisibility();
    App.hud.updateDependentControls();
  }

  function resetVisualControls() {
    for (const [name, definition] of Object.entries(CONTROL_DEFINITIONS)) {
      if (["cameraDistance", "cameraHeight", "cameraDrift"].includes(name)) continue;
      const input = document.querySelector(`#${name}`);
      const output = document.querySelector(`#${name}Value`);
      input.value = String(DEFAULTS[name]);
      state[name] = DEFAULTS[name];
      output.textContent = definition.format(DEFAULTS[name]);
      setRangeFill(input);
    }

    state.fftSize = DEFAULTS.fftSize;
    elements.fftSize.value = String(DEFAULTS.fftSize);
    App.analysis.applyFftSize();

    state.lineColor = DEFAULTS.lineColor;
    elements.lineColor.value = DEFAULTS.lineColor;
    elements.lineColorValue.textContent = DEFAULTS.lineColor.toUpperCase();

    for (const name of visualToggleNames) {
      state[name] = DEFAULTS[name];
      document.querySelector(`#${name}`).checked = DEFAULTS[name];
    }

    App.analysis.applyLineColor();
    App.analysis.applySmoothing();
    App.analysis.rebuildSpectrogram();
  }

  function resetCameraControls() {
    for (const name of ["cameraDistance", "cameraHeight", "cameraDrift"]) {
      const definition = CONTROL_DEFINITIONS[name];
      const input = document.querySelector(`#${name}`);
      const output = document.querySelector(`#${name}Value`);
      state[name] = DEFAULTS[name];
      input.value = String(DEFAULTS[name]);
      output.textContent = definition.format(DEFAULTS[name]);
      setRangeFill(input);
    }

    state.autoCamera = DEFAULTS.autoCamera;
    elements.autoCamera.checked = DEFAULTS.autoCamera;
    state.showGrid = DEFAULTS.showGrid;
    elements.showGrid.checked = DEFAULTS.showGrid;
    grid.visible = state.showGrid;
    setInitialCamera();
  }

  function resetHudControls() {
    for (const name of hudToggleNames) {
      state[name] = DEFAULTS[name];
      document.querySelector(`#${name}`).checked = DEFAULTS[name];
    }
    state.viewportFormat = DEFAULTS.viewportFormat;
    elements.viewportFormat.value = DEFAULTS.viewportFormat;
    updateAnalysisReadoutVisibility();
    updateFpsVisibility();
    App.hud.updateDependentControls();
    App.renderer.setViewportFormat(DEFAULTS.viewportFormat);
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
    bindHudControls();
    initializeCollapsiblePanels();
    initializeSidebar();
    elements.resetVisuals.addEventListener("click", resetVisualControls);
    elements.resetCamera.addEventListener("click", resetCameraControls);
    elements.resetHud.addEventListener("click", resetHudControls);
  }

  App.controlsUi = {
    initializeControls,
    resetVisualControls,
    resetCameraControls,
    resetHudControls,
    updateFpsVisibility,
    updateAnalysisReadoutVisibility,
    updateSidebarToggle,
  };
})();
