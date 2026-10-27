'use strict';

const fs = require('fs');
const path = require('path');
const bin = require('../binaries');
const jobs = require('../jobs');
const { AUDIO, VIDEO, RESOLUTIONS, CODEC_FALLBACKS } = require('./formats');
const { uniquePath, ensureDir, clampNumber, throttle } = require('../util');

// ------------------------------------------------------------------ encoder discovery

let encoderSet = null;

async function loadEncoders() {
    if (encoderSet) return encoderSet;
    const r = await bin.runCapture(bin.ffmpegPath(), ['-hide_banner', '-encoders'], { timeout: 20000 });
    const set = new Set();
    for (const line of r.stdout.split(/\r?\n/)) {
        const m = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
        if (m) set.add(m[1]);
    }
    encoderSet = set;
    return set;
}

async function pickEncoder(requested) {
    const set = await loadEncoders();
    if (set.has(requested)) return requested;
    for (const alt of CODEC_FALLBACKS[requested] || []) if (set.has(alt)) return alt;
    return requested;
}

/** Formats this ffmpeg build can really write, in the shape the UI consumes. */
async function getCatalog() {
    const set = await loadEncoders();
    const audio = Object.entries(AUDIO).map(([id, f]) => ({
        id, label: f.label, ext: f.ext, category: f.category, lossy: !!f.lossy, bitrate: !!f.bitrate,
        available: set.has(f.codec)
    }));
    const video = Object.entries(VIDEO).map(([id, f]) => {
        const codecOk = set.has(f.vcodec) || (CODEC_FALLBACKS[f.vcodec] || []).some((c) => set.has(c));
        return { id, label: f.label, ext: f.ext, category: f.category, audio: !!f.acodec, available: codecOk };
    });
    const resolutions = Object.entries(RESOLUTIONS).map(([id, r]) => ({ id, label: r.label, height: r.height }));
    return { audio, video, resolutions };
}

// ------------------------------------------------------------------ probing

const UNREADABLE = 'This file could not be read. It may be corrupt, empty or in an unsupported format.';

const CHANNELS = { mono: 1, stereo: 2, quad: 4, '2.1': 3, '3.0': 3, '4.0': 4, '4.1': 5, '5.0': 5, '5.1': 6, '6.1': 7, '7.1': 8 };

function channelCount(text) {
    const named = text.match(/,\s*(mono|stereo|quad|\d\.\d)(?:\([^)]*\))?\s*(?:,|$)/);
    if (named) return CHANNELS[named[1]] || named[1].split('.').reduce((s, n) => s + Number(n), 0);
    const counted = text.match(/,\s*(\d+) channels/);
    return counted ? Number(counted[1]) : 0;
}

/**
 * ffmpeg prints a stable description of any file it opens (`ffmpeg -i file`), which is everything this
 * app needs, so a separate 77 MB ffprobe binary is not shipped. Output has the ffprobe JSON shape.
 */
function parseBanner(text, file) {
    const dur = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const rate = text.match(/bitrate:\s*(\d+)\s*kb\/s/);
    const container = text.match(/^Input #0,\s*(.+?),\s*from\s/m);
    const streams = [];
    for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*(\w+):\s*(.*)$/);
        if (!m) continue;
        const [, index, kind, rest] = m;
        const codec = (rest.match(/^([\w.-]+)/) || [])[1] || 'unknown';
        const s = { index: Number(index), codec_name: codec, disposition: { attached_pic: /\(attached pic\)/.test(rest) ? 1 : 0 } };
        if (kind === 'Video') {
            const dims = rest.match(/(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,\[]|$)/);
            const fps = rest.match(/(\d+(?:\.\d+)?)\s*fps/) || rest.match(/(\d+(?:\.\d+)?)\s*tbr/);
            Object.assign(s, { codec_type: 'video', width: dims ? Number(dims[1]) : 0, height: dims ? Number(dims[2]) : 0, avg_frame_rate: fps ? `${fps[1]}/1` : '0/0' });
        } else if (kind === 'Audio') {
            const hz = rest.match(/(\d+)\s*Hz/);
            Object.assign(s, { codec_type: 'audio', sample_rate: hz ? hz[1] : '0', channels: channelCount(rest) });
        } else continue;
        streams.push(s);
    }
    if (!streams.length && !dur) throw new Error(UNREADABLE);
    let size = 0;
    try { size = fs.statSync(file).size; } catch (_) { /* unreadable size is not fatal */ }
    return {
        format: {
            duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
            size,
            bit_rate: rate ? Number(rate[1]) * 1000 : 0,
            format_long_name: container ? container[1] : ''
        },
        streams
    };
}

