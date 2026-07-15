(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { CONSTANTS } = App.config;
  const { clamp, formatTime } = App.utils;

  const logoImage = new Image();
  logoImage.src = "./assets/images/spectrogramic-logo.svg";
  let logoPromise = null;

  const HUD_FORMAT_PRESETS = Object.freeze({
    landscape: { graphWidth: 10, graphHeight: 4.5, metadataX: 1.5, metadataY: 2.5, textScale: 0.75, logoX: 50, logoY: 5, logoSize: 5.5 },
    square: { graphWidth: 14, graphHeight: 4.5, metadataX: 2.5, metadataY: 2.5, textScale: 1.25, logoX: 50, logoY: 5, logoSize: 10 },
    portrait: { graphWidth: 22, graphHeight: 4.5, metadataX: 2.75, metadataY: 1.5, textScale: 1.5, logoX: 50, logoY: 3.5, logoSize: 14 },
  });

  const FREQUENCY_MARKERS = [20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000];

  function viewportLabel(width, height) {
    if (state.viewportFormat !== "responsive") return state.viewportFormat.toUpperCase();
    const aspect = width / Math.max(1, height);
    if (aspect < 0.75) return "PORTRAIT";
    if (aspect < 1.18) return "SQUARE";
    return "RESPONSIVE";
  }

  function getFormatName(width, height) {
    const label = viewportLabel(width, height).toLowerCase();
    return label === "portrait" || label === "square" ? label : "landscape";
  }

  function getHudFormatPreset(width, height) {
    return HUD_FORMAT_PRESETS[getFormatName(width, height)];
  }

  function ensureLogoReady() {
    if (logoImage.complete && logoImage.naturalWidth) return Promise.resolve(logoImage);
    if (!logoPromise) {
      logoPromise = new Promise((resolve, reject) => {
        logoImage.addEventListener("load", () => resolve(logoImage), { once: true });
        logoImage.addEventListener("error", () => reject(new Error("Viewport logo could not be loaded.")), { once: true });
      });
    }
    return logoPromise;
  }

  function resizePreviewCanvas() {
    const canvas = elements.hudCanvas;
    const rect = elements.viewportFrame.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function getSafeAreaRect(width, height, mode = state.safeAreaMode) {
    if (mode === "off") return { x: 0, y: 0, width, height, mode };
    if (mode === "90") return { x: width * 0.05, y: height * 0.05, width: width * 0.9, height: height * 0.9, mode };
    if (mode === "title") return { x: width * 0.1, y: height * 0.1, width: width * 0.8, height: height * 0.8, mode };

    const format = getFormatName(width, height);
    if (format === "portrait") {
      return { x: width * 0.055, y: height * 0.07, width: width * 0.78, height: height * 0.77, mode };
    }
    return { x: width * 0.07, y: height * 0.08, width: width * 0.86, height: height * 0.82, mode };
  }

  function getHudTextMetrics(width, height) {
    const preset = getHudFormatPreset(width, height);
    const base = Math.max(9, Math.min(width, height) * 0.0105);
    const fontSize = base * preset.textScale * state.hudScale;
    const safe = state.safeAreaAffectsHud ? getSafeAreaRect(width, height) : { x: 0, y: 0, width, height };
    return {
      fontSize: Math.max(8, fontSize),
      lineStep: Math.max(fontSize + 2, fontSize * 1.34),
      x: safe.x + safe.width * (preset.metadataX / 100),
      y: safe.y + safe.height * (preset.metadataY / 100),
    };
  }

  function getHudGraphLayout(width, height, pad) {
    const preset = getHudFormatPreset(width, height);
    const safe = state.safeAreaAffectsHud ? getSafeAreaRect(width, height) : { x: 0, y: 0, width, height };
    const graphWidth = safe.width * (preset.graphWidth / 100) * state.hudScale;
    const graphHeight = safe.height * (preset.graphHeight / 100) * state.hudScale;
    const graphFontSize = getHudTextMetrics(width, height).fontSize;
    const graphLabelGap = Math.max(4, graphFontSize * 0.55);
    const inset = Math.max(8, pad * state.hudScale);

    const graphRect = (placement) => {
      const isRight = placement.endsWith("right");
      const isTop = placement.startsWith("top");
      return {
        x: isRight ? safe.x + safe.width - inset - graphWidth : safe.x + inset,
        y: isTop
          ? safe.y + inset + graphFontSize + graphLabelGap
          : safe.y + safe.height - inset - graphHeight,
        width: graphWidth,
        height: graphHeight,
        isRight,
      };
    };

    return {
      graphFontSize,
      graphLabelGap,
      frequency: graphRect("top-right"),
      waveform: graphRect("bottom-left"),
      levels: graphRect("bottom-right"),
    };
  }

  function updateViewportLogoLayout() {
    if (!elements.viewportLogo) return;
    const rect = elements.viewportFrame.getBoundingClientRect();
    const width = Math.max(1, rect.width || elements.canvas.clientWidth || 1920);
    const height = Math.max(1, rect.height || elements.canvas.clientHeight || 1080);
    const preset = getHudFormatPreset(width, height);
    elements.viewportLogo.style.left = `${preset.logoX}%`;
    elements.viewportLogo.style.top = `${preset.logoY}%`;
    elements.viewportLogo.style.width = `${preset.logoSize}%`;
  }

  function drawViewportLogo(context, width, height) {
    if (!logoImage.complete || !logoImage.naturalWidth || !logoImage.naturalHeight) return;
    const preset = getHudFormatPreset(width, height);
    const drawWidth = width * (preset.logoSize / 100);
    const drawHeight = drawWidth * (logoImage.naturalHeight / logoImage.naturalWidth);
    const centerX = width * (preset.logoX / 100);
    const centerY = height * (preset.logoY / 100);
    context.save();
    context.globalAlpha = 0.92;
    context.drawImage(logoImage, centerX - drawWidth / 2, centerY - drawHeight / 2, drawWidth, drawHeight);
    context.restore();
  }

  function drawPolyline(context, values, x, y, width, height, mapper) {
    if (!values || values.length < 2) return;
    context.beginPath();
    for (let index = 0; index < values.length; index += 1) {
      const amount = index / Math.max(1, values.length - 1);
      const value = mapper(values[index], index);
      const px = x + amount * width;
      const py = y + height - clamp(value, 0, 1) * height;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();
  }

  function drawGraphFrame(context, rectangle, label, fontSize) {
    context.strokeStyle = "rgba(245,245,245,0.42)";
    context.lineWidth = Math.max(0.8, rectangle.width / 650);
    context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.fillStyle = "rgba(245,245,245,0.82)";
    context.font = `${fontSize}px ${CONSTANTS.HUD_FONT}`;
    context.textBaseline = "top";
    context.textAlign = rectangle.isRight ? "right" : "left";
    context.fillText(label, rectangle.isRight ? rectangle.x + rectangle.width : rectangle.x, rectangle.y - fontSize * 1.55);
    context.textAlign = "left";
  }

  function truncateFileName(name, maximumLength) {
    const normalized = String(name || "NO AUDIO FILE").toUpperCase();
    if (normalized.length <= maximumLength) return normalized;
    const extensionIndex = normalized.lastIndexOf(".");
    const extension = extensionIndex > 0 ? normalized.slice(extensionIndex) : "";
    const baseLength = Math.max(4, maximumLength - extension.length - 1);
    return `${normalized.slice(0, baseLength)}…${extension}`;
  }

  function currentHudTime() {
    return Number.isFinite(state.exportPlaybackTimeOverride)
      ? state.exportPlaybackTimeOverride
      : elements.audio.currentTime;
  }

  function drawMetadata(context, width, height) {
    const metrics = getHudTextMetrics(width, height);
    const duration = Number.isFinite(elements.audio.duration) ? elements.audio.duration : 0;
    const maximumFileLength = viewportLabel(width, height) === "SQUARE" ? 30 : 38;
    const lines = [
      "SYS/WATERFALL SPECTROGRAM",
      truncateFileName(state.loadedFileName, maximumFileLength),
      `TIME:${formatTime(currentHudTime())} / ${formatTime(duration)}`,
      `VIEW:${viewportLabel(width, height)}`,
      `FFT:${state.fftSize} / BINS:${state.frequencyBins}`,
      `ENERGY:${state.energy.toFixed(3)} / PEAK:${state.peak.toFixed(3)}`,
    ];
    context.textBaseline = "top";
    context.textAlign = "left";
    context.font = `${metrics.fontSize}px ${CONSTANTS.HUD_FONT}`;
    context.fillStyle = "rgba(245,245,245,0.9)";
    for (let index = 0; index < lines.length; index += 1) context.fillText(lines[index], metrics.x, metrics.y + index * metrics.lineStep);
  }

  function frequencyLabel(frequency) {
    return frequency >= 1000 ? `${frequency / 1000}K` : String(frequency);
  }

  function drawFrequencyLabels(context, rectangle, fontSize) {
    if (!state.hudFrequencyLabels) return;
    context.save();
    context.font = `${Math.max(7, fontSize * 0.72)}px ${CONSTANTS.HUD_FONT}`;
    context.fillStyle = "rgba(245,245,245,0.58)";
    context.strokeStyle = "rgba(245,245,245,0.2)";
    context.textBaseline = "top";
    for (const frequency of FREQUENCY_MARKERS) {
      const amount = Math.log(frequency / 20) / Math.log(20000 / 20);
      const x = rectangle.x + clamp(amount, 0, 1) * rectangle.width;
      context.beginPath();
      context.moveTo(x, rectangle.y + rectangle.height);
      context.lineTo(x, rectangle.y + rectangle.height + fontSize * 0.38);
      context.stroke();
      context.textAlign = amount < 0.08 ? "left" : amount > 0.92 ? "right" : "center";
      context.fillText(frequencyLabel(frequency), x, rectangle.y + rectangle.height + fontSize * 0.48);
    }
    context.restore();
  }

  function drawSpectrum(context, layout, scale) {
    if (!state.hudSpectrum) return;
    const rectangle = layout.frequency;
    drawGraphFrame(context, rectangle, "FR MAGNITUDE", layout.graphFontSize);
    context.strokeStyle = state.lineColor;
    context.lineWidth = Math.max(1, 1.2 * scale);
    context.shadowColor = state.lineColor;
    context.shadowBlur = 3 * scale;
    drawPolyline(context, state.lastSpectrum, rectangle.x, rectangle.y, rectangle.width, rectangle.height, (value) => value);
    context.shadowBlur = 0;
    drawFrequencyLabels(context, rectangle, layout.graphFontSize);
  }

  function drawWaveform(context, layout, scale) {
    if (!state.hudWaveform) return;
    const rectangle = layout.waveform;
    drawGraphFrame(context, rectangle, "WAVEFORM", layout.graphFontSize);
    context.strokeStyle = "rgba(245,245,245,0.82)";
    context.lineWidth = Math.max(0.8, scale);
    drawPolyline(context, state.waveformData, rectangle.x, rectangle.y, rectangle.width, rectangle.height, (value) => value / 255);
  }

  function drawLevels(context, layout) {
    if (!state.hudLevels) return;
    const rectangle = layout.levels;
    drawGraphFrame(context, rectangle, "LEVELS", layout.graphFontSize);
    const innerX = rectangle.x + rectangle.width * 0.05;
    const innerWidth = rectangle.width * 0.9;
    const barHeight = rectangle.height * 0.18;
    const firstY = rectangle.y + rectangle.height * 0.28;
    const secondY = rectangle.y + rectangle.height * 0.63;
    context.fillStyle = "rgba(245,245,245,0.12)";
    context.fillRect(innerX, firstY, innerWidth, barHeight);
    context.fillRect(innerX, secondY, innerWidth, barHeight);
    context.fillStyle = state.lineColor;
    context.fillRect(innerX, firstY, innerWidth * clamp(state.peak, 0, 1), barHeight);
    context.fillStyle = "rgba(245,245,245,0.78)";
    context.fillRect(innerX, secondY, innerWidth * clamp(state.energy * 2.2, 0, 1), barHeight);
  }

  function drawTechnicalFrame(context, width, height, scale, pad) {
    if (!state.hudFrame) return;
    const tickCount = 10;
    const centerX = width / 2;
    const centerY = height / 2;
    const crosshairSize = Math.max(8, Math.round(12 * scale));
    context.strokeStyle = "rgba(245,245,245,0.42)";
    context.lineWidth = Math.max(0.8, width / 1920);
    context.strokeRect(pad, pad, width - pad * 2, height - pad * 2);
    for (let index = 0; index <= tickCount; index += 1) {
      const x = pad + ((width - pad * 2) * index) / tickCount;
      const y = pad + ((height - pad * 2) * index) / tickCount;
      const tickSize = index % 5 === 0 ? 7 * scale : 4 * scale;
      context.beginPath();
      context.moveTo(x, pad); context.lineTo(x, pad + tickSize);
      context.moveTo(x, height - pad); context.lineTo(x, height - pad - tickSize);
      context.moveTo(pad, y); context.lineTo(pad + tickSize, y);
      context.moveTo(width - pad, y); context.lineTo(width - pad - tickSize, y);
      context.stroke();
    }
    context.beginPath();
    context.moveTo(centerX - crosshairSize, centerY); context.lineTo(centerX + crosshairSize, centerY);
    context.moveTo(centerX, centerY - crosshairSize); context.lineTo(centerX, centerY + crosshairSize);
    context.stroke();
  }

  function drawSafeArea(context, width, height) {
    if (state.safeAreaMode === "off") return;
    const rectangle = getSafeAreaRect(width, height);
    const scale = Math.max(0.65, Math.min(2.5, Math.min(width / 1920, height / 1080)));
    context.save();
    context.setLineDash([8 * scale, 6 * scale]);
    context.strokeStyle = "rgba(255,255,255,0.38)";
    context.lineWidth = Math.max(1, scale);
    context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.setLineDash([]);
    context.font = `${Math.max(8, 10 * scale)}px ${CONSTANTS.HUD_FONT}`;
    context.fillStyle = "rgba(255,255,255,0.55)";
    context.textAlign = "left";
    context.textBaseline = "bottom";
    const label = state.safeAreaMode === "social" ? "SOCIAL SAFE AREA" : state.safeAreaMode === "title" ? "TITLE SAFE" : "90% SAFE AREA";
    context.fillText(label, rectangle.x + 5 * scale, rectangle.y - 4 * scale);
    context.restore();
  }

  function drawHud(context, width, height, forceVisible = false, clearCanvas = true, includeLogo = true, options = {}) {
    if (clearCanvas) context.clearRect(0, 0, width, height);
    if (includeLogo) drawViewportLogo(context, width, height);
    const shouldDrawHud = state.showHud || forceVisible;
    if (shouldDrawHud) {
      const scale = Math.max(0.65, Math.min(2.5, Math.min(width / 1920, height / 1080))) * state.hudScale;
      const pad = Math.max(10, Math.min(width, height) * 0.018 * state.hudScale);
      const layout = getHudGraphLayout(width, height, pad);
      context.save();
      context.globalAlpha = state.hudOpacity;
      drawTechnicalFrame(context, width, height, scale, pad);
      drawMetadata(context, width, height);
      drawSpectrum(context, layout, scale);
      drawWaveform(context, layout, scale);
      drawLevels(context, layout);
      context.restore();
    }
    if (options.includeSafeArea) drawSafeArea(context, width, height);
  }

  function renderPreview(force = false) {
    const now = performance.now();
    const quality = App.config.QUALITY_PRESETS[state.qualityPreset];
    const hudFps = state.qualityPreset === "auto" ? Math.max(18, Math.min(60, state.currentFps || 30)) : quality?.hudFps || 30;
    if (!force && now - state.hudLastRenderAt < 1000 / hudFps) return;
    state.hudLastRenderAt = now;
    resizePreviewCanvas();
    updateViewportLogoLayout();
    const canvas = elements.hudCanvas;
    const context = canvas.getContext("2d");
    drawHud(context, canvas.width, canvas.height, false, true, false, { includeSafeArea: state.safeAreaMode !== "off" });
  }

  function updateDependentControls() {
    for (const row of document.querySelectorAll(".hud-dependent")) {
      row.classList.toggle("is-disabled", !state.showHud);
      const input = row.querySelector("input");
      if (input) input.disabled = !state.showHud;
    }
    elements.hudCanvas.classList.toggle("is-visible", state.showHud || state.safeAreaMode !== "off");
    elements.viewportLogo?.classList.remove("is-hidden");
    updateViewportLogoLayout();
    renderPreview(true);
  }

  App.hud = {
    resizePreviewCanvas,
    getHudFormatPreset,
    getHudGraphLayout,
    getSafeAreaRect,
    updateViewportLogoLayout,
    ensureLogoReady,
    drawViewportLogo,
    drawHud,
    drawSafeArea,
    renderPreview,
    updateDependentControls,
  };
})();
