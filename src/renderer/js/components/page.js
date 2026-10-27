import { h } from '../core/dom.js';

/** Standard page header: serif title, supporting line, optional actions. */
export function pageHead(title, subtitle, actions) {
    return h('header.page-head',
        h('h1.display-md', title),
        subtitle ? h('p', subtitle) : null,
        actions ? h('div.actions.row.wrap', actions) : null);
}

export function tabs(items, selected, onSelect) {
    const el = h('div.tabs', { role: 'tablist' });
    const paint = (id) => el.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === id)));
    for (const t of items) {
        el.append(h('button.tab', { role: 'tab', dataset: { id: t.id }, onclick: () => { paint(t.id); onSelect(t.id); } }, t.label));
    }
    paint(selected);
    el.select = (id) => { paint(id); onSelect(id); };
    return el;
}

/** localStorage that never throws (private windows, disabled storage). */
export const prefs = {
    get(key, fallback) {
        try { const v = localStorage.getItem(`ufc.${key}`); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(`ufc.${key}`, JSON.stringify(value)); } catch (_) { /* preferences are optional */ }
    }
};
