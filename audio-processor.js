const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
const ffprobePath = ffprobeStatic.path.replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const NEUTRAL = {
  pitchCents: 0,
  tempoPercent: 0,
  bassDb: 0,
  trebleDb: 0,
  reverbMix: 0,
  noiseDb: -50,
  sunoScrub: false,
  timingJitter: 0,    // 0..1 intensity (chunked atempo jitter)
  tapeSim: 0,         // 0..1 intensity (wow + soft compression)
  cabinetMix: 0,      // 0..100 wet % (EQ-based speaker shape)
  codecLaunder: 0     // 0..1 lo-fi degradation (lowpass + bit reduction)
};

// Documented Suno watermark bands.
const SUNO_BANDS = [
  { f: 100,   w: 100  },
  { f: 8100,  w: 200  },
  { f: 12050, w: 100  },
  { f: 15500, w: 1000 },
  { f: 18000, w: 1000 },
  { f: 19500, w: 1000 },
  { f: 22500, w: 1000 }
];

// Deterministic PRNG so the same input + params always yields the same jitter sequence.
function makeRand(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildJitterSegment(duration, intensity, srcLabel, outLabel) {
  const CHUNK_S = 1.0;
  const MAX_CHUNKS = 500;
  let chunkSize = CHUNK_S;
  let numChunks = Math.ceil(duration / chunkSize);
  if (numChunks > MAX_CHUNKS) {
    chunkSize = duration / MAX_CHUNKS;
    numChunks = MAX_CHUNKS;
  }
  if (numChunks < 2) {
    // File too short for meaningful jitter — passthrough rename.
    return `${srcLabel}anull${outLabel}`;
  }

  const maxJitter = 0.04 * intensity; // up to ±4% per chunk
  const rand = makeRand(Math.floor(duration * 1000));

  const splitOuts = [];
  for (let i = 0; i < numChunks; i++) splitOuts.push(`[c${i}]`);

  const lines = [];
  lines.push(`${srcLabel}asplit=${numChunks}${splitOuts.join('')}`);

  const trimmedOuts = [];
  for (let i = 0; i < numChunks; i++) {
    const start = (i * chunkSize).toFixed(6);
    const end = ((i + 1) * chunkSize).toFixed(6);
    const ratio = (1 + (rand() * 2 - 1) * maxJitter).toFixed(4);
    lines.push(
      `[c${i}]atrim=${start}:${end},asetpts=PTS-STARTPTS,atempo=${ratio}[t${i}]`
    );
    trimmedOuts.push(`[t${i}]`);
  }

  lines.push(`${trimmedOuts.join('')}concat=n=${numChunks}:a=1:v=0${outLabel}`);
  return lines.join(';');
}

function buildFilter(params, duration) {
  const p = { ...NEUTRAL, ...params };

  const usePitch = Math.abs(p.pitchCents) >= 1;
  const useTempo = Math.abs(p.tempoPercent) >= 0.1;
  const useBass = Math.abs(p.bassDb) >= 0.1;
  const useTreble = Math.abs(p.trebleDb) >= 0.1;
  const useReverb = p.reverbMix >= 0.5;
  const useNoise = p.noiseDb > -49.5;
  const useSunoScrub = p.sunoScrub === true;
  const useJitter = p.timingJitter > 0.01 && duration && duration > 1.5;
  const useTape = p.tapeSim > 0.01;
  const useCabinet = p.cabinetMix > 0.5;
  const useDegrade = p.codecLaunder > 0.05;

  const hasAnyProcessing =
    usePitch || useTempo || useBass || useTreble || useReverb ||
    useSunoScrub || useJitter || useTape || useCabinet || useDegrade;

  // Input index allocation: 0 user; pink noise (if used) is the next.
  // Cabinet sim is now EQ-based, no extra input file.
  let nextIdx = 1;
  const noiseIdx = useNoise ? nextIdx++ : -1;

  // Pure passthrough fast path.
  if (!hasAnyProcessing && !useNoise) {
    return {
      complex: '[0:a]anull[out]',
      needsNoiseInput: false
    };
  }

  const parts = [];
  let currentLabel = '[0:a]';

  // 1. Timing jitter
  if (useJitter) {
    parts.push(buildJitterSegment(duration, p.timingJitter, currentLabel, '[jit]'));
    currentLabel = '[jit]';
  }

  // 2. Linear chain
  const linear = [];
  linear.push('adeclick');
  if (useSunoScrub) {
    for (const b of SUNO_BANDS) {
      linear.push(`bandreject=f=${b.f}:width_type=h:w=${b.w}`);
    }
  }
  if (usePitch || useTempo) {
    const pr = Math.pow(2, p.pitchCents / 1200);
    const tr = 1 + p.tempoPercent / 100;
    linear.push(`rubberband=pitch=${pr.toFixed(6)}:tempo=${tr.toFixed(6)}`);
  }
  if (useBass) linear.push(`bass=g=${p.bassDb.toFixed(2)}`);
  if (useTreble) linear.push(`treble=g=${p.trebleDb.toFixed(2)}`);

  if (useTape) {
    const wowDepth = (0.003 * p.tapeSim).toFixed(4);
    linear.push(`vibrato=f=0.5:d=${wowDepth}`);
    // Soft-knee tape-style compression
    linear.push('compand=attacks=0:decays=0.1:points=-80/-80|-12/-12|0/-3');
  }

  if (useReverb) {
    // aecho out_gain is a MASTER fader on the whole output (dry + echoes), not
    // a wet-mix amount. Keeping it ~1.0 prevents the entire signal from being
    // attenuated. Reverb amount is expressed via the echo decay instead.
    const decay = (0.1 + (p.reverbMix / 100) * 0.4).toFixed(3); // 0.1 .. 0.5
    linear.push(`aecho=in_gain=1.0:out_gain=0.9:delays=60:decays=${decay}`);
  }

  // Codec laundering: lo-fi degradation that destroys spectrogram peaks
  // detectors hash. Lowpass cuts high-frequency fingerprint material; acrusher
  // adds harmonic distortion that shifts peaks off the original locations.
  if (useDegrade) {
    const lpFreq = Math.round(20000 - 12000 * p.codecLaunder);  // 20k -> 8k
    const bits = (16 - 4 * p.codecLaunder).toFixed(2);          // 16 -> 12 bits
    linear.push(`lowpass=f=${lpFreq}`);
    linear.push(`acrusher=bits=${bits}:samples=1:mode=lin:level_in=1:level_out=1`);
  }

  if (linear.length > 0) {
    parts.push(`${currentLabel}${linear.join(',')}[lin]`);
    currentLabel = '[lin]';
  }

  // 3. Cabinet sim: speaker-shape EQ on a wet branch, amix with dry.
  // Replaces a previous afir convolution that destroyed the signal because
  // the IR was a noise burst and afir's default gtype=peak attenuated by ~70dB.
  if (useCabinet) {
    const wet = (p.cabinetMix / 100).toFixed(3);
    const dry = (1 - p.cabinetMix / 100).toFixed(3);
    parts.push(`${currentLabel}asplit=2[cabDry][cabWet]`);
    parts.push(
      `[cabWet]highpass=f=80:width_type=q:width=0.7,` +
      `lowpass=f=6000:width_type=q:width=0.7,` +
      `equalizer=f=200:t=q:w=1.5:g=2.5,` +
      `equalizer=f=4000:t=q:w=2:g=-3,` +
      `volume=${wet}[cabWetV]`
    );
    parts.push(`[cabDry]volume=${dry}[cabDryV]`);
    parts.push(`[cabDryV][cabWetV]amix=inputs=2:normalize=0[cab]`);
    currentLabel = '[cab]';
  }

  // 4. Final stage: noise mix or relabel to [out]
  if (useNoise) {
    parts.push(`[${noiseIdx}:a]volume=${p.noiseDb}dB[nz]`);
    parts.push(`${currentLabel}[nz]amix=inputs=2:duration=first:normalize=0[out]`);
  } else {
    // Relabel the last node's output to [out]
    parts[parts.length - 1] = parts[parts.length - 1].replace(
      /\[(jit|lin|cab)\]$/,
      '[out]'
    );
  }

  return {
    complex: parts.join(';'),
    needsNoiseInput: useNoise
  };
}

function getDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const d = data && data.format && parseFloat(data.format.duration);
      if (!isFinite(d)) return reject(new Error('No se pudo leer la duracion del audio.'));
      resolve(d);
    });
  });
}

async function processAudio(inputPath, outputPath, params, onProgress) {
  const p = { ...NEUTRAL, ...params };

  // Only probe when jitter is needed — saves a subprocess on the common path.
  const duration = p.timingJitter > 0.01 ? await getDuration(inputPath) : null;

  return new Promise((resolve, reject) => {
    const { complex, needsNoiseInput } = buildFilter(p, duration);

    const cmd = ffmpeg().input(inputPath);
    if (needsNoiseInput) {
      cmd.input('anoisesrc=color=pink:amplitude=1.0').inputOptions(['-f', 'lavfi']);
    }

    cmd
      .complexFilter(complex, ['out'])
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
