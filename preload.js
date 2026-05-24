const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectInput: () => ipcRenderer.invoke('select-input'),
  selectOutput: (defaultName) => ipcRenderer.invoke('select-output', defaultName),
  processAudio: (payload) => ipcRenderer.invoke('process-audio', payload),
  downloadUrl: (url) => ipcRenderer.invoke('download-url', url),
  onProgress: (cb) => {
    ipcRenderer.removeAllListeners('progress');
    ipcRenderer.on('progress', (_e, percent) => cb(percent));
  },
  onDownloadProgress: (cb) => {
    ipcRenderer.removeAllListeners('download-progress');
    ipcRenderer.on('download-progress', (_e, percent) => cb(percent));
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  window: {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window-maximize-toggle'),
    close: () => ipcRenderer.invoke('window-close'),
    onMaximized: (cb) => {
      ipcRenderer.removeAllListeners('maximized-state');
      ipcRenderer.on('maximized-state', (_e, v) => cb(v));
    }
  }
});
