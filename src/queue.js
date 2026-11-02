'use strict';

const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ClientError } = require('./validation');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

class DownloadQueue extends EventEmitter {
  constructor({ runner, root, concurrency = 2, maxJobs = 80, maxWaiting = 20 }) {
    super();
    if (typeof runner !== 'function') throw new Error('A download runner is required');
    this.runner = runner;
    this.root = path.resolve(root);
    this.concurrency = concurrency;
    this.maxJobs = maxJobs;
    this.maxWaiting = maxWaiting;
    this.jobs = new Map();
    this.active = 0;
    this.pending = [];
    this.closed = false;
  }

  view(job) {
    return {
      id: job.id,
      url: job.url,
      format: job.format,
      quality: job.quality,
      state: job.state,
      progress: job.progress,
      stage: job.stage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error,
      files: job.files.map(file => ({ id: file.id, name: file.name, size: file.size }))
    };
  }

  stats() {
    const jobs = [...this.jobs.values()];
    return {
      total: jobs.length,
      queued: jobs.filter(j => j.state === 'queued').length,
      active: jobs.filter(j => j.state === 'running').length,
      completed: jobs.filter(j => j.state === 'completed').length,
      failed: jobs.filter(j => j.state === 'failed').length
    };
  }

  list() {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(job => this.view(job));
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  publish(job) {
    job.updatedAt = new Date().toISOString();
    this.emit('change', this.view(job));
  }

  submit(input) {
    if (this.closed) throw new ClientError('Service is shutting down.', 503);
    if (this.pending.length >= this.maxWaiting) {
      throw new ClientError('The queue is full. Try again after a job finishes.', 429);
    }
    if (this.jobs.size >= this.maxJobs) {
      throw new ClientError('Too many saved jobs. Remove old jobs and try again.', 429);
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const job = {
      id, ...input, state: 'queued', progress: 0,
      stage: 'Waiting', files: [], error: null,
      createdAt: now, updatedAt: now,
      dir: path.join(this.root, id),
      controller: null
    };
    this.jobs.set(id, job);
    this.pending.push(id);
    this.publish(job);
    // Defer work to allow the API to respond before the runner emits updates.
    queueMicrotask(() => this.pump());
    return this.view(job);
  }

  pump() {
    while (!this.closed && this.active < this.concurrency && this.pending.length) {
      const id = this.pending.shift();
      const job = this.get(id);
      if (!job || job.state !== 'queued') continue;
      this.active++;
      job.state = 'running';
      job.stage = 'Preparing';
      job.controller = new AbortController();
      this.publish(job);
      this.execute(job).finally(() => {
        job.controller = null;
        this.active--;
        this.pump();
      });
    }
  }

  async execute(job) {
    try {
      const files = await this.runner(job, {
        signal: job.controller.signal,
        progress: (percentage, stage = 'Downloading') => {
          if (job.state !== 'running') return;
          const next = Math.round(Math.min(99, Math.max(0, Number(percentage) || 0)));
          if (next !== job.progress || stage !== job.stage) {
            job.progress = next;
            job.stage = stage;
            this.publish(job);
          }
        }
      });
      if (job.state === 'cancelled') return;
      job.state = 'completed';
      job.stage = 'Ready';
      job.progress = 100;
      job.files = files;
    } catch (error) {
      if (job.state === 'cancelled') return;
      job.state = 'failed';
      job.stage = 'Failed';
      job.error = error?.publicMessage || 'Unable to download this media. Check the link and required tools.';
    } finally {
      // Never keep partial downloads after a failed or cancelled attempt.
      if (job.state !== 'completed') {
        await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
      }
      this.publish(job);
    }
  }

  cancel(id) {
    const job = this.get(id);
    if (!job) throw new ClientError('Job not found.', 404);
    if (TERMINAL.has(job.state)) return this.view(job);
    job.state = 'cancelled';
    job.stage = 'Cancelled';
    job.error = null;
    if (job.controller) job.controller.abort();
    this.publish(job);
    return this.view(job);
  }

  async remove(id) {
    const job = this.get(id);
    if (!job) throw new ClientError('Job not found.', 404);
    if (!TERMINAL.has(job.state)) {
      throw new ClientError('Cancel the active job before removing it.', 409);
    }
    if (job.controller) {
      throw new ClientError('This worker is still stopping. Try again in a moment.', 409);
    }
    this.jobs.delete(id);
    this.pending = this.pending.filter(item => item !== id);
    await fs.rm(job.dir, { recursive: true, force: true });
    this.emit('removed', id);
  }

  stop() {
    this.closed = true;
    for (const job of this.jobs.values()) {
      if (!TERMINAL.has(job.state)) this.cancel(job.id);
    }
  }
}

module.exports = { DownloadQueue };
