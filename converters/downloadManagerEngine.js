const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { EventEmitter } = require('events');

const DEFAULT_USER_AGENT = 'UniversalFileConverter-DownloadManager/1.0';
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 8;

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function sanitizeFileName(input) {
    const raw = String(input || '').trim();
    if (!raw) return 'download.bin';

    let sanitized = raw
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/\.+$/, '')
        .trim();

    if (!sanitized) sanitized = 'download.bin';
    if (sanitized.length > 180) {
        const ext = path.extname(sanitized);
        const base = sanitized.slice(0, Math.max(1, 180 - ext.length));
        sanitized = `${base}${ext}`;
    }
    return sanitized;
}

function parseContentDispositionFilename(headerValue) {
    const raw = String(headerValue || '').trim();
    if (!raw) return null;

    const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match && utf8Match[1]) {
        try {
            return sanitizeFileName(decodeURIComponent(utf8Match[1]));
        } catch (_) {
            return sanitizeFileName(utf8Match[1]);
        }
    }

    const quotedMatch = raw.match(/filename="([^"]+)"/i);
    if (quotedMatch && quotedMatch[1]) return sanitizeFileName(quotedMatch[1]);

    const simpleMatch = raw.match(/filename=([^;]+)/i);
    if (simpleMatch && simpleMatch[1]) return sanitizeFileName(simpleMatch[1].trim());

    return null;
}

function inferFileNameFromUrl(urlText) {
    try {
        const parsed = new URL(String(urlText || '').trim());
        const baseName = path.basename(parsed.pathname || '').trim();
        if (baseName && baseName !== '/' && baseName !== '.') {
            return sanitizeFileName(decodeURIComponent(baseName));
        }
    } catch (_) {
        // ignore parse errors
    }
    return 'download.bin';
}

function ensureUniquePath(targetPath) {
    if (!fs.existsSync(targetPath)) return targetPath;

    const directory = path.dirname(targetPath);
    const extension = path.extname(targetPath);
    const baseName = path.basename(targetPath, extension);

    for (let i = 1; i <= 10000; i += 1) {
        const candidate = path.join(directory, `${baseName} (${i})${extension}`);
        if (!fs.existsSync(candidate)) return candidate;
    }

    return path.join(directory, `${baseName}-${Date.now()}${extension}`);
}

function getProtocolForUrl(urlText) {
    const parsed = new URL(urlText);
    if (parsed.protocol === 'https:') return https;
    if (parsed.protocol === 'http:') return http;
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
}

function createTaskPublicView(task, queuePosition = null) {
    return {
        id: task.id,
        url: task.url,
        source: task.source,
        thumbnail: task.thumbnail,
        fileName: task.fileName,
        outputDir: task.outputDir,
        outputPath: task.outputPath,
        status: task.status,
        progress: task.progress,
        downloadedBytes: task.downloadedBytes,
        totalBytes: task.totalBytes,
        speedBytesPerSec: task.speedBytesPerSec,
        etaSeconds: task.etaSeconds,
        error: task.error,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        supportsRange: task.supportsRange,
        queuePosition: Number.isInteger(queuePosition) ? queuePosition : null
    };
}

class DownloadManagerEngine extends EventEmitter {
    constructor(options = {}) {
        super();
        this.tasks = new Map();
        this.queue = [];
        this.activeIds = new Set();
        this.shuttingDown = false;
        this.defaultOutputDir = String(options.defaultOutputDir || process.cwd());
        this.maxConcurrent = clampNumber(options.maxConcurrent, 1, 8, 2);
    }

    setDefaultOutputDir(outputDir) {
        const normalized = String(outputDir || '').trim();
        if (!normalized) return this.defaultOutputDir;
        this.defaultOutputDir = normalized;
        this.emitState();
        return this.defaultOutputDir;
    }

