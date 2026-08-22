/**
 * File Organizer Handler
 * Automatically organizes files in folders by type
 */

const path = require('path');
const fs = require('fs');

// Default folder mappings by file extension
const defaultMappings = {
    // Documents
    'pdf': 'Documents/PDFs',
    'doc': 'Documents/Word',
    'docx': 'Documents/Word',
    'xls': 'Documents/Excel',
    'xlsx': 'Documents/Excel',
    'ppt': 'Documents/PowerPoint',
    'pptx': 'Documents/PowerPoint',
    'txt': 'Documents/Text',
    'rtf': 'Documents/Text',
    'odt': 'Documents/OpenOffice',
    'ods': 'Documents/OpenOffice',

    // Images
    'jpg': 'Images',
    'jpeg': 'Images',
    'png': 'Images',
    'gif': 'Images',
    'bmp': 'Images',
    'webp': 'Images',
    'svg': 'Images/Vectors',
    'ico': 'Images/Icons',
    'tiff': 'Images',
    'avif': 'Images',
    'psd': 'Images/Photoshop',
    'ai': 'Images/Illustrator',

    // Videos
    'mp4': 'Videos',
    'avi': 'Videos',
    'mkv': 'Videos',
    'mov': 'Videos',
    'wmv': 'Videos',
    'flv': 'Videos',
    'webm': 'Videos',
    'mpeg': 'Videos',
    'm4v': 'Videos',

    // Audio
    'mp3': 'Audio',
    'wav': 'Audio',
    'flac': 'Audio',
    'aac': 'Audio',
    'ogg': 'Audio',
    'wma': 'Audio',
    'm4a': 'Audio',
    'aiff': 'Audio',

    // Archives
    'zip': 'Archives',
    'rar': 'Archives',
    '7z': 'Archives',
    'tar': 'Archives',
    'gz': 'Archives',

    // Executables & Installers
    'exe': 'Programs',
    'msi': 'Programs',
    'dmg': 'Programs',
    'deb': 'Programs',
    'rpm': 'Programs',

    // Code & Data
    'js': 'Code/JavaScript',
    'ts': 'Code/TypeScript',
    'py': 'Code/Python',
    'java': 'Code/Java',
    'cpp': 'Code/C++',
    'c': 'Code/C',
    'html': 'Code/Web',
    'css': 'Code/Web',
    'json': 'Code/Data',
    'xml': 'Code/Data',
    'csv': 'Code/Data',
    'sql': 'Code/Database',

    // Fonts
    'ttf': 'Fonts',
    'otf': 'Fonts',
    'woff': 'Fonts',
    'woff2': 'Fonts',

    // Torrents
    'torrent': 'Torrents'
};

/**
 * Get files in a directory (non-recursive)
 */
function getFilesInDirectory(dirPath) {
    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
            .filter(item => item.isFile())
            .map(item => ({
                name: item.name,
                path: path.join(dirPath, item.name),
                extension: path.extname(item.name).toLowerCase().slice(1),
                size: fs.statSync(path.join(dirPath, item.name)).size
            }));
    } catch (err) {
        console.error('Error reading directory:', err);
        return [];
    }
}

/**
 * Preview organization (dry run)
 */
function previewOrganization(sourceDir, customMappings = {}) {
    const mappings = { ...defaultMappings, ...customMappings };
    const files = getFilesInDirectory(sourceDir);

    const preview = [];

    for (const file of files) {
        const targetFolder = mappings[file.extension];
        if (targetFolder) {
            preview.push({
                fileName: file.name,
                currentPath: file.path,
                extension: file.extension,
                targetFolder: targetFolder,
                targetPath: path.join(sourceDir, targetFolder, file.name),
                size: file.size
            });
        } else {
            preview.push({
                fileName: file.name,
                currentPath: file.path,
                extension: file.extension,
                targetFolder: 'Others',
                targetPath: path.join(sourceDir, 'Others', file.name),
                size: file.size
            });
        }
    }

    return preview;
}

/**
 * Organize files in a directory
 */
async function organizeDirectory(sourceDir, customMappings = {}, progressCallback) {
    const mappings = { ...defaultMappings, ...customMappings };
    const files = getFilesInDirectory(sourceDir);

    const results = {
        success: [],
        failed: [],
        skipped: []
    };

    const total = files.length;
    let processed = 0;

    for (const file of files) {
        try {
            const targetFolder = mappings[file.extension] || 'Others';
            const targetDir = path.join(sourceDir, targetFolder);
            const targetPath = path.join(targetDir, file.name);

            // Skip if file is already in target location
            if (file.path === targetPath) {
                results.skipped.push({
                    fileName: file.name,
                    reason: 'Already in correct location'
                });
                continue;
            }

            // Create target directory if it doesn't exist
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // Handle file name conflicts
            let finalPath = targetPath;
            let counter = 1;
            while (fs.existsSync(finalPath)) {
                const ext = path.extname(file.name);
                const base = path.basename(file.name, ext);
                finalPath = path.join(targetDir, `${base} (${counter})${ext}`);
                counter++;
            }

            // Move the file
            fs.renameSync(file.path, finalPath);

            results.success.push({
                fileName: file.name,
                from: file.path,
                to: finalPath,
                folder: targetFolder
            });
        } catch (err) {
            results.failed.push({
                fileName: file.name,
                error: err.message
            });
        }

        processed++;
        if (progressCallback) {
            progressCallback(Math.round((processed / total) * 100));
        }
    }

    return results;
}

/**
 * Get default mappings
 */
function getDefaultMappings() {
    return { ...defaultMappings };
}

/**
 * Get folder statistics
 */
function getFolderStats(dirPath) {
    try {
        const files = getFilesInDirectory(dirPath);
        const stats = {
            totalFiles: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            byType: {}
        };

        for (const file of files) {
            const ext = file.extension || 'unknown';
            if (!stats.byType[ext]) {
                stats.byType[ext] = { count: 0, size: 0 };
            }
            stats.byType[ext].count++;
            stats.byType[ext].size += file.size;
        }

        return stats;
    } catch (err) {
        console.error('Error getting folder stats:', err);
        return null;
    }
}

/**
 * Organize a single file (for auto-organizer)
 */
function organizeFile(filePath, baseDir) {
    try {
        if (!fs.existsSync(filePath)) {
            return { success: false, error: 'File not found' };
        }

        const fileName = path.basename(filePath);
        const ext = path.extname(fileName).toLowerCase().slice(1);

        // Skip if no extension or unknown type
        if (!ext || !defaultMappings[ext]) {
            return { success: false, error: 'Unknown file type' };
        }

        const targetFolder = defaultMappings[ext];
        const targetDir = path.join(baseDir, targetFolder);

        // Create target directory if it doesn't exist
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // Generate unique filename if file already exists
        let finalPath = path.join(targetDir, fileName);
        let counter = 1;
        const nameWithoutExt = path.basename(fileName, path.extname(fileName));
        
        while (fs.existsSync(finalPath)) {
            const newName = `${nameWithoutExt} (${counter})${path.extname(fileName)}`;
            finalPath = path.join(targetDir, newName);
            counter++;
        }

        // Move the file
        fs.renameSync(filePath, finalPath);

        return {
            success: true,
            targetFolder: targetFolder,
            finalPath: finalPath
        };
    } catch (err) {
        return {
            success: false,
            error: err.message
        };
    }
}

module.exports = {
    organizeDirectory,
    previewOrganization,
    getDefaultMappings,
    getFolderStats,
    getFilesInDirectory,
    organizeFile
};
