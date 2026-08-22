const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const ffmpegPaths = require('./ffmpegPaths');

function refreshFfmpegPaths() {
    const ffmpegPath = ffmpegPaths.getFfmpegPath();
    const ffprobePath = ffmpegPaths.getFfprobePath();
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    return { ffmpegPath, ffprobePath };
}

// Set FFmpeg paths
refreshFfmpegPaths();

// Video format configurations
const videoConfigs = {
    mp4: { format: 'mp4', vcodec: 'libx264', acodec: 'aac', ext: 'mp4', category: 'popular' },
    mkv: { format: 'matroska', vcodec: 'libx264', acodec: 'aac', ext: 'mkv', category: 'popular' },
    webm: { format: 'webm', vcodec: 'libvpx-vp9', acodec: 'libopus', ext: 'webm', category: 'web' },
    hevc: { format: 'mp4', vcodec: 'libx265', acodec: 'aac', ext: 'mp4', category: 'modern' },
    av1: { format: 'mp4', vcodec: 'libsvtav1', acodec: 'aac', ext: 'mp4', category: 'modern' },
    mov: { format: 'mov', vcodec: 'libx264', acodec: 'aac', ext: 'mov', category: 'apple' },
    prores: { format: 'mov', vcodec: 'prores_ks', acodec: 'pcm_s16le', ext: 'mov', category: 'pro' },
    dnxhd: { format: 'mov', vcodec: 'dnxhd', acodec: 'pcm_s16le', ext: 'mov', category: 'pro' },
    avi: { format: 'avi', vcodec: 'mpeg4', acodec: 'libmp3lame', ext: 'avi', category: 'legacy' },
    wmv: { format: 'asf', vcodec: 'wmv2', acodec: 'wmav2', ext: 'wmv', category: 'legacy' },
    flv: { format: 'flv', vcodec: 'flv1', acodec: 'libmp3lame', ext: 'flv', category: 'legacy' },
    mxf: { format: 'mxf', vcodec: 'mpeg2video', acodec: 'pcm_s16le', ext: 'mxf', category: 'pro' },
    ts: { format: 'mpegts', vcodec: 'libx264', acodec: 'aac', ext: 'ts', category: 'broadcast' },
    mts: { format: 'mpegts', vcodec: 'libx264', acodec: 'aac', ext: 'mts', category: 'camcorder' },
    m2ts: { format: 'mpegts', vcodec: 'libx264', acodec: 'ac3', ext: 'm2ts', category: 'camcorder' },
    m4v: { format: 'mp4', vcodec: 'libx264', acodec: 'aac', ext: 'm4v', category: 'apple' },
    '3gp': { format: '3gp', vcodec: 'libx264', acodec: 'aac', ext: '3gp', category: 'mobile' },
    mpeg: { format: 'mpeg', vcodec: 'mpeg2video', acodec: 'mp2', ext: 'mpeg', category: 'broadcast' },
    mpg: { format: 'mpeg', vcodec: 'mpeg1video', acodec: 'mp2', ext: 'mpg', category: 'broadcast' },
    vob: { format: 'vob', vcodec: 'mpeg2video', acodec: 'ac3', ext: 'vob', category: 'dvd' },
    ogv: { format: 'ogg', vcodec: 'libtheora', acodec: 'libvorbis', ext: 'ogv', category: 'open' },
    gif: { format: 'gif', vcodec: 'gif', acodec: null, ext: 'gif', category: 'animation' },
    apng: { format: 'apng', vcodec: 'apng', acodec: null, ext: 'png', category: 'animation' },
    swf: { format: 'swf', vcodec: 'flv1', acodec: 'libmp3lame', ext: 'swf', category: 'legacy' },
    dv: { format: 'dv', vcodec: 'dvvideo', acodec: 'pcm_s16le', ext: 'dv', category: 'camcorder' },
    f4v: { format: 'flv', vcodec: 'libx264', acodec: 'aac', ext: 'f4v', category: 'web' }
};

const resolutionPresets = {
    '360p': { width: 640, height: 360, label: '360p (SD)' },
    '480p': { width: 854, height: 480, label: '480p (SD)' },
    '720p': { width: 1280, height: 720, label: '720p (HD)' },
    '1080p': { width: 1920, height: 1080, label: '1080p (Full HD)' },
    '1440p': { width: 2560, height: 1440, label: '1440p (2K)' },
    '4k': { width: 3840, height: 2160, label: '4K (Ultra HD)' },
    '8k': { width: 7680, height: 4320, label: '8K (Full UHD)' }
};

async function getMetadata(filePath) {
    refreshFfmpegPaths();
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata);
        });
    });
}