    updateTaskPath(taskId, newOutputPath, newOutputDir) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        if (newOutputPath) task.outputPath = newOutputPath;
        if (newOutputDir) task.outputDir = newOutputDir;
        return true;
    }

    setMaxConcurrent(value) {
        this.maxConcurrent = clampNumber(value, 1, 8, 2);
        this.emitState();
        this.drainQueue();
        return this.maxConcurrent;
    }

    getState() {
        const queuePositionById = new Map();
        this.queue.forEach((taskId, index) => {
            queuePositionById.set(taskId, index);
        });

        const tasks = Array.from(this.tasks.values())
            .map((task) => createTaskPublicView(task, queuePositionById.get(task.id)))
            .sort((left, right) => {
                const leftQueued = left.status === 'queued' && Number.isInteger(left.queuePosition);
                const rightQueued = right.status === 'queued' && Number.isInteger(right.queuePosition);
                if (leftQueued && rightQueued) return left.queuePosition - right.queuePosition;
                if (leftQueued) return -1;
                if (rightQueued) return 1;
                return (right.createdAt || 0) - (left.createdAt || 0);
            });

        return {
            defaultOutputDir: this.defaultOutputDir,
            maxConcurrent: this.maxConcurrent,
            queueCount: this.queue.length,
            activeCount: this.activeIds.size,
            tasks
        };
    }

    emitState() {
        this.emit('state', this.getState());
    }

    addTask(options = {}) {
        const urlText = String(options.url || '').trim();
        if (!urlText) throw new Error('Download URL is required');

        const parsed = new URL(urlText);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Only HTTP/HTTPS downloads are supported');
        }

        const outputDir = String(options.outputDir || this.defaultOutputDir || '').trim();
        if (!outputDir) throw new Error('Output directory is required');

        const requestedName = String(options.fileName || '').trim();
        const resolvedName = sanitizeFileName(requestedName || inferFileNameFromUrl(urlText));

        const id = (crypto.randomUUID && crypto.randomUUID()) || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const now = Date.now();

        const task = {
            id,
            url: urlText,
            source: String(options.source || 'manual'),
            thumbnail: String(options.thumbnail || '').trim(),
            headers: typeof options.headers === 'object' && options.headers ? { ...options.headers } : {},
            outputDir,
            fileName: resolvedName,
            hasCustomName: !!requestedName,
            outputPath: '',
            status: 'queued',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speedBytesPerSec: 0,
            etaSeconds: null,
            error: '',
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null,
            supportsRange: true,
            _request: null,
            _stream: null,
            _speedTimer: null,
            _abortReason: '',
            _lastEmitAt: 0,
            _lastSpeedBytes: 0
        };

        this.tasks.set(task.id, task);
        this.queue.push(task.id);
        this.emitState();
        this.drainQueue();
        return createTaskPublicView(task);
    }

    pauseTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        if (task.status === 'queued') {
            this.queue = this.queue.filter((id) => id !== taskId);
            task.status = 'paused';
            task.updatedAt = Date.now();
            this.emitState();
            return true;
        }

        if (task.status === 'downloading') {
            task._abortReason = 'paused';
            if (task._request) task._request.destroy(new Error('paused by user'));
            return true;
        }

        return false;
    }

    pauseAll() {
        let changed = 0;
        Array.from(this.tasks.keys()).forEach((taskId) => {
            if (this.pauseTask(taskId)) changed += 1;
        });
        return changed;
    }

    resumeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        if (!['paused', 'failed', 'cancelled'].includes(task.status)) return false;

        task.status = 'queued';
        task.error = '';
        task.speedBytesPerSec = 0;
        task.etaSeconds = null;
        task.updatedAt = Date.now();

        if (!this.queue.includes(taskId)) this.queue.push(taskId);
        this.emitState();
        this.drainQueue();
        return true;
    }

    resumeAll() {
        let changed = 0;
        Array.from(this.tasks.keys()).forEach((taskId) => {
            if (this.resumeTask(taskId)) changed += 1;
        });
        return changed;
    }

    cancelTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        if (task.status === 'queued') {
            this.queue = this.queue.filter((id) => id !== taskId);
            task.status = 'cancelled';
            task.error = '';
            task.speedBytesPerSec = 0;
            task.etaSeconds = null;
            task.updatedAt = Date.now();
            this.emitState();
            return true;
        }

        if (task.status === 'downloading') {
            task._abortReason = 'cancelled';
            if (task._request) task._request.destroy(new Error('cancelled by user'));
            return true;
        }

        if (task.status === 'paused' || task.status === 'failed') {
            task.status = 'cancelled';
            task.error = '';
            task.speedBytesPerSec = 0;
            task.etaSeconds = null;
            task.updatedAt = Date.now();
            this.emitState();
            return true;
        }

        return false;
    }

    retryTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) return false;
        if (!['failed', 'cancelled'].includes(task.status)) return false;

        task.status = 'queued';
        task.error = '';
        task.speedBytesPerSec = 0;
        task.etaSeconds = null;
        task.updatedAt = Date.now();
        if (!this.queue.includes(taskId)) this.queue.push(taskId);
        this.emitState();
        this.drainQueue();
        return true;
    }

    deleteTask(taskId, options = {}) {
        const task = this.tasks.get(taskId);
        if (!task) return false;

        this.queue = this.queue.filter((id) => id !== taskId);

        if (task.status === 'downloading') {
            task._abortReason = 'cancelled';
            if (task._request) task._request.destroy(new Error('deleted by user'));
        }

        this.cleanupTaskIO(task);

        const shouldDeleteFile = !!options.deleteFile;
        if (shouldDeleteFile && task.outputPath && fs.existsSync(task.outputPath)) {
            try {
                fs.unlinkSync(task.outputPath);
            } catch (_) {
                // ignore file cleanup errors
            }
        }

        this.activeIds.delete(taskId);
        this.tasks.delete(taskId);
        this.emitState();
        this.drainQueue();
        return true;
    }

    clearFinished(options = {}) {
        const deleteFile = !!options.deleteFile;
        const removable = Array.from(this.tasks.values()).filter((task) =>
            ['completed', 'failed', 'cancelled'].includes(task.status)
        );
        removable.forEach((task) => {
            this.deleteTask(task.id, { deleteFile });
        });
        return removable.length;
    }

    reorderQueuedTask(taskId, direction) {
        const index = this.queue.indexOf(taskId);
        if (index < 0) return false;
        if (direction === 'up' && index > 0) {
            [this.queue[index - 1], this.queue[index]] = [this.queue[index], this.queue[index - 1]];
            this.emitState();
            return true;
        }
        if (direction === 'down' && index < this.queue.length - 1) {
            [this.queue[index + 1], this.queue[index]] = [this.queue[index], this.queue[index + 1]];
            this.emitState();
            return true;
        }
        return false;
    }

    cleanupTaskIO(task) {
        if (!task) return;
        if (task._speedTimer) {
            clearInterval(task._speedTimer);
            task._speedTimer = null;
        }
        if (task._stream) {
            try { task._stream.destroy(); } catch (_) { }
            task._stream = null;
        }
        task._request = null;
        task._abortReason = '';
    }

    shutdown() {
        if (this.shuttingDown) return;
        this.shuttingDown = true;
        this.queue = [];

        for (const task of this.tasks.values()) {
            if (task.status === 'queued') {
                task.status = 'paused';
            } else if (task.status === 'downloading') {
                task._abortReason = task._abortReason || 'paused';

                if (task._speedTimer) {
                    clearInterval(task._speedTimer);
                    task._speedTimer = null;
                }

                if (task._stream) {
                    try { task._stream.destroy(); } catch (_) { }
                }

                if (task._request) {
                    try { task._request.destroy(new Error('shutdown')); } catch (_) { }
                }
            }

            task.speedBytesPerSec = 0;
            task.etaSeconds = null;
            task.updatedAt = Date.now();
        }

        this.emitState();
    }

    drainQueue() {
        if (this.shuttingDown) {
            this.emitState();
            return;
        }
        while (this.activeIds.size < this.maxConcurrent && this.queue.length > 0) {
            const nextTaskId = this.queue.shift();
            const nextTask = this.tasks.get(nextTaskId);
            if (!nextTask || nextTask.status !== 'queued') continue;
            this.startTask(nextTask).catch(() => {
                // errors are already handled in startTask
            });
        }
        this.emitState();
    }

    async startTask(task) {
        this.activeIds.add(task.id);
        task.status = 'downloading';
        task.startedAt = task.startedAt || Date.now();
        task.updatedAt = Date.now();
        task.error = '';
        task.speedBytesPerSec = 0;
        task.etaSeconds = null;
        this.emitState();

        try {
            await this.downloadTaskWithRedirects(task);
        } catch (err) {
            if (!['paused', 'cancelled'].includes(task.status)) {
                task.status = 'failed';
                task.error = String(err?.message || err || 'Download failed');
                task.speedBytesPerSec = 0;
                task.etaSeconds = null;
                task.updatedAt = Date.now();
            }
        } finally {
            this.cleanupTaskIO(task);
            this.activeIds.delete(task.id);
            task.updatedAt = Date.now();
            this.emitState();
            this.drainQueue();
        }
    }

    async downloadTaskWithRedirects(task) {
        let currentUrl = task.url;
        for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
            const result = await this.downloadSingleRequest(task, currentUrl);
            if (!result || !result.redirectUrl) return;
            currentUrl = result.redirectUrl;
        }
        throw new Error('Too many redirects');
    }

    async downloadSingleRequest(task, requestUrl) {
        const protocol = getProtocolForUrl(requestUrl);
        return new Promise((resolve, reject) => {
            let settled = false;
            let outputStream = null;

            const safeSettle = (callback) => {
                if (settled) return;
                settled = true;
                callback();
            };

            const finalizeAbortState = () => {
                const reason = task._abortReason;
                task._abortReason = '';
                task.speedBytesPerSec = 0;
                task.etaSeconds = null;
                task.updatedAt = Date.now();

                if (reason === 'paused') {
                    task.status = 'paused';
                    return true;
                }
                if (reason === 'cancelled') {
                    task.status = 'cancelled';
                    return true;
                }
                return false;
            };

            const handleFailure = (error) => {
                if (finalizeAbortState()) {
                    safeSettle(() => resolve({ aborted: true }));
                    return;
                }
                safeSettle(() => reject(error));
            };

            const headers = { ...(task.headers || {}) };
            if (!headers['User-Agent'] && !headers['user-agent']) {
                headers['User-Agent'] = DEFAULT_USER_AGENT;
            }
            if (task.downloadedBytes > 0) {
                let validExistingFile = false;
                if (task.outputPath && fs.existsSync(task.outputPath)) {
                    try {
                        const stat = fs.statSync(task.outputPath);
                        if (stat.size === task.downloadedBytes) {
                            validExistingFile = true;
                        }
                    } catch (_) {}
                }
                if (!validExistingFile) {
                    task.downloadedBytes = 0;
                }
            }
            if (task.downloadedBytes > 0) {
                headers.Range = `bytes=${task.downloadedBytes}-`;
            }

            let request;
            try {
                request = protocol.get(requestUrl, { headers }, (response) => {
                    const statusCode = Number(response.statusCode || 0);

                    if (REDIRECT_STATUS_CODES.has(statusCode)) {
                        const location = response.headers.location;
                        response.resume();
                        if (!location) {
                            safeSettle(() => reject(new Error('Redirect response missing location header')));
                            return;
                        }
                        const redirectUrl = new URL(location, requestUrl).toString();
                        safeSettle(() => resolve({ redirectUrl }));
                        return;
                    }

                    if (statusCode >= 400) {
                        const statusMessage = response.statusMessage || 'HTTP error';
                        response.resume();
                        safeSettle(() => reject(new Error(`HTTP ${statusCode}: ${statusMessage}`)));
                        return;
                    }

                    // If range resume was requested but server sent full body, restart from byte 0.
                    if (task.downloadedBytes > 0 && statusCode !== 206) {
                        task.downloadedBytes = 0;
                    }

                    const contentRange = String(response.headers['content-range'] || '');
                    const contentLength = Number(response.headers['content-length'] || 0);
                    const acceptRanges = String(response.headers['accept-ranges'] || '').toLowerCase();

                    task.supportsRange = acceptRanges.includes('bytes') || statusCode === 206;

                    if (statusCode === 206 && contentRange) {
                        const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
                        if (match && match[3] !== '*') {
                            const total = Number(match[3]);
                            if (Number.isFinite(total) && total >= 0) task.totalBytes = total;
                        } else if (Number.isFinite(contentLength) && contentLength > 0) {
                            task.totalBytes = task.downloadedBytes + contentLength;
                        }
                    } else if (Number.isFinite(contentLength) && contentLength > 0) {
                        task.totalBytes = task.downloadedBytes + contentLength;
                    } else if (task.totalBytes < task.downloadedBytes) {
                        task.totalBytes = task.downloadedBytes;
                    }

                    const contentDisposition = response.headers['content-disposition'];
                    if (!task.hasCustomName && task.downloadedBytes === 0 && contentDisposition) {
                        const headerName = parseContentDispositionFilename(contentDisposition);
                        if (headerName) {
                            task.fileName = headerName;
                            task.outputPath = '';
                        }
                    }

                    if (!task.outputPath) {
                        if (!fs.existsSync(task.outputDir)) {
                            fs.mkdirSync(task.outputDir, { recursive: true });
                        }
                        const candidate = path.join(task.outputDir, task.fileName || inferFileNameFromUrl(task.url));
                        task.outputPath = ensureUniquePath(candidate);
                    }

                    const writeFlags = task.downloadedBytes > 0 ? 'a' : 'w';
                    outputStream = fs.createWriteStream(task.outputPath, { flags: writeFlags });
                    task._stream = outputStream;

                    const refreshSpeed = () => {
                        const deltaBytes = task.downloadedBytes - task._lastSpeedBytes;
                        task._lastSpeedBytes = task.downloadedBytes;
                        task.speedBytesPerSec = Math.max(0, deltaBytes);
                        if (task.totalBytes > 0 && task.speedBytesPerSec > 0) {
                            const remaining = Math.max(0, task.totalBytes - task.downloadedBytes);
                            task.etaSeconds = Math.ceil(remaining / task.speedBytesPerSec);
                        } else {
                            task.etaSeconds = null;
                        }
                        task.updatedAt = Date.now();
                        this.emitState();
                    };

                    task._lastSpeedBytes = task.downloadedBytes;
                    if (task._speedTimer) clearInterval(task._speedTimer);
                    task._speedTimer = setInterval(refreshSpeed, 1000);

                    response.on('data', (chunk) => {
                        task.downloadedBytes += chunk.length;
                        if (task.totalBytes > 0) {
                            task.progress = Math.min(100, (task.downloadedBytes / task.totalBytes) * 100);
                        }
                        const now = Date.now();
                        if (now - task._lastEmitAt > 300) {
                            task._lastEmitAt = now;
                            task.updatedAt = now;
                            this.emitState();
                        }
                    });

                    response.on('error', (err) => {
                        if (outputStream) outputStream.destroy(err);
                        handleFailure(err);
                    });

                    outputStream.on('error', (err) => {
                        handleFailure(err);
                    });

                    outputStream.on('finish', () => {
                        if (task._speedTimer) {
                            clearInterval(task._speedTimer);
                            task._speedTimer = null;
                        }
                        task.progress = 100;
                        task.speedBytesPerSec = 0;
                        task.etaSeconds = 0;
                        task.status = 'completed';
                        task.completedAt = Date.now();
                        task.updatedAt = Date.now();
                        safeSettle(() => resolve({ completed: true }));
                    });

                    response.pipe(outputStream);
                });
            } catch (err) {
                safeSettle(() => reject(err));
                return;
            }

            task._request = request;
            request.setTimeout(45000, () => {
                request.destroy(new Error('Request timeout'));
            });

            request.on('error', (err) => {
                handleFailure(err);
            });
        });
    }
}

module.exports = {
    DownloadManagerEngine
};
