'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
const html = read('index.html');
const css = read('style.css');
const js = read('app.js');

test('Tape Lab contains all controls required by the download API client', () => {
  const ids = [
    'download-form','media-url','format','quality','submit-button','feedback',
    'job-list','job-template','job-search','paste-button','refresh-button',
    'stat-total','stat-active','stat-completed','stat-queued','theme-toggle','year'
  ];
  for (const id of ids) {
    assert.match(html, new RegExp('id="' + id + '"'), 'Missing #' + id);
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, 'Duplicate #' + id);
  }
});
test('Tape Lab uses working audio/video radio controls and preserves server formats', () => {
  assert.match(html, /name="format-choice" type="radio" value="audio" checked/);
  assert.match(html, /name="format-choice" type="radio" value="video"/);
  for (const quality of ['best', 'balanced', 'small']) {
    assert.ok(html.includes('value="' + quality + '"'));
  }
  assert.match(js, /radio\.addEventListener\('change'/);
  assert.match(js, /querySelectorAll|querySelector/);
});
test('Library retains accessible filters, progress display and file controls', () => {
  for (const filter of ['all', 'running', 'completed', 'failed']) {
    assert.ok(html.includes('data-state="' + filter + '"'), 'Missing filter: ' + filter);
  }
  for (const selector of ['job-row','job-id','job-title','job-stage','job-files','job-cancel','job-remove','progress-track']) {
    assert.ok(html.includes('class="' + selector + '"') || html.includes('class="' + selector + ' '), 'Missing template part ' + selector);
  }
  assert.match(html, /aria-valuenow="0"/);
  assert.match(js, /setAttribute\('aria-valuenow'/);
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /innerHTML\s*=/);
});
test('Responsive artwork and reduced motion support are present', () => {
  for (const token of ['cassette','spool-left','spool-right','hero-illustration','record-button','format-choice']) {
    assert.ok(html.includes(token) || css.includes(token));
  }
  assert.match(css, /@media\(max-width:540px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /#294fe9/i);
  assert.match(css, /#f7da87/i);
  assert.match(js, /mediadock-tape-theme/);
});
test('Primary navigation points to valid section anchors and keeps a local-only API', () => {
  for (const anchor of ['studio', 'download-deck', 'library', 'about', 'main']) {
    assert.ok(html.includes('id="' + anchor + '"'));
  }
  assert.match(js, /request\('\/api\/jobs'/);
  assert.match(js, /new EventSource\('\/api\/events'\)/);
  assert.doesNotMatch(html, /<script[^>]*src="https:/);
});
