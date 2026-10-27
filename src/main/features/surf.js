'use strict';

/**
 * Surf: the in-app browser (a <webview> with its own persistent session), its built-in ad blocker,
 * Chrome-extension loading, and the Spotify web player window. Everything here is lazy: nothing
 * runs until the Surf page (or the Spotify player) is first used, so it never delays startup.
 */

const { app, session, dialog, BrowserWindow, shell, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const { handle } = require('../ipc/handle');
const ctx = require('../ctx');
const logHandler = require('../logger');
const settingsStore = require('../settings');

// The old code used a module-level `settings` object; this keeps it working against the shared store.
const settings = new Proxy({}, {
    get: (_t, key) => settingsStore.get()[key],
    set: (_t, key, value) => { settingsStore.update({ [key]: value }); return true; }
});
function saveSettings() { settingsStore.update({}); }
function ensureSurfExtensionsArray() { if (!Array.isArray(settingsStore.get().surfExtensions)) settingsStore.update({ surfExtensions: [] }); }

let surfAdBlockListenerReady = false;
let surfBlockedRequestCount = 0;

function parseMajorVersion(versionText) {
    const major = parseInt(String(versionText || '').split('.')[0], 10);
    return Number.isFinite(major) ? major : 0;
}

const platformToken = process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : process.platform === 'linux' ? 'X11; Linux x86_64' : 'Windows NT 10.0; Win64; x64';

const SURF_WEB_PARTITION = 'persist:surf-web';
const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/';
const APP_CHROMIUM_VERSION = process.versions.chrome || '120.0.0.0';
const SURF_CHROME_USER_AGENT = `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${APP_CHROMIUM_VERSION} Safari/537.36`;
const APP_WINDOW_TITLE = 'Uni Companion';
const LIVE_WALLPAPER_SUPPORTED = process.platform === 'win32';
const LIVE_WALLPAPER_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);
const APP_CHROMIUM_MAJOR = parseMajorVersion(APP_CHROMIUM_VERSION);
const SURF_AD_HOSTS = new Set([
    'ad-delivery.net',
    'adform.net',
    'adnxs.com',
    'ads-twitter.com',
    'adsafeprotected.com',
    'advertising.com',
    'amazon-adsystem.com',
    'analytics.yahoo.com',
    'branch.io',
    'chartbeat.com',
    'criteo.com',
    'criteo.net',
    'demdex.net',
    'disqusads.com',
    'doubleclick.net',
    'exelator.com',
    'googlesyndication.com',
    'googletagmanager.com',
    'googleadservices.com',
    'gumgum.com',
    'hotjar.com',
    'imrworldwide.com',
    'insightexpressai.com',
    'lijit.com',
    'mathtag.com',
    'media.net',
    'moatads.com',
    'newrelic.com',
    'openx.net',
    'outbrain.com',
    'pubmatic.com',
    'quantserve.com',
    'rubiconproject.com',
    'scorecardresearch.com',
    'serving-sys.com',
    'smartadserver.com',
    'taboola.com',
    'teads.tv',
    'track.adform.net',
    'zedo.com'
]);
const SURF_AD_URL_PATTERNS = [
    /(^|\.)doubleclick\.net$/i,
    /(^|\.)googlesyndication\.com$/i,
    /(^|\.)googleadservices\.com$/i,
    /\/ads?[/?#]/i,
    /[?&](ad_|adid|adformat|ad_type|advert|campaignid|gclid|yclid)=/i,
    /^https?:\/\/www\.youtube\.com\/api\/stats\/ads/i,
    /^https?:\/\/www\.youtube\.com\/pagead\//i,
    /^https?:\/\/www\.youtube\.com\/youtubei\/v1\/log_event/i
];
const SURF_AD_ALLOWLIST_HOSTS = new Set([
    'open.spotify.com',
    'spotify.com',
    'scdn.co',
    'spotifycdn.com',
    'spotifycdn.net'
]);
const SURF_EXTENSION_WARNING_BUFFER = [];
const MAX_SURF_EXTENSION_WARNING_BUFFER = 80;
const KNOWN_LIMITED_EXTENSION_PERMISSIONS = new Set([
    'privacy',
    'cookies',
    'contextMenus',
    'webNavigation',
    'userScripts'
]);

process.on('warning', (warning) => {
    if (!warning || warning.name !== 'ExtensionLoadWarning') return;
    SURF_EXTENSION_WARNING_BUFFER.push({
        message: String(warning.message || ''),
        at: Date.now()
    });
    if (SURF_EXTENSION_WARNING_BUFFER.length > MAX_SURF_EXTENSION_WARNING_BUFFER) {
        SURF_EXTENSION_WARNING_BUFFER.splice(0, SURF_EXTENSION_WARNING_BUFFER.length - MAX_SURF_EXTENSION_WARNING_BUFFER);
    }
});
function getSurfSession() {
    return session.fromPartition(SURF_WEB_PARTITION);
}

const SURF_ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'about:', 'chrome-extension:']);

