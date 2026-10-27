'use strict';

const { app, dialog, shell, Notification, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { handle, on } = require('./handle');
const ctx = require('../ctx');
const paths = require('../paths');
const settings = require('../settings');
const log = require('../logger');
const store = require('../store');
const exts = require('../exts');
const tray = require('../tray');
const win = require('../window');
const updater = require('../updater');
const bin = require('../binaries');
const { formatBytes } = require('../util');

const pendingFiles = [];

/** The first existing file path on a command line (context-menu launches, "open with", second instances). */
function fileFromArgv(argv) {
    const args = argv.slice(app.isPackaged ? 1 : 2);
    for (const a of args) {
        if (!a || a.startsWith('-')) continue;
        try { if (fs.statSync(a).isFile()) return path.resolve(a); } catch (_) { /* not a file */ }
    }
    return null;
}

function queueFile(filePath) {
    if (!filePath) return;
    if (ctx.state.rendererReady && ctx.send('context-menu-convert', filePath)) return;
    pendingFiles.push(filePath);
}

// ------------------------------------------------------------------ launch at startup (per platform)

function autostartFile() { return path.join(os.homedir(), '.config', 'autostart', 'universal-file-converter.desktop'); }

function setStartup(enabled) {
    if (process.platform === 'linux') {
        const file = autostartFile();
        if (!enabled) { try { fs.unlinkSync(file); } catch (_) { /* nothing to remove */ } return true; }
        const exec = process.env.APPIMAGE || process.execPath;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=${paths.APP_TITLE}\nExec="${exec}" --hidden\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`);
        return true;
    }
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: app.getPath('exe'), args: enabled ? ['--hidden'] : [] });
    return true;
}

function getStartup() {
    if (process.platform === 'linux') return fs.existsSync(autostartFile());
    try { return app.getLoginItemSettings({ path: app.getPath('exe'), args: ['--hidden'] }).openAtLogin; } catch (_) { return !!settings.get().launchAtStartup; }
}

// ------------------------------------------------------------------ Windows Explorer context menu

const MENU_KEY = 'HKCU\\Software\\Classes\\*\\shell\\UniversalConverter';

function registerContextMenu() {
    if (process.platform !== 'win32') return { success: false, unsupported: true };
    const exe = process.execPath;
    const add = (key, name, data) => new Promise((resolve) => {
        const args = name ? ['add', key, '/v', name, '/d', data, '/f'] : ['add', key, '/ve', '/d', data, '/f'];
        execFile('reg.exe', args, { windowsHide: true }, (err) => resolve(!err));
    });
    return Promise.all([
        add(MENU_KEY, null, 'Convert with Uni Companion'),
        add(MENU_KEY, 'Icon', exe),
        add(`${MENU_KEY}\\command`, null, `"${exe}" "%1"`)
    ]).then((r) => ({ success: r.every(Boolean) }));
}

/** True when the Explorer entry exists. Read from the registry so the Settings switch is always truthful. */
function contextMenuRegistered() {
    if (process.platform !== 'win32') return Promise.resolve(false);
    return new Promise((resolve) => execFile('reg.exe', ['query', MENU_KEY], { windowsHide: true }, (err) => resolve(!err)));
}

/** If the entry exists, rewrite it so it carries the current label and the path of the installed exe. */
async function refreshContextMenu() {
    if (await contextMenuRegistered()) await registerContextMenu();
}

function unregisterContextMenu() {
    if (process.platform !== 'win32') return Promise.resolve({ success: false, unsupported: true });
    return new Promise((resolve) => execFile('reg.exe', ['delete', MENU_KEY, '/f'], { windowsHide: true }, () => resolve({ success: true })));
}

// ------------------------------------------------------------------ remote alerts

const ALERT_URLS = [
    'https://raw.githubusercontent.com/Hasan580/universial-file-converter/main/alerts.json',
    'https://cdn.jsdelivr.net/gh/Hasan580/universial-file-converter@main/alerts.json'
];

async function remoteAlerts() {
    for (const url of ALERT_URLS) {
        try {
            const ctl = new AbortController();
            const timer = setTimeout(() => ctl.abort(), 8000);
            const res = await net.fetch(url, { signal: ctl.signal, headers: { 'User-Agent': `Uni-Companion/${app.getVersion()}` } });
            clearTimeout(timer);
            if (!res.ok) continue;
            const data = JSON.parse(await res.text());
            if (data && Array.isArray(data.alerts) && data.alerts.length) return data.alerts;
        } catch (_) { /* try the next mirror */ }
    }
    return [];
}

// ------------------------------------------------------------------ cover art

async function coverArt(filePath) {
    const tmp = path.join(app.getPath('temp'), `ufc-cover-${Date.now()}.jpg`);
    return new Promise((resolve) => {
        execFile(bin.ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', filePath, '-an', '-frames:v', '1', '-vf', 'scale=600:-2', tmp],
            { timeout: 10000, windowsHide: true }, () => {
                try {
                    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 100) return resolve(null);
                    const data = fs.readFileSync(tmp).toString('base64');
                    fs.unlinkSync(tmp);
                    resolve(`data:image/jpeg;base64,${data}`);
                } catch (_) { resolve(null); }
            });
    });
}

function fileInfo(filePath) {
    const st = fs.statSync(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return { name: path.basename(filePath), path: filePath, size: st.size, extension: ext, type: st.isDirectory() ? 'folder' : exts.typeOf(ext), modified: st.mtime.toISOString() };
}

function register() {
    // ---- window
    on('window-minimize', () => ctx.getWindow() && ctx.getWindow().minimize());
    on('window-maximize', () => { const w = ctx.getWindow(); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()); });
    on('window-close', () => ctx.getWindow() && ctx.getWindow().close());

    handle('renderer-ready', () => {
        ctx.state.rendererReady = true;
        while (pendingFiles.length) ctx.send('context-menu-convert', pendingFiles.shift());
        return {
            version: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            packaged: app.isPackaged,
            updateMode: updater.mode(),
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node
        };
    });
    handle('get-app-version', () => app.getVersion());
    handle('get-user-path', (type) => { try { return app.getPath(type); } catch (_) { return null; } });

    // ---- dialogs
    handle('select-files', async (kind, options = {}) => {
        const filters = [...(exts.GROUPS[kind] || exts.GROUPS.any), { name: 'All files', extensions: ['*'] }];
        const r = await dialog.showOpenDialog(ctx.getWindow(), { properties: options.single ? ['openFile'] : ['openFile', 'multiSelections'], filters });
        return r.canceled ? [] : r.filePaths;
    });
    handle('select-output-directory', async () => {
        const r = await dialog.showOpenDialog(ctx.getWindow(), { properties: ['openDirectory', 'createDirectory'] });
        return r.canceled ? null : r.filePaths[0] || null;
    });
    handle('select-folder', async (title) => {
        const r = await dialog.showOpenDialog(ctx.getWindow(), { title: title || 'Select folder', properties: ['openDirectory'] });
        return r.canceled ? null : r.filePaths[0] || null;
    });
    handle('select-cookie-file', async () => {
        const r = await dialog.showOpenDialog(ctx.getWindow(), { title: 'Select cookies.txt', properties: ['openFile'], filters: [{ name: 'Cookies', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }] });
        return r.canceled ? null : r.filePaths[0] || null;
    });

    // ---- files
    handle('get-file-info', (p) => fileInfo(p));
    handle('get-files-info', (list) => (list || []).map((p) => { try { return fileInfo(p); } catch (_) { return null; } }).filter(Boolean));
    handle('path-exists', (p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
    handle('extract-cover-art', (p) => coverArt(p));
    handle('list-output-files', (section) => {
        const dir = settings.get().outputDirectory;
        if (!dir || !fs.existsSync(dir)) return { success: true, files: [] };
        try {
            let files = fs.readdirSync(dir).map((name) => {
                try {
                    const p = path.join(dir, name);
                    const st = fs.statSync(p);
                    if (st.isDirectory() || name.startsWith('.') || name.endsWith('.part')) return null;
                    const ext = path.extname(name).slice(1).toLowerCase();
                    return { name, path: p, size: st.size, extension: ext, type: exts.typeOf(ext), modifiedTime: st.mtime.toISOString() };
                } catch (_) { return null; }
            }).filter(Boolean);
            if (section && section !== 'all') files = files.filter((f) => f.type === section);
            files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
            return { success: true, files: files.slice(0, 500) };
        } catch (err) {
            return { success: false, error: err.message, files: [] };
        }
    });
    on('open-file', (p) => { if (p) shell.openPath(p); });
    on('open-folder', (p) => { if (p) shell.showItemInFolder(p); });
    handle('open-in-explorer', (p) => { if (p) { fs.statSync(p).isDirectory() ? shell.openPath(p) : shell.showItemInFolder(p); } });
    handle('open-external-url', async (url) => {
        if (url && /^(https?:|spotify:)/i.test(url)) await shell.openExternal(url);
    });
    on('show-notification', ({ title, body } = {}) => {
        if (settings.get().showNotifications && Notification.isSupported()) new Notification({ title, body, icon: win.appIcon() }).show();
    });
    handle('clear-temp-files', () => {
        let count = 0; let freed = 0;
        const dirs = [path.join(os.tmpdir(), 'Universal File Converter'), path.join(os.tmpdir(), 'Uni Companion')];
        for (const d of dirs) {
            try {
                for (const f of fs.readdirSync(d)) {
                    const p = path.join(d, f);
                    const st = fs.statSync(p);
                    if (st.isFile() && Date.now() - st.mtimeMs > 3600000) { freed += st.size; fs.unlinkSync(p); count += 1; }
                }
            } catch (_) { /* folder does not exist */ }
        }
        const out = settings.get().outputDirectory;
        try {
            for (const f of fs.readdirSync(out)) {
                const p = path.join(out, f);
                try {
                    const st = fs.statSync(p);
                    if (st.isDirectory() && f.startsWith('.ufc-')) { fs.rmSync(p, { recursive: true, force: true }); count += 1; }
                    else if (st.isFile() && f.endsWith('.part') && Date.now() - st.mtimeMs > 3600000) { freed += st.size; fs.unlinkSync(p); count += 1; }
                } catch (_) { /* in use */ }
            }
        } catch (_) { /* output folder missing */ }
        log.info('system', `Cleared ${count} temporary files (${formatBytes(freed)})`);
        return { success: true, count, freedSpace: freed };
    });

    // ---- settings
    // Secrets never go to the page: the key is replaced by a flag, and the bridge token has its own call.
    const publicSettings = () => {
        const { geminiApiKey, dmBridgeToken: _token, ...rest } = settings.get();
        return { ...rest, geminiKeySet: !!geminiApiKey };
    };
    // The Settings switch shows what is really in effect, not the raw "automatic" value.
    const gpuEffective = () => { const s = settings.get(); return s.gpuAcceleration === null || s.gpuAcceleration === undefined ? !!(s.liveWallpaper && s.liveWallpaper.enabled) : !!s.gpuAcceleration; };
    handle('get-settings', () => ({ ...publicSettings(), gpuAcceleration: gpuEffective() }));
    handle('get-memory', () => {
        const procs = app.getAppMetrics();
        const kb = procs.reduce((sum, p) => sum + (p.memory.privateBytes || p.memory.workingSetSize || 0), 0);
        return { megabytes: Math.round(kb / 1024), processes: procs.length };
    });
    handle('restart-app', () => { ctx.state.quitting = true; app.relaunch(); app.exit(0); });
    on('renderer-busy', (busy) => { ctx.state.rendererBusy = !!busy; });
    handle('get-output-directory', () => settings.get().outputDirectory);
    handle('save-settings', (patch) => {
        const clean = { ...(patch || {}) };
        delete clean.geminiApiKey; delete clean.dmBridgeToken; delete clean.geminiKeySet; // changed only through their own calls
        const before = settings.get().minimizeToTray;
        const next = settings.update(clean);
        if (before !== next.minimizeToTray) { if (next.minimizeToTray) tray.create(); else tray.destroy(); }
        return { ...publicSettings(), gpuAcceleration: gpuEffective() };
    });
    handle('set-launch-at-startup', (enabled) => {
        try { setStartup(enabled); settings.update({ launchAtStartup: !!enabled }); return true; } catch (err) { log.warning('system', 'Could not change launch at startup', { error: err.message }); return false; }
    });
    handle('get-launch-at-startup', () => getStartup());
    handle('get-context-menu', () => contextMenuRegistered());
    handle('register-context-menu', () => registerContextMenu());
    handle('unregister-context-menu', () => unregisterContextMenu());
    handle('get-play-sounds', () => settings.get().playSounds !== false);
    handle('set-play-sounds', (enabled) => { settings.update({ playSounds: !!enabled }); return true; });

    // ---- logs, history, stats
    handle('get-logs', (filter) => log.getLogs(filter || {}));
    handle('add-log', ({ type, category, message, details } = {}) => log.log(type || 'info', category || 'ui', message || '', details || null));
    handle('clear-logs', () => { log.clear(); return true; });
    handle('export-logs', async () => {
        const r = await dialog.showSaveDialog(ctx.getWindow(), { title: 'Export logs', defaultPath: 'uni-companion-logs.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
        return !r.canceled && r.filePath && log.exportTo(r.filePath) ? r.filePath : null;
    });
    handle('get-conversion-history', () => store.history.get());
    handle('add-to-conversion-history', (item) => { store.addHistory(item); return true; });
    handle('clear-conversion-history', () => { store.history.set([]); return true; });
    handle('get-conversion-stats', () => store.stats.get());
    handle('save-conversion-stats', (stats) => { store.stats.set(stats); return true; });

    // ---- updates
    handle('check-for-updates', () => updater.check());
    handle('download-update', () => updater.download());
    handle('install-update', () => updater.install(() => { ctx.state.quitting = true; tray.destroy(); }));
    handle('get-update-mode', () => updater.mode());
    handle('get-auto-update', () => settings.get().autoUpdate !== false);
    handle('set-auto-update', (enabled) => { settings.update({ autoUpdate: !!enabled }); if (enabled) updater.check().catch(() => {}); return true; });
    handle('get-release-notes', () => updater.releaseNotes());
    handle('get-remote-alerts', () => remoteAlerts());

    // ---- engines (yt-dlp, JS helper, ffmpeg)
    handle('engine-status', () => require('../engines/ytdlp').status());
    handle('engine-repair', async () => {
        const send = (e) => ctx.send('engine-progress', e);
        bin.events.on('progress', send);
        try {
            await bin.installYtdlp({ force: true });
            await bin.installDeno().catch((err) => log.warning('download', 'Deno install failed', { error: err.message }));
            log.success('system', 'Download engine repaired');
            return require('../engines/ytdlp').status();
        } finally { bin.events.off('progress', send); }
    });
    handle('update-libraries', async () => {
        const send = (e) => ctx.send('engine-progress', e);
        bin.events.on('progress', send);
        try {
            const r = await bin.updateYtdlp({ force: false });
            return { success: true, ytdlp: r };
        } finally { bin.events.off('progress', send); }
    });
}

module.exports = { register, fileFromArgv, queueFile, setStartup, refreshContextMenu };
