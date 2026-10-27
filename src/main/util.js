'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Write a file so a crash or force-kill can never leave it half-written:
 * write to a sibling temp file, then rename over the target.
 * Retries briefly because antivirus scanners on Windows can hold the target open.
 */
function writeFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);

    let lastErr;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            fs.renameSync(tmp, filePath);
            return;
        } catch (err) {
            lastErr = err;
            if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') break;
            const until = Date.now() + 25 * (attempt + 1);
            while (Date.now() < until) { /* short spin: only reached on contention */ }
        }
    }
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw lastErr;
}

/** Read and parse JSON, returning `fallback` for a missing or corrupt file. */
function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
        return fallback;
    }
}

/**
 * Return a path that does not exist yet. Existing files are never overwritten:
 * "song.mp3" becomes "song (1).mp3", "song (2).mp3" ...
 * `reserved` lets callers also avoid specific paths (for example the input file).
 */
function uniquePath(targetPath, reserved = []) {
    const taken = new Set(reserved.map((p) => path.resolve(p).toLowerCase()));
    const isTaken = (p) => taken.has(path.resolve(p).toLowerCase()) || fs.existsSync(p);
    if (!isTaken(targetPath)) return targetPath;

    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);
    for (let i = 1; i < 10000; i += 1) {
        const candidate = path.join(dir, `${base} (${i})${ext}`);
        if (!isTaken(candidate)) return candidate;
    }
    return path.join(dir, `${base}-${Date.now()}${ext}`);
}

/** Make a string safe to use as a single path segment on every platform. */
function sanitizeFileName(name, fallback = 'file') {
    const cleaned = String(name || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^\.+/, '')
        .replace(/[. ]+$/, '')
        .trim();
    if (!cleaned) return fallback;
    return cleaned.length > 180 ? cleaned.slice(0, 180) : cleaned;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** Run `fn` at most once per `ms`, always delivering the latest call's arguments. */
function throttle(fn, ms) {
    let last = 0;
    let timer = null;
    let pendingArgs = null;
    return (...args) => {
        const now = Date.now();
        const remaining = ms - (now - last);
        if (remaining <= 0) {
            last = now;
            fn(...args);
        } else {
            pendingArgs = args;
            if (!timer) {
                timer = setTimeout(() => {
                    timer = null;
                    last = Date.now();
                    const a = pendingArgs;
                    pendingArgs = null;
                    if (a) fn(...a);
                }, remaining);
            }
        }
    };
}

function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

module.exports = {
    writeFileAtomic,
    readJson,
    uniquePath,
    sanitizeFileName,
    ensureDir,
    clampNumber,
    throttle,
    formatBytes
};
