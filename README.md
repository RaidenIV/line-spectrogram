# Waterfall Spectrogram

Waterfall Spectrogram is a browser-based, real-time Three.js audio visualizer for loading local audio, exploring a scrolling 3D frequency history, building beat-aligned loops, composing technical HUD overlays, and exporting still images, videos, and reusable settings.

Audio is processed locally in the browser. No audio file is uploaded by the application.

## Highlights

- Real-time Web Audio FFT analysis
- GPU-optimized Three.js waterfall renderer
- Fixed, track-normalized, and adaptive amplitude modes
- Single-color, frequency-band, amplitude, and age/depth color modes
- Lines, ribbons, points, wire-surface, and solid-surface render modes
- Adjustable history spacing, depth, curve, fading, brightness, fog, and height decay
- Optional transient highlighting with sensitivity, intensity, and decay controls
- Camera presets, audio-follow sources, motion paths, and timeline keyframes
- Technical HUD with metadata, frequency, waveform, peak, RMS, and frequency labels
- HUD scale, opacity, and format-aware placement controls
- Optional 90%, title-safe, and social-video safe-area guides
- Waveform loop editor with BPM detection, beat snapping, bar length, zoom, minimap, and preview transport
- Performance quality presets, including adaptive Auto mode
- PNG export, real-time video export, and deterministic high-quality offline MP4 export
- Full-track, active-loop, and custom export ranges
- YouTube, Instagram Reel, TikTok, and square-post output presets
- Export duration, file-size, render-time, frame-count, and ETA estimates
- JSON settings import and export
- Undo, redo, section resets, and full reset
- Browser capability diagnostics and WebGL context recovery
- Context-specific error dialogs with recommended recovery steps

## Getting Started

1. Extract the complete project folder.
2. Open `index.html` in a current desktop browser.
3. Select **Load audio file**, or drag an audio file anywhere over the application.
4. Wait for the Audio Source status to reach **READY**.
5. Press **Play** or use the Spacebar.

The application uses local Three.js vendor files and classic browser scripts, so it does not require npm, a build system, or a framework.

For the most consistent export behavior, serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Audio Loading

The loader accepts common browser audio formats, including:

- WAV
- MP3
- M4A
- AAC
- FLAC
- OGG
- OPUS

Actual codec support depends on the browser, operating system, and installed media components.

The staged loader:

1. Reads the selected file with `FileReader`.
2. Decodes a copy through Web Audio for waveform, loop, track-normalization, and offline-export analysis.
3. Creates a local object URL for media playback.
4. Validates media metadata and duration.
5. Enables the transport controls.
6. Enables the Loop Editor when decoded analysis data is available.

Every load receives a unique token so late events from an older selection cannot overwrite the current track state.

### Track information

After loading, the Audio Source section displays:

- Format
- File size
- Duration
- Sample rate
- Channel configuration

A file may be playable by the media element even when the browser cannot decode it into an `AudioBuffer`. In that case, real-time playback and visualization remain available, while loop analysis and deterministic offline export are disabled.

## Visualization Controls

### Core spectrogram

- **Height** — vertical amplitude scale
- **History** — number of retained time rows
- **Frequency Detail** — number of visible frequency samples
- **FFT Size** — Web Audio FFT resolution
- **Smoothing** — live analyzer smoothing
- **Scroll Speed** — history update rate
- **Line Width** — rendered line/ribbon thickness
- **Line Opacity** — base material opacity
- **Line Color** — base visualization color
- **Log Frequency** — logarithmic frequency distribution
- **Mirror Frequency** — mirrored spectrum layout
- **Beat Pulse** — optional whole-visualizer beat response

### Amplitude modes

- **Fixed** — uses the selected Input Gain directly
- **Track Normalized** — scales against the decoded track peak
- **Adaptive** — slowly follows the current signal level to keep quiet and loud material visually expressive

Additional amplitude controls:

- **Input Gain**
- **Noise Floor**
- **Dynamic Range**

### Color modes

