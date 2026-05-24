// ============ ELEMENT REFS ============

const dropZone = document.getElementById('drop-zone');
const browseBtn = document.getElementById('browse-btn');
const chipName = document.getElementById('chip-name');
const chipRemove = document.getElementById('chip-remove');

const urlInput = document.getElementById('url-input');
const urlBtn = document.getElementById('url-btn');
const urlProgress = document.getElementById('url-progress');

const presetRow = document.getElementById('preset-row');
const customBadge = document.getElementById('custom-badge');

const processBtn = document.getElementById('process-btn');
const ctaProgress = processBtn.querySelector('.cta-progress');
const ctaLabel = processBtn.querySelector('.cta-label');

const statusPanel = document.getElementById('status-panel');
const errorPanel = document.getElementById('error-panel');
const errorText = document.getElementById('error-text');
const errorDismiss = document.getElementById('error-dismiss');

const winMin = document.getElementById('win-min');
const winMax = document.getElementById('win-max');
const winClose = document.getElementById('win-close');

const sunoScrubToggle = document.getElementById('suno-scrub');

// ============ STATE ============

const SLIDERS = {
  pitchCents:   { el: document.getElementById('pitch'),  val: document.getElementById('pitch-value'),  bipolar: true,  fmt: (v) => signed(v) + ' cents' },
  tempoPercent: { el: document.getElementById('tempo'),  val: document.getElementById('tempo-value'),  bipolar: true,  fmt: (v) => signed(v) + ' %' },
  bassDb:       { el: document.getElementById('bass'),   val: document.getElementById('bass-value'),   bipolar: true,  fmt: (v) => signed(v) + ' dB' },
  trebleDb:     { el: document.getElementById('treble'), val: document.getElementById('treble-value'), bipolar: true,  fmt: (v) => signed(v) + ' dB' },
  reverbMix:    { el: document.getElementById('reverb'), val: document.getElementById('reverb-value'), bipolar: false, fmt: (v) => v + ' %' },
  noiseDb:      { el: document.getElementById('noise'),  val: document.getElementById('noise-value'),  bipolar: false, fmt: (v) => v + ' dB' }
};

// Slider params are visible in Advanced. timingJitter/tapeSim/cabinetMix are
// driven by the preset intensity only (not exposed as sliders) — they scale up
// with the chosen aggressiveness.
const PRESETS = {
  off:      { pitchCents: 0,   tempoPercent: 0, bassDb: 0,  trebleDb: 0, reverbMix: 0,  noiseDb: -50 },
  suave:    { pitchCents: 30,  tempoPercent: 2, bassDb: -1, trebleDb: 1, reverbMix: 5,  noiseDb: -30 },
  medio:    { pitchCents: 60,  tempoPercent: 4, bassDb: -2, trebleDb: 2, reverbMix: 10, noiseDb: -25 },
  agresivo: { pitchCents: 150, tempoPercent: 7, bassDb: -3, trebleDb: 3, reverbMix: 15, noiseDb: -20 }
};

// Hidden params per preset. Applied automatically when a preset is selected;
// frozen on the preset (slider drift doesn't touch them).
const PRESET_EXTRAS = {
  off:      { timingJitter: 0,    tapeSim: 0,    cabinetMix: 0  },
  suave:    { timingJitter: 0,    tapeSim: 0.3,  cabinetMix: 0  },
  medio:    { timingJitter: 0.3,  tapeSim: 0.5,  cabinetMix: 10 },
  agresivo: { timingJitter: 0.7,  tapeSim: 0.8,  cabinetMix: 20 }
};

let presetExtras = { ...PRESET_EXTRAS.suave };

let inputPath = null;
let params = { ...PRESETS.suave };

// ============ HELPERS ============

function signed(n) { return (n > 0 ? '+' : '') + n; }

