'use strict';

/**
 * Music player streaming: search, resolve a playable URL, import playlists, and the
 * `stream-audio://` protocol that proxies those URLs to the renderer without CORS trouble.
 */

const { protocol, net } = require('electron');
const { handle } = require('../ipc/handle');
const logHandler = require('../logger');
const bin = require('../binaries');
const ytdlp = require('../engines/ytdlp');

const activeStreamUrls = new Map();

// Helper: detect URL type from a string
function detectUrlType(input) {
    try {
        if (!/^https?:\/\//i.test(input)) return { type: 'search', value: input };
        const url = new URL(input);
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('music.youtube.com')) {
            if (url.searchParams.get('list') || /\/playlist/i.test(url.pathname)) return { type: 'youtube-playlist', value: input };
            return { type: 'youtube', value: input };
        }
        if (host.includes('soundcloud.com')) return { type: 'soundcloud', value: input };
        // Generic URL — try to extract with yt-dlp
        return { type: 'direct-url', value: input };
    } catch {
        return { type: 'search', value: input };
    }
}

// Helper: run yt-dlp and return parsed JSON results
async function runYtdlp(_ytdlpPath, args, timeout = 30000) {
    const items = await ytdlp.runJsonLines(args, { timeout });
    return items
        .map((info) => ({
            id: info.id || info.url || '',
            title: info.title || info.track || 'Unknown',
            url: info.webpage_url || info.url || (info.id ? `https://www.youtube.com/watch?v=${info.id}` : ''),
            thumbnail: info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : (info.thumbnail || null),
            duration: info.duration || 0,
            uploader: info.uploader || info.channel || info.artist || info.creator || 'Unknown',
            view_count: info.view_count || 0,
            artist: info.artist || info.creator || info.uploader || '',
            album: info.album || ''
        }))
        .filter((r) => r.title !== '[Deleted video]' && r.title !== '[Private video]');
}

// Helper: ensure downloader is ready
async function ensureDownloader() {
    await bin.ensureYtdlp();
    return '';
}

handle('stream-search', async (query) => {
    if (logHandler) logHandler.info('stream', `Searching: ${query}`);

    const ytdlpPath = await ensureDownloader();
    const detected = detectUrlType(query);
    const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass'];

    if (detected.type === 'youtube' || detected.type === 'soundcloud' || detected.type === 'direct-url') {
        // Direct URL: extract info directly
        if (logHandler) logHandler.info('stream', `Extracting info from URL: ${detected.value}`);
        try {
            const results = await runYtdlp(ytdlpPath, [
                ...baseArgs,
                ...buildYouTubeCompatExtractorArgs(detected.value),
                '--socket-timeout', '20',
                detected.value
            ], 30000);
            if (results.length > 0) {
                // Ensure URLs are correct for YouTube
                results.forEach(r => {
                    if (r.id && !r.url.includes('http')) {
                        r.url = `https://www.youtube.com/watch?v=${r.id}`;
                    }
                });
                if (logHandler) logHandler.success('stream', `Extracted ${results.length} track(s) from URL`);
                return results;
            }
        } catch (err) {
            if (logHandler) logHandler.error('stream', `URL extraction failed: ${err.message}`);
            throw new Error('Could not extract info from this URL');
        }
    }

    if (detected.type === 'youtube-playlist') {
        // YouTube playlist: extract all entries
        if (logHandler) logHandler.info('stream', `Extracting YouTube playlist: ${detected.value}`);
        try {
            const results = await runYtdlp(ytdlpPath, [
                ...baseArgs,
                '--flat-playlist',
                ...buildYouTubeCompatExtractorArgs(detected.value),
                '--socket-timeout', '20',
                detected.value
            ], 60000);
            results.forEach(r => {
                if (r.id && (!r.url || !r.url.includes('http'))) {
                    r.url = `https://www.youtube.com/watch?v=${r.id}`;
                }
            });
            if (logHandler) logHandler.success('stream', `Extracted ${results.length} tracks from YouTube playlist`);
            return results;
        } catch (err) {
            throw new Error('Could not extract YouTube playlist: ' + err.message);
        }
    }

    // Plain text search
    if (logHandler) logHandler.info('stream', `Searching YouTube for: ${query}`);
    let results = [];
    try {
        results = await runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '15', `ytsearch15:${query}`], 30000);
    } catch (err) {
        if (logHandler) logHandler.warning('stream', `Search failed: ${err.message}`);
    }
    results.forEach((t) => { if (!t.source) t.source = 'youtube'; });
    if (results.length > 0) {
        if (logHandler) logHandler.success('stream', `Search: ${results.length} results`);
        return results;
    }

    throw new Error('No results found');
});