function isSurfAllowedUrl(url) {
    if (!url) return true;
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'about:' && parsed.pathname === 'blank') return true;
        return SURF_ALLOWED_PROTOCOLS.has(parsed.protocol);
    } catch (_) {
        return false;
    }
}

function normalizeSpotifyPlaybackUrl(input) {
    const value = String(input || '').trim();
    if (!value) return '';

    const trackUriMatch = value.match(/^spotify:track:([a-zA-Z0-9]+)$/i);
    if (trackUriMatch) {
        return `https://open.spotify.com/track/${trackUriMatch[1]}`;
    }

    try {
        const parsed = new URL(value);
        const host = String(parsed.hostname || '').toLowerCase();
        if (host.includes('spotify.com')) {
            return parsed.toString();
        }
        return '';
    } catch (_) {
        return '';
    }
}

function openSpotifyPlayerWindow(url) {
    const playbackUrl = normalizeSpotifyPlaybackUrl(url);
    if (!playbackUrl) {
        throw new Error('Only Spotify URLs are supported for in-app playback');
    }

    if (spotifyPlayerWindow && !spotifyPlayerWindow.isDestroyed()) {
        spotifyPlayerWindow.loadURL(playbackUrl);
        spotifyPlayerWindow.show();
        spotifyPlayerWindow.focus();
        return true;
    }

    spotifyPlayerWindow = new BrowserWindow({
        width: 1200,
        height: 860,
        minWidth: 900,
        minHeight: 640,
        title: 'Spotify Playback',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            partition: SURF_WEB_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            autoplayPolicy: 'no-user-gesture-required',
            plugins: true
        }
    });

    spotifyPlayerWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
        const normalized = normalizeSpotifyPlaybackUrl(targetUrl);
        if (normalized) {
            spotifyPlayerWindow.loadURL(normalized);
            return { action: 'deny' };
        }
        shell.openExternal(targetUrl);
        return { action: 'deny' };
    });

    spotifyPlayerWindow.webContents.setUserAgent(SURF_CHROME_USER_AGENT);
    spotifyPlayerWindow.on('closed', () => {
        spotifyPlayerWindow = null;
    });
    spotifyPlayerWindow.once('ready-to-show', () => spotifyPlayerWindow.show());
    spotifyPlayerWindow.loadURL(playbackUrl);

    return true;
}

function setupSurfSessionPermissions() {
    const surfSession = getSurfSession();
    const allowedPermissions = new Set([
        'media',
        'mediaKeySystem',
        'protectedMediaIdentifier',
        'geolocation',
        'notifications',
        'fullscreen',
        'pointerLock',
        'clipboard-read',
        'clipboard-sanitized-write',
        'midi',
        'midiSysex',
        'speaker-selection',
        'openExternal'
    ]);

    surfSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(allowedPermissions.has(permission));
    });

    surfSession.setPermissionCheckHandler((webContents, permission) => {
        return allowedPermissions.has(permission);
    });
}

function getPrimaryDisplayBounds() {
    const display = screen.getPrimaryDisplay();
    return display?.bounds || { x: 0, y: 0, width: 1920, height: 1080 };
}
function hostMatchesBlockedList(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;

    for (const blocked of SURF_AD_HOSTS) {
        if (host === blocked || host.endsWith(`.${blocked}`)) {
            return true;
        }
    }
    return false;
}

function hostMatchesAllowList(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;

    for (const allowed of SURF_AD_ALLOWLIST_HOSTS) {
        if (host === allowed || host.endsWith(`.${allowed}`)) {
            return true;
        }
    }
    return false;
}

