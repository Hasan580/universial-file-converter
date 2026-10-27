'use strict';

/** Shared runtime state for the main process. Feature modules read it; only lifecycle code writes it. */
const state = {
    mainWindow: null,
    tray: null,
    quitting: false,
    installingUpdate: false,
    rendererReady: false,
    rendererBusy: false,   // the page is doing something main cannot see (the music player is playing)
    reclaiming: false      // the hidden window is being closed on purpose to free memory
};

function getWindow() {
    const w = state.mainWindow;
    return w && !w.isDestroyed() ? w : null;
}

/** Send an event to the renderer if a window exists. Never throws. */
function send(channel, payload) {
    const w = getWindow();
    if (!w || w.webContents.isDestroyed()) return false;
    try {
        w.webContents.send(channel, payload);
        return true;
    } catch (_) {
        return false;
    }
}

module.exports = { state, getWindow, send };
