'use strict';
const { spawnSync } = require('node:child_process');

const checks = [
  ['Node.js', process.execPath, ['--version']],
  ['yt-dlp', process.env.YTDLP_BIN || 'yt-dlp', ['--version']],
  ['FFmpeg', 'ffmpeg', ['-version']],
  ['FFprobe', 'ffprobe', ['-version']]
];

console.log('\nMediaDock — System diagnostics\n');
let missing = 0;
for (const [name, executable, args] of checks) {
  const result = spawnSync(executable, args, { encoding: 'utf8', shell: false, timeout: 5000, windowsHide: true });
  if (result.error || result.status !== 0) {
    console.log('[MISSING] ' + name + ' — install it and add to PATH');
    missing++;
  } else {
    const firstLine = String(result.stdout || result.stderr).split(/\r?\n/)[0].slice(0, 100);
    console.log('[OK]      ' + name + ' — ' + firstLine);
  }
}
console.log('\nNode runtime: ' + process.version);
console.log('Server binding: 127.0.0.1 only\n');
if (missing) {
  console.error(missing + ' required component(s) missing. See README.md.');
  process.exitCode = 1;
} else {
  console.log('All primary dependencies are present.');
}
