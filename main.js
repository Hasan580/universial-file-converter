const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, shell, nativeImage, session, screen, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const AdmZip = require('adm-zip');
const { autoUpdater } = require('electron-updater');

const SURF_WEB_PARTITION = 'persist:surf-web';
const CHROME_WEB_STORE_URL = 'https://chromewebstore.google.com/';
const APP_CHROMIUM_VERSION = process.versions.chrome || '120.0.0.0';
const SURF_CHROME_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${APP_CHROMIUM_VERSION} Safari/537.36`;
const APP_WINDOW_TITLE = 'Universal File Converter';
const LIVE_WALLPAPER_SUPPORTED = process.platform === 'win32';
const LIVE_WALLPAPER_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Register custom protocol for streaming media (avoids CORS)
protocol.registerSchemesAsPrivileged([{
    scheme: 'stream-audio',
    privileges: { stream: true, supportFetchAPI: true, corsEnabled: false, bypassCSP: true }
}]);

// Store active stream URLs: id -> actual URL
const activeStreamUrls = new Map();

function parseMajorVersion(versionText) {
    const major = parseInt(String(versionText || '').split('.')[0], 10);
    return Number.isFinite(major) ? major : 0;
}

function compareVersionText(a, b) {
    const parse = (value) => String(value || '').split('.').map((part) => parseInt(part, 10) || 0);
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const l = left[i] || 0;
        const r = right[i] || 0;
        if (l !== r) return l - r;
    }
    return 0;
}

function findInstalledWidevineCdm() {
    if (process.platform !== 'win32') return null;

    const roots = [
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application'),
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application'),
        path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application'),
        path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application')
    ].filter((root) => root && fs.existsSync(root));

    for (const root of roots) {
        const versionDirs = fs.readdirSync(root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => compareVersionText(b, a));

        for (const versionDir of versionDirs) {
            const base = path.join(root, versionDir, 'WidevineCdm');
            const manifestPath = path.join(base, 'manifest.json');
            const dllPath = path.join(base, '_platform_specific', 'win_x64', 'widevinecdm.dll');
            if (!fs.existsSync(manifestPath) || !fs.existsSync(dllPath)) continue;

            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const version = String(manifest.version || '').trim();
                if (!version) continue;
                return {
                    version,
                    dllPath
                };
            } catch (_) {
                // Ignore invalid manifests and keep searching.
            }
        }
    }

    return null;
}

const widevineInfo = findInstalledWidevineCdm();
if (widevineInfo) {
    app.commandLine.appendSwitch('widevine-cdm-path', widevineInfo.dllPath);
    app.commandLine.appendSwitch('widevine-cdm-version', widevineInfo.version);
    console.log(`Configured Widevine CDM ${widevineInfo.version} from ${widevineInfo.dllPath}`);
}

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

// Single instance lock - prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // Another instance is running, quit this one
    app.quit();
} else {
    // This is the primary instance
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, focus our window
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            showMainWindow();
            // Check if a file was passed via context menu
            const filePath = extractFileArgFromCommandLine(commandLine);
            if (filePath) {
                mainWindow.webContents.send('context-menu-convert', filePath);
            }
        }
    });
}

// Import conversion handlers
let audioHandler, videoHandler, imageHandler, documentHandler, organizerHandler, downloaderHandler, logHandler, storageHandler, aiHandler, booksHandler;

// Keep references to prevent garbage collection
let mainWindow;
let tray = null;
let isInstallingUpdate = false;
let surfAdBlockListenerReady = false;
let surfBlockedRequestCount = 0;
let libraryUpdatePromise = null;
let spotifyPlayerWindow = null;
let liveWallpaperWindow = null;
let liveWallpaperAttachInProgress = false;
let liveWallpaperAttachDetail = '';
let liveWallpaperStatus = {
    running: false,
    attached: false,
    lastError: '',
    currentFile: ''
};

// Auto-Organizer state
let autoOrganizerWatcher = null;
let autoOrganizerSettings = {
    enabled: false,
    watchFolder: '',
    filesOrganized: 0,
    lastAction: null,
    activityLog: []
};

// App settings
let settings = {
    outputDirectory: app.getPath('downloads'),
    theme: 'dark',
    autoDeleteSource: false,
    showNotifications: true,
    minimizeToTray: true,
    launchAtStartup: false,
    playSounds: true,
    autoUpdate: true,
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    surfBuiltInAdBlock: true,
    liveWallpaper: {
        enabled: false,
        filePath: '',
        muted: true,
        volume: 40,
        loop: true,
        playbackRate: 1,
        fitMode: 'cover'
    },
    surfExtensions: []
};

const windowActivityCounts = {
    ffmpeg: 0,
    ytdlp: 0
};

function getActiveWindowLabel() {
    if (windowActivityCounts.ffmpeg > 0 && windowActivityCounts.ytdlp > 0) {
        return 'FFmpeg + yt-dlp';
    }
    if (windowActivityCounts.ffmpeg > 0) {
        return 'FFmpeg';
    }
    if (windowActivityCounts.ytdlp > 0) {
        return 'yt-dlp';
    }
    return APP_WINDOW_TITLE;
}

function refreshMainWindowTitle() {
    const title = getActiveWindowLabel();

    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.setTitle(title);
        } catch (_) {
            // Ignore title update failures.
        }
    }

    if (tray) {
        try {
            tray.setToolTip(title === APP_WINDOW_TITLE ? APP_WINDOW_TITLE : `${title} - ${APP_WINDOW_TITLE}`);
        } catch (_) {
            // Ignore tooltip update failures.
        }
    }
}

function startWindowActivity(kind) {
    if (!Object.prototype.hasOwnProperty.call(windowActivityCounts, kind)) return;
    windowActivityCounts[kind] += 1;
    refreshMainWindowTitle();
}

function stopWindowActivity(kind) {
    if (!Object.prototype.hasOwnProperty.call(windowActivityCounts, kind)) return;
    windowActivityCounts[kind] = Math.max(0, windowActivityCounts[kind] - 1);
    refreshMainWindowTitle();
}

async function withWindowActivity(kind, work) {
    startWindowActivity(kind);
    try {
        return await work();
    } finally {
        stopWindowActivity(kind);
    }
}

function hasActiveWindowActivity() {
    return Object.values(windowActivityCounts).some((count) => count > 0);
}

function prepareForAppShutdown(options = {}) {
    const forceWindowClose = options.forceWindowClose !== false;
    const forUpdate = !!options.forUpdate;

    if (forUpdate) {
        isInstallingUpdate = true;
    }

    app.isQuitting = true;

    try {
        stopLiveWallpaperWindow();
    } catch (_) {}

    try {
        stopAutoOrganizer();
    } catch (_) {}

    try {
        if (dmEngine && typeof dmEngine.shutdown === 'function') {
            dmEngine.shutdown();
        }
    } catch (_) {}

    try {
        if (dmBridgeServer) {
            dmBridgeServer.close();
            dmBridgeServer = null;
        }
    } catch (_) {}

    try {
        if (tray) {
            tray.destroy();
            tray = null;
        }
    } catch (_) {}

    try {
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win || win.isDestroyed()) continue;
            win.removeAllListeners('close');
            win.removeAllListeners('minimize');
            if (forceWindowClose) {
                win.destroy();
            } else {
                win.close();
            }
        }
    } catch (_) {}
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function normalizeLiveWallpaperSettings(input = {}) {
    const filePath = String(input.filePath || '').trim();
    const muted = input.muted !== undefined ? !!input.muted : true;
    const loop = input.loop !== undefined ? !!input.loop : true;
    const volume = Math.round(clampNumber(input.volume, 0, 100, 40));
    const playbackRate = clampNumber(input.playbackRate, 0.25, 3, 1);
    const fitModeRaw = String(input.fitMode || 'cover').toLowerCase();
    const fitMode = ['cover', 'contain', 'fill'].includes(fitModeRaw) ? fitModeRaw : 'cover';

    return {
        enabled: !!input.enabled,
        filePath,
        muted,
        volume,
        loop,
        playbackRate,
        fitMode
    };
}

function ensureLiveWallpaperSettings() {
    settings.liveWallpaper = normalizeLiveWallpaperSettings(settings.liveWallpaper || {});
}

function isSupportedLiveWallpaperFile(filePath) {
    const extension = path.extname(String(filePath || '')).toLowerCase();
    return LIVE_WALLPAPER_VIDEO_EXTENSIONS.has(extension);
}

// Load settings from file
function loadSettings() {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const settingsFileExists = fs.existsSync(settingsPath);
    try {
        if (settingsFileExists) {
            settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
        } else if (!Number.isFinite(Number(settings.defaultHiddenFeaturesVersion)) || Number(settings.defaultHiddenFeaturesVersion) < 2) {
            // Fresh installs use the newer default-hidden profile for optional feature tabs.
            settings.defaultHiddenFeaturesVersion = 2;
        }
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
    // Keep Surf ad blocker enabled by default for in-app browsing.
    settings.surfBuiltInAdBlock = true;
    ensureLiveWallpaperSettings();
    ensureSurfExtensionsArray();
    return settings;
}

// Save settings to file
function saveSettings() {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}

function ensureSurfExtensionsArray() {
    if (!Array.isArray(settings.surfExtensions)) {
        settings.surfExtensions = [];
    }
}

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

function getNativeWindowHandleValue(window) {
    const handleBuffer = window.getNativeWindowHandle();
    if (!handleBuffer || handleBuffer.length === 0) return '0';
    if (handleBuffer.length >= 8) {
        return handleBuffer.readBigUInt64LE(0).toString();
    }
    return handleBuffer.readUInt32LE(0).toString();
}

function runPowerShellScript(script) {
    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { windowsHide: true, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error((stderr || '').trim() || error.message));
                    return;
                }
                resolve(String(stdout || '').trim());
            }
        );
    });
}

async function attachLiveWallpaperWindowToDesktop(window) {
    if (!LIVE_WALLPAPER_SUPPORTED || !window || window.isDestroyed()) return false;
    if (liveWallpaperAttachInProgress) return false;
    liveWallpaperAttachInProgress = true;

    const hwnd = getNativeWindowHandleValue(window);
    const script = [
        'Add-Type -TypeDefinition @"',
        'using System;',
        'using System.Runtime.InteropServices;',
        'using System.Text;',
        'public static class DesktopWallpaperHost {',
        '  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);',
        '  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);',
        '  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr child, IntPtr newParent);',
        '  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);',
        '  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);',
        '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);',
        '  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
        '  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);',
        '  public static string ClassOf(IntPtr hWnd) {',
        '    var sb = new StringBuilder(260);',
        '    var count = GetClassName(hWnd, sb, sb.Capacity);',
        '    return count > 0 ? sb.ToString() : "";',
        '  }',
        '}',
        '"@',
        `$target = [IntPtr]${hwnd}`,
        'if ($target -eq [IntPtr]::Zero) { Write-Output "target-invalid"; exit 0 }',
        '$progman = [DesktopWallpaperHost]::FindWindow("Progman", $null)',
        'if ($progman -eq [IntPtr]::Zero) { Write-Output "progman-not-found"; exit 0 }',
        '$result = [UIntPtr]::Zero',
        '[DesktopWallpaperHost]::SendMessageTimeout($progman, 0x052C, [UIntPtr]0, [IntPtr]0, 0, 1000, [ref]$result) | Out-Null',
        '[DesktopWallpaperHost]::SendMessageTimeout($progman, 0x052C, [UIntPtr]0, [IntPtr]1, 0, 1000, [ref]$result) | Out-Null',
        'Start-Sleep -Milliseconds 200',
        '$desktopOwner = [IntPtr]::Zero',
        '$node = [DesktopWallpaperHost]::FindWindowEx([IntPtr]::Zero, [IntPtr]::Zero, $null, $null)',
        'while ($node -ne [IntPtr]::Zero) {',
        '  $defView = [DesktopWallpaperHost]::FindWindowEx($node, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
        '  if ($defView -ne [IntPtr]::Zero) {',
        '    $desktopOwner = $node',
        '    break',
        '  }',
        '  $node = [DesktopWallpaperHost]::FindWindowEx([IntPtr]::Zero, $node, $null, $null)',
        '}',
        'if ($desktopOwner -eq [IntPtr]::Zero) {',
        '  $progmanDefView = [DesktopWallpaperHost]::FindWindowEx($progman, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
        '  if ($progmanDefView -ne [IntPtr]::Zero) { $desktopOwner = $progman }',
        '}',
        'if ($desktopOwner -eq [IntPtr]::Zero) { Write-Output "defview-not-found"; exit 0 }',
        '$desktopHost = [DesktopWallpaperHost]::FindWindowEx([IntPtr]::Zero, $desktopOwner, "WorkerW", $null)',
        'if ($desktopHost -eq [IntPtr]::Zero) {',
        '  $worker = [DesktopWallpaperHost]::FindWindowEx([IntPtr]::Zero, [IntPtr]::Zero, "WorkerW", $null)',
        '  while ($worker -ne [IntPtr]::Zero) {',
        '    $workerDefView = [DesktopWallpaperHost]::FindWindowEx($worker, [IntPtr]::Zero, "SHELLDLL_DefView", $null)',
        '    if ($workerDefView -eq [IntPtr]::Zero) {',
        '      $desktopHost = $worker',
        '      break',
        '    }',
        '    $worker = [DesktopWallpaperHost]::FindWindowEx([IntPtr]::Zero, $worker, "WorkerW", $null)',
        '  }',
        '}',
        'if ($desktopHost -eq [IntPtr]::Zero) { $desktopHost = $desktopOwner }',
        'if ($desktopHost -eq [IntPtr]::Zero) { $desktopHost = $progman }',
        'if ($desktopHost -eq [IntPtr]::Zero) { Write-Output "host-not-found"; exit 0 }',
        '$hostClass = [DesktopWallpaperHost]::ClassOf($desktopHost)',
        '[DesktopWallpaperHost]::SetParent($target, $desktopHost) | Out-Null',
        '$actualParent = [DesktopWallpaperHost]::GetParent($target)',
        'if ($actualParent -eq [IntPtr]::Zero) { Write-Output ("setparent-failed:" + $hostClass); exit 0 }',
        'if ($actualParent -ne $desktopHost) { Write-Output ("setparent-mismatch:" + [DesktopWallpaperHost]::ClassOf($actualParent)); exit 0 }',
        '[DesktopWallpaperHost]::SetWindowPos($target, [IntPtr]1, 0, 0, 0, 0, 0x0013) | Out-Null',
        '[DesktopWallpaperHost]::ShowWindow($target, 5) | Out-Null',
        'Write-Output ("attached:" + $hostClass)'
    ].join('\n');

    try {
        const output = await runPowerShellScript(script);
        liveWallpaperAttachDetail = String(output || '').trim();
        const attached = String(output || '')
            .split(/\r?\n/)
            .some((line) => line.trim().toLowerCase().startsWith('attached:'));
        if (!attached && output) {
            console.error('Wallpaper attach did not succeed:', output);
        }
        return attached;
    } catch (err) {
        liveWallpaperAttachDetail = String(err?.message || err || 'unknown-error');
        console.error('Failed to attach wallpaper window to desktop host:', err.message);
        return false;
    } finally {
        liveWallpaperAttachInProgress = false;
    }
}

function updateLiveWallpaperBounds() {
    if (!liveWallpaperWindow || liveWallpaperWindow.isDestroyed()) return;
    const bounds = getPrimaryDisplayBounds();
    liveWallpaperWindow.setBounds(bounds);
}

function getLiveWallpaperStatusPayload() {
    ensureLiveWallpaperSettings();
    const windowRunning = !!(liveWallpaperWindow && !liveWallpaperWindow.isDestroyed());
    return {
        supported: LIVE_WALLPAPER_SUPPORTED,
        running: windowRunning,
        attached: liveWallpaperStatus.attached,
        lastError: liveWallpaperStatus.lastError || '',
        settings: normalizeLiveWallpaperSettings({
            ...settings.liveWallpaper,
            enabled: windowRunning
        })
    };
}

function resetLiveWallpaperStatus() {
    liveWallpaperAttachDetail = '';
    liveWallpaperStatus = {
        running: false,
        attached: false,
        lastError: '',
        currentFile: ''
    };
}

function stopLiveWallpaperWindow() {
    if (!liveWallpaperWindow || liveWallpaperWindow.isDestroyed()) {
        liveWallpaperWindow = null;
        resetLiveWallpaperStatus();
        return;
    }

    const closingWindow = liveWallpaperWindow;
    liveWallpaperWindow = null;
    try {
        closingWindow.destroy();
    } catch (_) {
        // Ignore close errors.
    }
    resetLiveWallpaperStatus();
}

async function startLiveWallpaperWindow(rawOptions) {
    if (!LIVE_WALLPAPER_SUPPORTED) {
        throw new Error('Live wallpaper is currently supported on Windows only.');
    }

    const options = normalizeLiveWallpaperSettings(rawOptions || {});
    if (!options.filePath) {
        throw new Error('Select an MP4 file first.');
    }
    if (!fs.existsSync(options.filePath)) {
        throw new Error('Selected video file was not found.');
    }
    if (!isSupportedLiveWallpaperFile(options.filePath)) {
        throw new Error('Use a supported video file (MP4, WEBM, MOV, M4V, MKV, AVI).');
    }

    stopLiveWallpaperWindow();
    liveWallpaperStatus.lastError = '';

    const bounds = getPrimaryDisplayBounds();
    const wallpaperWindow = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        show: false,
        frame: false,
        focusable: false,
        skipTaskbar: true,
        movable: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        backgroundColor: '#000000',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
            autoplayPolicy: 'no-user-gesture-required'
        }
    });

    wallpaperWindow.setMenuBarVisibility(false);
    wallpaperWindow.setIgnoreMouseEvents(true, { forward: true });

    const thisWindow = wallpaperWindow;
    thisWindow.on('closed', () => {
        if (liveWallpaperWindow === thisWindow) {
            liveWallpaperWindow = null;
            resetLiveWallpaperStatus();
        }
    });

    const videoUrl = pathToFileURL(options.filePath).toString();
    await thisWindow.loadFile('src/wallpaper.html', {
        query: {
            videoPath: videoUrl,
            muted: String(options.muted),
            loop: String(options.loop),
            volume: String(options.volume),
            playbackRate: String(options.playbackRate),
            fitMode: options.fitMode
        }
    });

    const attached = await attachLiveWallpaperWindowToDesktop(thisWindow);
    if (!attached) {
        const detailLine = String(liveWallpaperAttachDetail || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .pop();
        try {
            thisWindow.destroy();
        } catch (_) {
            // Ignore close errors.
        }
        const suffix = detailLine ? ` (details: ${detailLine})` : '';
        throw new Error(`Could not attach wallpaper behind desktop icons.${suffix}`);
    }

    liveWallpaperWindow = thisWindow;
    updateLiveWallpaperBounds();
    thisWindow.showInactive();

    liveWallpaperStatus.running = true;
    liveWallpaperStatus.attached = true;
    liveWallpaperStatus.currentFile = options.filePath;
    liveWallpaperStatus.lastError = '';
    return getLiveWallpaperStatusPayload();
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

function getAppIcon() {
    const icoPaths = [
        path.join(__dirname, 'build', 'icon.ico'),
        path.join(__dirname, 'build', 'icon.png')
    ];
    if (app.isPackaged) {
        icoPaths.unshift(
            path.join(process.resourcesPath, 'build', 'icon.ico'),
            path.join(process.resourcesPath, 'build', 'icon.png')
        );
    }
    for (const p of icoPaths) {
        if (fs.existsSync(p)) {
            try {
                return nativeImage.createFromPath(p);
            } catch (_) { /* skip */ }
        }
    }
    return null;
}

function hideMainWindow() {
    if (!mainWindow) return;
    mainWindow.setSkipTaskbar(true);
    mainWindow.hide();
}

function showMainWindow() {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.setSkipTaskbar(false);
    // Re-set the icon to prevent black taskbar icon on Windows
    const icon = getAppIcon();
    if (icon) {
        try {
            mainWindow.setIcon(icon);
        } catch (_) { /* ignore */ }
    }
    mainWindow.focus();
}

function createWindow() {
    // Load settings first so we can set the correct background color
    loadSettings();
    const bgColor = settings.theme === 'light' ? '#f5f5fa' : '#0a0a0f';

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: APP_WINDOW_TITLE,
        frame: false,
        transparent: false,
        backgroundColor: bgColor,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            plugins: true,
            autoplayPolicy: 'no-user-gesture-required',
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'build', 'icon.ico'),
        show: false
    });

    mainWindow.loadFile('src/index.html');
    refreshMainWindowTitle();

    // Secure attached webviews against nodeIntegration escalation
    mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
        delete webPreferences.preload;
        webPreferences.nodeIntegration = false;
        webPreferences.contextIsolation = true;
    });

    // Check if launched at startup with --hidden flag
    const startHidden = process.argv.includes('--hidden');

    // Show window when ready (unless started hidden)
    mainWindow.once('ready-to-show', () => {
        if (startHidden) {
            // Started at login - stay hidden in tray
            console.log('App started hidden (startup launch)');
            if (logHandler) logHandler.info('system', 'App started minimized to tray (startup launch)');
        } else {
            mainWindow.show();
        }
    });

    // Handle minimize to tray
    mainWindow.on('minimize', () => {
        // Reload settings to get current value
        loadSettings();
        if (settings.minimizeToTray && !app.isQuitting && !isInstallingUpdate) {
            hideMainWindow();
        }
    });

    mainWindow.on('close', (event) => {
        // Reload settings to get current value
        loadSettings();
        if (settings.minimizeToTray && !app.isQuitting && !isInstallingUpdate) {
            event.preventDefault();
            hideMainWindow();
        }
    });

    // Dev tools in development
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

function createTray() {
    // Don't create duplicate trays
    if (tray !== null) {
        return;
    }

    // Get the correct icon path for both dev and packaged modes
    let iconPath = null;
    let basePath;

    // Determine base path based on packaged vs dev mode
    if (app.isPackaged) {
        basePath = process.resourcesPath;
    } else {
        basePath = __dirname;
    }

    // Try different icon locations and formats
    const iconPaths = [
        path.join(basePath, 'build', 'icon.ico'),
        path.join(basePath, 'build', 'icon.png'),
        path.join(app.getAppPath(), 'build', 'icon.ico'),
        path.join(app.getAppPath(), 'build', 'icon.png'),
        path.join(__dirname, 'build', 'icon.ico'),
        path.join(__dirname, 'build', 'icon.png')
    ];

    for (const tryPath of iconPaths) {
        console.log('Trying icon path:', tryPath, 'exists:', fs.existsSync(tryPath));
        if (fs.existsSync(tryPath)) {
            iconPath = tryPath;
            break;
        }
    }

    if (!iconPath) {
        console.log('No tray icon found, skipping tray creation');
        return;
    }

    console.log('Using tray icon:', iconPath);

    try {
        tray = new Tray(iconPath);
        console.log('Tray created successfully');
    } catch (err) {
        console.error('Failed to create tray:', err);
        return;
    }

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Universal Converter',
            click: () => {
                if (mainWindow) {
                    showMainWindow();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quick Convert Audio',
            click: () => {
                if (mainWindow) {
                    showMainWindow();
                    mainWindow.webContents.send('navigate', 'audio');
                }
            }
        },
        {
            label: 'Quick Convert Video',
            click: () => {
                if (mainWindow) {
                    showMainWindow();
                    mainWindow.webContents.send('navigate', 'video');
                }
            }
        },
        {
            label: 'Quick Convert Image',
            click: () => {
                if (mainWindow) {
                    showMainWindow();
                    mainWindow.webContents.send('navigate', 'image');
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Exit',
            click: () => {
                prepareForAppShutdown({ forceWindowClose: false });
                app.quit();
            }
        }
    ]);

    tray.setToolTip(APP_WINDOW_TITLE);
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        if (mainWindow) {
            showMainWindow();
        }
    });
}

// Initialize handlers after app is ready
function initializeHandlers() {
    // Initialize log handler first
    logHandler = require('./converters/logHandler');
    logHandler.initialize(app.getPath('userData'));
    logHandler.info('system', 'Application started', { version: app.getVersion() });

    audioHandler = require('./converters/audioHandler');
    videoHandler = require('./converters/videoHandler');
    imageHandler = require('./converters/imageHandler');
    documentHandler = require('./converters/documentHandler');
    organizerHandler = require('./converters/organizerHandler');
    downloaderHandler = require('./converters/downloaderHandler');
    storageHandler = require('./converters/storageHandler');
    aiHandler = require('./converters/aiHandler');
    booksHandler = require('./converters/booksHandler');

    // Initialize AI handler with Gemini API key
    aiHandler.initialize().then(() => {
        if (settings.geminiApiKey) {
            aiHandler.setApiKey(settings.geminiApiKey);
        }
        console.log('AI Handler initialized');
        logHandler.success('ai', 'AI Hub initialized successfully');
    }).catch(err => {
        logHandler.warning('ai', 'AI Handler initialization warning', { error: err.message });
    });

    // Initialize yt-dlp asynchronously
    downloaderHandler.initialize().then(available => {
        console.log('yt-dlp available:', available);
        if (available) {
            logHandler.success('download', 'yt-dlp initialized successfully');
        } else {
            logHandler.warning('download', 'yt-dlp not available - will download on first use');
        }
    }).catch(err => {
        logHandler.error('download', 'Failed to initialize yt-dlp', { error: err.message });
    });
}

// App lifecycle
app.whenReady().then(async () => {
    // Register stream-audio:// protocol handler to proxy streaming media URLs
    protocol.handle('stream-audio', async (request) => {
        const url = new URL(request.url);
        const streamId = url.hostname;
        const realUrl = activeStreamUrls.get(streamId);
        if (!realUrl) {
            return new Response('Stream not found', { status: 404 });
        }
        try {
            return net.fetch(realUrl, {
                headers: request.headers
            });
        } catch (err) {
            return new Response('Stream error: ' + err.message, { status: 500 });
        }
    });

    loadSettings();
    loadAutoOrganizerSettings();
    setupSurfSessionPermissions();
    await setupSurfAdBlocker();
    try {
        await restoreSurfExtensions();
    } catch (err) {
        console.error('Failed to restore surf extensions:', err.message);
    }
    createWindow();
    screen.on('display-metrics-changed', () => updateLiveWallpaperBounds());
    screen.on('display-added', () => updateLiveWallpaperBounds());
    screen.on('display-removed', () => updateLiveWallpaperBounds());

    ensureLiveWallpaperSettings();
    if (settings.liveWallpaper.enabled && settings.liveWallpaper.filePath) {
        try {
            await startLiveWallpaperWindow(settings.liveWallpaper);
        } catch (err) {
            console.error('Failed to restore live wallpaper:', err.message);
            settings.liveWallpaper.enabled = false;
            saveSettings();
        }
    }

    createTray();
    initializeHandlers();
    setupAutoUpdater();
    initDownloadManager();
    registerContextMenu();

    // Handle file passed via context menu on first launch
    const initialFile = extractFileArgFromCommandLine(process.argv);
    if (initialFile && mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.send('context-menu-convert', initialFile);
        });
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('web-contents-created', (event, contents) => {
    if (contents.getType() !== 'webview') return;

    try {
        contents.setUserAgent(SURF_CHROME_USER_AGENT);
    } catch (_) {
        // Ignore user-agent assignment errors.
    }

    // Keep popups inside the same webview while allowing extension pages.
    contents.setWindowOpenHandler(({ url }) => {
        if (isSurfAllowedUrl(url)) {
            contents.loadURL(url);
        }
        return { action: 'deny' };
    });

    // Prevent navigation to disallowed protocols from embedded browsing.
    contents.on('will-navigate', (navEvent, url) => {
        if (isSurfAllowedUrl(url)) return;
        navEvent.preventDefault();
    });

    contents.on('dom-ready', () => {
        try {
            contents.setUserAgent(SURF_CHROME_USER_AGENT);
        } catch (_) {
            // Ignore user-agent assignment errors.
        }
    });
});

app.on('before-quit', () => {
    prepareForAppShutdown({ forceWindowClose: true, forUpdate: isInstallingUpdate });
});

app.on('before-quit-for-update', () => {
    prepareForAppShutdown({ forceWindowClose: true, forUpdate: true });
});

// =====================================================
// Semver comparison helper
// =====================================================
function isNewerVersion(newVer, currentVer) {
    const parseVer = (v) => v.replace(/^v/, '').split('.').map(Number);
    const a = parseVer(newVer);
    const b = parseVer(currentVer);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const na = a[i] || 0;
        const nb = b[i] || 0;
        if (na > nb) return true;
        if (na < nb) return false;
    }
    return false; // equal = not newer
}

// =====================================================
// Auto-Updater (GitHub Releases)
// =====================================================
function setupAutoUpdater() {
    // Configure auto-updater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.autoRunAppAfterInstall = true;

    const currentVersion = app.getVersion();

    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates... (current:', currentVersion, ')');
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-status', { status: 'checking' });
        }
    });

    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info.version, '(current:', currentVersion, ')');
        // Only notify if the version is actually newer using proper semver comparison
        if (info.version && isNewerVersion(info.version, currentVersion)) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-available', {
                    version: info.version,
                    releaseDate: info.releaseDate,
                    releaseNotes: info.releaseNotes
                });
            }
        } else {
            console.log('Version', info.version, 'is not newer than current', currentVersion, '- ignoring.');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-status', { status: 'up-to-date', version: currentVersion });
            }
        }
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('No updates available. Current version:', currentVersion);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-status', { status: 'up-to-date', version: currentVersion });
        }
    });

    autoUpdater.on('download-progress', (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-download-progress', {
                percent: Math.round(progress.percent),
                transferred: progress.transferred,
                total: progress.total,
                speed: progress.bytesPerSecond
            });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded:', info.version);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-downloaded', {
                version: info.version
            });
        }
    });

    autoUpdater.on('error', (err) => {
        console.error('Auto-updater error:', err.message);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-status', { status: 'error', error: err.message });
        }
    });

    // Check for updates if auto-update is enabled (with delay to not slow app startup)
    if (settings.autoUpdate) {
        setTimeout(() => {
            autoUpdater.checkForUpdates().catch(err => {
                console.log('Update check failed (this is normal in dev):', err.message);
            });
        }, 5000);
    }
}

// IPC handlers for auto-updater
ipcMain.handle('check-for-updates', async () => {
    try {
        const result = await autoUpdater.checkForUpdates();
        if (result && result.updateInfo) {
            const currentVersion = app.getVersion();
            const newVersion = result.updateInfo.version;
            // Use proper semver comparison - only report update if actually newer
            if (newVersion && isNewerVersion(newVersion, currentVersion)) {
                return { version: newVersion, isNewer: true };
            }
            return { version: currentVersion, isNewer: false };
        }
        return { version: app.getVersion(), isNewer: false };
    } catch (err) {
        console.error('Update check failed:', err.message);
        return { error: err.message };
    }
});

// Fetch release notes from GitHub
ipcMain.handle('get-release-notes', async () => {
    try {
        const https = require('https');
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: '/repos/Hasan580/universial-file-converter/releases',
                headers: { 'User-Agent': 'Universal-File-Converter/' + app.getVersion() }
            };
            https.get(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const releases = JSON.parse(data);
                        const mapped = releases.slice(0, 10).map(r => ({
                            version: r.tag_name,
                            name: r.name,
                            body: r.body,
                            date: r.published_at,
                            prerelease: r.prerelease,
                            url: r.html_url,
                            assets: (r.assets || []).map(a => ({
                                name: a.name,
                                size: a.size,
                                downloads: a.download_count,
                                url: a.browser_download_url
                            }))
                        }));
                        resolve(mapped);
                    } catch (e) {
                        resolve([]);
                    }
                });
            }).on('error', () => resolve([]));
        });
    } catch (err) {
        return [];
    }
});

ipcMain.handle('download-update', async () => {
    try {
        await autoUpdater.downloadUpdate();
        return true;
    } catch (err) {
        console.error('Update download failed:', err.message);
        throw err;
    }
});

ipcMain.handle('install-update', () => {
    // Force the app into a real shutdown path before handing off to NSIS.
    prepareForAppShutdown({ forceWindowClose: true, forUpdate: true });

    setImmediate(() => {
        autoUpdater.quitAndInstall(true, true);

        // Electron helper processes can linger briefly after the window closes.
        // NSIS shows the "please close the app" dialog if they do not die fast enough.
        setTimeout(() => {
            try {
                app.exit(0);
            } catch (_) {}
        }, 5000);
    });
});

ipcMain.handle('scan-qr-from-image', async (event, filePath) => {
    try {
        if (!filePath || typeof filePath !== 'string') {
            return { success: false, error: 'No image was selected' };
        }

        if (!fs.existsSync(filePath)) {
            return { success: false, error: 'Image file not found' };
        }

        const sharp = require('sharp');
        const jsQR = require('jsqr');
        const normalizedPath = path.resolve(filePath);
        const { data, info } = await sharp(normalizedPath)
            .rotate()
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height, {
            inversionAttempts: 'attemptBoth'
        });

        if (!decoded || !decoded.data) {
            return {
                success: false,
                error: 'No QR code was found in this image'
            };
        }

        return {
            success: true,
            data: decoded.data,
            location: decoded.location || null
        };
    } catch (err) {
        return {
            success: false,
            error: err.message || 'Failed to scan QR code'
        };
    }
});

ipcMain.handle('get-auto-update', () => {
    return settings.autoUpdate !== false;
});

ipcMain.handle('set-auto-update', (event, enabled) => {
    settings.autoUpdate = enabled;
    saveSettings();
    if (enabled) {
        autoUpdater.checkForUpdates().catch(() => { });
    }
    return true;
});

// Destroy tray on quit to prevent ghost icons
app.on('will-quit', () => {
    // Stop auto-organizer
    stopAutoOrganizer();

    // Stop download bridge server
    if (dmBridgeServer) {
        try { dmBridgeServer.close(); } catch (_) {}
        dmBridgeServer = null;
    }

    // Destroy tray
    if (tray) {
        tray.destroy();
        tray = null;
    }
});

// ==================== IPC HANDLERS ====================

// Window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});
ipcMain.on('window-close', () => mainWindow.close());

// File dialogs
ipcMain.handle('select-files', async (event, fileTypes) => {
    const filters = [];

    if (fileTypes === 'audio') {
        filters.push({ name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'aiff', 'opus', 'ac3', 'dts', 'amr', 'wv', 'ape', 'mka'] });
    } else if (fileTypes === 'video') {
        filters.push({ name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'm4v', '3gp', 'ts', 'vob', 'mts', 'ogv'] });
    } else if (fileTypes === 'image') {
        filters.push({ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'ico', 'svg', 'avif', 'heif', 'heic', 'jxl', 'jp2'] });
    } else if (fileTypes === 'document') {
        filters.push({ name: 'Document Files', extensions: ['pdf', 'docx', 'doc', 'txt', 'rtf', 'html', 'htm', 'xlsx', 'xls', 'pptx', 'csv', 'json', 'md', 'xml'] });
    } else if (fileTypes === 'books') {
        filters.push({ name: 'EPUB Books', extensions: ['epub'] });
    } else if (fileTypes === 'compress') {
        filters.push({ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'avif', 'heif', 'heic', 'jxl', 'jp2'] });
    } else if (fileTypes === 'player') {
        filters.push({ name: 'Media Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'aiff', 'opus', 'ac3', 'dts', 'amr', 'wv', 'ape', 'mka', 'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'm4v', '3gp', 'ts', 'vob', 'mts', 'ogv'] });
    } else {
        filters.push({ name: 'All Supported Files', extensions: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'pdf', 'docx', 'xlsx'] });
    }

    filters.push({ name: 'All Files', extensions: ['*'] });

    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters
    });

    return result.filePaths;
});

ipcMain.handle('select-output-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.filePaths[0] || null;
});

// Settings
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (event, newSettings) => {
    settings = { ...settings, ...newSettings };
    ensureLiveWallpaperSettings();
    ensureSurfExtensionsArray();
    saveSettings();
    return settings;
});

ipcMain.handle('update-libraries', async () => {
    if (libraryUpdatePromise) {
        return libraryUpdatePromise;
    }

    if (hasActiveWindowActivity()) {
        throw new Error('Please wait for current FFmpeg or yt-dlp work to finish before updating libraries.');
    }

    libraryUpdatePromise = (async () => {
        const libraryManager = require('./converters/libraryManager');
        const ffmpegPaths = require('./converters/ffmpegPaths');

        try {
            const ytdlpResult = downloaderHandler && typeof downloaderHandler.updateYtdlp === 'function'
                ? await downloaderHandler.updateYtdlp()
                : await libraryManager.updateYtdlp();

            const ffmpegResult = await ffmpegPaths.updateFfmpeg();

            if (downloaderHandler && typeof downloaderHandler.refreshBinaryPath === 'function') {
                await downloaderHandler.refreshBinaryPath();
            }

            if (logHandler) {
                logHandler.success('system', 'Updated yt-dlp and FFmpeg libraries', {
                    ytdlpVersion: ytdlpResult.version,
                    ffmpegVersion: ffmpegResult.version
                });
            }

            return {
                success: true,
                ytdlp: ytdlpResult,
                ffmpeg: ffmpegResult
            };
        } catch (err) {
            if (logHandler) {
                logHandler.error('system', 'Failed to update libraries', { error: err.message });
            }
            throw err;
        }
    })();

    try {
        return await libraryUpdatePromise;
    } finally {
        libraryUpdatePromise = null;
    }
});

ipcMain.handle('get-output-directory', () => settings.outputDirectory);

// File info
ipcMain.handle('get-file-info', async (event, filePath) => {
    try {
        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase().slice(1);

        return {
            name: path.basename(filePath),
            path: filePath,
            size: stats.size,
            extension: ext,
            type: getFileType(ext)
        };
    } catch (err) {
        throw new Error(`Failed to get file info: ${err.message}`);
    }
});

// Extract cover art from audio file
ipcMain.handle('extract-cover-art', async (event, filePath) => {
    try {
        const { getFfmpegPath } = require('./converters/ffmpegPaths');
        const ffmpegBin = getFfmpegPath();
        const tempDir = app.getPath('temp');
        const outputPath = path.join(tempDir, `cover_${Date.now()}.jpg`);

        return await new Promise((resolve, reject) => {
            const args = ['-i', filePath, '-an', '-vcodec', 'mjpeg', '-frames:v', '1', '-y', outputPath];
            execFile(ffmpegBin, args, { timeout: 10000 }, (error) => {
                if (error || !fs.existsSync(outputPath)) {
                    resolve(null);
                    return;
                }
                try {
                    const stats = fs.statSync(outputPath);
                    if (stats.size < 100) {
                        fs.unlinkSync(outputPath);
                        resolve(null);
                        return;
                    }
                    const imgBuffer = fs.readFileSync(outputPath);
                    const base64 = imgBuffer.toString('base64');
                    fs.unlinkSync(outputPath);
                    resolve('data:image/jpeg;base64,' + base64);
                } catch (e) {
                    resolve(null);
                }
            });
        });
    } catch (err) {
        console.error('Failed to extract cover art:', err);
        return null;
    }
});

function getFileType(ext) {
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'aiff', 'opus', 'ac3', 'dts', 'amr', 'wv', 'ape', 'mka'];
    const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'm4v', '3gp', 'ts', 'vob', 'mts', 'ogv'];
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp', 'ico', 'svg', 'avif', 'heif', 'heic', 'jxl', 'jp2'];
    const docExts = ['pdf', 'docx', 'doc', 'txt', 'rtf', 'html', 'htm', 'xlsx', 'xls', 'pptx', 'csv', 'json', 'md', 'xml'];

    if (audioExts.includes(ext)) return 'audio';
    if (videoExts.includes(ext)) return 'video';
    if (imageExts.includes(ext)) return 'image';
    if (docExts.includes(ext)) return 'document';
    return 'unknown';
}

// =====================================================
// Windows Context Menu Registration
// =====================================================

function extractFileArgFromCommandLine(commandLine) {
    // commandLine is an array; skip the exe path and flags
    for (let i = 1; i < commandLine.length; i++) {
        const arg = commandLine[i];
        if (!arg.startsWith('-') && fs.existsSync(arg)) {
            return arg;
        }
    }
    return null;
}

function registerContextMenu() {
    if (process.platform !== 'win32') return;

    const exePath = app.isPackaged ? process.execPath : process.execPath;
    const regKey = 'HKCU\\Software\\Classes\\*\\shell\\UniversalConverter';
    const regCommandKey = regKey + '\\command';

    const label = 'Convert with Universal Converter';
    const icon = app.isPackaged ? process.execPath : '';
    const cmdValue = `"${exePath}" "%1"`;

    const regAdd = (key, valueName, data) => {
        const args = valueName
            ? ['add', key, '/v', valueName, '/d', data, '/f']
            : ['add', key, '/ve', '/d', data, '/f'];
        execFile('reg.exe', args, { windowsHide: true }, (err) => {
            if (err) console.error('Context menu reg failed for', key, ':', err.message);
        });
    };

    // Register wildcard key
    regAdd(regKey, null, label);
    if (icon) regAdd(regKey, 'Icon', icon);
    regAdd(regCommandKey, null, cmdValue);

    // Supported extensions for context menu filtering
    const supportedExts = [
        '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.aiff', '.opus', '.ac3',
        '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.mpeg', '.m4v', '.3gp', '.ts',
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.ico', '.svg', '.avif', '.heif', '.heic',
        '.pdf', '.docx', '.doc', '.txt', '.rtf', '.html', '.htm', '.xlsx', '.xls', '.pptx', '.csv', '.json', '.md', '.xml'
    ];

    // Register for each supported file extension individually
    for (const ext of supportedExts) {
        const extKey = `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\UniversalConverter`;
        regAdd(extKey, null, label);
        if (icon) regAdd(extKey, 'Icon', icon);
        regAdd(extKey + '\\command', null, cmdValue);
    }
}

function unregisterContextMenu() {
    if (process.platform !== 'win32') return;
    execFile('reg.exe', ['delete', 'HKCU\\Software\\Classes\\*\\shell\\UniversalConverter', '/f'], { windowsHide: true }, () => {});
    // Clean up per-extension keys
    const supportedExts = [
        '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.aiff', '.opus', '.ac3',
        '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.mpeg', '.m4v', '.3gp', '.ts',
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.webp', '.ico', '.svg', '.avif', '.heif', '.heic',
        '.pdf', '.docx', '.doc', '.txt', '.rtf', '.html', '.htm', '.xlsx', '.xls', '.pptx', '.csv', '.json', '.md', '.xml'
    ];
    for (const ext of supportedExts) {
        const extKey = `HKCU\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\UniversalConverter`;
        execFile('reg.exe', ['delete', extKey, '/f'], { windowsHide: true }, () => {});
    }
}

ipcMain.handle('register-context-menu', () => {
    registerContextMenu();
    return { success: true };
});

ipcMain.handle('unregister-context-menu', () => {
    unregisterContextMenu();
    return { success: true };
});

// Conversion handlers
ipcMain.handle('convert-audio', async (event, options) => {
    return withWindowActivity('ffmpeg', async () => {
        // Ensure audioHandler is initialized
        if (!audioHandler) {
            try {
                audioHandler = require('./converters/audioHandler');
            } catch (err) {
                if (logHandler) logHandler.error('audio', 'Failed to load audio handler', { error: err.message });
                throw new Error('Audio converter not available: ' + err.message);
            }
        }

        if (logHandler) logHandler.info('audio', `Starting audio conversion: ${options.inputPath}`, { format: options.outputFormat });
        try {
            const result = await audioHandler.convert(options, (progress) => {
                mainWindow.webContents.send('conversion-progress', { id: options.id, progress });
            });
            if (logHandler) logHandler.success('audio', `Audio conversion complete: ${result.outputPath}`, { inputSize: options.inputSize, outputSize: result.outputSize });
            return result;
        } catch (err) {
            if (logHandler) logHandler.error('audio', `Audio conversion failed: ${err.message}`, { file: options.inputPath });
            throw err;
        }
    });
});

ipcMain.handle('convert-video', async (event, options) => {
    return withWindowActivity('ffmpeg', async () => {
        // Ensure videoHandler is initialized
        if (!videoHandler) {
            try {
                videoHandler = require('./converters/videoHandler');
            } catch (err) {
                if (logHandler) logHandler.error('video', 'Failed to load video handler', { error: err.message });
                throw new Error('Video converter not available: ' + err.message);
            }
        }

        if (logHandler) logHandler.info('video', `Starting video conversion: ${options.inputPath}`, { format: options.outputFormat, resolution: options.resolution });
        try {
            const result = await videoHandler.convert(options, (progress) => {
                mainWindow.webContents.send('conversion-progress', { id: options.id, progress });
            });
            if (logHandler) logHandler.success('video', `Video conversion complete: ${result.outputPath}`, { outputSize: result.outputSize });
            return result;
        } catch (err) {
            if (logHandler) logHandler.error('video', `Video conversion failed: ${err.message}`, { file: options.inputPath });
            throw err;
        }
    });
});

ipcMain.handle('convert-image', async (event, options) => {
    return withWindowActivity('ffmpeg', async () => {
        // Ensure imageHandler is initialized
        if (!imageHandler) {
            try {
                imageHandler = require('./converters/imageHandler');
            } catch (err) {
                if (logHandler) logHandler.error('image', 'Failed to load image handler', { error: err.message });
                throw new Error('Image converter not available: ' + err.message);
            }
        }

        if (logHandler) logHandler.info('image', `Starting image conversion: ${options.inputPath}`, { format: options.outputFormat, quality: options.quality });
        try {
            const result = await imageHandler.convert(options, (progress) => {
                mainWindow.webContents.send('conversion-progress', { id: options.id, progress });
            });
            if (logHandler) logHandler.success('image', `Image conversion complete: ${result.outputPath}`, { outputSize: result.outputSize });
            return result;
        } catch (err) {
            if (logHandler) logHandler.error('image', `Image conversion failed: ${err.message}`, { file: options.inputPath });
            throw err;
        }
    });
});

ipcMain.handle('compress-image', async (event, options) => {
    return withWindowActivity('ffmpeg', async () => {
        // Ensure imageHandler is initialized
        if (!imageHandler) {
            try {
                imageHandler = require('./converters/imageHandler');
            } catch (err) {
                if (logHandler) logHandler.error('image', 'Failed to load image handler', { error: err.message });
                throw new Error('Image compressor not available: ' + err.message);
            }
        }

        if (logHandler) logHandler.info('image', `Starting image compression: ${options.inputPath}`, { quality: options.quality });
        try {
            const result = await imageHandler.compress(options.inputPath, options.outputDirectory, options.quality, (progress) => {
                mainWindow.webContents.send('conversion-progress', { id: options.id, progress });
            });
            if (logHandler) logHandler.success('image', `Image compression complete: ${result.outputPath}`, { inputSize: result.inputSize, outputSize: result.outputSize, saved: result.savedPercent + '%' });
            return result;
        } catch (err) {
            if (logHandler) logHandler.error('image', `Image compression failed: ${err.message}`, { file: options.inputPath });
            throw err;
        }
    });
});

ipcMain.handle('convert-document', async (event, options) => {
    return withWindowActivity('ffmpeg', async () => {
        // Ensure documentHandler is initialized
        if (!documentHandler) {
            try {
                documentHandler = require('./converters/documentHandler');
            } catch (err) {
                if (logHandler) logHandler.error('document', 'Failed to load document handler', { error: err.message });
                throw new Error('Document converter not available: ' + err.message);
            }
        }

        if (logHandler) logHandler.info('document', `Starting document conversion: ${options.inputPath}`, { format: options.outputFormat });
        try {
            const result = await documentHandler.convert(options, (progress) => {
                mainWindow.webContents.send('conversion-progress', { id: options.id, progress });
            });
            if (logHandler) logHandler.success('document', `Document conversion complete: ${result.outputPath}`, { outputSize: result.outputSize });
            return result;
        } catch (err) {
            if (logHandler) logHandler.error('document', `Document conversion failed: ${err.message}`, { file: options.inputPath });
            throw err;
        }
    });
});

// PDF Lock (Password Protection)
ipcMain.handle('lock-pdf', async (event, options) => {
    if (!documentHandler) {
        try { documentHandler = require('./converters/documentHandler'); } catch (err) {
            throw new Error('Document handler not available: ' + err.message);
        }
    }
    try {
        const result = await documentHandler.lockPDF(options);
        if (logHandler) logHandler.success('document', `PDF locked: ${result.outputPath}`);
        return result;
    } catch (err) {
        if (logHandler) logHandler.error('document', `PDF lock failed: ${err.message}`);
        throw err;
    }
});

// PDF Merge
ipcMain.handle('merge-pdfs', async (event, options) => {
    if (!documentHandler) {
        try { documentHandler = require('./converters/documentHandler'); } catch (err) {
            throw new Error('Document handler not available: ' + err.message);
        }
    }
    try {
        const result = await documentHandler.mergePDFs(options);
        if (logHandler) logHandler.success('document', `PDFs merged: ${result.outputPath} (${result.pageCount} pages)`);
        return result;
    } catch (err) {
        if (logHandler) logHandler.error('document', `PDF merge failed: ${err.message}`);
        throw err;
    }
});

// Document editor: read text-based documents
ipcMain.handle('read-editable-document', async (event, options) => {
    if (!documentHandler) {
        try { documentHandler = require('./converters/documentHandler'); } catch (err) {
            throw new Error('Document handler not available: ' + err.message);
        }
    }
    try {
        return await documentHandler.readEditableDocument(options || {});
    } catch (err) {
        if (logHandler) logHandler.error('document', `Read editable document failed: ${err.message}`);
        throw err;
    }
});

// Document editor: save text-based documents
ipcMain.handle('save-editable-document', async (event, options) => {
    if (!documentHandler) {
        try { documentHandler = require('./converters/documentHandler'); } catch (err) {
            throw new Error('Document handler not available: ' + err.message);
        }
    }
    try {
        return await documentHandler.saveEditableDocument(options || {});
    } catch (err) {
        if (logHandler) logHandler.error('document', `Save editable document failed: ${err.message}`);
        throw err;
    }
});

// Document editor: add text overlay to a PDF page
ipcMain.handle('pdf-add-text', async (event, options) => {
    if (!documentHandler) {
        try { documentHandler = require('./converters/documentHandler'); } catch (err) {
            throw new Error('Document handler not available: ' + err.message);
        }
    }
    try {
        return await documentHandler.addTextToPDF(options || {});
    } catch (err) {
        if (logHandler) logHandler.error('document', `PDF text overlay failed: ${err.message}`);
        throw err;
    }
});

// Document editor: read PDF text for direct editing
ipcMain.handle('read-pdf-text', async (event, options) => {
    if (!documentHandler) {
        try { documentHandler = require('./converters/documentHandler'); } catch (err) {
            throw new Error('Document handler not available: ' + err.message);
        }
    }
    try {
        return await documentHandler.readPDFTextForEditing(options || {});
    } catch (err) {
        if (logHandler) logHandler.error('document', `Read PDF text failed: ${err.message}`);
        throw err;
    }
});

// Document editor: save edited PDF text into a new PDF file
ipcMain.handle('save-pdf-text', async (event, options) => {
    if (!documentHandler) {
        try { documentHandler = require('./converters/documentHandler'); } catch (err) {
            throw new Error('Document handler not available: ' + err.message);
        }
    }
    try {
        return await documentHandler.savePDFTextEdits(options || {});
    } catch (err) {
        if (logHandler) logHandler.error('document', `Save PDF text failed: ${err.message}`);
        throw err;
    }
});

// Cancel active conversion processes
ipcMain.handle('cancel-conversion', async () => {
    let cancelled = false;
    
    // Cancel audio conversion (ffmpeg process)
    if (audioHandler && audioHandler.cancelConversion) {
        if (audioHandler.cancelConversion()) cancelled = true;
    }
    
    // Cancel video conversion (ffmpeg process)
    if (videoHandler && videoHandler.cancelConversion) {
        if (videoHandler.cancelConversion()) cancelled = true;
    }
    
    // Cancel image conversion (flag-based)
    if (imageHandler && imageHandler.cancelConversion) {
        if (imageHandler.cancelConversion()) cancelled = true;
    }
    
    // Cancel document conversion (flag-based)
    if (documentHandler && documentHandler.cancelConversion) {
        if (documentHandler.cancelConversion()) cancelled = true;
    }
    
    if (logHandler) logHandler.info('system', 'Conversion cancellation requested', { cancelled });
    return { cancelled };
});

// Open file/folder
ipcMain.on('open-file', (event, filePath) => {
    shell.openPath(filePath);
});

ipcMain.on('open-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
});

// Show notification
ipcMain.on('show-notification', (event, { title, body }) => {
    if (settings.showNotifications) {
        new Notification({ title, body }).show();
    }
});

// Get app version
ipcMain.handle('get-app-version', () => app.getVersion());

// Open external URL in default browser
ipcMain.handle('open-external-url', async (event, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('spotify:'))) {
        await shell.openExternal(url);
    }
});

// Books
ipcMain.handle('books-search-online', async (event, query) => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return await booksHandler.searchOnlineBooks(query);
});

ipcMain.handle('books-get-online-links', async (event, bookPath) => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return await booksHandler.getOnlineBookLinks(bookPath);
});

ipcMain.handle('books-fetch-cover-data-url', async (event, coverUrl) => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return await booksHandler.fetchCoverDataUrl(coverUrl);
});

ipcMain.handle('books-search-offline', async (event, query) => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return await booksHandler.searchOfflineBooks(query);
});

ipcMain.handle('books-download-offline', async (event, payload) => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    const safePayload = payload || {};
    return await booksHandler.downloadOfflineBook(safePayload.editionId, safePayload.bookData || {}, app.getPath('userData'));
});

ipcMain.handle('books-get-library', async () => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return booksHandler.getEpubLibrary(app.getPath('userData'));
});

ipcMain.handle('books-read-epub-file', async (event, filePath) => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return booksHandler.readEpubFile(filePath);
});

ipcMain.handle('books-get-library-folder', async () => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return {
        success: true,
        path: booksHandler.getEpubFolder(app.getPath('userData'))
    };
});

ipcMain.handle('books-import-files', async (event, filePaths) => {
    if (!booksHandler) {
        booksHandler = require('./converters/booksHandler');
    }
    return booksHandler.importEpubFiles(filePaths, app.getPath('userData'));
});

ipcMain.handle('open-spotify-player', async (event, spotifyUrl) => {
    return openSpotifyPlayerWindow(spotifyUrl);
});

// Live Wallpaper
ipcMain.handle('live-wallpaper-select-video', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: 'Select video wallpaper',
        filters: [
            { name: 'Video Files', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('live-wallpaper-start', async (event, rawOptions) => {
    try {
        const options = normalizeLiveWallpaperSettings(rawOptions || {});
        const status = await startLiveWallpaperWindow(options);
        settings.liveWallpaper = { ...options, enabled: true };
        saveSettings();
        return status;
    } catch (err) {
        liveWallpaperStatus.lastError = String(err?.message || err || 'Unknown error');
        throw err;
    }
});

ipcMain.handle('live-wallpaper-stop', async () => {
    stopLiveWallpaperWindow();
    ensureLiveWallpaperSettings();
    settings.liveWallpaper.enabled = false;
    saveSettings();
    return getLiveWallpaperStatusPayload();
});

ipcMain.handle('live-wallpaper-status', async () => {
    return getLiveWallpaperStatusPayload();
});

// Surf Web Extensions
ipcMain.handle('surf-select-extension-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select unpacked Chrome extension folder'
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('surf-load-extension-folder', async (event, folderPath) => {
    const extension = await loadSurfExtensionFromPath(folderPath, 'local', '');
    return { success: true, extension };
});

ipcMain.handle('surf-install-store-extension', async (event, input) => {
    const extension = await installSurfExtensionFromStore(input);
    return { success: true, extension, storeUrl: CHROME_WEB_STORE_URL };
});

ipcMain.handle('surf-list-extensions', async () => {
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

ipcMain.handle('surf-remove-extension', async (event, idOrPath) => {
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

// Select folder for organization
ipcMain.handle('select-organize-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select folder to organize'
    });
    return result.filePaths[0] || null;
});

// Preview organization
ipcMain.handle('preview-organization', async (event, folderPath) => {
    if (!organizerHandler) return [];
    return organizerHandler.previewOrganization(folderPath);
});

// Execute organization
ipcMain.handle('organize-folder', async (event, { folderPath, customMappings }) => {
    if (!organizerHandler) return { success: [], failed: [], skipped: [] };
    return await organizerHandler.organizeDirectory(folderPath, customMappings, (progress) => {
        mainWindow.webContents.send('organize-progress', progress);
    });
});

// Get folder stats
ipcMain.handle('get-folder-stats', async (event, folderPath) => {
    if (!organizerHandler) return null;
    return organizerHandler.getFolderStats(folderPath);
});

// Get default mappings
ipcMain.handle('get-default-mappings', () => {
    if (!organizerHandler) return {};
    return organizerHandler.getDefaultMappings();
});

// Get user paths
ipcMain.handle('get-user-path', (event, pathType) => {
    try {
        return app.getPath(pathType);
    } catch (err) {
        return null;
    }
});

// ==================== AUTO-ORGANIZER HANDLERS ====================

// Load auto-organizer settings
function loadAutoOrganizerSettings() {
    const settingsPath = path.join(app.getPath('userData'), 'auto-organizer.json');
    try {
        if (fs.existsSync(settingsPath)) {
            autoOrganizerSettings = { ...autoOrganizerSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
            // Restart watcher if it was enabled
            if (autoOrganizerSettings.enabled && autoOrganizerSettings.watchFolder) {
                startAutoOrganizer(autoOrganizerSettings.watchFolder);
            }
        }
    } catch (err) {
        console.error('Failed to load auto-organizer settings:', err);
    }
}

// Save auto-organizer settings
function saveAutoOrganizerSettingsToFile() {
    const settingsPath = path.join(app.getPath('userData'), 'auto-organizer.json');
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(autoOrganizerSettings, null, 2));
    } catch (err) {
        console.error('Failed to save auto-organizer settings:', err);
    }
}

// Stop auto-organizer folder watcher
function stopAutoOrganizer() {
    if (autoOrganizerWatcher) {
        try {
            autoOrganizerWatcher.close();
            autoOrganizerWatcher = null;
            console.log('Auto-organizer stopped');
            if (logHandler) {
                logHandler.info('organizer', 'Auto-organizer stopped');
            }
        } catch (err) {
            console.error('Failed to stop auto-organizer:', err);
        }
    }
}

// Start auto-organizer folder watcher
function startAutoOrganizer(folderPath) {
    // Stop existing watcher if any
    stopAutoOrganizer();

    if (!fs.existsSync(folderPath)) {
        console.error('Watch folder does not exist:', folderPath);
        return;
    }

    try {
        // Use fs.watch for folder monitoring
        autoOrganizerWatcher = fs.watch(folderPath, { persistent: true }, async (eventType, filename) => {
            if (!filename || eventType !== 'rename') return;

            const lowerName = filename.toLowerCase();
            // Ignore temporary, download, lock, and hidden files
            if (lowerName.startsWith('.') || lowerName.startsWith('~$') ||
                lowerName.endsWith('.tmp') || lowerName.endsWith('.crdownload') ||
                lowerName.endsWith('.part') || lowerName.endsWith('.download') ||
                lowerName.endsWith('.aria2') || lowerName.endsWith('.bak')) {
                return;
            }

            const filePath = path.join(folderPath, filename);

            // Prevent organizing files inside subdirectories
            if (path.dirname(path.resolve(filePath)) !== path.resolve(folderPath)) {
                return;
            }

            // Check if file exists (rename event fires for both create and delete)
            if (!fs.existsSync(filePath)) return;

            // Check if it's a file (not a directory)
            try {
                const stats = fs.statSync(filePath);
                if (!stats.isFile()) return;
            } catch (err) {
                return;
            }

            // Wait for file write to stabilize (especially for large downloads/copies)
            let stable = false;
            let lastSize = -1;
            for (let attempts = 0; attempts < 10; attempts++) {
                await new Promise(resolve => setTimeout(resolve, 800));
                if (!fs.existsSync(filePath)) return;
                try {
                    const currentStats = fs.statSync(filePath);
                    if (currentStats.size > 0 && currentStats.size === lastSize) {
                        stable = true;
                        break;
                    }
                    lastSize = currentStats.size;
                } catch (e) {
                    // File might be locked
                }
            }
            if (!stable) return;

            // Organize the file
            try {
                if (!organizerHandler) {
                    organizerHandler = require('./converters/organizerHandler');
                }

                const result = await organizerHandler.organizeFile(filePath, folderPath);

                if (result.success) {
                    autoOrganizerSettings.filesOrganized++;
                    autoOrganizerSettings.lastAction = new Date().toISOString();
                    saveAutoOrganizerSettingsToFile();

                    // Notify renderer
                    if (mainWindow) {
                        mainWindow.webContents.send('auto-organize-file', {
                            success: true,
                            fileName: filename,
                            targetFolder: result.targetFolder
                        });
                    }

                    if (logHandler) {
                        logHandler.success('organizer', `Auto-organized: ${filename} → ${result.targetFolder}`);
                    }
                } else {
                    if (mainWindow) {
                        mainWindow.webContents.send('auto-organize-file', {
                            success: false,
                            fileName: filename,
                            error: result.error || 'Unknown error'
                        });
                    }
                }
            } catch (err) {
                console.error('Auto-organize error:', err);
                if (mainWindow) {
                    mainWindow.webContents.send('auto-organize-file', {
                        success: false,
                        fileName: filename,
                        error: err.message
                    });
                }
            }
        });

        console.log('Auto-organizer started watching:', folderPath);
        if (logHandler) {
            logHandler.info('organizer', `Auto-organizer started watching: ${folderPath}`);
        }
    } catch (err) {
        console.error('Failed to start auto-organizer:', err);
        if (logHandler) {
            logHandler.error('organizer', 'Failed to start auto-organizer', { error: err.message });
        }
    }
}

// IPC Handlers for Auto-Organizer
ipcMain.handle('start-auto-organizer', async (event, folderPath) => {
    startAutoOrganizer(folderPath);
    return true;
});

ipcMain.handle('stop-auto-organizer', async () => {
    stopAutoOrganizer();
    return true;
});

ipcMain.handle('get-auto-organizer-settings', async () => {
    return autoOrganizerSettings;
});

ipcMain.handle('save-auto-organizer-settings', async (event, settings) => {
    autoOrganizerSettings = { ...autoOrganizerSettings, ...settings };
    saveAutoOrganizerSettingsToFile();
    return true;
});

// Set launch at startup
ipcMain.handle('set-launch-at-startup', (event, enabled) => {
    try {
        const loginSettings = {
            openAtLogin: enabled,
            args: enabled ? ['--hidden'] : []
        };
        // For NSIS installed apps on Windows
        if (process.platform === 'win32') {
            loginSettings.path = app.getPath('exe');
            loginSettings.args = enabled ? ['--hidden'] : [];
        }
        app.setLoginItemSettings(loginSettings);
        settings.launchAtStartup = enabled;
        saveSettings();
        if (logHandler) logHandler.info('system', `Launch at startup ${enabled ? 'enabled' : 'disabled'}`);
        return true;
    } catch (err) {
        console.error('Failed to set startup:', err);
        if (logHandler) logHandler.error('system', 'Failed to set startup', { error: err.message });
        return false;
    }
});

ipcMain.handle('get-launch-at-startup', () => {
    try {
        // Must pass same path used in setLoginItemSettings for correct result on Windows
        const loginSettings = app.getLoginItemSettings({
            path: app.getPath('exe'),
            args: ['--hidden']
        });
        return loginSettings.openAtLogin;
    } catch (err) {
        // Fallback to saved settings value
        return settings.launchAtStartup || false;
    }
});

// Get sound file path
ipcMain.handle('get-sound-path', (event, soundType) => {
    let soundFile;
    if (soundType === 'success') {
        soundFile = 'succes sound.mp3';
    } else if (soundType === 'failed') {
        soundFile = 'failed.mp3';
    } else {
        return null;
    }

    // Try different paths for packaged vs dev
    const paths = [
        path.join(process.resourcesPath, soundFile),
        path.join(app.getAppPath(), soundFile),
        path.join(__dirname, soundFile)
    ];

    for (const p of paths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
});

// Get/set play sounds setting
ipcMain.handle('get-play-sounds', () => {
    return settings.playSounds !== false;
});

ipcMain.handle('set-play-sounds', (event, enabled) => {
    settings.playSounds = enabled;
    saveSettings();
    return true;
});

// =====================================================
// Video/Audio Downloader
// =====================================================

// Check if downloader is available
ipcMain.handle('check-downloader-available', async () => {
    try {
        if (!downloaderHandler) {
            downloaderHandler = require('./converters/downloaderHandler');
        }
        // Always try to initialize - it handles re-initialization internally
        const available = await downloaderHandler.initialize();
        console.log('check-downloader-available result:', available);
        return available;
    } catch (err) {
        console.error('Failed to initialize downloader:', err);
        if (logHandler) logHandler.error('download', 'Failed to check downloader availability', { error: err.message });
        return false;
    }
});

// Get video info from URL
ipcMain.handle('get-video-info', async (event, url) => {
    return withWindowActivity('ytdlp', async () => {
        if (logHandler) logHandler.info('download', `Fetching video info: ${url}`);

        if (!downloaderHandler) {
            // Try to initialize if not already done
            try {
                downloaderHandler = require('./converters/downloaderHandler');
                await downloaderHandler.initialize();
            } catch (err) {
                if (logHandler) logHandler.error('download', 'Failed to initialize downloader', { error: err.message });
                throw new Error('Failed to initialize downloader: ' + err.message);
            }
        }

        // Ensure yt-dlp is available
        if (!downloaderHandler.isAvailable()) {
            // Try to initialize again
            if (logHandler) logHandler.info('download', 'yt-dlp not available, attempting to download...');
            const available = await downloaderHandler.initialize();
            if (!available) {
                if (logHandler) logHandler.error('download', 'yt-dlp is not available');
                throw new Error('yt-dlp is not available. It will be downloaded automatically. Please try again in a moment.');
            }
        }

        try {
            const info = await downloaderHandler.getInfo(url);
            if (logHandler) logHandler.success('download', `Video info fetched: ${info.title}`, { uploader: info.uploader, duration: info.duration });
            return info;
        } catch (err) {
            if (logHandler) logHandler.error('download', `Failed to fetch video info: ${err.message}`, { url });
            throw err;
        }
    });
});

// Stream search - search YouTube for songs and return results

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
function runYtdlp(ytdlpPath, args, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        let output = '';
        let error = '';
        const proc = spawn(ytdlpPath, args);
        const timer = setTimeout(() => { proc.kill(); reject(new Error('yt-dlp timed out')); }, timeout);

        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { error += data.toString(); });

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (output.trim()) {
                try {
                    const results = output.trim().split('\n')
                        .filter(line => line.trim().startsWith('{'))
                        .map(line => {
                            const info = JSON.parse(line);
                            return {
                                id: info.id || info.url || '',
                                title: info.title || info.track || 'Unknown',
                                url: info.webpage_url || info.url || (info.id ? `https://www.youtube.com/watch?v=${info.id}` : ''),
                                thumbnail: info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : (info.thumbnail || null),
                                duration: info.duration || 0,
                                uploader: info.uploader || info.channel || info.artist || info.creator || 'Unknown',
                                view_count: info.view_count || 0,
                                artist: info.artist || info.creator || info.uploader || '',
                                album: info.album || ''
                            };
                        })
                        .filter(r => r.title !== '[Deleted video]' && r.title !== '[Private video]');
                    resolve(results);
                } catch (err) {
                    reject(new Error('Failed to parse yt-dlp output'));
                }
            } else {
                reject(new Error(error || 'No output from yt-dlp'));
            }
        });

        proc.on('error', (err) => reject(new Error(`Failed to run yt-dlp: ${err.message}`)));
    });
}

