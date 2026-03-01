// =========================================================
// Universal Download Manager – Browser Extension v2.0
// Zero-config: just install and it works automatically.
// Bridge runs on 127.0.0.1:38945 (localhost only = secure).
// =========================================================

const BRIDGE_URL = 'http://127.0.0.1:38945';

// File extensions we always capture
const DOWNLOAD_EXTENSIONS = [
    // Video
    '.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.flv', '.ts', '.m3u8', '.wmv', '.3gp',
    // Audio
    '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wav', '.opus', '.wma', '.alac',
    // Archives
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.dmg',
    // Documents
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.epub', '.mobi',
    // Programs / binaries
    '.exe', '.msi', '.deb', '.rpm', '.appimage', '.apk',
    // Images (large)
    '.psd', '.ai', '.svg', '.tif', '.tiff', '.raw', '.cr2', '.nef',
    // Other
    '.torrent', '.bin', '.img'
];

// MIME types we always capture
const DOWNLOAD_MIMES = [
    'application/octet-stream',
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    'application/pdf',
    'application/x-msdownload', 'application/x-msi',
    'application/x-iso9660-image',
    'video/', 'audio/',
    'application/x-bittorrent'
];

// State
let appConnected = false;
let captureEnabled = true;
let captureAll = true;     // capture everything by default
let stats = { captured: 0, failed: 0 };

// ── Helpers ──────────────────────────────────────────────

function shouldCapture(url, fileName, mimeType) {
    if (!url || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('chrome:')) return false;
    if (captureAll) return true;

    const lowerUrl = (url + ' ' + (fileName || '')).toLowerCase();
    const mime = (mimeType || '').toLowerCase();

    // Check MIME
    if (DOWNLOAD_MIMES.some(m => mime.startsWith(m))) return true;

    // Check extension
    if (DOWNLOAD_EXTENSIONS.some(ext => lowerUrl.includes(ext))) return true;

    // Check content-disposition style filenames with known extensions
    return false;
}

async function checkBridge() {
    try {
        const res = await fetch(`${BRIDGE_URL}/health`, { method: 'GET' });
        const ok = res.ok;
        appConnected = ok;
        updateBadge();
        return ok;
    } catch {
        appConnected = false;
        updateBadge();
        return false;
    }
}

async function sendToApp(payload) {
    try {
        const res = await fetch(`${BRIDGE_URL}/capture`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
            stats.captured++;
            saveStats();
            flashBadge('OK', '#22c55e');
            return { ok: true, taskId: data.taskId };
        }
        stats.failed++;
        saveStats();
        return { ok: false, error: data.error || `HTTP ${res.status}` };
    } catch (err) {
        stats.failed++;
        saveStats();
        appConnected = false;
        updateBadge();
        return { ok: false, error: err.message || 'App not reachable' };
    }
}

function updateBadge() {
    if (appConnected && captureEnabled) {
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    } else if (!appConnected) {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    } else {
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    }
}

function flashBadge(text, color) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
    setTimeout(() => updateBadge(), 1500);
}

function saveStats() {
    chrome.storage.local.set({ stats });
}

async function loadState() {
    const data = await chrome.storage.local.get({ captureEnabled: true, captureAll: true, stats: { captured: 0, failed: 0 } });
    captureEnabled = data.captureEnabled;
    captureAll = data.captureAll;
    stats = data.stats;
}

// ── Context Menus ────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'udm_download_link',
        title: 'Download with Universal Manager',
        contexts: ['link']
    });
    chrome.contextMenus.create({
        id: 'udm_download_media',
        title: 'Download media with Universal Manager',
        contexts: ['video', 'audio', 'image']
    });
    chrome.contextMenus.create({
        id: 'udm_download_page',
        title: 'Send page URL to Universal Manager',
        contexts: ['page']
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let url = '';
    let source = 'context-menu';

    if (info.menuItemId === 'udm_download_link') {
        url = info.linkUrl;
        source = 'context-link';
    } else if (info.menuItemId === 'udm_download_media') {
        url = info.srcUrl || info.linkUrl;
        source = 'context-media';
    } else if (info.menuItemId === 'udm_download_page') {
        url = tab?.url;
        source = 'context-page';
    }

    if (!url) return;

    const result = await sendToApp({
        url,
        fileName: '',
        referrer: tab?.url || '',
        source
    });

    if (!result.ok) {
        flashBadge('ERR', '#ef4444');
    }
});

// ── Auto-capture downloads ───────────────────────────────

chrome.downloads.onCreated.addListener(async (item) => {
    if (!captureEnabled) return;

    const url = (item.finalUrl || item.url || '').trim();
    if (!url) return;

    if (!shouldCapture(url, item.filename || '', item.mime || '')) return;

    const result = await sendToApp({
        url,
        fileName: item.filename || '',
        referrer: item.referrer || '',
        source: 'auto-capture'
    });

    if (result.ok) {
        // Cancel the browser download since the app is handling it
        try {
            await chrome.downloads.cancel(item.id);
            await chrome.downloads.erase({ id: item.id });
        } catch (_) {}
    }
});

// ── Message handler (from popup) ─────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'udm_get_status') {
        checkBridge().then(connected => {
            sendResponse({
                connected,
                captureEnabled,
                captureAll,
                stats
            });
        });
        return true; // async response
    }

    if (msg.type === 'udm_toggle_capture') {
        captureEnabled = !!msg.enabled;
        chrome.storage.local.set({ captureEnabled });
        updateBadge();
        sendResponse({ ok: true, captureEnabled });
        return false;
    }

    if (msg.type === 'udm_toggle_capture_all') {
        captureAll = !!msg.enabled;
        chrome.storage.local.set({ captureAll });
        sendResponse({ ok: true, captureAll });
        return false;
    }

    if (msg.type === 'udm_capture_tab') {
        chrome.tabs.query({ active: true, currentWindow: true }).then(async tabs => {
            const url = tabs?.[0]?.url;
            if (!url) {
                sendResponse({ ok: false, error: 'No active tab URL' });
                return;
            }
            const result = await sendToApp({
                url,
                referrer: url,
                source: 'manual-tab'
            });
            sendResponse(result);
        });
        return true;
    }

    if (msg.type === 'udm_capture_url') {
        sendToApp({
            url: msg.url,
            fileName: msg.fileName || '',
            source: 'manual-popup'
        }).then(sendResponse);
        return true;
    }

    if (msg.type === 'udm_reset_stats') {
        stats = { captured: 0, failed: 0 };
        saveStats();
        sendResponse({ ok: true });
        return false;
    }
});

// ── Startup ──────────────────────────────────────────────

loadState().then(() => {
    checkBridge();
    // Periodically check bridge connection
    setInterval(checkBridge, 15000);
});
