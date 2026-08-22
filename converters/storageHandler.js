/**
 * Storage Analyzer Handler - Fast & Non-blocking
 * Scans drives and analyzes disk space usage with real-time progress
 */

const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');

// Cache for folder sizes
const sizeCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

function runPowerShell(script, options = {}) {
    return new Promise((resolve, reject) => {
        execFile('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command',
            script
        ], {
            windowsHide: true,
            maxBuffer: options.maxBuffer || 1024 * 1024,
            timeout: options.timeout || 60000
        }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(String(stdout || ''));
        });
    });
}

/**
 * Get list of available drives on Windows
 */
async function getAvailableDrives() {
    try {
        const psCommand = `Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 -or $_.DriveType -eq 2 } | Select-Object DeviceID, DriveType, Size, FreeSpace | ConvertTo-Json`;
        const stdout = await runPowerShell(psCommand);
        let data = JSON.parse(stdout);
        if (!Array.isArray(data)) data = [data];

        const drives = data
            .filter(d => d && d.Size > 0)
            .map(d => ({
                letter: d.DeviceID,
                name: d.DeviceID,
                root: d.DeviceID + '\\',
                path: d.DeviceID + '\\',
                totalSize: parseInt(d.Size) || 0,
                freeSpace: parseInt(d.FreeSpace) || 0,
                usedSpace: (parseInt(d.Size) || 0) - (parseInt(d.FreeSpace) || 0),
                usedPercent: Math.round((((parseInt(d.Size) || 0) - (parseInt(d.FreeSpace) || 0)) / (parseInt(d.Size) || 1)) * 100)
            }));

        console.log('Found drives:', drives);
        return drives;
    } catch (error) {
        console.error('Failed to parse drive info:', error);
        return [];
    }
}

/**
 * Fast folder size calculation using PowerShell (non-blocking)
 */
async function getFolderSizeFast(folderPath) {
    // Check cache first
    const cached = sizeCache.get(folderPath);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.data;
    }

    try {
        const escaped = folderPath.replace(/'/g, "''");
        const psCommand = `(Get-ChildItem -LiteralPath '${escaped}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`;
        const stdout = await runPowerShell(psCommand, { timeout: 30000 });
        const size = parseInt(stdout.trim()) || 0;
        const result = { size, isAccessible: true };
        
        sizeCache.set(folderPath, { data: result, time: Date.now() });
        return result;
    } catch (_) {
        const result = { size: 0, isAccessible: false };
        return result;
    }
}

/**
 * Get folder size (public API)
 */
async function getFolderSize(folderPath) {
    try {
        const result = await getFolderSizeFast(folderPath);
        return result.size || 0;
    } catch {
        return 0;
    }
}

/**
 * Get immediate children of a folder (fast, single level)
 */
async function getFolderContents(folderPath) {
    return new Promise((resolve) => {
        try {
            const items = fs.readdirSync(folderPath, { withFileTypes: true });
            const results = [];

            for (const item of items) {
                try {
                    const itemPath = path.join(folderPath, item.name);
                    const isDirectory = item.isDirectory();
                    
                    let size = 0;
                    let modified = null;
                    
                    if (!isDirectory) {
                        try {
                            const stats = fs.statSync(itemPath);
                            size = stats.size;
                            modified = stats.mtime;
                        } catch (e) {}
                    }

                    results.push({
                        name: item.name,
                        path: itemPath,
                        isDirectory,
                        size,
                        modified,
                        extension: isDirectory ? null : path.extname(item.name).toLowerCase()
                    });
                } catch (e) {}
            }

            results.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return b.isDirectory ? 1 : -1;
                return a.name.localeCompare(b.name);
            });

            resolve({ items: results, error: null });
        } catch (error) {
            resolve({ items: [], error: error.message });
        }
    });
}

/**
 * Browse folder - returns contents with sizes
 */
async function browseFolder(folderPath) {
    const result = await getFolderContents(folderPath);
    
    if (result.error) return result;

    const folderItems = result.items.filter(i => i.isDirectory);
    
    const sizePromises = folderItems.slice(0, 30).map(async (item) => {
        try {
            const contents = fs.readdirSync(item.path, { withFileTypes: true });
            item.itemCount = contents.length;
            
            if (contents.length < 50) {
                let totalSize = 0;
                for (const child of contents) {
                    if (child.isFile()) {
                        try {
                            const stats = fs.statSync(path.join(item.path, child.name));
                            totalSize += stats.size;
                        } catch (e) {}
                    }
                }
                item.size = totalSize;
            }
        } catch (e) {
            item.itemCount = 0;
            item.isAccessible = false;
        }
    });

    await Promise.all(sizePromises);
    return result;
}

/**
 * Fast drive analysis with progress updates - FULL SCAN
 */