// Helper: ensure downloader is ready
async function ensureDownloader() {
    if (!downloaderHandler) {
        try {
            downloaderHandler = require('./converters/downloaderHandler');
            await downloaderHandler.initialize();
        } catch (err) {
            throw new Error('Failed to initialize downloader: ' + err.message);
        }
    }
    if (!downloaderHandler.isAvailable()) {
        await downloaderHandler.initialize();
        if (!downloaderHandler.isAvailable()) {
            throw new Error('yt-dlp is not available');
        }
    }
    return downloaderHandler.getYtdlpPath ? downloaderHandler.getYtdlpPath() : 'yt-dlp';
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

ipcMain.handle('stream-search', async (event, query) => {
    if (logHandler) logHandler.info('stream', `Searching: ${query}`);

    const ytdlpPath = await ensureDownloader();
    const detected = detectUrlType(query);
    const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass', '--no-check-certificates', '--force-ipv4'];

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

function buildYouTubeCompatExtractorArgs(value) {
    return isYouTubeLikeTarget(value)
        ? ['--extractor-args', 'youtube:player_client=android,web']
        : [];
}

function getYouTubeCompatFormatSelector(formatSelector) {
    if (formatSelector === 'bestaudio') {
        return 'bestaudio/best[acodec!=none]/best';
    }
    return formatSelector;
}

function resolveYtdlpStreamUrl(ytdlpPath, sourceUrl, formatSelector, extraArgs = []) {
    return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const args = [
            ...extraArgs,
            '-f', formatSelector,
            '-g',
            '--no-warnings',
            '--geo-bypass',
            '--no-check-certificates',
            '--force-ipv4',
            '--socket-timeout', '15',
            sourceUrl
        ];

        let output = '';
        let error = '';
        const proc = spawn(ytdlpPath, args);

        proc.stdout.on('data', (data) => { output += data.toString(); });
        proc.stderr.on('data', (data) => { error += data.toString(); });

        proc.on('close', (code) => {
            const lines = output
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            const realStreamUrl = lines.find((line) => /^https?:\/\//i.test(line)) || lines[0];

            if (code === 0 && realStreamUrl) {
                resolve(realStreamUrl);
            } else {
                reject(new Error((error || output || 'Failed to get stream URL').trim()));
            }
        });

        proc.on('error', (err) => reject(new Error(`Failed to run yt-dlp: ${err.message}`)));
    });
}

// Get direct stream URL for a video or audio stream
ipcMain.handle('get-stream-url', async (event, videoUrl, streamOptions = 'audio') => {
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
                const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass', '--no-check-certificates', '--force-ipv4'];
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
ipcMain.handle('import-playlist', async (event, playlistUrl) => {
    if (logHandler) logHandler.info('stream', `Importing playlist: ${playlistUrl}`);

    const ytdlpPath = await ensureDownloader();
    const detected = detectUrlType(playlistUrl);
    const baseArgs = ['--dump-json', '--no-download', '--no-warnings', '--geo-bypass', '--no-check-certificates', '--force-ipv4'];

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
ipcMain.handle('get-playlist-info', async (event, url) => {
    return withWindowActivity('ytdlp', async () => {
        if (logHandler) logHandler.info('download', `Fetching playlist info: ${url}`);

        if (!downloaderHandler) {
            try {
                downloaderHandler = require('./converters/downloaderHandler');
                await downloaderHandler.initialize();
            } catch (err) {
                if (logHandler) logHandler.error('download', 'Failed to initialize downloader', { error: err.message });
                throw new Error('Failed to initialize downloader: ' + err.message);
            }
        }

        if (!downloaderHandler.isAvailable()) {
            const available = await downloaderHandler.initialize();
            if (!available) {
                throw new Error('yt-dlp is not available. Please try again in a moment.');
            }
        }

        try {
            const info = await downloaderHandler.getPlaylistInfo(url);
            if (logHandler) logHandler.success('download', `Playlist info fetched: ${info.title}`, { count: info.count });
            return info;
        } catch (err) {
            if (logHandler) logHandler.error('download', `Failed to fetch playlist info: ${err.message}`, { url });
            throw err;
        }
    });
});

// Download media
ipcMain.handle('download-media', async (event, options) => {
    return withWindowActivity('ytdlp', async () => {
        if (logHandler) logHandler.info('download', `Starting download: ${options.url}`, { format: options.format, quality: options.quality });

        if (!downloaderHandler) {
            // Try to initialize if not already done
            try {
                downloaderHandler = require('./converters/downloaderHandler');
                await downloaderHandler.initialize();
            } catch (err) {
                if (logHandler) logHandler.error('download', 'Failed to initialize downloader', { error: err.message });
                throw new Error('Failed to initialize downloader: ' + err.message);
            }
        }

        // Ensure yt-dlp is available
        if (!downloaderHandler.isAvailable()) {
            const available = await downloaderHandler.initialize();
            if (!available) {
                if (logHandler) logHandler.error('download', 'yt-dlp is not available');
                throw new Error('yt-dlp is not available. Please try again in a moment.');
            }
        }

        const downloadOptions = {
            ...options,
            outputDirectory: options.outputDirectory || settings.outputDirectory,
            downloadSubtitles: options.downloadSubtitles || false,
            downloadThumbnail: options.downloadThumbnail || false,
            subtitleLanguage: options.subtitleLanguage || 'en'
        };

        try {
            const result = await downloaderHandler.download(downloadOptions, (progress) => {
                mainWindow.webContents.send('download-progress', progress);
            });
            if (logHandler) logHandler.success('download', `Download complete: ${result.outputPath}`, { outputSize: result.outputSize });
            return result;
        } catch (err) {
            if (logHandler) logHandler.error('download', `Download failed: ${err.message}`, { url: options.url });
            throw err;
        }
    });
});

// Cancel download
ipcMain.handle('cancel-download', () => {
    if (!downloaderHandler) return false;
    return downloaderHandler.cancelDownload();
});

// Clear temp files
ipcMain.handle('clear-temp-files', async () => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    try {
        const tempDir = os.tmpdir();
        const appTempDir = path.join(tempDir, 'Universal File Converter');
        const systemTemp = tempDir;

        let filesDeleted = 0;
        let freedSpace = 0;

        // Function to safely delete files in a directory
        const cleanDirectory = async (dir, pattern = null) => {
            try {
                if (!fs.existsSync(dir)) return;

                const items = fs.readdirSync(dir);
                for (const item of items) {
                    try {
                        const itemPath = path.join(dir, item);
                        const stats = fs.statSync(itemPath);

                        // Only delete files, not directories (for safety)
                        // And only files older than 1 hour
                        const ageMs = Date.now() - stats.mtimeMs;
                        const oneHour = 60 * 60 * 1000;

                        if (stats.isFile() && ageMs > oneHour) {
                            // Check if it matches our patterns
                            const shouldDelete = !pattern ||
                                item.includes('yt-dlp') ||
                                item.includes('ffmpeg') ||
                                item.includes('Universal') ||
                                item.endsWith('.part') ||
                                item.endsWith('.ytdl') ||
                                item.endsWith('.temp');

                            if (shouldDelete) {
                                freedSpace += stats.size;
                                fs.unlinkSync(itemPath);
                                filesDeleted++;
                            }
                        }
                    } catch (e) {
                        // Skip files we can't delete (in use, permissions, etc.)
                    }
                }
            } catch (e) {
                console.error('Error cleaning directory:', e);
            }
        };

        // Clean app-specific temp directory
        await cleanDirectory(appTempDir);

        // Clean yt-dlp temp files from system temp
        await cleanDirectory(systemTemp, true);

        if (logHandler) {
            logHandler.info('system', `Cleared ${filesDeleted} temp files, freed ${(freedSpace / 1024 / 1024).toFixed(2)} MB`);
        }

        return { success: true, count: filesDeleted, freedSpace };
    } catch (err) {
        console.error('Failed to clear temp files:', err);
        return { success: false, error: err.message };
    }
});

// =====================================================
// Spotify / SpotiFLAC Integration
// =====================================================

let spotifyHandler = null;

function getSpotifyHandler() {
    if (!spotifyHandler) {
        spotifyHandler = require('./converters/spotifyHandler');
    }
    return spotifyHandler;
}

ipcMain.handle('spotify-search', async (event, query, limit) => {
    try {
        const handler = getSpotifyHandler();
        const results = await handler.search(query, limit || 20);
        return JSON.parse(JSON.stringify(results));
    } catch (err) {
        console.error('Spotify search error:', err);
        throw new Error(err.message || String(err));
    }
});

ipcMain.handle('spotify-get-metadata', async (event, spotifyURL) => {
    try {
        const handler = getSpotifyHandler();
        const metadata = await handler.getMetadata(spotifyURL);
        return JSON.parse(JSON.stringify(metadata));
    } catch (err) {
        console.error('Spotify metadata error:', err);
        throw new Error(err.message || String(err));
    }
});

ipcMain.handle('spotify-check-availability', async (event, trackID) => {
    try {
        const handler = getSpotifyHandler();
        const availability = await handler.checkAvailability(trackID);
        return JSON.parse(JSON.stringify(availability));
    } catch (err) {
        console.error('Spotify availability check error:', err);
        throw new Error(err.message || String(err));
    }
});

ipcMain.handle('spotify-download', async (event, options) => {
    try {
        const handler = getSpotifyHandler();
        const result = await handler.downloadTrack(options, (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                try {
                    mainWindow.webContents.send('spotify-download-progress', {
                        phase: progress.phase || '',
                        percent: progress.percent || 0
                    });
                } catch (e) { }
            }
        });
        return { success: true, path: result.path, alreadyExists: !!result.alreadyExists };
    } catch (err) {
        console.error('Spotify download error:', err);
        return { success: false, error: (err && err.message) ? err.message : String(err) };
    }
});

ipcMain.handle('spotify-download-lyrics', async (event, options) => {
    try {
        const handler = getSpotifyHandler();
        const result = await handler.downloadLyrics(options);
        return result;
    } catch (err) {
        console.error('Spotify lyrics download error:', err);
        return { success: false, error: (err && err.message) ? err.message : String(err) };
    }
});

ipcMain.handle('spotify-save-cover', async (event, options) => {
    try {
        const { coverUrl, outputDir, fileName } = options;
        if (!coverUrl || !outputDir || !fileName) {
            return { success: false, error: 'Missing parameters' };
        }
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const coverPath = path.join(outputDir, fileName);

        const downloadWithRedirects = (targetUrl, redirectCount = 0) => {
            return new Promise((resolve, reject) => {
                if (redirectCount > 5) {
                    return reject(new Error('Too many redirects'));
                }
                const parsed = new URL(targetUrl);
                const transport = parsed.protocol === 'https:' ? https : http;

                transport.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        res.resume();
                        const nextUrl = new URL(res.headers.location, targetUrl).toString();
                        return resolve(downloadWithRedirects(nextUrl, redirectCount + 1));
                    }
                    if (res.statusCode !== 200) {
                        res.resume();
                        return reject(new Error(`Failed to download image: HTTP ${res.statusCode}`));
                    }
                    const file = fs.createWriteStream(coverPath);
                    res.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                    file.on('error', (err) => {
                        fs.unlink(coverPath, () => {});
                        reject(err);
                    });
                }).on('error', reject);
            });
        };

        await downloadWithRedirects(coverUrl);
        return { success: true, path: coverPath };
    } catch (err) {
        console.error('Spotify cover save error:', err);
        return { success: false, error: (err && err.message) ? err.message : String(err) };
    }
});

// =====================================================
// Conversion History (file-persisted)
// =====================================================

let HISTORY_FILE = null;
const MAX_HISTORY = 200;

function getHistoryFilePath() {
    if (!HISTORY_FILE) {
        HISTORY_FILE = path.join(app.getPath('userData'), 'conversion-history.json');
    }
    return HISTORY_FILE;
}

function loadConversionHistory() {
    try {
        const filePath = getHistoryFilePath();
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
    } catch (err) {
        console.error('Failed to load conversion history:', err);
    }
    return [];
}

function saveConversionHistory(history) {
    try {
        const filePath = getHistoryFilePath();
        if (history.length > MAX_HISTORY) {
            history = history.slice(0, MAX_HISTORY);
        }
        fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
    } catch (err) {
        console.error('Failed to save conversion history:', err);
    }
}

ipcMain.handle('get-conversion-history', () => {
    return loadConversionHistory();
});

ipcMain.handle('add-to-conversion-history', (event, item) => {
    const history = loadConversionHistory();
    history.unshift(item);
    saveConversionHistory(history);
    return true;
});

ipcMain.handle('clear-conversion-history', () => {
    saveConversionHistory([]);
    return true;
});

ipcMain.handle('get-conversion-stats', () => {
    const statsPath = path.join(app.getPath('userData'), 'conversion-stats.json');
    try {
        if (fs.existsSync(statsPath)) {
            return JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
        }
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
    return { totalConverted: 0, totalSavedBytes: 0, lastUpdated: null };
});

ipcMain.handle('save-conversion-stats', (event, stats) => {
    const statsPath = path.join(app.getPath('userData'), 'conversion-stats.json');
    try {
        fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
        return true;
    } catch (err) {
        console.error('Failed to save stats:', err);
        return false;
    }
});

// Get logs
ipcMain.handle('get-logs', (event, filter) => {
    if (!logHandler) return [];
    return logHandler.getLogs(filter || {});
});

// Add log entry (from renderer)
ipcMain.handle('add-log', (event, { type, category, message, details }) => {
    if (!logHandler) return null;
    return logHandler.log(type, category, message, details);
});

// Clear logs
ipcMain.handle('clear-logs', () => {
    if (!logHandler) return false;
    logHandler.clearLogs();
    return true;
});

// Export logs
ipcMain.handle('export-logs', async () => {
    if (!logHandler) return null;

    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Logs',
        defaultPath: 'app-logs.txt',
        filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        const success = logHandler.exportLogs(result.filePath);
        return success ? result.filePath : null;
    }
    return null;
});

// =====================================================
// Storage Analyzer
// =====================================================

// Get available drives
ipcMain.handle('get-available-drives', async () => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }
    return await storageHandler.getAvailableDrives();
});

