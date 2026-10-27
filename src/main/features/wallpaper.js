'use strict';

/**
 * Live wallpaper (Windows only): a borderless video window parented behind the desktop icons.
 * Never started at launch unless the user enabled it, and always after the main window is up.
 */

const { BrowserWindow, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { handle } = require('../ipc/handle');
const ctx = require('../ctx');
const settingsStore = require('../settings');

const normalizeLiveWallpaperSettings = settingsStore.normalizeLiveWallpaper;
const LIVE_WALLPAPER_SUPPORTED = process.platform === 'win32';
const LIVE_WALLPAPER_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);
const isSupportedLiveWallpaperFile = (filePath) => LIVE_WALLPAPER_VIDEO_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());

let liveWallpaperWindow = null;
let liveWallpaperAttachInProgress = false;
let liveWallpaperAttachDetail = '';
let liveWallpaperStatus = { running: false, attached: false, lastError: '', currentFile: '' };
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
    const windowRunning = !!(liveWallpaperWindow && !liveWallpaperWindow.isDestroyed());
    return {
        supported: LIVE_WALLPAPER_SUPPORTED,
        running: windowRunning,
        attached: liveWallpaperStatus.attached,
        lastError: liveWallpaperStatus.lastError || '',
        settings: normalizeLiveWallpaperSettings({
            ...settingsStore.get().liveWallpaper,
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
    await thisWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'wallpaper.html'), {
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


function register() {
    handle('live-wallpaper-select-video', async () => {
        const result = await dialog.showOpenDialog(ctx.getWindow(), {
            properties: ['openFile'],
            title: 'Select video wallpaper',
            filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'] }, { name: 'All files', extensions: ['*'] }]
        });
        return result.canceled ? null : result.filePaths[0] || null;
    });
    handle('live-wallpaper-start', async (rawOptions) => {
        try {
            const options = normalizeLiveWallpaperSettings(rawOptions || {});
            const status = await startLiveWallpaperWindow(options);
            settingsStore.update({ liveWallpaper: { ...options, enabled: true } });
            return status;
        } catch (err) {
            liveWallpaperStatus.lastError = String((err && err.message) || err || 'Unknown error');
            throw err;
        }
    });
    handle('live-wallpaper-stop', async () => {
        stopLiveWallpaperWindow();
        settingsStore.update({ liveWallpaper: { ...settingsStore.get().liveWallpaper, enabled: false } });
        return getLiveWallpaperStatusPayload();
    });
    handle('live-wallpaper-status', async () => getLiveWallpaperStatusPayload());

    screen.on('display-metrics-changed', () => updateLiveWallpaperBounds());
    screen.on('display-added', () => updateLiveWallpaperBounds());
    screen.on('display-removed', () => updateLiveWallpaperBounds());
}

/** Resume the wallpaper after launch if it was enabled last time. */
async function restore() {
    const wp = settingsStore.get().liveWallpaper;
    if (!LIVE_WALLPAPER_SUPPORTED || !wp.enabled || !wp.filePath) return;
    try { await startLiveWallpaperWindow(wp); } catch (err) {
        settingsStore.update({ liveWallpaper: { ...wp, enabled: false } });
        console.error('Could not restore live wallpaper:', err.message);
    }
}

module.exports = { register, restore, stop: stopLiveWallpaperWindow };
