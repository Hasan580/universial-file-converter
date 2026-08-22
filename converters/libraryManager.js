const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const AdmZip = require('adm-zip');

let electronApp = null;
try {
    electronApp = require('electron').app;
} catch (_) {
    electronApp = null;
}

const YTDLP_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const YTDLP_WINDOWS_DOWNLOAD = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest';

function getUserDataRoot() {
    try {
        if (electronApp && typeof electronApp.getPath === 'function') {
            return electronApp.getPath('userData');
        }
    } catch (_) {
        // Fall back below when Electron app paths are unavailable.
    }

    const baseRoot = process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir() || process.cwd();
    return path.join(baseRoot, 'Universal File Converter');
}

function ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
    return dirPath;
}

function getLibrariesRoot() {
    return ensureDirectory(path.join(getUserDataRoot(), 'libraries'));
}

function getManagedYtdlpPath() {
    return path.join(getLibrariesRoot(), 'yt-dlp', 'yt-dlp.exe');
}

function getManagedFfmpegDir() {
    return path.join(getLibrariesRoot(), 'ffmpeg');
}

function getManagedFfmpegPath() {
    return path.join(getManagedFfmpegDir(), 'ffmpeg.exe');
}

function getManagedFfprobePath() {
    return path.join(getManagedFfmpegDir(), 'ffprobe.exe');
}

function fileExists(filePath) {
    try {
        return !!filePath && fs.existsSync(filePath);
    } catch (_) {
        return false;
    }
}

function safeUnlink(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (_) {
        // Ignore cleanup failures.
    }
}

function safeRemoveDir(dirPath) {
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (_) {
        // Ignore cleanup failures.
    }
}

function requestUrl(url, options = {}, redirectCount = 0) {
    const maxRedirects = 5;
    const transport = url.startsWith('https:') ? https : http;

    return new Promise((resolve, reject) => {
        const request = transport.get(url, options, (response) => {
            const statusCode = response.statusCode || 0;

            if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
                if (redirectCount >= maxRedirects) {
                    response.resume();
                    reject(new Error(`Too many redirects while requesting ${url}`));
                    return;
                }

                const redirectedUrl = new URL(response.headers.location, url).toString();
                response.resume();
                resolve(requestUrl(redirectedUrl, options, redirectCount + 1));
                return;
            }

            resolve(response);
        });

        request.on('error', reject);
    });
}

async function fetchJson(url) {
    const response = await requestUrl(url, {
        headers: {
            'User-Agent': 'Universal-File-Converter',
            'Accept': 'application/vnd.github+json'
        }
    });

    const statusCode = response.statusCode || 0;
    if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        throw new Error(`Request failed with status ${statusCode}`);
    }

    return new Promise((resolve, reject) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
            body += chunk;
        });
        response.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error(`Invalid JSON response: ${error.message}`));
            }
        });
        response.on('error', reject);
    });
}

async function downloadFile(url, destinationPath, onProgress) {
    const tempPath = `${destinationPath}.download`;
    safeUnlink(tempPath);
    ensureDirectory(path.dirname(destinationPath));

    const response = await requestUrl(url, {
        headers: {
            'User-Agent': 'Universal-File-Converter',
            'Accept': '*/*'
        }
    });

    const statusCode = response.statusCode || 0;
    if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        throw new Error(`Download failed with status ${statusCode}`);
    }

    const totalBytes = parseInt(response.headers['content-length'] || '0', 10) || 0;
    let transferredBytes = 0;

    await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(tempPath);

        response.on('data', (chunk) => {
            transferredBytes += chunk.length;
            if (typeof onProgress === 'function') {
                const percent = totalBytes > 0 ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : null;
                onProgress({
                    transferred: transferredBytes,
                    total: totalBytes,
                    percent
                });
            }
        });

        response.on('error', (error) => {
            output.destroy();
            safeUnlink(tempPath);
            reject(error);
        });

        output.on('error', (error) => {
            response.destroy();
            safeUnlink(tempPath);
            reject(error);
        });

        output.on('finish', resolve);
        response.pipe(output);
    });

    fs.renameSync(tempPath, destinationPath);
    return destinationPath;
}

function copyDirectoryContents(sourceDir, destinationDir) {
    ensureDirectory(destinationDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const destinationPath = path.join(destinationDir, entry.name);

        if (entry.isDirectory()) {
            copyDirectoryContents(sourcePath, destinationPath);
            continue;
        }

        ensureDirectory(path.dirname(destinationPath));
        fs.copyFileSync(sourcePath, destinationPath);
    }
}

