(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { formatBytes, formatTime } = App.utils;

  let progressTimer = 0;

  function setLoadingProgress(value, stageText) {
    const progress = Math.max(0, Math.min(100, Math.round(value)));
    elements.audioLoadProgressBar.value = progress;
    elements.audioLoadProgressPercent.textContent = `${progress}%`;
    elements.audioLoadStage.textContent = stageText;
  }

  function beginLoadingUi() {
    state.isLoadingAudio = true;
    elements.fileInput.disabled = true;
    elements.fileDrop.classList.add("is-loading");
    elements.fileDrop.setAttribute("aria-disabled", "true");
    elements.fileButtonText.hidden = true;
    elements.fileButtonCopy.hidden = true;
    elements.audioLoadProgress.hidden = false;
    setLoadingProgress(8, "Preparing audio file.");

    window.clearInterval(progressTimer);
    progressTimer = window.setInterval(() => {
      const current = Number(elements.audioLoadProgressBar.value);
      if (current < 82) setLoadingProgress(current + Math.max(1, Math.round((82 - current) * 0.12)), "Loading audio data.");
    }, 140);
  }

  function finishLoadingUi(success) {
    window.clearInterval(progressTimer);
    progressTimer = 0;
    setLoadingProgress(success ? 100 : 0, success ? "Audio file ready." : "Audio loading failed.");

    window.setTimeout(() => {
      state.isLoadingAudio = false;
      elements.fileInput.disabled = false;
      elements.fileDrop.classList.remove("is-loading");
      elements.fileDrop.removeAttribute("aria-disabled");
      elements.fileButtonText.hidden = false;
      elements.fileButtonCopy.hidden = false;
      elements.audioLoadProgress.hidden = true;
    }, success ? 280 : 0);
  }

  function loadAudioFile(file) {
    const supportedExtension = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(file?.name || "");
    const supportedMime = Boolean(file?.type && file.type.startsWith("audio/"));

    if (!file || (!supportedMime && !supportedExtension)) {
      elements.liveStatus.textContent = "UNSUPPORTED FILE";
      elements.audioStatus.textContent = "ERROR";
      return;
    }

    beginLoadingUi();
    elements.audio.pause();
    state.isPlaying = false;
    state.hasAudio = false;
    App.playback.setTransportEnabled(false);
    App.playback.updatePlaybackUi();

    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);

    state.objectUrl = URL.createObjectURL(file);
    state.loadedFileName = file.name;
    state.loadedFileSize = file.size;
    elements.audio.preload = "auto";
    elements.audio.src = state.objectUrl;
    elements.audio.volume = state.volume;
    elements.audio.muted = state.muted;

    elements.audioStatus.textContent = "LOADING";
    elements.audioStatus.classList.remove("is-ready");
    elements.liveStatus.textContent = "LOADING AUDIO";
    elements.emptyState.classList.add("is-hidden");
    elements.trackName.textContent = file.name.replace(/\.[^.]+$/, "");
    elements.trackDetails.textContent = `${(file.name.split(".").pop() || "AUDIO").toUpperCase()} • ${formatBytes(file.size)}`;
    App.analysis.resetSpectrogramData();
    elements.audio.load();
  }

  function markAudioReady() {
    if (!elements.audio.src || state.hasAudio) return;
    state.hasAudio = true;
    state.isPlaying = !elements.audio.paused;
    App.playback.setTransportEnabled(true);
    App.playback.updatePlaybackUi();
    elements.duration.textContent = formatTime(elements.audio.duration);
    App.playback.updateSeekUi();
    finishLoadingUi(true);
  }

  function handleAudioError() {
    state.isPlaying = false;
    state.hasAudio = false;
    App.playback.setTransportEnabled(false);
    const errorCode = elements.audio.error?.code;
    elements.liveStatus.textContent = errorCode === 4 ? "FORMAT NOT SUPPORTED" : "DECODE ERROR";
    elements.audioStatus.textContent = "ERROR";
    elements.audioStatus.classList.remove("is-ready");
    elements.trackCard.classList.remove("is-playing");
    finishLoadingUi(false);
  }

  function clearDragUi() {
    state.dragDepth = 0;
    elements.dropOverlay.classList.remove("is-visible");
    elements.fileDrop.classList.remove("is-dragging");
  }

  App.loader = {
    loadAudioFile,
    markAudioReady,
    handleAudioError,
    clearDragUi,
  };
})();
