## Uni Companion 5.0

**Universal File Converter is now Uni Companion.** A new look, a rebuilt engine, downloads that repair themselves, and a lighter app. Existing installs update in place and keep their settings and history.

> Made with love by Hassan F. Open source under the Apache License 2.0.

### Heads-up: four modules are gone
**Spotify, Books, the built-in Browser and live Wallpaper have been removed.** Uni Companion now does what its name says: convert, download, organise. The music player stays and still plays YouTube and SoundCloud links. Settings for the removed modules are dropped on first launch; your other settings, history and EPUB folder are kept. If you rely on one of them, stay on [4.1.0](https://github.com/Hasan580/universial-file-converter/releases/tag/v4.1.0).

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

### Open source
- The code is now under the **Apache License 2.0**. If you fork it or build on it, keep the `NOTICE` file and credit the original: *Uni Companion by Hassan F.*
- The browser extension for the download manager now lives in the repository as readable source: [`browser-extension/`](https://github.com/Hasan580/universial-file-converter/tree/main/browser-extension).

### Which file do I download?
| System | File |
|---|---|
| Windows 10 / 11 (64-bit) | `Uni-Companion-Setup-5.0.0.exe` (updates itself) or `Uni-Companion-Portable-5.0.0.exe` |
| macOS, Apple Silicon | `Uni-Companion-mac-5.0.0-arm64.dmg` |
| macOS, Intel | `Uni-Companion-mac-5.0.0-x64.dmg` |
| Linux (64-bit) | `Uni-Companion-linux-5.0.0-x86_64.AppImage` or `Uni-Companion-linux-5.0.0-amd64.deb` |

### Notes
- Windows shows a SmartScreen notice until the app is code-signed: choose **More info**, then **Run anyway**.
- macOS builds are not signed yet: right-click, Open. They check for updates but open the download page instead of installing.
- The `.deb` package also opens the download page for updates; the AppImage updates itself.

**Full changelog:** [CHANGELOG.md](https://github.com/Hasan580/universial-file-converter/blob/main/CHANGELOG.md)