async function analyzeDrive(drivePath, progressCallback) {
    const analysis = {
        drivePath,
        scanTime: new Date().toISOString(),
        totalSize: 0,
        freeSpace: 0,
        categories: {
            documents: { size: 0, count: 0, extensions: ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.rtf', '.csv'] },
            images: { size: 0, count: 0, extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.raw', '.tiff', '.psd', '.ai'] },
            videos: { size: 0, count: 0, extensions: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg', '.ts', '.vob'] },
            audio: { size: 0, count: 0, extensions: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus', '.alac'] },
            archives: { size: 0, count: 0, extensions: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'] },
            applications: { size: 0, count: 0, extensions: ['.exe', '.msi', '.dll', '.app', '.dmg', '.apk'] },
            other: { size: 0, count: 0, extensions: [] }
        },
        largestFolders: [],
        largestFiles: [],
        tempFiles: []
    };

    try {
        const drives = await getAvailableDrives();
        const drive = drives.find(d => d.letter === drivePath.charAt(0).toUpperCase() + ':');
        if (drive) {
            analysis.totalSize = drive.totalSize;
            analysis.freeSpace = drive.freeSpace;
        }
    } catch (e) {}

    if (progressCallback) progressCallback({ status: 'starting', message: 'Starting full disk scan...', percent: 2 });

    // Get ALL top-level folders
    const rootPath = drivePath.endsWith('\\') ? drivePath : drivePath + '\\';
    let allFolders = [];
    
    try {
        const rootItems = fs.readdirSync(rootPath, { withFileTypes: true });
        allFolders = rootItems
            .filter(item => item.isDirectory() && !item.name.startsWith('$') && item.name !== 'System Volume Information')
            .map(item => ({
                path: path.join(rootPath, item.name),
                name: item.name
            }));
    } catch (e) {
        console.error('Failed to read root:', e.message);
    }

    if (progressCallback) progressCallback({ status: 'scanning', message: `Found ${allFolders.length} folders to scan...`, percent: 5 });

    // Scan each folder for size using PowerShell (fast parallel batch)
    const folderSizes = [];
    const batchSize = 5;
    
    for (let i = 0; i < allFolders.length; i += batchSize) {
        const batch = allFolders.slice(i, i + batchSize);
        const percent = Math.round(5 + (i / allFolders.length) * 50);
        
        if (progressCallback) {
            progressCallback({ 
                status: 'scanning', 
                message: `Scanning: ${batch.map(f => f.name).join(', ')}...`,
                percent
            });
        }

        const promises = batch.map(async (folder) => {
            try {
                const sizeResult = await getFolderSizeFast(folder.path);
                return {
                    path: folder.path,
                    name: folder.name,
                    size: sizeResult.size || 0,
                    isAccessible: sizeResult.isAccessible
                };
            } catch (e) {
                return { path: folder.path, name: folder.name, size: 0, isAccessible: false };
            }
        });

        const results = await Promise.all(promises);
        folderSizes.push(...results);
    }

    // Sort by size and get top 30 largest
    analysis.largestFolders = folderSizes
        .filter(f => f.size > 0)
        .sort((a, b) => b.size - a.size)
        .slice(0, 30);

    if (progressCallback) progressCallback({ status: 'scanning', message: 'Scanning user folders for files...', percent: 60 });

    // Deep scan user folders for file categorization and large files
    const userName = process.env.USERNAME || process.env.USER;
    const userFolder = path.join(rootPath, 'Users', userName);
    
    if (fs.existsSync(userFolder)) {
        const userFolders = ['Downloads', 'Documents', 'Desktop', 'Videos', 'Pictures', 'Music'];
        
        for (let i = 0; i < userFolders.length; i++) {
            const folderName = userFolders[i];
            const folderPath = path.join(userFolder, folderName);
            
            if (fs.existsSync(folderPath)) {
                if (progressCallback) {
                    progressCallback({ 
                        status: 'scanning', 
                        message: `Scanning ${folderName} for files...`,
                        percent: Math.round(60 + (i / userFolders.length) * 25)
                    });
                }
                
                await deepScanFolder(folderPath, analysis, 0, 5);
            }
        }
    }

    // Sort large files by size
    analysis.largestFiles = analysis.largestFiles
        .sort((a, b) => b.size - a.size)
        .slice(0, 50);

    if (progressCallback) progressCallback({ status: 'scanning', message: 'Finding temp files...', percent: 88 });

    // Temp files
    const tempPaths = [
        path.join(rootPath, 'Windows', 'Temp'),
        process.env.TEMP,
        process.env.TMP,
        path.join(userFolder, 'AppData', 'Local', 'Temp')
    ].filter(p => p && fs.existsSync(p));

    for (const tempPath of tempPaths) {
        try {
            const sizeResult = await getFolderSizeFast(tempPath);
            if (sizeResult.size > 0) {
                analysis.tempFiles.push({
                    path: tempPath,
                    name: path.basename(tempPath) || tempPath,
                    size: sizeResult.size
                });
            }
        } catch (e) {}
    }

    // Also add common cache folders
    const cachePaths = [
        path.join(userFolder, 'AppData', 'Local', 'Microsoft', 'Windows', 'INetCache'),
        path.join(userFolder, 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'Cache'),
        path.join(userFolder, 'AppData', 'Local', 'Mozilla', 'Firefox', 'Profiles')
    ].filter(p => fs.existsSync(p));

    for (const cachePath of cachePaths) {
        try {
            const sizeResult = await getFolderSizeFast(cachePath);
            if (sizeResult.size > 10 * 1024 * 1024) { // > 10MB
                analysis.tempFiles.push({
                    path: cachePath,
                    name: cachePath.includes('Chrome') ? 'Chrome Cache' : 
                          cachePath.includes('Firefox') ? 'Firefox Cache' :
                          cachePath.includes('INetCache') ? 'IE/Edge Cache' : path.basename(cachePath),
                    size: sizeResult.size
                });
            }
        } catch (e) {}
    }

    analysis.tempFiles.sort((a, b) => b.size - a.size);

    if (progressCallback) progressCallback({ status: 'complete', message: 'Scan complete!', percent: 100 });

    return analysis;
}

/**
 * Deep scan folder recursively for file categorization
 */
async function deepScanFolder(folderPath, analysis, depth, maxDepth) {
    if (depth > maxDepth) return;
    
    try {
        const items = fs.readdirSync(folderPath, { withFileTypes: true });
        
        for (const item of items) {
            const itemPath = path.join(folderPath, item.name);
            
            try {
                if (item.isFile()) {
                    const stats = fs.statSync(itemPath);
                    const ext = path.extname(item.name).toLowerCase();
                    
                    // Categorize file
                    let categorized = false;
                    for (const [category, data] of Object.entries(analysis.categories)) {
                        if (category !== 'other' && data.extensions.includes(ext)) {
                            data.size += stats.size;
                            data.count++;
                            categorized = true;
                            break;
                        }
                    }
                    if (!categorized) {
                        analysis.categories.other.size += stats.size;
                        analysis.categories.other.count++;
                    }
                    
                    // Track large files (> 50MB)
                    if (stats.size >= 50 * 1024 * 1024) {
                        analysis.largestFiles.push({
                            path: itemPath,
                            name: item.name,
                            size: stats.size,
                            modified: stats.mtime
                        });
                    }
                } else if (item.isDirectory() && !item.name.startsWith('.') && !item.name.startsWith('$')) {
                    await deepScanFolder(itemPath, analysis, depth + 1, maxDepth);
                }
            } catch (e) {}
        }
    } catch (e) {}
}

async function deleteItem(itemPath, isDirectory) {
    return new Promise((resolve, reject) => {
        try {
            if (isDirectory) {
                fs.rmSync(itemPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(itemPath);
            }
            sizeCache.delete(path.dirname(itemPath));
            resolve({ success: true });
        } catch (error) {
            reject(new Error(`Failed to delete: ${error.message}`));
        }
    });
}

async function moveToRecycleBin(itemPath) {
    const escaped = itemPath.replace(/'/g, "''");
    const psCommand = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
    try {
        await runPowerShell(psCommand);
        sizeCache.delete(path.dirname(itemPath));
        return { success: true };
    } catch (error) {
        throw new Error(error.message || 'Failed to move item to recycle bin');
    }
}

async function emptyRecycleBin() {
    try {
        await runPowerShell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
        return { success: true };
    } catch (error) {
        throw new Error('Failed to empty recycle bin');
    }
}

async function getRecycleBinSize() {
    try {
        const psCommand = `(New-Object -ComObject Shell.Application).NameSpace(0xA).Items() | Measure-Object -Property Size -Sum | Select-Object -ExpandProperty Sum`;
        const stdout = await runPowerShell(psCommand);
        return { size: parseInt(stdout.trim()) || 0 };
    } catch (_) {
        return { size: 0 };
    }
}

function openInExplorer(itemPath) {
    const isDirectory = fs.existsSync(itemPath) && fs.statSync(itemPath).isDirectory();
    if (isDirectory) exec(`explorer "${itemPath}"`);
    else exec(`explorer /select,"${itemPath}"`);
}

async function searchFiles(rootPath, query, maxResults = 50) {
    const results = [];
    const lowerQuery = query.toLowerCase();

    async function search(dirPath, depth = 0) {
        if (depth > 5 || results.length >= maxResults) return;

        try {
            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            
            for (const item of items) {
                if (results.length >= maxResults) break;
                
                if (item.name.toLowerCase().includes(lowerQuery)) {
                    const itemPath = path.join(dirPath, item.name);
                    try {
                        const stats = fs.statSync(itemPath);
                        results.push({
                            name: item.name,
                            path: itemPath,
                            isDirectory: item.isDirectory(),
                            size: stats.size,
                            modified: stats.mtime
                        });
                    } catch (e) {}
                }

                if (item.isDirectory() && !item.name.startsWith('.')) {
                    await search(path.join(dirPath, item.name), depth + 1);
                }
            }
        } catch (e) {}
    }

    await search(rootPath);
    return results;
}

module.exports = {
    getAvailableDrives,
    analyzeDrive,
    browseFolder,
    getFolderContents,
    deleteItem,
    moveToRecycleBin,
    emptyRecycleBin,
    getRecycleBinSize,
    openInExplorer,
    searchFiles,
    getFolderSizeFast,
    getFolderSize
};
