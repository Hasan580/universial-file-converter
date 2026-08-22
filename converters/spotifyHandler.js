/**
 * SpotiFLAC Integration Handler
 * Ported from https://github.com/afkarxyz/SpotiFLAC
 * Downloads Spotify tracks in FLAC from Tidal, Qobuz & Amazon Music
 */

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const crypto = require('crypto');

// ==================== TOTP Implementation ====================

const TOTP_SECRETS = {
    59: [123, 105, 79, 70, 110, 59, 52, 125, 60, 49, 80, 70, 89, 75, 80, 86, 63, 53, 123, 37, 117, 49, 52, 93, 77, 62, 47, 86, 48, 104, 68, 72],
    60: [79, 109, 69, 123, 90, 65, 46, 74, 94, 34, 58, 48, 70, 71, 92, 85, 122, 63, 91, 64, 87, 87],
    61: [44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78]
};

function base32Encode(buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';
    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += alphabet[(value << (5 - bits)) & 31];
    }
    return output;
}

function generateTOTP() {
    const version = 61;
    const secretList = TOTP_SECRETS[version];

    const transformed = secretList.map((b, i) => b ^ ((i % 33) + 9));
    const joined = transformed.map(b => b.toString()).join('');
    const hexStr = Buffer.from(joined, 'utf-8').toString('hex');
    const hexBytes = Buffer.from(hexStr, 'hex');
    const secret = base32Encode(hexBytes);

    // Generate TOTP code (RFC 6238)
    const epoch = Math.floor(Date.now() / 1000);
    const timeStep = Math.floor(epoch / 30);
    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeUInt32BE(0, 0);
    timeBuffer.writeUInt32BE(timeStep, 4);

    // Decode base32 secret
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    const secretBytes = [];
    for (const c of secret.toUpperCase()) {
        const idx = base32Chars.indexOf(c);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            secretBytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    const keyBuffer = Buffer.from(secretBytes);

    const hmac = crypto.createHmac('sha1', keyBuffer);
    hmac.update(timeBuffer);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0x0f;
    const code = ((hash[offset] & 0x7f) << 24) |
                 ((hash[offset + 1] & 0xff) << 16) |
                 ((hash[offset + 2] & 0xff) << 8) |
                 (hash[offset + 3] & 0xff);

    const otp = (code % 1000000).toString().padStart(6, '0');
    return { totpCode: otp, version };
}

// ==================== HTTP Helper ====================

function httpRequest(urlStr, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlStr);
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;

        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
                ...options.headers
            },
            timeout: options.timeout || 30000
        };

        const req = lib.request(reqOptions, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                httpRequest(res.headers.location, options).then(resolve).catch(reject);
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks);
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    cookies: (res.headers['set-cookie'] || []).map(c => {
                        const parts = c.split(';')[0].split('=');
                        return { name: parts[0], value: parts.slice(1).join('=') };
                    }),
                    body: body,
                    text: body.toString('utf-8')
                });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const lib = isHttps ? https : http;

        const req = lib.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
            },
            timeout: 300000
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`Download failed with status ${res.statusCode}`));
                return;
            }

            const totalSize = parseInt(res.headers['content-length'] || '0', 10);
            let downloaded = 0;
            const file = fs.createWriteStream(destPath);

            res.on('data', chunk => {
                downloaded += chunk.length;
                if (onProgress && totalSize > 0) {
                    onProgress({
                        downloaded,
                        total: totalSize,
                        percent: Math.round((downloaded / totalSize) * 100)
                    });
                }
            });

            res.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve(destPath);
            });
            file.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

// ==================== Spotify Client ====================

class SpotifyClient {
    constructor() {
        this.accessToken = '';
        this.clientToken = '';
        this.clientID = '';
        this.deviceID = '';
        this.clientVersion = '';
        this.cookies = {};
    }

    async getAccessToken() {
        const { totpCode, version } = generateTOTP();

        const params = new URLSearchParams({
            reason: 'init',
            productType: 'web-player',
            totp: totpCode,
            totpVer: version.toString(),
            totpServer: totpCode
        });

        const url = `https://open.spotify.com/api/token?${params.toString()}`;
        const resp = await httpRequest(url, {
            headers: {
                'Content-Type': 'application/json;charset=UTF-8'
            }
        });

        if (resp.statusCode !== 200) {
            throw new Error(`Access token request failed: HTTP ${resp.statusCode}`);
        }

        const data = JSON.parse(resp.text);
        this.accessToken = data.accessToken || '';
        this.clientID = data.clientId || '';

        for (const cookie of resp.cookies) {
            if (cookie.name === 'sp_t') {
                this.deviceID = cookie.value;
            }
            this.cookies[cookie.name] = cookie.value;
        }
    }

    async getSessionInfo() {
        const cookieStr = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        const resp = await httpRequest('https://open.spotify.com', {
            headers: {
                ...(cookieStr ? { 'Cookie': cookieStr } : {})
            }
        });

        if (resp.statusCode !== 200) {
            throw new Error(`Session initialization failed: HTTP ${resp.statusCode}`);
        }

        const match = resp.text.match(/<script id="appServerConfig" type="text\/plain">([^<]+)<\/script>/);
        if (match && match[1]) {
            try {
                const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
                const cfg = JSON.parse(decoded);
                this.clientVersion = cfg.clientVersion || '';
            } catch (e) {
                // ignore
            }
        }

        for (const cookie of resp.cookies) {
            if (cookie.name === 'sp_t') {
                this.deviceID = cookie.value;
            }
            this.cookies[cookie.name] = cookie.value;
        }
    }

