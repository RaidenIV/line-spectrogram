(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state, camera, controls } = App.core;
  const { DEFAULTS, CONSTANTS } = App.config;
  const { deepClone, clamp, setStatus } = App.utils;

  function serializableSettings() {
    const settings = {};
    for (const key of Object.keys(DEFAULTS)) settings[key] = deepClone(state[key]);
    settings.cameraKeyframes = deepClone(state.cameraKeyframes);
    settings.cameraPose = {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    };
    return settings;
  }

  function snapshotKey(snapshot) {
    return JSON.stringify(snapshot);
  }

  function updateHistoryButtons() {
    if (elements.undoButton) elements.undoButton.disabled = state.undoStack.length === 0;
    if (elements.redoButton) elements.redoButton.disabled = state.redoStack.length === 0;
  }

  function record(label = "Change") {
    if (state.applyingSnapshot) return;
    const snapshot = { label, settings: serializableSettings() };
    const key = snapshotKey(snapshot.settings);
    const previous = state.undoStack[state.undoStack.length - 1];
    if (previous && snapshotKey(previous.settings) === key) return;
    state.undoStack.push(snapshot);
    if (state.undoStack.length > CONSTANTS.MAX_UNDO_STATES) state.undoStack.shift();
    state.redoStack.length = 0;
    state.lastSnapshotKey = key;
    updateHistoryButtons();
  }

  function normalizeSetting(key, value) {
    const fallback = DEFAULTS[key];
    if (typeof fallback === "boolean") return Boolean(value);
    if (typeof fallback === "number") {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      const input = document.getElementById(key);
      const minimum = input?.min !== "" ? Number(input?.min) : -Infinity;
      const maximum = input?.max !== "" ? Number(input?.max) : Infinity;
      return clamp(number, Number.isFinite(minimum) ? minimum : -Infinity, Number.isFinite(maximum) ? maximum : Infinity);
    }
    if (typeof value !== "string") return fallback;
    const input = document.getElementById(key);
    if (input instanceof HTMLSelectElement && ![...input.options].some((option) => option.value === value)) return fallback;
    if (input?.type === "color" && !/^#[0-9a-f]{6}$/i.test(value)) return fallback;
    return value;
  }

  function applySettings(settings, options = {}) {
    if (!settings || typeof settings !== "object") throw new Error("The JSON file does not contain a valid settings object.");
    if (options.record !== false) record(options.label || "Import settings");
    state.applyingSnapshot = true;
    try {
      for (const key of Object.keys(DEFAULTS)) {
        if (Object.prototype.hasOwnProperty.call(settings, key)) state[key] = normalizeSetting(key, settings[key]);
      }
      if (Array.isArray(settings.cameraKeyframes)) {
        state.cameraKeyframes = settings.cameraKeyframes
          .filter((item) => item && Number.isFinite(Number(item.time)) && Array.isArray(item.position) && Array.isArray(item.target))
          .map((item) => ({ time: Math.max(0, Number(item.time)), position: item.position.slice(0, 3).map(Number), target: item.target.slice(0, 3).map(Number) }))
          .sort((a, b) => a.time - b.time);
      }
      if (settings.cameraPose?.position?.length >= 3 && settings.cameraPose?.target?.length >= 3) {
        camera.position.fromArray(settings.cameraPose.position.map(Number));
        controls.target.fromArray(settings.cameraPose.target.map(Number));
        controls.update();
        state.cameraBasePosition = camera.position.clone();
        state.cameraBaseTarget = controls.target.clone();
      }
      App.controlsUi?.syncAllControls({ rebuild: true });
      App.exporting?.updateExportEstimate();
      App.hud?.updateDependentControls();
      state.lastSnapshotKey = snapshotKey(serializableSettings());
    } finally {
      state.applyingSnapshot = false;
      updateHistoryButtons();
    }
  }

  function undo() {
    const previous = state.undoStack.pop();
    if (!previous) return;
    state.redoStack.push({ label: previous.label, settings: serializableSettings() });
    applySettings(previous.settings, { record: false });
    updateHistoryButtons();
  }

  function redo() {
    const next = state.redoStack.pop();
    if (!next) return;
    state.undoStack.push({ label: next.label, settings: serializableSettings() });
    applySettings(next.settings, { record: false });
    updateHistoryButtons();
  }

  async function importSettingsFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const settings = payload?.settings || payload;
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("The JSON file does not contain a settings object.");
      if (payload?.app && payload.app !== "Waterfall Spectrogram") {
        throw new Error(`This preset was created by “${payload.app}”, not Waterfall Spectrogram.`);
      }
      if (Number(payload?.version) > CONSTANTS.SETTINGS_VERSION) {
        throw new Error(`This preset uses settings version ${payload.version}, but this build supports version ${CONSTANTS.SETTINGS_VERSION}.`);
      }
      applySettings(settings, { label: `Import ${file.name}` });
      setStatus(elements.exportStatus, `Settings imported: ${file.name}`);
    } catch (error) {
      console.error(error);
      App.diagnostics?.showError(
        "SETTINGS COULD NOT BE IMPORTED",
        error.message || "The selected JSON file is invalid.",
        ["Export a fresh preset from Waterfall Spectrogram.", "Verify that the JSON file was not edited into an invalid format."]
      );
      setStatus(elements.exportStatus, `Settings import failed: ${error.message}`, true);
    }
  }

  function resetAll() {
    record("Reset all");
    applySettings({ ...DEFAULTS, cameraKeyframes: [] }, { record: false });
  }

  function initialize() {
    state.lastSnapshotKey = snapshotKey(serializableSettings());
    elements.undoButton?.addEventListener("click", undo);
    elements.redoButton?.addEventListener("click", redo);
    elements.importSettingsButton?.addEventListener("click", () => elements.importSettingsInput?.click());
    elements.importSettingsInput?.addEventListener("change", (event) => {
      importSettingsFile(event.target.files?.[0]);
      event.target.value = "";
    });
    updateHistoryButtons();
  }

  App.stateManager = {
    initialize,
    serializableSettings,
    record,
    applySettings,
    undo,
    redo,
    importSettingsFile,
    resetAll,
    updateHistoryButtons,
  };
})();