- **Single Color** — uses the selected line color
- **Frequency Bands** — maps low, mid, and high frequencies across a multiband palette
- **Amplitude** — increases brightness with amplitude
- **Age / Depth** — changes color as rows move into history

### Render modes

- **Lines**
- **Ribbons**
- **Points**
- **Wire Surface**
- **Solid Surface**

### History geometry and depth

- **Row Spacing**
- **History Depth**
- **Depth Curve**
- **Depth Opacity**
- **Depth Brightness**
- **Depth Height Decay**
- **Depth Fog**

These controls can keep recent rows prominent while compressing, dimming, fading, flattening, or fogging older rows toward the horizon.

### Transient highlighting

Enable **Transient Highlight** to emphasize sudden attacks. Adjust:

- Sensitivity
- Intensity
- Decay

Transient response can increase newest-row height, thickness, and brightness without requiring Beat Pulse.

## Camera

### Camera presets

- Front
- Elevated
- Low Horizon
- Isometric
- Side
- Top
- Cinematic

### Camera motion

- Static
- Slow Orbit
- Forward Drift
- Side Sweep
- Audio Follow
- Keyframes

### Audio-follow sources

- Overall Energy
- Spectral Centroid
- Bass Energy
- Peak Frequency

### Camera keyframes

1. Seek the track to the desired time.
2. Move the camera to the desired view.
3. Select **Add Keyframe**.
4. Repeat at additional times.
5. Set Camera Motion to **Keyframes**.

The camera interpolates between saved positions and targets during playback and deterministic offline export.

## Loop Editor

After a compatible file has been decoded, select **Open Loop Editor**.

The Loop Editor includes:

- Detailed waveform rendering
- Draggable start and end handles
- Draggable complete loop region
- Automatic BPM detection
- Manual BPM editing from 40–300 BPM
- Loop length in bars
- Beat-grid display
- Optional beat snapping
- Zoom in, zoom out, mouse-wheel zoom, and fit controls
- Complete-track minimap navigation
- Independent preview play, pause, stop, loop, volume, and mute controls
- Apply Loop, Clear Loop, Cancel, and close actions

When an active partial loop reaches its end, playback returns to the selected start point and the waterfall history resets so the visualization stays synchronized with the repeated region.

## Viewport, HUD, and Safe Areas

### Viewport formats

- Responsive
- Landscape — 16:9
- Square — 1:1
- Portrait — 9:16

The Three.js camera preserves the baseline landscape horizontal composition when the viewport becomes square or portrait.

### Technical HUD

The HUD can display:

- Track metadata
- Playback time
- Viewport format
- FFT and frequency-bin information
- Energy and peak values
- Frequency graph
- Waveform graph
- Peak and RMS level graph
- Technical frame, ticks, and crosshair
- Logarithmic frequency labels from 20 Hz to 20 kHz

HUD controls include:

- Master HUD visibility
- Individual graph visibility
- Frequency-label visibility
- HUD opacity
- HUD scale

### Safe-area guides

Preview-only safe-area options:

- Off
- 90% Frame
- Title Safe
- Social Video

Safe-area guides are editing aids and are not burned into PNG or video exports. Enable **Constrain HUD to Safe Area** to move HUD composition inside the selected guide.

## Performance Quality

Quality presets:

- **Auto** — adjusts render pixel ratio according to measured frame rate
- **Performance** — reduced geometry and render scale
- **Balanced** — default quality/performance balance
- **High** — increased history and frequency detail
- **Maximum** — maximum built-in geometry and HUD update rate

Use **Display FPS** to show the live frame rate. The application also tracks renderer draw calls and triangle counts in the Browser Capabilities panel.

## Settings, Undo, and Reset

### JSON settings

**Export JSON** saves persistent visualization, camera, HUD, loop, viewport, quality, and export settings.

**Import JSON** validates the selected file, rejects incompatible application or future settings versions, ignores unknown properties, clamps numeric values to available control ranges, and restores the application in one synchronized update.

Runtime-only audio buffers, WebGL objects, and export resources are never serialized.

### Undo and redo

