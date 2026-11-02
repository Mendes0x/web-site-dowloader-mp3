'use strict';

/**
 * MediaDock Tape Lab UI.
 * Client state is derived from the local server; no media URL is injected as HTML.
 */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const form = $('#download-form');
const feedback = $('#feedback');
const library = $('#job-list');
const template = $('#job-template');
const jobs = new Map();
let activeFilter = 'all';
let searchTerm = '';
let eventStream;

const shortId = id => String(id).slice(0, 8).toUpperCase();
const formatBytes = bytes => Number(bytes) >= 1048576
  ? (Number(bytes) / 1048576).toFixed(1) + ' MB'
  : (Number(bytes) / 1024).toFixed(1) + ' KB';
const formatDate = date => {
  try { return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date)); }
  catch { return ''; }
};
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
}
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
  if (!response.ok) throw new Error(data.error || 'The local server could not complete this request.');
  return data;
}
function matches(job) {
  const isState = activeFilter === 'all'
    || (activeFilter === 'running' && ['running', 'queued'].includes(job.state))
    || (activeFilter === 'failed' && ['failed', 'cancelled'].includes(job.state))
    || job.state === activeFilter;
  if (!isState) return false;
  if (!searchTerm) return true;
  const haystack = [
    job.id, job.url, job.format, job.quality, job.state, job.stage,
    ...(job.files || []).map(file => file.name)
  ].join(' ').toLowerCase();
  return haystack.includes(searchTerm);
}
function updateStats() {
  const entries = [...jobs.values()];
  $('#stat-total').textContent = String(entries.length);
  $('#stat-active').textContent = String(entries.filter(job => job.state === 'running').length);
  $('#stat-completed').textContent = String(entries.filter(job => job.state === 'completed').length);
  $('#stat-queued').textContent = String(entries.filter(job => job.state === 'queued').length);
}
function renderJob(job) {
  const fragment = template.content.cloneNode(true);
  const card = $('.job-row', fragment);
  card.dataset.jobId = job.id;
  let title = 'Media download';
  try {
    const url = new URL(job.url);
    title = url.hostname.replace(/^www\./, '') + decodeURI(url.pathname);
  } catch { /* A missing or malformed URL is rendered as generic text. */ }

  $('.job-icon', card).textContent = job.format === 'audio' ? '♫' : '▷';
  $('.job-id', card).textContent = 'TAPE #' + shortId(job.id);
  $('.job-date', card).textContent = formatDate(job.createdAt);
  $('.job-title', card).textContent = title.length > 105 ? title.slice(0, 102) + '…' : title;
  $('.job-format', card).textContent = String(job.format || '').toUpperCase() + ' / ' + String(job.quality || '');
  $('.job-stage', card).textContent = job.stage || job.state;
  $('.job-state', card).textContent = job.state;
  $('.job-state', card).dataset.state = job.state;
  const progress = Math.max(0, Math.min(100, Number(job.progress) || 0));
  $('.progress-fill', card).style.width = progress + '%';
  $('.progress-track', card).setAttribute('aria-valuenow', String(progress));
  $('.job-percent', card).textContent = progress + '%';
  $('.job-error', card).textContent = job.error || '';

  const cancel = $('.job-cancel', card);
  const remove = $('.job-remove', card);
  cancel.hidden = !['queued', 'running'].includes(job.state);
  remove.hidden = !['completed', 'failed', 'cancelled'].includes(job.state);
  cancel.addEventListener('click', () => jobAction(job.id, 'cancel', cancel));
  remove.addEventListener('click', () => jobAction(job.id, 'remove', remove));
  cancel.setAttribute('aria-label', 'Cancel job ' + shortId(job.id));
  remove.setAttribute('aria-label', 'Delete job ' + shortId(job.id) + ' and its files');

  const downloads = $('.job-files', card);
  for (const file of job.files || []) {
    const link = node('a', 'file-link', '↓ GET FILE · ' + file.name + ' (' + formatBytes(file.size) + ')');
    link.href = '/api/jobs/' + encodeURIComponent(job.id) + '/files/' + encodeURIComponent(file.id);
    link.download = file.name;
    downloads.append(link);
  }
  return card;
}
function emptyState() {
  const empty = node('div', 'empty-state');
  empty.append(
    node('span', 'empty-art', '✳'),
    node('h3', null, activeFilter === 'all' && !searchTerm ? 'Your collection starts here.' : 'No tapes found.'),
    node('p', null, activeFilter === 'all' && !searchTerm
      ? 'Paste your first authorized media link above to fill your shelf.'
      : 'Try a different search or change the library filter.')
  );
  if (activeFilter === 'all' && !searchTerm) {
    const link = node('a', null, "LET'S GO ↗");
    link.href = '#download-deck';
    empty.append(link);
  }
  return empty;
}
function render() {
  const entries = [...jobs.values()]
    .filter(matches)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const fragment = document.createDocumentFragment();
  if (!entries.length) fragment.append(emptyState());
  else entries.forEach(job => fragment.append(renderJob(job)));
  library.replaceChildren(fragment);
  updateStats();
}
async function refresh() {
  const { jobs: latest } = await request('/api/jobs');
  jobs.clear();
  latest.forEach(job => jobs.set(job.id, job));
  render();
}
async function jobAction(id, command, button) {
  button.disabled = true;
  try {
    if (command === 'cancel') {
      const { job } = await request('/api/jobs/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
      jobs.set(id, job);
      setFeedback('Job stopped. The worker may need a moment to shut down.');
    } else {
      await request('/api/jobs/' + encodeURIComponent(id), { method: 'DELETE' });
      jobs.delete(id);
      setFeedback('Tape removed from your local library.');
    }
    render();
  } catch (error) {
    button.disabled = false;
    setFeedback(error.message, true);
  }
}
function setFilter(value) {
  activeFilter = value;
  $$('.job-filter').forEach(button => {
    const active = button.dataset.state === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  render();
}

$$('input[name="format-choice"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if (radio.checked) $('#format').value = radio.value;
  });
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#submit-button');
  const selected = $('input[name="format-choice"]:checked');
  const requestData = {
    url: $('#media-url').value.trim(),
    format: selected?.value || $('#format').value,
    quality: $('#quality').value
  };
  button.disabled = true;
  setFeedback('Putting your request on the deck…');
  try {
    const { job } = await request('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(requestData)
    });
    jobs.set(job.id, job);
    setFilter('all');
    searchTerm = '';
    $('#job-search').value = '';
    setFeedback('Your tape is in the queue! Follow its progress below.');
    form.reset();
    $('#format').value = 'audio';
    $('#media-url').focus();
  } catch (error) {
    setFeedback(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('#paste-button').addEventListener('click', async () => {
  try {
    const copied = await navigator.clipboard.readText();
    if (!copied.trim()) {
      setFeedback('Your clipboard is empty.', true);
      return;
    }
    $('#media-url').value = copied.trim();
    $('#media-url').focus();
    setFeedback('Link pasted. Choose your format and go!');
  } catch {
    $('#media-url').focus();
    setFeedback('Clipboard access is unavailable. Paste a link into the field manually.');
  }
});

$$('.job-filter').forEach(button => {
  button.addEventListener('click', () => setFilter(button.dataset.state));
});
$('#job-search').addEventListener('input', event => {
  searchTerm = event.target.value.trim().toLowerCase();
  render();
});
$('#refresh-button').addEventListener('click', () => {
  refresh().then(() => setFeedback('Shelf updated.'))
    .catch(error => setFeedback(error.message, true));
});
function connectEvents() {
  if (!('EventSource' in window)) return;
  eventStream = new EventSource('/api/events');
  eventStream.addEventListener('job', event => {
    try {
      const job = JSON.parse(event.data);
      jobs.set(job.id, job);
      render();
    } catch { /* Ignore malformed updates. */ }
  });
  eventStream.addEventListener('removed', event => {
    try { jobs.delete(JSON.parse(event.data).id); render(); }
    catch { /* Ignore malformed updates. */ }
  });
}
function theme(value) {
  document.documentElement.dataset.theme = value;
  $('#theme-toggle').textContent = value === 'light' ? '☾' : '☀';
  $('#theme-toggle').setAttribute('aria-label', value === 'light' ? 'Switch to night theme' : 'Switch to day theme');
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = value === 'light' ? '#f6f3eb' : '#152338';
}
const preferenceKey = 'mediadock-tape-theme';
let saved = 'light';
try { saved = localStorage.getItem(preferenceKey) === 'dark' ? 'dark' : 'light'; } catch {}
theme(saved);
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  theme(next);
  try { localStorage.setItem(preferenceKey, next); } catch {}
});
$('#year').textContent = String(new Date().getFullYear());
refresh().then(connectEvents)
  .catch(error => setFeedback('The local server is unavailable: ' + error.message, true));
setInterval(() => {
  if (!document.hidden) refresh().catch(() => {});
}, 30_000);
window.addEventListener('pagehide', () => eventStream?.close());