// Analyze drive
ipcMain.handle('analyze-drive', async (event, drivePath) => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }

    if (logHandler) logHandler.info('storage', `Starting drive analysis: ${drivePath}`);

    try {
        const result = await storageHandler.analyzeDrive(drivePath, (progress) => {
            mainWindow.webContents.send('storage-scan-progress', progress);
        });

        if (logHandler) logHandler.success('storage', `Drive analysis complete: ${drivePath}`);
        return result;
    } catch (err) {
        if (logHandler) logHandler.error('storage', `Drive analysis failed: ${err.message}`);
        throw err;
    }
});

// Delete item (file or folder)
ipcMain.handle('delete-storage-item', async (event, itemPath, isDirectory) => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }

    if (logHandler) logHandler.info('storage', `Deleting: ${itemPath}`);

    const result = await storageHandler.deleteItem(itemPath, isDirectory);

    if (result.success) {
        if (logHandler) logHandler.success('storage', `Deleted: ${itemPath}`);
    } else {
        if (logHandler) logHandler.error('storage', `Failed to delete: ${itemPath}`, { error: result.error });
    }

    return result;
});

// Empty recycle bin
ipcMain.handle('empty-recycle-bin', async () => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }

    if (logHandler) logHandler.info('storage', 'Emptying recycle bin');
    const result = await storageHandler.emptyRecycleBin();

    if (result.success) {
        if (logHandler) logHandler.success('storage', 'Recycle bin emptied');
    }

    return result;
});

