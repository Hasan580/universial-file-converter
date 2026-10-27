'use strict';

/**
 * Runs after electron-builder has laid out the app and before it is compressed into an installer.
 * Removes files this app never uses, to keep the download and the install small.
 */

const fs = require('fs');
const path = require('path');

// Chromium loads these only for WebGPU/Direct3D 12 shader compilation. The interface uses neither.
const WINDOWS_UNUSED = ['dxcompiler.dll', 'dxil.dll'];

exports.default = async function afterPack(context) {
    const dir = context.appOutDir;
    let freed = 0;
    if (context.electronPlatformName === 'win32') {
        for (const name of WINDOWS_UNUSED) {
            const file = path.join(dir, name);
            if (fs.existsSync(file)) { freed += fs.statSync(file).size; fs.unlinkSync(file); }
        }
    }
    if (freed) console.log(`  • after-pack: removed ${(freed / 1048576).toFixed(1)} MB of unused Chromium files`);
};
