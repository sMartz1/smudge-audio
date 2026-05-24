const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);

const NEUTRAL = {
  pitchCents: 0,
  tempoPercent: 0,
  bassDb: 0,
  trebleDb: 0,
  reverbMix: 0,
  noiseDb: -50,
  sunoScrub: false
};

// Suno watermark frequency bands documented by ai-audio-fingerprint-remover.
// Center freq (Hz), bandwidth (Hz). Narrow bands stay inaudible; wider ultrasonic
// bands sit above most musical content and rely on graceful no-op past Nyquist.
const SUNO_BANDS = [
  { f: 100,   w: 100  }, // 50–150 low-freq steganography
  { f: 8100,  w: 200  }, // 8000–8200 mid-range marker
  { f: 12050, w: 100  }, // 12000–12100 secondary marker
  { f: 15500, w: 1000 }, // 15000–16000 mid-high watermark
  { f: 18000, w: 1000 }, // 17500–18500 extended
  { f: 19500, w: 1000 }, // 19000–20000 ultrasonic primary
  { f: 22500, w: 1000 }  // 22000–23000 extended ultrasonic
];

function buildFilter(params) {
  const p = { ...NEUTRAL, ...params };
  const chain = [];

  const usePitch = Math.abs(p.pitchCents) >= 1;
  const useTempo = Math.abs(p.tempoPercent) >= 0.1;
  const useBass = Math.abs(p.bassDb) >= 0.1;
  const useTreble = Math.abs(p.trebleDb) >= 0.1;
  const useReverb = p.reverbMix >= 0.5;
  const useNoise = p.noiseDb > -49.5;
  const useSunoScrub = p.sunoScrub === true;

  const hasAnyProcessing = usePitch || useTempo || useBass || useTreble || useReverb || useSunoScrub;

  // Declick first to smooth Suno's generation-boundary clicks before further processing.
  // Only when there's already other processing — avoids touching pure-passthrough.
  if (hasAnyProcessing) {
    chain.push('adeclick');
  }

  // Suno scrub: surgical notches on the documented watermark bands. Placed BEFORE
  // pitch/tempo so the notch frequencies hit the actual watermark before any shift.
  if (useSunoScrub) {
    for (const b of SUNO_BANDS) {
      chain.push(`bandreject=f=${b.f}:width_type=h:w=${b.w}`);
    }
  }

  if (usePitch || useTempo) {
    const pitchRatio = Math.pow(2, p.pitchCents / 1200);
    const tempoRatio = 1 + p.tempoPercent / 100;
    chain.push(`rubberband=pitch=${pitchRatio.toFixed(6)}:tempo=${tempoRatio.toFixed(6)}`);
  }

  if (useBass) chain.push(`bass=g=${p.bassDb.toFixed(2)}`);
  if (useTreble) chain.push(`treble=g=${p.trebleDb.toFixed(2)}`);

  if (useReverb) {
    const outGain = (p.reverbMix / 100) * 0.6;
    chain.push(`aecho=0.8:${outGain.toFixed(3)}:60:0.4`);
  }

  if (chain.length === 0 && !useNoise) {
    return { complex: '[0:a]anull[out]', needsNoiseInput: false };
  }

  if (!useNoise) {
    return {
      complex: `[0:a]${chain.join(',')}[out]`,
      needsNoiseInput: false
    };
  }

  const processedLabel = chain.length === 0 ? '0:a' : 'processed';
  const processedNode = chain.length === 0
    ? ''
    : `[0:a]${chain.join(',')}[processed];`;

  return {
    complex:
      `${processedNode}` +
      `[1:a]volume=${p.noiseDb}dB[noise];` +
      `[${processedLabel}][noise]amix=inputs=2:duration=first:normalize=0[out]`,
    needsNoiseInput: true
  };
}

function processAudio(inputPath, outputPath, params, onProgress) {
  return new Promise((resolve, reject) => {
    const { complex, needsNoiseInput } = buildFilter(params);

    const cmd = ffmpeg().input(inputPath);
    if (needsNoiseInput) {
      cmd.input('anoisesrc=color=pink:amplitude=1.0').inputOptions(['-f', 'lavfi']);
    }

    cmd
      .complexFilter(complex, ['out'])
      // Strip all metadata: removes ID3, RIFF, FLAC tags AND any custom Suno chunks.
      // First gatekeeper distributors check, mandatory baseline.
      .outputOptions(['-map_metadata', '-1'])
      .on('progress', (pr) => {
        if (typeof pr.percent === 'number') {
          onProgress(Math.max(0, Math.min(100, pr.percent)));
        }
      })
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

module.exports = { processAudio, buildFilter, NEUTRAL, SUNO_BANDS };
