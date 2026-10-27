import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, errorText, confirmDialog } from '../core/ui.js';
import { pageHead } from '../components/page.js';
import { toggle, emptyState, notice, sectionCard } from '../components/controls.js';
import { bytes, ago, plural } from '../core/format.js';

const state = { folder: '', preview: null, stats: null };

export default async function organizer() {
    const auto = await api.organizer.autoState().catch(() => ({}));
    const body = h('div');
    const folderLabel = h('div.grow.truncate.mono.small', { style: 'color:var(--ink)' });

    const setFolder = async (folder) => {
        if (!folder) return;
        state.folder = folder; state.preview = null;
        folderLabel.textContent = folder;
        mount(body, h('div.skeleton', { style: 'height:160px' }));
        try {
            const [preview, stats] = await Promise.all([api.organizer.preview(folder), api.organizer.stats(folder)]);
            state.preview = preview; state.stats = stats;
            draw();
        } catch (e) { mount(body, notice(errorText(e), 'error', icon('warning'))); }
    };

    function draw() {
        const preview = state.preview || [];
        if (!state.folder) { mount(body, emptyState({ icon: icon('layers'), title: 'Pick a folder to tidy', text: 'You will see exactly where every file would go before anything moves.' })); return; }
        if (!preview.length) { mount(body, emptyState({ icon: icon('check'), title: 'Already tidy', text: 'There are no loose files in this folder.' })); return; }

        const groups = new Map();
        for (const p of preview) {
            if (!groups.has(p.targetFolder)) groups.set(p.targetFolder, []);
            groups.get(p.targetFolder).push(p);
        }
        const run = h('button.btn.primary.lg', { onclick: async () => {
            if (!await confirmDialog({ title: `Move ${plural(preview.length, 'file')}?`, message: `Files move into subfolders of ${state.folder}. Nothing is deleted, and name clashes get a number added.`, confirmLabel: 'Organise' })) return;
            run.disabled = true;
            try {
                const r = await api.organizer.run(state.folder);
                toast(`Moved ${r.success.length} files${r.failed.length ? `, ${r.failed.length} failed` : ''}`, { type: r.failed.length ? 'warning' : 'success' });
                await setFolder(state.folder);
            } catch (e) { toast(errorText(e), { type: 'error' }); } finally { run.disabled = false; }
        } }, icon('layers'), `Organise ${plural(preview.length, 'file')}`);

        mount(body,
            h('div.row.between.wrap', { style: 'margin-bottom:var(--s-4)' },
                h('div', h('div.title-md', plural(preview.length, 'file'), ' into ', plural(groups.size, 'folder')), h('div.small.muted', state.stats ? `${bytes(state.stats.totalSize)} in total` : '')), run),
            h('div.grid.cols-2', [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([name, files]) =>
                h('section.card.tight', h('div.row.between', h('div.row', icon('folder', 18), h('span.title-sm', name)), h('span.badge', files.length)),
                    h('div.small.soft', { style: 'margin-top:8px' }, files.slice(0, 4).map((f) => f.fileName).join(', '), files.length > 4 ? `, and ${files.length - 4} more` : '')))));
    }

    const quick = async (type) => { const p = await api.userPath(type); if (p) setFolder(p); };

    // ---------------------------------------------------------------- automatic mode
    const autoFolder = h('div.small.muted', auto.watchFolder ? `Watching ${auto.watchFolder}` : 'Pick a folder first');
    const autoStats = h('div.small.soft', auto.filesOrganized ? `${plural(auto.filesOrganized, 'file')} organised so far${auto.lastAction ? `, last ${ago(auto.lastAction)}` : ''}` : '');
    const autoToggle = toggle({ checked: !!auto.enabled, onChange: async (v) => {
        if (v) {
            const folder = state.folder || auto.watchFolder;
            if (!folder) { autoToggle.input.checked = false; toast('Pick a folder above first.', { type: 'warning' }); return; }
            const ok = await api.organizer.autoStart(folder);
            if (!ok) { autoToggle.input.checked = false; toast('Could not watch that folder.', { type: 'error' }); return; }
            autoFolder.textContent = `Watching ${folder}`;
        } else { await api.organizer.autoStop(); }
    } });

    const el = h('div.page', pageHead('File organiser', 'Sort a messy folder into tidy ones: Images, Documents, Music, Videos and more. Preview first, then decide.'),
        h('section.card.raised',
            h('div.row.wrap', icon('folder', 20), folderLabel,
                h('button.btn.secondary.sm', { onclick: async () => setFolder(await api.organizer.pick()) }, 'Choose folder')),
            h('div.row.wrap', { style: 'margin-top:var(--s-3)' }, h('span.small.soft', 'Quick pick:'),
                ['downloads', 'desktop', 'documents'].map((t) => h('button.chip', { onclick: () => quick(t) }, t[0].toUpperCase() + t.slice(1))))),
        h('div', { style: 'height:var(--s-5)' }), body,
        h('div', { style: 'height:var(--s-6)' }),
        sectionCard('Keep it tidy automatically', 'New files that land in the folder are sorted as soon as they finish downloading.',
            h('div.row.between', h('div', autoFolder, autoStats), autoToggle)));
    if (auto.watchFolder && !state.folder) setFolder(auto.watchFolder); else draw();
    return { el };
}
