'use strict';

/**
 * Optional Widevine support for the Spotify web player (Windows only). It borrows the CDM from an
 * installed Chrome or Edge. Everything is guarded: if anything is missing or unreadable the app simply
 * starts without it, and it can be switched off with the `enableWidevine` setting.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

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



/** Must run before `app.whenReady`. Never throws. */
function configure(enabled) {
    if (enabled === false) return null;
    try {
        const info = findInstalledWidevineCdm();
        if (info) {
            app.commandLine.appendSwitch('widevine-cdm-path', info.dllPath);
            app.commandLine.appendSwitch('widevine-cdm-version', info.version);
        }
        return info;
    } catch (_) {
        return null;
    }
}

module.exports = { configure };
