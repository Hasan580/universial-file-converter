'use strict';

/**
 * yt-dlp driver with automatic recovery.
 *
 * Every call runs through `withRecovery`: when yt-dlp fails, the stderr is classified and the
 * next-best fix is applied automatically (switch YouTube client, install the JS helper, use
 * browser cookies, update yt-dlp, relax the format, back off on rate limits), up to MAX_ATTEMPTS.
 * Permanent problems (private video, unsupported site, DRM) fail immediately with a clear message.
 */

const fs = require('fs');
const path = require('path');
const bin = require('../binaries');
const jobs = require('../jobs');
const log = require('../logger');
const settings = require('../settings');
const ff = require('./ffmpeg');
const { uniquePath, ensureDir, throttle } = require('../util');

const MAX_ATTEMPTS = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWin = process.platform === 'win32';

// ------------------------------------------------------------------ failure classification

const RULES = [
    ['ejs',        /n challenge solving failed|signature solving failed|challenge solving|no supported javascript runtime|js runtime|yt-dlp-ejs|jsc/i],
    ['bot',        /confirm you.?re not a bot|not a bot|sign in to confirm|--cookies-from-browser|use --cookies/i],
    ['age',        /age[- ]restricted|confirm your age|inappropriate for some users/i],
    ['private',    /private video|video is private/i],
    ['login',      /login required|members[- ]only|join this channel|only available for registered|requires authentication/i],
    ['geo',        /not available in your country|geo[- ]restrict|blocked it in your country|not made this video available/i],
    ['drm',        /drm protected|drm-protected/i],
    ['gone',       /http error 410|\b410\b.*gone/i],
    ['unavailable',/video unavailable|video is unavailable|has been removed|no longer available|does not exist|this video is not available|account associated.*terminated|http error 404/i],
    ['unsupported',/unsupported url|no suitable extractor|is not a valid url/i],
    ['format',     /requested format is not available|no video formats found|format .* is not available|requested format not available/i],
    ['http403',    /http error 403|403: forbidden/i],
    ['http429',    /http error 429|too many requests|rate[- ]limit/i],
    ['network',    /timed out|timeout|temporary failure|name or service not known|getaddrinfo|unable to connect|connection (reset|refused|aborted)|network is unreachable|unable to download webpage|incomplete read|http error 5\d\d|ssl:|certificate/i],
    ['ffmpeg',     /ffmpeg.*not found|ffprobe.*not found|postprocessing.*ffmpeg/i]
];

const MESSAGES = {
    bot: 'YouTube is asking to confirm you are not a bot. Sign in to YouTube in Firefox, then choose Firefox under Settings > Downloads > Browser cookies and try again.',
    age: 'This video is age-restricted. Sign in to YouTube in Firefox and choose it under Settings > Downloads > Browser cookies.',
    login: 'This video needs you to be signed in (members-only or restricted). Choose a browser you are signed in with under Settings > Downloads > Browser cookies.',
    private: 'This video is private.',
    geo: 'This video is not available in your country. A VPN may help.',
    drm: 'This video is DRM-protected and cannot be downloaded.',
    gone: 'The site says this video is gone (HTTP 410). It has probably been removed.',
    unavailable: 'This video is unavailable or has been removed.',
    unsupported: 'This link is not supported. Check the URL, or try a direct page link.',
    format: 'No matching quality was available for this video. Try another quality.',
    http403: 'The site refused the download (HTTP 403). It may be temporarily blocking requests; try again in a few minutes.',
    http429: 'The site is rate-limiting requests. Wait a minute and try again.',
    network: 'Could not reach the site. Check your internet connection and try again.',
    ejs: 'The YouTube helper could not run. Open Settings > Downloads and choose "Repair download engine".',
    ffmpeg: 'ffmpeg could not be started for post-processing. Open Settings > Downloads and choose "Repair download engine".'
};