    async getClientToken() {
        if (!this.clientID || !this.deviceID || !this.clientVersion) {
            await this.getSessionInfo();
            await this.getAccessToken();
        }

        const payload = {
            client_data: {
                client_version: this.clientVersion,
                client_id: this.clientID,
                js_sdk_data: {
                    device_brand: 'unknown',
                    device_model: 'unknown',
                    os: 'windows',
                    os_version: 'NT 10.0',
                    device_id: this.deviceID,
                    device_type: 'computer'
                }
            }
        };

        const resp = await httpRequest('https://clienttoken.spotify.com/v1/clienttoken', {
            method: 'POST',
            headers: {
                'Authority': 'clienttoken.spotify.com',
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (resp.statusCode !== 200) {
            throw new Error(`Client token request failed: HTTP ${resp.statusCode}`);
        }

        const data = JSON.parse(resp.text);
        if (data.response_type !== 'RESPONSE_GRANTED_TOKEN_RESPONSE') {
            throw new Error('Invalid client token response type');
        }

        this.clientToken = (data.granted_token || {}).token || '';
    }

    async initialize() {
        await this.getSessionInfo();
        await this.getAccessToken();
        await this.getClientToken();
    }

    async query(payload) {
        if (!this.accessToken || !this.clientToken) {
            await this.initialize();
        }

        const resp = await httpRequest('https://api-partner.spotify.com/pathfinder/v2/query', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + this.accessToken,
                'Client-Token': this.clientToken,
                'Spotify-App-Version': this.clientVersion,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (resp.statusCode !== 200) {
            const errorText = resp.text.substring(0, 200);
            throw new Error(`API query failed: HTTP ${resp.statusCode} | ${errorText}`);
        }

        return JSON.parse(resp.text);
    }
}

// ==================== Data Extraction Helpers ====================

function getString(m, key) {
    return typeof m[key] === 'string' ? m[key] : '';
}

function getMap(m, key) {
    return (m && typeof m[key] === 'object' && m[key] !== null && !Array.isArray(m[key])) ? m[key] : {};
}

function getSlice(m, key) {
    return (m && Array.isArray(m[key])) ? m[key] : [];
}

function getFloat64(m, key) {
    return typeof m[key] === 'number' ? m[key] : 0;
}

function getInt(m, key) {
    if (typeof m[key] === 'number') return Math.floor(m[key]);
    return 0;
}

function getBool(m, key) {
    return m[key] === true;
}

function extractArtists(artistsData) {
    const items = getSlice(artistsData, 'items');
    return items.map(item => {
        if (typeof item !== 'object' || item === null) return null;
        const profile = getMap(item, 'profile');
        return { name: getString(profile, 'name') };
    }).filter(a => a && a.name);
}

function extractCoverImage(coverData) {
    if (!coverData || Object.keys(coverData).length === 0) return null;

    let sources = [];
    if (Array.isArray(coverData.sources)) {
        sources = coverData.sources;
    } else {
        const squareImg = getMap(coverData, 'squareCoverImage');
        const img = getMap(squareImg, 'image');
        const data = getMap(img, 'data');
        if (Array.isArray(data.sources)) sources = data.sources;
    }

    if (sources.length === 0) return null;

    const filtered = sources.map(s => {
        if (typeof s !== 'object' || !s) return null;
        const url = getString(s, 'url');
        if (!url) return null;
        let width = getFloat64(s, 'width') || getFloat64(s, 'maxWidth');
        let height = getFloat64(s, 'height') || getFloat64(s, 'maxHeight');
        if ((width > 64 && height > 64) || (width === 0 && height === 0 && url)) {
            return { url, width, height };
        }
        return null;
    }).filter(Boolean);

    if (filtered.length === 0) return null;
    filtered.sort((a, b) => a.width - b.width);

    let smallURL = '', mediumURL = '', imageID = '', fallbackURL = '';

    for (const source of filtered) {
        if (source.width === 300) smallURL = source.url;
        else if (source.width === 640) mediumURL = source.url;
        else if (source.width === 0) fallbackURL = source.url;

        if (!imageID && source.url) {
            for (const prefix of ['ab67616d0000b273', 'ab67616d00001e02']) {
                if (source.url.includes(prefix)) {
                    const parts = source.url.split(prefix);
                    if (parts.length > 1) imageID = parts[parts.length - 1];
                    break;
                }
            }
            if (!imageID && source.url.includes('/image/')) {
                const parts = source.url.split('/image/');
                if (parts.length > 1) {
                    const imagePart = parts[parts.length - 1].split('?')[0];
                    if (imagePart.length > 20) {
                        for (const pfx of ['ab67616d0000b273', 'ab67616d00001e02', 'ab67616d00004851']) {
                            if (imagePart.includes(pfx)) {
                                const sub = imagePart.split(pfx);
                                if (sub.length > 1) { imageID = sub[sub.length - 1]; break; }
                            }
                        }
                    }
                }
            }
        }
    }

    const largeURL = imageID ? `https://i.scdn.co/image/ab67616d000082c1${imageID}` : '';

    const result = {};
    if (smallURL) result.small = smallURL;
    if (mediumURL) result.medium = mediumURL;
    if (largeURL) result.large = largeURL;

    if (Object.keys(result).length === 0 && fallbackURL) {
        result.small = fallbackURL;
        result.medium = fallbackURL;
        result.large = fallbackURL;
    }

    return Object.keys(result).length > 0 ? result : null;
}

function extractDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return { formatted: `${minutes}:${seconds.toString().padStart(2, '0')}` };
}

// ==================== Filter Functions ====================

function filterTrack(data, albumFetchData) {
    const dataMap = getMap(data, 'data');
    const trackData = getMap(dataMap, 'trackUnion');
    if (Object.keys(trackData).length === 0) return {};

    let artists = extractArtists(getMap(trackData, 'artists'));

    if (artists.length === 0) {
        const firstArtistItems = getSlice(getMap(trackData, 'firstArtist'), 'items');
        for (const item of firstArtistItems) {
            if (item && item.profile) {
                artists.push({ name: getString(item.profile, 'name') });
            }
        }
        const otherArtistItems = getSlice(getMap(trackData, 'otherArtists'), 'items');
        for (const item of otherArtistItems) {
            if (item && item.profile) {
                artists.push({ name: getString(item.profile, 'name') });
            }
        }
    }

    if (artists.length === 0) {
        const albumData = getMap(trackData, 'albumOfTrack');
        if (Object.keys(albumData).length > 0) {
            artists = extractArtists(getMap(albumData, 'artists'));
        }
    }

    const albumData = getMap(trackData, 'albumOfTrack');
    let albumInfo = null;
    const copyrightInfo = [];
    let discNumber = getFloat64(trackData, 'discNumber') || 1;
    let totalDiscs = 1;

    if (Object.keys(albumData).length > 0) {
        const copyrightData = getMap(albumData, 'copyright');
        const copyrightItems = getSlice(copyrightData, 'items');
        for (const item of copyrightItems) {
            if (item && getString(item, 'type') !== 'P') {
                copyrightInfo.push(getString(item, 'text'));
            }
        }

        const dateInfo = getMap(albumData, 'date');
        let releaseDate = getString(dateInfo, 'isoString');
        let releaseYear = null;

        if (!releaseDate && Object.keys(dateInfo).length > 0) {
            const yearStr = getString(dateInfo, 'year') || (dateInfo.year != null ? String(dateInfo.year) : '');
            const monthStr = getString(dateInfo, 'month') || (dateInfo.month != null ? String(dateInfo.month) : '');
            const dayStr = getString(dateInfo, 'day') || (dateInfo.day != null ? String(dateInfo.day) : '');
            if (yearStr) {
                releaseYear = parseInt(yearStr);
                if (monthStr && dayStr) {
                    releaseDate = `${yearStr}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`;
                } else {
                    releaseDate = yearStr;
                }
            }
        } else if (releaseDate) {
            releaseDate = releaseDate.split('T')[0];
            const dateParts = releaseDate.split('-');
            if (dateParts[0]) releaseYear = parseInt(dateParts[0]);
        }

        const tracksData = getMap(albumData, 'tracks');
        let tracksTotalCount = getFloat64(tracksData, 'totalCount');

        let albumArtistsString = '';
        let albumLabel = '';
        if (albumFetchData && Object.keys(albumFetchData).length > 0) {
            const albumUnionData = getMap(getMap(albumFetchData, 'data'), 'albumUnion');
            if (Object.keys(albumUnionData).length > 0) {
                const albArtists = extractArtists(getMap(albumUnionData, 'artists'));
                if (albArtists.length > 0) {
                    albumArtistsString = albArtists.map(a => a.name).join(', ');
                }
                albumLabel = getString(albumUnionData, 'label');
            }
        }

        if (!albumArtistsString) {
            const albArtists = extractArtists(getMap(albumData, 'artists'));
            if (albArtists.length > 0) {
                albumArtistsString = albArtists.map(a => a.name).join(', ');
            }
        }

        let albumID = getString(albumData, 'id');
        if (!albumID) {
            const albumURI = getString(albumData, 'uri');
            if (albumURI.includes(':')) {
                albumID = albumURI.split(':').pop();
            }
        }

        albumInfo = {
            id: albumID,
            name: getString(albumData, 'name'),
            released: releaseDate,
            year: releaseYear,
            tracks: Math.floor(tracksTotalCount)
        };
        if (albumArtistsString) albumInfo.artists = albumArtistsString;
        if (albumLabel) albumInfo.label = albumLabel;
    }

    let cover = extractCoverImage(getMap(trackData, 'visualIdentity'));
    if (!cover && Object.keys(albumData).length > 0) {
        cover = extractCoverImage(getMap(albumData, 'coverArt'));
    }

    const durationMs = getFloat64(getMap(trackData, 'duration'), 'totalMilliseconds');
    const durationObj = extractDuration(durationMs);

    const artistNames = artists.map(a => a.name);
    const artistsString = artistNames.join(', ');
    const copyrightString = copyrightInfo.join(', ');

    if (discNumber === 0) discNumber = 1;

    // Handle totalDiscs from albumFetchData
    if (albumFetchData) {
        const albumUnion = getMap(getMap(albumFetchData, 'data'), 'albumUnion');
        const discsData = getMap(albumUnion, 'discs');
        if (discsData.totalCount) totalDiscs = Math.floor(discsData.totalCount);
    }

    const contentRating = getMap(trackData, 'contentRating');
    const isExplicit = getString(contentRating, 'label') === 'EXPLICIT';

    return {
        id: getString(trackData, 'id'),
        name: getString(trackData, 'name'),
        artists: artistsString,
        album: albumInfo,
        duration: durationObj.formatted,
        track: Math.floor(getFloat64(trackData, 'trackNumber')),
        disc: Math.floor(discNumber),
        discs: totalDiscs,
        copyright: copyrightString,
        plays: getString(trackData, 'playcount'),
        cover: cover,
        is_explicit: isExplicit
    };
}

function filterAlbum(data) {
    const dataMap = getMap(data, 'data');
    const albumData = getMap(dataMap, 'albumUnion');
    if (Object.keys(albumData).length === 0) return {};

    const artists = extractArtists(getMap(albumData, 'artists'));
    const albumArtistsString = artists.map(a => a.name).join(', ');

    const coverObj = extractCoverImage(getMap(albumData, 'coverArt'));
    let cover = null;
    if (coverObj) {
        cover = coverObj.small || coverObj.medium || coverObj.large || null;
    }

    const tracks = [];
    const tracksData = getMap(albumData, 'tracksV2');
    const trackItems = getSlice(tracksData, 'items');
    for (const item of trackItems) {
        if (!item || typeof item !== 'object') continue;
        const track = getMap(item, 'track');
        if (Object.keys(track).length === 0) continue;

        const trackArtists = extractArtists(getMap(track, 'artists'));
        const trackDurationMs = getFloat64(getMap(track, 'duration'), 'totalMilliseconds');
        const durationObj = extractDuration(trackDurationMs);

        const artistIDs = [];
        const artistItems = getSlice(getMap(track, 'artists'), 'items');
        for (const ai of artistItems) {
            if (!ai) continue;
            const uri = getString(ai, 'uri');
            if (uri && uri.includes(':')) {
                const id = uri.split(':').pop();
                if (id) artistIDs.push(id);
            }
        }

        let trackURI = getString(track, 'uri');
        let trackID = '';
        if (trackURI.includes(':')) trackID = trackURI.split(':').pop();

        const contentRating = getMap(track, 'contentRating');
        const isExplicit = getString(contentRating, 'label') === 'EXPLICIT';
        let discNumber = Math.floor(getFloat64(track, 'discNumber')) || 1;

        tracks.push({
            id: trackID,
            name: getString(track, 'name'),
            artists: trackArtists.map(a => a.name).join(', '),
            artistIds: artistIDs,
            duration: durationObj.formatted,
            plays: getString(track, 'playcount'),
            is_explicit: isExplicit,
            disc_number: discNumber
        });
    }

    const dateInfo = getMap(albumData, 'date');
    let releaseDate = getString(dateInfo, 'isoString');
    if (releaseDate && releaseDate.includes('T')) {
        releaseDate = releaseDate.split('T')[0];
    }

    let albumURI = getString(albumData, 'uri');
    let albumID = '';
    if (albumURI.includes(':')) albumID = albumURI.split(':').pop();

    let totalDiscs = 1;
    const discsData = getMap(albumData, 'discs');
    if (Object.keys(discsData).length > 0) {
        totalDiscs = Math.floor(getFloat64(discsData, 'totalCount')) || 1;
    }

    return {
        id: albumID,
        name: getString(albumData, 'name'),
        artists: albumArtistsString,
        cover: cover,
        releaseDate: releaseDate,
        count: tracks.length,
        tracks: tracks,
        discs: { totalCount: totalDiscs },
        label: getString(albumData, 'label')
    };
}

function filterPlaylist(data) {
    const dataMap = getMap(data, 'data');
    const playlistData = getMap(dataMap, 'playlistV2');
    if (Object.keys(playlistData).length === 0) return {};

    const ownerData = getMap(getMap(playlistData, 'ownerV2'), 'data');
    let ownerInfo = null;
    if (Object.keys(ownerData).length > 0) {
        let avatarURL = null;
        const avatarData = getMap(ownerData, 'avatar');
        const avatarSources = getSlice(avatarData, 'sources');
        for (const s of avatarSources) {
            if (s && getFloat64(s, 'width') === 300) { avatarURL = getString(s, 'url'); break; }
        }
        if (!avatarURL && avatarSources.length > 0 && avatarSources[0]) {
            avatarURL = getString(avatarSources[0], 'url');
        }
        ownerInfo = { name: getString(ownerData, 'name'), avatar: avatarURL };
    }

    let cover = null;
    let imagesData = getMap(playlistData, 'images');
    if (Object.keys(imagesData).length === 0) imagesData = getMap(playlistData, 'imagesV2');
    if (Object.keys(imagesData).length > 0) {
        const imageItems = getSlice(imagesData, 'items');
        if (imageItems.length > 0 && imageItems[0]) {
            const firstSources = getSlice(imageItems[0], 'sources');
            if (firstSources.length > 0 && firstSources[0]) {
                cover = getString(firstSources[0], 'url') || null;
            }
        }
        if (!cover) {
            const imageSources = getSlice(imagesData, 'sources');
            if (imageSources.length > 0 && imageSources[0]) {
                cover = getString(imageSources[0], 'url') || null;
            }
        }
    }

    const tracks = [];
    const content = getMap(playlistData, 'content');
    const contentItems = getSlice(content, 'items');
    for (const item of contentItems) {
        if (!item || typeof item !== 'object') continue;
        const trackData = getMap(getMap(item, 'itemV2'), 'data');
        if (Object.keys(trackData).length === 0) continue;

        const trackArtists = extractArtists(getMap(trackData, 'artists'));
        const trackDurationMs = getFloat64(getMap(trackData, 'trackDuration'), 'totalMilliseconds');
        const durationObj = extractDuration(trackDurationMs);

        let trackURI = getString(trackData, 'uri');
        let trackID = getString(trackData, 'id');
        if (!trackID && trackURI.includes(':')) trackID = trackURI.split(':').pop();

        const albumDataT = getMap(trackData, 'albumOfTrack');
        let albumName = '';
        let albumID = '';
        let trackCover = null;
        let albumArtistsString = '';

        if (Object.keys(albumDataT).length > 0) {
            albumName = getString(albumDataT, 'name');
            const albumURI = getString(albumDataT, 'uri');
            if (albumURI.includes(':')) albumID = albumURI.split(':').pop();
            const coverObj = extractCoverImage(getMap(albumDataT, 'coverArt'));
            if (coverObj) trackCover = coverObj.small || coverObj.medium || coverObj.large || null;
            const albArtists = extractArtists(getMap(albumDataT, 'artists'));
            if (albArtists.length > 0) albumArtistsString = albArtists.map(a => a.name).join(', ');
        }

        const contentRating = getMap(trackData, 'contentRating');
        const isExplicit = getString(contentRating, 'label') === 'EXPLICIT';

        const trackName = getString(trackData, 'name');
        if (!trackName) continue;

        const artistIDs = [];
        const artistItems = getSlice(getMap(trackData, 'artists'), 'items');
        for (const ai of artistItems) {
            if (!ai) continue;
            const uri = getString(ai, 'uri');
            if (uri && uri.includes(':')) {
                const id = uri.split(':').pop();
                if (id) artistIDs.push(id);
            }
        }

        tracks.push({
            id: trackID,
            cover: trackCover,
            title: trackName,
            artist: trackArtists.map(a => a.name).join(', '),
            artistIds: artistIDs,
            album: albumName,
            albumArtist: albumArtistsString,
            albumId: albumID,
            duration: durationObj.formatted,
            is_explicit: isExplicit,
            disc_number: Math.floor(getFloat64(trackData, 'discNumber')) || 1
        });
    }

    const totalCount = getFloat64(content, 'totalCount');
    let playlistURI = getString(playlistData, 'uri');
    let playlistID = '';
    if (playlistURI.includes(':')) playlistID = playlistURI.split(':').pop();

    const followersData = playlistData.followers;
    let followersCount = 0;
    if (followersData && typeof followersData === 'object') {
        followersCount = getFloat64(followersData, 'totalCount');
    } else if (typeof followersData === 'number') {
        followersCount = followersData;
    }

    return {
        id: playlistID,
        name: getString(playlistData, 'name'),
        description: getString(playlistData, 'description'),
        owner: ownerInfo,
        cover: cover,
        count: totalCount > 0 ? Math.floor(totalCount) : tracks.length,
        tracks: tracks,
        followers: followersCount
    };
}

function filterSearch(data) {
    const dataMap = getMap(data, 'data');
    const searchData = getMap(dataMap, 'searchV2');
    if (Object.keys(searchData).length === 0) return { results: { tracks: [], albums: [], artists: [], playlists: [] }, totalResults: {} };

    const results = { tracks: [], albums: [], artists: [], playlists: [] };

    // Tracks
    let tracksData = getMap(searchData, 'tracksV2');
    if (Object.keys(tracksData).length === 0) tracksData = getMap(searchData, 'tracks');
    const trackItems = getSlice(tracksData, 'items');
    for (const item of trackItems) {
        if (!item) continue;
        let track = null;
        if (item.item && item.item.data) track = item.item.data;
        else if (item.track) track = item.track;
        if (!track) continue;

        const trackArtists = extractArtists(getMap(track, 'artists'));
        let trackDurationMs = getFloat64(getMap(track, 'duration'), 'totalMilliseconds');
        if (!trackDurationMs) trackDurationMs = getFloat64(getMap(track, 'trackDuration'), 'totalMilliseconds');
        const durationObj = extractDuration(trackDurationMs);

        const albumData2 = getMap(track, 'albumOfTrack');
        let albumInfo2 = null;
        if (Object.keys(albumData2).length > 0) {
            let albumID2 = getString(albumData2, 'id');
            if (!albumID2) {
                const uri = getString(albumData2, 'uri');
                if (uri.includes(':')) albumID2 = uri.split(':').pop();
            }
            albumInfo2 = { name: getString(albumData2, 'name'), id: albumID2 };
        }

        let trackURI = getString(track, 'uri');
        let trackID = getString(track, 'id');
        if (!trackID && trackURI.includes(':')) trackID = trackURI.split(':').pop();

        const coverObj = extractCoverImage(getMap(albumData2, 'coverArt'));
        let coverUrl = null;
        if (coverObj) coverUrl = coverObj.medium || coverObj.small || coverObj.large || null;

        const trackName = getString(track, 'name');
        if (!trackName) continue;

        const contentRating = getMap(track, 'contentRating');
        const isExplicit = getString(contentRating, 'label') === 'EXPLICIT';

        results.tracks.push({
            id: trackID,
            name: trackName,
            artists: trackArtists.map(a => a.name).join(', '),
            album: albumInfo2 ? albumInfo2.name : '',
            duration: durationObj.formatted,
            cover: coverUrl,
            is_explicit: isExplicit
        });
    }

    // Albums
    let albumsData = getMap(searchData, 'albumsV2');
    if (Object.keys(albumsData).length === 0) albumsData = getMap(searchData, 'albums');
    const albumItems = getSlice(albumsData, 'items');
    for (const item of albumItems) {
        if (!item) continue;
        let album = item.data || item.album;
        if (!album) continue;

        const albumArtists = extractArtists(getMap(album, 'artists'));
        let albumID3 = getString(album, 'id');
        if (!albumID3) {
            const uri = getString(album, 'uri');
            if (uri.includes(':')) albumID3 = uri.split(':').pop();
        }
        const coverObj = extractCoverImage(getMap(album, 'coverArt'));
        let coverUrl = coverObj ? (coverObj.medium || coverObj.small || null) : null;

        const dateInfo = getMap(album, 'date');
        let year = dateInfo.year || null;

        const albumName = getString(album, 'name');
        const albumArtStr = albumArtists.map(a => a.name).join(', ');
        if (!albumName || !albumArtStr) continue;

        const albumResult = { id: albumID3, name: albumName, artists: albumArtStr, cover: coverUrl };
        if (year) albumResult.year = year;
        results.albums.push(albumResult);
    }

    // Artists
    let artistsData = getMap(searchData, 'artistsV2');
    if (Object.keys(artistsData).length === 0) artistsData = getMap(searchData, 'artists');
    const artistItems = getSlice(artistsData, 'items');
    for (const item of artistItems) {
        if (!item) continue;
        let artist = item.data || item.artist;
        if (!artist) continue;

        let artistURI = getString(artist, 'uri');
        let artistID = '';
        if (artistURI.includes(':')) artistID = artistURI.split(':').pop();

        let coverObj = extractCoverImage(getMap(artist, 'visualIdentity'));
        if (!coverObj) {
            const visuals = getMap(artist, 'visuals');
            if (Object.keys(visuals).length > 0) coverObj = extractCoverImage(getMap(visuals, 'avatarImage'));
        }
        let coverUrl = coverObj ? (coverObj.medium || coverObj.small || null) : null;

        let artistName = getString(getMap(artist, 'profile'), 'name') || getString(artist, 'name');
        if (!artistName) continue;

        results.artists.push({ id: artistID, name: artistName, cover: coverUrl });
    }

    // Playlists
    let playlistsData = getMap(searchData, 'playlistsV2');
    if (Object.keys(playlistsData).length === 0) playlistsData = getMap(searchData, 'playlists');
    const playlistItems = getSlice(playlistsData, 'items');
    for (const item of playlistItems) {
        if (!item) continue;
        let playlist = item.data || item.playlist;
        if (!playlist) continue;

        let playlistURI = getString(playlist, 'uri');
        let playlistID = '';
        if (playlistURI.includes(':')) playlistID = playlistURI.split(':').pop();

        let playlistCover = null;
        let playlistImages = getMap(playlist, 'images');
        if (Object.keys(playlistImages).length === 0) playlistImages = getMap(playlist, 'imagesV2');
        if (Object.keys(playlistImages).length > 0) {
            const imageItems2 = getSlice(playlistImages, 'items');
            if (imageItems2.length > 0 && imageItems2[0]) {
                const firstSources = getSlice(imageItems2[0], 'sources');
                const coverObj3 = extractCoverImage({ sources: firstSources });
                if (coverObj3) playlistCover = coverObj3.medium || coverObj3.small || null;
            }
        }

        const ownerData2 = getMap(getMap(playlist, 'ownerV2'), 'data');
        const ownerName = getString(ownerData2, 'name');
        const playlistName = getString(playlist, 'name');
        if (!playlistName) continue;

        const result = { id: playlistID, name: playlistName, cover: playlistCover };
        if (ownerName) result.owner = ownerName;
        results.playlists.push(result);
    }

    return {
        results,
        totalResults: {
            tracks: results.tracks.length,
            albums: results.albums.length,
            artists: results.artists.length,
            playlists: results.playlists.length
        }
    };
}

// ==================== Spotify Metadata Client ====================

function parseSpotifyURI(input) {
    const trimmed = (input || '').trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('spotify:')) {
        const parts = trimmed.split(':');
        if (parts.length === 3 && ['album', 'track', 'playlist', 'artist'].includes(parts[1])) {
            return { type: parts[1], id: parts[2] };
        }
    }

    try {
        const parsed = new URL(trimmed);
        if (parsed.hostname !== 'open.spotify.com' && parsed.hostname !== 'play.spotify.com') return null;

        let parts = parsed.pathname.split('/').filter(p => p);
        if (parts[0] === 'embed') parts = parts.slice(1);
        if (parts[0] && parts[0].startsWith('intl-')) parts = parts.slice(1);

        if (parts.length === 2 && ['album', 'track', 'playlist', 'artist'].includes(parts[0])) {
            return { type: parts[0], id: parts[1] };
        }
    } catch (e) {
        // Not a valid URL
    }

    return null;
}

class SpotifyMetadataClient {
    constructor() {
        this.spotifyClient = null;
    }

    async ensureClient() {
        if (!this.spotifyClient) {
            this.spotifyClient = new SpotifyClient();
            await this.spotifyClient.initialize();
        }
        return this.spotifyClient;
    }

    async fetchTrack(trackID) {
        const client = await this.ensureClient();
        const payload = {
            variables: { uri: `spotify:track:${trackID}` },
            operationName: 'getTrack',
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294'
                }
            }
        };

        const data = await client.query(payload);
        const filtered = filterTrack(data);
        return { track: filtered };
    }

