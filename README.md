# Web Site Downloader MP3

Local project for downloading video or audio from a link through a web interface.

## How to Use

1. Install the dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open the browser at:

```text
http://localhost:3000
```

4. Paste the video or audio link, choose the format, and optionally enter a destination folder.

## What It Does

- `Audio` downloads only the audio and converts it to MP3.
- `Video` downloads the full video file.
- `Folder` is a relative folder inside `downloads/` where the file will be saved.

## Structure

- `server.js` - local Express server that processes the download.
- `public/index.html` - user interface for starting downloads.
- `downloads/` - default folder for saved files, created automatically.
- `.gitignore` - ignores dependencies and downloaded files.

## Notes

- The project uses `youtube-dl-exec`, which requires `youtube-dl` or `yt-dlp` to be available through the system or the dependency.
- The server must run locally for `index.html` to work correctly.