function classify(stderr) {
    const text = String(stderr || '');
    for (const [kind, re] of RULES) if (re.test(text)) return { kind, message: MESSAGES[kind] };
    const lines = text.split(/\r?\n/).filter((l) => /^ERROR:/i.test(l.trim()));
    const cleaned = lines.map((l) => l.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, '').trim()).join(' ');
    return { kind: 'unknown', message: cleaned || 'The download failed. Check the link and try again.' };
}

class DownloadError extends Error {
    constructor(failure, attempts, stderr) {
        super(failure.message);
        this.name = 'DownloadError';
        this.kind = failure.kind;
        this.attempts = attempts;
        this.detail = String(stderr || '').split(/\r?\n/).filter(Boolean).slice(-6).join('\n');
    }
}

// ------------------------------------------------------------------ process plumbing

function lineSplitter(onLine) {
    let buf = '';
    return (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            onLine(buf.slice(0, nl).replace(/\r$/, ''));
            buf = buf.slice(nl + 1);
        }
    };
}

async function commonArgs() {
    const rt = await bin.jsRuntime();
    const ffmpeg = bin.ffmpegLocation();
    const args = [
        '--ignore-config', '--no-colors', '--encoding', 'utf-8',
        '--socket-timeout', '30', '--retries', '10', '--fragment-retries', '10', '--extractor-retries', '3',
        '--concurrent-fragments', '4', '--trim-filenames', '180',
        ...rt.args
    ];
    if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
    if (isWin) args.push('--windows-filenames');
    return { args, env: { ...process.env, ...rt.env, PYTHONUTF8: '1' } };
}

function cookieArgs() {
    const s = settings.get();
    if (s.ytdlpCookiesFile && fs.existsSync(s.ytdlpCookiesFile)) return ['--cookies', s.ytdlpCookiesFile];
    if (s.ytdlpCookiesBrowser) return ['--cookies-from-browser', s.ytdlpCookiesBrowser];
    return [];
}

