(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { CONSTANTS } = App.config;
  const { formatTime, clamp } = App.utils;

  const logoImage = new Image();
  let logoReadyResolve;
  const logoReadyPromise = new Promise((resolve) => {
    logoReadyResolve = resolve;
  });

  logoImage.addEventListener("load", () => {
    logoReadyResolve(true);
    updateViewportLogoLayout();
  }, { once: true });
  logoImage.addEventListener("error", () => logoReadyResolve(false), { once: true });
  logoImage.src = "./assets/images/spectrogramic-logo.svg";

  function ensureLogoReady() {
    if (logoImage.complete) return Promise.resolve(Boolean(logoImage.naturalWidth));
    return logoReadyPromise;
  }

  function resizePreviewCanvas() {
    const source = elements.canvas;
    const canvas = elements.hudCanvas;
    if (canvas.width !== source.width || canvas.height !== source.height) {
      canvas.width = source.width;
      canvas.height = source.height;
    }
  }

  function viewportLabel(width, height) {
    if (Math.abs(width / Math.max(1, height) - 1) < 0.02) return "SQUARE";
    if (height > width) return "PORTRAIT";
    return state.viewportFormat === "responsive" ? "RESPONSIVE" : "LANDSCAPE";
  }

  function getHudFormatPreset(width, height) {
    const format = viewportLabel(width, height);

    if (format === "SQUARE") {
      return {
        graphWidth: 14,
        graphHeight: 4.5,
        metadataX: 2.5,
        metadataY: 2.5,
        guiTextSize: 1.25,
        logoX: 50,
        logoY: 5,
        logoSize: 10,
      };
    }

    if (format === "PORTRAIT") {
      return {
        graphWidth: 22,
        graphHeight: 4.5,
        metadataX: 2.75,
        metadataY: 1.5,
        guiTextSize: 1.5,
        logoX: 50,
        logoY: 3.5,
        logoSize: 14,
      };
    }

    return {
      graphWidth: 10,
      graphHeight: 4.5,
      metadataX: 1.5,
      metadataY: 2.5,
      guiTextSize: 0.75,
      logoX: 50,
      logoY: 5,
      logoSize: 5.5,
    };
  }

  function getHudTextMetrics(width, height) {
    const preset = getHudFormatPreset(width, height);
    const fontSize = Math.max(6, width * (preset.guiTextSize / 100));
    return {
      fontSize,
      smallSize: Math.max(6, fontSize * 0.78),
      lineStep: Math.max(fontSize + 2, fontSize * 1.34),
      x: width * (preset.metadataX / 100),
      y: height * (preset.metadataY / 100),
    };
  }

  function getHudGraphLayout(width, height, pad) {
    const preset = getHudFormatPreset(width, height);
    const graphWidth = width * (preset.graphWidth / 100);
    const graphHeight = height * (preset.graphHeight / 100);
    const graphFontSize = getHudTextMetrics(width, height).fontSize;
    const graphLabelGap = Math.max(4, graphFontSize * 0.55);

    const graphRect = (placement) => {
      const isRight = placement.endsWith("right");
      const isTop = placement.startsWith("top");
      return {
        x: isRight ? width - pad - graphWidth - 8 : pad + 9,
        y: isTop
          ? pad + graphFontSize + graphLabelGap + 8
          : height - pad - graphHeight - 9,
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
    context.drawImage(
      logoImage,
      centerX - drawWidth / 2,
      centerY - drawHeight / 2,
      drawWidth,
      drawHeight
    );
    context.restore();
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

  function drawGraphFrame(context, rectangle, label, fontSize) {
    context.strokeStyle = "rgba(245,245,245,0.42)";
    context.lineWidth = Math.max(0.8, rectangle.width / 650);
    context.strokeRect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
    context.fillStyle = "rgba(245,245,245,0.82)";
    context.font = `${fontSize}px ${CONSTANTS.HUD_FONT}`;
    context.textBaseline = "top";
    context.textAlign = rectangle.isRight ? "right" : "left";
    context.fillText(
      label,
      rectangle.isRight ? rectangle.x + rectangle.width : rectangle.x,
      rectangle.y - fontSize * 1.55
    );
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

  function drawMetadata(context, width, height) {
    const metrics = getHudTextMetrics(width, height);
    const duration = Number.isFinite(elements.audio.duration) ? elements.audio.duration : 0;
    const maximumFileLength = viewportLabel(width, height) === "SQUARE" ? 30 : 38;
    const lines = [
      `SYS/3D SPECTROGRAM`,
      truncateFileName(state.loadedFileName, maximumFileLength),
      `TIME:${formatTime(elements.audio.currentTime)} / ${formatTime(duration)}`,
      `VIEW:${viewportLabel(width, height)}`,
      `FFT:${state.fftSize} / BINS:${state.frequencyBins}`,
      `ENERGY:${state.energy.toFixed(3)} / PEAK:${state.peak.toFixed(3)}`,
    ];

    context.textBaseline = "top";
    context.textAlign = "left";
    context.font = `${metrics.fontSize}px ${CONSTANTS.HUD_FONT}`;
    context.fillStyle = "rgba(245,245,245,0.9)";
    for (let index = 0; index < lines.length; index += 1) {
      context.fillText(lines[index], metrics.x, metrics.y + index * metrics.lineStep);
    }
  }

  function drawSpectrum(context, layout, scale) {
    if (!state.hudSpectrum) return;
    const rectangle = layout.frequency;
    drawGraphFrame(context, rectangle, "FR MAGNITUDE", layout.graphFontSize);
    context.strokeStyle = state.lineColor;
    context.lineWidth = Math.max(1, 1.2 * scale);
    context.shadowColor = state.lineColor;
    context.shadowBlur = 3 * scale;
    drawPolyline(
      context,
      state.lastSpectrum,
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height,
      (value) => value
    );
    context.shadowBlur = 0;
  }

  function drawWaveform(context, layout, scale) {
    if (!state.hudWaveform) return;
    const rectangle = layout.waveform;
    drawGraphFrame(context, rectangle, "WAVEFORM", layout.graphFontSize);
    context.strokeStyle = "rgba(245,245,245,0.82)";
    context.lineWidth = Math.max(0.8, scale);
    drawPolyline(
      context,
      state.waveformData,
      rectangle.x,
      rectangle.y,
      rectangle.width,
      rectangle.height,
      (value) => value / 255
    );
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
      context.moveTo(x, pad);
      context.lineTo(x, pad + tickSize);
      context.moveTo(x, height - pad);
      context.lineTo(x, height - pad - tickSize);
      context.moveTo(pad, y);
      context.lineTo(pad + tickSize, y);
      context.moveTo(width - pad, y);
      context.lineTo(width - pad - tickSize, y);
      context.stroke();
    }

    context.beginPath();
    context.moveTo(centerX - crosshairSize, centerY);
    context.lineTo(centerX + crosshairSize, centerY);
    context.moveTo(centerX, centerY - crosshairSize);
    context.lineTo(centerX, centerY + crosshairSize);
    context.stroke();
  }

  function drawHud(
    context,
    width,
    height,
    forceVisible = false,
    clearCanvas = true,
    includeLogo = true
  ) {
    if (clearCanvas) context.clearRect(0, 0, width, height);
    if (includeLogo) drawViewportLogo(context, width, height);
    if (!state.showHud && !forceVisible) return;

    const scale = Math.max(0.65, Math.min(2.5, Math.min(width / 1920, height / 1080)));
    const pad = Math.max(10, Math.min(width, height) * 0.018);
    const layout = getHudGraphLayout(width, height, pad);

    context.save();
    drawTechnicalFrame(context, width, height, scale, pad);
    drawMetadata(context, width, height);
    drawSpectrum(context, layout, scale);
    drawWaveform(context, layout, scale);
    drawLevels(context, layout);
    context.restore();
  }

  function renderPreview() {
    resizePreviewCanvas();
    updateViewportLogoLayout();
    const canvas = elements.hudCanvas;
    const context = canvas.getContext("2d");
    drawHud(context, canvas.width, canvas.height, false, true, false);
  }

  function updateDependentControls() {
    for (const row of document.querySelectorAll(".hud-dependent")) {
      row.classList.toggle("is-disabled", !state.showHud);
      const input = row.querySelector("input");
      if (input) input.disabled = !state.showHud;
    }
    elements.hudCanvas.classList.toggle("is-visible", state.showHud);
    elements.viewportLogo?.classList.remove("is-hidden");
    updateViewportLogoLayout();
  }

  App.hud = {
    resizePreviewCanvas,
    getHudFormatPreset,
    getHudGraphLayout,
    updateViewportLogoLayout,
    ensureLogoReady,
    drawViewportLogo,
    drawHud,
    renderPreview,
    updateDependentControls,
  };
})();