ipcMain.handle('get-recycle-bin-size', async () => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }
    return await storageHandler.getRecycleBinSize();
});

// Open in explorer
ipcMain.handle('open-in-explorer', (event, folderPath) => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }
    storageHandler.openInExplorer(folderPath);
});

// Browse folder
ipcMain.handle('browse-folder', async (event, folderPath) => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }
    return await storageHandler.browseFolder(folderPath);
});

// Move to recycle bin
ipcMain.handle('move-to-recycle-bin', async (event, itemPath) => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }

    if (logHandler) logHandler.info('storage', `Moving to recycle bin: ${itemPath}`);

    const result = await storageHandler.moveToRecycleBin(itemPath);

    if (result.success) {
        if (logHandler) logHandler.success('storage', `Moved to recycle bin: ${itemPath}`);
    } else {
        if (logHandler) logHandler.error('storage', `Failed to move to recycle bin: ${itemPath}`, { error: result.error });
    }

    return result;
});

// Search files
ipcMain.handle('search-files', async (event, folderPath, query) => {
    if (!storageHandler) {
        storageHandler = require('./converters/storageHandler');
    }
    return await storageHandler.searchFiles(folderPath, query);
});

// Get environment variable
ipcMain.handle('get-env-variable', (event, name) => {
    return process.env[name] || null;
});

