(function () {
  "use strict";

  const App = window.SpectrogramApp;
  const { elements, state } = App.core;
  const { formatTime, setRangeFill } = App.utils;

  function updatePlaybackUi() {
    elements.playIcon.classList.toggle("is-pause", state.isPlaying);
    elements.playButton.setAttribute("aria-label", state.isPlaying ? "Pause" : "Play");
    elements.trackCard.classList.toggle("is-playing", state.isPlaying);
    elements.liveDot.classList.toggle("is-live", state.isPlaying);

    if (state.exportActive) {
      elements.liveStatus.textContent = "EXPORTING VIDEO";
    } else {
      elements.liveStatus.textContent = state.isPlaying ? "ANALYZING LIVE" : state.hasAudio ? "PAUSED" : "READY";
    }

    elements.audioStatus.textContent = state.isPlaying ? "LIVE" : state.hasAudio ? "READY" : "NO FILE";
    elements.audioStatus.classList.toggle("is-ready", state.hasAudio);
  }

  function setTransportEnabled(enabled) {
    elements.playButton.disabled = !enabled;
    elements.stopButton.disabled = !enabled;
    elements.loopButton.disabled = !enabled;
    elements.seek.disabled = !enabled;
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

  async function togglePlayback() {
    if (!state.hasAudio || state.exportActive) return;

    try {
      await ensureAudioContextRunning();
      if (elements.audio.paused) await elements.audio.play();
      else elements.audio.pause();
    } catch (error) {
      console.error(error);
      elements.liveStatus.textContent = "PLAYBACK ERROR";
    }
  }

  function stopPlayback() {
    if (state.exportActive) return;
    elements.audio.pause();
    elements.audio.currentTime = 0;
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
    elements.audio.loop = Boolean(enabled);
    elements.loopButton.setAttribute("aria-pressed", String(elements.audio.loop));
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
