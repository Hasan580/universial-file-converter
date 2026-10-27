'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic, readJson, clampNumber } = require('./util');

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
        // Memory. null = automatic: software rendering (about half the RAM) unless live wallpaper needs the GPU.
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
        // Surf
        surfBuiltInAdBlock: true,
        surfExtensions: [],
        // Live wallpaper (Windows only)
        liveWallpaper: {
            enabled: false,
            filePath: '',
            muted: true,
            volume: 40,
            loop: true,
            playbackRate: 1,
            fitMode: 'cover'
        },
        // Modules the user switched off in Settings (kept key name from v4)
        hiddenFeatures: {}
    };
}

function normalizeLiveWallpaper(input = {}) {
    const fit = String(input.fitMode || 'cover').toLowerCase();
    return {
        enabled: !!input.enabled,
        filePath: String(input.filePath || '').trim(),
        muted: input.muted !== undefined ? !!input.muted : true,
        volume: Math.round(clampNumber(input.volume, 0, 100, 40)),
        loop: input.loop !== undefined ? !!input.loop : true,
        playbackRate: clampNumber(input.playbackRate, 0.25, 3, 1),
        fitMode: ['cover', 'contain', 'fill'].includes(fit) ? fit : 'cover'
    };
}

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
    data.liveWallpaper = normalizeLiveWallpaper(data.liveWallpaper);
    if (!Array.isArray(data.surfExtensions)) data.surfExtensions = [];
    if (!data.hiddenFeatures || typeof data.hiddenFeatures !== 'object') data.hiddenFeatures = {};
    if (!data.outputDirectory) data.outputDirectory = base.outputDirectory;
    // v4 had light/sunset themes; v5 is dark only.
    delete data.theme;
    data.surfBuiltInAdBlock = true;
    if (!data.dmBridgeToken) data.dmBridgeToken = crypto.randomBytes(24).toString('hex');
    if (data.settingsVersion !== SETTINGS_VERSION) {
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
    data = { ...current, ...clean };
    if (clean.liveWallpaper) data.liveWallpaper = normalizeLiveWallpaper({ ...current.liveWallpaper, ...clean.liveWallpaper });
    if (!Array.isArray(data.surfExtensions)) data.surfExtensions = [];
    data.surfBuiltInAdBlock = true;
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

module.exports = { load, get, update, onChange, flush: writeNow, normalizeLiveWallpaper };
