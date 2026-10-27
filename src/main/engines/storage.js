'use strict';

/** Disk usage analysis that works on Windows, macOS and Linux. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { shell } = require('electron');
const { throttle } = require('../util');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const CATEGORIES = {
    documents: ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.rtf', '.csv', '.epub', '.md'],
    images: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff', '.psd', '.heic', '.avif', '.raw'],
    videos: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts'],
    audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus'],
    archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.dmg'],
    programs: ['.exe', '.msi', '.dll', '.app', '.deb', '.rpm', '.appimage', '.apk', '.pkg']
};
const CAT_BY_EXT = new Map(Object.entries(CATEGORIES).flatMap(([cat, list]) => list.map((e) => [e, cat])));

const SKIP_DIRS = new Set(isWin
    ? ['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws', 'config.msi']
    : ['proc', 'sys', 'dev', 'run', '.trash', 'lost+found', 'snap']);

let scanToken = 0;

function run(file, args, timeout = 30000) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    });
}

function statfs(root) {
    try {
        const s = fs.statfsSync(root);
        const total = Number(s.blocks) * Number(s.bsize);
        const free = Number(s.bavail) * Number(s.bsize);
        return total > 0 ? { total, free } : null;
    } catch (_) { return null; }
}

async function getAvailableDrives() {
    const roots = [];
    if (isWin) {
        for (let c = 65; c <= 90; c += 1) {
            const root = `${String.fromCharCode(c)}:\\`;
            try { if (fs.existsSync(root)) roots.push({ root, name: `${String.fromCharCode(c)}:` }); } catch (_) { /* unreadable drive */ }
        }
    } else if (isMac) {
        roots.push({ root: '/', name: 'Macintosh HD' });
        try { for (const v of fs.readdirSync('/Volumes')) if (v !== 'Macintosh HD') roots.push({ root: path.join('/Volumes', v), name: v }); } catch (_) { /* none */ }
    } else {
        roots.push({ root: '/', name: 'Root' });
        try {
            const mounts = fs.readFileSync('/proc/mounts', 'utf8').split('\n');
            for (const line of mounts) {
                const mp = (line.split(' ')[1] || '').replace(/\\040/g, ' ');
                if (/^\/(mnt|media|run\/media)\//.test(mp)) roots.push({ root: mp, name: path.basename(mp) });
            }
        } catch (_) { /* not Linux procfs */ }
        if (os.homedir() && !roots.find((r) => r.root === os.homedir())) roots.push({ root: os.homedir(), name: 'Home' });
    }
    const drives = [];
    for (const r of roots) {
        const s = statfs(r.root);
        if (!s) continue;
        const used = s.total - s.free;
        drives.push({
            letter: r.name, name: r.name, root: r.root, path: r.root,
            totalSize: s.total, freeSpace: s.free, usedSpace: used,
            usedPercent: Math.round((used / s.total) * 100)
        });
    }
    return drives;
}

/** Depth-first async walk. `visit(path, stat, isDir)` returns false to stop descending. */
async function walk(root, visit, token) {
    const stack = [root];
    while (stack.length) {
        if (token !== undefined && token !== scanToken) return false;
        const dir = stack.pop();
        let handle;
        try { handle = await fs.promises.opendir(dir); } catch (_) { continue; }
        const batch = [];
        try {
            for await (const entry of handle) {
                if (entry.isSymbolicLink()) continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (SKIP_DIRS.has(entry.name.toLowerCase()) && dir === root) continue;
                    if (visit(full, null, true) !== false) stack.push(full);
                } else if (entry.isFile()) {
                    batch.push(full);
                    if (batch.length >= 64) await flush(batch, visit);
                }
            }
        } catch (_) { /* directory vanished or is protected */ }
        await flush(batch, visit);
    }
    return true;
}

async function flush(batch, visit) {
    if (!batch.length) return;
    const items = batch.splice(0, batch.length);
    const stats = await Promise.all(items.map((p) => fs.promises.lstat(p).then((s) => [p, s]).catch(() => null)));
    for (const r of stats) if (r) visit(r[0], r[1], false);
}