    async fetchAlbum(albumID) {
        const client = await this.ensureClient();
        const allItems = [];
        let offset = 0;
        const limit = 1000;
        let totalCount = null;
        let data = null;

        while (true) {
            const payload = {
                variables: {
                    uri: `spotify:album:${albumID}`,
                    locale: '',
                    offset: offset,
                    limit: limit
                },
                operationName: 'getAlbum',
                extensions: {
                    persistedQuery: {
                        version: 1,
                        sha256Hash: 'b9babef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10'
                    }
                }
            };

            const response = await client.query(payload);
            if (!data) data = response;

            const albumData = getMap(getMap(response, 'data'), 'albumUnion');
            const tracksData = getMap(albumData, 'tracksV2');
            const items = getSlice(tracksData, 'items');

            if (!items || items.length === 0) break;
            allItems.push(...items);

            if (totalCount === null) {
                totalCount = getFloat64(tracksData, 'totalCount') || items.length;
            }

            if (allItems.length >= totalCount || items.length < limit) break;
            offset += limit;
        }

        if (data && allItems.length > 0) {
            const dataMap = getMap(data, 'data');
            const albumUnion = getMap(dataMap, 'albumUnion');
            const tracksV2 = getMap(albumUnion, 'tracksV2');
            tracksV2.items = allItems;
            tracksV2.totalCount = allItems.length;
        }

        return filterAlbum(data);
    }

