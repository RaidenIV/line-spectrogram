(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { formatBytes, formatTime } = App.utils;

  let progressTimer = 0;
  let readyFallbackTimer = 0;

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
    setLoadingProgress(4, "Preparing audio file.");

    window.clearInterval(progressTimer);
    progressTimer = window.setInterval(() => {
      const current = Number(elements.audioLoadProgressBar.value);
      if (current < 88) {
        setLoadingProgress(
          current + Math.max(1, Math.round((88 - current) * 0.08)),
          elements.audioLoadStage.textContent || "Loading audio data."
        );
      }
    }, 180);
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
    }, success ? 260 : 0);
  }

  function readFileAsArrayBuffer(file, token) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("progress", (event) => {
        if (token !== state.audioLoadToken || !event.lengthComputable) return;
        const ratio = event.total > 0 ? event.loaded / event.total : 0;
        setLoadingProgress(8 + ratio * 47, "Reading audio file.");
      });
      reader.addEventListener("load", () => resolve(reader.result));
      reader.addEventListener("error", () => reject(reader.error || new Error("The selected file could not be read.")));
      reader.addEventListener("abort", () => reject(new DOMException("Audio loading was cancelled.", "AbortError")));
      reader.readAsArrayBuffer(file);
    });
  }

  function waitForMediaMetadata(token) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        elements.audio.removeEventListener("loadedmetadata", onReady);
        elements.audio.removeEventListener("durationchange", onReady);
        elements.audio.removeEventListener("canplay", onReady);
        elements.audio.removeEventListener("error", onError);
        window.clearTimeout(readyFallbackTimer);
      };
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onReady = () => {
        if (token !== state.audioLoadToken) return;
        const duration = Number(elements.audio.duration);
        if (elements.audio.readyState >= (elements.audio.HAVE_METADATA || 1) && Number.isFinite(duration) && duration > 0) {
          finish(resolve);
        }
      };
      const onError = () => {
        const mediaError = elements.audio.error;
        const message = mediaError?.code === 4
          ? "This browser does not support the selected audio format."
          : "The browser could not load the selected audio file.";
        finish(reject, new Error(message));
      };

      elements.audio.addEventListener("loadedmetadata", onReady);
      elements.audio.addEventListener("durationchange", onReady);
      elements.audio.addEventListener("canplay", onReady);
      elements.audio.addEventListener("error", onError);
      readyFallbackTimer = window.setTimeout(() => {
        onReady();
        if (!settled) finish(reject, new Error("Audio metadata did not become available."));
      }, 15000);
      onReady();
    });
  }

  function prepareMediaElement(file) {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);

    elements.audio.pause();
    elements.audio.removeAttribute("src");
    elements.audio.load();
    elements.audio.preload = "auto";
    elements.audio.src = state.objectUrl;
    elements.audio.volume = state.volume;
    elements.audio.muted = state.muted;
  }

  async function loadAudioFile(file) {
    const supportedExtension = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i.test(file?.name || "");
    const supportedMime = Boolean(file?.type && file.type.startsWith("audio/"));

    if (!file || (!supportedMime && !supportedExtension)) {
      elements.audioStatus.textContent = "ERROR";
      return;
    }

    const token = ++state.audioLoadToken;
    beginLoadingUi();
    elements.audio.pause();
    state.isPlaying = false;
    state.hasAudio = false;
    App.playback.setTransportEnabled(false);
    App.playback.updatePlaybackUi();
    App.loop.resetLoopState();

    elements.audioStatus.textContent = "LOADING";
    elements.audioStatus.classList.remove("is-ready");
    elements.emptyState.classList.add("is-hidden");
    elements.trackName.textContent = file.name.replace(/\.[^.]+$/, "");
    elements.trackDetails.textContent = `${(file.name.split(".").pop() || "AUDIO").toUpperCase()} • ${formatBytes(file.size)}`;
    App.analysis.resetSpectrogramData();

    try {
      const arrayBuffer = await readFileAsArrayBuffer(file, token);
      if (token !== state.audioLoadToken) return;

      let decodedBuffer = null;
      setLoadingProgress(58, "Decoding audio for waveform and loop analysis.");
      try {
        decodedBuffer = await App.playback.decodeAudioData(arrayBuffer);
      } catch (decodeError) {
        // MediaElement playback supports some codecs that decodeAudioData may
        // reject. The file is still allowed to load; only the loop editor is
        // disabled for that codec.
        console.warn("Audio decoded playback analysis is unavailable for this file.", decodeError);
      }
      if (token !== state.audioLoadToken) return;

      setLoadingProgress(82, "Loading audio metadata.");
      prepareMediaElement(file);
      elements.audio.load();
      await waitForMediaMetadata(token);
      if (token !== state.audioLoadToken) return;

      state.loadedFileName = file.name;
      state.loadedFileSize = file.size;
      state.decodedAudioBuffer = decodedBuffer;
      if (decodedBuffer) App.loop.initializeLoopSelection(decodedBuffer);
      else App.loop.syncLoopButton();

      markAudioReady();
    } catch (error) {
      if (token !== state.audioLoadToken || error?.name === "AbortError") return;
      console.error(error);
      handleAudioError(error);
    }
  }

  function markAudioReady() {
    const duration = Number(elements.audio.duration);
    if (!elements.audio.src || !Number.isFinite(duration) || duration <= 0) return;

    state.hasAudio = true;
    state.isPlaying = !elements.audio.paused;
    App.playback.setTransportEnabled(true);
    App.playback.updatePlaybackUi();
    elements.duration.textContent = formatTime(duration);
    App.playback.updateSeekUi();
    elements.audioStatus.textContent = "READY";
    elements.audioStatus.classList.add("is-ready");
    finishLoadingUi(true);
  }

  function handleAudioError(error) {
    state.isPlaying = false;
    state.hasAudio = false;
    App.playback.setTransportEnabled(false);
    App.loop.resetLoopState();
    const errorCode = elements.audio.error?.code;
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
