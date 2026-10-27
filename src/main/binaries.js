'use strict';

/**
 * Locates and manages the external tools the app depends on:
 *   - ffmpeg            (bundled, never downloaded; it also reads file info, so there is no ffprobe)
 *   - yt-dlp            (downloaded per platform into userData/bin, kept up to date)
 *   - a JavaScript runtime for yt-dlp's YouTube solver (Deno, with Electron-as-Node as fallback)
 */

const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const EventEmitter = require('events');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const log = require('./logger');
const { ensureDir } = require('./util');

const events = new EventEmitter();
const UA = `UniCompanion/${app.getVersion ? app.getVersion() : '5'} (+https://github.com/Hasan580/universial-file-converter)`;
const isWin = process.platform === 'win32';
const exe = (name) => (isWin ? `${name}.exe` : name);

// ---------------------------------------------------------------- ffmpeg

let ffmpegCache = null;

function firstExisting(list) {
    for (const p of list) {
        try { if (p && fs.existsSync(p)) return p; } catch (_) { /* keep looking */ }
    }
    return null;
}

function ffmpegPath() {
    if (ffmpegCache) return ffmpegCache;
    let bundled = null;
    try { bundled = paths.unpacked(require('ffmpeg-static')); } catch (_) { /* optional */ }
    ffmpegCache = firstExisting([path.join(paths.binDir(), exe('ffmpeg')), bundled]) || 'ffmpeg';
    return ffmpegCache;
}

/** Where yt-dlp should find ffmpeg: the binary itself, or null when only a PATH copy exists. */
function ffmpegLocation() {
    const p = ffmpegPath();
    return p && p !== 'ffmpeg' ? p : null;
}

// ---------------------------------------------------------------- generic helpers