function updateSliderFill(key) {
  const s = SLIDERS[key];
  const min = parseFloat(s.el.min);
  const max = parseFloat(s.el.max);
  const v = parseFloat(s.el.value);
  const thumbPct = ((v - min) / (max - min)) * 100;
  const centerPct = s.bipolar ? ((0 - min) / (max - min)) * 100 : 0;
  const start = Math.min(thumbPct, centerPct);
  const end = Math.max(thumbPct, centerPct);
  s.el.style.setProperty('--fill-start', start + '%');
  s.el.style.setProperty('--fill-end', end + '%');
}

function applyParamsToUI() {
  for (const [key, s] of Object.entries(SLIDERS)) {
    s.el.value = String(params[key]);
    s.val.textContent = s.fmt(params[key]);
    updateSliderFill(key);
  }
}

let animFrame = null;
function animateToPreset(presetName) {
  const targets = { ...PRESETS[presetName] };
  params = { ...targets };
  presetExtras = { ...PRESET_EXTRAS[presetName] };
  const starts = {};
  for (const key of Object.keys(SLIDERS)) {
    starts[key] = parseFloat(SLIDERS[key].el.value);
  }
  const DUR = 260;
  const t0 = performance.now();
  if (animFrame) cancelAnimationFrame(animFrame);
  function step(t) {
    const p = Math.min(1, (t - t0) / DUR);
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    for (const [key, target] of Object.entries(targets)) {
      const v = starts[key] + (target - starts[key]) * e;
      const rounded = Math.round(v);
      SLIDERS[key].el.value = String(rounded);
      SLIDERS[key].val.textContent = SLIDERS[key].fmt(rounded);
      updateSliderFill(key);
    }
    if (p < 1) animFrame = requestAnimationFrame(step);
    else animFrame = null;
  }
  animFrame = requestAnimationFrame(step);
}

function setActivePreset(name) {
  for (const btn of presetRow.querySelectorAll('.seg')) {
    btn.classList.toggle('active', btn.dataset.preset === name);
  }
  if (name === null) {
    presetRow.classList.add('custom');
    customBadge.classList.remove('hidden');
  } else {
    presetRow.classList.remove('custom');
    customBadge.classList.add('hidden');
  }
}

function setSourceState(state, filePath) {
  dropZone.classList.remove('idle', 'has-file', 'drag-over');
  dropZone.classList.add(state);
  if (state === 'has-file' && filePath) {
    const name = filePath.split(/[\\/]/).pop();
    chipName.textContent = name;
    inputPath = filePath;
    processBtn.disabled = false;
  } else {
    inputPath = null;
    processBtn.disabled = true;
  }
}

function setBusy(busy) {
  document.body.classList.toggle('busy', busy);
  browseBtn.disabled = busy;
  urlBtn.disabled = busy;
  urlInput.disabled = busy;
  chipRemove.disabled = busy;
  for (const s of Object.values(SLIDERS)) s.el.disabled = busy;
  for (const seg of presetRow.querySelectorAll('.seg')) seg.disabled = busy;
  processBtn.disabled = busy || !inputPath;
}

let statusTimer = null;
function showStatus(msg, opts = {}) {
  statusPanel.textContent = msg;
  statusPanel.classList.toggle('success', !!opts.success);
  statusPanel.classList.remove('hidden');
  if (statusTimer) clearTimeout(statusTimer);
  if (opts.autohide) {
    statusTimer = setTimeout(() => statusPanel.classList.add('hidden'), opts.autohide);
  }
}

function hideStatus() {
  statusPanel.classList.add('hidden');
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
}

let errorTimer = null;
function showError(msg) {
  errorText.textContent = msg;
  errorPanel.classList.remove('hidden');
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => errorPanel.classList.add('hidden'), 8000);
}

function hideError() {
  errorPanel.classList.add('hidden');
  if (errorTimer) { clearTimeout(errorTimer); errorTimer = null; }
}

// ============ WIRE UP ============

