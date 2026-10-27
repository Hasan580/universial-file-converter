'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
// Memory: do not keep decoded images cached between conversions, and keep libvips to a small thread pool.
sharp.cache({ memory: 32, files: 0, items: 16 });
sharp.concurrency(Math.max(1, Math.min(3, Math.floor(os.cpus().length / 2))));
const bin = require('../binaries');
const ff = require('./ffmpeg');
const raster = require('./rasterWriters');
const { uniquePath, ensureDir, clampNumber } = require('../util');

// `alpha` = the format can carry transparency; others are flattened onto white (never black).
const OUT = {
    jpg:  { label: 'JPG',          ext: 'jpg',  alpha: false, quality: true,  category: 'Popular' },
    png:  { label: 'PNG',          ext: 'png',  alpha: true,  quality: false, category: 'Popular' },
    webp: { label: 'WebP',         ext: 'webp', alpha: true,  quality: true,  category: 'Popular' },
    avif: { label: 'AVIF',         ext: 'avif', alpha: true,  quality: true,  category: 'Modern' },
    heif: { label: 'HEIF (AV1)',   ext: 'heif', alpha: true,  quality: true,  category: 'Modern' },
    gif:  { label: 'GIF',          ext: 'gif',  alpha: true,  quality: false, category: 'Popular' },
    tiff: { label: 'TIFF',         ext: 'tiff', alpha: true,  quality: true,  category: 'Pro' },
    bmp:  { label: 'BMP',          ext: 'bmp',  alpha: false, quality: false, category: 'Legacy' },
    tga:  { label: 'TGA',          ext: 'tga',  alpha: true,  quality: false, category: 'Legacy' },
    ico:  { label: 'ICO (multi-size)', ext: 'ico', alpha: true, quality: false, category: 'Icons' },
    svg:  { label: 'SVG (embedded image)', ext: 'svg', alpha: true, quality: false, category: 'Vector' },
    psd:  { label: 'PSD (flattened)', ext: 'psd', alpha: false, quality: false, category: 'Pro' },
    eps:  { label: 'EPS',          ext: 'eps',  alpha: false, quality: false, category: 'Pro' },
    ppm:  { label: 'PPM',          ext: 'ppm',  alpha: false, quality: false, category: 'Netpbm' },
    pgm:  { label: 'PGM (gray)',   ext: 'pgm',  alpha: false, quality: false, category: 'Netpbm' },
    pbm:  { label: 'PBM (1-bit)',  ext: 'pbm',  alpha: false, quality: false, category: 'Netpbm' },
    wbmp: { label: 'WBMP',         ext: 'wbmp', alpha: false, quality: false, category: 'Legacy' },
    jp2:  { label: 'JPEG 2000',    ext: 'jp2',  alpha: false, quality: false, category: 'Pro',    viaFfmpeg: ['jpeg2000'] },
    jxl:  { label: 'JPEG XL',      ext: 'jxl',  alpha: true,  quality: true,  category: 'Modern', viaFfmpeg: ['libjxl'] }
};
const ALIASES = { jpeg: 'jpg', tif: 'tiff', heic: 'heif' };

// What libvips (inside sharp) can read directly. Everything else is decoded by ffmpeg or the HEIC decoder.
const NATIVE_IN = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'tif', 'tiff', 'svg']);

const cancelled = new Set();
let cancelAllAt = 0;

function cancel(id) {
    if (id) cancelled.add(id); else cancelAllAt = Date.now();
    return true;
}

function guard(id, startedAt) {
    if (cancelled.delete(id) || cancelAllAt >= startedAt) {
        const err = new Error('Conversion cancelled');
        err.cancelled = true;
        throw err;
    }
}

async function getCatalog() {
    const enc = await ff.loadEncoders();
    return Object.entries(OUT).map(([id, f]) => ({
        id,
        label: f.label,
        ext: f.ext,
        category: f.category,
        quality: f.quality,
        alpha: f.alpha,
        available: !f.viaFfmpeg || f.viaFfmpeg.some((c) => enc.has(c))
    }));
}

async function openInput(inputPath, { density, animated } = {}) {
    if (!fs.existsSync(inputPath)) throw new Error('The input file no longer exists.');
    const ext = path.extname(inputPath).slice(1).toLowerCase();

    if (ext === 'heic' || ext === 'heif') {
        try {
            const probe = sharp(inputPath);
            await probe.metadata();
            await probe.clone().resize(8, 8).raw().toBuffer(); // AV1-based HEIF decodes natively; HEVC throws
            return sharp(inputPath);
        } catch (_) {
            const decode = require('heic-decode');
            const { width, height, data } = await decode({ buffer: fs.readFileSync(inputPath) });
            return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
        }
    }
    if (NATIVE_IN.has(ext)) {
        return sharp(inputPath, { density: density || undefined, animated: !!animated, failOn: 'none' });
    }
    const png = await ff.decodeToPng(inputPath);
    return sharp(png);
}