async function analyzeDrive(drivePath, onProgress) {
    const token = ++scanToken;
    const started = Date.now();
    const drive = statfs(drivePath) || { total: 0, free: 0 };
    const categories = Object.fromEntries([...Object.keys(CATEGORIES), 'other'].map((c) => [c, { size: 0, count: 0 }]));
    const top = new Map(); // top-level child folder -> bytes
    const largest = [];
    let scanned = 0;
    let bytes = 0;
    const emit = throttle((p) => onProgress && onProgress(p), 200);

    const keepLargest = (file, size) => {
        if (largest.length >= 50 && size <= largest[largest.length - 1].size) return;
        largest.push({ path: file, name: path.basename(file), size });
        largest.sort((a, b) => b.size - a.size);
        if (largest.length > 50) largest.length = 50;
    };

    const completed = await walk(drivePath, (p, st, isDir) => {
        if (isDir) {
            emit({ scanned, bytes, current: p });
            return true;
        }
        scanned += 1;
        bytes += st.size;
        const cat = categories[CAT_BY_EXT.get(path.extname(p).toLowerCase()) || 'other'];
        cat.size += st.size;
        cat.count += 1;
        const rel = path.relative(drivePath, p).split(path.sep)[0];
        top.set(rel, (top.get(rel) || 0) + st.size);
        keepLargest(p, st.size);
        return true;
    }, token);

    if (!completed) { const e = new Error('Scan cancelled'); e.cancelled = true; throw e; }
    const folders = [...top.entries()]
        .map(([name, size]) => ({ name, path: path.join(drivePath, name), size }))
        .filter((f) => { try { return fs.statSync(f.path).isDirectory(); } catch (_) { return false; } })
        .sort((a, b) => b.size - a.size)
        .slice(0, 30);

    return {
        drivePath,
        scanTime: new Date().toISOString(),
        durationMs: Date.now() - started,
        totalSize: drive.total,
        freeSpace: drive.free,
        usedSize: drive.total - drive.free,
        scannedBytes: bytes,
        scannedFiles: scanned,
        categories,
        largestFiles: largest,
        largestFolders: folders
    };
}

function cancelScan() { scanToken += 1; return true; }

async function browseFolder(folderPath) {
    try {
        const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
        const items = await Promise.all(entries.map(async (e) => {
            const p = path.join(folderPath, e.name);
            const isDirectory = e.isDirectory();
            let size = null; let modified = null; let itemCount = null;
            try {
                const st = await fs.promises.lstat(p);
                modified = st.mtime;
                if (!isDirectory) size = st.size;
            } catch (_) { /* unreadable */ }
            if (isDirectory) { try { itemCount = (await fs.promises.readdir(p)).length; } catch (_) { itemCount = null; } }
            return { name: e.name, path: p, isDirectory, size, modified, itemCount, extension: isDirectory ? null : path.extname(e.name).toLowerCase() };
        }));
        items.sort((a, b) => (a.isDirectory !== b.isDirectory ? (b.isDirectory ? 1 : -1) : a.name.localeCompare(b.name)));
        return { items, error: null };
    } catch (err) {
        return { items: [], error: err.message };
    }
}

async function getFolderSize(folderPath) {
    let total = 0;
    const token = ++scanToken;
    await walk(folderPath, (p, st, isDir) => { if (!isDir) total += st.size; return true; }, token);
    return total;
}

async function searchFiles(root, query, max = 60) {
    const q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    const results = [];
    const token = ++scanToken;
    const deadline = Date.now() + 15000;
    await walk(root, (p, st, isDir) => {
        if (Date.now() > deadline || results.length >= max) return false;
        if (path.basename(p).toLowerCase().includes(q)) results.push({ name: path.basename(p), path: p, isDirectory: isDir, size: st ? st.size : 0 });
        return true;
    }, token);
    return results;
}

// ---------------------------------------------------------------- deleting

async function deleteItem(itemPath, isDirectory) {
    try {
        await fs.promises.rm(itemPath, { recursive: !!isDirectory, force: false });
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

async function moveToTrash(itemPath) {
    try { await shell.trashItem(itemPath); return { success: true }; } catch (err) { return { success: false, error: err.message }; }
}

function trashDirs() {
    if (isMac) return [path.join(os.homedir(), '.Trash')];
    if (isWin) return [];
    return [path.join(os.homedir(), '.local', 'share', 'Trash', 'files'), path.join(os.homedir(), '.local', 'share', 'Trash', 'info')];
}

async function trashSize() {
    if (isWin) {
        try {
            const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                "$s=0; (New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $s += $_.Size }; $s"]);
            return parseInt(out.trim(), 10) || 0;
        } catch (_) { return 0; }
    }
    let total = 0;
    for (const d of trashDirs()) total += await getFolderSize(d).catch(() => 0);
    return total;
}

async function emptyTrash() {
    try {
        if (isWin) {
            await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'], 120000);
        } else {
            for (const d of trashDirs()) {
                for (const f of await fs.promises.readdir(d).catch(() => [])) await fs.promises.rm(path.join(d, f), { recursive: true, force: true });
            }
        }
        return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
}

module.exports = { getAvailableDrives, analyzeDrive, cancelScan, browseFolder, getFolderSize, searchFiles, deleteItem, moveToTrash, trashSize, emptyTrash };