    async fetchPlaylist(playlistID) {
        const client = await this.ensureClient();
        const allItems = [];
        let offset = 0;
        const limit = 1000;
        let totalCount = null;
        let data = null;

        while (true) {
            const payload = {
                variables: {
                    uri: `spotify:playlist:${playlistID}`,
                    offset: offset,
                    limit: limit,
                    enableWatchFeedEntrypoint: false
                },
                operationName: 'fetchPlaylist',
                extensions: {
                    persistedQuery: {
                        version: 1,
                        sha256Hash: 'bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77'
                    }
                }
            };

            const response = await client.query(payload);
            if (!data) data = response;

            const playlistData = getMap(getMap(response, 'data'), 'playlistV2');
            const content = getMap(playlistData, 'content');
            const items = getSlice(content, 'items');

            if (!items || items.length === 0) break;
            allItems.push(...items);

            if (totalCount === null) {
                totalCount = getFloat64(content, 'totalCount') || items.length;
            }

            if (allItems.length >= totalCount || items.length < limit) break;
            offset += limit;
        }

        if (data && allItems.length > 0) {
            const dataMap = getMap(data, 'data');
            const playlistV2 = getMap(dataMap, 'playlistV2');
            const content = getMap(playlistV2, 'content');
            content.items = allItems;
            content.totalCount = allItems.length;
        }

        return filterPlaylist(data);
    }

