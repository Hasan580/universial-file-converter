import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, errorText, confirmDialog } from '../core/ui.js';
import { pageHead, tabs } from '../components/page.js';
import { emptyState, notice, progressBar } from '../components/controls.js';
import { bytes, dirname, plural } from '../core/format.js';

const CAT = {
    videos: ['Videos', '#cc785c'], images: ['Images', '#5db8a6'], documents: ['Documents', '#e8a55a'], audio: ['Audio', '#d9b99b'],
    archives: ['Archives', '#8e8b82'], programs: ['Programs', '#a9583e'], other: ['Other', '#4a453f']
};

export default async function storage() {
    let tab = 'overview';
    const body = h('div');
    let drives = [];
    let scan = null;       // last analysis
    let scanning = null;   // path being scanned

    // ------------------------------------------------------------ overview
    const driveCard = (d) => h('section.card', h('div.row.between', h('div.row', icon('drive', 20), h('span.title-sm', d.name)), h('span.small.muted', `${d.usedPercent}% used`)),
        h('div.bar', { style: 'margin:12px 0' }, h('i', { style: `width:${d.usedPercent}%;background:${d.usedPercent > 90 ? 'var(--error)' : d.usedPercent > 75 ? 'var(--amber)' : 'var(--coral)'}` })),
        h('div.small.muted', `${bytes(d.freeSpace)} free of ${bytes(d.totalSize)}`),
        h('div.row', { style: 'margin-top:12px' }, h('button.btn.secondary.sm', { disabled: !!scanning, onclick: () => analyze(d.root) }, icon('search'), 'Analyse'),
            h('button.btn.ghost.sm', { onclick: () => { browsePath = d.root; setTab('browse'); } }, 'Browse')));

    async function analyze(root) {
        scanning = root; scan = null;
        const bar = progressBar(null);
        const line = h('div.small.soft.truncate');
        const off = api.on('storage-scan-progress', (p) => { line.textContent = `${plural(p.scanned, 'file')} · ${bytes(p.bytes)} · ${p.current || ''}`; });
        drawOverview(h('section.card', h('div.row.between', h('div.title-sm', `Analysing ${root}`), h('button.btn.secondary.sm', { onclick: () => api.storage.cancel() }, 'Stop')), h('div', { style: 'margin:12px 0' }, bar), line));
        try { scan = await api.storage.analyze(root); } catch (e) { if (!e.cancelled) toast(errorText(e), { type: 'error' }); } finally { off(); scanning = null; }
        drawOverview();
    }

    function fileRow(f, isDir) {
        return h('div.list-row', h('div.file-ico', { style: 'width:36px;height:36px;flex:none' }, icon(isDir ? 'folder' : 'document', 18)),
            h('div.grow', h('div.truncate', { style: 'color:var(--ink);font-weight:500' }, f.name), h('div.tiny.soft.truncate', dirname(f.path))),
            h('span.small.muted.num', bytes(f.size)),
            h('button.icon-btn', { title: 'Show in folder', 'aria-label': 'Show in folder', onclick: () => api.files.reveal(f.path) }, icon('folderOpen', 16)),
            h('button.icon-btn', { title: 'Move to the trash', 'aria-label': 'Move to the trash', onclick: () => trash(f, isDir) }, icon('trash', 16)));
    }

    async function trash(f, isDir) {
        if (!await confirmDialog({ title: `Move ${isDir ? 'folder' : 'file'} to the trash?`, message: `${f.name} (${f.size ? bytes(f.size) : 'folder'}) can be restored from the trash.`, confirmLabel: 'Move to trash', danger: true })) return;
        const r = await api.storage.trash(f.path);
        if (r.success) { toast('Moved to the trash', { type: 'success' }); if (scan) { scan.largestFiles = scan.largestFiles.filter((x) => x.path !== f.path); scan.largestFolders = scan.largestFolders.filter((x) => x.path !== f.path); } if (tab === 'overview') drawOverview(); else drawBrowse(); }
        else toast(r.error || 'Could not move it', { type: 'error' });
    }

    function drawOverview(override) {
        if (override) { mount(body, drives.length ? h('div.grid.cols-3', drives.map(driveCard)) : '', h('div', { style: 'height:var(--s-5)' }), override); return; }
        const parts = [];
        parts.push(drives.length ? h('div.grid.cols-3', drives.map(driveCard)) : emptyState({ icon: icon('drive'), title: 'No drives found', text: 'The app could not list your drives.' }));
        if (scan) {
            const total = Object.values(scan.categories).reduce((s, c) => s + c.size, 0) || 1;
            parts.push(h('div', { style: 'height:var(--s-6)' }), h('section.card',
                h('div.row.between.wrap', h('div', h('div.eyebrow', 'What is using the space'), h('div.display-sm', { style: 'margin-top:4px' }, bytes(scan.scannedBytes))), h('div.small.muted', `${plural(scan.scannedFiles, 'file')} in ${(scan.durationMs / 1000).toFixed(1)} s`)),
                h('div.usage', { style: 'margin-top:var(--s-4)' }, Object.entries(scan.categories).filter(([, c]) => c.size).map(([k, c]) => h('span', { title: `${CAT[k][0]}: ${bytes(c.size)}`, style: `width:${(c.size / total) * 100}%;background:${CAT[k][1]}` }))),
                h('div.legend', Object.entries(scan.categories).filter(([, c]) => c.size).sort((a, b) => b[1].size - a[1].size).map(([k, c]) => h('span.key', h('i', { style: `background:${CAT[k][1]}` }), `${CAT[k][0]} ${bytes(c.size)}`)))),
                h('div', { style: 'height:var(--s-4)' }),
                h('div.grid.cols-2', { style: 'align-items:start' },
                    h('section.card.tight', h('h3.title-md', { style: 'padding:8px 4px' }, 'Largest folders'), scan.largestFolders.slice(0, 10).map((f) => fileRow(f, true))),
                    h('section.card.tight', h('h3.title-md', { style: 'padding:8px 4px' }, 'Largest files'), scan.largestFiles.slice(0, 10).map((f) => fileRow(f, false)))));
        }
        parts.push(h('div', { style: 'height:var(--s-4)' }), trashCard());
        mount(body, parts);
    }

    function trashCard() {
        const size = h('span.small.muted', 'Checking...');
        api.storage.trashSize().then((n) => { size.textContent = n ? bytes(n) : 'Empty'; }).catch(() => { size.textContent = ''; });
        return h('section.card.tight', h('div.row.between', h('div.row', icon('trash', 18), h('span.title-sm', 'Trash'), size),
            h('button.btn.secondary.sm', { onclick: async () => { if (!await confirmDialog({ title: 'Empty the trash?', message: 'Everything in the trash is deleted for good.', confirmLabel: 'Empty', danger: true })) return; const r = await api.storage.emptyTrash(); toast(r.success ? 'Trash emptied' : (r.error || 'Could not empty'), { type: r.success ? 'success' : 'error' }); drawOverview(); } }, 'Empty trash')));
    }

    // ------------------------------------------------------------ browse
    let browsePath = '';
    async function drawBrowse() {
        if (!browsePath) { mount(body, emptyState({ icon: icon('folderOpen'), title: 'Choose a drive to browse', text: 'Go to Overview and press Browse on a drive.' })); return; }
        mount(body, h('div.skeleton', { style: 'height:200px' }));
        const r = await api.storage.browse(browsePath);
        const crumbs = h('div.row.wrap.small', { style: 'margin-bottom:var(--s-3)' },
            h('button.btn.ghost.sm', { disabled: dirname(browsePath) === browsePath || !dirname(browsePath), onclick: () => { browsePath = dirname(browsePath) || browsePath; drawBrowse(); } }, icon('back'), 'Up'),
            h('span.mono.muted.truncate', browsePath));
        if (r.error) { mount(body, crumbs, notice(r.error, 'error', icon('warning'))); return; }
        mount(body, crumbs, h('section.card.tight', r.items.length ? r.items.map((it) => h('div.list-row', { style: it.isDirectory ? 'cursor:pointer' : '', onclick: it.isDirectory ? () => { browsePath = it.path; drawBrowse(); } : null },
            h('div.file-ico', { style: 'width:36px;height:36px;flex:none' }, icon(it.isDirectory ? 'folder' : 'document', 18)),
            h('div.grow.truncate', { style: 'color:var(--ink)' }, it.name),
            it.isDirectory
                ? h('button.btn.ghost.sm', { onclick: async (e) => { e.stopPropagation(); const b = e.currentTarget; b.textContent = '...'; b.textContent = bytes(await api.storage.size(it.path)); } }, it.itemCount !== null ? `${it.itemCount} items` : 'Size')
                : h('span.small.muted.num', bytes(it.size)),
            h('button.icon-btn', { title: 'Move to the trash', 'aria-label': 'Move to the trash', onclick: (e) => { e.stopPropagation(); trash({ name: it.name, path: it.path, size: it.size || 0 }, it.isDirectory); } }, icon('trash', 16)))) : emptyState({ title: 'Empty folder' })));
    }

    // ------------------------------------------------------------ search
    async function drawSearch() {
        const input = h('input.input', { placeholder: 'Search file names in the current folder', value: '' });
        const results = h('div');
        const go = async () => {
            if (!browsePath) { toast('Browse to a folder first.', { type: 'info' }); return; }
            mount(results, h('div.skeleton', { style: 'height:120px' }));
            const r = await api.storage.search(browsePath, input.value).catch(() => []);
            mount(results, r.length ? h('section.card.tight', r.map((f) => fileRow(f, f.isDirectory))) : emptyState({ title: 'No matches' }));
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        mount(body, h('div.input-group', input, h('button.btn.primary', { onclick: go }, icon('search'), 'Search')), h('div.small.soft', { style: 'margin:8px 0 var(--s-4)' }, browsePath ? `Searching in ${browsePath}` : 'Choose a folder in Browse first.'), results);
    }

    const setTab = (id) => { tab = id; tabBar.select(id); };
    const draw = () => (tab === 'browse' ? drawBrowse() : tab === 'search' ? drawSearch() : drawOverview());
    const tabBar = tabs([{ id: 'overview', label: 'Overview' }, { id: 'browse', label: 'Browse' }, { id: 'search', label: 'Search' }], tab, (id) => { tab = id; draw(); });

    const el = h('div.page.wide', pageHead('Storage', 'See what is filling your drives, find the biggest files and clear them safely. Items go to the trash first.'), tabBar, body);
    drives = await api.storage.drives().catch(() => []);
    draw();
    return { el, destroy: () => { if (scanning) api.storage.cancel(); } };
}
