/**
 * Video/Audio Downloader Handler
 * Uses yt-dlp for downloading from YouTube and other sites
 */

const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const https = require('https');
const libraryManager = require('./libraryManager');

// Use original-fs to avoid Electron's asar-patched fs (which gives false positives for files inside .asar)
let realFs = fs;
try {
    realFs = require('original-fs');
} catch (e) {
    // Not in Electron context, use regular fs
    realFs = fs;
}

// Store active download process
let activeDownload = null;

// yt-dlp executable path
let ytdlpPath = null;

// Initialization state
let isInitializing = false;
let initializationPromise = null;

/**
 * Initialize - find yt-dlp from bundled location or download it
 */
async function initialize() {
    // If already initialized, return immediately
    if (ytdlpPath !== null) {
        return true;
    }
    
    // If initialization is in progress, wait for it
    if (isInitializing && initializationPromise) {
        return await initializationPromise;
    }
    
    isInitializing = true;
    initializationPromise = doInitialize();
    
    try {
        const result = await initializationPromise;
        return result;
    } finally {
        isInitializing = false;
    }
}

async function doInitialize() {
    // Check multiple possible locations for yt-dlp
    const possiblePaths = [];

    // Runtime-managed latest copy
    possiblePaths.push(libraryManager.getManagedYtdlpPath());

    // Packaged app - resources folder
    if (process.resourcesPath) {
        possiblePaths.push(path.join(process.resourcesPath, 'yt-dlp.exe'));
    }

    // Dev mode - project root (where package.json is)
    possiblePaths.push(path.join(__dirname, '..', 'yt-dlp.exe'));

    // Converters folder
    possiblePaths.push(path.join(__dirname, 'yt-dlp.exe'));

    // User's AppData (for downloaded yt-dlp)
    const appDataPath = process.env.APPDATA || process.env.HOME;
    if (appDataPath) {
        possiblePaths.push(path.join(appDataPath, 'Universal File Converter', 'yt-dlp.exe'));
    }

    for (const tryPath of possiblePaths) {
        console.log('Checking yt-dlp at:', tryPath, 'exists:', realFs.existsSync(tryPath));
        if (realFs.existsSync(tryPath)) {
            ytdlpPath = tryPath;
            console.log('Found yt-dlp at:', ytdlpPath);
            return true;
        }
    }

    // Check if yt-dlp is in PATH
    const inPath = await new Promise((resolve) => {
        exec('yt-dlp --version', (error, stdout) => {
            if (!error && stdout) {
                ytdlpPath = 'yt-dlp';
                console.log('Using system yt-dlp:', stdout.trim());
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });

    if (inPath) return true;

    // Not found anywhere - try to download
    console.log('yt-dlp not found, attempting to download...');
    const downloaded = await downloadYtdlp();
    return downloaded;
}

/**
 * Download yt-dlp executable
 */
async function downloadYtdlp() {
    try {
        console.log('Downloading yt-dlp...');
        const result = await libraryManager.updateYtdlp();
        ytdlpPath = result.path;
        console.log('yt-dlp downloaded successfully');
        return true;
    } catch (err) {
        console.error('Failed to download yt-dlp:', err);
        return false;
    }
}

/**
 * Check if yt-dlp is available
 */
function isAvailable() {
    return ytdlpPath !== null;
}

/**
 * Get playlist information (fast - uses flat-playlist mode)
 */
async function getPlaylistInfo(url) {
    if (!ytdlpPath) {
        await initialize();
    }

    if (!ytdlpPath) {
        throw new Error('yt-dlp is not available.');
    }

    if (!realFs.existsSync(ytdlpPath)) {
        ytdlpPath = null;
        await initialize();
        if (!ytdlpPath) throw new Error('yt-dlp not available.');
    }

    return new Promise((resolve, reject) => {
        const args = [
            '--flat-playlist',       // Only get metadata, don't resolve each video (FAST)
            '--dump-json',
            '--no-warnings',
            '--geo-bypass',
            '--no-check-certificates',
            '--force-ipv4',
            '--socket-timeout', '30',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            url
        ];

        let output = '';
        let error = '';

        const proc = spawn(ytdlpPath, args);

        proc.stdout.on('data', (data) => {
            output += data.toString();
        });

        proc.stderr.on('data', (data) => {
            error += data.toString();
        });

        proc.on('close', async (code) => {
            if (code === 0 && output) {
                try {
                    // Each line is a separate JSON object (one per video)
                    const lines = output.trim().split('\n').filter(l => l.trim());
                    const entries = [];
                    let playlistTitle = 'Playlist';

                    for (const line of lines) {
                        try {
                            const entry = JSON.parse(line);
                            // flat-playlist gives minimal info per entry
                            // entry.url from --flat-playlist is often just the video ID, not a full URL
                            const videoId = entry.id || entry.url || '';
                            let fullUrl = entry.webpage_url || '';
                            if (!fullUrl) {
                                // Construct full URL from video ID
                                if (videoId.startsWith('http')) {
                                    fullUrl = videoId;
                                } else {
                                    fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
                                }
                            }
                            entries.push({
                                id: videoId,
                                title: entry.title || entry.id || 'Unknown',
                                url: fullUrl,
                                duration: entry.duration || 0,
                                uploader: entry.uploader || entry.channel || '',
                                thumbnail: entry.thumbnails && entry.thumbnails.length > 0
                                    ? entry.thumbnails[entry.thumbnails.length - 1].url
                                    : (videoId && !videoId.startsWith('http')
                                        ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
                                        : '')
                            });
                            // Grab playlist title from first entry
                            if (entry.playlist_title) playlistTitle = entry.playlist_title;
                        } catch (e) {
                            // Skip malformed lines
                        }
                    }

                    resolve({
                        title: playlistTitle,
                        count: entries.length,
                        entries: entries
                    });
                } catch (err) {
                    reject(new Error('Failed to parse playlist info'));
                }
            } else {
                reject(new Error(error || 'Failed to get playlist info. Make sure the URL is a valid playlist.'));
            }
        });

        proc.on('error', (err) => {
            reject(new Error(`Failed to run yt-dlp: ${err.message}`));
        });

        // Timeout after 60 seconds
        setTimeout(() => {
            try { proc.kill(); } catch (e) {}
            reject(new Error('Playlist fetch timed out. Try again or use a direct playlist URL.'));
        }, 60000);
    });
}

/**
 * Get video/audio information from URL
 */
async function getInfo(url) {
    if (!ytdlpPath) {
        await initialize();
    }

    if (!ytdlpPath) {
        throw new Error('yt-dlp is not available. Please install it manually.');
    }

    // Verify yt-dlp actually exists on disk (not inside asar)
    if (!realFs.existsSync(ytdlpPath)) {
        console.log('yt-dlp path was set but file not found on real disk, re-initializing...');
        ytdlpPath = null;
        await initialize();
        if (!ytdlpPath) {
            throw new Error('yt-dlp is not available. Could not find or download yt-dlp.');
        }
    }

    return new Promise((resolve, reject) => {
        const args = [
            '--dump-json',
            '--no-download',
            '--no-warnings',
            // VPN and geo-bypass options
            '--geo-bypass',
            '--no-check-certificates',
            '--force-ipv4',
            '--socket-timeout', '30',
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            url
        ];

        let output = '';
        let error = '';

        const process = spawn(ytdlpPath, args);

        process.stdout.on('data', (data) => {
            output += data.toString();
        });

        process.stderr.on('data', (data) => {
            error += data.toString();
        });

        process.on('close', async (code) => {
            if (code === 0 && output) {
                try {
                    const info = JSON.parse(output);
                    
                    // Try to fetch thumbnail as base64 to bypass CORS
                    let thumbnailData = null;
                    if (info.thumbnail) {
                        thumbnailData = await fetchThumbnailAsBase64(info.thumbnail);
                        console.log('Thumbnail data result:', thumbnailData ? 'base64 (' + thumbnailData.substring(0, 50) + '...)' : 'null');
                    }
                    
                    const result = {
                        title: info.title || 'Unknown',
                        thumbnail: thumbnailData || null, // Only use base64, don't fall back to URL
                        duration: info.duration || 0,
                        uploader: info.uploader || 'Unknown',
                        formats: extractFormats(info.formats || []),
                        url: url,
                        // Subtitle info
                        hasSubtitles: !!(info.subtitles && Object.keys(info.subtitles).length > 0),
                        hasAutoSubtitles: !!(info.automatic_captions && Object.keys(info.automatic_captions).length > 0),
                        availableSubtitleLangs: [
                            ...Object.keys(info.subtitles || {}),
                            ...Object.keys(info.automatic_captions || {}).map(k => k + ' (auto)')
                        ].slice(0, 20),
                        // Thumbnail URL for separate download
                        thumbnailUrl: info.thumbnail || null
                    };
                    
                    console.log('Returning video info with thumbnail:', result.thumbnail ? 'present' : 'null');
                    resolve(result);
                } catch (err) {
                    reject(new Error('Failed to parse video info'));
                }
            } else {
                reject(new Error(error || 'Failed to get video info'));
            }
        });

        process.on('error', (err) => {
            reject(new Error(`Failed to run yt-dlp: ${err.message}`));
        });
    });
}

/**
 * Fetch thumbnail and convert to base64 data URL
 */
async function fetchThumbnailAsBase64(thumbnailUrl) {
    return new Promise((resolve) => {
        try {
            if (!thumbnailUrl) {
                console.log('No thumbnail URL provided');
                resolve(null);
                return;
            }

            // For YouTube, extract video ID and use direct thumbnail URL
            let urlToFetch = thumbnailUrl;
            
            // Check for youtu.be or youtube.com in the original video URL or thumbnail
            const ytPatterns = [
                /\/vi\/([a-zA-Z0-9_-]{11})/,
                /youtu\.be\/([a-zA-Z0-9_-]{11})/,
                /[?&]v=([a-zA-Z0-9_-]{11})/,
                /embed\/([a-zA-Z0-9_-]{11})/
            ];
            
            for (const pattern of ytPatterns) {
                const match = thumbnailUrl.match(pattern);
                if (match && match[1]) {
                    // Use mqdefault for better compatibility (320x180)
                    urlToFetch = `https://i.ytimg.com/vi/${match[1]}/mqdefault.jpg`;
                    console.log('YouTube video ID found:', match[1]);
                    break;
                }
            }
            
            console.log('Fetching thumbnail from:', urlToFetch);
            
            const urlObj = new URL(urlToFetch);
            const protocol = urlObj.protocol === 'https:' ? https : require('http');
            
            const options = {
                hostname: urlObj.hostname,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache'
                },
                timeout: 15000,  // Longer timeout for VPN
                family: 4,  // Force IPv4 for VPN compatibility
                rejectUnauthorized: false  // Skip certificate check for some VPNs
            };
            
            const request = protocol.request(options, (response) => {
                console.log('Thumbnail response status:', response.statusCode);
                
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    console.log('Redirecting to:', response.headers.location);
                    fetchThumbnailAsBase64(response.headers.location).then(resolve);
                    return;
                }
                
                if (response.statusCode !== 200) {
                    console.log('Thumbnail fetch failed with status:', response.statusCode);
                    resolve(null);
                    return;
                }
                
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => {
                    try {
                        const buffer = Buffer.concat(chunks);
                        console.log('Thumbnail size:', buffer.length, 'bytes');
                        if (buffer.length < 100) {
                            console.log('Thumbnail too small, likely failed');
                            resolve(null);
                            return;
                        }
                        const contentType = response.headers['content-type'] || 'image/jpeg';
                        const base64 = buffer.toString('base64');
                        resolve(`data:${contentType};base64,${base64}`);
                    } catch (e) {
                        console.log('Failed to convert thumbnail to base64:', e);
                        resolve(null);
                    }
                });
                response.on('error', (e) => {
                    console.log('Thumbnail response error:', e);
                    resolve(null);
                });
            });
            
            request.on('error', (e) => {
                console.log('Thumbnail request error:', e);
                resolve(null);
            });
            
            request.on('timeout', () => {
                console.log('Thumbnail request timeout');
                request.destroy();
                resolve(null);
            });
            
            request.end();
        } catch (e) {
            console.log('Thumbnail fetch error:', e);
            resolve(null);
        }
    });
}

