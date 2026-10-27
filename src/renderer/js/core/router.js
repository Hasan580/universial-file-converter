import { PAGES } from '../routes.js';
import { h, $ } from './dom.js';
import { icon } from './icons.js';

/** Hash router. Pages load lazily the first time they are visited, so startup only pays for Home. */
const listeners = new Set();
let current = null;     // { name, instance }
let token = 0;

export const route = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'home');
export const onRoute = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function navigate(name, params) {
    const query = params ? `?${new URLSearchParams(params)}` : '';
    const next = `#/${name}${query}`;
    if (location.hash === next) render();
    else location.hash = next;
}

export function routeParams() {
    const q = location.hash.split('?')[1];
    return new URLSearchParams(q || '');
}

function skeleton() {
    return h('div.page', h('div.skeleton', { style: 'height:44px;width:280px;margin-bottom:16px' }), h('div.skeleton', { style: 'height:18px;width:420px;margin-bottom:32px' }),
        h('div.grid.cols-2', h('div.skeleton', { style: 'height:240px' }), h('div.skeleton', { style: 'height:240px' })));
}

export async function render() {
    const view = $('#view');
    const name = PAGES[route()] ? route() : 'home';
    const mine = ++token;

    if (current && current.instance && typeof current.instance.destroy === 'function') {
        try { current.instance.destroy(); } catch (_) { /* a page failing to clean up must not block navigation */ }
    }
    current = null;
    view.replaceChildren(skeleton());

    try {
        const mod = await PAGES[name].load();
        if (mine !== token) return; // the user already went somewhere else
        const instance = await mod.default({ params: routeParams() });
        if (mine !== token) { if (instance && instance.destroy) instance.destroy(); return; }
        current = { name, instance };
        view.replaceChildren(instance.el);
        view.scrollTop = 0;
    } catch (err) {
        if (mine !== token) return;
        console.error(`Page "${name}" failed to load`, err);
        view.replaceChildren(h('div.page',
            h('div.empty', icon('warning'), h('h3', 'This page could not load'),
                h('p', String((err && err.message) || err)),
                h('div', { style: 'margin-top:16px' }, h('button.btn.secondary', { onclick: () => render() }, 'Try again')))));
    }
    listeners.forEach((fn) => fn(name));
}

export function startRouter() {
    window.addEventListener('hashchange', render);
    render();
}
