'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ID = 'com.hassanf.universalconverter';
const APP_TITLE = 'Uni Companion';
// v4 and earlier stored everything under <appData>/universal-file-converter (the package name).
// It is pinned here so settings, history and logs survive the upgrade on every platform.
const DATA_DIR_NAME = 'universal-file-converter';

let pinned = false;

/** Must run before the single-instance lock: the lock is keyed on the userData path. */
function pinUserData() {
    if (pinned) return;
    pinned = true;
    // UFC_USER_DATA is for tests only, so they never touch a real profile.
    const userData = process.env.UFC_USER_DATA || path.join(app.getPath('appData'), DATA_DIR_NAME);
    fs.mkdirSync(userData, { recursive: true });
    app.setPath('userData', userData);
    if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
}

const userData = (...parts) => path.join(app.getPath('userData'), ...parts);

/** Folder for tools we download at runtime (yt-dlp, Deno, optional ffmpeg). */
function binDir() {
    const dir = userData('bin');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Resolve a bundled resource both in dev and in a packaged app. */
function resource(...parts) {
    const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
    return path.join(base, ...parts);
}

/** Path to a file shipped inside the asar archive (src/...). */
function appFile(...parts) {
    return path.join(__dirname, '..', '..', ...parts);
}

/** Native modules and binaries cannot run from inside an asar archive. */
function unpacked(p) {
    return p ? p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep) : p;
}

module.exports = {
    APP_ID,
    APP_TITLE,
    DATA_DIR_NAME,
    pinUserData,
    userData,
    binDir,
    resource,
    appFile,
    unpacked
};
