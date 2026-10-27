## Uni Companion 5.0

**Universal File Converter is now Uni Companion.** A new interface and a rebuilt engine. Existing installs update in place and keep their settings and history.

### Focused
- **Spotify, Books, the built-in Browser and live Wallpaper have been removed.** Uni Companion now does what its name says: convert, download, organise. The music player stays and still plays YouTube and SoundCloud links. Settings for those modules are dropped on first launch; your other settings, history and EPUB folder are kept.
- Licence is now **Apache 2.0** with a NOTICE file: forks and redistributions must keep the credit to the original project and its author. The About page says *Made with love by Hassan F.*

### A new look
- Redesigned from scratch in a warm, dark editorial style: serif headlines, one coral accent, calm surfaces.
- Navigation moved from the side panel to the top bar with a second row of tabs.
- A proper loading screen, live progress in an activity panel, quick jump with **Ctrl/Cmd + K**.

### Downloads that fix themselves
- yt-dlp is managed per platform, kept up to date, and checked with a SHA-256 hash.
- When a download fails the app reads why and repairs it: switches YouTube client, installs the JavaScript helper YouTube now needs, uses your Firefox sign-in, updates yt-dlp, relaxes the format, backs off on rate limits. It shows what it is doing.
- Works on macOS and Linux (4.x only ever ran the Windows build of yt-dlp).

### Conversions you can trust
- Never overwrites a file. Converting `video.mp4` to MP4 in the same folder no longer fails.
- Real files for every format. 4.x wrote PNG data into files named `.bmp`, `.tga`, `.psd`; 5.0 writes the real thing, and only offers formats that work.
- Video keeps its aspect ratio (portrait clips are no longer squashed) and plays everywhere (`yuv420p`).
- Cover art and tags survive audio conversion. Transparent images flatten to white, not black.
- 80+ document conversions, each covered by an automated test. HEIC photos open.
- Newer, fuller ffmpeg (6.1) with proper progress, speed and time left, and clean cancel.

### Lighter and faster
- About 130 MB of memory when idle. About 85 MB when parked in the tray: the window closes itself when idle and reopens instantly. Software rendering is the default (smooth, and about 80 MB lighter); graphics acceleration is one switch away in Settings > Performance.
- A 138 MB installer, smaller than 4.1.0's 152 MB despite a much newer Electron and ffmpeg: no second ffprobe tool, no duplicate or unused libraries.
- First window in under 0.4 seconds.

### Reliability
- The app always shows a window. A second launch while it is hidden in the tray now brings it forward.
- Settings, history and logs are written atomically, so a crash or a forced close cannot corrupt them.
- Installer: no more long silent wait before the first window.
- Cross-platform: the storage analyser, drives, trash and start-at-login work on macOS and Linux too.

### Security
- The browser-extension download bridge only accepts the extension or a secret token (before, any website could queue downloads).
- The interface runs sandboxed and can reach only an explicit allow-list of functions.

### Notes
- macOS builds are not signed yet: right-click, Open. They check for updates but open the download page instead of installing.
- Windows shows a SmartScreen notice until the app is code-signed.