// Check if a codec is available in the current ffmpeg build
function checkCodecAvailable(codecName) {
    const { execSync } = require('child_process');
    try {
        const { ffmpegPath } = refreshFfmpegPaths();
        const output = execSync(`"${ffmpegPath}" -encoders`, { maxBuffer: 1024 * 1024, encoding: 'utf8' });
        return output.includes(codecName);
    } catch (e) {
        const s = (e.stdout || '') + (e.stderr || '') + (e.message || '');
        return s.includes(codecName);
    }
}

// Codec fallback chains: if the requested codec isn't available, try the next one
const codecFallbacks = {
    'libsvtav1': ['libaom-av1', 'libx265', 'libx264'],
    'libaom-av1': ['libsvtav1', 'libx265', 'libx264'],
    'libx265': ['libx264'],
    'libvpx-vp9': ['libx264'],
};

// Cache codec availability to avoid repeated execSync calls
const codecAvailabilityCache = {};

function getAvailableCodec(requestedCodec) {
    // Check cache first
    if (codecAvailabilityCache[requestedCodec] !== undefined) {
        return codecAvailabilityCache[requestedCodec];
    }
    
    if (checkCodecAvailable(requestedCodec)) {
        codecAvailabilityCache[requestedCodec] = requestedCodec;
        return requestedCodec;
    }
    
    // Try fallbacks
    const fallbacks = codecFallbacks[requestedCodec] || ['libx264'];
    for (const fallback of fallbacks) {
        if (codecAvailabilityCache[fallback] !== undefined) {
            if (codecAvailabilityCache[fallback]) {
                codecAvailabilityCache[requestedCodec] = fallback;
                return fallback;
            }
            continue;
        }
        if (checkCodecAvailable(fallback)) {
            codecAvailabilityCache[fallback] = fallback;
            codecAvailabilityCache[requestedCodec] = fallback;
            console.log(`Codec ${requestedCodec} not available, using fallback: ${fallback}`);
            return fallback;
        }
        codecAvailabilityCache[fallback] = false;
    }
    
    // Last resort
    codecAvailabilityCache[requestedCodec] = 'libx264';
    console.warn(`No suitable codec found for ${requestedCodec}, falling back to libx264`);
    return 'libx264';
}

// Track active ffmpeg commands for cancellation
const activeCommands = new Set();

function cancelConversion() {
    let cancelledAny = false;
    for (const command of activeCommands) {
        try {
            command.kill('SIGKILL');
            cancelledAny = true;
        } catch (e) {
            console.error('Error killing ffmpeg process:', e.message);
        }
    }
    activeCommands.clear();
    return cancelledAny;
}