/** Firefox is the one browser whose cookies yt-dlp can still read reliably on every OS. */
function detectFirefoxProfile() {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const candidates = isWin
        ? [path.join(process.env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles')]
        : process.platform === 'darwin'
            ? [path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')]
            : [path.join(home, '.mozilla', 'firefox'), path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox')];
    return candidates.some((c) => { try { return fs.existsSync(c) && fs.readdirSync(c).length > 0; } catch (_) { return false; } });
}

function execute({ id, args, onStdout, onStderr }) {
    return new Promise((resolve, reject) => {
        (async () => {
            const file = await bin.ensureYtdlp();
            const { args: base, env } = await commonArgs();
            const child = jobs.spawnTracked(id, 'ytdlp', file, [...base, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
            let stdout = '';
            let stderr = '';
            const outLines = onStdout ? lineSplitter(onStdout) : null;
            const errLines = onStderr ? lineSplitter(onStderr) : null;
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');
            child.stdout.on('data', (c) => { stdout += c; if (outLines) outLines(c); });
            child.stderr.on('data', (c) => { stderr += c; if (errLines) errLines(c); });
            child.on('error', (err) => reject(new Error(`Could not start yt-dlp: ${err.message}`)));
            child.on('close', (code) => resolve({ code, stdout, stderr, cancelled: jobs.wasCancelled(id) }));
        })().catch(reject);
    });
}

// ------------------------------------------------------------------ recovery ladder

async function nextStep(failure, st, ctx) {
    st.attempts += 1;
    if (st.attempts >= MAX_ATTEMPTS) return null;
    const youtube = /youtube\.com|youtu\.be/i.test(ctx.url || '');

    const update = async () => {
        if (st.updated) return null;
        st.updated = true;
        try {
            const r = await bin.updateYtdlp();
            if (r.updated) return { note: `Updated yt-dlp to ${r.version}, retrying...`, key: 'update', args: [] };
        } catch (err) {
            log.warning('download', 'yt-dlp auto-update failed', { error: err.message });
        }
        return null;
    };

    switch (failure.kind) {
        case 'ejs': {
            if (!st.helper) {
                st.helper = true;
                try { await bin.installDeno(); } catch (err) { log.warning('download', 'Deno install failed', { error: err.message }); }
                return { note: 'Setting up the YouTube helper...', key: 'helper', args: [] };
            }
            if (!st.remote) { st.remote = true; return { note: 'Fetching the YouTube solver...', key: 'remote', args: ['--remote-components', 'ejs:github'] }; }
            return update();
        }
        case 'bot': {
            if (!st.clientA) { st.clientA = true; return { note: 'YouTube asked for verification, trying another client...', key: 'client', args: ['--extractor-args', 'youtube:player_client=tv,web_safari,mweb'] }; }
            if (!st.cookies && !cookieArgs().length && detectFirefoxProfile() && youtube) {
                st.cookies = true;
                return { note: 'Trying your Firefox sign-in...', key: 'cookies', args: ['--cookies-from-browser', 'firefox'] };
            }
            if (!st.clientB) { st.clientB = true; return { note: 'Trying a different YouTube client...', key: 'client', args: ['--extractor-args', 'youtube:player_client=ios,android_vr'] }; }
            return update();
        }
        case 'age':
        case 'login': {
            if (!st.cookies && !cookieArgs().length && detectFirefoxProfile() && youtube) {
                st.cookies = true;
                return { note: 'Trying your Firefox sign-in...', key: 'cookies', args: ['--cookies-from-browser', 'firefox'] };
            }
            return null;
        }
        case 'http403': {
            const u = await update();
            if (u) return u;
            if (!st.clientA) { st.clientA = true; return { note: 'The site refused the request, trying another client...', key: 'client', args: ['--extractor-args', 'youtube:player_client=tv,web_safari,mweb'] }; }
            if (!st.noFrag) { st.noFrag = true; await sleep(2500); return { note: 'Retrying with a gentler connection...', key: 'frag', args: ['--concurrent-fragments', '1', '--force-ipv4'] }; }
            return null;
        }
        case 'format': {
            if (st.format === 0) { st.format = 1; return { note: 'Quality not available, trying the best match...', key: 'format', args: ['-f', 'bv*+ba/b'] }; }
            if (st.format === 1) { st.format = 2; return { note: 'Falling back to a single combined stream...', key: 'format', args: ['-f', 'b/w'] }; }
            return update();
        }
        case 'http429': {
            if (st.waited < 2) { st.waited += 1; await sleep(8000 * st.waited); return { note: 'Rate limited, waiting a moment...', key: 'wait', args: [] }; }
            return null;
        }
        case 'network': {
            if (st.waited < 2) { st.waited += 1; await sleep(1500 * st.waited); return { note: 'Connection hiccup, retrying...', key: 'net', args: st.waited === 2 ? ['--force-ipv4'] : [] }; }
            return null;
        }
        case 'unknown':
            return update();
        default:
            return null; // private, unavailable, gone, unsupported, drm, geo: retrying cannot help
    }
}

/**
 * Run `buildArgs()` until it succeeds or the ladder runs out.
 * `onStatus(note)` is told what recovery step is being tried so the UI can show it.
 */
async function withRecovery({ id, url, buildArgs, onStdout, onStderr, onStatus }) {
    const st = { attempts: 0, updated: false, helper: false, remote: false, clientA: false, clientB: false, cookies: false, noFrag: false, format: 0, waited: 0 };
    const extras = new Map();
    const history = [];

    for (;;) {
        const args = [...buildArgs(), ...cookieArgs(), ...[...extras.values()].flat()];
        const res = await execute({ id, args, onStdout, onStderr });
        if (res.cancelled) { const e = new Error('Cancelled'); e.cancelled = true; throw e; }
        if (res.code === 0) return { res, history };

        const failure = classify(res.stderr);
        history.push(failure.kind);
        log.warning('download', `yt-dlp failed (${failure.kind})`, { url, detail: res.stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ') });

        const step = await nextStep(failure, st, { url });
        if (jobs.wasCancelled(id)) { const e = new Error('Cancelled'); e.cancelled = true; throw e; }
        if (!step) throw new DownloadError(failure, history, res.stderr);
        extras.set(step.key, step.args);
        if (onStatus) onStatus(step.note);
    }
}

// ------------------------------------------------------------------ info

async function fetchThumbnail(url) {
    if (!url) return null;
    try {
        const { net } = require('electron');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const res = await net.fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(timer);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 100) return null;
        return `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${buf.toString('base64')}`;
    } catch (_) {
        return null;
    }
}

function summarizeFormats(formats) {
    const video = [];
    const audio = [];
    for (const f of formats || []) {
        const hasV = f.vcodec && f.vcodec !== 'none';
        const hasA = f.acodec && f.acodec !== 'none';
        if (hasV && f.height >= 144 && !video.find((v) => v.height === f.height)) {
            video.push({ format_id: f.format_id, ext: f.ext, height: f.height, quality: `${f.height}p`, filesize: f.filesize || f.filesize_approx || 0 });
        } else if (hasA && !hasV) {
            const abr = Math.round(f.abr || 0);
            if (abr && !audio.find((a) => a.abr === abr)) audio.push({ format_id: f.format_id, ext: f.ext, abr, quality: `${abr}kbps`, filesize: f.filesize || f.filesize_approx || 0 });
        }
    }
    video.sort((a, b) => b.height - a.height);
    audio.sort((a, b) => b.abr - a.abr);
    return { video: video.slice(0, 8), audio: audio.slice(0, 4) };
}

async function getInfo(url, { onStatus } = {}) {
    const id = `info-${Date.now()}`;
    const { res } = await withRecovery({
        id, url, onStatus,
        buildArgs: () => ['--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings', url]
    });
    let info;
    try { info = JSON.parse(res.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop()); } catch (_) {
        throw new Error('The site returned information yt-dlp could not read.');
    }
    const thumbnail = await fetchThumbnail(info.thumbnail);
    return {
        title: info.title || 'Untitled',
        thumbnail,
        thumbnailUrl: info.thumbnail || null,
        duration: info.duration || 0,
        uploader: info.uploader || info.channel || 'Unknown',
        site: info.extractor_key || info.extractor || '',
        isLive: !!info.is_live,
        url,
        formats: summarizeFormats(info.formats),
        hasSubtitles: !!(info.subtitles && Object.keys(info.subtitles).length),
        hasAutoSubtitles: !!(info.automatic_captions && Object.keys(info.automatic_captions).length),
        availableSubtitleLangs: [
            ...Object.keys(info.subtitles || {}),
            ...Object.keys(info.automatic_captions || {}).map((k) => `${k} (auto)`)
        ].slice(0, 30)
    };
}

async function getPlaylistInfo(url, { onStatus } = {}) {
    const id = `plist-${Date.now()}`;
    const { res } = await withRecovery({
        id, url, onStatus,
        buildArgs: () => ['--flat-playlist', '--dump-single-json', '--no-warnings', url]
    });
    const data = JSON.parse(res.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop());
    const entries = (data.entries || []).filter(Boolean).map((e) => ({
        id: e.id,
        title: e.title || 'Untitled',
        url: e.url && /^https?:/.test(e.url) ? e.url : (e.webpage_url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : '')),
        duration: e.duration || 0,
        uploader: e.uploader || e.channel || data.uploader || '',
        thumbnail: (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : e.thumbnail) || null
    })).filter((e) => e.url && !/^\[(Deleted|Private) video\]$/.test(e.title));
    return { title: data.title || 'Playlist', uploader: data.uploader || data.channel || '', count: entries.length, entries };
}

/** JSON-lines helper used by search and the music player. */
async function runJsonLines(args, { timeout = 45000, url = '' } = {}) {
    const id = `json-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timer = setTimeout(() => jobs.cancel(id), timeout);
    try {
        const { res } = await withRecovery({ id, url, buildArgs: () => ['--no-warnings', ...args] });
        return res.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    } catch (err) {
        if (err.cancelled) throw new Error('yt-dlp timed out');
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/** Raw run (no recovery) for callers that need stdout, such as resolving a stream URL. */
async function runRaw(args, { timeout = 45000 } = {}) {
    const id = `raw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const timer = setTimeout(() => jobs.cancel(id), timeout);
    try {
        return await execute({ id, args });
    } finally {
        clearTimeout(timer);
    }
}

// ------------------------------------------------------------------ download

const AUDIO_FORMATS = new Set(['mp3', 'm4a', 'flac', 'opus', 'ogg', 'wav', 'aac']);
const MEDIA_EXT = /\.(mp4|mkv|webm|mov|m4a|mp3|opus|ogg|flac|wav|aac|m4v|flv|3gp|ts|mka)$/i;

function formatSelector({ audioOnly, format, quality }) {
    if (audioOnly) return { f: 'bestaudio/best', sort: [] };
    const h = parseInt(quality, 10);
    const cap = Number.isFinite(h) && h > 0 ? `[height<=?${h}]` : '';
    if (format === 'webm') return { f: `bv*${cap}[ext=webm]+ba[ext=webm]/bv*${cap}+ba/b${cap}`, sort: ['-S', 'res,vcodec:vp9,acodec:opus'] };
    return { f: `bv*${cap}+ba/b${cap}`, sort: ['-S', 'vcodec:h264,res,acodec:m4a'] };
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

function fmtSpeed(bps) {
    if (!bps) return null;
    const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];
    let v = bps; let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(v >= 100 ? 0 : 1)}${units[i]}`;
}

function fmtEta(sec) {
    if (sec === null || sec === undefined) return null;
    const s = Math.max(0, Math.round(sec));
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

async function download(options, onProgress) {
    const {
        id = `dl-${Date.now()}`, url, outputDirectory,
        format = 'mp4', quality = 'best', audioBitrate = '192',
        downloadSubtitles = false, downloadThumbnail = false, subtitleLanguage = 'en'
    } = options;
    if (!url) throw new Error('No link was provided.');
    ensureDir(outputDirectory);

    const audioOnly = !!options.audioOnly || AUDIO_FORMATS.has(String(format).toLowerCase());
    const audioFormat = AUDIO_FORMATS.has(String(format).toLowerCase()) ? String(format).toLowerCase() : 'mp3';
    const work = path.join(outputDirectory, `.ufc-${id}`);
    ensureDir(work);

    const emit = onProgress ? throttle(onProgress, 150) : () => {};
    const send = (p) => { if (onProgress) onProgress(p); };
    let destinations = 0;
    let expectTwoStreams = !audioOnly;
    let phase = 'video';

    const onStdout = (line) => {
        if (/^\[download\] Destination:/.test(line)) {
            destinations += 1;
            phase = audioOnly ? 'audio' : (destinations === 1 ? 'video' : 'audio');
        } else if (/^\[(Merger|ExtractAudio|VideoConvertor|EmbedThumbnail|Metadata|FFmpegMetadata|EmbedSubtitle)/.test(line)) {
            phase = 'merge';
            send({ progress: 95, speed: null, eta: null, phase: 'merge', status: 'Processing...' });
        }
        const m = line.match(/^\[UFCPROG\]\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
        if (!m) return;
        const done = num(m[1]);
        const total = num(m[2]) || num(m[3]);
        const speed = num(m[4]);
        const eta = num(m[5]);
        if (done === null) return;
        const pct = total ? Math.min(100, (done / total) * 100) : 0;
        let overall = pct;
        if (expectTwoStreams && destinations >= 2) overall = 45 + pct * 0.45;
        else if (expectTwoStreams) overall = pct * 0.45;
        else overall = pct * 0.92;
        emit({ progress: Math.round(overall * 10) / 10, speed: fmtSpeed(speed), speedBps: speed, eta: fmtEta(eta), etaSeconds: eta, phase });
    };

    const sel = formatSelector({ audioOnly, format, quality });
    const buildArgs = () => {
        const args = [
            '-P', work, '-o', '%(title).150B.%(ext)s',
            '--no-playlist', '--newline', '--no-warnings',
            '--progress-template', 'download:[UFCPROG] %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
            '-f', sel.f, ...sel.sort,
            '--embed-metadata'
        ];
        if (audioOnly || downloadThumbnail) args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
        if (!audioOnly) args.push('--merge-output-format', format === 'webm' ? 'webm' : 'mp4');
        if (downloadSubtitles) {
            args.push('--write-subs', '--write-auto-subs', '--sub-langs', subtitleLanguage || 'en', '--convert-subs', 'srt');
            if (!audioOnly) args.push('--embed-subs');
        }
        args.push(url);
        return args;
    };

    let attempts = [];
    try {
        const { history } = await withRecovery({
            id, url, buildArgs, onStdout,
            onStatus: (note) => send({ progress: 0, speed: null, eta: null, phase: 'recover', status: note })
        });
        attempts = history;

        const files = fs.readdirSync(work).map((f) => path.join(work, f));
        const media = files.filter((f) => MEDIA_EXT.test(f)).sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
        if (!media) throw new Error('The download finished but no media file was produced.');
        const thumb = files.find((f) => /\.(jpg|jpeg|png|webp)$/i.test(f));
        const subs = files.filter((f) => /\.(srt|vtt|ass)$/i.test(f));

        let outputPath;
        if (audioOnly) {
            send({ progress: 94, speed: null, eta: null, phase: 'merge', status: 'Converting audio...' });
            const r = await ff.convertAudio({
                id: `${id}-audio`, inputPath: media, outputFormat: audioFormat, outputDirectory,
                bitrate: `${Math.max(64, Math.min(320, parseInt(audioBitrate, 10) || 192))}k`,
                coverPath: thumb, preserveMetadata: true
            }, (p) => { if (p.percent !== null) send({ progress: 94 + p.percent * 0.05, speed: null, eta: null, phase: 'merge', status: 'Converting audio...' }); });
            outputPath = r.outputPath;
        } else {
            outputPath = uniquePath(path.join(outputDirectory, path.basename(media)));
            fs.renameSync(media, outputPath);
        }

        const subtitleFiles = [];
        if (downloadSubtitles) {
            for (const s of subs) {
                const dest = uniquePath(path.join(outputDirectory, path.basename(s)));
                fs.renameSync(s, dest);
                subtitleFiles.push(dest);
            }
        }
        let thumbnailFile = null;
        if (downloadThumbnail && thumb) {
            thumbnailFile = uniquePath(path.join(outputDirectory, path.basename(thumb)));
            fs.renameSync(thumb, thumbnailFile);
        }

        send({ progress: 100, speed: null, eta: null, phase: 'complete' });
        return { success: true, outputPath, outputSize: fs.statSync(outputPath).size, subtitleFiles, thumbnailFile, recoveries: attempts.length };
    } finally {
        try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* leave it; next run cleans */ }
    }
}

function cancel(id) {
    return id ? jobs.cancel(id) : jobs.cancelAll('ytdlp');
}

async function status() {
    const s = await bin.status();
    return { ...s, cookies: { browser: settings.get().ytdlpCookiesBrowser || '', file: !!settings.get().ytdlpCookiesFile, firefoxFound: detectFirefoxProfile() } };
}

module.exports = {
    classify,
    DownloadError,
    getInfo,
    getPlaylistInfo,
    download,
    cancel,
    status,
    runJsonLines,
    runRaw,
    withRecovery,
    execute,
    fmtSpeed,
    fmtEta
};