    async search(query, limit = 50) {
        if (!query) throw new Error('Search query cannot be empty');
        if (limit <= 0 || limit > 50) limit = 50;

        const client = await this.ensureClient();
        const payload = {
            variables: {
                searchTerm: query,
                offset: 0,
                limit: limit,
                numberOfTopResults: 5,
                includeAudiobooks: true,
                includeArtistHasConcertsField: false,
                includePreReleases: true,
                includeAuthors: false
            },
            operationName: 'searchDesktop',
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: 'fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c'
                }
            }
        };

        const data = await client.query(payload);
        return filterSearch(data);
    }

    async getMetadata(spotifyURL) {
        const parsed = parseSpotifyURI(spotifyURL);
        if (!parsed) throw new Error('Invalid Spotify URL');

        switch (parsed.type) {
            case 'track': return this.fetchTrack(parsed.id);
            case 'album': return this.fetchAlbum(parsed.id);
            case 'playlist': return this.fetchPlaylist(parsed.id);
            default: throw new Error(`Unsupported Spotify type: ${parsed.type}`);
        }
    }
}

// ==================== SongLink Client ====================

const SONG_LINK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const SONG_LINK_RATE_LIMIT_ERROR = 'song.link rate limited';
const SONG_LINK_ISRC_PATTERN = /\b([A-Z]{2}[A-Z0-9]{3}\d{7})\b/i;
const SONG_LINK_CSRF_PATTERN = /name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i;
const SONGSTATS_SCRIPT_PATTERN = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const AMAZON_ALBUM_TRACK_PATH = /\/albums\/[A-Z0-9]{10}\/(B[0-9A-Z]{9})/i;
const AMAZON_TRACK_PATH = /\/tracks\/(B[0-9A-Z]{9})/i;

class SongLinkClient {
    constructor() {
        this.lastAPICallTime = 0;
        this.apiCallCount = 0;
        this.apiCallResetTime = Date.now();
    }

    async rateLimit() {
        const now = Date.now();
        if (now - this.apiCallResetTime >= 60000) {
            this.apiCallCount = 0;
            this.apiCallResetTime = now;
        }
        if (this.apiCallCount >= 9) {
            const waitTime = 60000 - (now - this.apiCallResetTime);
            if (waitTime > 0) {
                console.log(`SongLink rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s...`);
                await new Promise(r => setTimeout(r, waitTime));
                this.apiCallCount = 0;
                this.apiCallResetTime = Date.now();
            }
        }
        if (this.lastAPICallTime > 0) {
            const timeSince = now - this.lastAPICallTime;
            if (timeSince < 7000) {
                await new Promise(r => setTimeout(r, 7000 - timeSince));
            }
        }
    }

    async fetchSongLinkLinksByURL(rawURL, region = '') {
        await this.rateLimit();

        let apiURL = `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(rawURL)}`;
        if (region) apiURL += `&userCountry=${encodeURIComponent(region)}`;

        const resp = await httpRequest(apiURL, {
            timeout: 30000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT
            }
        });

        this.lastAPICallTime = Date.now();
        this.apiCallCount++;

        if (resp.statusCode === 429) {
            throw new Error(SONG_LINK_RATE_LIMIT_ERROR);
        }

        if (resp.statusCode !== 200) {
            let preview = resp.text || '';
            preview = preview.trim().replace(/\s+/g, ' ');
            if (preview.length > 160) preview = `${preview.slice(0, 160)}...`;
            throw new Error(preview ? `song.link returned status ${resp.statusCode} (${preview})` : `song.link returned status ${resp.statusCode}`);
        }

        if (!resp.text) {
            throw new Error('song.link returned empty response');
        }

