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
  noiseDb: -50
};

function buildFilter(params) {
  const p = { ...NEUTRAL, ...params };
  const chain = [];

  // Pitch shift + tempo combined in one rubberband call (single resample pass)
  const usePitch = Math.abs(p.pitchCents) >= 1;
  const useTempo = Math.abs(p.tempoPercent) >= 0.1;
  if (usePitch || useTempo) {
    const pitchRatio = Math.pow(2, p.pitchCents / 1200);
    const tempoRatio = 1 + p.tempoPercent / 100;
    chain.push(`rubberband=pitch=${pitchRatio.toFixed(6)}:tempo=${tempoRatio.toFixed(6)}`);
  }

  if (Math.abs(p.bassDb) >= 0.1) {
    chain.push(`bass=g=${p.bassDb.toFixed(2)}`);
  }
  if (Math.abs(p.trebleDb) >= 0.1) {
    chain.push(`treble=g=${p.trebleDb.toFixed(2)}`);
  }

  if (p.reverbMix >= 0.5) {
    // Map 0-100% to aecho out_gain 0-0.6 (subtle reverb tail)
    const outGain = (p.reverbMix / 100) * 0.6;
    chain.push(`aecho=0.8:${outGain.toFixed(3)}:60:0.4`);
  }

  // Noise floor: pink noise atenuado y mezclado. Si noiseDb <= -50 considera "off".
  const useNoise = p.noiseDb > -49.5;

  if (chain.length === 0 && !useNoise) {
    // Passthrough total: simple copy filter
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

module.exports = { processAudio, buildFilter, NEUTRAL };
