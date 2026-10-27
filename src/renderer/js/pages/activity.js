import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/ui.js';
import { pageHead } from '../components/page.js';
import { chips, emptyState } from '../components/controls.js';
import { clockTime } from '../core/format.js';

export default async function activity() {
    let type = '';
    let text = '';
    const list = h('div');
    const count = h('span.small.soft');

    const draw = async () => {
        const logs = await api.logs.list(type ? { type } : {}).catch(() => []);
        const shown = text ? logs.filter((l) => `${l.category} ${l.message}`.toLowerCase().includes(text)) : logs;
        count.textContent = `${shown.length} entr${shown.length === 1 ? 'y' : 'ies'}`;
        mount(list, shown.length
            ? shown.slice(0, 300).map((l) => h(`div.log-line.${l.type}`, { title: l.details ? JSON.stringify(l.details, null, 1) : null },
                h('span.t', clockTime(l.timestamp)), h(`span.badge${l.type === 'error' ? '.err' : l.type === 'success' ? '.ok' : l.type === 'warning' ? '.warn' : ''}`, l.type),
                h('span.soft', l.category), h('span.m', l.message)))
            : emptyState({ icon: icon('terminal'), title: 'Nothing here yet', text: 'What the app does shows up here, which helps when something goes wrong.' }));
    };

    const filter = chips({ options: [{ id: '', label: 'All' }, { id: 'error', label: 'Errors' }, { id: 'warning', label: 'Warnings' }, { id: 'success', label: 'Done' }, { id: 'info', label: 'Info' }], value: '', onChange: (v) => { type = v; draw(); } });
    const search = h('input.input', { placeholder: 'Search the log', style: 'max-width:260px', oninput: (e) => { text = e.target.value.toLowerCase(); draw(); } });

    const el = h('div.page', pageHead('Activity', 'A plain record of what the app did, newest first. Useful when something does not work.',
        [h('button.btn.secondary', { onclick: async () => { const p = await api.logs.export(); if (p) toast('Log saved', { type: 'success' }); } }, icon('save'), 'Export'),
            h('button.btn.danger', { onclick: async () => { if (await confirmDialog({ title: 'Clear the log?', message: 'This cannot be undone.', confirmLabel: 'Clear', danger: true })) { await api.logs.clear(); draw(); } } }, icon('trash'), 'Clear')]),
        h('div.row.wrap.between', { style: 'margin-bottom:var(--s-4)' }, filter, h('div.row', search, count)),
        h('section.card.tight', list));

    await draw();
    const timer = setInterval(draw, 3000);
    return { el, destroy: () => clearInterval(timer) };
}