        try {
            return JSON.parse(resp.text);
        } catch (err) {
            throw new Error(`failed to decode song.link response: ${err.message}`);
        }
    }

    async resolveSpotifyTrackLinks(spotifyTrackID, region = '') {
        const links = {
            tidalURL: '',
            amazonURL: '',
            deezerURL: '',
            isrc: ''
        };
        const attempts = [];
        const spotifyURL = `https://open.spotify.com/track/${spotifyTrackID}`;

        try {
            const songLinkData = await this.fetchSongLinkLinksByURL(spotifyURL, region);
            mergeSongLinkResponse(links, songLinkData);

            if (links.deezerURL && !links.isrc) {
                try {
                    links.isrc = await this.getDeezerISRC(links.deezerURL);
                } catch (_) {
                    // Keep going; other fallback providers may still resolve the ISRC.
                }
            }

            if (hasAnySongLinkData(links)) {
                return links;
            }

            attempts.push('song.link spotify: no links found');
        } catch (err) {
            attempts.push(`song.link spotify: ${err.message}`);
        }

        try {
            links.isrc = await this.lookupSpotifyISRC(spotifyTrackID);
        } catch (err) {
            attempts.push(`isrc lookup: ${err.message}`);
        }

        if (links.isrc) {
            try {
                await this.populateLinksFromSongstats(links, links.isrc);
            } catch (err) {
                attempts.push(`songstats: ${err.message}`);
            }

            try {
                const deezerURL = await this.lookupDeezerTrackURLByISRC(links.isrc);
                if (!links.deezerURL) {
                    links.deezerURL = deezerURL;
                }

                try {
                    const deezerSongLinkData = await this.fetchSongLinkLinksByURL(links.deezerURL, region);
                    mergeSongLinkResponse(links, deezerSongLinkData);
                } catch (err) {
                    attempts.push(`song.link deezer: ${err.message}`);
                }
            } catch (err) {
                attempts.push(`deezer isrc: ${err.message}`);
            }
        }

        if (hasAnySongLinkData(links) || links.isrc) {
            return links;
        }

        throw new Error(attempts.length > 0 ? attempts.join(' | ') : 'No streaming URLs found');
    }

    async getAllURLsFromSpotify(spotifyTrackID, region) {
        const links = await this.resolveSpotifyTrackLinks(spotifyTrackID, region);
        const urls = {
            tidalURL: links.tidalURL || '',
            amazonURL: normalizeAmazonMusicURL(links.amazonURL),
            isrc: links.isrc || ''
        };

        if (!urls.tidalURL && !urls.amazonURL) {
            throw new Error('No streaming URLs found');
        }

        return urls;
    }

    async checkTrackAvailability(spotifyTrackID) {
        let links = null;
        let resolveError = null;

        try {
            links = await this.resolveSpotifyTrackLinks(spotifyTrackID);
        } catch (err) {
            resolveError = err;
        }

        const availability = {
            spotifyID: spotifyTrackID,
            tidal: false,
            amazon: false,
            qobuz: false,
            tidalURL: '',
            amazonURL: '',
            qobuzURL: ''
        };

        if (links) {
            availability.tidalURL = links.tidalURL || '';
            availability.amazonURL = normalizeAmazonMusicURL(links.amazonURL);
            availability.tidal = Boolean(availability.tidalURL);
            availability.amazon = Boolean(availability.amazonURL);
        }

        let isrc = links && links.isrc ? links.isrc : '';
        if (!isrc && links && links.deezerURL) {
            try {
                isrc = await this.getDeezerISRC(links.deezerURL);
            } catch (_) {
                // Ignore and continue with the next provider.
            }
        }

        if (isrc) {
            availability.qobuz = await this.checkQobuzAvailability(isrc);
        }

        if (availability.tidal || availability.amazon || availability.qobuz) {
            return availability;
        }

        if (resolveError) {
            throw resolveError;
        }

        return availability;
    }

    async getDeezerISRC(deezerURL) {
        const trackID = extractDeezerTrackID(deezerURL);

        const resp = await httpRequest(`https://api.deezer.com/track/${trackID}`, { timeout: 10000 });
        if (resp.statusCode !== 200) throw new Error(`Deezer API returned status ${resp.statusCode}`);

        const data = JSON.parse(resp.text);
        if (!data.isrc) throw new Error('ISRC not found in Deezer response');
        return String(data.isrc).trim().toUpperCase();
    }

    async checkQobuzAvailability(isrc) {
        try {
            const appID = '798273057';
            const searchURL = `https://www.qobuz.com/api.json/0.2/track/search?query=${encodeURIComponent(String(isrc).trim().toUpperCase())}&limit=1&app_id=${appID}`;
            const resp = await httpRequest(searchURL, { timeout: 10000 });
            if (resp.statusCode !== 200) return false;
            const data = JSON.parse(resp.text);
            return data.tracks && data.tracks.total > 0;
        } catch (e) {
            return false;
        }
    }

    async getISRC(spotifyID) {
        let links = null;
        let resolveError = null;

        try {
            links = await this.resolveSpotifyTrackLinks(spotifyID);
        } catch (err) {
            resolveError = err;
        }

        if (links && links.isrc) {
            return links.isrc;
        }

        if (links && links.deezerURL) {
            try {
                return await this.getDeezerISRC(links.deezerURL);
            } catch (_) {
                // Keep going; direct ISRC lookup can still recover.
            }
        }

        let lookupError = null;
        try {
            const fallbackISRC = await this.lookupSpotifyISRC(spotifyID);
            if (fallbackISRC) {
                return fallbackISRC;
            }
        } catch (err) {
            lookupError = err;
        }

        if (resolveError && lookupError) {
            throw new Error(`${resolveError.message} | ${lookupError.message}`);
        }
        if (resolveError) {
            throw resolveError;
        }
        if (lookupError) {
            throw lookupError;
        }

        throw new Error('ISRC not found');
    }

    async lookupSpotifyISRC(spotifyTrackID) {
        const spotifyURL = `https://open.spotify.com/track/${spotifyTrackID}`;
        const providers = [
            { name: 'mixvibe', fn: () => this.lookupISRCViaMixvibe(spotifyURL) },
            { name: 'isrcfinder', fn: () => this.lookupISRCViaISRCFinder(spotifyURL) },
            { name: 'findmyisrc', fn: () => this.lookupISRCViaFindMyISRC(spotifyURL) },
            { name: 'phpstack', fn: () => this.lookupISRCViaPHPStack(spotifyURL) }
        ];

        const errors = [];
        for (const provider of providers) {
            try {
                const isrc = await provider.fn();
                const normalized = firstISRCMatch(isrc);
                if (normalized) {
                    return normalized;
                }
                errors.push(`${provider.name}: no ISRC found`);
            } catch (err) {
                errors.push(`${provider.name}: ${err.message}`);
            }
        }

        throw new Error(errors.join(' | '));
    }

    async lookupISRCViaISRCFinder(spotifyURL) {
        const initialResp = await httpRequest('https://www.isrcfinder.com/', {
            timeout: 20000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT,
                'Referer': 'https://www.isrcfinder.com/',
                'Origin': 'https://www.isrcfinder.com'
            }
        });

        if (initialResp.statusCode !== 200) {
            throw new Error(`isrcfinder returned status ${initialResp.statusCode}`);
        }

        const cookieHeader = initialResp.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
        let csrfToken = extractCSRFToken(initialResp.text);

        if (!csrfToken) {
            const csrfCookie = initialResp.cookies.find(cookie => cookie.name === 'csrftoken');
            csrfToken = csrfCookie ? csrfCookie.value : '';
        }

        if (!csrfToken) {
            throw new Error('csrf token not found');
        }

        const formData = new URLSearchParams({
            csrfmiddlewaretoken: csrfToken,
            URI: spotifyURL
        }).toString();

        const resp = await httpRequest('https://www.isrcfinder.com/', {
            method: 'POST',
            timeout: 20000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT,
                'Referer': 'https://www.isrcfinder.com/',
                'Origin': 'https://www.isrcfinder.com',
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(cookieHeader ? { 'Cookie': cookieHeader } : {})
            },
            body: formData
        });

        if (resp.statusCode !== 200) {
            throw new Error(`isrcfinder POST returned status ${resp.statusCode}`);
        }

        const isrc = firstISRCMatch(resp.text);
        if (!isrc) {
            throw new Error('ISRC not found in isrcfinder response');
        }

        return isrc;
    }

    async lookupISRCViaPHPStack(spotifyURL) {
        const apiURL = `https://phpstack-822472-6184058.cloudwaysapps.com/api/spotify.php?q=${encodeURIComponent(spotifyURL)}`;
        const resp = await httpRequest(apiURL, {
            timeout: 15000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT,
                'Referer': 'https://phpstack-822472-6184058.cloudwaysapps.com/?'
            }
        });

        if (resp.statusCode !== 200) {
            throw new Error(`phpstack returned status ${resp.statusCode}`);
        }

        let payload;
        try {
            payload = JSON.parse(resp.text);
        } catch (err) {
            throw new Error(`failed to decode phpstack response: ${err.message}`);
        }

        const isrc = firstISRCMatch(payload && payload.isrc ? payload.isrc : '');
        if (!isrc) {
            throw new Error('ISRC missing in phpstack response');
        }

        return isrc;
    }

    async lookupISRCViaFindMyISRC(spotifyURL) {
        const resp = await httpRequest('https://lxtzsnh4l3.execute-api.ap-southeast-2.amazonaws.com/prod/find-my-isrc', {
            method: 'POST',
            timeout: 15000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT,
                'Content-Type': 'application/json',
                'Origin': 'https://www.findmyisrc.com',
                'Referer': 'https://www.findmyisrc.com/'
            },
            body: JSON.stringify({ uris: [spotifyURL] })
        });

        if (resp.statusCode !== 200) {
            throw new Error(`findmyisrc returned status ${resp.statusCode}`);
        }

        let payload;
        try {
            payload = JSON.parse(resp.text);
        } catch (err) {
            throw new Error(`failed to decode findmyisrc response: ${err.message}`);
        }

        const isrc = findISRCInValue(payload);
        if (!isrc) {
            throw new Error('ISRC missing in findmyisrc response');
        }

        return isrc;
    }

    async lookupISRCViaMixvibe(spotifyURL) {
        const resp = await httpRequest('https://tools.mixviberecords.com/api/find-isrc', {
            method: 'POST',
            timeout: 15000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT,
                'Content-Type': 'application/json',
                'Origin': 'https://tools.mixviberecords.com',
                'Referer': 'https://tools.mixviberecords.com/isrc-finder'
            },
            body: JSON.stringify({ url: spotifyURL })
        });

        if (resp.statusCode !== 200) {
            throw new Error(`mixvibe returned status ${resp.statusCode}`);
        }

        try {
            const payload = JSON.parse(resp.text);
            const jsonIsrc = findISRCInValue(payload);
            if (jsonIsrc) {
                return jsonIsrc;
            }
        } catch (_) {
            // Some responses are not valid JSON; the raw body fallback below handles them.
        }

        const isrc = firstISRCMatch(resp.text);
        if (!isrc) {
            throw new Error('ISRC missing in mixvibe response');
        }

        return isrc;
    }

    async populateLinksFromSongstats(links, isrc) {
        const pageURL = `https://songstats.com/${String(isrc).trim().toUpperCase()}?ref=ISRCFinder`;
        const resp = await httpRequest(pageURL, {
            timeout: 30000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT
            }
        });

        if (resp.statusCode !== 200) {
            throw new Error(`Songstats returned status ${resp.statusCode}`);
        }

        SONGSTATS_SCRIPT_PATTERN.lastIndex = 0;
        const matches = Array.from(resp.text.matchAll(SONGSTATS_SCRIPT_PATTERN));
        if (matches.length === 0) {
            throw new Error('Songstats JSON-LD not found');
        }

        let found = false;
        for (const match of matches) {
            const scriptBody = decodeHtmlEntities((match[1] || '').trim());
            if (!scriptBody) continue;

            let payload;
            try {
                payload = JSON.parse(scriptBody);
            } catch (_) {
                continue;
            }

            const before = JSON.stringify(links);
            collectSongstatsLinks(payload, links);
            if (JSON.stringify(links) !== before) {
                found = true;
            }
        }

        if (!found && !hasAnySongLinkData(links)) {
            throw new Error('No platform links found in Songstats');
        }
    }

    async lookupDeezerTrackURLByISRC(isrc) {
        const resp = await httpRequest(`https://api.deezer.com/track/isrc:${encodeURIComponent(String(isrc).trim().toUpperCase())}`, {
            timeout: 15000,
            headers: {
                'User-Agent': SONG_LINK_USER_AGENT
            }
        });

        if (resp.statusCode !== 200) {
            throw new Error(`Deezer ISRC API returned status ${resp.statusCode}`);
        }

        let payload;
        try {
            payload = JSON.parse(resp.text);
        } catch (err) {
            throw new Error(`failed to decode Deezer ISRC response: ${err.message}`);
        }

        if (payload.link) {
            return normalizeDeezerTrackURL(payload.link);
        }
        if (payload.id) {
            return normalizeDeezerTrackURL(`https://www.deezer.com/track/${payload.id}`);
        }

        throw new Error(`deezer track link not found for ISRC ${isrc}`);
    }
}

