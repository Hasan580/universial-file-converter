'use strict';

const { dialog } = require('electron');
const { handle } = require('./handle');
const ctx = require('../ctx');
const log = require('../logger');
const auto = require('../features/autoOrganizer');

let organizer = null;
const org = () => organizer || (organizer = require('../engines/organizer'));
let storage = null;
const disk = () => storage || (storage = require('../engines/storage'));

function register() {
    // ---- file organizer
    handle('select-organize-folder', async () => {
        const r = await dialog.showOpenDialog(ctx.getWindow(), { properties: ['openDirectory'], title: 'Select folder to organise' });
        return r.canceled ? null : r.filePaths[0] || null;
    });
    handle('preview-organization', (folder) => org().previewOrganization(folder));
    handle('organize-folder', async ({ folderPath, customMappings } = {}) => {
        log.info('organizer', `Organising ${folderPath}`);
        const result = await org().organizeDirectory(folderPath, customMappings, (p) => ctx.send('organize-progress', p));
        log.success('organizer', `Organised ${result.success.length} files`, { failed: result.failed.length, skipped: result.skipped.length });
        return result;
    });
    handle('get-folder-stats', (folder) => org().getFolderStats(folder));
    handle('get-default-mappings', () => org().getDefaultMappings());

    // ---- auto organizer
    handle('start-auto-organizer', (folder) => {
        const ok = auto.start(folder);
        auto.update({ enabled: ok, watchFolder: ok ? folder : auto.getState().watchFolder });
        return ok;
    });
    handle('stop-auto-organizer', () => { auto.stop(); auto.update({ enabled: false }); return true; });
    handle('get-auto-organizer-settings', () => auto.getState());
    handle('save-auto-organizer-settings', (patch) => { auto.update(patch || {}); return true; });

    // ---- storage analyzer
    handle('get-available-drives', () => disk().getAvailableDrives());
    handle('analyze-drive', async (drivePath) => {
        log.info('storage', `Analysing ${drivePath}`);
        const result = await disk().analyzeDrive(drivePath, (p) => ctx.send('storage-scan-progress', p));
        log.success('storage', `Analysed ${drivePath}: ${result.scannedFiles} files`);
        return result;
    });
    handle('cancel-storage-scan', () => disk().cancelScan());
    handle('browse-folder', (folder) => disk().browseFolder(folder));
    handle('get-folder-size', (folder) => disk().getFolderSize(folder));
    handle('search-files', (folder, query) => disk().searchFiles(folder, query));
    handle('delete-storage-item', async (itemPath, isDirectory) => {
        log.info('storage', `Deleting ${itemPath}`);
        const r = await disk().deleteItem(itemPath, isDirectory);
        if (!r.success) log.error('storage', `Delete failed: ${r.error}`, { path: itemPath });
        return r;
    });
    handle('move-to-recycle-bin', async (itemPath) => {
        const r = await disk().moveToTrash(itemPath);
        if (r.success) log.info('storage', `Moved to trash: ${itemPath}`); else log.error('storage', `Trash failed: ${r.error}`, { path: itemPath });
        return r;
    });
    handle('get-recycle-bin-size', () => disk().trashSize());
    handle('empty-recycle-bin', async () => {
        const r = await disk().emptyTrash();
        if (r.success) log.success('storage', 'Trash emptied');
        return r;
    });
    handle('get-env-variable', (name) => (['USERPROFILE', 'HOME', 'USERNAME', 'USER'].includes(name) ? process.env[name] || null : null));
}

module.exports = { register };
