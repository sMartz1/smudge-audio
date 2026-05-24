const dropZone = document.getElementById('drop-zone');
const browseBtn = document.getElementById('browse-btn');
const fileNameEl = document.getElementById('file-name');
const processBtn = document.getElementById('process-btn');
const progressWrap = document.getElementById('progress-wrap');
const progressBar = document.getElementById('progress-bar');
const statusEl = document.getElementById('status');
const urlInput = document.getElementById('url-input');
const urlBtn = document.getElementById('url-btn');
const presetRow = document.getElementById('preset-row');

const SLIDERS = {
  pitchCents: { el: document.getElementById('pitch'), val: document.getElementById('pitch-value'), fmt: signed },
  tempoPercent: { el: document.getElementById('tempo'), val: document.getElementById('tempo-value'), fmt: signed },
  bassDb: { el: document.getElementById('bass'), val: document.getElementById('bass-value'), fmt: signed },
  trebleDb: { el: document.getElementById('treble'), val: document.getElementById('treble-value'), fmt: signed },
  reverbMix: { el: document.getElementById('reverb'), val: document.getElementById('reverb-value'), fmt: plain },
  noiseDb: { el: document.getElementById('noise'), val: document.getElementById('noise-value'), fmt: plain }
};

const PRESETS = {
  off:      { pitchCents: 0,   tempoPercent: 0, bassDb: 0,  trebleDb: 0, reverbMix: 0,  noiseDb: -50 },
  suave:    { pitchCents: 30,  tempoPercent: 2, bassDb: -1, trebleDb: 1, reverbMix: 5,  noiseDb: -30 },
  medio:    { pitchCents: 60,  tempoPercent: 4, bassDb: -2, trebleDb: 2, reverbMix: 10, noiseDb: -25 },
  agresivo: { pitchCents: 150, tempoPercent: 7, bassDb: -3, trebleDb: 3, reverbMix: 15, noiseDb: -20 }
};

let inputPath = null;
let params = { ...PRESETS.suave };

function signed(n) { return (n > 0 ? '+' : '') + n; }
function plain(n) { return String(n); }

function applyParamsToUI() {
  for (const [key, s] of Object.entries(SLIDERS)) {
    s.el.value = String(params[key]);
    s.val.textContent = s.fmt(params[key]);
  }
}

function setActivePreset(name) {
  for (const btn of presetRow.querySelectorAll('.preset')) {
    btn.classList.toggle('active', btn.dataset.preset === name);
  }
}

function setInput(filePath) {
  inputPath = filePath;
  const name = filePath.split(/[\\/]/).pop();
  fileNameEl.textContent = name;
  processBtn.disabled = false;
  statusEl.textContent = '';
  progressWrap.classList.add('hidden');
  progressBar.style.width = '0%';
}

function setBusy(busy) {
  browseBtn.disabled = busy;
  urlBtn.disabled = busy;
  urlInput.disabled = busy;
  processBtn.disabled = busy || !inputPath;
}

// Preset clicks
presetRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.preset');
  if (!btn) return;
  const name = btn.dataset.preset;
  params = { ...PRESETS[name] };
  applyParamsToUI();
  setActivePreset(name);
});

// Slider input -> update params + mark "custom"
for (const [key, s] of Object.entries(SLIDERS)) {
  s.el.addEventListener('input', () => {
    const v = parseInt(s.el.value, 10);
    params[key] = v;
    s.val.textContent = s.fmt(v);
    setActivePreset(null);
  });
}

// Initial UI sync
applyParamsToUI();

browseBtn.addEventListener('click', async () => {
  const p = await window.api.selectInput();
  if (p) setInput(p);
});

['dragenter', 'dragover'].forEach((ev) =>
  dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
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
    if (p) setInput(p);
  } catch (err) {
    statusEl.textContent = 'No se pudo leer la ruta del archivo arrastrado.';
  }
});

window.api.onProgress((percent) => {
  progressWrap.classList.remove('hidden');
  progressBar.style.width = `${percent}%`;
});

window.api.onDownloadProgress((percent) => {
  progressWrap.classList.remove('hidden');
  progressBar.style.width = `${percent}%`;
});

urlBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  setBusy(true);
  statusEl.textContent = 'Descargando de YouTube...';
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';

  const res = await window.api.downloadUrl(url);

  setBusy(false);
  if (res.ok) {
    setInput(res.filePath);
    statusEl.textContent = 'Audio descargado. Elige preset y procesa.';
  } else {
    statusEl.textContent = `Error: ${res.error}`;
    progressWrap.classList.add('hidden');
  }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') urlBtn.click();
});

processBtn.addEventListener('click', async () => {
  if (!inputPath) return;

  const dotIdx = inputPath.lastIndexOf('.');
  const slashIdx = Math.max(inputPath.lastIndexOf('\\'), inputPath.lastIndexOf('/'));
  const base = inputPath.slice(slashIdx + 1, dotIdx);
  const ext = inputPath.slice(dotIdx);
  const defaultName = `${base}_proc${ext}`;

  const outputPath = await window.api.selectOutput(defaultName);
  if (!outputPath) return;

  setBusy(true);
  statusEl.textContent = 'Procesando...';
  progressWrap.classList.remove('hidden');
  progressBar.style.width = '0%';

  const res = await window.api.processAudio({ inputPath, outputPath, params });

  setBusy(false);

  if (res.ok) {
    progressBar.style.width = '100%';
    statusEl.textContent = `Listo: ${outputPath}`;
  } else {
    statusEl.textContent = `Error: ${res.error}`;
  }
});