/**
 * Embed thumbnail into audio file using ffmpeg directly
 * This is more reliable than yt-dlp's --embed-thumbnail which fails on large files
 */
function embedThumbnailWithFfmpeg(ffmpegBin, audioFile, thumbnailFile) {
    return new Promise((resolve, reject) => {
        const ext = path.extname(audioFile).toLowerCase();
        const tempOutput = audioFile + '.tmp' + ext;
        
        let ffmpegArgs;
        if (ext === '.mp3') {
            // For MP3: use ID3v2 APIC tag
            ffmpegArgs = [
                '-i', audioFile,
                '-i', thumbnailFile,
                '-map', '0:a',
                '-map', '1:0',
                '-c:a', 'copy',          // Copy audio stream (no re-encoding = fast)
                '-id3v2_version', '3',
                '-metadata:s:v', 'title=Album cover',
                '-metadata:s:v', 'comment=Cover (front)',
                '-disposition:v', 'attached_pic',
                '-y',
                tempOutput
            ];
        } else if (ext === '.flac') {
            // For FLAC: embed as metadata picture
            ffmpegArgs = [
                '-i', audioFile,
                '-i', thumbnailFile,
                '-map', '0:a',
                '-map', '1:0',
                '-c:a', 'copy',
                '-disposition:v', 'attached_pic',
                '-metadata:s:v', 'title=Album cover',
                '-metadata:s:v', 'comment=Cover (front)',
                '-y',
                tempOutput
            ];
        } else if (ext === '.m4a' || ext === '.mp4') {
            // For M4A/MP4: embed as cover art
            ffmpegArgs = [
                '-i', audioFile,
                '-i', thumbnailFile,
                '-map', '0:a',
                '-map', '1:0',
                '-c:a', 'copy',
                '-c:v', 'mjpeg',
                '-disposition:v', 'attached_pic',
                '-y',
                tempOutput
            ];
        } else {
            // Unsupported format for thumbnail embedding
            console.log('Thumbnail embedding not supported for', ext);
            resolve();
            return;
        }
        
        console.log('Embedding thumbnail with ffmpeg:', ffmpegBin, ffmpegArgs.join(' '));
        
        const proc = spawn(ffmpegBin, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        
        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        
        proc.on('close', (exitCode) => {
            if (exitCode === 0 && fs.existsSync(tempOutput)) {
                // Replace original with embedded version
                try {
                    fs.unlinkSync(audioFile);
                    fs.renameSync(tempOutput, audioFile);
                    console.log('Thumbnail embedded successfully into', path.basename(audioFile));
                    resolve();
                } catch (e) {
                    console.error('Failed to replace audio file:', e.message);
                    // Clean up temp
                    try { fs.unlinkSync(tempOutput); } catch (e2) {}
                    reject(e);
                }
            } else {
                // Clean up temp on failure
                try { fs.unlinkSync(tempOutput); } catch (e) {}
                console.error('ffmpeg thumbnail embed failed (code ' + exitCode + '):', stderr.slice(-500));
                reject(new Error('ffmpeg embed failed: ' + stderr.slice(-200)));
            }
        });
        
        proc.on('error', (err) => {
            try { fs.unlinkSync(tempOutput); } catch (e) {}
            reject(err);
        });
        
        // Timeout after 30 seconds (embedding should be fast since audio is copy)
        setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch (e) {}
        }, 30000);
    });
}

