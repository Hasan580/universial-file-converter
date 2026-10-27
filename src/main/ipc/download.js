'use strict';

const fs = require('fs');
const path = require('path');
const { dialog, shell } = require('electron');
const { handle } = require('./handle');
const ctx = require('../ctx');
const log = require('../logger');
const settings = require('../settings');
const activity = require('../activity');
const bin = require('../binaries');
const dm = require('../features/dm');

let ytdlp = null;
const yt = () => ytdlp || (ytdlp = require('../engines/ytdlp'));

function register() {
    // Opening the downloader page calls this: it makes sure yt-dlp exists (downloading it on first use,
    // with progress events) and reports the state of every tool the downloader depends on.
    handle('check-downloader-available', async () => {
        let error = null;
        try { await bin.ensureYtdlp(); } catch (err) { error = err.message; log.error('download', 'yt-dlp setup failed', { error }); }
        const status = await yt().status();
        return { available: !!status.ytdlp.installed, error, status };
    });

    handle('get-video-info', async (url) => {
        log.info('download', `Fetching video info: ${url}`);
        const id = `info-${Date.now()}`;
        activity.start(id, 'Reading link');
        try {
            const info = await yt().getInfo(url, { onStatus: (note) => ctx.send('download-status', { url, note }) });
            log.success('download', `Video info fetched: ${info.title}`, { site: info.site });
            return info;
        } catch (err) {
            log.error('download', `Failed to fetch video info: ${err.message}`, { url, kind: err.kind });
            throw err;
        } finally { activity.stop(id); }
    });

    handle('get-playlist-info', async (url) => {
        log.info('download', `Fetching playlist info: ${url}`);
        const info = await yt().getPlaylistInfo(url, { onStatus: (note) => ctx.send('download-status', { url, note }) });
        log.success('download', `Playlist info fetched: ${info.title}`, { count: info.count });
        return info;
    });

    handle('download-media', async (options) => {
        const id = options.id || `dl-${Date.now()}`;
        const opts = { ...options, id, outputDirectory: options.outputDirectory || settings.get().outputDirectory };
        log.info('download', `Starting download: ${opts.url}`, { format: opts.format, quality: opts.quality });
        activity.start(id, 'Downloading');
        try {
            const result = await yt().download(opts, (p) => {
                activity.progress(id, p.progress);
                ctx.send('download-progress', { id, ...p });
            });
            log.success('download', `Download complete: ${result.outputPath}`, { outputSize: result.outputSize, recoveries: result.recoveries });
            return result;
        } catch (err) {
            if (!err.cancelled) log.error('download', `Download failed: ${err.message}`, { url: opts.url, kind: err.kind, detail: err.detail });
            throw err;
        } finally { activity.stop(id); }
    });

    handle('cancel-download', (id) => yt().cancel(id));

    // ---- download manager (direct-link downloads, browser bridge)
    const engine = () => dm.init();
    const empty = { tasks: [], defaultOutputDir: '', maxConcurrent: 2, queueCount: 0, activeCount: 0 };
    handle('dm-get-state', () => (dm.getEngine() ? dm.getEngine().getState() : (engine().getState() || empty)));
    handle('dm-add-task', (url, fileName, outputDir) => {
        // v4 passed positional arguments; an options object is accepted as well.
        const options = typeof url === 'object' && url ? url : { url, fileName, outputDir };
        if (!/^https?:\/\//i.test(String(options.url || ''))) throw new Error('Enter a valid http(s) link.');
        return engine().addTask(options);
    });
    handle('dm-pause-task', (id) => engine().pauseTask(id));
    handle('dm-resume-task', (id) => engine().resumeTask(id));
    handle('dm-cancel-task', (id) => engine().cancelTask(id));
    handle('dm-retry-task', (id) => engine().retryTask(id));
    handle('dm-delete-task', (id, deleteFile) => engine().deleteTask(id, { deleteFile }));
    handle('dm-pause-all', () => engine().pauseAll());
    handle('dm-resume-all', () => engine().resumeAll());
    handle('dm-clear-finished', (deleteFile) => engine().clearFinished({ deleteFile }));
    handle('dm-set-output-dir', async () => {
        const r = await dialog.showOpenDialog(ctx.getWindow(), { properties: ['openDirectory', 'createDirectory'], title: 'Select download folder' });
        if (r.canceled || !r.filePaths[0]) return null;
        engine().setDefaultOutputDir(r.filePaths[0]);
        settings.update({ downloadDirectory: r.filePaths[0] });
        return r.filePaths[0];
    });
    handle('dm-set-max-concurrent', (n) => engine().setMaxConcurrent(n));
    handle('dm-reorder-task', (id, direction) => engine().reorderQueuedTask(id, direction));
    handle('dm-get-bridge-info', () => dm.bridgeInfo());
    handle('dm-get-auto-arrange', () => settings.get().dmAutoArrange !== false);
    handle('dm-set-auto-arrange', (enabled) => { settings.update({ dmAutoArrange: !!enabled }); return !!enabled; });
    handle('dm-open-file', (p) => {
        if (!p) return { ok: false, error: 'No file path' };
        if (!fs.existsSync(p)) return { ok: false, error: 'File not found', path: p };
        shell.openPath(p);
        return { ok: true };
    });
    handle('dm-open-folder', (p) => {
        if (!p) return { ok: false, error: 'No file path' };
        if (fs.existsSync(p)) { shell.showItemInFolder(p); return { ok: true }; }
        const dir = path.dirname(p);
        if (fs.existsSync(dir)) { shell.openPath(dir); return { ok: true, fallback: true }; }
        return { ok: false, error: 'File and folder not found', path: p };
    });
}

module.exports = { register };
