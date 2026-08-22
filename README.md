# Universal File Converter 🚀

[![Release](https://img.shields.io/github/v/release/Hasan580/universial-file-converter?style=for-the-badge&color=8B5CF6)](https://github.com/Hasan580/universial-file-converter/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](https://github.com/Hasan580/universial-file-converter/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-brightgreen?style=for-the-badge)](https://github.com/Hasan580/universial-file-converter/releases)

> **Official Repository**: [https://github.com/Hasan580/universial-file-converter](https://github.com/Hasan580/universial-file-converter)  
> **Author / Maintainer**: [Hasan580](https://github.com/Hasan580)

**Universal File Converter** is a powerful, modern, privacy-first desktop application built with Electron, Node.js, FFmpeg, and Sharp. It offers an all-in-one suite supporting **86+ conversion formats** across Audio, Video, Images, and Documents, accompanied by an AI Hub, Media Downloader (yt-dlp), Built-in Media Player, Storage Duplicate Finder, and PDF Tools.

---

## 🌟 Key Features

### 🎵 1. Audio Converter (24 Formats)
- **Supported Formats**: `MP3`, `WAV`, `FLAC`, `AAC`, `M4A`, `ALAC` (Apple Lossless), `OGG`, `OPUS`, `WMA`, `AIFF`, `AC3`, `DTS`, `AMR`, `WavPack (WV)`, `APE`, `MKA`, `CAF`, `AU`, `VOC`, `RealAudio (RA)`, `MP2`, `OGA`, `TTA`, `Wave64 (W64)`, `Speex (SPX)`.
- **Advanced Controls**: Sample rates up to 192 kHz (Master Audio), Channels (Mono, Stereo, 5.1 & 7.1 Surround), Custom Bitrates (32k–320k), and EBU R128 (`loudnorm`) Volume Normalization.

### 🎬 2. Video Converter (26 Formats)
- **Supported Formats**: `MP4`, `WebM`, `MKV`, `HEVC (H.265)`, `AV1 (libsvtav1)`, `MOV`, `Apple ProRes (422/4444)`, `Avid DNxHD`, `AVI`, `WMV`, `FLV`, `MXF`, `TS`, `MTS`, `M2TS`, `M4V`, `3GP`, `MPEG-2`, `MPG`, `VOB`, `OGV`, `GIF` (High-Fidelity Two-Pass Palette), `APNG`, `SWF`, `DV`, `F4V`.
- **Quality & Presets**: Resolutions from 360p to **8K Full UHD**, Frame Rates from 24 FPS (Film) to 120 FPS, Codec Selection (AVC, HEVC, AV1, VP9, ProRes), and Bitrate controls up to 50 Mbps.

### 🖼️ 3. Image Converter (20 Formats)
- **Supported Formats**: `JPG`, `PNG`, `WebP`, `GIF`, `AVIF`, `TIFF`, `BMP`, `HEIC`, `HEIF`, `JXL` (JPEG XL), `JP2`, `ICO` (Multi-size icon binary generator), `SVG` (Vector tracing/wrapping), `TGA`, `HDR`, `EXR`, `PSD`, `PPM`, `WBMP`, `EPS`.
- **Transformation Tools**: DPI Density adjustment (72 to 600 DPI), Lossless Mode, Rotation (90°, 180°, 270°), Flip Vertical/Horizontal, Grayscale (B&W), and Custom Resizing.

### 📄 4. Document & PDF Converter (16 Formats)
- **Supported Formats**: `PDF`, `DOCX`, `TXT`, `HTML`, `CSV`, `XLSX`, `JSON`, `RTF`, `Markdown (MD)`, `XML`, `ODT`, `ODS`, `YAML`, `LaTeX (TEX)`, `TSV`, `EPUB`.
- **Integrated PDF Toolkit**: PDF Lock / Encrypt, Unlock / Decrypt, Merge PDF, Split PDF, Compress PDF, and OCR / Text Extraction.

### 🌐 5. Universal Downloader & AI Hub
- **yt-dlp Engine**: High-speed audio/video downloader supporting 1000+ streaming sites with format selection and auto-muxing.
- **AI Hub**: Built-in intelligent assistant powered by local/cloud AI models for document summarization, translation, transcription, and workflow assistance.
- **Media Player**: Modern audio & video player with queue management, visualizations, and mini-player.
- **Storage Organizer & Duplicate Finder**: Scan drives, identify duplicate files, detect large storage hogs, and organize directories.

---

## 🖥️ Cross-Platform Downloads

Pre-built binaries for **Windows**, **macOS**, and **Linux** are automatically built and released on GitHub:

👉 **[Download the Latest Release (v4.1.0)](https://github.com/Hasan580/universial-file-converter/releases)**

| OS | Format | Architecture |
|---|---|---|
| 🪟 **Windows** | `.exe` (NSIS Installer & Portable) | x64 |
| 🍎 **macOS** | `.dmg`, `.zip` | Universal (Intel & Apple Silicon arm64) |
| 🐧 **Linux** | `.AppImage`, `.deb` | x64 |

---

## 🛠️ Building & Running from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` or `yarn`
- Git

### Installation

```bash
# 1. Clone the official repository
git clone https://github.com/Hasan580/universial-file-converter.git

# 2. Enter the project directory
cd universial-file-converter

# 3. Install dependencies
npm install

# 4. Start the application in development mode
npm start
```

### Building Installers

```bash
# Build for Windows (NSIS installer & portable .exe)
npm run build:win

# Build for macOS (.dmg and .zip for arm64 & x64)
npm run build:mac

# Build for Linux (.AppImage and .deb)
npm run build:linux

# Build for all platforms (if running in cross-platform CI)
npm run build:all
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!  
Please see [CONTRIBUTING.md](.github/CONTRIBUTING.md) for details.

1. Fork the Project: `https://github.com/Hasan580/universial-file-converter`
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📜 License & Attribution Notice

This project is open-source software licensed under the **[MIT License](LICENSE)**.

### Attribution Requirement
When using, cloning, forking, embedding, or distributing this project or any derivative work, you must retain the original copyright notice and explicitly attribute the original repository:
> **Original Project**: [Hasan580/universial-file-converter](https://github.com/Hasan580/universial-file-converter)  
> **Copyright (c) 2026 Hasan580**