async function convert(options, progressCallback) {
    refreshFfmpegPaths();
    const {
        inputPath,
        outputFormat,
        outputDirectory,
        resolution = 'original',
        videoBitrate = '2500k',
        audioBitrate = '192k',
        fps = 'original',
        codec = 'default',
        quality = 75
    } = options;

    const config = videoConfigs[outputFormat.toLowerCase()];
    if (!config) {
        throw new Error(`Unsupported output format: ${outputFormat}`);
    }

    const inputName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDirectory, `${inputName}.${outputFormat.toLowerCase()}`);

    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    const metadata = await getMetadata(inputPath);
    const duration = metadata.format.duration;

    return new Promise((resolve, reject) => {
        const requestedCodec = codec !== 'default' ? codec : config.vcodec;
        const selectedCodec = getAvailableCodec(requestedCodec);
        let command = ffmpeg(inputPath)
            .format(config.format)
            .videoCodec(selectedCodec);
        
        // Track active command for cancellation
        activeCommands.add(command);

        // Handle formats without audio (e.g., GIF)
        if (config.acodec === null) {
            command = command.noAudio();
        } else {
            command = command
                .audioCodec(config.acodec)
                .audioBitrate(audioBitrate);
        }

        // Map quality (1-100) to bitrate multiplier
        const qualityNum = parseInt(quality) || 75;
        const bitrateMultiplier = 0.3 + (qualityNum / 100) * 1.7; // 0.3x at q=0 to 2.0x at q=100
        const adjustedBitrate = Math.round(parseInt(videoBitrate) * bitrateMultiplier) + 'k';
        command = command.videoBitrate(adjustedBitrate);

        if (resolution !== 'original' && resolutionPresets[resolution]) {
            const res = resolutionPresets[resolution];
            command = command.size(`${res.width}x${res.height}`);
        }

        if (fps !== 'original') {
            command = command.fps(parseInt(fps));
        }

        if (selectedCodec === 'libx264' || (codec === 'default' && config.vcodec === 'libx264')) {
            // Map quality (1-100) to CRF (51=worst, 0=best). Range: quality 1->45, quality 100->15
            const crf = Math.round(45 - (qualityNum / 100) * 30);
            const preset = qualityNum > 80 ? 'slow' : qualityNum > 50 ? 'medium' : 'fast';
            command = command.outputOptions([`-preset ${preset}`, `-crf ${crf}`, '-movflags +faststart']);
        }

        // AV1 encoding (SVT-AV1 or libaom-av1)
        if (selectedCodec === 'libsvtav1' || selectedCodec === 'libaom-av1') {
            // Map quality (1-100) to CRF for AV1 (63=worst, 0=best). Range: quality 1->55, quality 100->18
            const av1Crf = Math.round(55 - (qualityNum / 100) * 37);
            if (selectedCodec === 'libsvtav1') {
                const svtPreset = qualityNum > 80 ? 6 : qualityNum > 50 ? 8 : 10; // lower = slower/better
                command = command.outputOptions([`-crf ${av1Crf}`, `-preset ${svtPreset}`, `-svtav1-params tune=0`]);
            } else {
                const cpuUsed = qualityNum > 80 ? 3 : qualityNum > 50 ? 5 : 7;
                command = command.outputOptions([`-crf ${av1Crf}`, `-cpu-used ${cpuUsed}`, '-row-mt 1']);
            }
        }

        // H.265 (HEVC) encoding
        if (selectedCodec === 'libx265') {
            const hevCrf = Math.round(40 - (qualityNum / 100) * 22);
            const hevcPreset = qualityNum > 80 ? 'slow' : qualityNum > 50 ? 'medium' : 'fast';
            command = command.outputOptions([`-preset ${hevcPreset}`, `-crf ${hevCrf}`, '-tag:v hvc1']);
        }

        if (selectedCodec === 'prores_ks') {
            command = command.outputOptions(['-profile:v 3', '-pix_fmt yuv422p10le']);
        }

        if (selectedCodec === 'dnxhd') {
            command = command.outputOptions(['-b:v 120M', '-pix_fmt yuv422p']);
        }

        if (outputFormat.toLowerCase() === 'webm') {
            const webmCrf = Math.round(50 - (qualityNum / 100) * 40);
            command = command.outputOptions(['-deadline good', '-cpu-used 2', `-crf ${webmCrf}`, `-b:v ${adjustedBitrate}`]);
        }

        if (config.format === 'gif') {
            command = command.outputOptions(['-filter_complex [0:v]fps=15,scale=flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3']);
        }

        command
            .on('start', (cmd) => console.log('FFmpeg command:', cmd))
            .on('progress', (progress) => {
                if (progressCallback) {
                    let percent = progress.percent ? Math.round(progress.percent) : 0;
                    if (!percent && progress.timemark && duration) {
                        const parts = progress.timemark.split(':');
                        const time = parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
                        percent = Math.round((time / duration) * 100);
                    }
                    progressCallback(Math.min(percent, 99));
                }
            })
            .on('error', (err, stdout, stderr) => {
                activeCommands.delete(command);
                console.error('Video conversion error:', err.message);
                console.error('FFmpeg stderr:', stderr);
                // Check if this was a cancellation
                if (err.message && (err.message.includes('SIGKILL') || err.message.includes('SIGTERM'))) {
                    reject(new Error('Conversion cancelled'));
                } else {
                    reject(new Error(`Conversion failed: ${err.message}`));
                }
            })
            .on('end', () => {
                activeCommands.delete(command);
                resolve({
                    success: true,
                    outputPath,
                    outputSize: fs.statSync(outputPath).size
                });
            })
            .save(outputPath);
    });
}

async function extractAudio(options, progressCallback) {
    refreshFfmpegPaths();
    const { inputPath, outputFormat, outputDirectory } = options;
    const inputName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDirectory, `${inputName}.${outputFormat}`);

    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        const command = ffmpeg(inputPath)
            .noVideo()
            .audioCodec(outputFormat === 'mp3' ? 'libmp3lame' : 'aac')
            .audioBitrate('192k');

        activeCommands.add(command);

        command
            .on('progress', (progress) => {
                if (progressCallback) progressCallback(Math.round(progress.percent || 0));
            })
            .on('error', (err) => {
                activeCommands.delete(command);
                reject(err);
            })
            .on('end', () => {
                activeCommands.delete(command);
                resolve({ success: true, outputPath, outputSize: fs.statSync(outputPath).size });
            })
            .save(outputPath);
    });
}

function getSupportedFormats() { return Object.keys(videoConfigs); }
function getResolutionPresets() { return Object.keys(resolutionPresets); }

module.exports = { convert, extractAudio, getMetadata, getSupportedFormats, getResolutionPresets, cancelConversion };
