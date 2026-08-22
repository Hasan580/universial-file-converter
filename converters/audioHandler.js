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
const { ffmpegPath, ffprobePath } = refreshFfmpegPaths();

console.log('FFmpeg configured:', ffmpegPath);
console.log('FFprobe configured:', ffprobePath);

// Audio format configurations
const audioConfigs = {
    mp3: { codec: 'libmp3lame', extension: 'mp3', category: 'popular' },
    wav: { codec: 'pcm_s16le', extension: 'wav', category: 'lossless' },
    flac: { codec: 'flac', extension: 'flac', category: 'lossless' },
    aac: { codec: 'aac', extension: 'aac', category: 'popular' },
    m4a: { codec: 'aac', extension: 'm4a', container: 'ipod', category: 'popular' },
    alac: { codec: 'alac', extension: 'm4a', container: 'ipod', category: 'lossless' },
    ogg: { codec: 'libvorbis', extension: 'ogg', category: 'open' },
    opus: { codec: 'libopus', extension: 'opus', category: 'modern' },
    wma: { codec: 'wmav2', extension: 'wma', category: 'legacy' },
    aiff: { codec: 'pcm_s16be', extension: 'aiff', category: 'lossless' },
    ac3: { codec: 'ac3', extension: 'ac3', category: 'surround' },
    dts: { codec: 'dca', extension: 'dts', category: 'surround' },
    amr: { codec: 'libopencore_amrnb', extension: 'amr', category: 'voice' },
    wv: { codec: 'wavpack', extension: 'wv', category: 'lossless' },
    ape: { codec: 'ape', extension: 'ape', category: 'lossless' },
    mka: { codec: 'libvorbis', extension: 'mka', container: 'matroska', category: 'modern' },
    au: { codec: 'pcm_s16be', extension: 'au', category: 'legacy' },
    caf: { codec: 'alac', extension: 'caf', category: 'apple' },
    voc: { codec: 'pcm_u8', extension: 'voc', category: 'legacy' },
    ra: { codec: 'real_144', extension: 'ra', category: 'legacy' },
    mp2: { codec: 'mp2', extension: 'mp2', category: 'broadcast' },
    oga: { codec: 'libvorbis', extension: 'oga', category: 'open' },
    tta: { codec: 'tta', extension: 'tta', category: 'lossless' },
    w64: { codec: 'pcm_s16le', extension: 'w64', category: 'pro' },
    spx: { codec: 'libspeex', extension: 'spx', category: 'voice' }
};

// Get audio file metadata
async function getMetadata(filePath) {
    refreshFfmpegPaths();
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata);
        });
    });
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

// Convert audio file
async function convert(options, progressCallback) {
    refreshFfmpegPaths();
    const {
        inputPath,
        outputFormat,
        outputDirectory,
        bitrate = '192k',
        sampleRate = 44100,
        channels = 2,
        volume = null,
        normalize = false,
        preserveMetadata = true
    } = options;

    const fmtKey = outputFormat.toLowerCase();
    const config = audioConfigs[fmtKey];
    if (!config) {
        throw new Error(`Unsupported output format: ${outputFormat}`);
    }

    const inputName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDirectory, `${inputName}.${config.extension}`);

    // Ensure output directory exists
    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        let command = ffmpeg(inputPath)
            .audioCodec(config.codec);

        // Set channels if valid
        const ch = parseInt(channels, 10);
        if (Number.isFinite(ch) && ch > 0 && ch <= 8) {
            command = command.audioChannels(ch);
        }

        // Set sample frequency if valid
        const sr = parseInt(sampleRate, 10);
        if (Number.isFinite(sr) && sr > 0) {
            command = command.audioFrequency(sr);
        }

        // Apply bitrate for lossy and compressed formats
        if (['mp3', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'ac3', 'amr', 'mka', 'ra', 'mp2', 'oga', 'spx'].includes(fmtKey)) {
            const formattedBitrate = typeof bitrate === 'string' && bitrate.endsWith('k') ? bitrate : `${bitrate}k`;
            command = command.audioBitrate(formattedBitrate);
        }

        // Special container format assignments
        if (config.container) {
            command = command.format(config.container);
        } else if (fmtKey === 'm4a' || fmtKey === 'alac') {
            command = command.format('ipod');
        } else if (fmtKey === 'mka') {
            command = command.format('matroska');
        } else if (fmtKey === 'w64') {
            command = command.format('w64');
        } else if (fmtKey === 'caf') {
            command = command.format('caf');
        }

        // Audio filters (Volume boost / Normalization)
        const audioFilters = [];
        if (normalize) {
            audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        }
        if (volume && volume !== '100%' && volume !== 1) {
            audioFilters.push(`volume=${volume}`);
        }
        if (audioFilters.length > 0) {
            command = command.audioFilters(audioFilters);
        }

        // Track active command for cancellation
        activeCommands.add(command);

        command
            .on('start', (cmd) => {
                console.log('FFmpeg command:', cmd);
            })
            .on('progress', (progress) => {
                if (progressCallback) {
                    progressCallback(Math.round(progress.percent || 0));
                }
            })
            .on('error', (err, stdout, stderr) => {
                activeCommands.delete(command);
                console.error('Audio conversion error:', err.message);
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

// Get supported formats
function getSupportedFormats() {
    return Object.keys(audioConfigs);
}

module.exports = {
    convert,
    getMetadata,
    getSupportedFormats,
    cancelConversion
};