function findDirectory(rootDir, predicate) {
    const stack = [rootDir];

    while (stack.length > 0) {
        const currentDir = stack.pop();
        if (!currentDir || !fileExists(currentDir)) continue;

        let entries = [];
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true });
        } catch (_) {
            continue;
        }

        if (predicate(currentDir, entries)) {
            return currentDir;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                stack.push(path.join(currentDir, entry.name));
            }
        }
    }

    return null;
}

function getCommandVersion(executablePath, args, parser) {
    return new Promise((resolve) => {
        if (!fileExists(executablePath)) {
            resolve('');
            return;
        }

        execFile(executablePath, args, { timeout: 15000 }, (error, stdout, stderr) => {
            if (error && !stdout && !stderr) {
                resolve('');
                return;
            }

            const output = String(stdout || stderr || '').trim();
            if (!output) {
                resolve('');
                return;
            }

            resolve(typeof parser === 'function' ? parser(output) : output.split(/\r?\n/)[0]);
        });
    });
}

function chooseFfmpegAsset(assets) {
    if (!Array.isArray(assets)) return null;

    const preferredPatterns = [
        /win64-gpl.*\.zip$/i,
        /win64-lgpl.*\.zip$/i,
        /win64.*\.zip$/i
    ];

    for (const pattern of preferredPatterns) {
        const match = assets.find((asset) => {
            const name = String(asset?.name || '');
            return pattern.test(name) &&
                !/shared/i.test(name) &&
                !/debug/i.test(name) &&
                !/sources?/i.test(name);
        });

        if (match) return match;
    }

    return null;
}

async function updateYtdlp(onProgress) {
    const targetPath = getManagedYtdlpPath();
    const targetDir = path.dirname(targetPath);
    ensureDirectory(targetDir);

    await downloadFile(YTDLP_WINDOWS_DOWNLOAD, targetPath, onProgress);

    const version = await getCommandVersion(targetPath, ['--version'], (output) => output.split(/\r?\n/)[0].trim());
    return {
        path: targetPath,
        version
    };
}

async function updateFfmpeg(onProgress) {
    const releaseInfo = await fetchJson(FFMPEG_RELEASE_API);
    const asset = chooseFfmpegAsset(releaseInfo.assets || []);
    if (!asset?.browser_download_url) {
        throw new Error('Could not find a Windows FFmpeg build in the latest release.');
    }

    const tempRoot = ensureDirectory(path.join(os.tmpdir(), `ufc-ffmpeg-update-${Date.now()}`));
    const archivePath = path.join(tempRoot, asset.name || 'ffmpeg.zip');
    const extractDir = path.join(tempRoot, 'extract');
    const finalDir = getManagedFfmpegDir();

    try {
        await downloadFile(asset.browser_download_url, archivePath, onProgress);

        const zip = new AdmZip(archivePath);
        zip.extractAllTo(extractDir, true);

        const binDir = findDirectory(extractDir, (dirPath, entries) => {
            const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
            return names.has('ffmpeg.exe') && names.has('ffprobe.exe') &&
                (path.basename(dirPath).toLowerCase() === 'bin' || names.size >= 2);
        });

        if (!binDir) {
            throw new Error('Downloaded FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe.');
        }

        safeRemoveDir(finalDir);
        copyDirectoryContents(binDir, finalDir);

        const ffmpegPath = getManagedFfmpegPath();
        const ffprobePath = getManagedFfprobePath();

        if (!fileExists(ffmpegPath) || !fileExists(ffprobePath)) {
            throw new Error('FFmpeg update completed, but the binaries were not installed correctly.');
        }

        const version = await getCommandVersion(ffmpegPath, ['-version'], (output) => output.split(/\r?\n/)[0].trim());
        return {
            path: ffmpegPath,
            ffprobePath,
            version,
            assetName: String(asset.name || '')
        };
    } finally {
        safeRemoveDir(tempRoot);
    }
}

async function getManagedLibraryVersions() {
    const ytdlpPath = getManagedYtdlpPath();
    const ffmpegPath = getManagedFfmpegPath();
    const ffprobePath = getManagedFfprobePath();

    return {
        ytdlp: {
            path: ytdlpPath,
            exists: fileExists(ytdlpPath),
            version: await getCommandVersion(ytdlpPath, ['--version'], (output) => output.split(/\r?\n/)[0].trim())
        },
        ffmpeg: {
            path: ffmpegPath,
            ffprobePath,
            exists: fileExists(ffmpegPath),
            version: await getCommandVersion(ffmpegPath, ['-version'], (output) => output.split(/\r?\n/)[0].trim())
        }
    };
}

module.exports = {
    getLibrariesRoot,
    getManagedYtdlpPath,
    getManagedFfmpegDir,
    getManagedFfmpegPath,
    getManagedFfprobePath,
    getManagedLibraryVersions,
    updateYtdlp,
    updateFfmpeg
};
