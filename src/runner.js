'use strict';

const youtubeDl = require('youtube-dl-exec');
const fs = require('node:fs/promises');
const path = require('node:path');

function flagsFor(job) {
  const quality = job.quality;
  const format = job.format === 'audio'
    ? 'bestaudio/best'
    : quality === 'small'
      ? 'bv*[height<=480]+ba/b[height<=480]/best'
      : quality === 'balanced'
        ? 'bv*[height<=1080]+ba/b[height<=1080]/best'
        : 'bv*+ba/best';

  return {
    format,
    output: path.join(job.dir, '%(title).110B-%(id)s.%(ext)s'),
    noPlaylist: true,
    maxDownloads: 1,
    maxFilesize: '500M',
    noWarnings: true,
    noMtime: true,
    newline: true,
    retries: 2,
    fragmentRetries: 2,
    socketTimeout: 20,
    progress: true,
    progressTemplate: 'download:MD_PROGRESS:%(progress._percent_str)s',
    restrictFilenames: true,
    ...job.format === 'audio'
      ? { extractAudio: true, audioFormat: 'mp3', audioQuality: quality === 'best' ? '0' : quality === 'small' ? '8' : '4' }
      : { mergeOutputFormat: 'mp4' }
  };
}

function parseProgress(text) {
  const matches = [...text.matchAll(/MD_PROGRESS:\s*(\d+(?:\.\d+)?)%/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

async function listArtifacts(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const allowed = new Set(['.mp3', '.mp4', '.m4a', '.mkv', '.webm', '.opus', '.ogg', '.flac', '.wav']);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!allowed.has(path.extname(entry.name).toLowerCase())) continue;
    const full = path.join(dir, entry.name);
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    files.push({ id: String(files.length), name: entry.name, size: stat.size });
  }
  return files;
}

function createRunner({ exec = youtubeDl.exec, timeoutMs = 20 * 60 * 1000 } = {}) {
  return async (job, { signal, progress }) => {
    await fs.mkdir(job.dir, { recursive: false, mode: 0o700 });
    if (signal.aborted) throw Object.assign(new Error('Cancelled'), { publicMessage: 'Job cancelled.' });

    let subprocess;
    try {
      subprocess = exec(job.url, flagsFor(job), { windowsHide: true });
    } catch {
      throw Object.assign(new Error('Launch failed'), { publicMessage: 'Could not start yt-dlp. Run npm install again.' });
    }

    let outputTail = '';
    const readOutput = chunk => {
      const text = outputTail + chunk.toString('utf8');
      const matched = parseProgress(text);
      if (matched !== null) progress(matched, 'Downloading');
      if (text.includes('[ExtractAudio]') || text.includes('[Merger]') || text.includes('[VideoRemuxer]')) {
        progress(99, 'Processing media');
      }
      outputTail = text.slice(-256);
    };
    subprocess.stdout?.on('data', readOutput);
    subprocess.stderr?.on('data', readOutput);

    const abort = () => subprocess.kill('SIGTERM');
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => subprocess.kill('SIGTERM'), timeoutMs);
    timer.unref?.();

    try {
      await subprocess;
      if (signal.aborted) throw new Error('Cancelled');
      const files = await listArtifacts(job.dir);
      if (!files.length) {
        throw Object.assign(new Error('No resulting files'), { publicMessage: 'No output media file was produced.' });
      }
      return files;
    } catch (error) {
      if (signal.aborted) throw error;
      if (error.publicMessage) throw error;
      throw Object.assign(new Error('yt-dlp failed'), {
        publicMessage: 'Download failed. Verify that the media is accessible and FFmpeg is installed.'
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  };
}

module.exports = { createRunner, flagsFor, parseProgress, listArtifacts };
