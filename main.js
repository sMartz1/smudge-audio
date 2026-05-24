const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { processAudio } = require('./audio-processor');
const { isYoutubeUrl, downloadAudio } = require('./youtube-downloader');

let mainWindow;
const tempDirs = new Set();

function cleanupTempDirs() {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
  tempDirs.clear();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 540,
    height: 780,
    minWidth: 480,
    minHeight: 600,
    resizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0E0F11',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  const emitMaximized = () => {
    mainWindow.webContents.send('maximized-state', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', emitMaximized);
  mainWindow.on('unmaximize', emitMaximized);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  cleanupTempDirs();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanupTempDirs);

ipcMain.handle('window-minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.handle('window-maximize-toggle', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});

ipcMain.handle('window-close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

ipcMain.handle('select-input', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona audio de entrada',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'wma'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('select-output', async (_e, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar audio procesado',
    defaultPath: defaultName,
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg'] }
    ]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Carpeta destino para las variaciones',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('process-batch', async (event, { inputPath, outputDir, baseName, ext, variations }) => {
  const total = variations.length;
  try {
    for (let i = 0; i < total; i++) {
      const params = variations[i];
      const outFile = path.join(
        outputDir,
        `${baseName}_v${String(i + 1).padStart(2, '0')}${ext}`
      );
      await processAudio(inputPath, outFile, params, (percent) => {
        const overall = ((i + percent / 100) / total) * 100;
        event.sender.send('batch-progress', {
          variationIdx: i,
          variationPercent: percent,
          overallPercent: overall,
          total
        });
      });
      event.sender.send('batch-progress', {
        variationIdx: i,
        variationPercent: 100,
        overallPercent: ((i + 1) / total) * 100,
        total,
        completed: true
      });
    }
    return { ok: true, outputDir };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('download-url', async (event, url) => {
  if (!url || !isYoutubeUrl(url)) {
    return { ok: false, error: 'URL de YouTube no valida.' };
  }
  try {
    const { filePath, tempDir, title } = await downloadAudio(url, (percent) => {
      event.sender.send('download-progress', percent);
    });
    tempDirs.add(tempDir);
    return { ok: true, filePath, title };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('process-audio', async (event, { inputPath, outputPath, params }) => {
  try {
    await processAudio(inputPath, outputPath, params, (percent) => {
      event.sender.send('progress', percent);
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
