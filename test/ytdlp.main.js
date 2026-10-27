'use strict';

/**
 * yt-dlp engine checks (needs internet; runs inside Electron).
 *   node_modules/electron/dist/electron.exe test/ytdlp.main.js [outfile.json]
 * Uses a throwaway userData folder so it never touches a real profile.
 */

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-ytdlp-data-'));
process.env.UFC_USER_DATA = tmpData;
app.disableHardwareAcceleration();
require('../src/main/paths').pinUserData();
const report = process.argv.find((a) => a.endsWith('.json')) || path.join(os.tmpdir(), 'ufc-ytdlp.json');

app.whenReady().then(async () => {
    const settings = require('../src/main/settings');
    settings.load();
    const bin = require('../src/main/binaries');
    const yt = require('../src/main/engines/ytdlp');
    const ff = require('../src/main/engines/ffmpeg');
    const out = path.join(tmpData, 'dl');
    fs.mkdirSync(out, { recursive: true });
    const rows = [];
    const rec = (name, ok, detail) => { rows.push({ name, ok, detail: String(detail).slice(0, 400) }); };

    // ---- pure classification (no network)
    const cases = [
        ["ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies", 'bot'],
        ['ERROR: [youtube] abc: Video unavailable', 'unavailable'],
        ['ERROR: [PornHub] x: Unable to download webpage: HTTP Error 410: Gone', 'gone'],
        ['ERROR: Unsupported URL: https://example.com/', 'unsupported'],
        ['ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access', 'private'],
        ['ERROR: unable to download video data: HTTP Error 403: Forbidden', 'http403'],
        ['ERROR: Requested format is not available. Use --list-formats', 'format'],
        ['WARNING: [youtube] n challenge solving failed: Some formats may be missing', 'ejs'],
        ['ERROR: <urlopen error [Errno 11001] getaddrinfo failed>', 'network'],
        ['ERROR: This video is DRM protected', 'drm']
    ];
    for (const [text, want] of cases) { const got = yt.classify(text).kind; rec(`classify -> ${want}`, got === want, `got ${got}`); }

    try {
        const t0 = Date.now();
        await bin.ensureYtdlp();
        const v = await bin.ytdlpVersion();
        rec('yt-dlp downloads and runs on this platform', !!v, `version ${v} in ${Date.now() - t0}ms (${bin.ytdlpFile()})`);
    } catch (e) { rec('yt-dlp downloads and runs on this platform', false, e.message); }

    const st = await yt.status();
    rec('status reports a JS runtime', ['deno', 'node'].includes(st.runtime.kind), `${st.runtime.kind}, managed=${st.runtime.managed}`);
    rec('yt-dlp is pointed at the bundled ffmpeg', !!bin.ffmpegLocation() && fs.existsSync(bin.ffmpegLocation()), bin.ffmpegLocation());

    // ---- permanent failures must be fast and not retried
    try {
        await yt.getInfo('https://www.youtube.com/watch?v=zzzzzzzzzzz');
        rec('missing YouTube video fails cleanly', false, 'unexpectedly succeeded');
    } catch (e) { rec('missing YouTube video fails cleanly', ['unavailable', 'private'].includes(e.kind), `${e.kind}: ${e.message} (attempts ${JSON.stringify(e.attempts)})`); }
    try {
        await yt.getInfo('https://example.com/not-a-video');
        rec('unsupported URL fails cleanly', false, 'unexpectedly succeeded');
    } catch (e) { rec('unsupported URL fails cleanly', ['unsupported', 'unavailable', 'unknown'].includes(e.kind), `${e.kind}: ${e.message}`); }

    // ---- real work: Big Buck Bunny trailer-length clip on YouTube
    const URL = process.env.UFC_TEST_URL || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
    let info = null;
    const notes = [];
    try {
        info = await yt.getInfo(URL, { onStatus: (n) => notes.push(n) });
        rec('getInfo on YouTube', !!info.title && info.duration > 0, `"${info.title}" ${info.duration}s formats=${info.formats.video.length}v/${info.formats.audio.length}a recoveries=[${notes.join('; ')}]`);
    } catch (e) { rec('getInfo on YouTube', false, `${e.kind || ''} ${e.message} attempts=${JSON.stringify(e.attempts || [])}\n${e.detail || ''}`); }

    if (info) {
        try {
            const events = [];
            const t0 = Date.now();
            const r = await yt.download({ id: 'vid', url: URL, outputDirectory: out, format: 'mp4', quality: '360', downloadThumbnail: true }, (p) => events.push(p));
            const meta = await ff.getInfo(r.outputPath);
            rec('download 360p mp4', !!meta.video && meta.video.height <= 360 && !!meta.audio, `${path.basename(r.outputPath)} ${meta.video && meta.video.width}x${meta.video && meta.video.height} ${r.outputSize}B ${Date.now() - t0}ms, ${events.length} progress events, recoveries=${r.recoveries}, thumb=${!!r.thumbnailFile}`);
            rec('no temp folder left behind', fs.readdirSync(out).every((f) => !f.startsWith('.ufc-')), fs.readdirSync(out).join(', '));
            const r2 = await yt.download({ id: 'vid2', url: URL, outputDirectory: out, format: 'mp4', quality: '360' });
            rec('second download does not overwrite the first', r2.outputPath !== r.outputPath && fs.existsSync(r.outputPath), `${path.basename(r.outputPath)} / ${path.basename(r2.outputPath)}`);
        } catch (e) { rec('download 360p mp4', false, `${e.kind || ''} ${e.message}\n${e.detail || ''}`); }

        try {
            const r = await yt.download({ id: 'aud', url: URL, outputDirectory: out, format: 'mp3', audioBitrate: '128' });
            const meta = await ff.getInfo(r.outputPath);
            rec('download audio as mp3 with cover art', !!meta.audio && /\.mp3$/i.test(r.outputPath) && meta.hasCover, `${path.basename(r.outputPath)} ${r.outputSize}B cover=${meta.hasCover}`);
        } catch (e) { rec('download audio as mp3 with cover art', false, `${e.kind || ''} ${e.message}\n${e.detail || ''}`); }

        try {
            const p = yt.download({ id: 'cancelme', url: URL, outputDirectory: out, format: 'mp4', quality: 'best' });
            await new Promise((r) => setTimeout(r, 2500));
            yt.cancel('cancelme');
            let cancelled = false;
            try { await p; } catch (e) { cancelled = !!e.cancelled; }
            rec('cancel stops the download and cleans up', cancelled && fs.readdirSync(out).every((f) => !f.startsWith('.ufc-')), `cancelled=${cancelled}`);
        } catch (e) { rec('cancel', false, e.message); }
    }

    fs.writeFileSync(report, JSON.stringify(rows, null, 2));
    const failed = rows.filter((r) => !r.ok).length;
    try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    app.exit(failed ? 1 : 0);
});