// Get folder size
ipcMain.handle('get-folder-size', async (event, folderPath) => {
    return storageHandler.getFolderSize(folderPath);
});

// =====================================================
// AI Hub IPC Handlers
// =====================================================

// AI Chat
ipcMain.handle('ai-chat', async (event, message, systemPrompt = null, model = null) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
        await aiHandler.initialize();
    }
    // Always ensure API key is set
    if (settings.geminiApiKey && !aiHandler.hasApiKey()) {
        aiHandler.setApiKey(settings.geminiApiKey);
    }
    return await aiHandler.chat(message, systemPrompt, model || settings.geminiModel || null);
});

// Clear AI Chat
ipcMain.handle('ai-clear-chat', () => {
    if (!aiHandler) return true;
    return aiHandler.clearChat();
});

// AI Summarize
ipcMain.handle('ai-summarize', async (event, text, maxLength = 150) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return await aiHandler.summarize(text, maxLength);
});

// AI Translate
ipcMain.handle('ai-translate', async (event, text, sourceLang, targetLang) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return await aiHandler.translate(text, sourceLang, targetLang);
});

// AI Sentiment Analysis
ipcMain.handle('ai-sentiment', async (event, text) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return await aiHandler.analyzeSentiment(text);
});

// AI Question Answering
ipcMain.handle('ai-question-answer', async (event, question, context) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return await aiHandler.answerQuestion(question, context);
});