async function probe(file) {
    if (!fs.existsSync(file)) throw new Error(UNREADABLE);
    const r = await bin.runCapture(bin.ffmpegPath(), ['-hide_banner', '-i', file], { timeout: 45000 });
    // No output and no exit code means ffmpeg was killed by a signal. The ffmpeg bundled for Linux crashes
    // on MPEG-TS input, so say that instead of calling a healthy file corrupt.
    if (!r.stderr.trim() && !r.ok && r.code === null) {
        const transportStream = ['ts', 'mts', 'm2ts'].includes(path.extname(file).slice(1).toLowerCase());
        throw new Error(process.platform === 'linux' && transportStream
            ? 'MPEG-TS files (.ts, .mts, .m2ts) cannot be opened on Linux yet: the ffmpeg bundled with the Linux app stops when it reads them. Converting to those formats still works.'
            : 'ffmpeg stopped unexpectedly while reading this file.');
    }
    return parseBanner(r.stderr, file);
}

function summarize(json) {
    const streams = json.streams || [];
    const isPic = (s) => s.disposition && s.disposition.attached_pic === 1;
    const video = streams.find((s) => s.codec_type === 'video' && !isPic(s));
    const audio = streams.find((s) => s.codec_type === 'audio');
    const cover = streams.find((s) => s.codec_type === 'video' && isPic(s));
    const rate = (video && video.avg_frame_rate && video.avg_frame_rate !== '0/0') ? video.avg_frame_rate.split('/') : null;
    return {
        duration: Number(json.format.duration) || 0,
        size: Number(json.format.size) || 0,
        bitrate: Number(json.format.bit_rate) || 0,
        formatName: json.format.format_long_name || json.format.format_name || '',
        video: video ? {
            codec: video.codec_name,
            width: video.width,
            height: video.height,
            fps: rate ? Math.round((Number(rate[0]) / (Number(rate[1]) || 1)) * 100) / 100 : 0
        } : null,
        audio: audio ? {
            codec: audio.codec_name,
            sampleRate: Number(audio.sample_rate) || 0,
            channels: audio.channels || 0
        } : null,
        hasCover: !!cover,
        coverIndex: cover ? cover.index : -1
    };
}

async function getInfo(file) {
    return summarize(await probe(file));
}

// ------------------------------------------------------------------ running ffmpeg

function friendlyError(stderr, code) {
    const lines = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hit = lines.filter((l) => /error|invalid|unknown|not found|unsupported|cannot|could not|failed|does not|no such|permission/i.test(l));
    const picked = (hit.length ? hit : lines).slice(-3).join(' | ');
    return picked || `ffmpeg stopped unexpectedly (exit code ${code}).`;
}

/**
 * Run ffmpeg with machine-readable progress. Resolves once the process exits cleanly,
 * rejects with a readable message (and `.cancelled = true` when the user cancelled).
 */
function runFfmpeg({ id, args, duration, onProgress }) {
    return new Promise((resolve, reject) => {
        const emit = onProgress ? throttle(onProgress, 120) : null;
        const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...args];
        const child = jobs.spawnTracked(id, 'ffmpeg', bin.ffmpegPath(), full, { stdio: ['ignore', 'pipe', 'pipe'] });

        let outBuf = '';
        let errBuf = '';
        const state = {};

        child.stdout.on('data', (chunk) => {
            outBuf += chunk;
            let nl;
            while ((nl = outBuf.indexOf('\n')) >= 0) {
                const line = outBuf.slice(0, nl).trim();
                outBuf = outBuf.slice(nl + 1);
                const eq = line.indexOf('=');
                if (eq <= 0) continue;
                const key = line.slice(0, eq);
                state[key] = line.slice(eq + 1);
                if (key !== 'progress' || !emit) continue;

                const us = Number(state.out_time_us || state.out_time_ms);
                const seconds = Number.isFinite(us) && us > 0 ? us / 1e6 : 0;
                const speed = parseFloat(state.speed);
                let percent = null;
                let eta = null;
                if (duration > 0) {
                    percent = state.progress === 'end' ? 100 : Math.min(99, (seconds / duration) * 100);
                    if (speed > 0) eta = Math.max(0, Math.round((duration - seconds) / speed));
                }
                emit({
                    percent: percent === null ? null : Math.round(percent * 10) / 10,
                    speed: Number.isFinite(speed) ? speed : null,
                    eta,
                    size: Number(state.total_size) || 0
                });
            }
        });

        child.stderr.on('data', (chunk) => {
            errBuf += chunk;
            if (errBuf.length > 16384) errBuf = errBuf.slice(-8192);
        });

        child.on('error', (err) => reject(new Error(`Could not start ffmpeg: ${err.message}`)));
        child.on('close', (code) => {
            if (jobs.wasCancelled(id)) {
                const e = new Error('Conversion cancelled');
                e.cancelled = true;
                reject(e);
            } else if (code === 0) {
                resolve();
            } else {
                reject(new Error(friendlyError(errBuf, code)));
            }
        });
    });
}

