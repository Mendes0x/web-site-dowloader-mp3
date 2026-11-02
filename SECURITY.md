# Security Policy

MediaDock is a **local-only personal utility**. Do not expose its server to other users or the public Internet. There is no user authentication.

The app binds to loopback and validates the Host header, uses a same-origin check and a custom header for mutating requests, validates HTTPS source hosts, avoids shell interpolation, and serves only regular artifacts from a generated job directory.

**Limitations:** yt-dlp extractors may follow redirects and make additional requests. Domain validation is not an SSRF sandbox. A malicious local application may interact with the loopback API. Never download untrusted input on a privileged host. Keep Node.js, yt-dlp and FFmpeg updated.

To report a vulnerability, use a private GitHub security advisory if available. Do not publicly post working exploits, tokens, personal data or non-public URLs.
