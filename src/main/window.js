'use strict';

const { BrowserWindow, shell, screen } = require('electron');
const path = require('path');
const ctx = require('./ctx');
const paths = require('./paths');
const settings = require('./settings');
const log = require('./logger');
const { readJson, writeFileAtomic } = require('./util');

const BG = '#181715'; // matches the renderer canvas so there is never a white flash
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

function windowStateFile() { return paths.userData('window-state.json'); }

function loadBounds() {
    const saved = readJson(windowStateFile(), null);
    const base = { width: 1280, height: 820 };
    if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return base;
    const bounds = { width: Math.max(980, saved.width), height: Math.max(640, saved.height) };
    // Only restore the position if it is still on a connected display.
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const visible = screen.getAllDisplays().some((d) => {
            const a = d.workArea;
            return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width - 100 && saved.y < a.y + a.height - 100;
        });
        if (visible) { bounds.x = saved.x; bounds.y = saved.y; }
    }
    bounds.maximized = !!saved.maximized;
    return bounds;
}

function saveBounds(win) {
    try {
        const maximized = win.isMaximized();
        const b = maximized ? (win.getNormalBounds ? win.getNormalBounds() : win.getBounds()) : win.getBounds();
        writeFileAtomic(windowStateFile(), JSON.stringify({ ...b, maximized }));
    } catch (_) { /* not critical */ }
}

function appIcon() {
    const { nativeImage } = require('electron');
    const candidates = [paths.resource('build', 'icon.png'), paths.appFile('build', 'icon.png')];
    for (const c of candidates) {
        try {
            const img = nativeImage.createFromPath(c);
            if (!img.isEmpty()) return img;
        } catch (_) { /* try next */ }
    }
    return undefined;
}

function chromeOptions() {
    if (isMac) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } };
    if (isWin) {
        return {
            titleBarStyle: 'hidden',
            titleBarOverlay: { color: BG, symbolColor: '#faf9f5', height: 52 }
        };
    }
    return {}; // Linux keeps the native frame: window managers differ too much to risk a custom one
}

function create({ startHidden = false } = {}) {
    ctx.state.reclaiming = false;
    const bounds = loadBounds();
    const win = new BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        minWidth: 980,
        minHeight: 640,
        title: paths.APP_TITLE,
        backgroundColor: BG,
        show: false,
        icon: appIcon(),
        ...chromeOptions(),
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'index.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true,
            spellcheck: false,
            autoplayPolicy: 'no-user-gesture-required'
        }
    });
    ctx.state.mainWindow = win;
    if (bounds.maximized) win.maximize();

    // Show as soon as the first frame is ready. The timer guarantees the window can never stay
    // invisible if the renderer is slow or fails to load: that was the "app won't open" failure mode.
    let shown = false;
    const reveal = () => {
        if (shown || win.isDestroyed()) return;
        shown = true;
        if (!startHidden) { win.show(); win.focus(); }
    };
    win.once('ready-to-show', reveal);
    setTimeout(reveal, 3500);

    win.webContents.on('did-finish-load', () => { ctx.state.rendererReady = true; });
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
        if (!isMainFrame || code === -3) return; // -3 = aborted by a newer navigation
        log.error('system', 'Renderer failed to load', { code, desc, url });
        setTimeout(() => { if (!win.isDestroyed()) win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')); }, 800);
        reveal();
    });
    win.webContents.on('render-process-gone', (_e, details) => {
        log.error('system', 'Renderer process exited', details);
        ctx.state.rendererReady = false;
        if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
    });

    // External links open in the user's browser, never inside the app window.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); }
    });

    // Hardening for the Surf browser <webview>: no preload, no node, fixed partition.
    win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        delete webPreferences.preload;
        delete webPreferences.preloadURL;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
        webPreferences.sandbox = true;
        if (params.partition !== 'persist:surf-web') event.preventDefault();
        if (params.src && !/^(https?:|about:blank)/i.test(params.src)) event.preventDefault();
    });

    win.on('close', (event) => {
        saveBounds(win);
        // Only hide to the tray when a tray icon really exists; otherwise closing must quit.
        const canHide = settings.get().minimizeToTray && ctx.state.tray && !ctx.state.tray.isDestroyed();
        if (canHide && !ctx.state.quitting && !ctx.state.installingUpdate && !ctx.state.reclaiming) {
            event.preventDefault();
            hide();
        }
    });
    win.on('closed', () => { ctx.state.mainWindow = null; ctx.state.rendererReady = false; ctx.state.rendererBusy = false; });

    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
    return win;
}

function hide() {
    const w = ctx.getWindow();
    if (!w) return;
    w.hide();
    if (!isMac) w.setSkipTaskbar(true);
    scheduleReclaim();
}

// ---------------------------------------------------------------- freeing memory while hidden
// A hidden window still keeps the renderer and GPU processes alive (100 MB or more). When the app is parked
// in the tray and nothing is running, closing the window returns that memory; showing the app recreates it.
let reclaimTimer = null;
const RECLAIM_AFTER_MS = Number(process.env.UFC_RECLAIM_MS) || 60 * 1000; // the env override is for tests

function cancelReclaim() {
    if (reclaimTimer) { clearTimeout(reclaimTimer); reclaimTimer = null; }
}

function isIdle() {
    if (ctx.state.rendererBusy) return false;
    try {
        if (require('./activity').count() > 0) return false;
        if (require('./features/dm').hasActivity()) return false;
    } catch (_) { /* a module that is not loaded has nothing running */ }
    return true;
}

function scheduleReclaim(delay = RECLAIM_AFTER_MS) {
    cancelReclaim();
    if (settings.get().reclaimMemory === false) return;
    reclaimTimer = setTimeout(() => {
        reclaimTimer = null;
        const w = ctx.getWindow();
        if (!w || w.isVisible() || ctx.state.quitting) return;
        if (!isIdle()) { scheduleReclaim(Math.min(30 * 1000, RECLAIM_AFTER_MS)); return; }
        ctx.state.reclaiming = true;
        log.info('system', 'Closed the hidden window to free memory');
        w.close();
    }, delay);
}

/** Bring the window forward, recreating it if it was closed. This is what makes a second launch always work. */
function showOrCreate() {
    cancelReclaim();
    let w = ctx.getWindow();
    if (!w) w = create();
    if (w.isMinimized()) w.restore();
    w.setSkipTaskbar(false);
    w.show();
    w.focus();
    return w;
}

module.exports = { create, hide, showOrCreate, appIcon, BG };
