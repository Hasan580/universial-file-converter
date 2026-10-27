'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic, readJson } = require('./util');

const SETTINGS_VERSION = 5;

function defaults() {
    return {
        settingsVersion: SETTINGS_VERSION,
        outputDirectory: app.getPath('downloads'),
        downloadDirectory: '',
        autoDeleteSource: false,
        showNotifications: true,
        playSounds: true,
        // Hiding to the tray is opt-in for fresh installs: closing the window really closes the app.
        minimizeToTray: false,
        // Memory. Off (the default) means software rendering, which uses about half the RAM.
        gpuAcceleration: null,
        // When the app is hidden in the tray and idle, close the window after a minute so Chromium gives its memory back.
        reclaimMemory: true,
        launchAtStartup: false,
        autoUpdate: true,
        // yt-dlp recovery
        ytdlpCookiesBrowser: '',
        ytdlpCookiesFile: '',
        ytdlpAutoUpdate: true,
        // AI hub
        geminiApiKey: '',
        geminiModel: 'gemini-2.0-flash',
        // Download manager / browser bridge
        dmAutoArrange: true,
        dmBridgeToken: '',
        // Modules the user switched off in Settings (kept key name from v4)
        hiddenFeatures: {}
    };
}

// Settings that belonged to modules that no longer exist (browser, live wallpaper, Widevine).
// Dropped on load so an upgraded profile stops carrying them.
const REMOVED_KEYS = ['surfBuiltInAdBlock', 'surfExtensions', 'liveWallpaper', 'enableWidevine'];

let filePath = null;
let data = null;
let writeTimer = null;
const listeners = new Set();

function load() {
    filePath = path.join(app.getPath('userData'), 'settings.json');
    const base = defaults();
    let stored = readJson(filePath, null);

    if (stored === null && fs.existsSync(filePath)) {
        // The file exists but does not parse: keep it for inspection and try the last good copy.
        try { fs.copyFileSync(filePath, `${filePath}.corrupt`); } catch (_) { /* ignore */ }
        stored = readJson(`${filePath}.bak`, null);
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};

    // Unknown keys written by older builds are preserved on purpose.
    data = { ...base, ...stored };
    const stale = REMOVED_KEYS.filter((key) => key in data);
    for (const key of stale) delete data[key];
    if (!data.hiddenFeatures || typeof data.hiddenFeatures !== 'object') data.hiddenFeatures = {};
    if (!data.outputDirectory) data.outputDirectory = base.outputDirectory;
    // v4 had light/sunset themes; v5 is dark only.
    delete data.theme;
    if (!data.dmBridgeToken) data.dmBridgeToken = crypto.randomBytes(24).toString('hex');
    if (data.settingsVersion !== SETTINGS_VERSION || stale.length) {
        data.settingsVersion = SETTINGS_VERSION;
        scheduleWrite();
    }
    return data;
}

function get() {
    if (!data) load();
    return data;
}

function writeNow() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (!data || !filePath) return;
    try {
        if (fs.existsSync(filePath)) {
            try { fs.copyFileSync(filePath, `${filePath}.bak`); } catch (_) { /* ignore */ }
        }
        writeFileAtomic(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Failed to save settings:', err.message);
    }
}

function scheduleWrite() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(writeNow, 200);
}

/** Merge a patch into the settings, persist it, and notify listeners. */
function update(patch = {}) {
    const current = get();
    const clean = { ...patch };
    delete clean.settingsVersion;
    delete clean.theme;
    for (const key of REMOVED_KEYS) delete clean[key];
    data = { ...current, ...clean };
    scheduleWrite();
    for (const fn of listeners) {
        try { fn(data, clean); } catch (_) { /* listener errors never block saving */ }
    }
    return data;
}

function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

module.exports = { load, get, update, onChange, flush: writeNow };
