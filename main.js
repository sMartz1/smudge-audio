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
    width: 520,
    height: 720,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  cleanupTempDirs();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanupTempDirs);

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

ipcMain.handle('download-url', async (event, url) => {
  if (!url || !isYoutubeUrl(url)) {
    return { ok: false, error: 'URL de YouTube no valida.' };
  }
  try {
    const { filePath, tempDir } = await downloadAudio(url, (percent) => {
      event.sender.send('download-progress', percent);
    });
    tempDirs.add(tempDir);
    return { ok: true, filePath };
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