function shouldBlockSurfRequest(details) {
    try {
        if (!settings.surfBuiltInAdBlock) return false;
        if (!details || !details.url) return false;

        // Never block the main document; this avoids blank pages.
        if (details.resourceType === 'mainFrame') return false;

        const parsed = new URL(details.url);
        const protocol = parsed.protocol;
        if (protocol !== 'http:' && protocol !== 'https:') return false;

        const hostname = parsed.hostname.toLowerCase();
        if (!hostname) return false;
        if (hostMatchesAllowList(hostname)) return false;

        if (hostMatchesBlockedList(hostname)) return true;

        const fullUrl = details.url.toLowerCase();
        for (const pattern of SURF_AD_URL_PATTERNS) {
            if (pattern.test(fullUrl) || pattern.test(hostname)) {
                return true;
            }
        }
    } catch (_) {
        return false;
    }

    return false;
}

async function setupSurfAdBlocker() {
    if (surfAdBlockListenerReady) return;

    const surfSession = getSurfSession();
    surfSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
        const cancel = shouldBlockSurfRequest(details);
        if (cancel) surfBlockedRequestCount += 1;
        callback({ cancel });
    });

    surfAdBlockListenerReady = true;
    console.log('Surf built-in ad blocker is active.');
}

function ensureSurfExtensionsDir() {
    const extDir = path.join(app.getPath('userData'), 'surf-extensions');
    if (!fs.existsSync(extDir)) {
        fs.mkdirSync(extDir, { recursive: true });
    }
    return extDir;
}

function getLoadedSurfExtensions() {
    const surfSession = getSurfSession();
    const loaded = surfSession.getAllExtensions ? surfSession.getAllExtensions() : [];
    const list = Array.isArray(loaded) ? loaded : Object.values(loaded || {});

    return list.map((ext) => ({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        description: ext.description,
        path: ext.path
    }));
}

function parseChromeExtensionId(input) {
    const value = String(input || '').trim();
    if (!value) return null;

    const direct = value.match(/^[a-p]{32}$/i);
    if (direct) return direct[0].toLowerCase();

    try {
        const url = new URL(value);
        const parts = url.pathname.split('/').filter(Boolean);
        for (const part of parts) {
            if (/^[a-p]{32}$/i.test(part)) {
                return part.toLowerCase();
            }
        }
    } catch (_) {
        return null;
    }
    return null;
}

function getChromeExtensionIdValidationError(input) {
    const value = String(input || '').trim();
    if (!value) {
        return 'Paste a Chrome Web Store URL or extension ID.';
    }

    if (/^[a-p]+$/i.test(value) && value.length !== 32) {
        return `Extension ID must be exactly 32 characters (a-p). You entered ${value.length}.`;
    }

    try {
        const url = new URL(value);
        if (/chromewebstore\.google\.com$/i.test(url.hostname)) {
            return 'Could not find a valid extension ID in that Chrome Web Store URL.';
        }
    } catch (_) {
        // Not a URL.
    }

    return 'Invalid Chrome Web Store URL or extension ID.';
}

