'use strict';

/** Hidden-in-tray memory reclaim: closes only when idle, frees real memory, and the app comes back intact. */
const { app } = require('electron');

module.exports = async ({ win, js, sleep, report, ctx }) => {
    const activity = require('../../src/main/activity');
    const windowMod = require('../../src/main/window');
    const total = () => app.getAppMetrics().reduce((s, p) => s + Math.round((p.memory.privateBytes || 0) / 1024), 0);
    const count = () => app.getAppMetrics().length;
    const r = {};

    await js(`window.ufc.invoke('save-settings', { minimizeToTray: true, reclaimMemory: true })`);
    await sleep(400);
    r.trayCreated = !!(ctx.state.tray && !ctx.state.tray.isDestroyed());
    await sleep(1500);
    r.visibleMB = total(); r.visibleProcs = count();

    // 1) Hidden while a job is running: must NOT be reclaimed.
    activity.start('test-job', 'Converting');
    win.close(); // with the tray enabled this hides instead of closing
    await sleep(1800);
    r.keptWhileBusy = !!ctx.getWindow();
    activity.stop('test-job');

    // 2) Idle: reclaimed within a few seconds.
    for (let i = 0; i < 40 && ctx.getWindow(); i += 1) await sleep(300);
    r.windowClosedWhenIdle = !ctx.getWindow();
    await sleep(1500);
    r.hiddenMB = total(); r.hiddenProcs = count();
    r.appStillRunning = true;

    // 3) Bringing it back recreates a working window.
    const w = windowMod.showOrCreate();
    for (let i = 0; i < 60 && !(ctx.state.rendererReady); i += 1) await sleep(250);
    await sleep(1200);
    r.reopened = !!ctx.getWindow() && w.isVisible();
    r.pageWorks = await ctx.getWindow().webContents.executeJavaScript(`document.querySelector('.brand-name') ? document.querySelector('.brand-name').textContent : null`);
    r.reopenedMB = total();

    // 4) Music playing keeps the window.
    ctx.state.rendererBusy = true;
    ctx.getWindow().close();
    await sleep(2500);
    r.keptWhilePlaying = !!ctx.getWindow();
    ctx.state.rendererBusy = false;
    windowMod.showOrCreate();
    await sleep(600);

    r.savedMB = r.visibleMB - r.hiddenMB;
    r.ok = r.trayCreated && r.keptWhileBusy && r.windowClosedWhenIdle && r.reopened && /Uni\s*Companion/.test(r.pageWorks || '') && r.keptWhilePlaying && r.savedMB > 40;
    report.scenario.reclaim = r;
    if (!r.ok) report.errors.push('reclaim scenario failed: ' + JSON.stringify(r));
};
