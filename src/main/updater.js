'use strict';

const { app, shell, net } = require('electron');
const ctx = require('./ctx');
const settings = require('./settings');
const log = require('./logger');

const REPO = 'Hasan580/universial-file-converter';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

let autoUpdater = null;
let wired = false;

function isNewer(next, current) {
    const parse = (v) => String(v || '').replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
    const a = parse(next); const b = parse(current);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
}

/**
 * 'auto'   : the app can download and install the update itself
 * 'manual' : the app can only tell you an update exists and open the download page
 */
function mode() {
    if (!app.isPackaged) return 'manual';
    if (process.platform === 'win32') return process.env.PORTABLE_EXECUTABLE_DIR ? 'manual' : 'auto';
    if (process.platform === 'linux') return process.env.APPIMAGE ? 'auto' : 'manual'; // .deb cannot self-update
    return 'manual'; // macOS builds are unsigned, so macOS refuses in-place updates
}

function load() {
    if (autoUpdater) return autoUpdater;
    try {
        ({ autoUpdater } = require('electron-updater'));
    } catch (err) {
        log.warning('system', 'electron-updater is unavailable', { error: err.message });
        return null;
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    return autoUpdater;
}

function wire() {
    if (wired) return;
    const u = load();
    if (!u) return;
    wired = true;
    const current = app.getVersion();
    u.on('checking-for-update', () => ctx.send('update-status', { status: 'checking' }));
    u.on('update-available', (info) => {
        if (info.version && isNewer(info.version, current)) {
            ctx.send('update-available', { version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes, mode: mode() });
        } else {
            ctx.send('update-status', { status: 'up-to-date', version: current });
        }
    });
    u.on('update-not-available', () => ctx.send('update-status', { status: 'up-to-date', version: current }));
    u.on('download-progress', (p) => ctx.send('update-download-progress', {
        percent: Math.round(p.percent), transferred: p.transferred, total: p.total, speed: p.bytesPerSecond
    }));
    u.on('update-downloaded', (info) => ctx.send('update-downloaded', { version: info.version }));
    u.on('error', (err) => {
        log.warning('system', 'Updater error', { error: err.message });
        ctx.send('update-status', { status: 'error', error: err.message });
    });
}

async function check() {
    if (!app.isPackaged) return { version: app.getVersion(), isNewer: false, mode: mode(), dev: true };
    wire();
    const u = load();
    if (!u) return { error: 'The updater is not available in this build.' };
    try {
        const result = await u.checkForUpdates();
        const next = result && result.updateInfo && result.updateInfo.version;
        const newer = !!(next && isNewer(next, app.getVersion()));
        return { version: newer ? next : app.getVersion(), isNewer: newer, mode: mode() };
    } catch (err) {
        return { error: err.message };
    }
}

async function download() {
    if (mode() !== 'auto') { shell.openExternal(RELEASES_URL); return { opened: true }; }
    wire();
    await load().downloadUpdate();
    return { downloaded: true };
}

/** Hand off to the installer. `prepare` makes sure the app really exits (no tray, no lingering windows). */
function install(prepare) {
    if (mode() !== 'auto') { shell.openExternal(RELEASES_URL); return { opened: true }; }
    ctx.state.installingUpdate = true;
    if (prepare) prepare();
    setImmediate(() => {
        load().quitAndInstall(true, true);
        // Helper processes can linger a moment; the installer waits for them, so make sure they go.
        setTimeout(() => { try { app.exit(0); } catch (_) { /* already gone */ } }, 4000);
    });
    return { installing: true };
}

async function releaseNotes() {
    try {
        const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases`, {
            headers: { 'User-Agent': `Uni-Companion/${app.getVersion()}`, Accept: 'application/vnd.github+json' }
        });
        if (!res.ok) return [];
        const releases = await res.json();
        return releases.filter((r) => !r.draft).slice(0, 10).map((r) => ({
            version: r.tag_name,
            name: r.name,
            body: r.body,
            date: r.published_at,
            prerelease: r.prerelease,
            url: r.html_url,
            assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url }))
        }));
    } catch (_) {
        return [];
    }
}

/** Quietly check shortly after startup so it never competes with first paint. */
function scheduleStartupCheck() {
    if (!settings.get().autoUpdate || !app.isPackaged) return;
    setTimeout(() => { check().catch(() => {}); }, 12000);
}

module.exports = { mode, check, download, install, releaseNotes, scheduleStartupCheck, isNewer, RELEASES_URL };
