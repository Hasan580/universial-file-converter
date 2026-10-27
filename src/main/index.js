'use strict';

const { app } = require('electron');
const paths = require('./paths');

// The data folder and the single-instance lock are both keyed on this path, so pin it first.
paths.pinUserData();

const ctx = require('./ctx');
const settings = require('./settings');
const log = require('./logger');

// A crash in one feature must never take the whole app (or its window) down silently.
process.on('uncaughtException', (err) => { try { log.error('system', `Uncaught exception: ${err && err.stack || err}`); } catch (_) { console.error(err); } });
process.on('unhandledRejection', (reason) => { try { log.error('system', `Unhandled rejection: ${reason && reason.stack || reason}`); } catch (_) { console.error(reason); } });

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Ubuntu 23.10+ blocks the unprivileged user namespaces Chromium's sandbox needs, so an AppImage (which cannot ship
// a setuid helper) would not start there at all. The .deb installs the helper and keeps the sandbox.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');

if (!app.requestSingleInstanceLock()) {
    // Another copy already owns the app. It receives `second-instance` and brings its window forward.
    app.quit();
} else {
    main();
}

function main() {
    const win = require('./window');
    const tray = require('./tray');
    const appIpc = require('./ipc/app');

    settings.load();

    // `UFC_SELFTEST=<report.json>` runs the packaged-build self-test instead of the app (used by CI and release checks).
    if (process.env.UFC_SELFTEST) {
        app.disableHardwareAcceleration();
        app.on('window-all-closed', (e) => e.preventDefault()); // the PDF path briefly uses a hidden window
        app.whenReady().then(() => { log.init(); return require('./selftest')(process.env.UFC_SELFTEST); }).catch(() => app.exit(2));
        return;
    }

    // Software rendering uses about half the memory of GPU rendering and is still smooth for this interface.
    if (!settings.get().gpuAcceleration) app.disableHardwareAcceleration();

    require('./features/stream').registerScheme();

    // A second launch (double-click while hidden in the tray, "Open with", the context menu) always
    // ends with a visible window: it recreates one if needed instead of silently doing nothing.
    app.on('second-instance', (_event, argv) => {
        win.showOrCreate();
        appIpc.queueFile(appIpc.fileFromArgv(argv));
    });

    app.on('activate', () => { win.showOrCreate(); });
    app.on('window-all-closed', () => {
        // With the tray enabled the app lives on with no window (hidden, or closed to save memory).
        if (settings.get().minimizeToTray && ctx.state.tray && !ctx.state.quitting) return;
        if (process.platform !== 'darwin') app.quit();
    });
    app.on('before-quit', () => { shutdown(); });
    app.on('will-quit', () => { shutdown(); });

    app.whenReady().then(async () => {
        log.init();
        log.info('system', `Uni Companion ${app.getVersion()} starting`, { platform: process.platform, arch: process.arch, electron: process.versions.electron });

        // Start hidden only when launched at login AND a tray icon really exists to bring the window back.
        const trayIcon = settings.get().minimizeToTray ? tray.create() : null;
        const startHidden = process.argv.includes('--hidden') && settings.get().launchAtStartup && !!trayIcon;
        win.create({ startHidden });                 // the window comes first, before any service starts
        require('./ipc').registerAll();
        require('./features/stream').registerProtocol();
        appIpc.queueFile(appIpc.fileFromArgv(process.argv));

        // Everything below runs after the window exists. Each step is isolated so one failure cannot affect another.
        setTimeout(deferredStartup, 1200);
    }).catch((err) => {
        log.error('system', `Startup failed: ${err && err.stack || err}`);
        try { require('electron').dialog.showErrorBox('Uni Companion could not start', String(err && err.message || err)); } catch (_) { /* nothing more to do */ }
        app.exit(1);
    });
}

function step(name, fn) {
    try {
        const r = fn();
        if (r && typeof r.catch === 'function') r.catch((err) => log.warning('system', `${name} failed: ${err.message}`));
    } catch (err) {
        log.warning('system', `${name} failed: ${err.message}`);
    }
}

function deferredStartup() {
    const bin = require('./binaries');
    bin.events.on('progress', (e) => ctx.send('engine-progress', e));

    step('ffmpeg encoder scan', () => require('./engines/ffmpeg').loadEncoders());
    step('download manager', () => require('./features/dm').init());
    step('auto organiser', () => require('./features/autoOrganizer').restore());
    step('update check', () => require('./updater').scheduleStartupCheck());
    step('explorer menu refresh', () => require('./ipc/app').refreshContextMenu());
    step('yt-dlp auto-update', () => {
        if (settings.get().ytdlpAutoUpdate === false) return null;
        const fs = require('fs');
        if (!fs.existsSync(bin.ytdlpFile())) return null; // installed lazily, the first time it is needed
        const stamp = paths.userData('ytdlp-checked.txt');
        let last = 0;
        try { last = Number(fs.readFileSync(stamp, 'utf8')) || 0; } catch (_) { /* never checked */ }
        if (Date.now() - last < 24 * 3600 * 1000) return null;
        return new Promise((resolve) => setTimeout(resolve, 20000)).then(async () => {
            const r = await bin.updateYtdlp();
            fs.writeFileSync(stamp, String(Date.now()));
            if (r.updated) log.info('download', `yt-dlp updated to ${r.version}`);
        });
    });
}

let shuttingDown = false;
function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.state.quitting = true;
    try { require('./jobs').cancelAll(); } catch (_) { /* nothing running */ }
    try { require('./features/dm').shutdown(); } catch (_) { /* not started */ }
    try { require('./features/autoOrganizer').stop(); } catch (_) { /* not started */ }
    try { require('./tray').destroy(); } catch (_) { /* no tray */ }
    try { require('./store').flushAll(); } catch (_) { /* nothing pending */ }
    try { settings.flush(); } catch (_) { /* nothing pending */ }
    try { log.flush(); } catch (_) { /* nothing pending */ }
}