function mergeSongLinkResponse(links, data) {
    if (!data || !data.linksByPlatform) return;

    if (data.linksByPlatform.tidal && data.linksByPlatform.tidal.url && !links.tidalURL) {
        links.tidalURL = String(data.linksByPlatform.tidal.url).trim();
    }

    if (data.linksByPlatform.amazonMusic && data.linksByPlatform.amazonMusic.url && !links.amazonURL) {
        links.amazonURL = normalizeAmazonMusicURL(data.linksByPlatform.amazonMusic.url);
    }

    if (data.linksByPlatform.deezer && data.linksByPlatform.deezer.url && !links.deezerURL) {
        links.deezerURL = normalizeDeezerTrackURL(data.linksByPlatform.deezer.url);
    }
}

function hasAnySongLinkData(links) {
    return Boolean(links && (links.tidalURL || links.amazonURL || links.deezerURL));
}

function normalizeAmazonMusicURL(rawURL) {
    const amazonURL = String(rawURL || '').trim();
    if (!amazonURL) return '';

    if (amazonURL.includes('trackAsin=')) {
        const parts = amazonURL.split('trackAsin=');
        if (parts.length > 1) {
            const trackAsin = parts[1].split('&')[0];
            if (trackAsin) {
                return `https://music.amazon.com/tracks/${trackAsin}?musicTerritory=US`;
            }
        }
    }

    const albumMatch = amazonURL.match(AMAZON_ALBUM_TRACK_PATH);
    if (albumMatch && albumMatch[1]) {
        return `https://music.amazon.com/tracks/${albumMatch[1]}?musicTerritory=US`;
    }

    const trackMatch = amazonURL.match(AMAZON_TRACK_PATH);
    if (trackMatch && trackMatch[1]) {
        return `https://music.amazon.com/tracks/${trackMatch[1]}?musicTerritory=US`;
    }

    return '';
}

function extractDeezerTrackID(rawURL) {
    const deezerURL = String(rawURL || '').trim();
    if (!deezerURL) {
        throw new Error('Empty Deezer URL');
    }

    const parts = deezerURL.split('/track/');
    if (parts.length < 2) {
        throw new Error(`Could not extract track ID from Deezer URL: ${rawURL}`);
    }

    const trackID = parts[1].split('?')[0].replace(/^\/+|\/+$/g, '').trim();
    if (!trackID) {
        throw new Error(`Could not extract track ID from Deezer URL: ${rawURL}`);
    }

    return trackID;
}

function normalizeDeezerTrackURL(rawURL) {
    try {
        return `https://www.deezer.com/track/${extractDeezerTrackID(rawURL)}`;
    } catch (_) {
        return String(rawURL || '').trim();
    }
}

function extractCSRFToken(body) {
    const match = String(body || '').match(SONG_LINK_CSRF_PATTERN);
    return match && match[1] ? match[1].trim() : '';
}

function firstISRCMatch(value) {
    const match = String(value || '').toUpperCase().match(SONG_LINK_ISRC_PATTERN);
    return match && match[1] ? match[1].trim() : '';
}

function findISRCInValue(value) {
    if (!value) return '';

    if (Array.isArray(value)) {
        for (const entry of value) {
            const isrc = findISRCInValue(entry);
            if (isrc) return isrc;
        }
        return '';
    }

    if (typeof value === 'object') {
        for (const [key, nested] of Object.entries(value)) {
            if (String(key).toLowerCase() === 'isrc') {
                const normalized = firstISRCMatch(nested);
                if (normalized) return normalized;
            }
            const isrc = findISRCInValue(nested);
            if (isrc) return isrc;
        }
        return '';
    }

    if (typeof value === 'string') {
        return firstISRCMatch(value);
    }

    return '';
}

function collectSongstatsLinks(value, links) {
    if (!value) return;

    if (Array.isArray(value)) {
        value.forEach(entry => collectSongstatsLinks(entry, links));
        return;
    }

    if (typeof value !== 'object') {
        return;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'sameAs')) {
        applySongstatsSameAs(value.sameAs, links);
    }

    Object.values(value).forEach(entry => collectSongstatsLinks(entry, links));
}

function applySongstatsSameAs(value, links) {
    if (Array.isArray(value)) {
        value.forEach(entry => {
            if (typeof entry === 'string') {
                assignSongstatsLink(entry, links);
            }
        });
        return;
    }

    if (typeof value === 'string') {
        assignSongstatsLink(value, links);
    }
}

function assignSongstatsLink(rawLink, links) {
    const link = String(rawLink || '').trim();
    if (!link) return;

    if (!links.tidalURL && link.includes('listen.tidal.com/track')) {
        links.tidalURL = link;
        return;
    }

    if (!links.amazonURL && link.includes('music.amazon.com')) {
        const normalizedAmazonURL = normalizeAmazonMusicURL(link);
        if (normalizedAmazonURL) {
            links.amazonURL = normalizedAmazonURL;
        }
        return;
    }

    if (!links.deezerURL && link.includes('deezer.com')) {
        links.deezerURL = normalizeDeezerTrackURL(link);
    }
}

