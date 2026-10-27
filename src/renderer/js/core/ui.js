import { h, $ } from './dom.js';
import { icon } from './icons.js';

const TOAST_ICON = { success: 'check', error: 'warning', info: 'info', warning: 'warning' };

/** toast('Saved', { type: 'success' }) */
export function toast(message, { type = 'info', timeout = 4200, action } = {}) {
    const root = $('#toasts');
    if (!root) return () => {};
    const el = h('div.toast.' + type, { role: type === 'error' ? 'alert' : 'status' },
        h('span.ico', icon(TOAST_ICON[type] || 'info')),
        h('div.grow', message),
        action ? h('button.btn.ghost.sm', { onclick: () => { action.run(); dismiss(); } }, action.label) : null
    );
    root.append(el);
    let gone = false;
    function dismiss() {
        if (gone) return;
        gone = true;
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 240);
    }
    if (timeout) setTimeout(dismiss, timeout);
    el.addEventListener('click', (e) => { if (!e.target.closest('button')) dismiss(); });
    while (root.children.length > 4) root.firstChild.remove();
    return dismiss;
}

/** Open a modal. Resolves with whatever `close(value)` is called with; Escape or a scrim click resolves null. */
export function modal({ title, body, actions }) {
    return new Promise((resolve) => {
        const root = $('#modal-root');
        const previous = document.activeElement;
        const scrim = h('div.scrim');
        const close = (value = null) => {
            document.removeEventListener('keydown', onKey, true);
            scrim.remove();
            if (previous && previous.focus) previous.focus();
            resolve(value);
        };
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
        const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
            title ? h('h2.display-sm', title) : null,
            body,
            actions ? h('div.actions', actions(close)) : null
        );
        scrim.append(box);
        scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(null); });
        document.addEventListener('keydown', onKey, true);
        root.append(scrim);
        const first = box.querySelector('input, textarea, select, .btn.primary, .btn');
        if (first) first.focus();
    });
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return modal({
        title,
        body: h('p.muted', { style: 'margin:0' }, message),
        actions: (close) => [
            h('button.btn.secondary', { onclick: () => close(false) }, 'Cancel'),
            h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => close(true) }, confirmLabel)
        ]
    }).then((v) => v === true);
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'OK', type = 'text' }) {
    const input = h('input.input', { type, value, placeholder });
    return modal({
        title,
        body: h('div.field', label ? h('label', label) : null, input),
        actions: (close) => [
            h('button.btn.secondary', { onclick: () => close(null) }, 'Cancel'),
            h('button.btn.primary', { onclick: () => close(input.value.trim()) }, confirmLabel)
        ]
    }).then((v) => (v === null || v === '' ? null : v));
}

export async function copyText(text, okMessage = 'Copied to clipboard') {
    try {
        await navigator.clipboard.writeText(text);
        toast(okMessage, { type: 'success', timeout: 1800 });
    } catch (_) {
        toast('Could not copy', { type: 'error' });
    }
}

/** Plain-language message for an error thrown by the main process. */
export function errorText(err) {
    return (err && err.message) ? String(err.message).replace(/^Error:\s*/, '') : 'Something went wrong';
}

/** Play the short success/failure tone if the user left sounds on. */
const sounds = {};
export function playSound(kind, enabled) {
    if (enabled === false) return;
    try {
        sounds[kind] = sounds[kind] || new Audio(`assets/sounds/${kind}.mp3`);
        sounds[kind].currentTime = 0;
        sounds[kind].volume = 0.5;
        sounds[kind].play().catch(() => {});
    } catch (_) { /* sound is optional */ }
}
