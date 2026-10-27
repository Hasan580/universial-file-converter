# Changelog

## 5.0.0

Renamed to **Uni Companion** (formerly Universal File Converter). New interface, rebuilt engine, self-repairing downloads, lower memory and size. See the [release notes](.github/release-notes.md) for the full list.

### Removed
- **Spotify**, **Books**, the built-in **Browser** and live **Wallpaper** are gone. The app is now about converting, downloading and tidying files. The music player stays and still plays YouTube and SoundCloud links.
- Settings that belonged to those modules are dropped from your profile the first time 5.0 starts. Your EPUB library folder is not touched.

### Fixed
- Word, PowerPoint and HTML to Markdown now work on every machine. They used to need the optional `markitdown` tool and failed with "Cannot convert Word to md" without it.

### Known issues
- Linux: the bundled ffmpeg cannot open MPEG-TS files (`.ts`, `.mts`, `.m2ts`) as input. Converting to those formats works.

### Licence
- Changed from MIT to the [Apache License 2.0](LICENSE) with a [NOTICE](NOTICE) file. Anyone who forks or redistributes the code must keep the NOTICE and credit the original project and its author. Versions up to 4.1.0 remain available under the licence they were published with.
- The About page now carries the credit: *Made with love by Hassan F.*

## 4.1.0 and earlier

Published as Universal File Converter. See the [releases page](https://github.com/Hasan580/universial-file-converter/releases).
