(function () {
  "use strict";

  const App = window.SpectrogramApp;

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  function setRangeFill(input) {
    if (!input) return;
    const minimum = Number(input.min || 0);
    const maximum = Number(input.max || 100);
    const value = Number(input.value);
    const percentage = maximum === minimum ? 0 : ((value - minimum) / (maximum - minimum)) * 100;
    input.style.setProperty("--range-fill", `${clamp(percentage, 0, 100)}%`);
  }

  function formatTime(seconds, includeHours = false) {
    if (!Number.isFinite(seconds)) return includeHours ? "0:00:00" : "0:00";
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remaining = total % 60;
    if (includeHours || hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
    return `${minutes}:${String(remaining).padStart(2, "0")}`;
  }

  function formatDurationPrecise(seconds) {
    if (!Number.isFinite(seconds)) return "0:00.00";
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    const remainder = Math.max(0, seconds) - minutes * 60;
    return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
  }

  function parseTimeValue(value, fallback = 0) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    if (!text.includes(":")) {
      const number = Number(text);
      return Number.isFinite(number) ? Math.max(0, number) : fallback;
    }
    const parts = text.split(":").map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return fallback;
    if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
    if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    return fallback;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
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
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function parseResolution(value, viewportFormat = "landscape") {
    const normalized = String(value || "").trim().toLowerCase();
    const match = /^(\d+)x(\d+)$/.exec(normalized);

    if (match) return { width: Number(match[1]), height: Number(match[2]) };

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

    if (viewportFormat === "square") return { width: squareSize, height: squareSize };
    if (viewportFormat === "portrait") return { width: height, height: width };
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

  function estimateFileSizeBytes(durationSeconds, videoBitrateMbps, audioBitrateKbps = 192) {
    const totalBitsPerSecond = Math.max(0, Number(videoBitrateMbps)) * 1_000_000 + Math.max(0, Number(audioBitrateKbps)) * 1000;
    return Math.max(0, durationSeconds) * totalBitsPerSecond / 8;
  }

  function nextAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function deepClone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  App.utils = {
    clamp,
    lerp,
    setRangeFill,
    formatTime,
    formatDurationPrecise,
    parseTimeValue,
    formatBytes,
    sanitizeFileName,
    downloadBlob,
    parseResolution,
    dateStamp,
    setStatus,
    estimateFileSizeBytes,
    nextAnimationFrame,
    sleep,
    deepClone,
  };
})();
