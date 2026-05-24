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
  noiseDb: -50,        // pink noise level
  brownNoiseDb: -50,   // brown noise level (second masking layer)
  sunoScrub: false,
  vocalScrub: false,   // vocal-aware: center duck + formant-preserved pitch
  lyricScrub: false,   // anti-ASR: reverse layer + consonant notches + formant destruction
  timingJitter: 0,
  tapeSim: 0,
  cabinetMix: 0,
  codecLaunder: 0
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

function buildFilter(params, duration, channels = 1) {
  const p = { ...NEUTRAL, ...params };

  const usePitch = Math.abs(p.pitchCents) >= 1;
  const useTempo = Math.abs(p.tempoPercent) >= 0.1;
  const useBass = Math.abs(p.bassDb) >= 0.1;
  const useTreble = Math.abs(p.trebleDb) >= 0.1;
  const useReverb = p.reverbMix >= 0.5;
  const useNoise = p.noiseDb > -49.5;
  const useBrown = p.brownNoiseDb > -49.5;
  const useSunoScrub = p.sunoScrub === true;
  // Center-channel duck only makes sense on stereo content — skip on mono.
  // Formant preservation in rubberband still applies even on mono.
  const useVocalDuck = p.vocalScrub === true && channels >= 2;
  const useLyricScrub = p.lyricScrub === true;
  // Lyric scrub WANTS formants destroyed (chipmunk = ASR can't read phonemes),
  // so it overrides vocal scrub's formant preservation.
  const useVocalFormant = p.vocalScrub === true && !useLyricScrub;
  const useJitter = p.timingJitter > 0.01 && duration && duration > 1.5;
  const useTape = p.tapeSim > 0.01;
  const useCabinet = p.cabinetMix > 0.5;
  const useDegrade = p.codecLaunder > 0.05;

  const hasAnyProcessing =
    usePitch || useTempo || useBass || useTreble || useReverb ||
    useSunoScrub || useJitter || useTape || useCabinet || useDegrade ||
    useBrown || useVocalDuck || useLyricScrub;

  // Input index allocation: 0 user main; optional re-mount for reverse layer;
  // then optional pink + brown noise.
  let nextIdx = 1;
  const reverseIdx = useLyricScrub ? nextIdx++ : -1;
  const noiseIdx = useNoise ? nextIdx++ : -1;
  const brownIdx = useBrown ? nextIdx++ : -1;

  // Pure passthrough fast path.
  if (!hasAnyProcessing && !useNoise && !useBrown) {
    return {
      complex: '[0:a]anull[out]',
      needsNoiseInput: false,
      needsBrownInput: false,
      needsReverseInput: false
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
    // Formant preservation keeps vowel character intact under pitch shift —
    // avoids chipmunk voices and hurts transcription matching less.
    const formantFlag = useVocalFormant ? ':formant=preserved' : '';
    linear.push(`rubberband=pitch=${pr.toFixed(6)}:tempo=${tr.toFixed(6)}${formantFlag}`);
  }

  // Vocal duck: subtract a portion of the opposite channel from each side so
  // anything mixed dead-center (typically the lead vocal) gets attenuated by
  // ~60%. Stereo-panned instruments survive intact.
  if (useVocalDuck) {
    linear.push('pan=stereo|c0=0.7*c0-0.3*c1|c1=-0.3*c0+0.7*c1');
  }

  // Anti-ASR consonant notches: speech intelligibility lives in narrow bands
  // (nasal vowels ~1.5kHz, sibilants ~2.8kHz, stops ~4.5kHz). Notching these
  // narrow bands wrecks transcription while music carries on (most tones are
  // wider than the notches).
  if (useLyricScrub) {
    linear.push('bandreject=f=1500:width_type=h:w=300');
    linear.push('bandreject=f=2800:width_type=h:w=400');
    linear.push('bandreject=f=4500:width_type=h:w=500');
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
    const lpFreq = Math.round(20000 - 15000 * p.codecLaunder); // 20k -> 5k
    const bits = (16 - 6 * p.codecLaunder).toFixed(2);         // 16 -> 10 bits
    linear.push(`lowpass=f=${lpFreq}`);
    linear.push(`acrusher=bits=${bits}:samples=1:mode=lin:level_in=1:level_out=1`);
  }

  if (linear.length > 0) {
    parts.push(`${currentLabel}${linear.join(',')}[lin]`);
    currentLabel = '[lin]';
  }

  // 3a. Lyric scrub reverse layer: take the original input, reverse it, drop to
  // -15dB and mix into the processed signal. Inaudible-ish to human ears
  // (masked by main signal) but Whisper/ASR sees a second speech-like layer
  // running backwards and degrades sharply.
  if (useLyricScrub) {
    parts.push(`[${reverseIdx}:a]areverse,volume=-15dB[rev]`);
    parts.push(`${currentLabel}[rev]amix=inputs=2:duration=first:normalize=0[lyric]`);
    currentLabel = '[lyric]';
  }

  // 3b. Cabinet sim: speaker-shape EQ on a wet branch, amix with dry.
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

  // 4. Final stage: mix pink + brown noise layers into the processed signal.
  // Both noise types together cover the spectrum more uniformly than either
  // alone (pink 1/f favors lows, brown 1/f^2 favors lows even more, white is
  // flat — pink+brown skews bass-heavy which masks rhythmic content well).
  const noiseSources = [];
  if (useNoise) {
    parts.push(`[${noiseIdx}:a]volume=${p.noiseDb}dB[nzP]`);
    noiseSources.push('[nzP]');
  }
  if (useBrown) {
    parts.push(`[${brownIdx}:a]volume=${p.brownNoiseDb}dB[nzB]`);
    noiseSources.push('[nzB]');
  }

  if (noiseSources.length > 0) {
    const mixCount = 1 + noiseSources.length; // signal + N noise layers
    parts.push(
      `${currentLabel}${noiseSources.join('')}amix=inputs=${mixCount}:duration=first:normalize=0[out]`
    );
  } else {
    // No masking: relabel last node's output to [out]
    parts[parts.length - 1] = parts[parts.length - 1].replace(
      /\[(jit|lin|cab|lyric)\]$/,
      '[out]'
    );
  }

  return {
    complex: parts.join(';'),
    needsNoiseInput: useNoise,
    needsBrownInput: useBrown,
    needsReverseInput: useLyricScrub
  };
}

function getAudioInfo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const duration = parseFloat(data?.format?.duration ?? 'NaN');
      const audioStream = data?.streams?.find((s) => s.codec_type === 'audio');
      const channels = audioStream?.channels ?? 1;
      if (!isFinite(duration)) {
        return reject(new Error('No se pudo leer la duracion del audio.'));
      }
      resolve({ duration, channels });
    });
  });
}

async function processAudio(inputPath, outputPath, params, onProgress) {
  const p = { ...NEUTRAL, ...params };

  // Probe is needed when jitter requires duration OR vocalScrub needs channel
  // count. Single subprocess gives us both.
  const needsProbe = p.timingJitter > 0.01 || p.vocalScrub;
  const info = needsProbe ? await getAudioInfo(inputPath) : null;
  const duration = info?.duration ?? null;
  const channels = info?.channels ?? 1;

  return new Promise((resolve, reject) => {
    const { complex, needsNoiseInput, needsBrownInput, needsReverseInput } =
      buildFilter(p, duration, channels);

    // Inputs must be added in the same order buildFilter's index allocation:
    // main, [reverse-source], [pink], [brown].
    const cmd = ffmpeg().input(inputPath);
    if (needsReverseInput) {
      // Same file mounted twice; areverse pulls from this second mount.
      cmd.input(inputPath);
    }
    if (needsNoiseInput) {
      cmd.input('anoisesrc=color=pink:amplitude=1.0').inputOptions(['-f', 'lavfi']);
    }
    if (needsBrownInput) {
      cmd.input('anoisesrc=color=brown:amplitude=1.0').inputOptions(['-f', 'lavfi']);
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
