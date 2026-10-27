'use strict';

/**
 * Packaged-build self-test. Start the app with UFC_SELFTEST=<report.json> and it runs real conversions
 * with every bundled library, writes a report and exits (no window). It exists because trimming a package
 * can break things only a packaged build reveals: asar paths, unpacked binaries, ES module loading.
 */

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function selftest(reportFile) {
    const checks = [];
    const check = async (name, fn) => {
        const started = Date.now();
        try {
            const detail = await fn();
            checks.push({ name, ok: true, detail: String(detail || '').slice(0, 200), ms: Date.now() - started });
        } catch (err) {
            checks.push({ name, ok: false, detail: String((err && err.stack) || err).slice(0, 400), ms: Date.now() - started });
        }
    };
    const need = (cond, message) => { if (!cond) throw new Error(message); };

    const bin = require('./binaries');
    const ff = require('./engines/ffmpeg');
    const image = require('./engines/image');
    const docs = require('./engines/documents');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-selftest-'));
    const out = path.join(work, 'out');
    fs.mkdirSync(out);

    await check('ffmpeg starts from the packaged location', async () => {
        const p = bin.ffmpegPath();
        need(p !== 'ffmpeg' && fs.existsSync(p), `bundled ffmpeg not found (${p})`);
        need(!/app\.asar[\\/]/.test(p), 'ffmpeg path points inside the asar archive');
        const r = await bin.runCapture(p, ['-version']);
        need(r.ok, 'ffmpeg did not run');
        return r.stdout.split(/\r?\n/)[0];
    });

    const tone = path.join(work, 'tone.wav');
    await check('audio: generate, read file info, convert to MP3 and FLAC', async () => {
        const g = await bin.runCapture(bin.ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', tone]);
        need(g.ok, 'could not generate a test tone');
        const info = await ff.getInfo(tone);
        need(info.duration > 1.5 && info.audio && info.audio.channels >= 1, `file info looks wrong: ${JSON.stringify(info)}`);
        const mp3 = await ff.convertAudio({ id: 'st-a', inputPath: tone, outputFormat: 'mp3', outputDirectory: out });
        const flac = await ff.convertAudio({ id: 'st-b', inputPath: tone, outputFormat: 'flac', outputDirectory: out });
        return `${info.duration.toFixed(1)}s, mp3 ${mp3.outputSize}B, flac ${flac.outputSize}B`;
    });

    await check('video: generate and convert to MP4 and WebM', async () => {
        const clip = path.join(work, 'clip.mp4');
        const g = await bin.runCapture(bin.ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-t', '1', '-pix_fmt', 'yuv420p', clip]);
        need(g.ok, 'could not generate a test clip');
        const mp4 = await ff.convertVideo({ id: 'st-v', inputPath: clip, outputFormat: 'mp4', outputDirectory: out, quality: 40 });
        const webm = await ff.convertVideo({ id: 'st-w', inputPath: clip, outputFormat: 'webm', outputDirectory: out, quality: 40 });
        const info = await ff.getInfo(mp4.outputPath);
        need(info.video && info.video.width === 320 && info.video.height === 180, `unexpected size ${JSON.stringify(info.video)}`);
        return `mp4 ${mp4.outputSize}B, webm ${webm.outputSize}B`;
    });

    const png = path.join(work, 'pic.png');
    await check('images: sharp loads and converts', async () => {
        const sharp = require('sharp');
        await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 204, g: 120, b: 92, alpha: 1 } } }).png().toFile(png);
        const w = await image.convert({ id: 'st-i1', inputPath: png, outputFormat: 'webp', outputDirectory: out });
        const b = await image.convert({ id: 'st-i2', inputPath: png, outputFormat: 'bmp', outputDirectory: out });
        const t = await image.makeThumbnail(png, 32);
        need(t && t.startsWith('data:image/jpeg'), 'thumbnail failed');
        return `webp ${w.outputSize}B, bmp ${b.outputSize}B`;
    });

    await check('images: HEIC decoder loads', async () => {
        const decode = require('heic-decode');
        need(typeof decode === 'function', 'heic-decode is not a function');
        return 'ok';
    });

    const txt = path.join(work, 'note.txt');
    fs.writeFileSync(txt, 'Uni Companion self test\n\nThe quick brown fox jumps over the lazy dog.\n');
    await check('documents: text to PDF, then PDF back to text (pdf.js)', async () => {
        const pdf = await docs.convert({ inputPath: txt, outputFormat: 'pdf', outputDirectory: out });
        const back = await docs.convert({ inputPath: pdf.outputPath, outputFormat: 'txt', outputDirectory: out });
        const text = fs.readFileSync(back.outputPath, 'utf8');
        need(/quick brown fox/i.test(text), `PDF text was not recovered: "${text.slice(0, 80)}"`);
        const read = await docs.readPDFTextForEditing({ inputPath: pdf.outputPath });
        need(/fox/i.test(read.text), 'readPDFTextForEditing lost the text');
        return `${pdf.outputSize}B pdf`;
    });
    await check('documents: DOCX, XLSX, EPUB, YAML', async () => {
        const docx = await docs.convert({ inputPath: txt, outputFormat: 'docx', outputDirectory: out });
        const csv = path.join(work, 'table.csv');
        fs.writeFileSync(csv, 'a,b\n1,2\n');
        const xlsx = await docs.convert({ inputPath: csv, outputFormat: 'xlsx', outputDirectory: out });
        const epub = await docs.convert({ inputPath: txt, outputFormat: 'epub', outputDirectory: out });
        const yaml = await docs.convert({ inputPath: txt, outputFormat: 'yaml', outputDirectory: out });
        return `docx ${docx.outputSize}B, xlsx ${xlsx.outputSize}B, epub ${epub.outputSize}B, yaml ${yaml.outputSize}B`;
    });

    await check('catalog: every format group is populated', async () => {
        const [av, im] = await Promise.all([ff.getCatalog(), image.getCatalog()]);
        need(av.audio.filter((f) => f.available).length >= 15, 'too few audio formats');
        need(av.video.filter((f) => f.available).length >= 15, 'too few video formats');
        need(im.filter((f) => f.available).length >= 12, 'too few image formats');
        return `${av.audio.filter((f) => f.available).length} audio, ${av.video.filter((f) => f.available).length} video, ${im.filter((f) => f.available).length} image`;
    });

    const failed = checks.filter((c) => !c.ok);
    fs.writeFileSync(reportFile, JSON.stringify({ ok: !failed.length, version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, checks }, null, 2));
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* temp folder */ }
    app.exit(failed.length ? 1 : 0);
};