function createProxiedStreamUrl(realStreamUrl) {
    const streamId = 's' + Date.now() + Math.random().toString(36).slice(2, 8);
    activeStreamUrls.set(streamId, realStreamUrl);

    // Clean up old entries (keep last 20)
    if (activeStreamUrls.size > 20) {
        const first = activeStreamUrls.keys().next().value;
        activeStreamUrls.delete(first);
    }

    return `stream-audio://${streamId}/media`;
}

function normalizeStreamResolution(value) {
    const normalized = String(value || '').toLowerCase();
    return ['auto', '1080', '720', '480', '360'].includes(normalized) ? normalized : 'auto';
}

function buildProgressiveVideoFormatSelector(resolution) {
    const normalized = normalizeStreamResolution(resolution);
    if (normalized === 'auto') {
        return 'best[ext=mp4][acodec!=none][vcodec!=none]/best[acodec!=none][vcodec!=none]';
    }

    return [
        `best[ext=mp4][height<=${normalized}][acodec!=none][vcodec!=none]`,
        `best[height<=${normalized}][acodec!=none][vcodec!=none]`,
        'best[ext=mp4][acodec!=none][vcodec!=none]',
        'best[acodec!=none][vcodec!=none]'
    ].join('/');
}

function isYouTubeLikeTarget(value) {
    const text = String(value || '').trim().toLowerCase();
    return text.startsWith('ytsearch')
        || text.includes('youtube.com')
        || text.includes('youtu.be')
        || text.includes('music.youtube.com');
}

function buildYouTubeCompatExtractorArgs() {
    return []; // client selection is handled by the downloader's recovery ladder
}

function getYouTubeCompatFormatSelector(formatSelector) {
    if (formatSelector === 'bestaudio') {
        return 'bestaudio/best[acodec!=none]/best';
    }
    return formatSelector;
}

