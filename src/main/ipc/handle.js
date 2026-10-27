'use strict';

const { ipcMain } = require('electron');
const ctx = require('../ctx');
const log = require('../logger');

/** Only the app's own window may call into the main process; <webview> pages and other frames cannot. */
function trusted(event) {
    const w = ctx.getWindow();
    if (!w || event.sender !== w.webContents) return false;
    const url = (event.senderFrame && event.senderFrame.url) || event.sender.getURL();
    return url.startsWith('file://');
}

/**
 * Error details such as `kind` do not survive Electron's IPC serialisation (only `message` does),
 * so structured errors are encoded into the message and decoded again in the preload script.
 */
function encodeError(err) {
    if (!err || !err.kind) return err instanceof Error ? err : new Error(String(err));
    return new Error(`UFC_ERR:${JSON.stringify({ kind: err.kind, message: err.message, detail: err.detail || '', attempts: err.attempts || [], cancelled: !!err.cancelled })}`);
}

function handle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
        if (!trusted(event)) throw new Error('Blocked: untrusted IPC sender.');
        try {
            return await fn(...args);
        } catch (err) {
            if (!err || !err.cancelled) log.warning('ipc', `${channel} failed: ${err && err.message}`);
            if (err && err.cancelled) { const e = new Error('UFC_ERR:' + JSON.stringify({ kind: 'cancelled', message: 'Cancelled', cancelled: true })); throw e; }
            throw encodeError(err);
        }
    });
}

/** Fire-and-forget channel (ipcRenderer.send). */
function on(channel, fn) {
    ipcMain.on(channel, (event, ...args) => {
        if (!trusted(event)) return;
        try { fn(...args); } catch (err) { log.warning('ipc', `${channel} failed: ${err.message}`); }
    });
}

module.exports = { handle, on, trusted };
