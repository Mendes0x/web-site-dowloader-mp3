'use strict';

const form = document.getElementById('download-form');
const feedback = document.getElementById('feedback');
const list = document.getElementById('job-list');
const template = document.getElementById('job-template');
const jobs = new Map();
let activeFilter = 'all';
let eventStream = null;

const formatDate = stamp => {
  try { return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stamp)); }
  catch { return ''; }
};
const shortId = id => id.slice(0, 8).toUpperCase();
const formatBytes = bytes => bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : (bytes / 1024).toFixed(1) + ' KB';
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function setFeedback(message, error = false) {
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
}
async function request(url, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  if (method !== 'GET') headers['X-MediaDock-Request'] = '1';
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...options, headers, cache: 'no-store' });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The server could not complete this request.');
  return data;
}
function matches(job) {
  if (activeFilter === 'all') return true;
  if (activeFilter === 'running') return job.state === 'running' || job.state === 'queued';
  if (activeFilter === 'failed') return job.state === 'failed' || job.state === 'cancelled';
  return job.state === activeFilter;
}
function stat() {
  const items = [...jobs.values()];
  document.getElementById('stat-total').textContent = String(items.length);
  document.getElementById('stat-active').textContent = String(items.filter(j => j.state === 'running').length);
  document.getElementById('stat-completed').textContent = String(items.filter(j => j.state === 'completed').length);
  document.getElementById('stat-queued').textContent = String(items.filter(j => j.state === 'queued').length);
}
function renderJob(job) {
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector('.job-row');
  row.dataset.jobId = job.id;
  const title = (() => {
    try { const address = new URL(job.url); return address.hostname.replace(/^www\./, '') + address.pathname; }
    catch { return 'Media download'; }
  })();
  row.querySelector('.job-icon').textContent = job.format === 'audio' ? '♫' : '▷';
  row.querySelector('.job-id').textContent = '#' + shortId(job.id);
  row.querySelector('.job-date').textContent = formatDate(job.createdAt);
  row.querySelector('.job-title').textContent = title.length > 90 ? title.slice(0, 87) + '…' : title;
  row.querySelector('.job-format').textContent = job.format.toUpperCase() + ' · ' + job.quality;
  row.querySelector('.job-stage').textContent = job.stage || job.state;
  row.querySelector('.job-state').textContent = job.state;
  row.querySelector('.job-state').dataset.state = job.state;
  row.querySelector('.progress-fill').style.width = String(job.progress) + '%';
  row.querySelector('.job-percent').textContent = String(job.progress) + '%';
  row.querySelector('.job-error').textContent = job.error || '';
  const cancel = row.querySelector('.job-cancel');
  const remove = row.querySelector('.job-remove');
  cancel.hidden = job.state !== 'queued' && job.state !== 'running';
  remove.hidden = job.state === 'queued' || job.state === 'running';
  cancel.addEventListener('click', () => action(job.id, 'cancel'));
  remove.addEventListener('click', () => action(job.id, 'remove'));
  const files = row.querySelector('.job-files');
  for (const file of job.files || []) {
    const a = el('a', null, '↓ ' + file.name + ' (' + formatBytes(file.size) + ')');
    a.href = '/api/jobs/' + encodeURIComponent(job.id) + '/files/' + encodeURIComponent(file.id);
    a.download = file.name;
    files.append(a);
  }
  return row;
}
function render() {
  const selected = [...jobs.values()]
    .filter(matches)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const fragment = document.createDocumentFragment();
  if (!selected.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('div', 'empty-icon', '↓'), el('h3', null, activeFilter === 'all' ? 'Nothing here yet.' : 'No matching jobs.'),
      el('p', null, activeFilter === 'all' ? 'Start a download above and it will appear here.' : 'Try another status filter.'));
    fragment.append(empty);
  } else {
    selected.forEach(job => fragment.append(renderJob(job)));
  }
  list.replaceChildren(fragment);
  stat();
}
async function refresh() {
  const data = await request('/api/jobs');
  jobs.clear();
  data.jobs.forEach(job => jobs.set(job.id, job));
  render();
}
async function action(id, operation) {
  try {
    if (operation === 'cancel') {
      const data = await request('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
      jobs.set(id, data.job);
    } else {
      await request('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' });
      jobs.delete(id);
    }
    render();
    setFeedback(operation === 'cancel' ? 'Job cancelled.' : 'Job and associated files removed.');
  } catch (error) { setFeedback(error.message, true); }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('submit-button');
  const input = {
    url: document.getElementById('media-url').value.trim(),
    format: document.getElementById('format').value,
    quality: document.getElementById('quality').value
  };
  button.disabled = true;
  setFeedback('Adding the job to your local queue…');
  try {
    const data = await request('/api/jobs', { method: 'POST', body: JSON.stringify(input) });
    jobs.set(data.job.id, data.job);
    activeFilter = 'all';
    document.querySelectorAll('[data-state]').forEach(btn => {
      if (!btn.classList.contains('job-state')) {
        const yes = btn.dataset.state === activeFilter;
        btn.classList.toggle('active', yes);
        btn.setAttribute('aria-pressed', String(yes));
      }
    });
    render();
    setFeedback('Job added. Live updates will appear in your library.');
    form.reset();
  } catch (error) {
    setFeedback(error.message, true);
  } finally { button.disabled = false; }
});
document.querySelectorAll('.job-filter').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.state;
  document.querySelectorAll('.job-filter').forEach(filter => {
    const pressed = filter === button;
    filter.classList.toggle('active', pressed);
    filter.setAttribute('aria-pressed', String(pressed));
  });
  render();
}));
document.getElementById('refresh-button').addEventListener('click', () => {
  refresh().then(() => setFeedback('Library refreshed.')).catch(error => setFeedback(error.message, true));
});
function connectEvents() {
  if (!('EventSource' in window)) return;
  eventStream = new EventSource('/api/events');
  eventStream.addEventListener('job', event => {
    try { const job = JSON.parse(event.data); jobs.set(job.id, job); render(); }
    catch { /* Ignore malformed events. */ }
  });
  eventStream.addEventListener('removed', event => {
    try { jobs.delete(JSON.parse(event.data).id); render(); } catch {}
  });
}
const themeButton = document.getElementById('theme-toggle');
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButton.textContent = theme === 'light' ? '☀' : '☾';
  themeButton.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
}
const storedTheme = localStorage.getItem('mediadock-theme');
applyTheme(storedTheme === 'light' ? 'light' : 'dark');
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(theme);
  localStorage.setItem('mediadock-theme', theme);
});
document.getElementById('year').textContent = String(new Date().getFullYear());
refresh().then(connectEvents).catch(error => setFeedback('Local server error: ' + error.message, true));
// Occasional resync covers tab sleep or lost SSE messages.
setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 30_000);
window.addEventListener('pagehide', () => eventStream?.close());
