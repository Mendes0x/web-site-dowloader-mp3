'use strict';

const { spawn } = require('node:child_process');
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
    extractAudio: job.format === 'audio',
    audioFormat: job.format === 'audio' ? 'mp3' : undefined,
    audioQuality: quality === 'best' ? '0' : quality === 'small' ? '8' : '4',
    mergeOutputFormat: job.format === 'video' ? 'mp4' : undefined,
    progressTemplate: 'download:MD_PROGRESS:%(progress._percent_str)s'
  };
}

function buildArgs(job) {
  const flags = flagsFor(job);
  const args = [
    '--ignore-config', '--no-playlist', '--max-downloads', '1',
    '--max-filesize', '500M', '--no-mtime', '--newline', '--no-warnings',
    '--retries', '2', '--fragment-retries', '2', '--socket-timeout', '20',
    '--restrict-filenames',
    '--progress-template', flags.progressTemplate,
    '--output', flags.output,
    '--format', flags.format
  ];
  if (flags.extractAudio) {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', flags.audioQuality);
  } else {
    args.push('--merge-output-format', 'mp4');
  }
  // Explicit -- keeps the URL a positional argument and prevents option injection.
  args.push('--', job.url);
  return args;
}

function parseProgress(text) {
  const matches = [...text.matchAll(/MD_PROGRESS:\s*(\d+(?:\.\d+)?)%/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

async function listArtifacts(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const formats = new Set(['.mp3', '.mp4', '.m4a', '.mkv', '.webm', '.opus', '.ogg', '.flac', '.wav']);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    if (!formats.has(path.extname(entry.name).toLowerCase())) continue;
    const stat = await fs.lstat(path.join(dir, entry.name));
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    files.push({ id: String(files.length), name: entry.name, size: stat.size });
  }
  return files;
}

function createRunner({
  spawnProcess = spawn,
  executable = process.env.YTDLP_BIN || 'yt-dlp',
  timeoutMs = 20 * 60 * 1000
} = {}) {
  return async (job, { signal, progress }) => {
    await fs.mkdir(job.dir, { recursive: false, mode: 0o700 });
    if (signal.aborted) throw new Error('Cancelled');

    const args = buildArgs(job);
    let child;
    try {
      child = spawnProcess(executable, args, {
        cwd: job.dir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch {
      throw Object.assign(new Error('Could not launch yt-dlp'), {
        publicMessage: 'Could not start yt-dlp. Install it and ensure it is on PATH.'
      });
    }

    let outputTail = '';
    const update = chunk => {
      const output = outputTail + String(chunk);
      const fraction = parseProgress(output);
      if (fraction !== null) progress(fraction, 'Downloading');
      if (output.includes('[ExtractAudio]') || output.includes('[Merger]') || output.includes('[VideoRemuxer]')) {
        progress(99, 'Processing media');
      }
      outputTail = output.slice(-256);
    };
    child.stdout?.on('data', update);
    child.stderr?.on('data', update);

    const stop = () => child.kill('SIGTERM');
    signal.addEventListener('abort', stop, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    timer.unref?.();

    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, sig) => {
          if (code === 0) resolve();
          else reject(new Error('yt-dlp exited: ' + (sig || code)));
        });
      });
      if (signal.aborted) throw new Error('Cancelled');
      if (timedOut) throw new Error('Timed out');
      const files = await listArtifacts(job.dir);
      if (!files.length) {
        throw Object.assign(new Error('No files'), { publicMessage: 'Download completed but no playable output file was found.' });
      }
      return files;
    } catch (error) {
      if (signal.aborted) throw error;
      if (timedOut) {
        throw Object.assign(new Error('Timeout'), { publicMessage: 'Download timed out. Try a smaller quality preset.' });
      }
      if (error?.code === 'ENOENT') {
        throw Object.assign(new Error('yt-dlp not found'), { publicMessage: 'yt-dlp is not installed or not on PATH.' });
      }
      if (error.publicMessage) throw error;
      throw Object.assign(new Error('Download worker failed'), {
        publicMessage: 'Download failed. Check source availability, yt-dlp and FFmpeg installation.'
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    }
  };
}

module.exports = { createRunner, flagsFor, buildArgs, parseProgress, listArtifacts };
