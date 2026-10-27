import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, errorText, promptDialog, confirmDialog } from '../core/ui.js';
import { pageHead, tabs } from '../components/page.js';
import { emptyState } from '../components/controls.js';

const HOME = 'https://www.google.com/';
const toUrl = (text) => {
    const t = text.trim();
    if (!t) return HOME;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t)) return `https://${t}`;
    return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
};

/** An in-app browser with its own session and a built-in ad blocker. Pages never get access to the app. */
export default async function surf() {
    let tab = 'browse';
    const body = h('div');
    await api.surf.init().catch((e) => toast(errorText(e), { type: 'warning' }));

    const url = h('input.input', { placeholder: 'Search or enter a web address', 'aria-label': 'Address' });
    const web = document.createElement('webview');
    web.setAttribute('partition', 'persist:surf-web');
    web.setAttribute('src', HOME);
    const nav = (fn) => () => { try { fn(); } catch (_) { /* webview not ready yet */ } };
    const back = h('button.icon-btn', { title: 'Back', 'aria-label': 'Back', onclick: nav(() => web.goBack()) }, icon('back', 18));
    const fwd = h('button.icon-btn', { title: 'Forward', 'aria-label': 'Forward', onclick: nav(() => web.goForward()) }, icon('forward', 18));
    const reload = h('button.icon-btn', { title: 'Reload', 'aria-label': 'Reload', onclick: nav(() => web.reload()) }, icon('refresh', 18));
    const go = () => { web.loadURL(toUrl(url.value)).catch(() => {}); };
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    web.addEventListener('did-navigate', (e) => { url.value = e.url; });
    web.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) url.value = e.url; });
    web.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3 && e.isMainFrame) toast(`Could not load the page (${e.errorDescription})`, { type: 'warning' }); });

    const shell = h('div.browser-shell', h('div.browser-bar', back, fwd, reload, h('div.grow', url), h('button.btn.secondary.sm', { onclick: () => api.files.url(web.getURL ? web.getURL() : url.value) }, icon('external'), 'Open in browser')), web);

    async function drawExtensions() {
        const list = await api.surf.list().catch(() => []);
        const rows = Array.isArray(list) ? list : (list.extensions || []);
        mount(body, h('div.row.wrap', { style: 'margin-bottom:var(--s-4)' },
            h('button.btn.primary', { onclick: async () => { const input = await promptDialog({ title: 'Install from the Chrome Web Store', label: 'Extension link or ID', placeholder: 'https://chromewebstore.google.com/detail/...', confirmLabel: 'Install' }); if (!input) return; try { await api.surf.installStore(input); toast('Extension installed', { type: 'success' }); drawExtensions(); } catch (e) { toast(errorText(e), { type: 'error' }); } } }, icon('plus'), 'From the Web Store'),
            h('button.btn.secondary', { onclick: async () => { const f = await api.surf.pickFolder(); if (!f) return; try { await api.surf.loadFolder(f.path || f); toast('Extension loaded', { type: 'success' }); drawExtensions(); } catch (e) { toast(errorText(e), { type: 'error' }); } } }, icon('folder'), 'Load an unpacked folder')),
            rows.length ? h('section.card.tight', rows.map((x) => h('div.list-row', h('div.file-ico', { style: 'width:36px;height:36px;flex:none' }, icon('package', 18)),
                h('div.grow', h('div', { style: 'color:var(--ink);font-weight:500' }, x.name || x.id), h('div.tiny.soft', [x.version, x.source].filter(Boolean).join(' · '))),
                h('button.icon-btn', { title: 'Remove', 'aria-label': 'Remove', onclick: async () => { if (await confirmDialog({ title: 'Remove this extension?', message: x.name || x.id, confirmLabel: 'Remove', danger: true })) { await api.surf.remove(x.id || x.path); drawExtensions(); } } }, icon('trash', 16)))))
                : emptyState({ icon: icon('package'), title: 'No extensions', text: 'Install a Chrome extension to use it in the built-in browser. Support covers many, not all.' }));
    }

    const draw = () => { if (tab === 'extensions') drawExtensions(); else mount(body, shell); };
    const tabBar = tabs([{ id: 'browse', label: 'Browse' }, { id: 'extensions', label: 'Extensions' }], tab, (id) => { tab = id; draw(); });
    const el = h('div.page.wide', pageHead('Browser', 'A small private browser inside the app, with an ad blocker. Handy for lookups while you work.'), tabBar, body);
    draw();
    return { el };
}
