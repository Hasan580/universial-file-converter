import { h } from '../core/dom.js';

/**
 * Chip picker. `options`: [{ id, label, hint?, disabled? }]. Returns the element with `.set(id)` and `.value`.
 * With `multiple`, value is an array of ids.
 */
export function chips({ options, value, onChange, multiple = false, label }) {
    let current = multiple ? [...(value || [])] : value;
    const isOn = (id) => (multiple ? current.includes(id) : current === id);
    const el = h('div.seg', { role: multiple ? 'group' : 'radiogroup', 'aria-label': label || null });
    const paint = () => el.querySelectorAll('.chip').forEach((b) => b.setAttribute(multiple ? 'aria-pressed' : 'aria-checked', String(isOn(b.dataset.id))));
    for (const o of options) {
        el.append(h('button.chip', {
            type: 'button', dataset: { id: o.id }, disabled: o.disabled, title: o.title || null,
            role: multiple ? null : 'radio',
            onclick: () => {
                current = multiple ? (current.includes(o.id) ? current.filter((x) => x !== o.id) : [...current, o.id]) : o.id;
                paint();
                if (onChange) onChange(current);
            }
        }, o.label, o.hint ? h('small', o.hint) : null));
    }
    paint();
    el.set = (v) => { current = multiple ? [...v] : v; paint(); };
    Object.defineProperty(el, 'value', { get: () => current });
    return el;
}

/** Chips split into labelled groups, e.g. formats by category. */
export function groupedChips({ groups, value, onChange }) {
    let current = value;
    const wrap = h('div');
    const all = [];
    for (const [name, options] of groups) {
        const row = chips({ options, value: current, onChange: (v) => { current = v; all.forEach((c) => c.set(v)); if (onChange) onChange(v); } });
        all.push(row);
        wrap.append(h('div.chip-group', h('span.eyebrow', name), row));
    }
    wrap.set = (v) => { current = v; all.forEach((c) => c.set(v)); };
    Object.defineProperty(wrap, 'value', { get: () => current });
    return wrap;
}

export function select({ options, value, onChange, label }) {
    const el = h('select.select', { 'aria-label': label || null, onchange: () => onChange && onChange(el.value) },
        options.map((o) => h('option', { value: o.id, selected: o.id === value }, o.label)));
    el.value = value;
    return el;
}

export function toggle({ checked = false, onChange, label }) {
    const input = h('input', { type: 'checkbox', checked, 'aria-label': label || null, onchange: () => onChange && onChange(input.checked) });
    const el = h('label.switch', input, h('span.track'));
    el.input = input;
    return el;
}

export function range({ min = 0, max = 100, step = 1, value = 50, format = (v) => String(v), onChange }) {
    const out = h('output', format(value));
    const input = h('input.range', { type: 'range', min, max, step, value, oninput: () => { out.textContent = format(Number(input.value)); if (onChange) onChange(Number(input.value)); } });
    const el = h('div.range-row', input, out);
    el.input = input;
    el.set = (v) => { input.value = v; out.textContent = format(Number(v)); };
    return el;
}

export function field(label, control, help) {
    return h('div.field', label ? h('label', label) : null, control, help ? h('div.help', help) : null);
}

/** A settings row: title and description on the left, a control on the right. */
export function settingRow(title, desc, control) {
    return h('div.setting', h('div', h('div.s-title', title), desc ? h('div.s-desc', desc) : null), control);
}

export function sectionCard(title, subtitle, ...children) {
    return h('section.card', title ? h('h3.title-md', title) : null, subtitle ? h('p.card-sub', subtitle) : null, ...children);
}

export function badge(text, kind = '') {
    return h(`span.badge${kind ? '.' + kind : ''}`, text);
}

export function emptyState({ icon: ico, title, text, action }) {
    return h('div.empty', ico || null, h('h3', title), text ? h('p', text) : null, action ? h('div', { style: 'margin-top:16px' }, action) : null);
}

export function notice(text, kind = '', ico) {
    return h(`div.notice${kind ? '.' + kind : ''}`, ico || null, h('div', text));
}

export function progressBar(percent, state = '') {
    const bar = h(`div.bar${state ? '.' + state : ''}${Number.isFinite(percent) ? '' : '.indeterminate'}`, h('i', { style: Number.isFinite(percent) ? `width:${percent}%` : '' }));
    bar.set = (p, s) => {
        bar.className = `bar${s ? ' ' + s : ''}${Number.isFinite(p) ? '' : ' indeterminate'}`;
        bar.firstChild.style.width = Number.isFinite(p) ? `${p}%` : '';
    };
    return bar;
}
