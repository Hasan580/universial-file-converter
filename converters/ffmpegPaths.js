/**
 * FFmpeg Path Utility
 * Resolves FFmpeg paths correctly for both development and packaged Electron apps
 */

const path = require('path');
const fs = require('fs');
const libraryManager = require('./libraryManager');

// Try to get electron app - may not be available in all contexts
let app;
try {
    app = require('electron').app;
} catch (e) {
    app = null;
}

// Check if we're in a packaged app
const isPackaged = app ? app.isPackaged : false;

/**
 * Get the correct FFmpeg path
 */
function getFfmpegPath() {
    const managedPath = libraryManager.getManagedFfmpegPath();
    if (fs.existsSync(managedPath)) {
        console.log('Found managed FFmpeg at:', managedPath);
        return managedPath;
    }

    // In development, use the npm package paths
    if (!isPackaged) {
        try {
            const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
            if (fs.existsSync(ffmpegPath)) {
                console.log('Found FFmpeg at (dev):', ffmpegPath);
                return ffmpegPath;
            }
        } catch (e) {
            console.error('FFmpeg installer not found:', e);
        }
    }

    // In production, check common locations
    const resourcesPath = process.resourcesPath || (app ? path.dirname(app.getAppPath()) : __dirname);
    
    const possiblePaths = [
        // New extraResources location
        path.join(resourcesPath, 'ffmpeg', 'ffmpeg.exe'),
        // Bundled in resources
        path.join(resourcesPath, 'ffmpeg', 'ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'),
        path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe'),
        // App directory
        app ? path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe') : null,
        // Fallback to node_modules
        path.join(__dirname, '..', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe')
    ].filter(Boolean);

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            console.log('Found FFmpeg at:', p);
            return p;
        }
    }

    // Last resort: try the npm package
    try {
        return require('@ffmpeg-installer/ffmpeg').path;
    } catch (e) {
        console.error('Could not find FFmpeg');
        return 'ffmpeg'; // Hope it's in PATH
    }
}

/**
 * Get the correct FFprobe path
 */
function getFfprobePath() {
    const managedPath = libraryManager.getManagedFfprobePath();
    if (fs.existsSync(managedPath)) {
        console.log('Found managed FFprobe at:', managedPath);
        return managedPath;
    }

    // In development, use the npm package paths
    if (!isPackaged) {
        try {
            const ffprobePath = require('@ffprobe-installer/ffprobe').path;
            if (fs.existsSync(ffprobePath)) {
                console.log('Found FFprobe at (dev):', ffprobePath);
                return ffprobePath;
            }
        } catch (e) {
            console.error('FFprobe installer not found:', e);
        }
    }

    // In production, check common locations
    const resourcesPath = process.resourcesPath || (app ? path.dirname(app.getAppPath()) : __dirname);
    
    const possiblePaths = [
        // New extraResources location
        path.join(resourcesPath, 'ffprobe', 'ffprobe.exe'),
        // Bundled in resources
        path.join(resourcesPath, 'ffmpeg', 'ffprobe-installer', 'win32-x64', 'ffprobe.exe'),
        path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe'),
        // App directory
        app ? path.join(app.getAppPath(), '..', 'app.asar.unpacked', 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe') : null,
        // Fallback to node_modules
        path.join(__dirname, '..', 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe')
    ].filter(Boolean);

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            console.log('Found FFprobe at:', p);
            return p;
        }
    }

    // Last resort: try the npm package
    try {
        return require('@ffprobe-installer/ffprobe').path;
    } catch (e) {
        console.error('Could not find FFprobe');
        return 'ffprobe'; // Hope it's in PATH
    }
}

module.exports = {
    getFfmpegPath,
    getFfprobePath,
    isPackaged,
    updateFfmpeg: libraryManager.updateFfmpeg,
    getManagedFfmpegPath: libraryManager.getManagedFfmpegPath,
    getManagedFfprobePath: libraryManager.getManagedFfprobePath
};
