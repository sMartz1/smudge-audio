# Smudge

Desktop app that camouflages audio against acoustic fingerprinting systems
(Content ID, AcoustID, Shazam, ML-based detection). Loads from a local file or
a YouTube URL, applies a tunable chain of pitch shift, tempo change, EQ tilt,
short reverb and pink-noise injection, and exports the result.

Built with Electron + FFmpeg.

---

## Why fingerprint evasion needs more than noise

Modern audio fingerprints hash **peaks in the time-frequency spectrogram**
(Wang's algorithm and descendants). A low-level additive noise floor sits
below those peaks and gets ignored by the detector — that's why pink noise
alone rarely changes a match score.

What does move the peaks:

- **Pitch shift** displaces every peak vertically in the spectrogram.
- **Tempo change** displaces peaks horizontally.
- **EQ tilt** attenuates peaks in target bands.
- **Reverb** introduces new reflections that hash differently.
- **Pink noise** is kept as a last layer — cheap and occasionally useful as
  an ML adversarial perturbation.

Smudge stacks all five, controlled by four presets and an advanced override
panel.

---

## Features

- Load audio from a local file (drag-drop or picker) or paste a YouTube URL.
- Built-in YouTube audio downloader via bundled `yt-dlp`.
- Four presets (Off / Suave / Medio / Agresivo) for one-click processing.
- Advanced panel for granular control of every parameter.
- Dynamic FFmpeg filter graph: neutral controls are skipped, so passthrough
  is real passthrough.
- Bundled FFmpeg and yt-dlp binaries — no system dependencies.

---

## Install

```bash
git clone https://github.com/sMartz1/smudge-audio.git
cd smudge-audio
npm install
npm start
```

Requires Node.js 18+ and works on Windows, macOS and Linux (bundled binaries
are platform-specific via `ffmpeg-static` and `youtube-dl-exec`).

---

## Usage

1. Drag an audio file onto the drop zone, or click **Seleccionar archivo**, or
   paste a YouTube URL and hit **Cargar**.
2. Pick a preset, or open **Avanzado** to tune individual parameters.
3. Click **Procesar y guardar** and choose an output path.

### Presets

| Preset    | Pitch (cents) | Tempo (%) | Bass (dB) | Treble (dB) | Reverb (%) | Noise (dB) |
|-----------|---------------|-----------|-----------|-------------|------------|------------|
| Off       | 0             | 0         | 0         | 0           | 0          | -50        |
| Suave     | +30           | +2        | -1        | +1          | 5          | -30        |
| Medio     | +60           | +4        | -2        | +2          | 10         | -25        |
| Agresivo  | +150          | +7        | -3        | +3          | 15         | -20        |

Start with **Suave** and step up only if the target detector still matches.
Above **Agresivo**, alterations become audible enough to hurt listenability.

---

## How it works

### Filter chain

The output is produced by a single FFmpeg invocation with a dynamic
`complex_filter`:

```
[0:a]
  rubberband=pitch=<ratio>:tempo=<ratio>
  ,bass=g=<dB>
  ,treble=g=<dB>
  ,aecho=0.8:<out_gain>:60:0.4
[processed];
[1:a]volume=<dB>[noise];
[processed][noise]amix=inputs=2:duration=first:normalize=0[out]
```

Any stage with a neutral value (e.g. pitch = 0 cents, treble = 0 dB) is
omitted from the chain. With all controls neutral, the graph collapses to
`anull` — bit-identical-ish passthrough.

### Unit conversions

| UI unit | FFmpeg unit | Conversion |
|---|---|---|
| Pitch cents | `rubberband` ratio | `2^(cents / 1200)` |
| Tempo % | `rubberband` / `atempo` ratio | `1 + percent / 100` |
| Reverb mix % | `aecho out_gain` | `(mix / 100) * 0.6` |

### YouTube ingestion

URLs are routed through `yt-dlp -f bestaudio`, downloaded to an OS-temp
directory, then fed into the same processing pipeline as a local file. The
bundled FFmpeg path is passed to yt-dlp with `--ffmpeg-location` so there are
no external requirements. Temp dirs are cleaned on app quit.

---

## Architecture

```
main.js                 Electron main; IPC handlers; dialog; temp cleanup
preload.js              contextBridge: selectInput, downloadUrl, processAudio
index.html              UI: drop zone, URL row, presets, advanced sliders
renderer.js             Param state, preset application, IPC orchestration
audio-processor.js      FFmpeg complex filter builder + runner
youtube-downloader.js   yt-dlp wrapper + stdout/stderr progress parser
styles.css              Minimal dark theme
```

---

## Build

```bash
npm run dist          # full installer
npm run pack          # unpacked build for testing
```

Uses `electron-builder`. Native binaries (`ffmpeg-static`, `yt-dlp`) are
`asarUnpack`ed so they remain executable from inside the packaged app.

---

## Caveats

- **Use it on content you own or have the right to alter.** Smudge is an
  audio transformation tool — it does not grant any rights to source material.
  Intended use cases include mashups, transformative work, voice content with
  licensed backgrounds, archival, and stripping ML training watermarks from
  your own audio.
- Fingerprinting systems evolve. There is no guarantee any specific preset
  will defeat any specific detector — test empirically.
- Aggressive settings degrade audio quality. Higher is not always better.

---

## License

MIT — see [LICENSE](LICENSE).
