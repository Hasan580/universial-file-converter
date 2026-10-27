'use strict';

const { Tray, Menu, nativeImage, app } = require('electron');
const ctx = require('./ctx');
const paths = require('./paths');
const win = require('./window');

function trayImage() {
    for (const file of [paths.resource('build', 'tray.png'), paths.appFile('build', 'tray.png'), paths.resource('build', 'icon.png'), paths.appFile('build', 'icon.png')]) {
        try {
            const img = nativeImage.createFromPath(file);
            if (!img.isEmpty()) return img.resize({ width: 18, height: 18 });
        } catch (_) { /* try next */ }
    }
    return null;
}

function create() {
    if (ctx.state.tray && !ctx.state.tray.isDestroyed()) return ctx.state.tray;
    const image = trayImage();
    if (!image) return null;
    let tray;
    try {
        tray = new Tray(image);
    } catch (_) {
        return null; // no system tray (some Linux desktops): the window then closes normally
    }
    const go = (page) => () => { win.showOrCreate(); ctx.send('navigate', page); };
    tray.setToolTip(paths.APP_TITLE);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Uni Companion', click: () => win.showOrCreate() },
        { type: 'separator' },
        { label: 'Convert audio', click: go('audio') },
        { label: 'Convert video', click: go('video') },
        { label: 'Convert images', click: go('image') },
        { label: 'Download media', click: go('download') },
        { type: 'separator' },
        { label: 'Quit', click: () => { ctx.state.quitting = true; app.quit(); } }
    ]));
    tray.on('click', () => win.showOrCreate());
    ctx.state.tray = tray;
    return tray;
}

function destroy() {
    const t = ctx.state.tray;
    if (t && !t.isDestroyed()) t.destroy();
    ctx.state.tray = null;
}

function setTooltip(text) {
    const t = ctx.state.tray;
    if (t && !t.isDestroyed()) t.setToolTip(text);
}

module.exports = { create, destroy, setTooltip };