async function resolveYtdlpStreamUrl(_ytdlpPath, sourceUrl, formatSelector, extraArgs = []) {
    const id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { res } = await ytdlp.withRecovery({
        id,
        url: sourceUrl,
        buildArgs: () => [...extraArgs, '-f', formatSelector, '-g', '--no-warnings', '--geo-bypass', sourceUrl]
    });
    const lines = res.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const realStreamUrl = lines.find((line) => /^https?:\/\//i.test(line)) || lines[0];
    if (!realStreamUrl) throw new Error('Failed to get stream URL');
    return realStreamUrl;
}

// Get direct stream URL for a video or audio stream
handle('get-stream-url', async (videoUrl, streamOptions = 'audio') => {
    const requestedMode = typeof streamOptions === 'object' && streamOptions !== null
        ? (streamOptions.mode === 'video' ? 'video' : 'audio')
        : (streamOptions === 'video' ? 'video' : 'audio');
    const requestedResolution = typeof streamOptions === 'object' && streamOptions !== null
        ? normalizeStreamResolution(streamOptions.resolution)
        : 'auto';
    if (logHandler) logHandler.info('stream', `Getting ${requestedMode} stream URL for: ${videoUrl}`, {
        requestedResolution
    });

    const ytdlpPath = await ensureDownloader();

    const attempts = requestedMode === 'video'
        ? [
            {
                mediaType: 'video',
                format: buildProgressiveVideoFormatSelector(requestedResolution)
            },
            {
                mediaType: 'audio',
                format: 'bestaudio'
            }
        ]
        : [
            {
                mediaType: 'audio',
                format: 'bestaudio'
            }
        ];

    let lastError = null;
    for (const attempt of attempts) {
        try {
            const realStreamUrl = await resolveYtdlpStreamUrl(ytdlpPath, videoUrl, attempt.format);
            const proxyUrl = createProxiedStreamUrl(realStreamUrl);
            const didFallback = requestedMode !== attempt.mediaType;
            if (logHandler) {
                logHandler.success('stream', `Got ${attempt.mediaType} stream URL, proxied as: ${proxyUrl}`, {
                    requestedMode,
                    requestedResolution,
                    didFallback
                });
            }
            return {
                streamUrl: proxyUrl,
                mediaType: attempt.mediaType,
                didFallback,
                requestedResolution
            };
        } catch (err) {
            lastError = err;
            if (isYouTubeLikeTarget(videoUrl)) {
                try {
                    const compatFormat = getYouTubeCompatFormatSelector(attempt.format);
                    const realStreamUrl = await resolveYtdlpStreamUrl(
                        ytdlpPath,
                        videoUrl,
                        compatFormat,
                        buildYouTubeCompatExtractorArgs(videoUrl)
                    );
                    const proxyUrl = createProxiedStreamUrl(realStreamUrl);
                    const didFallback = requestedMode !== attempt.mediaType;
                    if (logHandler) {
                        logHandler.success('stream', `Recovered ${attempt.mediaType} stream URL with YouTube compatibility mode`, {
                            requestedMode,
                            requestedResolution,
                            didFallback,
                            sourceUrl: videoUrl
                        });
                    }
                    return {
                        streamUrl: proxyUrl,
                        mediaType: attempt.mediaType,
                        didFallback,
                        requestedResolution
                    };
                } catch (compatErr) {
                    lastError = compatErr;
                    if (logHandler) {
                        logHandler.warning('stream', 'YouTube compatibility mode failed for stream playback', {
                            requestedMode,
                            requestedResolution,
                            sourceUrl: videoUrl,
                            error: compatErr.message
                        });
                    }
                }
            }
            if (logHandler) {
                logHandler.warning('stream', `Failed to resolve ${attempt.mediaType} stream`, {
                    requestedMode,
                    requestedResolution,
                    sourceUrl: videoUrl,
                    error: err.message
                });
            }
        }
    }

    throw new Error(lastError?.message || 'Failed to get stream URL');
});

// Import playlist from a YouTube/SoundCloud (or any yt-dlp supported) URL
handle('import-playlist', async (playlistUrl) => {
    if (logHandler) logHandler.info('stream', `Importing playlist: ${playlistUrl}`);

    const ytdlpPath = await ensureDownloader();
    const detected = detectUrlType(playlistUrl);
    const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass'];

    // Standard extraction
    try {
        const isPlaylist = detected.type === 'youtube-playlist';
        const results = await runYtdlp(ytdlpPath, [
            ...baseArgs,
            ...(isPlaylist ? ['--flat-playlist'] : []),
            '--socket-timeout', '30',
            playlistUrl
        ], 60000);

        // Fix URLs for YouTube entries
        results.forEach(r => {
            if (r.id && (!r.url || !r.url.includes('http'))) {
                r.url = `https://www.youtube.com/watch?v=${r.id}`;
            }
        });

        if (logHandler) logHandler.success('stream', `Imported ${results.length} tracks from playlist`);
        return results;
    } catch (err) {
        throw new Error('Failed to import playlist: ' + err.message);
    }
});

// Get playlist info

/** Must run before `app.whenReady`. */
function registerScheme() {
    protocol.registerSchemesAsPrivileged([{ scheme: 'stream-audio', privileges: { stream: true, supportFetchAPI: true, corsEnabled: false, bypassCSP: true } }]);
}

/** Run after the app is ready. */
function registerProtocol() {
    protocol.handle('stream-audio', async (request) => {
        const realUrl = activeStreamUrls.get(new URL(request.url).hostname);
        if (!realUrl) return new Response('Stream not found', { status: 404 });
        try {
            return await net.fetch(realUrl, { headers: request.headers });
        } catch (err) {
            return new Response(`Stream error: ${err.message}`, { status: 502 });
        }
    });
}

module.exports = { registerScheme, registerProtocol };
