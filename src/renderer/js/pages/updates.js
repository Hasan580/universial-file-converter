import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { app } from '../core/state.js';
import { toast, errorText } from '../core/ui.js';
import { pageHead } from '../components/page.js';
import { progressBar, notice } from '../components/controls.js';
import { ago, bytes } from '../core/format.js';
import { setUpdateDot } from '../core/nav.js';

export default async function updates() {
    const info = app.get().info || {};
    const mode = info.updateMode;
    const status = h('div');
    const notes = h('div', h('div.skeleton', { style: 'height:120px' }));
    let downloaded = false;
    let progress = null;

    const showCurrent = (extra) => mount(status, h('section.card',
        h('div.row.between.wrap',
            h('div', h('div.eyebrow', 'You are on'), h('div.display-sm', { style: 'margin-top:4px' }, `Version ${info.version}`)),
            h('button.btn.secondary', { onclick: check }, icon('refresh'), 'Check now')),
        extra ? h('div', { style: 'margin-top:var(--s-4)' }, extra) : null));

    function offer(version) {
        const bar = progressBar(null);
        bar.hidden = true;
        const label = h('div.tiny.soft', { style: 'margin-top:8px' });
        const go = h('button.btn.primary.lg');
        const setIdle = () => { go.disabled = false; go.replaceChildren(icon('download'), mode === 'auto' ? `Download version ${version}` : 'Open the download page'); };
        setIdle();
        go.onclick = async () => {
            if (downloaded) { await api.updates.install(); return; }
            go.disabled = true;
            if (mode === 'auto') {
                bar.hidden = false;
                go.replaceChildren(h('span.spinner'), 'Downloading...');
                progress = (p) => { bar.set(p.percent); label.textContent = `${bytes(p.transferred)} of ${bytes(p.total)}`; };
                try { await api.updates.download(); } catch (e) { toast(errorText(e), { type: 'error' }); setIdle(); }
            } else { await api.updates.download(); setIdle(); }
        };
        const offDone = api.on('update-downloaded', () => {
            downloaded = true; bar.hidden = true; label.textContent = '';
            go.disabled = false; go.replaceChildren(icon('refresh'), 'Restart and install');
        });
        const offProg = api.on('update-download-progress', (p) => progress && progress(p));
        cleanups.push(offDone, offProg);
        return h('div', h('div.callout', { style: 'padding:var(--s-5)' },
            h('div', h('h2', { style: 'font-size:26px' }, `Version ${version} is available`), h('p', mode === 'auto' ? 'It downloads in the background and installs when you restart.' : 'Download it from the releases page.')),
            go), bar, label);
    }

    const cleanups = [];
    async function check() {
        mount(status, h('section.card', h('div.row', h('span.spinner'), 'Checking for updates...')));
        const r = await api.updates.check().catch((e) => ({ error: errorText(e) }));
        if (r.dev) { showCurrent(notice('Update checks only run in the installed app.', '', icon('info'))); return; }
        if (r.error) { showCurrent(notice(`Could not check: ${r.error}`, 'error', icon('warning'))); return; }
        if (r.isNewer) { setUpdateDot(true); app.set({ updateInfo: { version: r.version } }); mount(status, offer(r.version)); return; }
        setUpdateDot(false);
        showCurrent(notice('You have the latest version.', 'ok', icon('check')));
    }

    const existing = app.get().updateInfo;
    if (existing) mount(status, offer(existing.version)); else check();

    api.updates.notes().then((list) => {
        if (!list.length) { mount(notes, h('p.muted', 'Release notes could not be loaded right now.')); return; }
        mount(notes, list.map((r) => h('article.release',
            h('div.row.between.wrap', h('h3.title-md', r.name || r.version), h('span.small.soft', ago(r.date))),
            r.prerelease ? h('span.badge.warn', 'Pre-release') : null,
            h('pre', (r.body || 'No notes for this release.').replace(/[#*`]/g, '').trim()))));
    }).catch(() => mount(notes, h('p.muted', 'Release notes could not be loaded right now.')));

    const el = h('div.page', pageHead('Updates', 'New versions arrive as releases on GitHub.'), status,
        h('h2.title-lg', { style: 'margin:var(--s-7) 0 var(--s-3)' }, 'Release notes'), h('section.card', notes));
    return { el, destroy: () => cleanups.forEach((fn) => fn()) };
}