// AI Image Generation
ipcMain.handle('ai-generate-image', async (event, prompt, options = {}) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    if (logHandler) logHandler.info('ai', 'Generating image', { prompt: prompt.substring(0, 50) });
    const result = await aiHandler.generateImage(prompt, options);
    if (result.success && logHandler) {
        logHandler.success('ai', 'Image generated successfully');
    }
    return result;
});

// AI Describe Image
ipcMain.handle('ai-describe-image', async (event, imagePath) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return await aiHandler.describeImage(imagePath);
});

// AI Remove Background
ipcMain.handle('ai-remove-background', async (event, imagePath) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    if (logHandler) logHandler.info('ai', 'Removing background', { file: imagePath });
    const result = await aiHandler.removeBackground(imagePath);
    if (result.success && logHandler) {
        logHandler.success('ai', 'Background removed successfully');
    }
    return result;
});

// AI Upscale Image
ipcMain.handle('ai-upscale-image', async (event, imagePath) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    if (logHandler) logHandler.info('ai', 'Upscaling image', { file: imagePath });
    const result = await aiHandler.upscaleImage(imagePath);
    if (result.success && logHandler) {
        logHandler.success('ai', 'Image upscaled successfully');
    }
    return result;
});

// AI Creative Writing
ipcMain.handle('ai-creative-write', async (event, prompt, type, length) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return await aiHandler.generateCreativeText(prompt, type, length);
});

