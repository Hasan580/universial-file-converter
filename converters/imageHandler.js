const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Cancellation flag for image operations
let cancelled = false;

function cancelConversion() {
    cancelled = true;
    return true;
}

function resetCancellation() {
    cancelled = false;
}

// Supported image formats
const imageFormats = [
    'png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'tiff', 'bmp',
    'heif', 'heic', 'jxl', 'jp2', 'ico', 'svg', 'tga', 'hdr',
    'exr', 'ppm', 'pgm', 'pbm', 'wbmp', 'eps', 'psd'
];
const specialFormats = ['ico', 'svg', 'bmp', 'tga', 'ppm', 'pgm', 'pbm'];

// Format-specific options
const formatOptions = {
    jpg: { quality: 85, progressive: true },
    jpeg: { quality: 85, progressive: true },
    png: { compressionLevel: 9, progressive: false },
    webp: { quality: 85, lossless: false },
    avif: { quality: 65 },
    tiff: { compression: 'lzw' },
    gif: { colors: 256 },
    heif: { quality: 80 },
    heic: { quality: 80 },
    jxl: { quality: 85 },
    jp2: { quality: 85 }
};

// Get image metadata
async function getMetadata(filePath) {
    try {
        const metadata = await sharp(filePath).metadata();
        return metadata;
    } catch (err) {
        throw new Error(`Failed to read image metadata: ${err.message}`);
    }
}

// Convert image
async function convert(options, progressCallback) {
    const {
        inputPath,
        outputFormat,
        outputDirectory,
        quality = 85,
        width = null,
        height = null,
        maintainAspectRatio = true,
        compression = 'default',
        rotate = 0,
        flip = false,
        flop = false,
        grayscale = false,
        dpi = 300
    } = options;

    const format = outputFormat.toLowerCase();
    const inputName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDirectory, `${inputName}.${format}`);

    // Ensure output directory exists
    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    if (cancelled) {
        throw new Error('Conversion cancelled');
    }

    // Report starting
    if (progressCallback) progressCallback(10);

    try {
        let pipeline = sharp(inputPath, { density: parseInt(dpi) || 300 });

        // Auto orient EXIF
        pipeline = pipeline.rotate();

        // Handle custom rotation
        if (rotate && parseInt(rotate) !== 0) {
            pipeline = pipeline.rotate(parseInt(rotate));
        }

        // Handle flip/flop
        if (flip) pipeline = pipeline.flip();
        if (flop) pipeline = pipeline.flop();

        // Handle grayscale
        if (grayscale) pipeline = pipeline.grayscale();

        // Handle resize
        if (width || height) {
            const resizeOptions = {
                width: width ? parseInt(width, 10) : undefined,
                height: height ? parseInt(height, 10) : undefined,
                fit: maintainAspectRatio ? 'inside' : 'fill',
                withoutEnlargement: false
            };
            pipeline = pipeline.resize(resizeOptions);
        }

        if (cancelled) {
            throw new Error('Conversion cancelled');
        }

        if (progressCallback) progressCallback(30);

        // Handle ICO format specially - build proper ICO binary
        if (format === 'ico') {
            const sizes = [256, 128, 64, 48, 32, 16];
            const pngBuffers = [];

            for (const size of sizes) {
                const buf = await sharp(inputPath)
                    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .png({ compressionLevel: 9 })
                    .toBuffer();
                pngBuffers.push({ size, data: buf });
            }

            if (progressCallback) progressCallback(60);

            const numImages = pngBuffers.length;
            const headerSize = 6;
            const dirEntrySize = 16;
            const dirSize = dirEntrySize * numImages;
            let dataOffset = headerSize + dirSize;

            const header = Buffer.alloc(headerSize);
            header.writeUInt16LE(0, 0);
            header.writeUInt16LE(1, 2);
            header.writeUInt16LE(numImages, 4);

            const dirEntries = Buffer.alloc(dirSize);
            const imageDataParts = [];

            for (let i = 0; i < numImages; i++) {
                const { size, data } = pngBuffers[i];
                const offset = i * dirEntrySize;

                dirEntries.writeUInt8(size >= 256 ? 0 : size, offset);
                dirEntries.writeUInt8(size >= 256 ? 0 : size, offset + 1);
                dirEntries.writeUInt8(0, offset + 2);
                dirEntries.writeUInt8(0, offset + 3);
                dirEntries.writeUInt16LE(1, offset + 4);
                dirEntries.writeUInt16LE(32, offset + 6);
                dirEntries.writeUInt32LE(data.length, offset + 8);
                dirEntries.writeUInt32LE(dataOffset, offset + 12);

                dataOffset += data.length;
                imageDataParts.push(data);
            }

            const icoBuffer = Buffer.concat([header, dirEntries, ...imageDataParts]);
            const icoPath = path.join(outputDirectory, `${inputName}.ico`);
            await fs.promises.writeFile(icoPath, icoBuffer);

            if (progressCallback) progressCallback(100);

            return {
                success: true,
                outputPath: icoPath,
                outputSize: icoBuffer.length
            };
        }

        // Handle SVG vector format
        if (format === 'svg') {
            const pngBuf = await pipeline.png().toBuffer();
            const base64 = pngBuf.toString('base64');
            const meta = await sharp(pngBuf).metadata();
            const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${meta.width}" height="${meta.height}" viewBox="0 0 ${meta.width} ${meta.height}">\n  <image width="${meta.width}" height="${meta.height}" xlink:href="data:image/png;base64,${base64}"/>\n</svg>`;
            const svgPath = path.join(outputDirectory, `${inputName}.svg`);
            await fs.promises.writeFile(svgPath, svgContent, 'utf8');

            if (progressCallback) progressCallback(100);
            return {
                success: true,
                outputPath: svgPath,
                outputSize: Buffer.byteLength(svgContent)
            };
        }

        // Apply format-specific options
        const qNum = parseInt(quality, 10) || 85;
        switch (format) {
            case 'jpg':
            case 'jpeg':
                pipeline = pipeline.jpeg({
                    quality: qNum,
                    progressive: true,
                    mozjpeg: compression === 'high'
                });
                break;

            case 'png':
                const pngCompressionLevel = Math.max(1, Math.min(9, Math.round(9 - (qNum / 100) * 6)));
                pipeline = pipeline.png({
                    compressionLevel: compression === 'high' ? 9 : pngCompressionLevel,
                    progressive: false,
                    palette: qNum < 50
                });
                break;

            case 'webp':
                pipeline = pipeline.webp({
                    quality: qNum,
                    lossless: qNum >= 100,
                    effort: compression === 'high' ? 6 : 4
                });
                break;

            case 'avif':
                pipeline = pipeline.avif({
                    quality: Math.min(qNum, 90),
                    effort: compression === 'high' ? 9 : 5,
                    lossless: qNum >= 100
                });
                break;

            case 'tiff':
            case 'tif':
                pipeline = pipeline.tiff({
                    quality: qNum,
                    compression: 'lzw'
                });
                break;

            case 'gif':
                pipeline = pipeline.gif({
                    colors: 256
                });
                break;

            case 'heif':
            case 'heic':
                pipeline = pipeline.heif({
                    quality: qNum,
                    compression: 'av1'
                });
                break;

            case 'jxl':
                pipeline = pipeline.jxl({
                    quality: qNum,
                    effort: compression === 'high' ? 9 : 7
                });
                break;

            case 'jp2':
                pipeline = pipeline.jp2({
                    quality: qNum
                });
                break;

            case 'bmp':
            case 'tga':
            case 'ppm':
            case 'pgm':
            case 'pbm':
            case 'wbmp':
            case 'psd':
            case 'hdr':
            case 'exr':
            case 'eps':
                // Use sharp PNG intermediate buffer or save compatible file
                pipeline = pipeline.png({ compressionLevel: 6 });
                break;

            default:
                throw new Error(`Unsupported format: ${format}`);
        }

        if (progressCallback) progressCallback(70);

        // Save the file
        await pipeline.toFile(outputPath);

        if (progressCallback) progressCallback(100);

        const stats = fs.statSync(outputPath);

        return {
            success: true,
            outputPath,
            outputSize: stats.size
        };

    } catch (err) {
        throw new Error(`Image conversion failed: ${err.message}`);
    }
}

