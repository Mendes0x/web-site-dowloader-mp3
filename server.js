'use strict';

const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const { DownloadQueue } = require('./src/queue');
const { createRunner } = require('./src/runner');
const { validateRequest, ClientError } = require('./src/validation');

const ROOT = path.join(__dirname, 'downloads');
const STATIC = path.join(__dirname, 'public');

function createApp({ queue = new DownloadQueue({ runner: createRunner(), root: ROOT }) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) {
      return res.status(403).json({ error: 'This application only accepts loopback hosts.' });
    }
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    });
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.use(express.static(STATIC, { index: 'index.html', dotfiles: 'deny' }));

  // No cookie-based auth: the only supported usage is a loopback-bound desktop service.
  // This non-simple request header and same-origin check protect mutation endpoints
  // against cross-origin form submissions and common browser-based CSRF.
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.get('X-MediaDock-Request') !== '1') {
        return res.status(403).json({ error: 'Request verification header missing.' });
      }
      const origin = req.get('Origin');
      if (origin) {
        try {
          const expected = new URL('http://' + req.headers.host);
          const actual = new URL(origin);
          if (actual.origin !== expected.origin) {
            return res.status(403).json({ error: 'Cross-origin requests are not accepted.' });
          }
        } catch {
          return res.status(403).json({ error: 'Invalid origin.' });
        }
      }
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ name: 'MediaDock', version: '2.0.0', ok: true });
  });

  app.get('/api/jobs', (_req, res) => {
    res.json({ jobs: queue.list(), stats: queue.stats() });
  });

  app.post('/api/jobs', (req, res, next) => {
    try {
      const input = validateRequest(req.body);
      const job = queue.submit(input);
      res.status(202).json({ job });
    } catch (error) { next(error); }
  });

  app.get('/api/jobs/:id', (req, res) => {
    const job = queue.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    res.json({ job: queue.view(job) });
  });

  app.post('/api/jobs/:id/cancel', (req, res, next) => {
    try {
      res.json({ job: queue.cancel(req.params.id) });
    } catch (error) { next(error); }
  });

  app.delete('/api/jobs/:id', async (req, res, next) => {
    try {
      await queue.remove(req.params.id);
      res.status(204).end();
    } catch (error) { next(error); }
  });

  // SSE: server pushes updates instead of clients repeatedly polling all jobs.
  app.get('/api/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'Cache-Control': 'no-store, no-transform'
    });
    res.flushHeaders();
    res.write(': connected\n\n');
    const onChange = job => res.write('event: job\ndata: ' + JSON.stringify(job) + '\n\n');
    const onRemoved = id => res.write('event: removed\ndata: ' + JSON.stringify({ id }) + '\n\n');
    queue.on('change', onChange);
    queue.on('removed', onRemoved);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      queue.off('change', onChange);
      queue.off('removed', onRemoved);
    });
  });

  app.get('/api/jobs/:id/files/:fileId', async (req, res, next) => {
    try {
      const job = queue.get(req.params.id);
      if (!job || job.state !== 'completed') {
        throw new ClientError('Completed job not found.', 404);
      }
      const file = job.files.find(item => item.id === req.params.fileId);
      if (!file || path.basename(file.name) !== file.name) {
        throw new ClientError('File not found.', 404);
      }
      const full = path.join(job.dir, file.name);
      const handle = await fs.open(full, fssync.constants.O_RDONLY | (fssync.constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile()) {
        await handle.close();
        throw new ClientError('Not a regular file.', 404);
      }
      res.attachment(file.name);
      res.set('Content-Length', String(stat.size));
      const stream = handle.createReadStream({ autoClose: true });
      stream.on('error', error => {
        if (!res.headersSent) next(error);
        else res.destroy(error);
      });
      stream.pipe(res);
    } catch (error) { next(error); }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof SyntaxError && error.status === 400) {
      return res.status(400).json({ error: 'Invalid JSON request.' });
    }
    const code = Number.isInteger(error.status) ? error.status : 500;
    if (code >= 500) console.error('[MediaDock]', error.message);
    res.status(code).json({ error: code >= 500 ? 'Unexpected server error.' : error.message });
  });

  return { app, queue };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exit(1);
  }
  fs.mkdir(ROOT, { recursive: true, mode: 0o700 })
    .then(() => {
      const { app, queue } = createApp();
      const server = app.listen(port, '127.0.0.1', () => {
        console.log('MediaDock 2.0 — http://127.0.0.1:' + port);
        console.log('Local-only mode. Downloads: ' + ROOT);
      });
      const shutdown = () => {
        queue.stop();
        server.close();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { createApp };