function runCapture(file, args, { timeout = 15000, env } = {}) {
    return new Promise((resolve) => {
        execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: env || process.env }, (err, stdout, stderr) => {
            resolve({ ok: !err, code: err && err.code, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

function emitProgress(id, label, percent) {
    events.emit('progress', { id, label, percent });
}

/** Stream a URL to disk with progress and an optional SHA-256 check. Returns the sha256 hex. */
async function downloadFile(url, dest, { onProgress, expectedSha256 } = {}) {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    ensureDir(path.dirname(dest));
    const tmp = `${dest}.download`;
    const hash = crypto.createHash('sha256');
    let seen = 0;
    const meter = new Transform({
        transform(chunk, _enc, cb) {
            hash.update(chunk);
            seen += chunk.length;
            if (onProgress && total) onProgress(Math.min(99, Math.round((seen / total) * 100)));
            cb(null, chunk);
        }
    });
    try {
        await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(tmp));
    } catch (err) {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        throw err;
    }
    const digest = hash.digest('hex');
    if (expectedSha256 && digest.toLowerCase() !== expectedSha256.toLowerCase()) {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
        throw new Error('Downloaded file failed its integrity check (SHA-256 mismatch).');
    }
    fs.renameSync(tmp, dest);
    return digest;
}

async function fetchText(url) {
    const res = await net.fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

// ---------------------------------------------------------------- yt-dlp

function ytdlpAssetName() {
    const arch = process.arch;
    if (isWin) return arch === 'arm64' ? 'yt-dlp_arm64.exe' : arch === 'ia32' ? 'yt-dlp_x86.exe' : 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (arch === 'arm') return 'yt-dlp_linux_armv7l';
    return 'yt-dlp_linux';
}

const ytdlpFile = () => path.join(paths.binDir(), isWin ? 'yt-dlp.exe' : 'yt-dlp');

function legacyYtdlpCandidates() {
    // v4 stored a Windows-only copy here; reuse it on Windows to avoid a re-download.
    if (!isWin) return [];
    return [path.join(app.getPath('appData'), 'universal-file-converter', 'libraries', 'yt-dlp', 'yt-dlp.exe')];
}

async function ytdlpVersion(file = ytdlpFile()) {
    if (!fs.existsSync(file)) return '';
    const r = await runCapture(file, ['--version'], { timeout: 20000 });
    return r.ok ? r.stdout.trim().split(/\r?\n/)[0] : '';
}

async function latestYtdlpTag() {
    const res = await net.fetch('https://github.com/yt-dlp/yt-dlp/releases/latest', { method: 'HEAD', headers: { 'User-Agent': UA } });
    const m = String(res.url || '').match(/\/tag\/([^/?#]+)/);
    return m ? m[1] : '';
}

let ytdlpInstall = null;

/** Download (or refresh) yt-dlp. Concurrent callers share one download. */
function installYtdlp({ force = false } = {}) {
    if (ytdlpInstall) return ytdlpInstall;
    ytdlpInstall = (async () => {
        const dest = ytdlpFile();
        const asset = ytdlpAssetName();
        const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

        if (!force && fs.existsSync(dest)) return dest;

        // Reuse a working v4 copy on first run instead of downloading 23 MB again.
        if (!force && !fs.existsSync(dest)) {
            const legacy = firstExisting(legacyYtdlpCandidates());
            if (legacy && (await ytdlpVersion(legacy))) {
                fs.copyFileSync(legacy, dest);
                return dest;
            }
        }

        emitProgress('ytdlp', 'Downloading yt-dlp', 0);
        let expected = null;
        try {
            const sums = await fetchText(`${base}/SHA2-256SUMS`);
            const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${asset}`) || l.trim().endsWith(`*${asset}`));
            if (line) expected = line.trim().split(/\s+/)[0];
        } catch (err) {
            log.warning('download', 'Could not fetch yt-dlp checksums; continuing over HTTPS only', { error: err.message });
        }

        const staged = `${dest}.new`;
        await downloadFile(`${base}/${asset}`, staged, {
            expectedSha256: expected,
            onProgress: (p) => emitProgress('ytdlp', 'Downloading yt-dlp', p)
        });
        if (!isWin) fs.chmodSync(staged, 0o755);

        const version = await ytdlpVersion(staged);
        if (!version) {
            try { fs.unlinkSync(staged); } catch (_) { /* ignore */ }
            throw new Error('The downloaded yt-dlp did not start. Check your antivirus or network and try again.');
        }
        fs.renameSync(staged, dest);
        emitProgress('ytdlp', 'yt-dlp ready', 100);
        log.success('download', `yt-dlp ${version} installed`, { asset });
        return dest;
    })().finally(() => { ytdlpInstall = null; });
    return ytdlpInstall;
}

/** Make sure a usable yt-dlp exists and return its path. */
async function ensureYtdlp() {
    const file = ytdlpFile();
    if (fs.existsSync(file)) return file;
    return installYtdlp();
}

/** Update yt-dlp in place when a newer release exists. Safe to call at any time. */
async function updateYtdlp({ force = false } = {}) {
    const file = ytdlpFile();
    if (!fs.existsSync(file)) {
        await installYtdlp();
        return { updated: true, version: await ytdlpVersion() };
    }
    const current = await ytdlpVersion();
    let latest = '';
    try { latest = await latestYtdlpTag(); } catch (_) { /* offline: keep what we have */ }
    if (!force && latest && current && latest === current) return { updated: false, version: current };
    if (!latest && !force) return { updated: false, version: current };

    const staged = `${file}.new`;
    emitProgress('ytdlp', 'Updating yt-dlp', 0);
    const asset = ytdlpAssetName();
    const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
    let expected = null;
    try {
        const sums = await fetchText(`${base}/SHA2-256SUMS`);
        const line = sums.split(/\r?\n/).find((l) => l.trim().endsWith(` ${asset}`) || l.trim().endsWith(`*${asset}`));
        if (line) expected = line.trim().split(/\s+/)[0];
    } catch (_) { /* optional */ }
    await downloadFile(`${base}/${asset}`, staged, { expectedSha256: expected, onProgress: (p) => emitProgress('ytdlp', 'Updating yt-dlp', p) });
    if (!isWin) fs.chmodSync(staged, 0o755);
    const nextVersion = await ytdlpVersion(staged);
    if (!nextVersion) {
        try { fs.unlinkSync(staged); } catch (_) { /* ignore */ }
        throw new Error('The updated yt-dlp did not start; keeping the current version.');
    }
    try {
        fs.renameSync(staged, file);
    } catch (err) {
        try { fs.unlinkSync(staged); } catch (_) { /* ignore */ }
        throw new Error(`Could not replace yt-dlp (is a download still running?): ${err.message}`);
    }
    emitProgress('ytdlp', 'yt-dlp up to date', 100);
    log.success('download', `yt-dlp updated to ${nextVersion}`);
    return { updated: true, version: nextVersion };
}

// ---------------------------------------------------------------- JavaScript runtime (YouTube)

function denoTriple() {
    const a = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    if (isWin) return `${a}-pc-windows-msvc`;
    if (process.platform === 'darwin') return `${a}-apple-darwin`;
    return `${a}-unknown-linux-gnu`;
}

const denoFile = () => path.join(paths.binDir(), exe('deno'));

let denoInstall = null;

function installDeno() {
    if (denoInstall) return denoInstall;
    denoInstall = (async () => {
        const dest = denoFile();
        if (fs.existsSync(dest)) return dest;
        const asset = `deno-${denoTriple()}.zip`;
        const url = `https://github.com/denoland/deno/releases/latest/download/${asset}`;
        const zipPath = path.join(paths.binDir(), asset);
        emitProgress('deno', 'Downloading YouTube helper', 0);

        let expected = null;
        try {
            const txt = await fetchText(`${url}.sha256sum`);
            expected = (txt.trim().split(/\s+/)[0] || '').toLowerCase();
            if (expected.length !== 64) expected = null;
        } catch (_) { /* checksum file is optional */ }

        await downloadFile(url, zipPath, { expectedSha256: expected, onProgress: (p) => emitProgress('deno', 'Downloading YouTube helper', p) });
        try {
            const zip = new AdmZip(zipPath);
            const entry = zip.getEntries().find((e) => path.basename(e.entryName) === exe('deno'));
            if (!entry) throw new Error('deno binary was not found in the archive');
            fs.writeFileSync(`${dest}.new`, entry.getData());
            if (!isWin) fs.chmodSync(`${dest}.new`, 0o755);
            fs.renameSync(`${dest}.new`, dest);
        } finally {
            try { fs.unlinkSync(zipPath); } catch (_) { /* ignore */ }
        }
        emitProgress('deno', 'YouTube helper ready', 100);
        log.success('download', 'Deno runtime installed for yt-dlp');
        return dest;
    })().finally(() => { denoInstall = null; });
    return denoInstall;
}

/**
 * Describe how to run yt-dlp's JavaScript challenge solver right now.
 * Preference: managed Deno, then a Deno on PATH, then Electron itself running as Node
 * (works immediately, no download) so YouTube keeps working even before Deno is installed.
 */
async function jsRuntime() {
    const managed = denoFile();
    if (fs.existsSync(managed)) return { kind: 'deno', args: ['--js-runtimes', `deno:${managed}`], env: {} };

    const sys = await runCapture(exe('deno'), ['--version'], { timeout: 5000 });
    if (sys.ok) return { kind: 'deno', args: [], env: {} };

    return {
        kind: 'node',
        args: ['--js-runtimes', `node:${process.execPath}`],
        env: { ELECTRON_RUN_AS_NODE: '1' }
    };
}

// ---------------------------------------------------------------- status

async function status() {
    const [yv, ffv] = await Promise.all([
        ytdlpVersion(),
        runCapture(ffmpegPath(), ['-version'], { timeout: 10000 })
    ]);
    const rt = await jsRuntime();
    return {
        ytdlp: { path: ytdlpFile(), installed: fs.existsSync(ytdlpFile()), version: yv, asset: ytdlpAssetName() },
        runtime: { kind: rt.kind, managed: fs.existsSync(denoFile()) },
        ffmpeg: { path: ffmpegPath(), version: ffv.ok ? ffv.stdout.split(/\r?\n/)[0] : '', bundled: ffmpegPath() !== 'ffmpeg' }
    };
}

module.exports = {
    events,
    ffmpegPath,
    ffmpegLocation,
    ytdlpFile,
    ytdlpVersion,
    ensureYtdlp,
    installYtdlp,
    updateYtdlp,
    installDeno,
    jsRuntime,
    status,
    runCapture,
    downloadFile,
    fetchText
};
