# Real-Time 3D Spectrogram

Browser-based rewrite of the original Python/PyQtGraph visualizer using Three.js and the Web Audio API. Three.js and OrbitControls are included locally in `vendor/`, so the visualizer does not require a Three.js CDN at runtime.

## Run locally

Extract the project and open `index.html` directly in a modern browser. The production scripts are bundled as classic browser scripts, so a local web server is not required.

You can also host the folder on GitHub Pages, Railway, Netlify, or any static web server without changing the project files.

## Load audio

1. Click **Load audio file** or drag an audio file onto the page.
2. Wait for the source status to change from **LOADING** to **READY**.
3. Press the play button or the Spacebar to begin playback and real-time analysis.

Supported file types depend on the browser's built-in audio decoders. WAV, MP3, M4A/AAC, OGG, OPUS, and FLAC are accepted by the interface.

## Features

- Real-time FFT analysis from a locally loaded audio file
- Rolling 3D spectrogram with adjustable history and frequency detail
- Logarithmic or linear frequency mapping
- Optional mirrored spectrum and beat pulse
- Playback, seeking, looping, and volume controls
- Audio-follow camera based on the live spectral centroid
- Mouse orbit, pan, zoom, fullscreen, drag-and-drop loading, and keyboard playback
- Responsive sidebar for desktop and mobile layouts