function buildChromeStoreCrxUrl(extensionId) {
    return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${APP_CHROMIUM_VERSION}&acceptformat=crx3&x=id%3D${extensionId}%26installsource%3Dondemand%26uc`;
}

function fetchBinaryWithRedirects(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const req = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36'
            }
        }, (res) => {
            const status = res.statusCode || 0;

            if (status >= 300 && status < 400 && res.headers.location) {
                if (redirectCount >= 6) {
                    res.resume();
                    reject(new Error('Too many redirects while downloading extension.'));
                    return;
                }
                const nextUrl = new URL(res.headers.location, url).toString();
                res.resume();
                fetchBinaryWithRedirects(nextUrl, redirectCount + 1).then(resolve).catch(reject);
                return;
            }

            if (status < 200 || status >= 300) {
                res.resume();
                reject(new Error(`Extension download failed with status ${status}.`));
                return;
            }

            const chunks = [];
            res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });

        req.on('error', reject);
    });
}

function extractZipPayloadFromCrx(buffer) {
    const magic = buffer.slice(0, 4).toString('ascii');
    if (magic !== 'Cr24') return buffer;

    const version = buffer.readUInt32LE(4);

    if (version === 2) {
        const publicKeyLength = buffer.readUInt32LE(8);
        const signatureLength = buffer.readUInt32LE(12);
        return buffer.slice(16 + publicKeyLength + signatureLength);
    }

    if (version === 3) {
        const headerLength = buffer.readUInt32LE(8);
        return buffer.slice(12 + headerLength);
    }

    throw new Error(`Unsupported CRX version: ${version}`);
}

function resolveExtractedExtensionDir(baseDir) {
    const manifestAtRoot = path.join(baseDir, 'manifest.json');
    if (fs.existsSync(manifestAtRoot)) {
        return baseDir;
    }

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(baseDir, entry.name);
        if (fs.existsSync(path.join(candidate, 'manifest.json'))) {
            return candidate;
        }
    }

    return null;
}

function readExtensionManifest(extensionRoot) {
    const manifestPath = path.join(extensionRoot, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;

    try {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function validateExtensionChromiumCompatibility(manifest) {
    if (!manifest || !manifest.minimum_chrome_version) return null;

    const requiredMajor = parseMajorVersion(manifest.minimum_chrome_version);
    if (!requiredMajor || requiredMajor <= APP_CHROMIUM_MAJOR) return null;

    return `This extension requires Chromium ${requiredMajor}+ but this app uses Chromium ${APP_CHROMIUM_MAJOR} (${APP_CHROMIUM_VERSION}).`;
}

function analyzeExtensionCompatibility(manifest) {
    if (!manifest) return [];

    const warnings = [];
    const permissions = [
        ...(Array.isArray(manifest.permissions) ? manifest.permissions : []),
        ...(Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [])
    ].map((value) => String(value || ''));

    const limitedPermissions = permissions.filter((permission) => KNOWN_LIMITED_EXTENSION_PERMISSIONS.has(permission));
    if (limitedPermissions.length > 0) {
        warnings.push(`Uses limited Electron permissions: ${[...new Set(limitedPermissions)].join(', ')}.`);
    }

    if (manifest.manifest_version === 3 && manifest.background && manifest.background.service_worker) {
        warnings.push('Manifest V3 service workers can fail when an extension depends on unsupported Chrome APIs.');
    }

    return warnings;
}

function consumeRecentExtensionLoadWarnings(extensionPath, sinceTimestamp) {
    const filtered = SURF_EXTENSION_WARNING_BUFFER.filter((item) => item.at >= sinceTimestamp);
    if (!extensionPath) {
        return filtered.map((item) => item.message.trim()).filter(Boolean);
    }

    const normalizedTarget = String(extensionPath).toLowerCase();
    return filtered
        .map((item) => item.message.trim())
        .filter(Boolean)
        .filter((message) => message.toLowerCase().includes(normalizedTarget) || message.toLowerCase().includes('loading extension at'));
}

function saveSurfExtensionRecord({ id, name, version, description, path: extensionPath, source, installRef, storeId, warnings }) {
    ensureSurfExtensionsArray();
    const warningList = [...new Set((Array.isArray(warnings) ? warnings : []).map((item) => String(item || '').trim()).filter(Boolean))];
    const parsedStoreId = parseChromeExtensionId(installRef || '') || '';
    const normalizedStoreId = String(storeId || parsedStoreId || '').trim().toLowerCase();

    const record = {
        id,
        name,
        version,
        description,
        path: extensionPath,
        source: source || 'local',
        installRef: installRef || '',
        storeId: normalizedStoreId,
        warnings: warningList,
        addedAt: new Date().toISOString()
    };

    const existingIndex = settings.surfExtensions.findIndex((item) => (
        item.id === id ||
        item.path === extensionPath ||
        (normalizedStoreId && item.storeId === normalizedStoreId)
    ));
    if (existingIndex >= 0) {
        settings.surfExtensions[existingIndex] = { ...settings.surfExtensions[existingIndex], ...record };
    } else {
        settings.surfExtensions.push(record);
    }

    saveSettings();
    return record;
}

function removeSurfExtensionRecord(idOrPath) {
    ensureSurfExtensionsArray();
    const before = settings.surfExtensions.length;
    settings.surfExtensions = settings.surfExtensions.filter((item) => (
        item.id !== idOrPath &&
        item.path !== idOrPath &&
        item.storeId !== idOrPath
    ));
    if (settings.surfExtensions.length !== before) {
        saveSettings();
    }
}

async function loadSurfExtensionFromPath(folderPath, source = 'local', installRef = '', expectedId = '', storeId = '') {
    if (!folderPath || !fs.existsSync(folderPath)) {
        throw new Error('Extension folder does not exist.');
    }

    let extensionRoot = folderPath;
    if (!fs.existsSync(path.join(extensionRoot, 'manifest.json'))) {
        const resolved = resolveExtractedExtensionDir(folderPath);
        if (!resolved) {
            throw new Error('Invalid extension folder. manifest.json was not found.');
        }
        extensionRoot = resolved;
    }

    const manifest = readExtensionManifest(extensionRoot);
    const compatibilityError = validateExtensionChromiumCompatibility(manifest);
    if (compatibilityError) {
        throw new Error(compatibilityError);
    }
    const compatibilityWarnings = analyzeExtensionCompatibility(manifest);
    const normalizedStoreId = String(storeId || '').trim().toLowerCase();

    const surfSession = getSurfSession();
    const loadedNow = getLoadedSurfExtensions().find((ext) => ext.path === extensionRoot);
    if (loadedNow) {
        const idWarning = expectedId && loadedNow.id !== expectedId
            ? `Installed ID "${loadedNow.id}" differs from store ID "${expectedId}".`
            : '';
        return saveSurfExtensionRecord({
            ...loadedNow,
            path: extensionRoot,
            source,
            installRef,
            storeId: normalizedStoreId || expectedId,
            warnings: [...compatibilityWarnings, idWarning]
        });
    }

    let loadedExtension;
    const warningCaptureStart = Date.now();
    try {
        loadedExtension = await surfSession.loadExtension(extensionRoot, { allowFileAccess: true });
    } catch (err) {
        const message = String(err?.message || '');
        if (/requires Chromium version/i.test(message)) {
            throw new Error(`${message} This app uses Chromium ${APP_CHROMIUM_MAJOR} (${APP_CHROMIUM_VERSION}).`);
        }
        if (/already loaded/i.test(err.message || '')) {
            const existing = getLoadedSurfExtensions().find((ext) => ext.path === extensionRoot);
            if (existing) {
                return saveSurfExtensionRecord({
                    ...existing,
                    path: extensionRoot,
                    source,
                    installRef,
                    storeId: normalizedStoreId || expectedId,
                    warnings: compatibilityWarnings
                });
            }
        }
        throw err;
    }

    const runtimeWarnings = consumeRecentExtensionLoadWarnings(extensionRoot, warningCaptureStart);
    const idWarning = expectedId && loadedExtension.id !== expectedId
        ? `Installed ID "${loadedExtension.id}" differs from store ID "${expectedId}". Electron can still load unpacked store extensions with a different runtime ID.`
        : '';

    return saveSurfExtensionRecord({
        id: loadedExtension.id,
        name: loadedExtension.name,
        version: loadedExtension.version,
        description: loadedExtension.description,
        path: extensionRoot,
        source,
        installRef,
        storeId: normalizedStoreId || expectedId,
        warnings: [...compatibilityWarnings, ...runtimeWarnings, idWarning]
    });
}

async function installSurfExtensionFromStore(input) {
    const extensionId = parseChromeExtensionId(input);
    if (!extensionId) {
        throw new Error(getChromeExtensionIdValidationError(input));
    }

    const surfSession = getSurfSession();
    ensureSurfExtensionsArray();

    const existingStoreRecords = settings.surfExtensions.filter((item) => (
        item.storeId === extensionId ||
        parseChromeExtensionId(item.installRef || '') === extensionId ||
        item.id === extensionId
    ));

    existingStoreRecords.forEach((item) => {
        if (item.id && surfSession.getExtension && surfSession.getExtension(item.id)) {
            surfSession.removeExtension(item.id);
        }
    });

    if (existingStoreRecords.length > 0) {
        settings.surfExtensions = settings.surfExtensions.filter((item) => !existingStoreRecords.includes(item));
        saveSettings();
    }

    if (surfSession.getExtension && surfSession.getExtension(extensionId)) {
        surfSession.removeExtension(extensionId);
    }

    const extensionDir = ensureSurfExtensionsDir();
    const targetDir = path.join(extensionDir, extensionId);
    const crxUrl = buildChromeStoreCrxUrl(extensionId);

    const crxData = await fetchBinaryWithRedirects(crxUrl);
    const zipPayload = extractZipPayloadFromCrx(crxData);

    if (zipPayload.length < 4 || zipPayload[0] !== 0x50 || zipPayload[1] !== 0x4b) {
        throw new Error(`Chrome Web Store package download failed for Chromium ${APP_CHROMIUM_MAJOR}. Verify the extension ID/URL or try a compatible version.`);
    }

    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    const archive = new AdmZip(zipPayload);
    archive.extractAllTo(targetDir, true);

    const extractedRoot = resolveExtractedExtensionDir(targetDir);
    if (!extractedRoot) {
        throw new Error('Downloaded extension package is invalid (manifest.json missing).');
    }

    return loadSurfExtensionFromPath(extractedRoot, 'store', String(input || '').trim(), extensionId, extensionId);
}

async function restoreSurfExtensions() {
    ensureSurfExtensionsArray();
    const configured = [...settings.surfExtensions];
    if (configured.length === 0) return;

    const validRecords = [];
    for (const item of configured) {
        if (!item.path || !fs.existsSync(item.path)) continue;
        try {
            const loaded = await loadSurfExtensionFromPath(
                item.path,
                item.source || 'local',
                item.installRef || '',
                item.id || '',
                item.storeId || ''
            );
            validRecords.push(loaded);
        } catch (err) {
            console.error(`Failed to restore surf extension "${item.name || item.id || item.path}":`, err.message);
        }
    }

    settings.surfExtensions = validRecords;
    saveSettings();
}
handle('surf-select-extension-folder', async () => {
    const result = await dialog.showOpenDialog(ctx.getWindow(), {
        properties: ['openDirectory'],
        title: 'Select unpacked Chrome extension folder'
    });
    return result.filePaths[0] || null;
});

handle('surf-load-extension-folder', async (folderPath) => {
    await ensureStarted();
    const extension = await loadSurfExtensionFromPath(folderPath, 'local', '');
    return { success: true, extension };
});

handle('surf-install-store-extension', async (input) => {
    await ensureStarted();
    const extension = await installSurfExtensionFromStore(input);
    return { success: true, extension, storeUrl: CHROME_WEB_STORE_URL };
});

handle('surf-list-extensions', async () => {
    ensureSurfExtensionsArray();
    const loaded = getLoadedSurfExtensions();
    const combined = settings.surfExtensions.map((item) => {
        const live = loaded.find((ext) => ext.id === item.id) || loaded.find((ext) => ext.path === item.path);
        return {
            id: live?.id || item.id,
            name: live?.name || item.name,
            version: live?.version || item.version,
            description: live?.description || item.description,
            path: live?.path || item.path,
            source: item.source || 'local',
            installRef: item.installRef || '',
            storeId: item.storeId || '',
            warnings: Array.isArray(item.warnings) ? item.warnings : [],
            loaded: !!live
        };
    });

    loaded.forEach((ext) => {
        const exists = combined.some((item) => item.id === ext.id || item.path === ext.path);
        if (!exists) {
            combined.push({
                ...ext,
                source: 'runtime',
                installRef: '',
                storeId: '',
                warnings: [],
                loaded: true
            });
        }
    });

    return combined.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
});

handle('surf-remove-extension', async (idOrPath) => {
    ensureSurfExtensionsArray();
    const target = settings.surfExtensions.find((item) => (
        item.id === idOrPath ||
        item.path === idOrPath ||
        item.storeId === idOrPath
    )) || null;

    const targetId = target?.id || idOrPath;
    const surfSession = getSurfSession();
    if (targetId && surfSession.getExtension && surfSession.getExtension(targetId)) {
        surfSession.removeExtension(targetId);
    }

    if (target && target.source === 'store' && target.path) {
        const managedRoot = ensureSurfExtensionsDir();
        const preferredStoreDir = path.join(managedRoot, target.id || '');
        const cleanupDir = fs.existsSync(preferredStoreDir) ? preferredStoreDir : target.path;
        if (fs.existsSync(cleanupDir)) {
            fs.rmSync(cleanupDir, { recursive: true, force: true });
        }
    }

    removeSurfExtensionRecord(idOrPath);
    return { success: true };
});

// ==================== FILE ORGANIZER HANDLERS ====================

let spotifyPlayerWindow;  // referenced by the Spotify player code above

/** Called once, after the window exists, so the first Surf page load is fast. */
let started = false;
async function ensureStarted() {
    if (started) return;
    started = true;
    setupSurfSessionPermissions();
    await setupSurfAdBlocker();
    try { await restoreSurfExtensions(); } catch (err) { logHandler.warning('surf', `Could not restore extensions: ${err.message}`); }
}

function register() {
    handle('surf-init', async () => { await ensureStarted(); return true; });
    handle('open-spotify-player', async (spotifyUrl) => { await ensureStarted(); return openSpotifyPlayerWindow(spotifyUrl); });
}

module.exports = { register, ensureStarted, getSurfSession };
