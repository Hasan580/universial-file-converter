import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, errorText } from '../core/ui.js';
import { pageHead } from '../components/page.js';
import { progressBar, emptyState, select } from '../components/controls.js';
import { bytes, eta as fmtEta } from '../core/format.js';

const STATUS = { queued: ['Waiting', ''], downloading: ['Downloading', 'teal'], paused: ['Paused', 'warn'], completed: ['Done', 'ok'], failed: ['Failed', 'err'], cancelled: ['Cancelled', ''] };

export default async function downloads() {
    let state = await api.dm.state().catch(() => ({ tasks: [], defaultOutputDir: '', maxConcurrent: 2 }));

    const url = h('input.input', { type: 'url', placeholder: 'Paste a direct link to a file', 'aria-label': 'File link' });
    const name = h('input.input', { placeholder: 'Save as (optional)', style: 'max-width:240px', 'aria-label': 'File name' });
    const add = async () => {
        const link = url.value.trim();
        if (!link) return;
        try { await api.dm.add({ url: link, fileName: name.value.trim() }); url.value = ''; name.value = ''; } catch (e) { toast(errorText(e), { type: 'error' }); }
    };
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

    const list = h('div.files');
    const head = h('div.row.between.wrap');

    const act = (fn) => async () => { try { await fn(); } catch (e) { toast(errorText(e), { type: 'error' }); } };

    function row(t) {
        const [label, kind] = STATUS[t.status] || ['', ''];
        const running = t.status === 'downloading';
        const pct = t.totalBytes ? t.progress : null;
        return h(`div.file${t.status === 'completed' ? '.done' : t.status === 'failed' ? '.failed' : ''}`, { dataset: { id: t.id, type: 'document' } },
            h('div.file-ico', icon('download')),
            h('div', { style: 'min-width:0' },
                h('div.file-name.truncate', { title: t.url }, t.fileName),
                h('div.file-meta', h(`span.badge${kind ? '.' + kind : ''}`, label),
                    t.totalBytes ? `${bytes(t.downloadedBytes)} of ${bytes(t.totalBytes)}` : t.downloadedBytes ? bytes(t.downloadedBytes) : null,
                    running && t.speedBytesPerSec ? `${bytes(t.speedBytesPerSec)}/s` : null,
                    running && t.etaSeconds ? `${fmtEta(t.etaSeconds)} left` : null,
                    t.source && t.source !== 'manual' ? h('span.badge', t.source.replace('-', ' ')) : null),
                running || t.status === 'paused' ? h('div.file-status', progressBar(pct, t.status === 'paused' ? '' : '')) : null,
                t.status === 'failed' ? h('div.file-status.tiny', { style: 'color:var(--error-ink)' }, t.error || 'The download failed') : null),
            h('div.file-actions',
                running ? h('button.icon-btn', { title: 'Pause', 'aria-label': 'Pause', onclick: act(() => api.dm.pause(t.id)) }, icon('pause', 16)) : null,
                t.status === 'paused' ? h('button.icon-btn', { title: 'Resume', 'aria-label': 'Resume', onclick: act(() => api.dm.resume(t.id)) }, icon('play', 16)) : null,
                ['failed', 'cancelled'].includes(t.status) ? h('button.icon-btn', { title: 'Retry', 'aria-label': 'Retry', onclick: act(() => api.dm.retry(t.id)) }, icon('refresh', 16)) : null,
                t.status === 'completed' ? [h('button.icon-btn', { title: 'Open', 'aria-label': 'Open', onclick: act(() => api.dm.openFile(t.outputPath)) }, icon('play', 16)),
                    h('button.icon-btn', { title: 'Show in folder', 'aria-label': 'Show in folder', onclick: act(() => api.dm.openFolder(t.outputPath)) }, icon('folderOpen', 16))] : null,
                ['queued', 'downloading', 'paused'].includes(t.status) ? h('button.icon-btn', { title: 'Cancel', 'aria-label': 'Cancel', onclick: act(() => api.dm.cancel(t.id)) }, icon('stop', 16))
                    : h('button.icon-btn', { title: 'Remove from list', 'aria-label': 'Remove', onclick: act(() => api.dm.remove(t.id, false)) }, icon('x', 16))));
    }

    function draw() {
        mount(head,
            h('div.small.muted', `${state.activeCount || 0} active · ${state.queueCount || 0} waiting`),
            h('div.row.wrap',
                h('button.btn.ghost.sm', { onclick: act(() => api.dm.pauseAll()) }, icon('pause'), 'Pause all'),
                h('button.btn.ghost.sm', { onclick: act(() => api.dm.resumeAll()) }, icon('play'), 'Resume all'),
                h('button.btn.ghost.sm', { onclick: act(() => api.dm.clearFinished(false)) }, 'Clear finished')));
        mount(list, state.tasks.length ? state.tasks.map(row)
            : emptyState({ icon: icon('link'), title: 'No downloads yet', text: 'Paste a link above, or use the browser extension to send downloads here.' }));
    }

    // Update progress bars in place so the list does not flicker while files download.
    const off = api.on('dm-state', (next) => {
        const prev = state;
        state = next;
        const sameShape = prev.tasks.length === next.tasks.length && prev.tasks.every((t, i) => t.id === next.tasks[i].id && t.status === next.tasks[i].status);
        if (!sameShape) { draw(); return; }
        next.tasks.forEach((t) => {
            const el = list.querySelector(`[data-id="${t.id}"]`);
            if (!el) return;
            const bar = el.querySelector('.bar');
            if (bar) { bar.classList.toggle('indeterminate', !t.totalBytes); bar.firstChild.style.width = t.totalBytes ? `${t.progress}%` : ''; }
            const meta = el.querySelector('.file-meta');
            if (meta && t.status === 'downloading') {
                const parts = [t.totalBytes ? `${bytes(t.downloadedBytes)} of ${bytes(t.totalBytes)}` : bytes(t.downloadedBytes), t.speedBytesPerSec ? `${bytes(t.speedBytesPerSec)}/s` : '', t.etaSeconds ? `${fmtEta(t.etaSeconds)} left` : ''].filter(Boolean);
                meta.lastChild.textContent = parts.join(' · ');
            }
        });
    });

    const folder = h('span.mono.small', { style: 'color:var(--ink)' }, state.defaultOutputDir || '');
    const el = h('div.page', pageHead('Direct links', 'A download manager for plain file links. Pause, resume and queue, or send downloads here from your browser.'),
        h('section.card.raised', h('div.input-group', url, name, h('button.btn.primary', { onclick: add }, icon('plus'), 'Add')),
            h('div.row.between.wrap', { style: 'margin-top:var(--s-3)' },
                h('div.row.small.muted', icon('folder', 16), folder,
                    h('button.btn.ghost.sm', { onclick: async () => { const d = await api.dm.setDir(); if (d) folder.textContent = d; } }, 'Change')),
                h('div.row.small.muted', 'At a time', select({ options: [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, label: String(n) })), value: state.maxConcurrent || 2, onChange: (v) => api.dm.setConcurrent(Number(v)) })))),
        h('div', { style: 'height:var(--s-5)' }), head, h('div', { style: 'height:var(--s-3)' }), list);
    draw();
    return { el, destroy: () => off() };
}
