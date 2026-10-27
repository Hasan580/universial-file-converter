'use strict';

/**
 * Conversion matrix: runs inside Electron (binaries.js needs the `app`/`net` modules).
 *   node_modules/electron/dist/electron.exe test/matrix.main.js [outfile.json]
 * Generates synthetic inputs with the bundled ffmpeg, converts them to every format the
 * app offers, and checks each output with ffprobe. Exits non-zero if anything unexpected fails.
 */

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
const paths = require('../src/main/paths');
paths.pinUserData();

const report = process.argv.find((a) => a.endsWith('.json')) || path.join(os.tmpdir(), 'ufc-matrix.json');

app.whenReady().then(async () => {
    const bin = require('../src/main/binaries');
    const ff = require('../src/main/engines/ffmpeg');
    const { AUDIO, VIDEO } = require('../src/main/engines/formats');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-matrix-'));
    const out = path.join(work, 'out');
    fs.mkdirSync(out);
    const results = [];
    const record = (group, name, ok, detail) => results.push({ group, name, ok, detail });

    try {
        const gen = async (file, args) => {
            const r = await bin.runCapture(bin.ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', ...args, file], { timeout: 120000 });
            if (!r.ok) throw new Error(`could not generate ${file}: ${r.stderr}`);
        };
        const sample = path.join(work, 'sample.mp4');
        const portrait = path.join(work, 'portrait.mp4');
        const song = path.join(work, 'song.mp3');
        const noAudio = path.join(work, 'silent.mp4');
        await gen(sample, ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
            '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p']);
        await gen(portrait, ['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
            '-t', '2', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p']);
        await gen(noAudio, ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
        const cover = path.join(work, 'cover.jpg');
        await gen(cover, ['-f', 'lavfi', '-i', 'color=c=orange:s=300x300', '-frames:v', '1']);
        await gen(song, ['-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-i', cover, '-t', '3',
            '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'copy', '-id3v2_version', '3', '-disposition:v:0', 'attached_pic',
            '-metadata', 'title=Test Tone', '-metadata', 'artist=Matrix']);

        const encoders = await ff.loadEncoders();
        const check = async (file, wantVideo, wantAudio, needDuration = true) => {
            const info = await ff.getInfo(file);
            if (needDuration && !(info.duration > 0.5)) throw new Error(`duration ${info.duration}`);
            if (!needDuration && fs.statSync(file).size < 200) throw new Error('output is empty');
            if (wantVideo && !info.video) throw new Error('no video stream in output');
            if (wantAudio && !info.audio) throw new Error('no audio stream in output');
            return info;
        };

        // ---- audio
        for (const [id, cfg] of Object.entries(AUDIO)) {
            if (!encoders.has(cfg.codec)) { record('audio', id, true, `skipped (no ${cfg.codec} encoder in this ffmpeg)`); continue; }
            try {
                const r = await ff.convertAudio({ id: `a-${id}`, inputPath: song, outputFormat: id, outputDirectory: out, bitrate: '128k' });
                const info = await check(r.outputPath, false, true, id !== 'ra');
                record('audio', id, true, `${path.basename(r.outputPath)} ${info.duration.toFixed(1)}s ${r.outputSize}B${cfg.cover ? ` cover=${info.hasCover}` : ''}`);
            } catch (e) { record('audio', id, false, e.message); }
        }

        // ---- video
        for (const [id, cfg] of Object.entries(VIDEO)) {
            try {
                const r = await ff.convertVideo({ id: `v-${id}`, inputPath: sample, outputFormat: id, outputDirectory: out, quality: 40 });
                const info = await check(r.outputPath, true, !!cfg.acodec, id !== 'apng' && id !== 'swf');
                record('video', id, true, `${path.basename(r.outputPath)} ${info.video.width}x${info.video.height} ${r.codec} ${r.outputSize}B`);
            } catch (e) { record('video', id, false, e.message); }
        }

        // ---- images
        {
            const sharp = require('sharp');
            const img = require('../src/main/engines/image');
            const catalog = await img.getCatalog();
            // 64x48 image: opaque red top half, fully transparent bottom half
            const srcPng = path.join(work, 'alpha.png');
            const top = await sharp({ create: { width: 64, height: 24, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
            await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
                .composite([{ input: top, top: 0, left: 0 }]).png().toFile(srcPng);
            const viaSharp = new Set(['jpg', 'png', 'webp', 'avif', 'heif', 'gif', 'tiff', 'svg']);
            const viaProbe = new Set(['bmp', 'tga', 'ppm', 'pgm', 'pbm', 'wbmp', 'psd', 'ico', 'jp2', 'jxl']);
            for (const f of catalog) {
                if (!f.available) { record('image', f.id, true, 'skipped (encoder not in this ffmpeg)'); continue; }
                try {
                    const r = await img.convert({ id: `i-${f.id}`, inputPath: srcPng, outputFormat: f.id, outputDirectory: out, quality: 80 });
                    let dims = '';
                    if (viaSharp.has(f.id)) {
                        const m = await sharp(r.outputPath).metadata();
                        dims = `${m.width}x${m.height} ${m.format}`;
                        if (f.id !== 'svg' && (m.width !== 64 || m.height !== 48)) throw new Error(`unexpected size ${dims}`);
                    } else if (viaProbe.has(f.id)) {
                        const m = (await ff.getInfo(r.outputPath)).video;
                        if (!m) throw new Error('not decodable by ffprobe');
                        dims = `${m.width}x${m.height} ${m.codec}`;
                        if (f.id !== 'ico' && (m.width !== 64 || m.height !== 48)) throw new Error(`unexpected size ${dims}`);
                    } else if (f.id === 'eps') {
                        const head = fs.readFileSync(r.outputPath, 'latin1').slice(0, 30);
                        if (!head.startsWith('%!PS-Adobe-3.0 EPSF-3.0')) throw new Error('bad EPS header');
                        dims = 'EPS header ok';
                    }
                    record('image', f.id, true, `${path.basename(r.outputPath)} ${dims} ${r.outputSize}B`);
                } catch (e) { record('image', f.id, false, e.message); }
            }
            try {
                const r = await img.convert({ id: 'flat', inputPath: srcPng, outputFormat: 'jpg', outputDirectory: out });
                const { data } = await sharp(r.outputPath).extract({ left: 2, top: 40, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
                record('behaviour', 'transparent PNG -> JPG flattens to white, not black', data[0] > 240 && data[1] > 240 && data[2] > 240, `rgb(${data[0]},${data[1]},${data[2]})`);
            } catch (e) { record('behaviour', 'jpg flatten', false, e.message); }
            try {
                const bmpIn = path.join(out, 'alpha.bmp');
                if (!fs.existsSync(bmpIn)) throw new Error('bmp not produced earlier');
                const r = await img.convert({ id: 'bmpin', inputPath: bmpIn, outputFormat: 'png', outputDirectory: out });
                const m = await sharp(r.outputPath).metadata();
                record('behaviour', 'BMP input (decoded through ffmpeg) converts to PNG', m.width === 64 && m.height === 48, `${m.width}x${m.height}`);
            } catch (e) { record('behaviour', 'bmp input', false, e.message); }
            try {
                const a = await img.convert({ id: 'u1', inputPath: srcPng, outputFormat: 'png', outputDirectory: path.dirname(srcPng) });
                record('behaviour', 'png -> png in the same folder never overwrites the input', a.outputPath !== srcPng && fs.existsSync(srcPng), path.basename(a.outputPath));
            } catch (e) { record('behaviour', 'image same-folder', false, e.message); }
            try {
                const r = await img.compress({ id: 'c1', inputPath: srcPng, outputDirectory: out, quality: 60 });
                record('behaviour', 'image compress works', r.outputSize > 0, `${r.inputSize}B -> ${r.outputSize}B (${r.savedPercent}%)`);
            } catch (e) { record('behaviour', 'image compress', false, e.message); }
            try {
                const qrSrc = path.join(work, 'qr-none.png');
                await sharp({ create: { width: 50, height: 50, channels: 3, background: '#ffffff' } }).png().toFile(qrSrc);
                const r = await img.scanQr(qrSrc);
                record('behaviour', 'QR scan on an image without a code reports cleanly', r.success === false && /No QR/i.test(r.error), r.error);
            } catch (e) { record('behaviour', 'qr', false, e.message); }
        }

        // ---- behaviours
        try {
            const r1 = await ff.convertVideo({ id: 'same1', inputPath: sample, outputFormat: 'mp4', outputDirectory: work, quality: 30 });
            const r2 = await ff.convertVideo({ id: 'same2', inputPath: sample, outputFormat: 'mp4', outputDirectory: work, quality: 30 });
            const ok = r1.outputPath !== sample && r2.outputPath !== sample && r1.outputPath !== r2.outputPath;
            record('behaviour', 'mp4->mp4 in the same folder never overwrites the input', ok, `${path.basename(r1.outputPath)}, ${path.basename(r2.outputPath)}`);
        } catch (e) { record('behaviour', 'same-folder output', false, e.message); }

        try {
            const r = await ff.convertVideo({ id: 'portrait', inputPath: portrait, outputFormat: 'mp4', outputDirectory: out, resolution: '720p', quality: 30 });
            const info = await ff.getInfo(r.outputPath);
            record('behaviour', 'portrait 360x640 at "720p" keeps aspect (720x1280)', info.video.width === 720 && info.video.height === 1280, `${info.video.width}x${info.video.height}`);
        } catch (e) { record('behaviour', 'portrait scale', false, e.message); }

        try {
            const r = await ff.convertVideo({ id: 'land', inputPath: sample, outputFormat: 'mp4', outputDirectory: out, resolution: '480p', quality: 30 });
            const info = await ff.getInfo(r.outputPath);
            record('behaviour', 'landscape 640x360 at "480p" keeps aspect (854x480)', info.video.height === 480 && info.video.width === 854, `${info.video.width}x${info.video.height}`);
        } catch (e) { record('behaviour', 'landscape scale', false, e.message); }

        try {
            await ff.convertAudio({ id: 'noaudio', inputPath: noAudio, outputFormat: 'mp3', outputDirectory: out });
            record('behaviour', 'video without audio -> mp3 gives a clear error', false, 'unexpectedly succeeded');
        } catch (e) { record('behaviour', 'video without audio -> mp3 gives a clear error', /no audio track/i.test(e.message), e.message); }

        try {
            await ff.convertAudio({ id: 'bad', inputPath: path.join(work, 'missing.mp3'), outputFormat: 'mp3', outputDirectory: out });
            record('behaviour', 'missing input gives a clear error', false, 'unexpectedly succeeded');
        } catch (e) { record('behaviour', 'missing input gives a clear error', /could not be read/i.test(e.message), e.message); }

        try {
            const long = path.join(work, 'long.mp4');
            await gen(long, ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '60', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']);
            const p = ff.convertVideo({ id: 'cancelme', inputPath: long, outputFormat: 'mkv', outputDirectory: out, quality: 95 });
            await new Promise((r) => setTimeout(r, 800));
            ff.cancel('cancelme');
            let cancelled = false;
            try { await p; } catch (e) { cancelled = !!e.cancelled; }
            const leftovers = fs.readdirSync(out).filter((f) => f.startsWith('long'));
            record('behaviour', 'cancel stops ffmpeg and leaves no partial file', cancelled && leftovers.length === 0, `cancelled=${cancelled} leftovers=${leftovers.join(',') || 'none'}`);
        } catch (e) { record('behaviour', 'cancel', false, e.message); }

        let sawProgress = 0;
        try {
            await ff.convertVideo({ id: 'prog', inputPath: sample, outputFormat: 'webm', outputDirectory: out, quality: 20 }, (p) => { if (p.percent !== null) sawProgress += 1; });
            record('behaviour', 'progress events are reported', sawProgress > 0, `${sawProgress} events`);
        } catch (e) { record('behaviour', 'progress', false, e.message); }
    } catch (e) {
        record('setup', 'fatal', false, e.stack || e.message);
    }

    fs.writeFileSync(report, JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    app.exit(failed.length ? 1 : 0);
});
