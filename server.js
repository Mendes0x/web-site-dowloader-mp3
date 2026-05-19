const path = require('path');
const fs = require('fs');
const express = require('express');
const youtubedl = require('youtube-dl-exec');

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOADS_ROOT = path.resolve(__dirname, 'downloads');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function sanitizeSavePath(savePath) {
  if (!savePath) {
    return DOWNLOADS_ROOT;
  }

  const resolved = path.resolve(DOWNLOADS_ROOT, savePath);
  if (!resolved.startsWith(DOWNLOADS_ROOT)) {
    throw new Error('The path must stay inside the allowed downloads folder.');
  }

  return resolved;
}

app.post('/download', async (req, res) => {
  const { url, type, folder } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Enter the video or audio URL.' });
  }

  const isAudio = type === 'audio';
  let saveDir;

  try {
    saveDir = sanitizeSavePath(folder);
    ensureDirectory(saveDir);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const outputTemplate = path.join(saveDir, '%(title)s.%(ext)s');

  try {
    await youtubedl(url, {
      output: outputTemplate,
      extractAudio: isAudio,
      audioFormat: isAudio ? 'mp3' : undefined,
      audioQuality: isAudio ? 0 : undefined,
      format: isAudio ? undefined : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
      restrictFilenames: true,
      noWarnings: true,
      ignoreErrors: false,
      noCheckCertificates: true,
      preferFreeFormats: true
    });

    return res.json({
      message: `Download completed as ${isAudio ? 'MP3' : 'video'} in ${saveDir}`
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Error downloading the file. Check the URL or whether youtubedl/yt-dlp is available.',
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  ensureDirectory(DOWNLOADS_ROOT);
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Downloads will be saved in ${DOWNLOADS_ROOT} (or in the chosen relative folder).`);
});
