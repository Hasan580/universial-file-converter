'use strict';

/**
 * UI harness: boots the real app (real preload, real main process, throwaway data folder), visits
 * pages, takes screenshots and records console errors.
 *
 *   UFC_OUT=<dir> UFC_PAGES=home,audio UFC_SCENARIO=convert electron test/ui.main.js
 *
 * Writes <dir>/<page>.png and <dir>/report.json. Exits 1 if any page logged an error.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const out = process.env.UFC_OUT || path.join(os.tmpdir(), 'ufc-ui');
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-ui-data-'));
process.env.UFC_USER_DATA = data;

const { app } = require('electron');
// UFC_SWITCHES="in-process-gpu,disable-gpu" lets memory experiments try Chromium switches without editing the app.
for (const sw of (process.env.UFC_SWITCHES || '').split(',').filter(Boolean)) { const [k, v] = sw.split('='); app.commandLine.appendSwitch(k, v); }
if (!process.env.UFC_GPU) app.disableHardwareAcceleration();
// UFC_VERSION shows a release number instead of Electron's (the harness runs from test/, not the app folder).
if (process.env.UFC_VERSION) app.getVersion = () => process.env.UFC_VERSION;
require('../src/main/index.js');
const ctx = require('../src/main/ctx');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { pages: {}, errors: [], scenario: {} };
const width = Number(process.env.UFC_W || 1280);
const height = Number(process.env.UFC_H || 820);

async function waitForWindow() {
    for (let i = 0; i < 100; i += 1) {
        const w = ctx.getWindow();
        if (w && !w.webContents.isLoading()) return w;
        await sleep(100);
    }
    throw new Error('main window never appeared');
}

async function shot(win, name) {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name.replace(/[^a-z0-9_-]+/gi, '-')}.png`), img.toPNG());
}

const js = (win, code) => win.webContents.executeJavaScript(code, true);

async function visit(win, page, wait = 900) {
    const before = report.errors.length;
    await js(win, `location.hash = '#/${page}'`);
    await sleep(wait);
    await shot(win, page);
    report.pages[page] = { errors: report.errors.slice(before) };
}

app.whenReady().then(async () => {
    const win = await waitForWindow();
    win.setSize(width, height);
    win.center();
    // UFC_NO_ALERTS hides the remote notice banner so documentation screenshots stay clean.
    if (process.env.UFC_NO_ALERTS) {
        const hideBanner = () => win.webContents.insertCSS('#banner { display: none !important; }').catch(() => {});
        win.webContents.on('did-finish-load', hideBanner);
        hideBanner();
    }
    win.webContents.on('console-message', (event, ...rest) => {
        const level = typeof event.level === 'string' ? event.level : rest[0];
        const message = event.message !== undefined ? event.message : rest[1];
        if (level === 'error' || level === 3) report.errors.push(String(message).slice(0, 300));
    });
    await sleep(2200); // splash + first paint

    // Memory snapshot: privateBytes is what the process really holds; workingSet includes shared pages.
    const snap = (label) => {
        const procs = app.getAppMetrics().map((m) => ({ type: m.type, pid: m.pid, privateMB: Math.round((m.memory.privateBytes || 0) / 1024), workingMB: Math.round(m.memory.workingSetSize / 1024) }));
        report.memory = report.memory || {};
        report.memory[label] = { processes: procs.length, privateMB: procs.reduce((a, p) => a + p.privateMB, 0), workingMB: procs.reduce((a, p) => a + p.workingMB, 0), detail: procs.map((p) => `${p.type}:${p.privateMB}`).join(' ') };
    };
    const pages = (process.env.UFC_PAGES || 'home').split(',').filter(Boolean);
    if (process.env.UFC_METRICS) { await sleep(3000); snap('home-idle'); }
    for (const p of pages) await visit(win, p, process.env.UFC_METRICS ? 500 : 900);
    if (process.env.UFC_METRICS) { await sleep(2500); snap('after-pages'); await visit(win, 'home', 500); await sleep(3500); snap('home-after'); }

    if (process.env.UFC_SCENARIO) {
        const scenario = require(path.resolve(__dirname, 'scenarios', `${process.env.UFC_SCENARIO}.js`));
        await scenario({ win, js: (c) => js(win, c), sleep, shot: (n) => shot(win, n), ctx, report, out, data });
    }

    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    app.exit(report.errors.length ? 1 : 0);
});

setTimeout(() => { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...report, timeout: true }, null, 2)); app.exit(2); }, Number(process.env.UFC_TIMEOUT || 120000));
