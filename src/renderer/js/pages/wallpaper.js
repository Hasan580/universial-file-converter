import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, errorText } from '../core/ui.js';
import { pageHead } from '../components/page.js';
import { chips, range, toggle, field, notice, emptyState } from '../components/controls.js';
import { basename } from '../core/format.js';

export default async function wallpaper() {
    const st = await api.wallpaper.status().catch(() => ({ supported: false, running: false, settings: {} }));
    if (!st.supported) {
        return { el: h('div.page', pageHead('Live wallpaper', 'Play a video behind your desktop icons.'),
            emptyState({ icon: icon('monitor'), title: 'Windows only', text: 'Live wallpaper uses a Windows desktop feature, so it is not available on macOS or Linux.' })) };
    }

    const o = { ...st.settings };
    const statusEl = h('div');
    const fileLabel = h('div.grow.truncate.mono.small', { style: 'color:var(--ink)' }, o.filePath ? basename(o.filePath) : 'No video chosen');

    const draw = (s) => mount(statusEl, s.running ? notice(`Playing ${basename(s.settings.filePath)} behind your icons.`, 'ok', icon('check')) : s.lastError ? notice(s.lastError, 'error', icon('warning')) : null);
    draw(st);

    const startBtn = h('button.btn.primary.lg', { onclick: async () => {
        startBtn.disabled = true;
        try { draw(await api.wallpaper.start(o)); toast('Wallpaper started', { type: 'success' }); } catch (e) { mount(statusEl, notice(errorText(e), 'error', icon('warning'))); } finally { startBtn.disabled = false; }
    } }, icon('play'), 'Start wallpaper');
    const stopBtn = h('button.btn.secondary.lg', { onclick: async () => { draw(await api.wallpaper.stop()); toast('Wallpaper stopped', { type: 'info' }); } }, icon('stop'), 'Stop');

    const el = h('div.page', pageHead('Live wallpaper', 'Play a video behind your desktop icons. It stops when you press Stop or quit the app.'),
        statusEl, h('div', { style: 'height:var(--s-4)' }),
        h('section.card', h('div.row.wrap', icon('video', 20), fileLabel, h('button.btn.secondary.sm', { onclick: async () => { const f = await api.wallpaper.pick(); if (f) { o.filePath = f; fileLabel.textContent = basename(f); } } }, 'Choose video')),
            h('hr'),
            h('div.col', { style: 'gap:18px' },
                field('Fit', chips({ options: [{ id: 'cover', label: 'Fill the screen' }, { id: 'contain', label: 'Fit inside' }, { id: 'fill', label: 'Stretch' }], value: o.fitMode || 'cover', onChange: (v) => { o.fitMode = v; } })),
                field('Speed', range({ min: 0.25, max: 3, step: 0.25, value: o.playbackRate || 1, format: (v) => `${v}x`, onChange: (v) => { o.playbackRate = v; } })),
                h('div.row.between', h('span.label', 'Loop'), toggle({ checked: o.loop !== false, onChange: (v) => { o.loop = v; } })),
                h('div.row.between', h('span.label', 'Mute'), toggle({ checked: o.muted !== false, onChange: (v) => { o.muted = v; } })),
                field('Volume (when not muted)', range({ min: 0, max: 100, step: 5, value: o.volume ?? 40, format: (v) => `${v}%`, onChange: (v) => { o.volume = v; } }))),
            h('div.row', { style: 'margin-top:var(--s-5)' }, startBtn, stopBtn)));
    return { el };
}