// AI Improve Text
ipcMain.handle('ai-improve-text', async (event, text, style) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return await aiHandler.improveText(text, style);
});

// AI Transcribe Audio
ipcMain.handle('ai-transcribe', async (event, audioPath) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    if (logHandler) logHandler.info('ai', 'Transcribing audio', { file: audioPath });
    const result = await aiHandler.transcribeAudio(audioPath);
    if (result.success && logHandler) {
        logHandler.success('ai', 'Audio transcribed successfully');
    }
    return result;
});

// Get AI Capabilities
ipcMain.handle('ai-get-capabilities', () => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return aiHandler.getCapabilities();
});

// Save AI API Keys (optional enhancement)
ipcMain.handle('ai-save-keys', (event, keys) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    return aiHandler.saveApiKeys(keys);
});

// Set Gemini API Key
ipcMain.handle('ai-set-gemini-key', (event, key) => {
    if (!aiHandler) {
        aiHandler = require('./converters/aiHandler');
    }
    aiHandler.setApiKey(key);
    settings.geminiApiKey = key;
    saveSettings();
    return { success: true };
});

// Check if AI key is set
ipcMain.handle('ai-has-key', () => {
    if (!aiHandler) return false;
    return aiHandler.hasApiKey();
});

// =====================================================
// Remote Alert System (no app update needed)
// =====================================================

const ALERTS_URLS = [
    'https://raw.githubusercontent.com/Hasan580/universial-file-converter/main/alerts.json',
    'https://cdn.jsdelivr.net/gh/Hasan580/universial-file-converter@main/alerts.json',
    'https://raw.githubusercontent.com/Hasan580/universal-file-converter/main/alerts.json'
];

