(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { CONSTANTS } = App.config;
  const { formatTime, clamp } = App.utils;

  function resizePreviewCanvas() {
    const source = elements.canvas;
    const canvas = elements.hudCanvas;
    if (canvas.width !== source.width || canvas.height !== source.height) {
      canvas.width = source.width;
      canvas.height = source.height;
    }
  }

  function viewportLabel(width, height) {
    if (state.viewportFormat === "square" || Math.abs(width / height - 1) < 0.02) return "SQUARE";
    if (state.viewportFormat === "portrait" || height > width) return "PORTRAIT";
    return state.viewportFormat === "responsive" ? "RESPONSIVE" : "LANDSCAPE";
  }

  function drawPolyline(context, values, x, y, width, height, mapper) {
    if (!values || values.length < 2) return;
    context.beginPath();
    const count = values.length;
    for (let index = 0; index < count; index += 1) {
      const amount = index / Math.max(1, count - 1);
      const value = mapper(values[index], index);
      const px = x + amount * width;
      const py = y + height - clamp(value, 0, 1) * height;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();
  }

  function drawGraphFrame(context, x, y, width, height, label, fontSize) {
    context.strokeStyle = "rgba(245,245,245,0.24)";
    context.lineWidth = Math.max(1, width / 650);
    context.strokeRect(x, y, width, height);
    context.fillStyle = "rgba(245,245,245,0.62)";
    context.font = `${fontSize}px ${CONSTANTS.HUD_FONT}`;
    context.textBaseline = "bottom";
    context.fillText(label, x, y - fontSize * 0.35);
  }

  function drawMetadata(context, width, height, scale) {
    const marginX = width * 0.022;
    const marginY = height * 0.038;
    const fontSize = Math.max(10, Math.round(12 * scale));
    const smallSize = Math.max(8, Math.round(9 * scale));
    const lineHeight = fontSize * 1.45;
    const fileName = (state.loadedFileName || "NO FILE").toUpperCase();
    const duration = Number.isFinite(elements.audio.duration) ? elements.audio.duration : 0;
    const lines = [
      ["FILE", fileName],
      ["TIME", `${formatTime(elements.audio.currentTime)} / ${formatTime(duration)}`],
      ["VIEW", viewportLabel(width, height)],
      ["FFT", String(state.fftSize)],
      ["BINS", String(state.frequencyBins)],
      ["ENERGY", state.energy.toFixed(3)],
      ["PEAK", state.peak.toFixed(3)],
    ];

    context.textBaseline = "top";
    for (let index = 0; index < lines.length; index += 1) {
      const y = marginY + index * lineHeight;
      context.font = `${smallSize}px ${CONSTANTS.HUD_FONT}`;
      context.fillStyle = "rgba(245,245,245,0.46)";
      context.fillText(lines[index][0], marginX, y);
      context.font = `${fontSize}px ${CONSTANTS.HUD_FONT}`;
      context.fillStyle = "rgba(245,245,245,0.9)";
      context.fillText(lines[index][1], marginX + fontSize * 5.4, y - 1);
    }
  }

  function drawSpectrum(context, width, height, scale) {
    if (!state.hudSpectrum) return;
    const graphWidth = width * (width < height ? 0.34 : 0.22);
    const graphHeight = height * 0.105;
    const x = width - graphWidth - width * 0.025;
    const y = height * 0.06;
    const fontSize = Math.max(8, Math.round(9 * scale));
    drawGraphFrame(context, x, y, graphWidth, graphHeight, "FREQUENCY", fontSize);
    context.strokeStyle = state.lineColor;
    context.lineWidth = Math.max(1.2, 1.4 * scale);
    context.shadowColor = state.lineColor;
    context.shadowBlur = 4 * scale;
    drawPolyline(context, state.lastSpectrum, x, y, graphWidth, graphHeight, (value) => value);
    context.shadowBlur = 0;
  }

  function drawWaveform(context, width, height, scale) {
    if (!state.hudWaveform) return;
    const graphWidth = width * (width < height ? 0.38 : 0.24);
    const graphHeight = height * 0.085;
    const x = width * 0.025;
    const y = height - graphHeight - height * 0.055;
    const fontSize = Math.max(8, Math.round(9 * scale));
    drawGraphFrame(context, x, y, graphWidth, graphHeight, "WAVEFORM", fontSize);
    context.strokeStyle = "rgba(245,245,245,0.78)";
    context.lineWidth = Math.max(1, 1.15 * scale);
    drawPolyline(context, state.waveformData, x, y, graphWidth, graphHeight, (value) => value / 255);
  }

  function drawLevels(context, width, height, scale) {
    if (!state.hudLevels) return;
    const graphWidth = width * (width < height ? 0.3 : 0.17);
    const graphHeight = height * 0.085;
    const x = width - graphWidth - width * 0.025;
    const y = height - graphHeight - height * 0.055;
    const fontSize = Math.max(8, Math.round(9 * scale));
    drawGraphFrame(context, x, y, graphWidth, graphHeight, "PEAK / RMS", fontSize);

    const innerX = x + graphWidth * 0.05;
    const innerWidth = graphWidth * 0.9;
    const barHeight = graphHeight * 0.18;
    const firstY = y + graphHeight * 0.28;
    const secondY = y + graphHeight * 0.63;

    context.fillStyle = "rgba(245,245,245,0.12)";
    context.fillRect(innerX, firstY, innerWidth, barHeight);
    context.fillRect(innerX, secondY, innerWidth, barHeight);
    context.fillStyle = state.lineColor;
    context.fillRect(innerX, firstY, innerWidth * clamp(state.peak, 0, 1), barHeight);
    context.fillStyle = "rgba(245,245,245,0.78)";
    context.fillRect(innerX, secondY, innerWidth * clamp(state.energy * 2.2, 0, 1), barHeight);
  }

  function drawTechnicalFrame(context, width, height, scale) {
    if (!state.hudFrame) return;
    const inset = Math.max(12, Math.round(Math.min(width, height) * 0.018));
    const tick = Math.max(8, Math.round(12 * scale));
    const centerX = width / 2;
    const centerY = height / 2;

    context.strokeStyle = "rgba(245,245,245,0.34)";
    context.lineWidth = Math.max(1, scale);
    context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

    context.beginPath();
    context.moveTo(centerX - tick, centerY);
    context.lineTo(centerX + tick, centerY);
    context.moveTo(centerX, centerY - tick);
    context.lineTo(centerX, centerY + tick);
    context.stroke();

    const corner = tick * 1.8;
    context.beginPath();
    context.moveTo(inset, inset + corner);
    context.lineTo(inset, inset);
    context.lineTo(inset + corner, inset);
    context.moveTo(width - inset - corner, inset);
    context.lineTo(width - inset, inset);
    context.lineTo(width - inset, inset + corner);
    context.moveTo(inset, height - inset - corner);
    context.lineTo(inset, height - inset);
    context.lineTo(inset + corner, height - inset);
    context.moveTo(width - inset - corner, height - inset);
    context.lineTo(width - inset, height - inset);
    context.lineTo(width - inset, height - inset - corner);
    context.stroke();
  }

  function drawHud(context, width, height, forceVisible = false, clearCanvas = true) {
    if (clearCanvas) context.clearRect(0, 0, width, height);
    if (!state.showHud && !forceVisible) return;

    const scale = Math.max(0.75, Math.min(2.5, Math.min(width / 1920, height / 1080)));
    context.save();
    drawTechnicalFrame(context, width, height, scale);
    drawMetadata(context, width, height, scale);
    drawSpectrum(context, width, height, scale);
    drawWaveform(context, width, height, scale);
    drawLevels(context, width, height, scale);
    context.restore();
  }

  function renderPreview() {
    resizePreviewCanvas();
    const canvas = elements.hudCanvas;
    const context = canvas.getContext("2d");
    drawHud(context, canvas.width, canvas.height, false);
  }

  function updateDependentControls() {
    for (const row of document.querySelectorAll(".hud-dependent")) {
      row.classList.toggle("is-disabled", !state.showHud);
      const input = row.querySelector("input");
      if (input) input.disabled = !state.showHud;
    }
    elements.hudCanvas.classList.toggle("is-visible", state.showHud);
  }

  App.hud = {
    resizePreviewCanvas,
    drawHud,
    renderPreview,
    updateDependentControls,
  };
})();
