# Universal Download Manager — Browser Extension

Automatically forwards browser downloads to the app's Download Manager. **Zero configuration** — just install and it works.

## Install (Chrome / Edge / Brave)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the folder: `browser-extension/universal-download-capture`.
5. Done! The extension badge will show **ON** when connected to the app.

## How It Works

- The app runs a local bridge server on `127.0.0.1:38945`.
- The extension automatically detects the bridge — no token or URL needed.
- When you download anything in the browser, the extension intercepts it, cancels the browser download, and sends it to the app instead.
- A green **ON** badge means everything is connected. A red **!** means the app isn't running.

## Popup Controls

- **Auto-capture downloads**: Toggle automatic interception on/off.
- **Capture all file types**: When on, captures everything. When off, only captures media, archives, documents, and executables.
- **Send Current Page to App**: Manually send the current tab's URL to the app's download queue.
- **Reset Stats**: Clear the captured/failed counters.

## Context Menu

Right-click any link, media, or page to send it to the app via:
- *Download with Universal Manager*
- *Download media with Universal Manager*
- *Send page URL to Universal Manager*