async function getInfo(file) {
    const img = await openInput(file);
    const m = await img.metadata();
    return { width: m.width, height: m.height, format: m.format, hasAlpha: !!m.hasAlpha, density: m.density || 0, frames: m.pages || 1 };
}

async function makeThumbnail(file, size = 160) {
    try {
        const img = await openInput(file);
        const buf = await img.rotate().resize(size, size, { fit: 'cover' }).jpeg({ quality: 70 }).toBuffer();
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (_) {
        return null;
    }
}

async function encodeViaFfmpeg(png, codecArgs, outputPath) {
    const tmp = path.join(os.tmpdir(), `ufc-img-${process.pid}-${Date.now()}.png`);
    fs.writeFileSync(tmp, png);
    try {
        const r = await bin.runCapture(bin.ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmp, '-frames:v', '1', ...codecArgs, outputPath], { timeout: 120000 });
        if (!r.ok || !fs.existsSync(outputPath)) throw new Error(r.stderr.trim().split(/\r?\n/).pop() || 'ffmpeg could not write this image format.');
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    }
}

async function convert(options, onProgress) {
    const startedAt = Date.now();
    const {
        id = 'image', inputPath, outputDirectory,
        quality = 85, width = null, height = null, maintainAspectRatio = true,
        compression = 'default', rotate = 0, flip = false, flop = false, grayscale = false,
        dpi = null, preserveMetadata = true
    } = options;

    let fmt = String(options.outputFormat || '').toLowerCase();
    fmt = ALIASES[fmt] || fmt;
    const cfg = OUT[fmt];
    if (!cfg) throw new Error(`Unsupported output format: ${options.outputFormat}`);
    if (cfg.viaFfmpeg) {
        const enc = await ff.loadEncoders();
        if (!cfg.viaFfmpeg.some((c) => enc.has(c))) throw new Error(`${cfg.label} output is not available in this build.`);
    }

    ensureDir(outputDirectory);
    const inExt = path.extname(inputPath).slice(1).toLowerCase();
    const base = path.basename(inputPath, path.extname(inputPath));
    const outputPath = uniquePath(path.join(outputDirectory, `${base}.${cfg.ext}`), [inputPath]);
    const part = `${outputPath}.part`;
    const q = clampNumber(quality, 1, 100, 85);
    const density = Number(dpi) > 0 ? Number(dpi) : 0;
    const emit = (percent) => { if (onProgress) onProgress({ percent }); };

    emit(8);
    const animated = ['gif', 'webp'].includes(inExt) && ['gif', 'webp'].includes(fmt);
    let img = await openInput(inputPath, { density: density || undefined, animated });
    guard(id, startedAt);

    img = img.rotate(); // honour EXIF orientation, then drop the flag
    const turn = parseInt(rotate, 10);
    if (turn) img = img.rotate(turn);
    if (flip) img = img.flip();
    if (flop) img = img.flop();
    if (grayscale) img = img.grayscale();

    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    if (w > 0 || h > 0) {
        img = img.resize({ width: w > 0 ? w : undefined, height: h > 0 ? h : undefined, fit: maintainAspectRatio ? 'inside' : 'fill' });
    }
    if (!cfg.alpha) img = img.flatten({ background: '#ffffff' });

    if (density && ['jpg', 'png', 'webp', 'tiff', 'avif', 'heif'].includes(fmt)) img = img.withMetadata({ density });
    else if (preserveMetadata && ['jpg', 'png', 'webp', 'avif', 'tiff', 'heif'].includes(fmt)) img = img.keepMetadata();
    emit(30);

    const high = compression === 'high';
    try {
        switch (fmt) {
            case 'jpg':
                await img.jpeg({ quality: q, progressive: true, mozjpeg: high }).toFile(part); break;
            case 'png':
                await img.png({ compressionLevel: high ? 9 : 6, effort: high ? 8 : 5 }).toFile(part); break;
            case 'webp':
                await img.webp({ quality: q, lossless: q >= 100, effort: high ? 6 : 4 }).toFile(part); break;
            case 'avif':
                await img.avif({ quality: q, lossless: q >= 100, effort: high ? 7 : 4 }).toFile(part); break;
            case 'heif':
                await img.heif({ quality: q, compression: 'av1', effort: high ? 7 : 4 }).toFile(part); break;
            case 'gif':
                await img.gif({ effort: high ? 10 : 7 }).toFile(part); break;
            case 'tiff':
                await img.tiff({ quality: q, compression: 'lzw' }).toFile(part); break;

            case 'bmp': case 'ppm': case 'psd': case 'eps': {
                const { data, info } = await img.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
                const encode = { bmp: raster.bmp24, ppm: raster.ppm, psd: raster.psd, eps: raster.eps }[fmt];
                fs.writeFileSync(part, encode(data, info.width, info.height));
                break;
            }
            case 'tga': {
                const { data, info } = await img.ensureAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
                fs.writeFileSync(part, raster.tga32(data, info.width, info.height));
                break;
            }
            case 'pgm': case 'pbm': case 'wbmp': {
                const { data, info } = await img.removeAlpha().grayscale().raw().toBuffer({ resolveWithObject: true });
                const gray = info.channels === 1 ? data : Buffer.from(data.filter((_, i) => i % info.channels === 0));
                fs.writeFileSync(part, { pgm: raster.pgm, pbm: raster.pbm, wbmp: raster.wbmp }[fmt](gray, info.width, info.height));
                break;
            }
            case 'ico': {
                const base256 = await img.png().toBuffer();
                const entries = [];
                for (const size of [256, 128, 64, 48, 32, 16]) {
                    const data = await sharp(base256).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toBuffer();
                    entries.push({ size, data });
                }
                fs.writeFileSync(part, raster.ico(entries));
                break;
            }
            case 'svg': {
                const png = await img.png().toBuffer();
                const m = await sharp(png).metadata();
                fs.writeFileSync(part, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${m.width}" height="${m.height}" viewBox="0 0 ${m.width} ${m.height}">\n  <image width="${m.width}" height="${m.height}" xlink:href="data:image/png;base64,${png.toString('base64')}"/>\n</svg>\n`);
                break;
            }
            case 'jp2': case 'jxl': {
                const png = await img.png().toBuffer();
                const args = fmt === 'jp2'
                    ? ['-c:v', 'jpeg2000', '-pix_fmt', 'rgb24', '-f', 'image2']
                    : ['-c:v', 'libjxl', '-distance', String(Math.max(0, Math.min(15, ((100 - q) / 100) * 6))), '-f', 'image2'];
                await encodeViaFfmpeg(png, args, part);
                break;
            }
            default:
                throw new Error(`Unsupported output format: ${fmt}`);
        }
        guard(id, startedAt);
        fs.renameSync(part, outputPath);
    } catch (err) {
        try { fs.unlinkSync(part); } catch (_) { /* nothing to remove */ }
        throw err;
    }
    emit(100);
    return { success: true, outputPath, outputSize: fs.statSync(outputPath).size };
}

/** Re-encode an image in its own format with smaller settings. */
async function compress(options, onProgress) {
    const startedAt = Date.now();
    const { id = 'compress', inputPath, outputDirectory } = options;
    const q = clampNumber(options.quality, 1, 100, 80);
    const inExt = path.extname(inputPath).slice(1).toLowerCase();
    let ext = ALIASES[inExt] || inExt;
    if (!['jpg', 'png', 'webp', 'avif', 'tiff', 'heif', 'gif'].includes(ext)) ext = 'png';

    ensureDir(outputDirectory);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outputPath = uniquePath(path.join(outputDirectory, `${base}_compressed.${OUT[ext].ext}`), [inputPath]);
    const part = `${outputPath}.part`;
    const emit = (percent) => { if (onProgress) onProgress({ percent }); };

    emit(10);
    let img = (await openInput(inputPath, { animated: ext === 'gif' })).rotate();
    guard(id, startedAt);
    if (ext === 'jpg') img = img.flatten({ background: '#ffffff' });
    emit(40);

    try {
        switch (ext) {
            case 'jpg': await img.jpeg({ quality: q, progressive: true, mozjpeg: true }).toFile(part); break;
            case 'png': await img.png({ compressionLevel: 9, effort: 8, adaptiveFiltering: true, palette: q < 60, quality: q }).toFile(part); break;
            case 'webp': await img.webp({ quality: q, effort: 6 }).toFile(part); break;
            case 'avif': await img.avif({ quality: q, effort: 7 }).toFile(part); break;
            case 'tiff': await img.tiff({ quality: q, compression: 'lzw' }).toFile(part); break;
            case 'heif': await img.heif({ quality: q, compression: 'av1' }).toFile(part); break;
            case 'gif': await img.gif({ colours: Math.max(16, Math.round(256 * (q / 100))), effort: 10 }).toFile(part); break;
            default: throw new Error('Unsupported image type');
        }
        guard(id, startedAt);
        fs.renameSync(part, outputPath);
    } catch (err) {
        try { fs.unlinkSync(part); } catch (_) { /* nothing to remove */ }
        throw err;
    }
    emit(100);
    const inputSize = fs.statSync(inputPath).size;
    const outputSize = fs.statSync(outputPath).size;
    return {
        success: true,
        outputPath,
        inputSize,
        outputSize,
        savedPercent: inputSize ? Math.round((1 - outputSize / inputSize) * 100) : 0
    };
}

async function scanQr(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'Image file not found' };
    try {
        const jsQR = require('jsqr');
        const img = await openInput(filePath);
        const { data, info } = await img.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'attemptBoth' });
        if (!decoded || !decoded.data) return { success: false, error: 'No QR code was found in this image' };
        return { success: true, data: decoded.data, location: decoded.location || null };
    } catch (err) {
        return { success: false, error: err.message || 'Failed to scan QR code' };
    }
}

module.exports = { getCatalog, getInfo, makeThumbnail, convert, compress, scanQr, cancel };
