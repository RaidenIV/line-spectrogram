(function () {
  "use strict";

  const App = window.SpectrogramApp;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function setRangeFill(input) {
    const minimum = Number(input.min || 0);
    const maximum = Number(input.max || 100);
    const value = Number(input.value);
    const percentage = maximum === minimum ? 0 : ((value - minimum) / (maximum - minimum)) * 100;
    input.style.setProperty("--range-fill", `${clamp(percentage, 0, 100)}%`);
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const total = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(total / 60);
    const remaining = total % 60;
    return `${minutes}:${String(remaining).padStart(2, "0")}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function sanitizeFileName(value, fallback = "waterfall-spectrogram") {
    const normalized = String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80);
    return normalized || fallback;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function parseResolution(value, viewportFormat = "landscape") {
    const normalized = String(value || "").trim().toLowerCase();
    const match = /^(\d+)x(\d+)$/.exec(normalized);

    if (match) {
      return { width: Number(match[1]), height: Number(match[2]) };
    }

    let width = 1920;
    let height = 1080;
    let squareSize = 1080;

    if (normalized === "2k") {
      width = 2560;
      height = 1440;
      squareSize = 1440;
    } else if (normalized === "4k") {
      width = 3840;
      height = 2160;
      squareSize = 2160;
    }

    if (viewportFormat === "square") {
      return { width: squareSize, height: squareSize };
    }

    if (viewportFormat === "portrait") {
      return { width: height, height: width };
    }

    return { width, height };
  }

  function dateStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  }

  function setStatus(element, text, isError = false) {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("is-error", Boolean(isError));
  }

  App.utils = {
    clamp,
    setRangeFill,
    formatTime,
    formatBytes,
    sanitizeFileName,
    downloadBlob,
    parseResolution,
    dateStamp,
    setStatus,
  };
})();
