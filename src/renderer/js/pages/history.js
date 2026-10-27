import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/ui.js';
import { pageHead, tabs } from '../components/page.js';
import { chips, emptyState } from '../components/controls.js';
import { ago, bytes, basename } from '../core/format.js';
import { navigate } from '../core/router.js';

const TYPES = [['', 'All'], ['audio', 'Audio'], ['video', 'Video'], ['image', 'Images'], ['compress', 'Compressed'], ['document', 'Documents'], ['download', 'Downloads']];
const ICON = { audio: 'audio', video: 'video', image: 'image', compress: 'compress', document: 'document', download: 'download' };

export default async function history() {
    let tab = 'conversions';
    let type = '';
    let query = '';
    const body = h('div');
    const filters = h('div.row.wrap.between', { style: 'margin-bottom:var(--s-4)' });

    async function drawConversions() {
        const items = await api.history.list().catch(() => []);
        let shown = items;
        if (type) shown = shown.filter((i) => i.type === type);
        if (query) shown = shown.filter((i) => `${i.inputName} ${i.outputPath || ''}`.toLowerCase().includes(query));

        mount(filters,
            chips({ options: TYPES.map(([id, label]) => ({ id, label })), value: type, onChange: (v) => { type = v; drawConversions(); } }),
            h('input.input', { placeholder: 'Search history', style: 'max-width:240px', value: query, oninput: (e) => { query = e.target.value.toLowerCase(); drawConversions(); } }));

        mount(body, shown.length
            ? h('section.card.tight', shown.slice(0, 200).map((it) => h('div.list-row',
                h('div.file-ico', { style: 'width:40px;height:40px;flex:none' }, icon(ICON[it.type] || 'document', 18)),
                h('div.grow', h('div.truncate', { style: 'color:var(--ink);font-weight:500' }, it.inputName),
                    it.status === 'success'
                        ? h('div.tiny.soft', `${basename(it.outputPath)} · ${bytes(it.inputSize)} → ${bytes(it.outputSize)} · ${ago(it.timestamp)}`)
                        : h('div.tiny', { style: 'color:var(--error-ink)' }, (it.error || 'Failed').replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), h('span.soft', ` · ${ago(it.timestamp)}`))),
                it.status === 'success' && it.outputPath ? [
                    h('button.icon-btn', { title: 'Open', 'aria-label': 'Open', onclick: () => api.files.open(it.outputPath) }, icon('play', 16)),
                    h('button.icon-btn', { title: 'Show in folder', 'aria-label': 'Show in folder', onclick: () => api.files.reveal(it.outputPath) }, icon('folderOpen', 16))] : h('span.badge.err', 'Failed'))))
            : emptyState({ icon: icon('clock'), title: 'Nothing converted yet', text: 'Finished conversions are listed here so you can open them again.', action: h('button.btn.primary', { onclick: () => navigate('audio') }, 'Start converting') }));
    }

    async function drawFiles() {
        mount(filters, chips({ options: [['all', 'All'], ['audio', 'Audio'], ['video', 'Video'], ['image', 'Images'], ['document', 'Documents']].map(([id, label]) => ({ id, label })), value: type || 'all', onChange: (v) => { type = v === 'all' ? '' : v; drawFiles(); } }));
        const r = await api.files.listOutput(type || 'all').catch(() => ({ files: [] }));
        mount(body, r.files.length
            ? h('section.card.tight', r.files.map((f) => h('div.list-row',
                h('div.file-ico', { style: 'width:40px;height:40px;flex:none' }, icon(ICON[f.type] || 'document', 18)),
                h('div.grow', h('div.truncate', { style: 'color:var(--ink);font-weight:500' }, f.name), h('div.tiny.soft', `${bytes(f.size)} · ${ago(f.modifiedTime)}`)),
                h('button.icon-btn', { title: 'Open', 'aria-label': 'Open', onclick: () => api.files.open(f.path) }, icon('play', 16)),
                h('button.icon-btn', { title: 'Show in folder', 'aria-label': 'Show in folder', onclick: () => api.files.reveal(f.path) }, icon('folderOpen', 16)))))
            : emptyState({ icon: icon('folder'), title: 'The output folder is empty', text: 'Files you convert or download will show up here.' }));
    }

    const draw = () => (tab === 'files' ? drawFiles() : drawConversions());
    const tabBar = tabs([{ id: 'conversions', label: 'Conversions' }, { id: 'files', label: 'Output folder' }], tab, (id) => { tab = id; type = ''; query = ''; draw(); });

    const el = h('div.page', pageHead('History', 'Everything you converted or downloaded, ready to open again.',
        h('button.btn.danger', { onclick: async () => { if (await confirmDialog({ title: 'Clear history?', message: 'The list will be emptied. Your files stay where they are.', confirmLabel: 'Clear', danger: true })) { await api.history.clear(); toast('History cleared', { type: 'success' }); draw(); } } }, icon('trash'), 'Clear history')),
        tabBar, filters, body);
    await draw();
    return { el };
}