// Window controls
winMin.addEventListener('click', () => window.api.window.minimize());
winMax.addEventListener('click', () => window.api.window.maximizeToggle());
winClose.addEventListener('click', () => window.api.window.close());
window.api.window.onMaximized((isMax) => {
  winMax.setAttribute('aria-label', isMax ? 'Restaurar' : 'Maximizar');
});

// Preset clicks
presetRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg');
  if (!btn) return;
  animateToPreset(btn.dataset.preset);
  setActivePreset(btn.dataset.preset);
});

// Slider input
for (const [key, s] of Object.entries(SLIDERS)) {
  s.el.addEventListener('input', () => {
    const v = parseInt(s.el.value, 10);
    params[key] = v;
    s.val.textContent = s.fmt(v);
    updateSliderFill(key);
    setActivePreset(null);
  });
}

// Initial sync
applyParamsToUI();
setActivePreset('suave');

// Browse
browseBtn.addEventListener('click', async () => {
  hideError();
  const p = await window.api.selectInput();
  if (p) setSourceState('has-file', p);
});

// Drag-drop
['dragenter', 'dragover'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZone.classList.contains('idle')) dropZone.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  })
);
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    const p = window.api.getPathForFile(file);
    if (p) {
      hideError();
      setSourceState('has-file', p);
    }
  } catch (err) {
    showError('No se pudo leer la ruta del archivo arrastrado.');
  }
});

// Chip remove
chipRemove.addEventListener('click', () => {
  setSourceState('idle');
  hideStatus();
});

// URL load
urlBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  hideError();
  setBusy(true);
  showStatus('Descargando de YouTube...');
  urlProgress.classList.add('indeterminate');

  const res = await window.api.downloadUrl(url);

  setBusy(false);
  urlProgress.classList.remove('indeterminate');
  urlProgress.style.width = '0%';
  if (res.ok) {
    setSourceState('has-file', res.filePath);
    showStatus('Audio descargado. Elige preset y procesa.', { autohide: 3500 });
  } else {
    hideStatus();
    showError(res.error);
  }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') urlBtn.click();
});

// Progress events — switch off indeterminate as soon as real progress arrives
window.api.onDownloadProgress((percent) => {
  urlProgress.classList.remove('indeterminate');
  urlProgress.style.width = `${percent}%`;
});

window.api.onProgress((percent) => {
  ctaProgress.classList.remove('indeterminate');
  ctaProgress.style.width = `${percent}%`;
});

// Process
processBtn.addEventListener('click', async () => {
  if (!inputPath) return;

  const dotIdx = inputPath.lastIndexOf('.');
  const slashIdx = Math.max(inputPath.lastIndexOf('\\'), inputPath.lastIndexOf('/'));
  const base = inputPath.slice(slashIdx + 1, dotIdx);
  const ext = inputPath.slice(dotIdx);
  const defaultName = `${base}_smudged${ext}`;

  const outputPath = await window.api.selectOutput(defaultName);
  if (!outputPath) return;

  hideError();
  setBusy(true);
  showStatus('Procesando...');
  processBtn.classList.add('processing');
  ctaProgress.classList.add('indeterminate');
  ctaLabel.textContent = 'PROCESANDO...';

  const fullParams = {
    ...params,
    ...presetExtras,
    sunoScrub: sunoScrubToggle.checked
  };
  const res = await window.api.processAudio({ inputPath, outputPath, params: fullParams });

  setBusy(false);
  processBtn.classList.remove('processing');
  ctaProgress.classList.remove('indeterminate');
  ctaLabel.textContent = 'PROCESAR Y EXPORTAR';
  ctaProgress.style.width = '0%';

  if (res.ok) {
    showStatus(`Listo: ${outputPath}`, { success: true, autohide: 6000 });
  } else {
    hideStatus();
    showError(res.error);
  }
});

// Error dismiss
errorDismiss.addEventListener('click', hideError);
