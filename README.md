# MediaDock

**A private, local-first media download studio.** MediaDock transforms the original single-endpoint downloader into a responsive Node.js application with a bounded queue, live progress, controls, and a file library.

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white) ![CI](https://github.com/renegadothedev/web-site-dowloader-mp3/actions/workflows/ci.yml/badge.svg) ![MIT](https://img.shields.io/badge/License-MIT-cb455f)

> Download only content you own or have permission to save. Respect copyrights, creator preferences, and platform terms. MediaDock does not bypass DRM or access controls.

## Highlights

- **Modern interface** with responsive dark/light theme, accessible controls and an activity dashboard.
- **Background jobs** with queueing (2 simultaneous workers, 20 pending jobs), status, cancellation, and history.
- **Live events** via Server-Sent Events, with a periodic synchronization fallback.
- **File library** for finished MP3/video output and removal of old jobs.
- **Modern yt-dlp CLI + FFmpeg** integration with quality presets, retry and timeout settings; no obsolete youtube-dl wrapper.
- **Safer local server:** loopback binding, host and origin protections, request validation, fixed job directories, HTTPS platform allowlist, no disabled TLS verification.
- **Automated test suite** using Node's built-in test runner, with GitHub Actions on pull requests and pushes.

## Requirements

- Node.js 20+ (22 recommended)
- npm
- Python 3 as required by some yt-dlp versions
- FFmpeg and FFprobe on PATH for audio conversion and video merging
- Internet connectivity for permitted media sources

Install the standalone yt-dlp executable separately and ensure `yt-dlp --version` works in your terminal. MediaDock intentionally invokes the system yt-dlp without a shell instead of shipping an old youtube-dl wrapper.

## Quick start

```bash
git clone https://github.com/renegadothedev/web-site-dowloader-mp3.git
cd web-site-dowloader-mp3
npm ci
# Install the latest yt-dlp and FFmpeg separately, then verify them:
yt-dlp --version
ffmpeg -version
npm start
```

Open **http://127.0.0.1:3000**.

```bash
npm run dev    # restart on changes
npm run check  # JS syntax checks + tests
npm run doctor # Dependency diagnostics
npm test       # tests only
```

The server intentionally binds to **127.0.0.1**. Do not expose it to the Internet via a reverse proxy, port forwarding, Docker host mapping, or a cloud deployment: it has no user authentication.

## Supported sources

YouTube, Vimeo, SoundCloud, Bandcamp, Dailymotion, and TikTok HTTPS links are allowed by hostname. Whether media can be downloaded depends on extractor support, availability, permissions and platform rules. This allowlist is **not** a complete sandbox for every network request yt-dlp might make.

## Workflow

1. Paste an authorized media URL.
2. Select audio (MP3) or video and the output quality.
3. Submit a job. Watch live progress and processing stage.
4. Download completed files through the library.
5. Cancel pending/running jobs or delete old completed entries.

Files are stored in private subdirectories under `downloads/<job-id>/`, not arbitrary paths supplied by browser clients. Jobs are held in memory; on restart the job list resets, while previously downloaded files remain on disk until deleted manually. Cancelling an active subprocess may take a moment.

## Architecture

```text
server.js                Express API, loopback policies, event stream, file downloads
src/validation.js        Request validation and allowed hostnames
src/queue.js             Job states, limits, cancellation, events
src/runner.js            yt-dlp worker and output discovery
public/index.html        Accessible UI
public/style.css         Responsive dark/light styles
public/app.js            Browser state, events and actions
tests/                   Unit + local API integration tests
.github/workflows/ci.yml Node 20/22 CI
downloads/               Generated media (ignored by Git)
```

Job state transitions: `queued → running → completed`, or `queued/running → cancelled`; failed attempts become `failed`.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Service status |
| GET | `/api/jobs` | All current jobs and counts |
| POST | `/api/jobs` | Queue a download |
| GET | `/api/jobs/:id` | Individual status |
| POST | `/api/jobs/:id/cancel` | Cancel |
| DELETE | `/api/jobs/:id` | Delete a terminal job and its files |
| GET | `/api/jobs/:id/files/:fileId` | Fetch an output artifact |
| GET | `/api/events` | Live SSE: `job` and `removed` |

Mutation endpoints require the request header `X-MediaDock-Request: 1`, and enforce same-origin rules.

Example:

```bash
curl -X POST http://127.0.0.1:3000/api/jobs \
  -H 'Content-Type: application/json' \
  -H 'X-MediaDock-Request: 1' \
  -d '{"url":"https://www.youtube.com/watch?v=YOUR_ALLOWED_VIDEO","format":"audio","quality":"balanced"}'
```

## Security & caveats

- No anonymous remote access: intended for personal use on the same trusted computer.
- yt-dlp can follow redirects or request additional provider hosts; HTTPS hostname validation alone does **not** fully eliminate SSRF.
- No configurable arbitrary output directories; artifacts use generated UUID folders.
- The server never interpolates download URLs into shell commands.
- There is no DRM bypass, VPN, proxy or privacy anonymity guarantee.
- FFmpeg is required for conversion or stream merging.
- yt-dlp's file-size limits may be approximate if a provider does not provide reliable metadata.
- No persistent database, user accounts or cloud synchronization in this release.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE).

Built by [renegadothedev](https://github.com/renegadothedev).
