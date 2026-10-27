/**
 * Python Bridge for SpotiFLAC Module
 * Detects Python, installs SpotiFLAC if needed, and runs download commands.
 */

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let cachedPythonPath = null;

/**
 * Find a working Python executable
 * @returns {Promise<string>} Path to python executable
 */
async function findPython() {
    if (cachedPythonPath) return cachedPythonPath;

    const candidates = process.platform === 'win32'
        ? ['python', 'python3', 'py']
        : ['python3', 'python'];

    for (const cmd of candidates) {
        try {
            const version = await new Promise((resolve, reject) => {
                execFile(cmd, ['--version'], { timeout: 5000 }, (err, stdout, stderr) => {
                    if (err) return reject(err);
                    const out = (stdout || '') + (stderr || '');
                    resolve(out.trim());
                });
            });
            if (version.includes('Python 3')) {
                cachedPythonPath = cmd;
                console.log(`[PythonBridge] Found Python: ${cmd} -> ${version}`);
                return cmd;
            }
        } catch (e) {
            // Try next
        }
    }
    throw new Error('Python 3 is not installed. Please install Python 3.8+ from python.org');
}

/**
 * Check if SpotiFLAC module is installed
 * @returns {Promise<boolean>}
 */
async function isSpotiFLACInstalled() {
    const python = await findPython();
    return new Promise((resolve) => {
        execFile(python, ['-c', 'import SpotiFLAC; print("ok")'], { timeout: 10000 }, (err, stdout) => {
            resolve(!err && stdout.trim() === 'ok');
        });
    });
}

/**
 * Install SpotiFLAC module via pip
 * @returns {Promise<void>}
 */
async function installSpotiFLAC() {
    const python = await findPython();
    return new Promise((resolve, reject) => {
        execFile(python, ['-m', 'pip', 'install', '--user', 'SpotiFLAC'], {
            timeout: 120000
        }, (err, stdout, stderr) => {
            if (err) {
                console.error('[PythonBridge] pip install failed:', stderr || err.message);
                reject(new Error('Failed to install SpotiFLAC: ' + (stderr || err.message)));
            } else {
                console.log('[PythonBridge] SpotiFLAC installed:', stdout.trim());
                resolve();
            }
        });
    });
}

/**
 * Ensure SpotiFLAC is ready to use
 * @returns {Promise<void>}
 */
async function ensureSpotiFLAC() {
    const installed = await isSpotiFLACInstalled();
    if (!installed) {
        console.log('[PythonBridge] SpotiFLAC not found, installing...');
        await installSpotiFLAC();
        const ok = await isSpotiFLACInstalled();
        if (!ok) throw new Error('SpotiFLAC installation failed');
    }
}

/**
 * Get all audio files in a directory with their stats
 */
function getAudioFiles(dir) {
    try {
        if (!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let files = [];
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && /\.(flac|mp3|m4a|wav|ogg)$/i.test(entry.name)) {
                const stat = fs.statSync(fullPath);
                files.push({ name: entry.name, path: fullPath, size: stat.size, mtime: stat.mtimeMs });
            } else if (entry.isDirectory()) {
                // SpotiFLAC may create subdirectories for albums/playlists
                files = files.concat(getAudioFiles(fullPath));
            }
        }
        return files;
    } catch (e) {
        return [];
    }
}

/**
 * Download a single track using the SpotiFLAC Python module.
 * Runs SpotiFLAC as a subprocess and streams progress.
 *
 * @param {object} options
 * @param {string} options.spotifyUrl - Spotify URL (track/album/playlist)
 * @param {string} options.outputDir - Output directory
 * @param {string[]} options.services - Service priority list e.g. ['tidal', 'qobuz']
 * @param {string} options.filenameFormat - Filename template
 * @param {function} onProgress - Progress callback({ phase, percent, message })
 * @returns {Promise<{success: boolean, path: string}>}
 */
