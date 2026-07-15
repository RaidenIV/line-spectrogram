(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state, renderer } = App.core;

  function supportsMime(candidates) {
    return Boolean(window.MediaRecorder?.isTypeSupported && candidates.some((type) => MediaRecorder.isTypeSupported(type)));
  }

  function capabilityRows() {
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const rendererName = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    const webgl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    const mp4 = supportsMime(["video/mp4;codecs=h264,aac", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]);
    const mkv = supportsMime(["video/x-matroska;codecs=vp9,opus", "video/x-matroska;codecs=vp8,opus", "video/x-matroska", "video/webm;codecs=vp9,opus"]);
    const audioContext = Boolean(window.AudioContext || window.webkitAudioContext);
    const offline = Boolean(window.VideoEncoder && window.AudioEncoder && window.VideoFrame && window.AudioData);
    return [
      ["WebGL 2", webgl2 ? "SUPPORTED" : "WEBGL 1 FALLBACK", webgl2],
      ["Web Audio", audioContext ? "SUPPORTED" : "UNAVAILABLE", audioContext],
      ["Real-Time Video Export", window.MediaRecorder && HTMLCanvasElement.prototype.captureStream ? "SUPPORTED" : "UNAVAILABLE", Boolean(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream)],
      ["Offline MP4 Export", offline ? "SUPPORTED" : "UNAVAILABLE", offline],
      ["MP4", mp4 ? "SUPPORTED" : "UNAVAILABLE", mp4],
      ["MKV / WebM", mkv ? "SUPPORTED" : "UNAVAILABLE", mkv],
      ["Max Texture Size", String(gl.getParameter(gl.MAX_TEXTURE_SIZE)), true],
      ["Max Renderbuffer", String(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)), true],
      ["Hardware Renderer", rendererName || "UNKNOWN", Boolean(rendererName)],
      ["Context Status", state.contextLost ? "LOST" : "ACTIVE", !state.contextLost],
    ];
  }

  function renderCapabilities() {
    elements.capabilityGrid.replaceChildren();
    for (const [label, value, supported] of capabilityRows()) {
      const row = document.createElement("div");
      row.className = "capability-row";
      const name = document.createElement("span");
      name.textContent = label;
      const status = document.createElement("strong");
      status.textContent = value;
      status.dataset.supported = String(Boolean(supported));
      row.append(name, status);
      elements.capabilityGrid.append(row);
    }
  }

  function openModal(modal) {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => modal.querySelector("button")?.focus());
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.hidden = true;
    if (![elements.shortcutsModal, elements.diagnosticsModal, elements.errorModal].some((item) => item && !item.hidden)) {
      document.body.classList.remove("modal-open");
    }
  }

  function showCapabilities() {
    renderCapabilities();
    openModal(elements.diagnosticsModal);
  }

  function showError(title, message, suggestions = []) {
    elements.errorTitle.textContent = title || "OPERATION COULD NOT BE COMPLETED";
    elements.errorMessage.textContent = message || "An unexpected error occurred.";
    elements.errorSuggestions.replaceChildren();
    for (const suggestion of suggestions.filter(Boolean)) {
      const item = document.createElement("li");
      item.textContent = suggestion;
      elements.errorSuggestions.append(item);
    }
    openModal(elements.errorModal);
  }

  function handleContextLost(event) {
    event.preventDefault();
    state.contextLost = true;
    elements.contextLossTitle.textContent = "RENDERER PAUSED";
    elements.contextLossMessage.textContent = "The WebGL context was lost. Waiting for the browser to restore it.";
    elements.contextLossOverlay.hidden = false;
  }

  function handleContextRestored() {
    elements.contextLossTitle.textContent = "RESTORING RENDERER";
    elements.contextLossMessage.textContent = "Rebuilding GPU resources and restoring the visualization.";
    try {
      App.renderer.rebuildAfterContextRestore();
      elements.contextLossOverlay.hidden = true;
    } catch (error) {
      console.error(error);
      elements.contextLossTitle.textContent = "RENDERER RECOVERY FAILED";
      elements.contextLossMessage.textContent = "Reload the page or use Rebuild Renderer to try again.";
    }
  }

  function initialize() {
    elements.shortcutsButton?.addEventListener("click", () => openModal(elements.shortcutsModal));
    elements.diagnosticsButton?.addEventListener("click", showCapabilities);
    for (const button of document.querySelectorAll("[data-close-modal]")) {
      button.addEventListener("click", () => closeModal(document.getElementById(button.dataset.closeModal)));
    }
    for (const modal of [elements.shortcutsModal, elements.diagnosticsModal, elements.errorModal]) {
      modal?.addEventListener("pointerdown", (event) => {
        if (event.target === modal) closeModal(modal);
      });
    }
    elements.canvas.addEventListener("webglcontextlost", handleContextLost, false);
    elements.canvas.addEventListener("webglcontextrestored", handleContextRestored, false);
    elements.reloadRendererButton?.addEventListener("click", handleContextRestored);
  }

  App.diagnostics = {
    initialize,
    showCapabilities,
    showError,
    openModal,
    closeModal,
    renderCapabilities,
  };
})();
