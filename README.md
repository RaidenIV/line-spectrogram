# 3D Spectrogram

A real-time, audio-reactive 3D spectrogram built with Three.js and the Web Audio API. Load a local audio file, inspect it as a scrolling 3D frequency surface, create a beat-aligned loop region, customize the visualization, enable an optional technical HUD, and export PNG images, video, or JSON settings.

## Features

- Real-time FFT analysis through the Web Audio API
- GPU-optimized, single-mesh Three.js spectrogram history
- Adjustable FFT size, frequency detail, height, history, smoothing, speed, line width, opacity, and color
- Logarithmic and mirrored frequency layouts
- Beat-reactive motion and optional audio-follow camera
- Orbit, pan, and zoom camera controls
- Responsive, landscape, square, and portrait viewport formats
- Optional technical HUD with metadata, frequency, waveform, peak, and RMS displays
- Local audio loading by file picker or drag and drop
- Play, pause, stop, seek, volume, and mute controls
- Waveform-based loop editor with:
  - Automatic BPM detection
  - Editable BPM
  - Beat snapping
  - Adjustable loop start and end handles
  - Bar-based loop length
  - Waveform zoom and minimap navigation
  - Independent loop preview playback and volume
- PNG export at selectable resolutions
- Browser-native video export with audio when supported
- JSON settings export
- Collapsible control sections and desktop/mobile sidebar controls

## Getting Started

1. Extract the project folder.
2. Open `index.html` in a modern Chromium, Firefox, or Safari browser.
3. Select **Load audio file** or drag an audio file onto the application.
4. Press **Play** after the file reaches the `READY` state.

The project uses local Three.js vendor files and classic browser scripts, so it can be opened directly without a build step or package installation.

For the most consistent browser behavior, especially video export, serve the folder through a local HTTP server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Supported Audio Files

The loader accepts common browser audio formats, including:

- WAV
- MP3
- M4A
- AAC
- FLAC
- OGG
- OPUS

Actual codec support depends on the browser and operating system. The main audio player may support a format that the Web Audio decoder cannot analyze. In that case, playback can still work, but the waveform loop editor will remain unavailable for that file.

## Audio Loading Pipeline

The application uses a staged loading process:

1. Reads the selected local file with `FileReader`.
2. Decodes a copy with the Web Audio API for waveform and loop analysis.
3. Creates a local object URL for media-element playback.
4. Waits for valid media metadata and duration.
5. Enables playback controls.
6. Enables the loop editor when decoded audio is available.

Each load receives a unique token so stale events from an older selection cannot overwrite the newest audio state or leave the upload interface locked.

## Loop Editor

After a compatible file loads, select the circular-arrow button in the transport controls.

The loop editor provides:

- A detailed waveform view
- Draggable start and end handles
- Dragging of the selected region
- Mouse-wheel waveform zoom
- Zoom in, zoom out, and fit controls
- A complete-track minimap
- Automatic BPM detection from up to the first 90 seconds
- Manual BPM editing from 40–300 BPM
- Beat-grid display and optional beat snapping
- Loop length measured in bars
- Independent preview play, pause, stop, loop, mute, and volume controls
- **Apply Loop**, **Clear Loop**, and **Cancel** actions

When an active partial loop reaches its end, the media playhead is returned to the selected start point and the live spectrogram history is reset so the visualization remains synchronized with the loop.

## Visualization Controls

### Spectrogram

- Height
- History
- Frequency Detail
- Smoothing
- Scroll Speed
- Line Width
- Line Opacity
- FFT Size
- Line Color
- Log Frequency
- Mirror Frequency
- Beat Pulse

### Camera

- Camera Distance
- Camera Height
- Follow Strength
- Audio-follow Camera
- Reference Grid

### Viewport and HUD

- Viewport Format
- Display FPS
- Technical HUD Overlay
- Frequency Graph
- Waveform Graph
- Peak and RMS Graph
- Technical Frame

## Exporting

### PNG

PNG export renders the current Three.js scene into a separate offscreen renderer at the selected resolution. The optional HUD is composited into the same output.

### Video

Video export uses the browser's `MediaRecorder` and canvas capture support. Available formats vary by browser. The export interface automatically disables unsupported format options.

The video exporter:

- Starts from the beginning of the track
- Captures the visualization and optional HUD
- Includes audio when the browser provides a compatible stream track
- Displays export progress
- Supports cancellation
- Restores the previous playback time and loop state when complete

### JSON

JSON export saves the current visualization, camera, viewport, HUD, playback, loop, and export settings.

## Project Structure

```text
3D-Spectrogram/
├── index.html
├── style.css
├── README.md
├── assets/
│   ├── css/
│   │   └── loop-editor.css
│   └── js/
│       ├── config.js
│       ├── core.js
│       ├── utils.js
│       ├── analysis.js
│       ├── playback.js
│       ├── loop.js
│       ├── loader.js
│       ├── renderer.js
│       ├── hud.js
│       ├── controls.js
│       ├── export.js
│       └── app.js
└── vendor/
    ├── three.global.js
    └── controls/
        └── OrbitControls.global.js
```

### JavaScript Responsibilities

- `config.js` — defaults, control definitions, and constants
- `core.js` — shared state, DOM references, Three.js scene, renderer, camera, and controls
- `utils.js` — formatting, math, downloads, and shared helpers
- `analysis.js` — FFT sampling and optimized spectrogram geometry
- `playback.js` — Web Audio graph, transport, seeking, volume, mute, and audio decoding
- `loop.js` — waveform peaks, BPM detection, loop editing, preview, and loop enforcement
- `loader.js` — file reading, decoding, metadata validation, progress, and load errors
- `renderer.js` — viewport fitting, camera projection, and scene rendering
- `hud.js` — technical HUD drawing and HUD state
- `controls.js` — sidebar controls, collapsible sections, resets, and responsive sidebar behavior
- `export.js` — PNG, video, and JSON exports
- `app.js` — application initialization, event registration, and animation-loop composition

## Keyboard and Mouse Controls

- **Left drag** — orbit camera
- **Right drag** — pan camera
- **Mouse wheel** — zoom camera
- **Spacebar** — play or pause the main audio
- **Escape** — close the mobile sidebar or cancel an active video export

While the loop editor is open:

- **Spacebar** — play or pause loop preview
- **Escape** — close the loop editor
- **Mouse wheel over waveform** — zoom waveform

## Troubleshooting

### An audio file does not reach READY

- Confirm the file extension and codec are supported by the browser.
- Try WAV or MP3 to separate a codec issue from an application issue.
- Open the browser console and check for a media decode error.
- Serve the project through a local HTTP server if browser security settings restrict direct local-file behavior.

### Audio plays but the loop button remains disabled

The media codec is playable, but the browser's Web Audio decoder could not create an `AudioBuffer`. Use WAV or MP3 for full waveform and loop-editor support.

### Video export is unavailable

Video export depends on `MediaRecorder`, canvas capture, and browser codec support. Chromium-based browsers generally provide the broadest support. Select a WebM format when MP4 is unavailable.

### The visualization is blank

- Confirm the audio is playing.
- Reset the spectrogram controls.
- Reset the camera.
- Confirm WebGL hardware acceleration is enabled in the browser.

## Browser Notes

- Chromium-based browsers provide the broadest video-export compatibility.
- Firefox supports the core visualizer and WebM export, subject to codec availability.
- Safari supports the core visualizer, but media formats and recording capabilities vary by macOS/iOS version.

## Privacy

Audio files are processed locally in the browser. The application does not upload the selected file to a server.