/**
 * Simple fallback thumbnail embed using ffmpeg (fewer options, more compatible)
 */
function embedThumbnailSimple(ffmpegBin, audioFile, thumbnailFile) {
    return new Promise((resolve, reject) => {
        const ext = path.extname(audioFile).toLowerCase();
        const tempOutput = audioFile + '.embed' + ext;
        
        // Simple approach: just add the image as a video stream
        const ffmpegArgs = [
            '-y',
            '-i', audioFile,
            '-i', thumbnailFile,
            '-map', '0:a',
            '-map', '1:0',
            '-c', 'copy',
            '-disposition:1', 'attached_pic',
            tempOutput
        ];
        
        const proc = spawn(ffmpegBin, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (data) => { stderr += data.toString(); });
        
        proc.on('close', (exitCode) => {
            if (exitCode === 0 && fs.existsSync(tempOutput)) {
                try {
                    fs.unlinkSync(audioFile);
                    fs.renameSync(tempOutput, audioFile);
                    resolve();
                } catch (e) {
                    try { fs.unlinkSync(tempOutput); } catch (e2) {}
                    reject(e);
                }
            } else {
                try { fs.unlinkSync(tempOutput); } catch (e) {}
                reject(new Error('Simple embed failed'));
            }
        });
        
        proc.on('error', (err) => {
            try { fs.unlinkSync(tempOutput); } catch (e) {}
            reject(err);
        });
        
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} }, 30000);
    });
}

