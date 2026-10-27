'use strict';

const fs = require('fs');
const path = require('path');
const ctx = require('../ctx');
const log = require('../logger');
const paths = require('../paths');
const { readJson, writeFileAtomic } = require('../util');

const IGNORED = /^(\.|~\$)|\.(tmp|crdownload|part|download|aria2|bak|ytdl)$/i;

let state = { enabled: false, watchFolder: '', filesOrganized: 0, lastAction: null, activityLog: [] };
let watcher = null;
const inFlight = new Set();

const file = () => paths.userData('auto-organizer.json');
const save = () => { try { writeFileAtomic(file(), JSON.stringify(state, null, 2)); } catch (err) { log.warning('organizer', `Could not save auto-organizer state: ${err.message}`); } };

function load() {
    state = { ...state, ...readJson(file(), {}) };
    return state;
}

function stop() {
    if (!watcher) return;
    try { watcher.close(); } catch (_) { /* already closed */ }
    watcher = null;
    log.info('organizer', 'Auto-organizer stopped');
}

async function settle(filePath) {
    // Wait for a download/copy to finish growing before touching it.
    let last = -1;
    for (let i = 0; i < 12; i += 1) {
        await new Promise((r) => setTimeout(r, 800));
        try {
            const size = fs.statSync(filePath).size;
            if (size > 0 && size === last) return true;
            last = size;
        } catch (_) { return false; }
    }
    return false;
}

function start(folder) {
    stop();
    if (!folder || !fs.existsSync(folder)) return false;
    const organizer = require('../engines/organizer');
    try {
        watcher = fs.watch(folder, { persistent: false }, async (eventType, filename) => {
            if (!filename || eventType !== 'rename' || IGNORED.test(filename)) return;
            const full = path.join(folder, filename);
            if (path.dirname(path.resolve(full)) !== path.resolve(folder) || inFlight.has(full)) return;
            try { if (!fs.statSync(full).isFile()) return; } catch (_) { return; }
            inFlight.add(full);
            try {
                if (!(await settle(full))) return;
                const result = organizer.organizeFile(full, folder);
                if (result.success) {
                    state.filesOrganized += 1;
                    state.lastAction = new Date().toISOString();
                    state.activityLog = [{ file: filename, folder: result.targetFolder, at: state.lastAction }, ...(state.activityLog || [])].slice(0, 50);
                    save();
                    ctx.send('auto-organize-file', { success: true, fileName: filename, targetFolder: result.targetFolder });
                    log.success('organizer', `Auto-organized ${filename} into ${result.targetFolder}`);
                } else if (result.error !== 'Unknown file type') {
                    ctx.send('auto-organize-file', { success: false, fileName: filename, error: result.error });
                }
            } catch (err) {
                ctx.send('auto-organize-file', { success: false, fileName: filename, error: err.message });
            } finally { inFlight.delete(full); }
        });
        watcher.on('error', (err) => { log.warning('organizer', `Watcher error: ${err.message}`); stop(); });
        log.info('organizer', `Auto-organizer watching ${folder}`);
        return true;
    } catch (err) {
        log.error('organizer', 'Failed to start auto-organizer', { error: err.message });
        return false;
    }
}

/** Resume watching after launch if it was switched on last time. */
function restore() {
    load();
    if (state.enabled && state.watchFolder) start(state.watchFolder);
}

function getState() { return state; }
function update(patch) { state = { ...state, ...patch }; save(); return state; }

module.exports = { start, stop, restore, getState, update, load };