- `Ctrl+Z` — Undo
- `Ctrl+Shift+Z` — Redo

Undo history covers sidebar settings, camera moves, presets, resets, and export configuration. Rapid slider movement is grouped into a single history entry.

### Reset hierarchy

- Spectrogram **Reset**
- Camera **Reset**
- Viewport & HUD **Reset**
- Export **Reset**
- **Reset All** with confirmation

## Exporting

### Output presets

- YouTube 4K
- YouTube 1080p
- Instagram Reel
- TikTok
- Square Post
- Custom

Output presets synchronize viewport format, resolution, frame rate, bitrate, HUD scale, and safe-area preview settings.

### Export ranges

- **Full Track**
- **Active Loop**
- **Custom Range**

Custom ranges use start and end positions in seconds. The export estimate updates when the range, resolution, frame rate, bitrate, output preset, or export mode changes.

### Export estimates

Before video export, the interface displays:

- Selected duration
- Estimated file size from duration and bitrate
- Estimated real-time or offline render duration

Estimates are approximate and depend on browser encoding performance, hardware acceleration, and scene complexity.

### PNG export

PNG export uses a separate high-resolution Three.js renderer at the selected output size. The current visualization, camera, logo, and enabled HUD are composited into one image. Safe-area guides remain preview-only.

### Real-Time video export

Real-Time export uses `MediaRecorder`, canvas capture, and the selected browser-supported container. It:

- Plays the selected export range in real time
- Captures the visualization, logo, and enabled HUD
- Includes audio when the browser exposes a compatible audio track
- Displays percentage, elapsed time, frame estimate, and ETA
- Supports cancellation
- Restores the previous playhead, playback state, and loop state afterward

### High Quality Offline export

High Quality Offline export is deterministic and frame-stepped. It:

- Requires decoded audio
- Uses the selected range and exact frame interval
- Samples decoded audio at each output frame
- Advances visualization and camera motion deterministically
- Renders every frame through a dedicated export renderer
- Encodes H.264 video and AAC audio through WebCodecs
- Muxes the result into MP4
- Can take longer than the track duration without dropping frames

Offline export currently requires a current Chromium-based browser, MP4 output, WebCodecs support, and internet access to load the small `mp4-muxer` module used by the export pipeline.

## Export Progress

During export, the interface reports:

- Progress percentage
- Exported time versus selected duration
- Current frame versus estimated total frames
- Estimated time remaining

The Export Video button changes to a cancel action while an export is active. `Escape` also cancels an active export.

## Browser Capabilities

Use the **i** button in the sidebar header to view:

- WebGL 2 or WebGL 1 fallback status
- Web Audio availability
- Real-Time video export support
- Offline WebCodecs availability
- MP4 support
- MKV/WebM support
- Maximum texture size
- Maximum renderbuffer size
- Reported hardware renderer
- Current WebGL context status

## WebGL Context Recovery

The application listens for `webglcontextlost` and `webglcontextrestored`.

If the GPU context is lost:

1. Rendering is paused.
2. A recovery overlay appears.
3. The application waits for the browser to restore the context.
4. Spectrogram geometry, materials, renderer sizing, colors, and HUD state are rebuilt.

Use **Rebuild Renderer** from the recovery overlay when a manual retry is needed. Reload the page if the browser or GPU driver cannot restore the context.

## Error Reporting

Audio, playback, settings import, fullscreen, PNG export, and video export failures use contextual dialogs that explain the failure and provide targeted recovery steps. Examples include:

- Unsupported or malformed audio file
- Playback available but waveform analysis unavailable
- Unsupported codec at the selected export settings
- Offline export unavailable in the current browser
- Invalid JSON settings file
- GPU or render-surface failure

## Keyboard and Mouse Controls

### Viewport

- Left drag — Orbit camera
- Right drag — Pan camera
- Mouse wheel — Zoom camera

### Application shortcuts

