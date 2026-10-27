'use strict';

/**
 * IDM-style download manager plus a local bridge so a browser extension can hand downloads to the app.
 * The bridge only listens on 127.0.0.1 and refuses anything that is not a browser extension or
 * does not carry the secret token, so a web page can no longer queue downloads behind your back.
 */

const { app, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ctx = require('../ctx');
const log = require('../logger');
const settings = require('../settings');
const { throttle, uniquePath, ensureDir } = require('../util');

const PORT = 38945;
const MAX_BODY = 64 * 1024;

const ARRANGE = {
    Programs: ['.exe', '.msi', '.deb', '.rpm', '.appimage', '.apk', '.dmg', '.pkg'],
    Documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.txt', '.epub', '.mobi', '.csv'],
    Videos: ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.flv', '.wmv', '.ts', '.3gp'],
    Music: ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wav', '.opus', '.wma', '.alac'],
    Images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff', '.psd', '.heic'],
    Archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'],
    Torrents: ['.torrent']
};
const ARRANGE_BY_EXT = Object.fromEntries(Object.entries(ARRANGE).flatMap(([folder, list]) => list.map((e) => [e, folder])));

let engine = null;
let server = null;
const arranged = new Set();

function getEngine() { return engine; }

function arrangeFolder(fileName) {
    return ARRANGE_BY_EXT[path.extname(fileName || '').toLowerCase()] || null;
}

async function arrange(task) {
    if (!task || !task.fileName || !task.outputPath || arranged.has(task.id)) return false;
    const sub = arrangeFolder(task.fileName);
    if (!sub || !fs.existsSync(task.outputPath)) return false;
    const destDir = path.join(task.outputDir || path.dirname(task.outputPath), sub);
    try {
        ensureDir(destDir);
        const dest = uniquePath(path.join(destDir, task.fileName));
        fs.renameSync(task.outputPath, dest);
        arranged.add(task.id);
        engine.updateTaskPath(task.id, dest, destDir);
        log.info('download', `Auto-arranged ${task.fileName} into ${sub}/`);
        return true;
    } catch (err) {
        log.error('download', `Auto-arrange failed: ${err.message}`, { file: task.fileName });
        return false;
    }
}

function init() {
    if (engine) return engine;
    const { DownloadManagerEngine } = require('../engines/dlmanager');
    const s = settings.get();
    engine = new DownloadManagerEngine({
        defaultOutputDir: s.downloadDirectory || s.outputDirectory || path.join(app.getPath('downloads'), 'UniversalConverter'),
        maxConcurrent: 2
    });
    const push = throttle((state) => ctx.send('dm-state', state), 250);
    engine.on('state', (state) => {
        push(state);
        if (settings.get().dmAutoArrange === false) return;
        for (const task of state.tasks) {
            if (task.status === 'completed' && !arranged.has(task.id)) {
                arrange(task).then((moved) => { if (moved) ctx.send('dm-state', engine.getState()); });
            }
        }
    });
    startBridge();
    return engine;
}

// ------------------------------------------------------------------ bridge

const isExtensionOrigin = (o) => /^(chrome|moz|edge|safari-web)-extension:\/\//i.test(o || '');

function startBridge() {
    if (server) return;
    server = http.createServer((req, res) => {
        const origin = req.headers.origin || '';
        const host = String(req.headers.host || '');
        const json = (code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };

        // DNS-rebinding guard: only requests addressed to the loopback name are served.
        if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) return json(403, { ok: false, error: 'Forbidden host' });

        const cors = isExtensionOrigin(origin)
            ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Download-Bridge-Token' }
            : {};

        if (req.method === 'OPTIONS') { res.writeHead(isExtensionOrigin(origin) ? 204 : 403, cors); return res.end(); }
        if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true, app: 'UniversalConverter', version: app.getVersion() }, cors);

        if (req.method === 'POST' && req.url === '/capture') {
            const token = req.headers['x-download-bridge-token'];
            const authorised = isExtensionOrigin(origin) || (token && token === settings.get().dmBridgeToken);
            if (!authorised) return json(403, { ok: false, error: 'Not authorised' }, cors);

            let body = '';
            let tooBig = false;
            req.on('data', (chunk) => {
                body += chunk;
                if (body.length > MAX_BODY) { tooBig = true; req.destroy(); }
            });
            req.on('end', () => {
                if (tooBig) return;
                try {
                    const data = JSON.parse(body);
                    if (!data.url || !/^https?:\/\//i.test(String(data.url))) return json(400, { ok: false, error: 'A valid http(s) URL is required' }, cors);
                    const task = engine.addTask({
                        url: data.url,
                        fileName: data.fileName || '',
                        source: data.source || 'browser-extension',
                        headers: data.referrer ? { Referer: data.referrer } : {}
                    });
                    const w = ctx.getWindow();
                    if (w) ctx.send('navigate', 'downloads');
                    try { if (Notification.isSupported()) new Notification({ title: 'Download captured', body: `${task.fileName} added to the queue` }).show(); } catch (_) { /* optional */ }
                    log.info('download', `Bridge captured: ${task.fileName}`, { url: data.url });
                    json(200, { ok: true, taskId: task.id }, cors);
                } catch (err) {
                    json(400, { ok: false, error: err.message }, cors);
                }
            });
            return;
        }
        json(404, { ok: false, error: 'Not found' }, cors);
    });
    server.on('error', (err) => {
        log.warning('system', `Download bridge could not start: ${err.message}`);
        server = null;
    });
    server.listen(PORT, '127.0.0.1', () => log.info('system', `Download bridge listening on 127.0.0.1:${PORT}`));
}

function shutdown() {
    try { if (engine && engine.shutdown) engine.shutdown(); } catch (_) { /* ignore */ }
    try { if (server) { server.close(); server = null; } } catch (_) { /* ignore */ }
}

/** True while any download is running or waiting, so the window is not reclaimed underneath it. */
function hasActivity() {
    if (!engine) return false;
    const s = engine.getState();
    return (s.activeCount || 0) + (s.queueCount || 0) > 0;
}

function bridgeInfo() {
    return { port: PORT, running: !!server, token: settings.get().dmBridgeToken };
}

module.exports = { init, getEngine, shutdown, bridgeInfo, hasActivity, PORT };