/**
 * Extract and simplify available formats
 */
function extractFormats(formats) {
    const videoFormats = [];
    const audioFormats = [];

    for (const f of formats) {
        if (f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none') {
            // Combined video+audio
            const height = f.height || 0;
            if (height >= 360 && !videoFormats.find(v => v.height === height)) {
                videoFormats.push({
                    format_id: f.format_id,
                    ext: f.ext || 'mp4',
                    height: height,
                    quality: `${height}p`,
                    filesize: f.filesize || f.filesize_approx || 0
                });
            }
        } else if (f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')) {
            // Audio only
            const abr = f.abr || 128;
            if (!audioFormats.find(a => a.abr === abr)) {
                audioFormats.push({
                    format_id: f.format_id,
                    ext: f.ext || 'm4a',
                    abr: abr,
                    quality: `${abr}kbps`,
                    filesize: f.filesize || f.filesize_approx || 0
                });
            }
        }
    }

    // Sort by quality
    videoFormats.sort((a, b) => b.height - a.height);
    audioFormats.sort((a, b) => b.abr - a.abr);

    return {
        video: videoFormats.slice(0, 5), // Top 5 video qualities
        audio: audioFormats.slice(0, 3)  // Top 3 audio qualities
    };
}

/**
 * Download video or audio
 */