- `Space` — Play / Pause
- `F` — Fullscreen
- `R` — Reset View
- `L` — Open Loop Editor
- `G` — Toggle Reference Grid
- `H` — Toggle HUD
- `M` — Mute
- `Ctrl+E` — Export Video
- `Ctrl+P` — Export PNG
- `Ctrl+Z` — Undo
- `Ctrl+Shift+Z` — Redo
- `?` — Open keyboard-shortcut reference
- `Escape` — Close modal/sidebar or cancel active video export

While the Loop Editor is open:

- `Space` — Play or pause loop preview
- `Escape` — Close the Loop Editor
- Mouse wheel over waveform — Zoom waveform

## Project Structure

```text
waterfall-spectrogram/
├── index.html
├── style.css
├── README.md
├── assets/
│   ├── css/
│   │   └── loop-editor.css
│   ├── images/
│   │   └── spectrogramic-logo.svg
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
│       ├── state-manager.js
│       ├── diagnostics.js
│       ├── controls.js
│       ├── export.js
│       └── app.js
└── vendor/
    ├── three.global.js
    └── controls/
        └── OrbitControls.global.js
```

### JavaScript responsibilities

- `config.js` — defaults, control definitions, camera presets, quality presets, output presets, and constants
- `core.js` — authoritative state, DOM references, Three.js scene, renderer, camera, and orbit controls
- `utils.js` — formatting, math, timing, download, estimate, and shared helpers
- `analysis.js` — live/offline FFT sampling, amplitude processing, metrics, geometry, shaders, transients, and camera dynamics
- `playback.js` — Web Audio graph, transport, seeking, volume, mute, and playback state
- `loop.js` — waveform peaks, BPM detection, loop editing, preview, and loop enforcement
- `loader.js` — file reading, decoding, metadata validation, track information, drag UI, and load errors
- `renderer.js` — viewport fitting, camera projection, quality scaling, camera presets/keyframes, rendering, and context recovery
- `hud.js` — metadata, graphs, frequency labels, logo layout, safe areas, preview HUD, and export HUD composition
- `state-manager.js` — snapshots, validation, JSON import, undo, redo, and full reset
- `diagnostics.js` — capability report, contextual errors, modal behavior, and WebGL context-loss recovery
- `controls.js` — sidebar bindings, presets, section resets, collapsible panels, and responsive sidebar behavior
- `export.js` — output presets, ranges, estimates, PNG, real-time video, offline video, progress, and JSON export
- `app.js` — startup, application composition, keyboard shortcuts, drag/drop, resize handling, and animation loop

## Troubleshooting

### Audio never reaches READY

- Verify that the extension matches the actual codec.
- Try WAV or MP3 to isolate a codec issue.
- Confirm the file is not corrupted or DRM-protected.
- Serve the project through a local HTTP server if direct-file browser security interferes with media handling.

### Audio plays, but the Loop Editor is unavailable

The media codec is playable, but Web Audio could not decode it into an `AudioBuffer`. Convert the track to WAV or MP3 for waveform analysis, track normalization, looping, and deterministic offline export.

### The visualization is blank

- Confirm the track is playing.
- Reset the Spectrogram section.
- Reset the Camera section.
- Try the Performance quality preset.
- Open Browser Capabilities and confirm WebGL is active.
- Confirm browser hardware acceleration is enabled.

### 4K export cannot start

- Try 1080 resolution.
- Lower the frame rate or bitrate.
- Use Real-Time mode when WebCodecs is unavailable.
- Use MP4 for High Quality Offline export.
- Use MKV/WebM for Real-Time export when MP4 recording is unavailable.

### Offline export cannot load the muxer

The offline MP4 path loads `mp4-muxer` dynamically. Check the internet connection or use Real-Time export.

## Browser Notes

- Current Chromium-based browsers provide the broadest feature and export support.
- Firefox supports the core visualizer and browser-supported real-time recording formats, but WebCodecs offline export may be unavailable.
- Safari supports the core visualizer, but media decoding, recording containers, and WebCodecs availability vary by operating-system version.
- MP4 and MKV support is detected at runtime and depends on browser/OS codec support.

## Privacy

Audio files are processed locally in the browser. The application does not upload selected audio, settings, renders, or exports to a server.
