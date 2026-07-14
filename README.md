# Real-Time 3D Spectrogram

Browser-based rewrite of the original Python/PyQtGraph visualizer using Three.js and the Web Audio API. The required Three.js module and OrbitControls files are included in `vendor/`, so the visualizer does not depend on a Three.js CDN at runtime.

## Run locally

Because the app uses JavaScript modules, serve the folder through a local web server instead of opening `index.html` directly.

### Python

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

### VS Code

Open the folder and use the **Live Server** extension on `index.html`.

## Features

- Real-time FFT analysis from a locally loaded audio file
- Rolling 3D spectrogram with adjustable history and frequency detail
- Logarithmic or linear frequency mapping
- Optional mirrored spectrum and beat pulse
- Playback, seeking, looping, and volume controls
- Audio-follow camera based on the live spectral centroid
- Mouse orbit, pan, zoom, fullscreen, drag-and-drop loading, and keyboard playback
- Responsive sidebar for desktop and mobile layouts