async function download(options, progressCallback) {
    const {
        url,
        outputDirectory,
        format = 'mp4', // mp4, mp3, m4a, webm
        quality = 'best',
        audioBitrate = '192',
        audioOnly = false,
        downloadSubtitles = false,
        downloadThumbnail = false,
        subtitleLanguage = 'en'
    } = options;
    const normalizedAudioBitrate = (() => {
        const parsed = parseInt(audioBitrate, 10);
        if (!Number.isFinite(parsed)) return null;
        return Math.max(64, Math.min(320, parsed));
    })();

    if (!ytdlpPath) {
        await initialize();
    }

    if (!ytdlpPath) {
        throw new Error('yt-dlp is not available');
    }

    // Double-check yt-dlp actually exists on disk (not inside asar)
    if (!realFs.existsSync(ytdlpPath)) {
        console.log('yt-dlp path was set but file not found on disk, re-initializing...');
        ytdlpPath = null;
        await initialize();
        if (!ytdlpPath) {
            throw new Error('yt-dlp is not available. Could not find or download yt-dlp.');
        }
    }

    // Ensure output directory exists
    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    // Get FFmpeg path for merging
    let ffmpegPath = null;
    try {
        const ffmpegPaths = require('./ffmpegPaths');
        ffmpegPath = ffmpegPaths.getFfmpegPath();
        console.log('Using FFmpeg for merging:', ffmpegPath);
    } catch (e) {
        console.log('FFmpeg paths not available:', e.message);
    }

    return new Promise((resolve, reject) => {
        const outputTemplate = path.join(outputDirectory, '%(title)s.%(ext)s');

        const args = [
            '--progress',
            '--newline',
            '-o', outputTemplate,
            '--no-warnings',
            '--no-playlist',  // Don't download playlists
            // Speed optimization options
            '--concurrent-fragments', '8',  // Download 8 fragments at once for faster speed
            '--buffer-size', '64K',  // Larger buffer for faster throughput
            '--retries', '10',  // More retries for unstable connections
            '--fragment-retries', '10',
            // VPN and geo-bypass options
            '--geo-bypass',  // Bypass geographic restrictions
            '--geo-bypass-country', 'US',  // Try US geo-bypass
            '--no-check-certificates',  // Skip certificate verification (useful for some VPNs)
            '--force-ipv4',  // Force IPv4 (some VPNs have IPv6 issues)
            '--socket-timeout', '60',  // Longer timeout for VPN latency
            // Extractor arguments for robust YouTube/site streaming
            '--extractor-args', 'youtube:player_client=android,web;prefer_free_formats=true',
            '--extractor-args', 'pornhub:prefer_free_formats=true',
            // User agent to avoid blocks
            '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
            // Add referer header for sites that check it
            '--referer', url,
            // Add extra headers
            '--add-header', 'Accept:*/*',
            '--add-header', 'Accept-Language:en-US,en;q=0.9'
        ];

        // Add subtitle download options
        if (downloadSubtitles) {
            args.push('--write-subs');           // Write subtitle files
            args.push('--write-auto-subs');      // Also get auto-generated subs
            args.push('--sub-langs', subtitleLanguage || 'en');  // Language
            args.push('--sub-format', 'srt/ass/vtt');  // Preferred formats
            args.push('--embed-subs');           // Also embed subs in video file
            args.push('--convert-subs', 'srt');  // Convert to SRT for compatibility
        }

        // Add separate thumbnail download (saves as a separate image file)
        if (downloadThumbnail) {
            args.push('--write-thumbnail');       // Save thumbnail as separate file
        }

        // Add FFmpeg location if available (needed for merging video+audio)
        let ffmpegDir = null;
        if (ffmpegPath && fs.existsSync(ffmpegPath)) {
            ffmpegDir = path.dirname(ffmpegPath);
        } else {
            const managedFfmpeg = libraryManager.getManagedFfmpegPath();
            if (fs.existsSync(managedFfmpeg)) {
                ffmpegDir = path.dirname(managedFfmpeg);
            }
        }
        if (ffmpegDir) {
            args.push('--ffmpeg-location', ffmpegDir);
        }

        // Check if this is a site that commonly has geo-blocked HLS streams
        const geoBlockedSites = ['pornhub', 'xvideos', 'xhamster', 'redtube', 'youporn', 'tube8'];
        const isGeoBlockedSite = geoBlockedSites.some(site => url.toLowerCase().includes(site));

        if (audioOnly || format === 'mp3' || format === 'm4a' || format === 'flac') {
            // Audio only download
            args.push('-x'); // Extract audio
            // Prefer best source audio to avoid re-encoding overhead
            args.push('-f', 'bestaudio[ext=m4a]/bestaudio/best');
            if (format === 'flac') {
                args.push('--audio-format', 'flac');
                args.push('--audio-quality', '0');  // Best quality for lossless
            } else {
                args.push('--audio-format', format === 'mp3' ? 'mp3' : 'm4a');
                // Respect requested bitrate when available (for example MP3 320 kbps).
                args.push('--audio-quality', normalizedAudioBitrate ? `${normalizedAudioBitrate}K` : '0');
            }
            // Add metadata for audio files
            args.push('--embed-metadata');  // Embed metadata (title, artist, etc.)
            args.push('--parse-metadata', 'title:%(title)s');
            args.push('--parse-metadata', 'uploader:%(artist)s');
            // Always write thumbnail for manual embedding later (most reliable method)
            args.push('--write-thumbnail');
            args.push('--convert-thumbnails', 'jpg');
        } else {
            // Video download
            if (isGeoBlockedSite) {
                // For geo-blocked sites: prefer direct MP4 downloads to avoid HLS CDN blocking
                if (quality === 'best') {
                    args.push('-f', 'best[protocol=https][ext=mp4]/best[protocol=http][ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
                } else {
                    const height = parseInt(quality) || 720;
                    args.push('-f', `best[height<=${height}][protocol=https][ext=mp4]/best[height<=${height}][protocol=http][ext=mp4]/bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]`);
                }
            } else {
                // For normal sites (YouTube, etc.): prioritize best quality with merging
                if (format === 'webm') {
                    // WebM format: prefer VP9/VP8 video + Opus/Vorbis audio
                    if (quality === 'best') {
                        args.push('-f', 'bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio/best');
                    } else {
                        const height = parseInt(quality) || 720;
                        args.push('-f', `bestvideo[height<=${height}][ext=webm]+bestaudio[ext=webm]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`);
                    }
                } else if (quality === 'best') {
                    // Best quality: merge best video + best audio streams
                    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best');
                } else {
                    // Specific quality requested
                    const height = parseInt(quality) || 720;
                    args.push('-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}][ext=mp4]/best[height<=${height}]`);
                }
            }
            
            // Set output container format
            const outputContainer = format === 'webm' ? 'webm' : 'mp4';
            args.push('--merge-output-format', outputContainer);
            // Add metadata for video files
            args.push('--embed-metadata');
            if (downloadThumbnail) {
                args.push('--embed-thumbnail');
                args.push('--convert-thumbnails', 'jpg');
            }
        }

        args.push(url);

        console.log('Download command:', ytdlpPath, args.join(' '));

        let lastProgress = 0;
        let outputFile = '';
        let errorOutput = '';
        
        // Track download phases for accurate progress
        // Phase 0: video download (0-45%), Phase 1: audio download (45-90%), Phase 2: merging (90-100%)
        let currentPhase = 0;
        let phaseProgress = 0;
        let isMultiStream = !audioOnly && format !== 'mp3' && format !== 'm4a'; // Video downloads use separate streams
        let destinationCount = 0; // Count "Destination:" lines to detect multi-stream

        activeDownload = spawn(ytdlpPath, args);

        activeDownload.stdout.on('data', (data) => {
            const line = data.toString();
            console.log('yt-dlp:', line);

            // Detect multi-stream download by counting "Destination:" lines
            const destMatch = line.match(/Destination: (.+)/);
            if (destMatch) {
                destinationCount++;
                outputFile = destMatch[1].trim();
                
                // If we see a second destination, we're in audio download phase
                if (destinationCount === 2 && isMultiStream) {
                    currentPhase = 1;
                    phaseProgress = 0;
                }
            }

            // Detect merging phase
            const mergeMatch = line.match(/Merging formats into "(.+)"/);
            if (mergeMatch) {
                outputFile = mergeMatch[1].trim();
                currentPhase = 2;
                // Report 95% when merging starts
                if (progressCallback) {
                    progressCallback({
                        progress: 95,
                        speed: null,
                        eta: 'Merging...',
                        phase: 'merge'
                    });
                }
            }

            // Parse progress, speed, and ETA
            const progressMatch = line.match(/(\d+\.?\d*)%/);
            const speedMatch = line.match(/at\s+([^\s]+\/s)/i) || line.match(/(\d+\.?\d*\s*[KMG]i?B\/s)/i);
            const etaMatch = line.match(/ETA\s+(\d+:\d+(?::\d+)?)/i) || line.match(/in\s+(\d+:\d+(?::\d+)?)/i);
            
            if (progressMatch) {
                phaseProgress = parseFloat(progressMatch[1]);
                
                let overallProgress;
                if (!isMultiStream || destinationCount <= 1) {
                    // Single stream (audio only or combined format) - direct 0-100%
                    overallProgress = phaseProgress;
                } else {
                    // Multi-stream download: calculate weighted progress
                    if (currentPhase === 0) {
                        // Video download: 0-45%
                        overallProgress = (phaseProgress / 100) * 45;
                    } else if (currentPhase === 1) {
                        // Audio download: 45-90%
                        overallProgress = 45 + (phaseProgress / 100) * 45;
                    } else {
                        // Merging: 90-100%
                        overallProgress = 90 + (phaseProgress / 100) * 10;
                    }
                }
                
                overallProgress = Math.round(overallProgress);
                
                if (overallProgress > lastProgress || speedMatch || etaMatch) {
                    lastProgress = overallProgress;
                    if (progressCallback) {
                        progressCallback({
                            progress: overallProgress,
                            speed: speedMatch ? speedMatch[1] : null,
                            eta: etaMatch ? etaMatch[1] : null,
                            phase: currentPhase === 0 ? 'video' : (currentPhase === 1 ? 'audio' : 'merge')
                        });
                    }
                }
            }
        });

        activeDownload.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            console.error('yt-dlp error:', text);
        });

        activeDownload.on('close', async (code) => {
            activeDownload = null;

            // Find the downloaded file
            if (!outputFile || !fs.existsSync(outputFile)) {
                try {
                    const files = fs.readdirSync(outputDirectory)
                        .map(f => ({
                            name: f,
                            path: path.join(outputDirectory, f),
                            time: fs.statSync(path.join(outputDirectory, f)).mtimeMs
                        }))
                        .filter(f => (Date.now() - f.time) < 120000)
                        .sort((a, b) => b.time - a.time);

                    if (files.length > 0) {
                        outputFile = files[0].path;
                    }
                } catch (e) { }
            }

            const fileCreatedSuccessfully = outputFile && fs.existsSync(outputFile) && fs.statSync(outputFile).size > 0;

            if (code === 0 || fileCreatedSuccessfully) {
                // Report 100% on completion
                if (progressCallback) {
                    progressCallback({
                        progress: 100,
                        speed: null,
                        eta: null,
                        phase: 'complete'
                    });
                }
                
                if (outputFile && fs.existsSync(outputFile)) {
                    // Find any downloaded subtitle/thumbnail files
                    const subtitleFiles = [];
                    let thumbnailFile = null;
                    let thumbnailForEmbed = null;
                    
                    try {
                        const outputBaseName = path.basename(outputFile, path.extname(outputFile));
                        const dirFiles = fs.readdirSync(outputDirectory);
                        
                        for (const f of dirFiles) {
                            const fullPath = path.join(outputDirectory, f);
                            const fBaseName = path.basename(f, path.extname(f));
                            
                            // Match by exact base name OR by base name being a prefix (yt-dlp suffixes like .en.srt)
                            const isRelated = f.startsWith(outputBaseName) || 
                                              fBaseName === outputBaseName ||
                                              outputBaseName.startsWith(fBaseName);
                            
                            if (!isRelated || f === path.basename(outputFile)) continue;
                            
                            // Check for subtitle files (.srt, .vtt, .ass)
                            if (/\.(srt|vtt|ass|sub)$/i.test(f)) {
                                if (downloadSubtitles) {
                                    subtitleFiles.push(fullPath);
                                } else {
                                    try { fs.unlinkSync(fullPath); console.log('Cleaned up leftover subtitle:', f); } catch (e) {}
                                }
                            }
                            // Check for thumbnail files (.jpg, .png, .webp)
                            if (/\.(jpg|jpeg|png|webp)$/i.test(f)) {
                                // Keep track for embedding
                                if (!thumbnailForEmbed) thumbnailForEmbed = fullPath;
                                if (downloadThumbnail) {
                                    thumbnailFile = fullPath;
                                }
                            }
                        }
                    } catch (e) {
                        console.log('Error scanning for extra files:', e.message);
                    }
                    
                    // For audio files: manually embed thumbnail using ffmpeg (more reliable than yt-dlp --embed-thumbnail)
                    const isAudioFile = /\.(mp3|m4a|flac|ogg|opus)$/i.test(outputFile);
                    
                    // If no thumbnail found by name matching, search more broadly
                    if (isAudioFile && !thumbnailForEmbed) {
                        try {
                            const allFiles = fs.readdirSync(outputDirectory);
                            // Look for any recently created jpg/png/webp in the output dir
                            const recentThumb = allFiles
                                .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
                                .map(f => ({
                                    name: f,
                                    path: path.join(outputDirectory, f),
                                    time: fs.statSync(path.join(outputDirectory, f)).mtimeMs
                                }))
                                .filter(f => (Date.now() - f.time) < 60000)  // Created in last 60 seconds
                                .sort((a, b) => b.time - a.time);
                            if (recentThumb.length > 0) {
                                thumbnailForEmbed = recentThumb[0].path;
                                console.log('Found thumbnail by recency:', recentThumb[0].name);
                            }
                        } catch (e) {
                            console.log('Broad thumbnail search failed:', e.message);
                        }
                    }
                    
                    if (isAudioFile && thumbnailForEmbed && ffmpegPath && fs.existsSync(ffmpegPath)) {
                        console.log('Manually embedding thumbnail into audio file...');
                        if (progressCallback) {
                            progressCallback({ progress: 98, speed: null, eta: 'Embedding album art...', phase: 'merge' });
                        }
                        try {
                            await embedThumbnailWithFfmpeg(ffmpegPath, outputFile, thumbnailForEmbed);
                            console.log('Thumbnail embedded successfully');
                        } catch (embedErr) {
                            console.error('Failed to embed thumbnail:', embedErr.message);
                            // Try a simpler ffmpeg approach as last resort
                            try {
                                await embedThumbnailSimple(ffmpegPath, outputFile, thumbnailForEmbed);
                                console.log('Thumbnail embedded with simple method');
                            } catch (e2) {
                                console.error('Simple embed also failed:', e2.message);
                            }
                        }
                    }
                    
                    // Clean up ALL thumbnail/image files created by yt-dlp (unless user wants separate thumbnail)
                    if (!downloadThumbnail) {
                        try {
                            const outputBaseName = path.basename(outputFile, path.extname(outputFile));
                            const allDirFiles = fs.readdirSync(outputDirectory);
                            for (const f of allDirFiles) {
                                if (f === path.basename(outputFile)) continue;
                                if (/\.(jpg|jpeg|png|webp)$/i.test(f)) {
                                    const fullPath = path.join(outputDirectory, f);
                                    // Remove if name matches OR if it was the thumbnail we used for embedding
                                    const isRelatedName = f.startsWith(outputBaseName);
                                    const isEmbedThumb = thumbnailForEmbed && fullPath === thumbnailForEmbed;
                                    // Also catch recently created images (within last 30 seconds) that yt-dlp created
                                    let isRecent = false;
                                    try {
                                        const stat = fs.statSync(fullPath);
                                        isRecent = (Date.now() - stat.mtimeMs) < 30000;
                                    } catch (e) {}
                                    if (isRelatedName || isEmbedThumb || isRecent) {
                                        try { fs.unlinkSync(fullPath); console.log('Cleaned up thumbnail:', f); } catch (e) {}
                                    }
                                }
                            }
                        } catch (e) {
                            console.log('Thumbnail cleanup error:', e.message);
                        }
                    }
                    
                    resolve({
                        success: true,
                        outputPath: outputFile,
                        outputSize: fs.statSync(outputFile).size,
                        subtitleFiles: subtitleFiles,
                        thumbnailFile: thumbnailFile
                    });
                } else {
                    reject(new Error('Download completed but file not found'));
                }
            } else {
                const cleanedError = errorOutput
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l.startsWith('ERROR:') || l.includes('Error:'))
                    .join(' ')
                    .replace(/ERROR:\s*/g, '')
                    .trim();
                reject(new Error(cleanedError || 'Download failed. Please check the URL or try another quality option.'));
            }
        });

        activeDownload.on('error', (err) => {
            activeDownload = null;
            reject(new Error(`Download error: ${err.message}`));
        });
    });
}

function cancelDownload() {
    if (activeDownload) {
        try {
            // On Windows, SIGTERM doesn't work properly, use SIGKILL or taskkill
            if (process.platform === 'win32') {
                // Kill the process tree on Windows
                const { execSync } = require('child_process');
                try {
                    execSync(`taskkill /pid ${activeDownload.pid} /T /F`, { stdio: 'ignore' });
                } catch (e) {
                    // Process may have already exited
                    console.log('taskkill failed (process may have already exited):', e.message);
                }
            } else {
                activeDownload.kill('SIGKILL');
            }
        } catch (e) {
            console.error('Error killing download process:', e);
        }
        activeDownload = null;
        return true;
    }
    return false;
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
    if (!seconds) return '0:00';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
        return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

module.exports = {
    initialize,
    isAvailable,
    getInfo,
    getPlaylistInfo,
    download,
    cancelDownload,
    formatDuration,
    getYtdlpPath: () => ytdlpPath,
    refreshBinaryPath: async () => {
        ytdlpPath = null;
        return initialize();
    },
    updateYtdlp: async (progressCallback) => {
        const result = await libraryManager.updateYtdlp(progressCallback);
        ytdlpPath = result.path;
        return result;
    }
};