function fetchAlertsFromUrl(url, redirectDepth = 0) {
    return new Promise((resolve) => {
        const req = https.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': `Universal-File-Converter/${app.getVersion()}`,
                Accept: 'application/json,text/plain,*/*'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectDepth < 3) {
                res.resume();
                fetchAlertsFromUrl(res.headers.location, redirectDepth + 1).then(resolve);
                return;
            }

            if (res.statusCode !== 200) {
                res.resume();
                resolve([]);
                return;
            }

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed || typeof parsed !== 'object') {
                        resolve([]);
                        return;
                    }
                    if (Array.isArray(parsed.alerts)) {
                        resolve(parsed.alerts);
                        return;
                    }
                    resolve([]);
                } catch {
                    resolve([]);
                }
            });
        });

        req.on('error', () => resolve([]));
        req.on('timeout', () => { req.destroy(); resolve([]); });
    });
}

function fetchRemoteAlerts() {
    return new Promise(async (resolve) => {
        for (const url of ALERTS_URLS) {
            const alerts = await fetchAlertsFromUrl(url);
            if (Array.isArray(alerts) && alerts.length > 0) {
                resolve(alerts);
                return;
            }
        }
        resolve([]);
    });
}

ipcMain.handle('get-remote-alerts', async () => {
    return fetchRemoteAlerts();
});

// =====================================================
// Player Lyrics (.lrc) File Handling
// =====================================================

ipcMain.handle('select-lrc-file', async () => {
    if (!mainWindow) return null;
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Lyrics File',
        filters: [
            { name: 'LRC Lyrics', extensions: ['lrc'] },
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    try {
        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        return { path: result.filePaths[0], content };
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle('read-lrc-file', async (event, filePath) => {
    try {
        if (!fs.existsSync(filePath)) return { error: 'File not found' };
        const content = fs.readFileSync(filePath, 'utf-8');
        return { path: filePath, content };
    } catch (err) {
        return { error: err.message };
    }
});

// =====================================================
// IDM-Style Download Manager + Bridge Server
// =====================================================

const { DownloadManagerEngine } = require('./converters/downloadManagerEngine');

let dmEngine = null;
let dmBridgeServer = null;
const DM_BRIDGE_PORT = 38945;

// Auto-arrange mappings: file extension → subfolder name
const DM_AUTO_ARRANGE_MAP = {
    // Programs
    '.exe': 'Programs', '.msi': 'Programs', '.deb': 'Programs', '.rpm': 'Programs',
    '.appimage': 'Programs', '.apk': 'Programs', '.dmg': 'Programs', '.pkg': 'Programs',
    // Documents
    '.pdf': 'Documents', '.doc': 'Documents', '.docx': 'Documents', '.xls': 'Documents',
    '.xlsx': 'Documents', '.ppt': 'Documents', '.pptx': 'Documents', '.odt': 'Documents',
    '.ods': 'Documents', '.odp': 'Documents', '.rtf': 'Documents', '.txt': 'Documents',
    '.epub': 'Documents', '.mobi': 'Documents', '.csv': 'Documents',
    // Videos
    '.mp4': 'Videos', '.m4v': 'Videos', '.mkv': 'Videos', '.webm': 'Videos',
    '.mov': 'Videos', '.avi': 'Videos', '.flv': 'Videos', '.wmv': 'Videos',
    '.ts': 'Videos', '.3gp': 'Videos',
    // Music
    '.mp3': 'Music', '.m4a': 'Music', '.aac': 'Music', '.flac': 'Music',
    '.ogg': 'Music', '.wav': 'Music', '.opus': 'Music', '.wma': 'Music', '.alac': 'Music',
    // Images
    '.jpg': 'Images', '.jpeg': 'Images', '.png': 'Images', '.gif': 'Images',
    '.bmp': 'Images', '.webp': 'Images', '.svg': 'Images', '.ico': 'Images',
    '.tif': 'Images', '.tiff': 'Images', '.psd': 'Images', '.raw': 'Images',
    '.cr2': 'Images', '.nef': 'Images', '.heic': 'Images',
    // Archives
    '.zip': 'Archives', '.rar': 'Archives', '.7z': 'Archives', '.tar': 'Archives',
    '.gz': 'Archives', '.bz2': 'Archives', '.xz': 'Archives', '.iso': 'Archives',
    // Torrents
    '.torrent': 'Torrents'
};

// Track which tasks we've already arranged
const dmArrangedTasks = new Set();

function getAutoArrangeFolder(fileName) {
    const ext = path.extname(fileName || '').toLowerCase();
    return DM_AUTO_ARRANGE_MAP[ext] || null;
}

async function autoArrangeFile(task) {
    if (!task || !task.fileName || !task.outputPath) return;
    if (dmArrangedTasks.has(task.id)) return;

    const subfolder = getAutoArrangeFolder(task.fileName);
    if (!subfolder) return;

    const sourceFile = task.outputPath;
    if (!fs.existsSync(sourceFile)) return;

    const baseDir = task.outputDir || path.dirname(sourceFile);
    const destDir = path.join(baseDir, subfolder);

    try {
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        let destFile = path.join(destDir, task.fileName);
        // Handle name collisions
        let counter = 1;
        const baseName = path.basename(task.fileName, path.extname(task.fileName));
        const extName = path.extname(task.fileName);
        while (fs.existsSync(destFile)) {
            destFile = path.join(destDir, `${baseName} (${counter})${extName}`);
            counter++;
        }

        fs.renameSync(sourceFile, destFile);
        dmArrangedTasks.add(task.id);

        // Update the engine's internal task paths so open-file/open-folder works
        if (dmEngine) {
            dmEngine.updateTaskPath(task.id, destFile, destDir);
        }
        task.outputPath = destFile;
        task.outputDir = destDir;

        if (logHandler) logHandler.info('download', `Auto-arranged: ${task.fileName} → ${subfolder}/`, { from: sourceFile, to: destFile });
    } catch (err) {
        if (logHandler) logHandler.error('download', `Auto-arrange failed: ${err.message}`, { file: task.fileName });
    }
}

function initDownloadManager() {
    const defaultDir = settings.outputDirectory || path.join(app.getPath('downloads'), 'UniversalConverter');
    dmEngine = new DownloadManagerEngine({
        defaultOutputDir: defaultDir,
        maxConcurrent: 2
    });

    dmEngine.on('state', (state) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('dm-state', state);
        }

        // Auto-arrange completed downloads
        if (settings.dmAutoArrange !== false) {
            for (const task of state.tasks) {
                if (task.status === 'completed' && !dmArrangedTasks.has(task.id)) {
                    autoArrangeFile(task).then(() => {
                        // Re-emit state after file move so UI gets updated paths
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('dm-state', dmEngine.getState());
                        }
                    });
                }
            }
        }
    });

    startBridgeServer();
}

function startBridgeServer() {
    if (dmBridgeServer) return;

    dmBridgeServer = http.createServer((req, res) => {
        // CORS headers for browser extension
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Download-Bridge-Token');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, app: 'UniversalConverter', version: app.getVersion() }));
            return;
        }

        if (req.method === 'POST' && req.url === '/capture') {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);

                    if (!data.url) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'URL is required' }));
                        return;
                    }

                    // Add task to download engine
                    const task = dmEngine.addTask({
                        url: data.url,
                        fileName: data.fileName || '',
                        source: data.source || 'browser-extension',
                        headers: data.referrer ? { Referer: data.referrer } : {}
                    });

                    // Focus app and nav to downloads tab
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        if (mainWindow.isMinimized()) mainWindow.restore();
                        mainWindow.focus();
                        mainWindow.webContents.send('navigate', 'downloads');
                    }

                    // Show system notification
                    try {
                        new Notification({
                            title: 'Download Captured',
                            body: `${task.fileName} added to queue`
                        }).show();
                    } catch (_) {}

                    if (logHandler) logHandler.info('download', `Bridge captured: ${task.fileName}`, { url: data.url });

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, taskId: task.id }));
                } catch (err) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: err.message }));
                }
            });
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });

    dmBridgeServer.listen(DM_BRIDGE_PORT, '127.0.0.1', () => {
        console.log(`Download bridge server running on http://127.0.0.1:${DM_BRIDGE_PORT}`);
        if (logHandler) logHandler.info('system', `Download bridge started on port ${DM_BRIDGE_PORT}`);
    });

    dmBridgeServer.on('error', (err) => {
        console.error('Bridge server error:', err.message);
        dmBridgeServer = null;
    });
}

// DM IPC Handlers
ipcMain.handle('dm-get-state', () => {
    if (!dmEngine) return { tasks: [], defaultOutputDir: '', maxConcurrent: 2, queueCount: 0, activeCount: 0 };
    return dmEngine.getState();
});

ipcMain.handle('dm-add-task', (event, options) => {
    if (!dmEngine) throw new Error('Download manager not initialized');
    return dmEngine.addTask(options);
});

ipcMain.handle('dm-pause-task', (event, taskId) => {
    return dmEngine ? dmEngine.pauseTask(taskId) : false;
});

ipcMain.handle('dm-resume-task', (event, taskId) => {
    return dmEngine ? dmEngine.resumeTask(taskId) : false;
});

ipcMain.handle('dm-cancel-task', (event, taskId) => {
    return dmEngine ? dmEngine.cancelTask(taskId) : false;
});

ipcMain.handle('dm-retry-task', (event, taskId) => {
    return dmEngine ? dmEngine.retryTask(taskId) : false;
});

ipcMain.handle('dm-delete-task', (event, taskId, deleteFile) => {
    return dmEngine ? dmEngine.deleteTask(taskId, { deleteFile }) : false;
});

ipcMain.handle('dm-pause-all', () => {
    return dmEngine ? dmEngine.pauseAll() : 0;
});

ipcMain.handle('dm-resume-all', () => {
    return dmEngine ? dmEngine.resumeAll() : 0;
});

ipcMain.handle('dm-clear-finished', (event, deleteFile) => {
    return dmEngine ? dmEngine.clearFinished({ deleteFile }) : 0;
});

ipcMain.handle('dm-set-output-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Download Directory'
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const dir = result.filePaths[0];
    if (dmEngine) dmEngine.setDefaultOutputDir(dir);
    return dir;
});

ipcMain.handle('dm-set-max-concurrent', (event, value) => {
    return dmEngine ? dmEngine.setMaxConcurrent(value) : 2;
});

ipcMain.handle('dm-get-bridge-info', () => {
    return {
        port: DM_BRIDGE_PORT,
        running: !!dmBridgeServer
    };
});

ipcMain.handle('dm-open-file', (event, filePath) => {
    if (!filePath) return { ok: false, error: 'No file path' };
    if (!fs.existsSync(filePath)) return { ok: false, error: 'File not found', path: filePath };
    shell.openPath(filePath);
    return { ok: true };
});

ipcMain.handle('dm-open-folder', (event, filePath) => {
    if (!filePath) return { ok: false, error: 'No file path' };
    if (!fs.existsSync(filePath)) {
        // Try opening the parent folder if the file was deleted
        const dir = path.dirname(filePath);
        if (fs.existsSync(dir)) {
            shell.openPath(dir);
            return { ok: true, fallback: true };
        }
        return { ok: false, error: 'File and folder not found', path: filePath };
    }
    shell.showItemInFolder(filePath);
    return { ok: true };
});

ipcMain.handle('dm-reorder-task', (event, taskId, direction) => {
    return dmEngine ? dmEngine.reorderQueuedTask(taskId, direction) : false;
});

ipcMain.handle('dm-get-auto-arrange', () => {
    return settings.dmAutoArrange !== false; // default on
});

ipcMain.handle('dm-set-auto-arrange', (event, enabled) => {
    settings.dmAutoArrange = !!enabled;
    saveSettings();
    return settings.dmAutoArrange;
});

// List converted/downloaded files from output directory
ipcMain.handle('list-output-files', async (event, section) => {
    const outputDir = settings.outputDirectory;
    if (!outputDir || !fs.existsSync(outputDir)) return { success: true, files: [] };

    try {
        const files = fs.readdirSync(outputDir)
            .map(name => {
                const filePath = path.join(outputDir, name);
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.isDirectory()) return null;
                    const ext = path.extname(name).toLowerCase().slice(1);
                    return {
                        name,
                        path: filePath,
                        size: stats.size,
                        extension: ext,
                        type: getFileType(ext),
                        modifiedTime: stats.mtime.toISOString()
                    };
                } catch (e) { return null; }
            })
            .filter(f => f !== null);

        // Filter by section if provided
        const filtered = section && section !== 'all'
            ? files.filter(f => f.type === section)
            : files;

        // Sort by modified time, newest first
        filtered.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));

        return { success: true, files: filtered };
    } catch (err) {
        return { success: false, error: err.message, files: [] };
    }
});
