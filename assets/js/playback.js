(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { formatTime, setRangeFill } = App.utils;

  function updatePlaybackUi() {
    elements.playIcon.classList.toggle("is-pause", state.isPlaying);
    elements.playButton.setAttribute("aria-label", state.isPlaying ? "Pause" : "Play");
    elements.trackCard.classList.toggle("is-playing", state.isPlaying);

    elements.audioStatus.textContent = state.isPlaying ? "LIVE" : state.hasAudio ? "READY" : "NO FILE";
    elements.audioStatus.classList.toggle("is-ready", state.hasAudio);
  }

  function setTransportEnabled(enabled) {
    elements.playButton.disabled = !enabled;
    elements.stopButton.disabled = !enabled;
    elements.seek.disabled = !enabled;
    App.loop?.syncLoopButton();
  }

  function initializeAudioGraph() {
    if (state.audioContext) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser does not support the Web Audio API.");

    state.audioContext = new AudioContextClass();
    state.analyser = state.audioContext.createAnalyser();
    state.analyser.fftSize = state.fftSize;
    state.analyser.minDecibels = -92;
    state.analyser.maxDecibels = -8;
    state.analyser.smoothingTimeConstant = state.smoothing;

    state.mediaSource = state.audioContext.createMediaElementSource(elements.audio);
    state.exportAudioDestination = state.audioContext.createMediaStreamDestination();
    state.mediaSource.connect(state.analyser);
    state.analyser.connect(state.audioContext.destination);
    state.analyser.connect(state.exportAudioDestination);

    state.frequencyData = new Uint8Array(state.analyser.frequencyBinCount);
    state.waveformData = new Uint8Array(state.analyser.fftSize);
    state.waveformData.fill(128);
    state.spectrumMapKey = "";
    elements.fftReadout.textContent = String(state.analyser.fftSize);
  }

  async function ensureAudioContextRunning() {
    initializeAudioGraph();
    if (state.audioContext.state === "suspended") await state.audioContext.resume();
  }

  async function decodeAudioData(arrayBuffer) {
    initializeAudioGraph();
    const source = arrayBuffer.slice(0);

    // Safari still supports the callback form while modern browsers return a
    // Promise. This wrapper handles both without decoding the same file twice.
    return new Promise((resolve, reject) => {
      let settled = false;
      const complete = (buffer) => {
        if (settled) return;
        settled = true;
        resolve(buffer);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error("The audio file could not be decoded."));
      };

      try {
        const result = state.audioContext.decodeAudioData(source, complete, fail);
        if (result && typeof result.then === "function") result.then(complete, fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  async function togglePlayback() {
    if (!state.hasAudio || state.exportActive) return;

    try {
      await ensureAudioContextRunning();
      if (elements.audio.paused) {
        if (state.audioLoop && App.loop?.hasPartialLoopSelection()) {
          const range = App.loop.getSelectedLoopRange();
          if (elements.audio.currentTime < range.start || elements.audio.currentTime >= range.end) {
            elements.audio.currentTime = range.start;
          }
        }
        await elements.audio.play();
      } else {
        elements.audio.pause();
      }
    } catch (error) {
      console.error(error);
      elements.audioStatus.textContent = "ERROR";
      elements.audioStatus.classList.remove("is-ready");
      App.diagnostics?.showError(
        "PLAYBACK COULD NOT START",
        error?.message || "The browser blocked or failed to start audio playback.",
        ["Click the Play button again to satisfy the browser gesture requirement.", "Confirm that the selected file is supported by this browser.", "Reload the page if the AudioContext is no longer responsive."]
      );
    }
  }

  function stopPlayback() {
    if (state.exportActive) return;
    elements.audio.pause();
    const resetTime = state.audioLoop && App.loop?.hasPartialLoopSelection()
      ? App.loop.getSelectedLoopRange().start
      : 0;
    elements.audio.currentTime = resetTime;
    App.analysis.resetSpectrogramData();
    updateSeekUi();
  }

  function updateSeekUi() {
    if (state.isSeeking) return;
    const duration = elements.audio.duration;
    const ratio = Number.isFinite(duration) && duration > 0 ? elements.audio.currentTime / duration : 0;
    elements.seek.value = String(Math.round(ratio * 1000));
    elements.currentTime.textContent = formatTime(elements.audio.currentTime);
    setRangeFill(elements.seek);
  }

  function previewSeek() {
    const duration = elements.audio.duration;
    if (!Number.isFinite(duration)) return;
    const previewTime = (Number(elements.seek.value) / 1000) * duration;
    elements.currentTime.textContent = formatTime(previewTime);
    setRangeFill(elements.seek);
  }

  function commitSeek() {
    const duration = elements.audio.duration;
    if (Number.isFinite(duration)) elements.audio.currentTime = (Number(elements.seek.value) / 1000) * duration;
    state.isSeeking = false;
  }

  function setVolume(value) {
    const next = Math.max(0, Math.min(1, Number(value)));
    state.volume = next;
    elements.audio.volume = next;
    elements.volume.value = String(next);
    elements.volumeValue.textContent = `${Math.round(next * 100)}%`;
    setRangeFill(elements.volume);
  }

  function setMuted(muted) {
    state.muted = Boolean(muted);
    elements.audio.muted = state.muted;
    elements.muteToggle.checked = state.muted;
  }

  function setLoop(enabled) {
    state.audioLoop = Boolean(enabled);
    App.loop?.updateAudioLoopMode();
    App.loop?.syncLoopButton();
  }

  function handlePlay() {
    state.isPlaying = true;
    state.nextAnalysisTime = performance.now();
    updatePlaybackUi();
  }

  function handlePause() {
    state.isPlaying = false;
    updatePlaybackUi();
  }

  App.playback = {
    updatePlaybackUi,
    setTransportEnabled,
    initializeAudioGraph,
    ensureAudioContextRunning,
    decodeAudioData,
    togglePlayback,
    stopPlayback,
    updateSeekUi,
    previewSeek,
    commitSeek,
    setVolume,
    setMuted,
    setLoop,
    handlePlay,
    handlePause,
  };
})();
