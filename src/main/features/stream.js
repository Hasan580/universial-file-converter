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
const getSpotifyHandler = () => require('../engines/spotify');

// Helper: parse "3:24" or "1:02:15" duration strings to seconds
function parseDurationToSeconds(str) {
    if (!str || typeof str !== 'string') return 0;
    const parts = str.split(':').map(Number);
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + (parts[2] || 0);
    if (parts.length === 2) return (parts[0] * 60) + (parts[1] || 0);
    return parts[0] || 0;
}

function normalizeMatchText(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeMatchText(value) {
    return normalizeMatchText(value)
        .split(' ')
        .map((part) => part.trim())
        .filter((part) => part.length > 1);
}

function getTokenOverlapRatio(left, right) {
    const leftSet = new Set(left || []);
    const rightSet = new Set(right || []);
    if (!leftSet.size || !rightSet.size) return 0;

    let overlap = 0;
    for (const token of leftSet) {
        if (rightSet.has(token)) overlap += 1;
    }

    return overlap / Math.max(1, leftSet.size);
}

function parseIsoDurationToSeconds(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const match = text.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (!match) return 0;
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    return (hours * 3600) + (minutes * 60) + seconds;
}

function scoreYouTubeCandidate(candidate, target) {
    const targetTitle = String(target?.title || '').trim();
    const targetArtist = String(target?.artist || '').trim();
    const targetDuration = Number(target?.duration || 0);

    const candidateTitle = String(candidate?.title || '').trim();
    const candidateUploader = String(candidate?.uploader || candidate?.artist || '').trim();
    const candidateDuration = Number(candidate?.duration || 0);

    const targetTitleNorm = normalizeMatchText(targetTitle);
    const targetArtistNorm = normalizeMatchText(targetArtist);
    const candidateTitleNorm = normalizeMatchText(candidateTitle);
    const candidateUploaderNorm = normalizeMatchText(candidateUploader);

    const targetTitleTokens = tokenizeMatchText(targetTitleNorm);
    const targetArtistTokens = tokenizeMatchText(targetArtistNorm);
    const candidateTitleTokens = tokenizeMatchText(candidateTitleNorm);
    const candidateCombinedTokens = tokenizeMatchText(`${candidateTitleNorm} ${candidateUploaderNorm}`);

    let score = 0;

    const titleOverlap = getTokenOverlapRatio(targetTitleTokens, candidateTitleTokens);
    const titleCombinedOverlap = getTokenOverlapRatio(targetTitleTokens, candidateCombinedTokens);
    score += Math.round(Math.max(titleOverlap, titleCombinedOverlap) * 55);

    if (targetTitleNorm && candidateTitleNorm.includes(targetTitleNorm)) {
        score += 20;
    }

    const artistOverlap = getTokenOverlapRatio(targetArtistTokens, candidateCombinedTokens);
    score += Math.round(artistOverlap * 35);

    if (targetArtistNorm && (candidateTitleNorm.includes(targetArtistNorm) || candidateUploaderNorm.includes(targetArtistNorm))) {
        score += 10;
    }

    if (targetDuration > 0 && candidateDuration > 0) {
        const delta = Math.abs(targetDuration - candidateDuration);
        if (delta <= 2) score += 22;
        else if (delta <= 5) score += 16;
        else if (delta <= 10) score += 10;
        else if (delta <= 20) score += 4;
        else if (delta > 35) score -= 18;
    }

    const combinedText = `${candidateTitleNorm} ${candidateUploaderNorm}`;
    const targetCombined = `${targetTitleNorm} ${targetArtistNorm}`;

    const preferKeywords = ['official audio', 'topic'];
    for (const keyword of preferKeywords) {
        if (combinedText.includes(keyword)) score += 4;
    }

    const riskyKeywords = ['live', 'karaoke', 'cover', 'remix', 'sped up', 'slowed', 'nightcore', '8d', 'bass boosted', 'reaction'];
    for (const keyword of riskyKeywords) {
        if (combinedText.includes(keyword) && !targetCombined.includes(keyword)) {
            score -= 8;
        }
    }

    if (/\bshorts?\b/i.test(candidateTitle)) {
        score -= 6;
    }

    return score;
}

function rankYouTubeMatches(candidates, target) {
    const list = Array.isArray(candidates) ? candidates : [];
    return list
        .map((item) => ({ ...item, _matchScore: scoreYouTubeCandidate(item, target) }))
        .sort((a, b) => (b._matchScore || 0) - (a._matchScore || 0));
}

    const MIN_SPOTIFY_MATCH_SCORE = 38;

// Helper: detect URL type from a string
function detectUrlType(input) {
    try {
        if (!/^https?:\/\//i.test(input)) return { type: 'search', value: input };
        const url = new URL(input);
        const host = url.hostname.replace(/^www\./, '').toLowerCase();
        if (host.includes('spotify.com')) {
            // Detect track vs album vs playlist
            const path = url.pathname;
            if (/\/track\//i.test(path)) return { type: 'spotify-track', value: input };
            if (/\/album\//i.test(path)) return { type: 'spotify-album', value: input };
            if (/\/playlist\//i.test(path)) return { type: 'spotify-playlist', value: input };
            return { type: 'spotify-other', value: input };
        }
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

// Helper: extract Spotify track/album/playlist ID from URL
function parseSpotifyId(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        // e.g. /track/abc123 or /intl-en/track/abc123
        const typeIdx = parts.findIndex(p => ['track', 'album', 'playlist'].includes(p));
        if (typeIdx >= 0 && parts[typeIdx + 1]) {
            return { type: parts[typeIdx], id: parts[typeIdx + 1].split('?')[0] };
        }
    } catch (e) {}
    return null;
}

// Helper: fetch a URL using Node.js https (works better than net.fetch for scraping)
function httpsFetch(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const https = require('https');
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };
        const req = https.get(options, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                httpsFetch(res.headers.location, timeout).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Request timed out')); });
    });
}

// Helper: fetch Spotify metadata from public APIs (no auth needed)
async function fetchSpotifyMetadata(spotifyUrl) {
    const result = { title: '', artist: '', thumbnail: '', duration: 0, tracks: [] };

    // 1. oEmbed API — reliable for title + thumbnail (uses net.fetch which works fine for JSON APIs)
    try {
        const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
        const oembedJson = await httpsFetch(oembedUrl);
        const data = JSON.parse(oembedJson);
        result.title = data.title || '';
        result.thumbnail = data.thumbnail_url || '';
    } catch (e) {
        if (logHandler) logHandler.warning('stream', `oEmbed fetch failed: ${e.message}`);
    }

    // 2. Scrape HTML page using Node https (net.fetch returns minimal JS shell page from Spotify)
    try {
        const html = await httpsFetch(spotifyUrl);
        if (logHandler) logHandler.info('stream', `Spotify page fetched, length: ${html.length}`);

        // Try og:title if not from oEmbed
        if (!result.title) {
            const m = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                      html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
            if (m) result.title = m[1];
        }

        // Try <title> tag — format: "Song - song by Artist | Spotify", "Album - Album by Artist | Spotify"
        if (!result.title || !result.artist) {
            const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleTag) {
                const raw = titleTag[1].replace(/\s*\|\s*Spotify\s*$/, '').trim();
                // "Name - song/album/playlist/single/ep by Artist"
                const byMatch = raw.match(/^(.+?)\s*[-–]\s*(?:song(?:\s+and\s+lyrics)?|album|playlist|single|ep|podcast(?:\s+show)?|episode)\s+by\s+(.+)$/i);
                if (byMatch) {
                    if (!result.title) result.title = byMatch[1].trim();
                    if (!result.artist) result.artist = byMatch[2].trim();
                } else {
                    // "Song Name - Artist" fallback
                    const dashMatch = raw.match(/^(.+?)\s*[-–]\s*(.+)$/);
                    if (dashMatch && !result.artist) {
                        result.artist = dashMatch[2].trim();
                        if (!result.title) result.title = dashMatch[1].trim();
                    }
                }
            }
        }

        // Best source for artist: music:musician_description meta tag
        if (!result.artist) {
            const musicianMatch = html.match(/<meta[^>]*name="music:musician_description"[^>]*content="([^"]+)"[^>]*>/i) ||
                                  html.match(/<meta[^>]*content="([^"]+)"[^>]*name="music:musician_description"[^>]*>/i);
            if (musicianMatch && musicianMatch[1]) {
                result.artist = musicianMatch[1].trim();
            }
        }

        // Parse og:description for artist — format: "Artist, Artist2 · Song · Year"
        if (!result.artist) {
            const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"[^>]*>/i) ||
                              html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"[^>]*>/i);
            if (descMatch) {
                let desc = descMatch[1];
                desc = desc.replace(/^Listen to .+? on Spotify\.\s*/i, '');
                const parts = desc.split(/\s*\u00B7\s*|\s*·\s*|\s*•\s*/).map(s => s.trim()).filter(Boolean);
                if (parts.length >= 1 && parts[0]) {
                    result.artist = parts[0];
                }
            }
        }

        // Try JSON-LD structured data
        const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
        if (jsonLdMatch) {
            try {
                const ld = JSON.parse(jsonLdMatch[1]);
                if (ld.name && !result.title) result.title = ld.name;
                if (!result.duration && ld.duration) {
                    result.duration = parseIsoDurationToSeconds(ld.duration);
                }
                if (ld.byArtist) {
                    const artists = Array.isArray(ld.byArtist) ? ld.byArtist : [ld.byArtist];
                    const artistNames = artists.map(a => a.name || a).filter(Boolean).join(', ');
                    if (artistNames) result.artist = artistNames;
                }
                // Extract artist from JSON-LD description if byArtist missing
                if (!result.artist && ld.description) {
                    let desc = ld.description;
                    desc = desc.replace(/^Listen to .+? on Spotify\.\s*/i, '');
                    const parts = desc.split(/\s*\u00B7\s*|\s*·\s*/).map(s => s.trim()).filter(Boolean);
                    const candidateArtist = parts.find(p => p !== 'Song' && p !== 'Album' && !/^\d{4}$/.test(p) && p !== result.title);
                    if (candidateArtist) result.artist = candidateArtist;
                }
                // For albums/playlists, extract track list from JSON-LD
                if (ld.track && ld.track.itemListElement) {
                    result.tracks = ld.track.itemListElement.map(item => {
                        const t = item.item || item;
                        const trackArtists = t.byArtist ? (Array.isArray(t.byArtist) ? t.byArtist : [t.byArtist]).map(a => a.name || a).join(', ') : result.artist;
                        const parsedDuration = typeof t.duration === 'number'
                            ? t.duration
                            : parseIsoDurationToSeconds(t.duration);
                        return {
                            title: t.name || '',
                            artist: trackArtists,
                            duration: parsedDuration || 0,
                            spotifyUrl: typeof t.url === 'string' ? t.url : ''
                        };
                    }).filter(t => t.title);
                }
            } catch (e) { /* ignore invalid JSON-LD */ }
        }

        // Extract tracks from initialState (base64-encoded JSON with full track data)
        if (result.tracks.length === 0) {
            const stateMatch = html.match(/<script\s+id="initialState"\s+type="text\/plain"[^>]*>([\s\S]*?)<\/script>/i);
            if (stateMatch) {
                try {
                    const stateJson = JSON.parse(Buffer.from(stateMatch[1], 'base64').toString('utf8'));
                    const tracks = [];
                    const seen = new Set();
                    function extractTracks(obj) {
                        if (!obj || typeof obj !== 'object') return;
                        const trackId = obj.id || (obj.uri && obj.uri.includes('track') ? obj.uri : null);
                        if (obj.name && trackId && obj.duration && obj.duration.totalMilliseconds > 0 && obj.artists && !seen.has(trackId)) {
                            seen.add(trackId);
                            const artistItems = obj.artists.items || (Array.isArray(obj.artists) ? obj.artists : []);
                            const artistNames = artistItems.map(a => (a.profile && a.profile.name) || a.name || '').filter(Boolean).join(', ');
                            const normalizedTrackId = String(trackId).replace(/^spotify:track:/i, '').trim();
                            tracks.push({
                                title: obj.name,
                                artist: artistNames || result.artist || '',
                                duration: Math.round(obj.duration.totalMilliseconds / 1000),
                                spotifyUrl: normalizedTrackId ? `https://open.spotify.com/track/${normalizedTrackId}` : ''
                            });
                        }
                        for (const key of Object.keys(obj)) {
                            if (typeof obj[key] === 'object') extractTracks(obj[key]);
                        }
                    }
                    extractTracks(stateJson);
                    if (tracks.length > 0) {
                        result.tracks = tracks;
                        if (logHandler) logHandler.info('stream', `Extracted ${tracks.length} tracks from initialState`);
                    }
                } catch (e) { /* ignore parse errors */ }
            }
        }

        // Thumbnail from og:image fallback
        if (!result.thumbnail) {
            const imgMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
                             html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
            if (imgMatch) result.thumbnail = imgMatch[1];
        }
    } catch (e) {
        if (logHandler) logHandler.warning('stream', `HTML scrape failed: ${e.message}`);
    }

    if (!result.duration && Array.isArray(result.tracks) && result.tracks.length > 0) {
        const exactTrack = result.tracks.find((track) => normalizeMatchText(track.title) === normalizeMatchText(result.title));
        const firstTrack = exactTrack || result.tracks[0];
        result.duration = Number(firstTrack?.duration || 0);
    }

    if (logHandler) logHandler.info('stream', `Spotify metadata result: title="${result.title}", artist="${result.artist}", tracks=${result.tracks.length}, thumbnail=${result.thumbnail ? 'yes' : 'no'}`);
    return result;
}

handle('stream-search', async (query) => {
    if (logHandler) logHandler.info('stream', `Searching: ${query}`);

    const ytdlpPath = await ensureDownloader();
    const detected = detectUrlType(query);
    const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass'];

    if (detected.type === 'spotify-track') {
        // Spotify single track: get metadata via web scraping, then search YouTube
        if (logHandler) logHandler.info('stream', 'Detected Spotify track, fetching metadata from Spotify...');
        try {
            const meta = await fetchSpotifyMetadata(detected.value);
            if (logHandler) logHandler.info('stream', `Spotify metadata: title="${meta.title}", artist="${meta.artist}"`);
            const searchQuery = [meta.artist, meta.title].filter(Boolean).join(' - ').trim();
            if (searchQuery && searchQuery !== 'Unknown') {
                if (logHandler) logHandler.info('stream', `Searching YouTube for: ${searchQuery}`);
                const ytResults = await runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '15', `ytsearch12:${searchQuery}`], 30000);
                if (ytResults.length > 0) {
                    const ranked = rankYouTubeMatches(ytResults, {
                        title: meta.title,
                        artist: meta.artist,
                        duration: meta.duration
                    });

                    const best = ranked[0];
                    if (!best || (best._matchScore || 0) < MIN_SPOTIFY_MATCH_SCORE) {
                        throw new Error('No confident YouTube match for this Spotify track');
                    }
                    const spotifyResolved = {
                        ...best,
                        title: meta.title || best.title,
                        uploader: meta.artist || best.uploader,
                        thumbnail: meta.thumbnail || best.thumbnail,
                        spotifyUrl: detected.value,
                        source: 'spotify',
                        matchedFromSpotify: true,
                        resolvedYouTubeTitle: best.title,
                        resolvedYouTubeUploader: best.uploader
                    };
                    const rest = ranked.slice(1, 10).map((item) => ({ ...item, source: 'youtube' }));

                    if (logHandler) {
                        logHandler.success('stream', `Best Spotify match score: ${best._matchScore || 0}`, {
                            spotifyTitle: meta.title,
                            spotifyArtist: meta.artist,
                            youtubeTitle: best.title,
                            youtubeUploader: best.uploader,
                            youtubeDuration: best.duration
                        });
                    }

                    return [spotifyResolved, ...rest];
                }
            }
        } catch (err) {
            if (logHandler) logHandler.warning('stream', `Spotify metadata approach failed: ${err.message}`);
        }
        // Last resort: try yt-dlp direct (may work with cookies)
        try {
            const direct = await runYtdlp(ytdlpPath, [...baseArgs, '--socket-timeout', '20', detected.value], 30000);
            if (direct.length > 0) return direct;
        } catch (e) {}
        throw new Error('Could not resolve Spotify track. Try searching by song name instead.');
    }

    if (detected.type === 'spotify-album' || detected.type === 'spotify-playlist' || detected.type === 'spotify-other') {
        // Spotify albums/playlists: scrape metadata, resolve each track to YouTube
        if (logHandler) logHandler.info('stream', 'Detected Spotify playlist/album, fetching metadata...');
        try {
            const meta = await fetchSpotifyMetadata(detected.value);
            if (meta.tracks && meta.tracks.length > 0) {
                if (logHandler) logHandler.info('stream', `Found ${meta.tracks.length} tracks in Spotify metadata, resolving to YouTube...`);
                const resolved = [];
                for (const track of meta.tracks.slice(0, 50)) {
                    try {
                        const searchQuery = [track.artist, track.title].filter(Boolean).join(' - ').trim();
                        if (!searchQuery) continue;
                        const ytResults = await runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '10', `ytsearch5:${searchQuery}`], 15000);
                        if (ytResults.length > 0) {
                            const ranked = rankYouTubeMatches(ytResults, {
                                title: track.title,
                                artist: track.artist,
                                duration: track.duration
                            });
                            const best = ranked[0];
                            if (!best || (best._matchScore || 0) < MIN_SPOTIFY_MATCH_SCORE) {
                                continue;
                            }
                            resolved.push({
                                ...best,
                                title: track.title || best.title,
                                uploader: track.artist || best.uploader,
                                thumbnail: track.thumbnail || meta.thumbnail || best.thumbnail,
                                duration: best.duration || track.duration || 0,
                                spotifyUrl: track.spotifyUrl || '',
                                source: 'spotify',
                                matchedFromSpotify: true,
                                resolvedYouTubeTitle: best.title,
                                resolvedYouTubeUploader: best.uploader
                            });
                        }
                    } catch (e) {
                        // Skip tracks that fail to resolve
                    }
                }
                if (resolved.length > 0) {
                    if (logHandler) logHandler.success('stream', `Resolved ${resolved.length}/${meta.tracks.length} Spotify tracks`);
                    return resolved;
                }
            }
            // If no track list from JSON-LD, but we have a title (single album/track?), search YouTube
            if (meta.title) {
                const searchQuery = [meta.artist, meta.title].filter(Boolean).join(' - ').trim();
                if (logHandler) logHandler.info('stream', `No track list found, searching YouTube for: ${searchQuery}`);
                const ytResults = await runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '15', `ytsearch5:${searchQuery}`], 30000);
                if (ytResults.length > 0) return ytResults;
            }
        } catch (err) {
            if (logHandler) logHandler.error('stream', `Spotify metadata extraction failed: ${err.message}`);
        }
        // Fallback: try yt-dlp direct (may work if user has cookies)
        try {
            const direct = await runYtdlp(ytdlpPath, [...baseArgs, '--socket-timeout', '30', detected.value], 60000);
            if (direct.length > 0) return direct;
        } catch (e) {}
        throw new Error('Could not resolve Spotify playlist. Try importing via the Import button.');
    }

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

    // Plain text search — YouTube + Spotify in parallel
    if (logHandler) logHandler.info('stream', `Hybrid search (YouTube + Spotify) for: ${query}`);

    let spHandler = null;
    try { spHandler = getSpotifyHandler(); } catch (e) { /* Spotify handler not available */ }

    const [ytResult, spResult] = await Promise.allSettled([
        runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '15', `ytsearch15:${query}`], 30000),
        spHandler ? spHandler.search(query, 10) : Promise.resolve(null)
    ]);

    const ytTracks = ytResult.status === 'fulfilled' ? ytResult.value : [];
    let spTracks = [];

    if (spResult.status === 'fulfilled' && spResult.value?.results?.tracks) {
        spTracks = spResult.value.results.tracks.slice(0, 10).map(t => ({
            id: t.id || '',
            title: t.name || 'Unknown',
            url: `https://open.spotify.com/track/${t.id}`,
            thumbnail: t.cover || '',
            duration: parseDurationToSeconds(t.duration) || 0,
            uploader: t.artists || '',
            view_count: 0,
            source: 'spotify'
        }));
        if (logHandler) logHandler.info('stream', `Spotify returned ${spTracks.length} tracks`);
    }

    // Tag YouTube results
    ytTracks.forEach(t => { if (!t.source) t.source = 'youtube'; });

    // Merge: Spotify first, then YouTube, deduplicate by normalized title
    const seen = new Set();
    const merged = [];
    for (const t of [...spTracks, ...ytTracks]) {
        const key = (t.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
        if (key && !seen.has(key)) {
            seen.add(key);
            merged.push(t);
        } else if (!key) {
            merged.push(t);
        }
    }

    if (merged.length > 0) {
        if (logHandler) logHandler.success('stream', `Hybrid search: ${spTracks.length} Spotify + ${ytTracks.length} YouTube = ${merged.length} merged results`);
        return merged;
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
    const detected = detectUrlType(videoUrl);

    // For Spotify URLs, we need to resolve to YouTube first
    if (detected.type.startsWith('spotify')) {
        if (logHandler) logHandler.info('stream', 'Spotify URL detected in get-stream-url, resolving to YouTube first...');
        try {
            const meta = await fetchSpotifyMetadata(videoUrl);
            const searchQuery = [meta.artist, meta.title].filter(Boolean).join(' - ').trim();
            if (searchQuery && searchQuery !== 'Unknown') {
                if (logHandler) logHandler.info('stream', `Searching YouTube for: ${searchQuery}`);
                const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass'];
                const ytResults = await runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '15', `ytsearch10:${searchQuery}`], 20000);
                if (ytResults.length > 0) {
                    const ranked = rankYouTubeMatches(ytResults, {
                        title: meta.title,
                        artist: meta.artist,
                        duration: meta.duration
                    });
                    const best = ranked[0];
                    if (!best || (best._matchScore || 0) < MIN_SPOTIFY_MATCH_SCORE) {
                        throw new Error('No confident YouTube match found');
                    }
                    if (!best?.url) throw new Error('No playable YouTube URL found');
                    videoUrl = best.url;
                    if (logHandler) {
                        logHandler.success('stream', `Resolved Spotify → YouTube (score ${best._matchScore || 0})`, {
                            spotifyTitle: meta.title,
                            spotifyArtist: meta.artist,
                            youtubeTitle: best.title,
                            youtubeUploader: best.uploader
                        });
                    }
                } else {
                    throw new Error('No YouTube match found');
                }
            } else {
                throw new Error('Could not extract track info from Spotify');
            }
        } catch (err) {
            throw new Error('Failed to resolve Spotify URL: ' + err.message);
        }
    }

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

