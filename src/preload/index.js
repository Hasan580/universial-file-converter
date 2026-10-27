'use strict';

/**
 * The only bridge between the web UI and the main process. The UI gets `window.ufc` with three
 * generic calls, each restricted to an explicit allowlist of channels, so even a compromised page
 * cannot reach anything that was not deliberately exposed.
 *
 * The channel lists below are generated: run `node scripts/gen-preload.js` after adding a handler.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// <generated:channels>
const INVOKE = new Set([
    'add-log',
    'add-to-conversion-history',
    'ai-chat',
    'ai-clear-chat',
    'ai-has-key',
    'ai-set-gemini-key',
    'analyze-drive',
    'books-download-offline',
    'books-fetch-cover-data-url',
    'books-get-library',
    'books-get-library-folder',
    'books-get-online-links',
    'books-import-files',
    'books-read-epub-file',
    'books-search-offline',
    'books-search-online',
    'browse-folder',
    'cancel-conversion',
    'cancel-download',
    'cancel-storage-scan',
    'check-downloader-available',
    'check-for-updates',
    'clear-conversion-history',
    'clear-logs',
    'clear-temp-files',
    'compress-image',
    'convert-audio',
    'convert-document',
    'convert-image',
    'convert-video',
    'delete-storage-item',
    'dm-add-task',
    'dm-cancel-task',
    'dm-clear-finished',
    'dm-delete-task',
    'dm-get-auto-arrange',
    'dm-get-bridge-info',
    'dm-get-state',
    'dm-open-file',
    'dm-open-folder',
    'dm-pause-all',
    'dm-pause-task',
    'dm-reorder-task',
    'dm-resume-all',
    'dm-resume-task',
    'dm-retry-task',
    'dm-set-auto-arrange',
    'dm-set-max-concurrent',
    'dm-set-output-dir',
    'download-media',
    'download-update',
    'empty-recycle-bin',
    'engine-repair',
    'engine-status',
    'export-logs',
    'extract-audio',
    'extract-cover-art',
    'get-app-version',
    'get-auto-organizer-settings',
    'get-auto-update',
    'get-available-drives',
    'get-catalog',
    'get-context-menu',
    'get-conversion-history',
    'get-conversion-stats',
    'get-default-mappings',
    'get-env-variable',
    'get-file-info',
    'get-files-info',
    'get-folder-size',
    'get-folder-stats',
    'get-launch-at-startup',
    'get-logs',
    'get-memory',
    'get-output-directory',
    'get-play-sounds',
    'get-playlist-info',
    'get-recycle-bin-size',
    'get-release-notes',
    'get-remote-alerts',
    'get-settings',
    'get-stream-url',
    'get-update-mode',
    'get-user-path',
    'get-video-info',
    'image-info',
    'image-thumbnail',
    'import-playlist',
    'install-update',
    'list-output-files',
    'live-wallpaper-select-video',
    'live-wallpaper-start',
    'live-wallpaper-status',
    'live-wallpaper-stop',
    'lock-pdf',
    'merge-pdfs',
    'move-to-recycle-bin',
    'open-external-url',
    'open-in-explorer',
    'open-spotify-player',
    'organize-folder',
    'path-exists',
    'pdf-add-text',
    'preview-organization',
    'probe-media',
    'read-editable-document',
    'read-lrc-file',
    'read-pdf-text',
    'register-context-menu',
    'renderer-ready',
    'restart-app',
    'save-auto-organizer-settings',
    'save-conversion-stats',
    'save-editable-document',
    'save-pdf-text',
    'save-settings',
    'scan-qr-from-image',
    'search-files',
    'select-cookie-file',
    'select-files',
    'select-folder',
    'select-lrc-file',
    'select-organize-folder',
    'select-output-directory',
    'set-auto-update',
    'set-launch-at-startup',
    'set-play-sounds',
    'spotify-check-availability',
    'spotify-download',
    'spotify-download-lyrics',
    'spotify-get-metadata',
    'spotify-save-cover',
    'spotify-search',
    'start-auto-organizer',
    'stop-auto-organizer',
    'stream-search',
    'surf-init',
    'surf-install-store-extension',
    'surf-list-extensions',
    'surf-load-extension-folder',
    'surf-remove-extension',
    'surf-select-extension-folder',
    'unregister-context-menu',
    'update-libraries'
]);
const SEND = new Set([
    'open-file',
    'open-folder',
    'renderer-busy',
    'show-notification',
    'window-close',
    'window-maximize',
    'window-minimize'
]);
const EVENTS = new Set([
    'auto-organize-file',
    'context-menu-convert',
    'conversion-progress',
    'dm-state',
    'download-progress',
    'download-status',
    'engine-progress',
    'navigate',
    'organize-progress',
    'spotify-download-progress',
    'storage-scan-progress',
    'update-available',
    'update-download-progress',
    'update-downloaded',
    'update-status'
]);
// </generated:channels>

/** Errors cross IPC as plain messages; structured ones are encoded as `UFC_ERR:{json}` by the main process. */
function decode(err) {
    const raw = String((err && err.message) || err || 'Unknown error');
    const at = raw.indexOf('UFC_ERR:');
    if (at >= 0) {
        try {
            const info = JSON.parse(raw.slice(at + 8));
            const e = new Error(info.message || 'Failed');
            Object.assign(e, { kind: info.kind, detail: info.detail, attempts: info.attempts, cancelled: !!info.cancelled });
            return e;
        } catch (_) { /* fall through to the plain message */ }
    }
    return new Error(raw.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, ''));
}

contextBridge.exposeInMainWorld('ufc', {
    platform: process.platform,

    invoke(channel, ...args) {
        if (!INVOKE.has(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`));
        return ipcRenderer.invoke(channel, ...args).catch((err) => { throw decode(err); });
    },

    send(channel, ...args) {
        if (SEND.has(channel)) ipcRenderer.send(channel, ...args);
    },

    /** Subscribe to a main-process event. Returns an unsubscribe function. */
    on(channel, callback) {
        if (!EVENTS.has(channel) || typeof callback !== 'function') return () => {};
        const listener = (_event, data) => callback(data);
        ipcRenderer.on(channel, listener);
        return () => ipcRenderer.removeListener(channel, listener);
    },

    /** Dropped File objects no longer expose `.path`; this resolves the real path. */
    pathForFile(file) {
        try { return webUtils.getPathForFile(file); } catch (_) { return ''; }
    }
});