function finalize(partPath, outputPath) {
    try {
        fs.renameSync(partPath, outputPath);
    } catch (_) {
        fs.copyFileSync(partPath, outputPath);
        try { fs.unlinkSync(partPath); } catch (__) { /* ignore */ }
    }
    return fs.statSync(outputPath).size;
}

function discard(partPath) {
    try { fs.unlinkSync(partPath); } catch (_) { /* nothing to remove */ }
}

// ------------------------------------------------------------------ audio

function parseVolume(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return value === 1 ? null : value;
    const s = String(value).trim();
    if (s.endsWith('%')) {
        const n = parseFloat(s) / 100;
        return Number.isFinite(n) && n !== 1 ? n : null;
    }
    if (/db$/i.test(s)) return s;
    const n = parseFloat(s);
    return Number.isFinite(n) && n !== 1 ? n : null;
}

function coerceSampleRate(key, cfg, rate) {
    if (!rate) return 0;
    if (key === 'opus') return [8000, 12000, 16000, 24000, 48000].includes(rate) ? rate : 48000;
    if (cfg.lossy && ['mp3', 'mp2', 'ac3', 'wma', 'dts', 'mka', 'ogg', 'oga'].includes(key)) return Math.min(rate, 48000);
    return rate;
}

async function convertAudio(options, onProgress) {
    const {
        id = 'audio', inputPath, outputFormat, outputDirectory,
        bitrate = '192k', sampleRate = 'original', channels = 'original',
        volume = null, normalize = false, preserveMetadata = true
    } = options;

    const key = String(outputFormat || '').toLowerCase();
    const cfg = AUDIO[key];
    if (!cfg) throw new Error(`Unsupported output format: ${outputFormat}`);
    const encoders = await loadEncoders();
    if (!encoders.has(cfg.codec)) throw new Error(`${cfg.label} output is not available in this build of ffmpeg.`);

    const info = summarize(await probe(inputPath));
    if (!info.audio) throw new Error('This file has no audio track.');

    ensureDir(outputDirectory);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outputPath = uniquePath(path.join(outputDirectory, `${base}.${cfg.ext}`), [inputPath]);
    const part = `${outputPath}.part`;

    const externalCover = options.coverPath && cfg.cover && fs.existsSync(options.coverPath) ? options.coverPath : null;
    const args = ['-y', '-i', inputPath, ...(externalCover ? ['-i', externalCover] : []), '-map', '0:a:0'];

    if (externalCover) {
        args.push('-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
        if (key === 'mp3') args.push('-id3v2_version', '3', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
    } else if (preserveMetadata && cfg.cover && info.hasCover) {
        args.push('-map', `0:${info.coverIndex}`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
        if (key === 'mp3') args.push('-id3v2_version', '3');
    }
    args.push('-map_metadata', preserveMetadata ? '0' : '-1');
    args.push('-c:a', cfg.codec);
    if (cfg.strict) args.push('-strict', '-2');

    const fixed = cfg.fixed || {};
    const wantedRate = fixed.sampleRate || coerceSampleRate(key, cfg, parseInt(sampleRate, 10));
    if (wantedRate > 0) args.push('-ar', String(wantedRate));

    let ch = fixed.channels || parseInt(channels, 10);
    if (Number.isFinite(ch) && ch > 0) {
        ch = Math.min(ch, cfg.maxChannels || 8);
        args.push('-ac', String(ch));
    } else if (cfg.maxChannels && info.audio.channels > cfg.maxChannels) {
        args.push('-ac', String(cfg.maxChannels));
    }

    if (cfg.bitrate || fixed.bitrate) {
        let br = fixed.bitrate || String(bitrate);
        if (!/[kKmM]$/.test(br)) br = `${br}k`;
        if (cfg.minBitrate && parseInt(br, 10) < cfg.minBitrate) br = `${cfg.minBitrate}k`;
        args.push('-b:a', br);
    }

    const filters = [];
    if (normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    const vol = parseVolume(volume);
    if (vol !== null) filters.push(`volume=${vol}`);
    if (filters.length) args.push('-af', filters.join(','));

    args.push('-f', cfg.muxer, part);

    try {
        await runFfmpeg({ id, args, duration: info.duration, onProgress });
        const outputSize = finalize(part, outputPath);
        if (onProgress) onProgress({ percent: 100, speed: null, eta: 0, size: outputSize });
        return { success: true, outputPath, outputSize };
    } catch (err) {
        discard(part);
        throw err;
    }
}

// ------------------------------------------------------------------ video

function scaleFilter(height) {
    // The preset names the *short side*, so portrait clips are not squashed or letterboxed.
    return `scale='if(gt(iw,ih),-2,${height})':'if(gt(iw,ih),${height},-2)':flags=lanczos`;
}

function qualityArgs(vcodec, q, cfg) {
    const crf = (hi, lo) => Math.round(hi - (q / 100) * (hi - lo));
    const preset = q > 80 ? 'slow' : q > 50 ? 'medium' : 'fast';
    switch (vcodec) {
        case 'libx264':
            return ['-crf', String(crf(45, 15)), '-preset', preset, '-pix_fmt', 'yuv420p'];
        case 'libx265':
            return ['-crf', String(crf(40, 18)), '-preset', preset, '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'];
        case 'libsvtav1':
            return ['-crf', String(crf(55, 18)), '-preset', String(q > 80 ? 6 : q > 50 ? 8 : 10), '-pix_fmt', 'yuv420p'];
        case 'libaom-av1':
            return ['-crf', String(crf(55, 18)), '-b:v', '0', '-cpu-used', String(q > 80 ? 4 : 6), '-row-mt', '1', '-pix_fmt', 'yuv420p'];
        case 'libvpx-vp9':
            return ['-crf', String(crf(50, 10)), '-b:v', '0', '-deadline', 'good', '-cpu-used', q > 80 ? '2' : '4', '-row-mt', '1', '-pix_fmt', 'yuv420p'];
        case 'libtheora':
            return ['-q:v', String(Math.max(1, Math.min(10, Math.round(q / 10))))];
        case 'mpeg4': case 'flv': case 'wmv2': case 'mpeg1video':
            return ['-q:v', String(Math.max(2, Math.min(31, Math.round(31 - (q / 100) * 29))))];
        case 'mpeg2video':
            return cfg.muxer === 'mxf'
                ? ['-pix_fmt', 'yuv422p', '-b:v', '50M']
                : ['-q:v', String(Math.max(2, Math.min(31, Math.round(31 - (q / 100) * 29))))];
        case 'prores_ks':
            return ['-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'];
        case 'dnxhd':
            return ['-b:v', '120M', '-pix_fmt', 'yuv422p'];
        default:
            return [];
    }
}

function nearestDnxFps(fps) {
    const options = [[24000 / 1001, '24000/1001'], [24, '24'], [25, '25'], [30000 / 1001, '30000/1001']];
    let best = options[2];
    for (const o of options) if (Math.abs(o[0] - fps) < Math.abs(best[0] - fps)) best = o;
    return best[1];
}

async function convertVideo(options, onProgress) {
    const {
        id = 'video', inputPath, outputFormat, outputDirectory,
        resolution = 'original', audioBitrate = '192k', fps = 'original',
        codec = 'default', quality = 75, videoBitrate = null, gifFps = 15
    } = options;

    const key = String(outputFormat || '').toLowerCase();
    const cfg = VIDEO[key];
    if (!cfg) throw new Error(`Unsupported output format: ${outputFormat}`);

    const info = summarize(await probe(inputPath));
    if (!info.video) throw new Error('This file has no video track.');

    const requested = codec && codec !== 'default' ? codec : cfg.vcodec;
    const vcodec = cfg.target ? cfg.vcodec : await pickEncoder(requested);
    const encoders = await loadEncoders();
    if (!encoders.has(vcodec)) throw new Error(`The ${cfg.label} encoder is not available in this build of ffmpeg.`);

    const q = clampNumber(quality, 1, 100, 75);
    ensureDir(outputDirectory);
    const base = path.basename(inputPath, path.extname(inputPath));
    const sameExt = path.extname(inputPath).slice(1).toLowerCase() === cfg.ext;
    // "movie.mp4" -> "movie (1).mp4" is handled by uniquePath; a suffix keeps hevc/av1 outputs distinguishable.
    const stem = cfg.nameSuffix && sameExt ? `${base}.${cfg.nameSuffix}` : base;
    const outputPath = uniquePath(path.join(outputDirectory, `${stem}.${cfg.ext}`), [inputPath]);
    const part = `${outputPath}.part`;

    const args = ['-y', '-i', inputPath];
    const withAudio = !!(cfg.acodec && info.audio);

    const resHeight = resolution !== 'original' && RESOLUTIONS[resolution] ? RESOLUTIONS[resolution].height : 0;
    const outFps = fps !== 'original' && Number(fps) > 0 ? Number(fps) : 0;

    if (key === 'gif') {
        const f = clampNumber(gifFps, 5, 30, 15);
        const width = resHeight ? Math.round(resHeight * 16 / 9 / 2) * 2 : 480;
        args.push('-filter_complex',
            `[0:v:0]fps=${f},scale='min(${width},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=on[p];[b][p]paletteuse=dither=bayer:bayer_scale=3[out]`,
            '-map', '[out]', '-loop', '0');
    } else if (key === 'apng') {
        const f = clampNumber(gifFps, 5, 30, 15);
        args.push('-map', '0:v:0', '-vf', `fps=${f},scale='min(480,iw)':-2:flags=lanczos`, '-plays', '0', '-pix_fmt', 'rgba', '-c:v', 'apng');
    } else if (cfg.target) {
        args.push('-map', '0:v:0');
        if (withAudio) args.push('-map', '0:a:0');
        args.push('-target', cfg.target);
    } else {
        args.push('-map', '0:v:0');
        if (withAudio) args.push('-map', '0:a:0');
        const filters = [];
        if (key === 'dnxhd') filters.push('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2');
        else if (resHeight) filters.push(scaleFilter(resHeight));
        if (filters.length) args.push('-vf', filters.join(','));

        if (key === 'dnxhd') args.push('-r', nearestDnxFps(info.video.fps || 25));
        else if (outFps) args.push('-r', String(outFps));

        args.push('-c:v', vcodec);
        const bitrateNumber = parseInt(videoBitrate, 10);
        if (Number.isFinite(bitrateNumber) && bitrateNumber > 0 && options.useBitrate) {
            args.push('-b:v', `${bitrateNumber}k`);
            if (vcodec === 'libx264' || vcodec === 'libx265') args.push('-pix_fmt', 'yuv420p');
        } else {
            args.push(...qualityArgs(vcodec, q, cfg));
        }
        if (cfg.faststart) args.push('-movflags', '+faststart');
    }

    if (withAudio) {
        if (!cfg.target) {
            args.push('-c:a', cfg.acodec);
            if (!/^pcm_/.test(cfg.acodec)) {
                let br = String(audioBitrate);
                if (!/[kKmM]$/.test(br)) br = `${br}k`;
                args.push('-b:a', br);
            }
            if (cfg.audioRate) args.push('-ar', String(cfg.audioRate));
            if (cfg.audioChannels) args.push('-ac', String(cfg.audioChannels));
            else if (['libmp3lame', 'mp2'].includes(cfg.acodec) && info.audio.channels > 2) args.push('-ac', '2');
        }
    }

    args.push('-map_metadata', key === 'gif' || key === 'apng' ? '-1' : '0');
    args.push('-f', cfg.muxer, part);

    try {
        await runFfmpeg({ id, args, duration: info.duration, onProgress });
        const outputSize = finalize(part, outputPath);
        if (onProgress) onProgress({ percent: 100, speed: null, eta: 0, size: outputSize });
        return { success: true, outputPath, outputSize, codec: vcodec };
    } catch (err) {
        discard(part);
        throw err;
    }
}

async function extractAudio(options, onProgress) {
    return convertAudio({ bitrate: '192k', ...options, outputFormat: options.outputFormat || 'mp3' }, onProgress);
}

/** Decode the first frame of any image ffmpeg understands (BMP, TGA, PSD, ICO...) to PNG bytes. */
function decodeToPng(file) {
    return new Promise((resolve, reject) => {
        const child = jobs.spawnTracked(`decode-${Date.now()}`, 'decode', bin.ffmpegPath(),
            ['-hide_banner', '-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'],
            { stdio: ['ignore', 'pipe', 'pipe'] });
        const chunks = [];
        let err = '';
        child.stdout.on('data', (c) => chunks.push(c));
        child.stderr.on('data', (c) => { err += c; });
        child.on('error', (e) => reject(new Error(`Could not start ffmpeg: ${e.message}`)));
        child.on('close', (code) => {
            const out = Buffer.concat(chunks);
            if (code === 0 && out.length > 0) resolve(out);
            else reject(new Error(friendlyError(err, code) || 'This image format could not be decoded.'));
        });
    });
}

function cancel(id) {
    return id ? jobs.cancel(id) : jobs.cancelAll('ffmpeg');
}

module.exports = {
    getCatalog,
    getInfo,
    probe,
    summarize,
    loadEncoders,
    convertAudio,
    convertVideo,
    extractAudio,
    decodeToPng,
    cancel,
    runFfmpeg
};