// Import playlist from Spotify/YouTube/SoundCloud URL
handle('import-playlist', async (playlistUrl) => {
    if (logHandler) logHandler.info('stream', `Importing playlist: ${playlistUrl}`);

    const ytdlpPath = await ensureDownloader();
    const detected = detectUrlType(playlistUrl);
    const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass'];

    // Spotify playlists/albums: scrape metadata then resolve each track to YouTube
    if (detected.type.startsWith('spotify')) {
        if (logHandler) logHandler.info('stream', 'Importing Spotify playlist/album via web scraping...');
        try {
            const meta = await fetchSpotifyMetadata(playlistUrl);
            if (meta.tracks && meta.tracks.length > 0) {
                if (logHandler) logHandler.info('stream', `Found ${meta.tracks.length} tracks, resolving to YouTube...`);
                const resolved = [];
                for (const track of meta.tracks) {
                    try {
                        const searchQuery = [track.artist, track.title].filter(Boolean).join(' - ').trim();
                        if (!searchQuery) continue;
                        const ytResults = await runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '10', `ytsearch5:${searchQuery}`], 15000);
                        if (ytResults.length > 0) {
                            const ranked = rankYouTubeMatches(ytResults, {
                                title: track.title,
                                artist: track.artist,
                                duration: track.duration
                            });
                            const best = ranked[0];
                            if (!best || (best._matchScore || 0) < MIN_SPOTIFY_MATCH_SCORE) {
                                continue;
                            }
                            resolved.push({
                                ...best,
                                title: track.title || best.title,
                                uploader: track.artist || best.uploader,
                                thumbnail: meta.thumbnail || best.thumbnail,
                                spotifyUrl: track.spotifyUrl || '',
                                source: 'spotify',
                                matchedFromSpotify: true
                            });
                        }
                    } catch (e) {
                        // Skip tracks that fail
                    }
                }
                if (resolved.length > 0) {
                    if (logHandler) logHandler.success('stream', `Resolved ${resolved.length}/${meta.tracks.length} Spotify tracks`);
                    return resolved;
                }
            }
            // If a single track URL was used with import, try single-track approach
            if (meta.title) {
                const searchQuery = [meta.artist, meta.title].filter(Boolean).join(' - ').trim();
                if (searchQuery) {
                    const ytResults = await runYtdlp(ytdlpPath, [...baseArgs, '--flat-playlist', '--socket-timeout', '15', `ytsearch5:${searchQuery}`], 30000);
                    if (ytResults.length > 0) return ytResults;
                }
            }
        } catch (err) {
            if (logHandler) logHandler.error('stream', `Spotify import via scraping failed: ${err.message}`);
        }
        // Fallback: try yt-dlp direct (may work if user has browser cookies)
        try {
            const direct = await runYtdlp(ytdlpPath, [...baseArgs, '--socket-timeout', '30', playlistUrl], 60000);
            if (direct.length > 0) return direct;
        } catch (e) {}
        throw new Error('Could not import Spotify playlist. Try pasting individual track URLs.');
    }

    // Non-Spotify: use standard extraction
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