async function downloadWithSpotiFLAC(options, onProgress) {
    const python = await findPython();
    await ensureSpotiFLAC();

    const {
        spotifyUrl,
        outputDir,
        services = ['tidal', 'qobuz', 'amazon', 'deezer', 'spoti', 'youtube'],
        filenameFormat = '{title} - {artist}'
    } = options;

    if (!spotifyUrl) throw new Error('Spotify URL is required');
    if (!outputDir) throw new Error('Output directory is required');

    // Ensure output dir exists (SpotiFLAC requires it)
    fs.mkdirSync(outputDir, { recursive: true });

    // Snapshot existing files BEFORE download so we can detect new ones
    const filesBefore = new Set(getAudioFiles(outputDir).map(f => f.path));

    // Build Python script — write to temp file to avoid shell escaping issues
    const servicesStr = services.map(s => `"${s}"`).join(', ');
    
    const scriptContent = `
import sys, os, json, glob

# Ensure UTF-8 output stream encoding
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Patch print to forward as JSON to stdout for Node.js parsing
_original_print = print
def _json_print(*args, **kwargs):
    msg = " ".join(str(a) for a in args)
    try:
        sys.stdout.write(json.dumps({"type": "log", "message": msg}, ensure_ascii=False) + "\\n")
        sys.stdout.flush()
    except Exception:
        pass

import builtins
builtins.print = _json_print

output_dir = ${JSON.stringify(outputDir).replace(/\\/g, '/')}
url = ${JSON.stringify(spotifyUrl)}
services = [${servicesStr}]
filename_format = ${JSON.stringify(filenameFormat)}

# Collect audio files before download
def get_audio_files(d):
    exts = ('.flac', '.mp3', '.m4a', '.wav', '.ogg')
    result = []
    for root, dirs, files in os.walk(d):
        for f in files:
            if f.lower().endswith(exts):
                result.append(os.path.join(root, f))
    return set(result)

files_before = get_audio_files(output_dir)

try:
    from SpotiFLAC import SpotiFLAC
    sys.stdout.write(json.dumps({"type": "status", "phase": "starting"}) + "\\n")
    sys.stdout.flush()

    SpotiFLAC(
        url=url,
        output_dir=output_dir,
        services=services,
        filename_format=filename_format
    )

    # Check what new files appeared
    files_after = get_audio_files(output_dir)
    new_files = files_after - files_before

    if new_files:
        # Sort by modification time, newest first
        new_files_sorted = sorted(new_files, key=lambda f: os.path.getmtime(f), reverse=True)
        sys.stdout.write(json.dumps({
            "type": "result",
            "success": True,
            "files": list(new_files_sorted),
            "count": len(new_files_sorted)
        }) + "\\n")
        sys.stdout.flush()
    else:
        sys.stdout.write(json.dumps({
            "type": "result",
            "success": False,
            "error": "No audio files were downloaded. All services may have failed."
        }) + "\\n")
        sys.stdout.flush()
        sys.exit(1)

except Exception as e:
    import traceback
    sys.stdout.write(json.dumps({"type": "error", "message": str(e), "traceback": traceback.format_exc()}) + "\\n")
    sys.stdout.flush()
    sys.exit(1)
`;

    // Write script to a temp file in OS temp directory to avoid polluting user folders
    const scriptPath = path.join(os.tmpdir(), `spotiflac_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.py`);
    fs.writeFileSync(scriptPath, scriptContent, 'utf-8');

    return new Promise((resolve, reject) => {
        const child = spawn(python, ['-u', scriptPath], {
            cwd: outputDir,
            env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
            timeout: 600000 // 10 minutes max
        });

        let lastError = null;
        let downloadResult = null;
        let allServicesFailed = false;
        let buffer = '';

        child.stdout.on('data', (data) => {
            buffer += data.toString('utf-8');
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'log') {
                        const text = msg.message || '';

                        // Track download progress phases
                        if (text.includes('Starting download:')) {
                            if (onProgress) onProgress({ phase: 'downloading', percent: 10, message: text });
                        } else if (text.includes('Successfully downloaded')) {
                            if (onProgress) onProgress({ phase: 'finalizing', percent: 90, message: text });
                        } else if (text.includes('Trying service:')) {
                            const svc = text.replace('Trying service:', '').trim();
                            if (onProgress) onProgress({ phase: 'trying', percent: 30, message: `Trying ${svc}...` });
                        } else if (text.includes('Failed all services')) {
                            allServicesFailed = true;
                            lastError = 'All download services failed for this track';
                            if (onProgress) onProgress({ phase: 'error', percent: 0, message: 'All services failed' });
                        } else if (text.includes('[X]') && text.includes('failed:')) {
                            const svc = text.match(/\[X\]\s*(\w+)\s*failed/)?.[1] || 'service';
                            if (onProgress) onProgress({ phase: 'retrying', percent: 40, message: `${svc} failed, trying next...` });
                        } else if (text.includes('File already exists')) {
                            if (onProgress) onProgress({ phase: 'complete', percent: 100, message: 'File already exists' });
                        } else if (text.includes('Fetching metadata')) {
                            if (onProgress) onProgress({ phase: 'metadata', percent: 5, message: 'Fetching track metadata...' });
                        } else if (text.includes('Metadata fetched')) {
                            if (onProgress) onProgress({ phase: 'metadata', percent: 8, message: 'Metadata ready' });
                        }

                        console.log(`[SpotiFLAC] ${text}`);
                    } else if (msg.type === 'result') {
                        downloadResult = msg;
                    } else if (msg.type === 'status') {
                        if (msg.phase === 'starting') {
                            if (onProgress) onProgress({ phase: 'starting', percent: 5 });
                        }
                    } else if (msg.type === 'error') {
                        lastError = msg.message;
                        console.error(`[SpotiFLAC] Error: ${msg.message}`);
                    }
                } catch (e) {
                    // Not JSON, just log as plain text
                    const plainLine = line.trim();
                    if (plainLine) console.log(`[SpotiFLAC] ${plainLine}`);
                }
            }
        });

        child.stderr.on('data', (data) => {
            const text = data.toString('utf-8').trim();
            if (text) {
                console.error(`[SpotiFLAC stderr] ${text}`);
                // Don't overwrite meaningful errors with stderr noise
                if (!lastError || text.includes('Error') || text.includes('Exception')) {
                    lastError = text;
                }
            }
        });

        child.on('close', (code) => {
            // Clean up temp script
            try { fs.unlinkSync(scriptPath); } catch (e) { }

            // Check the result from the Python script
            if (downloadResult && downloadResult.success && downloadResult.files && downloadResult.files.length > 0) {
                if (onProgress) onProgress({ phase: 'complete', percent: 100 });
                resolve({
                    success: true,
                    path: downloadResult.files[0],
                    files: downloadResult.files,
                    filesCount: downloadResult.count
                });
                return;
            }

            // If Python reported failure or all services failed
            if (downloadResult && !downloadResult.success) {
                reject(new Error(downloadResult.error || 'Download failed'));
                return;
            }

            // Fallback: check for new files manually
            const filesAfter = getAudioFiles(outputDir);
            const newFiles = filesAfter.filter(f => !filesBefore.has(f.path));

            if (newFiles.length > 0) {
                newFiles.sort((a, b) => b.mtime - a.mtime);
                if (onProgress) onProgress({ phase: 'complete', percent: 100 });
                resolve({
                    success: true,
                    path: newFiles[0].path,
                    filesCount: newFiles.length
                });
            } else if (allServicesFailed) {
                reject(new Error('All download services failed. The track may not be available through any source.'));
            } else if (code !== 0) {
                reject(new Error(lastError || `SpotiFLAC exited with code ${code}`));
            } else {
                // Process exited 0 but no files — this is the silent failure case
                reject(new Error(lastError || 'Download completed but no audio file was produced. All services may have failed.'));
            }
        });

        child.on('error', (err) => {
            try { fs.unlinkSync(scriptPath); } catch (e) { }
            reject(new Error('Failed to start SpotiFLAC: ' + err.message));
        });
    });
}

module.exports = {
    findPython,
    isSpotiFLACInstalled,
    installSpotiFLAC,
    ensureSpotiFLAC,
    downloadWithSpotiFLAC
};