// Batch resize images
async function batchResize(files, options, progressCallback) {
    resetCancellation();
    const results = [];
    const total = files.length;

    for (let i = 0; i < files.length; i++) {
        if (cancelled) {
            results.push({ file: files[i], success: false, error: 'Conversion cancelled' });
            break;
        }
        const file = files[i];
        try {
            const result = await convert({
                ...options,
                inputPath: file
            }, (p) => {
                const overallProgress = ((i * 100) + p) / total;
                if (progressCallback) progressCallback(Math.round(overallProgress));
            });
            results.push({ file, ...result });
        } catch (err) {
            results.push({ file, success: false, error: err.message });
            if (err.message === 'Conversion cancelled') break;
        }
    }

    return results;
}

// Compress image (optimize without format change)
async function compress(inputPath, outputDirectory, quality = 80, progressCallback = null) {
    const ext = path.extname(inputPath).toLowerCase().slice(1);
    const inputName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDirectory, `${inputName}_compressed.${ext}`);

    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    if (progressCallback) progressCallback(10);

    let pipeline = sharp(inputPath);

    switch (ext) {
        case 'jpg':
        case 'jpeg':
            pipeline = pipeline.jpeg({ quality, progressive: true, mozjpeg: true });
            break;
        case 'png':
            pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: quality < 60 });
            break;
        case 'webp':
            pipeline = pipeline.webp({ quality, effort: 6 });
            break;
        case 'avif':
            pipeline = pipeline.avif({ quality, effort: 9 });
            break;
        case 'tiff':
            pipeline = pipeline.tiff({ quality, compression: 'lzw' });
            break;
        case 'heif':
        case 'heic':
            pipeline = pipeline.heif({ quality, compression: 'av1' });
            break;
        case 'jxl':
            pipeline = pipeline.jxl({ quality, effort: 9 });
            break;
        case 'gif':
            pipeline = pipeline.gif({ colours: Math.max(16, Math.round(256 * (quality / 100))) });
            break;
        default:
            // For unsupported formats, convert to PNG with max compression
            pipeline = pipeline.png({ compressionLevel: 9 });
    }

    if (progressCallback) progressCallback(50);

    await pipeline.toFile(outputPath);

    if (progressCallback) progressCallback(100);

    const inputStats = fs.statSync(inputPath);
    const outputStats = fs.statSync(outputPath);

    return {
        success: true,
        outputPath,
        inputSize: inputStats.size,
        outputSize: outputStats.size,
        savedPercent: Math.round((1 - outputStats.size / inputStats.size) * 100)
    };
}

// Get supported formats
function getSupportedFormats() {
    return [...imageFormats, ...specialFormats];
}

module.exports = {
    convert,
    compress,
    batchResize,
    getMetadata,
    getSupportedFormats,
    cancelConversion,
    resetCancellation
};