function decodeHtmlEntities(value) {
    return String(value || '')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

// ==================== SpotiFLAC Python Module Integration ====================

const pythonBridge = require('./pythonBridge');

// ==================== Main SpotifyHandler Class ====================

class SpotifyHandler {
    constructor() {
        this.metadataClient = new SpotifyMetadataClient();
        this.songlinkClient = new SongLinkClient();
        this._spotiflacReady = false;
    }

    async ensureSpotiFLAC() {
        if (!this._spotiflacReady) {
            try {
                await pythonBridge.ensureSpotiFLAC();
                this._spotiflacReady = true;
            } catch (err) {
                console.error('[SpotifyHandler] Failed to initialize SpotiFLAC:', err.message);
                throw new Error('SpotiFLAC is not available: ' + err.message);
            }
        }
    }

    async search(query, limit) {
        return this.metadataClient.search(query, limit);
    }

    async getMetadata(spotifyURL) {
        return this.metadataClient.getMetadata(spotifyURL);
    }

    async checkAvailability(spotifyTrackID) {
        return this.songlinkClient.checkTrackAvailability(spotifyTrackID);
    }

    async downloadTrack(options, onProgress) {
        const {
            spotifyID,
            service,
            outputDir,
            quality,
            trackInfo
        } = options;

        if (!spotifyID) throw new Error('Spotify track ID is required');
        if (!outputDir) throw new Error('Output directory is required');
        if (!trackInfo) throw new Error('Track info is required');

        fs.mkdirSync(outputDir, { recursive: true });

        // Map service selection to SpotiFLAC service list
        const serviceMap = {
            'tidal': ['tidal', 'qobuz', 'amazon', 'deezer', 'spoti', 'youtube'],
            'qobuz': ['qobuz', 'tidal', 'amazon', 'deezer', 'spoti', 'youtube'],
            'amazon': ['amazon', 'tidal', 'qobuz', 'deezer', 'spoti', 'youtube'],
            'deezer': ['deezer', 'tidal', 'qobuz', 'amazon', 'spoti', 'youtube'],
            'youtube': ['youtube', 'tidal', 'qobuz', 'amazon', 'deezer', 'spoti'],
            'spoti': ['spoti', 'tidal', 'qobuz', 'amazon', 'deezer', 'youtube']
        };

        const effectiveService = service || 'tidal';
        const services = serviceMap[effectiveService] || serviceMap['tidal'];

        console.log(`SpotiFLAC: Downloading "${trackInfo.name}" by ${trackInfo.artists} via ${effectiveService} (fallbacks: ${services.join(', ')})`);

        if (onProgress) onProgress({ phase: 'initializing', percent: 5 });

        // Ensure SpotiFLAC Python module is ready
        await this.ensureSpotiFLAC();

        // Build Spotify URL
        const spotifyUrl = `https://open.spotify.com/track/${spotifyID}`;

        // Check if file already exists
        const trackName = (trackInfo.name || 'Unknown').replace(/[<>:"/\\|?*]/g, '_');
        const artistName = (trackInfo.artists || 'Unknown').split(',')[0].trim().replace(/[<>:"/\\|?*]/g, '_');
        const expectedFilename = `${trackName} - ${artistName}`;

        const existingFiles = fs.readdirSync(outputDir)
            .filter(f => /\.(flac|mp3|m4a)$/i.test(f));
        const alreadyExists = existingFiles.find(f =>
            f.toLowerCase().startsWith(expectedFilename.toLowerCase().substring(0, 30))
        );

        if (alreadyExists) {
            console.log(`SpotiFLAC: File already exists: ${alreadyExists}`);
            if (onProgress) onProgress({ phase: 'complete', percent: 100 });
            return { path: path.join(outputDir, alreadyExists), alreadyExists: true };
        }

        // Download via SpotiFLAC Python module
        try {
            const result = await pythonBridge.downloadWithSpotiFLAC({
                spotifyUrl,
                outputDir,
                services,
                filenameFormat: '{title} - {artist}'
            }, (progress) => {
                if (onProgress) {
                    onProgress({
                        phase: progress.phase || 'downloading',
                        percent: progress.percent || 0,
                        message: progress.message || ''
                    });
                }
            });

            if (result.success) {
                if (onProgress) onProgress({ phase: 'complete', percent: 100 });
                return { path: result.path, alreadyExists: false };
            } else {
                throw new Error('Download completed but no output file found');
            }
        } catch (err) {
            console.error(`SpotiFLAC: Download failed: ${err.message}`);
            throw new Error(`Download failed: ${err.message}`);
        }
    }
}

// Singleton instance
let handlerInstance = null;

function getHandler() {
    if (!handlerInstance) {
        handlerInstance = new SpotifyHandler();
    }
    return handlerInstance;
}

// ==================== Lyrics Fetcher (LRCLIB.net) ====================

/**
 * Fetch synced lyrics (.lrc) from LRCLIB.net API
 * @param {object} trackInfo - { name, artists, album, duration }
 * @returns {Promise<{syncedLyrics: string|null, plainLyrics: string|null}>}
 */
async function fetchLyrics(trackInfo) {
    const trackName = (trackInfo.name || '').trim();
    const artistName = (trackInfo.artists || '').split(',')[0].trim();
    const albumName = (trackInfo.album || '').trim();
    const duration = trackInfo.duration || 0;

    if (!trackName || !artistName) {
        throw new Error('Track name and artist are required for lyrics search');
    }

    // Try exact match first (with duration)
    try {
        const params = new URLSearchParams({
            track_name: trackName,
            artist_name: artistName,
        });
        if (albumName) params.append('album_name', albumName);
        if (duration) params.append('duration', String(Math.round(duration)));

        const url = `https://lrclib.net/api/get?${params.toString()}`;
        const result = await httpRequest(url, {
            headers: {
                'User-Agent': 'UniversalFileConverter/3.0 (https://github.com/Hasan580/universial-file-converter)'
            }
        });

        if (result.statusCode === 200) {
            const data = JSON.parse(result.text);
            if (data.syncedLyrics || data.plainLyrics) {
                return {
                    syncedLyrics: data.syncedLyrics || null,
                    plainLyrics: data.plainLyrics || null
                };
            }
        }
    } catch (e) {
        // Fall through to search
    }

    // Fallback: search API
    try {
        const query = encodeURIComponent(`${trackName} ${artistName}`);
        const searchUrl = `https://lrclib.net/api/search?q=${query}`;
        const searchResult = await httpRequest(searchUrl, {
            headers: {
                'User-Agent': 'UniversalFileConverter/3.0 (https://github.com/Hasan580/universial-file-converter)'
            }
        });

        if (searchResult.statusCode === 200) {
            const results = JSON.parse(searchResult.text);
            if (Array.isArray(results) && results.length > 0) {
                // Find best match
                const match = results.find(r => r.syncedLyrics) || results[0];
                return {
                    syncedLyrics: match.syncedLyrics || null,
                    plainLyrics: match.plainLyrics || null
                };
            }
        }
    } catch (e) {
        // No lyrics found
    }

    return { syncedLyrics: null, plainLyrics: null };
}

/**
 * Download lyrics and save as .lrc file
 * @param {object} options - { trackInfo, outputDir }
 * @returns {Promise<{success: boolean, path: string|null}>}
 */
async function downloadLyrics(options) {
    const { trackInfo, outputDir } = options;
    const lyrics = await fetchLyrics(trackInfo);

    if (!lyrics.syncedLyrics && !lyrics.plainLyrics) {
        return { success: false, path: null, error: 'No lyrics found' };
    }

    // Build .lrc file content
    const trackName = (trackInfo.name || 'Unknown').replace(/[<>:"/\\|?*]/g, '_');
    const artistName = (trackInfo.artists || 'Unknown').split(',')[0].trim().replace(/[<>:"/\\|?*]/g, '_');
    const fileName = `${trackName} - ${artistName}.lrc`;
    const filePath = path.join(outputDir, fileName);

    let lrcContent = '';
    // Add metadata header
    lrcContent += `[ti:${trackInfo.name || ''}]\n`;
    lrcContent += `[ar:${trackInfo.artists || ''}]\n`;
    lrcContent += `[al:${trackInfo.album || ''}]\n`;
    lrcContent += `[by:Universal File Converter]\n\n`;

    if (lyrics.syncedLyrics) {
        lrcContent += lyrics.syncedLyrics;
    } else if (lyrics.plainLyrics) {
        // Wrap plain lyrics in basic format
        const lines = lyrics.plainLyrics.split('\n');
        lines.forEach(line => {
            lrcContent += `${line}\n`;
        });
    }

    fs.writeFileSync(filePath, lrcContent, 'utf-8');
    return { success: true, path: filePath, synced: !!lyrics.syncedLyrics };
}

module.exports = {
    search: (query, limit) => getHandler().search(query, limit),
    getMetadata: (url) => getHandler().getMetadata(url),
    checkAvailability: (trackID) => getHandler().checkAvailability(trackID),
    downloadTrack: (options, onProgress) => getHandler().downloadTrack(options, onProgress),
    downloadLyrics,
    fetchLyrics,
    parseSpotifyURI
};
