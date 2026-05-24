const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

// Resolve yt-dlp binary (handles asar.unpacked in packaged builds)
const ytdlpBin = require.resolve('youtube-dl-exec/bin/yt-dlp.exe')
  .replace('app.asar', 'app.asar.unpacked');

const ffmpegBin = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');

const PROGRESS_RE = /\[download\]\s+([\d.]+)%/;

function isYoutubeUrl(url) {
  return /^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpBin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    });
  });
}

async function getVideoTitle(url) {
  const { stdout } = await runYtDlp([
    url,
    '--no-playlist',
    '--print', '%(title)s'
  ]);
  return stdout.trim();
}

function downloadAudio(url, onProgress) {
  return new Promise((resolve, reject) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunoparser-'));
    const outputTemplate = path.join(tempDir, 'audio.%(ext)s');

    const args = [
      url,
      '--no-playlist',
      '-f', 'bestaudio',
      '-o', outputTemplate,
      '--ffmpeg-location', ffmpegBin,
      '--print', 'after_move:FILE::%(filepath)s',
      '--print', 'after_move:TITLE::%(title)s',
      '--newline'
    ];

    const child = spawn(ytdlpBin, args, { windowsHide: true });

    let finalPath = '';
    let title = '';
    let stderr = '';

    function handleLines(text) {
      const lines = text.split(/\r?\n|\r/);
      for (const line of lines) {
        const m = line.match(PROGRESS_RE);
        if (m) {
          onProgress(parseFloat(m[1]));
        } else if (line.startsWith('FILE::')) {
          finalPath = line.slice(6).trim();
        } else if (line.startsWith('TITLE::')) {
          title = line.slice(7).trim();
        }
      }
    }

    child.stdout.on('data', (chunk) => handleLines(chunk.toString()));
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      // yt-dlp sometimes emits progress to stderr too
      const matches = text.matchAll(/\[download\]\s+([\d.]+)%/g);
      for (const m of matches) onProgress(parseFloat(m[1]));
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
      if (!finalPath || !fs.existsSync(finalPath)) {
        // Fallback: pick the only file in tempDir
        const files = fs.readdirSync(tempDir);
        if (files.length === 0) return reject(new Error('No se descargo ningun archivo.'));
        finalPath = path.join(tempDir, files[0]);
      }
      resolve({ filePath: finalPath, tempDir, title: title || null });
    });
  });
}

module.exports = { isYoutubeUrl, getVideoTitle, downloadAudio };
