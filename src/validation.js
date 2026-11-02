'use strict';

const HOSTS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'vimeo.com',
  'soundcloud.com',
  'bandcamp.com',
  'dailymotion.com',
  'tiktok.com'
];

function allowedHost(host) {
  return HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
}

function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ClientError('Provide a valid download request.');
  }
  if (typeof body.url !== 'string' || body.url.length > 2048) {
    throw new ClientError('Provide a media URL shorter than 2,048 characters.');
  }
  let parsed;
  try {
    parsed = new URL(body.url.trim());
  } catch {
    throw new ClientError('Enter a valid URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username || parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    !allowedHost(parsed.hostname.toLowerCase())
  ) {
    throw new ClientError('Only HTTPS links from supported media platforms are allowed.');
  }
  parsed.hash = '';
  const format = body.format ?? 'audio';
  const quality = body.quality ?? 'balanced';
  if (!['audio', 'video'].includes(format)) {
    throw new ClientError('Format must be audio or video.');
  }
  if (!['best', 'balanced', 'small'].includes(quality)) {
    throw new ClientError('Quality must be best, balanced or small.');
  }
  return { url: parsed.href, format, quality };
}

class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ClientError';
    this.status = status;
  }
}

module.exports = { validateRequest, ClientError, allowedHost, HOSTS };
