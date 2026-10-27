import { h, $, mount } from './dom.js';
import { icon, logoMark } from './icons.js';
import { PAGES, GROUPS, groupOf } from '../routes.js';
import { app, jobs } from './state.js';
import { navigate, route } from './router.js';
import { api } from './api.js';
import { modal, toast } from './ui.js';
import { eta as fmtEta, speedX } from './format.js';

/** A page is visible unless the user switched its module off in Settings > Features. */
export function isEnabled(name) {
    const page = PAGES[name];
    if (!page) return false;
    const hidden = (app.get().settings && app.get().settings.hiddenFeatures) || {};
    return !(page.feature && hidden[page.feature]);
}

const isMac = () => api.platform() === 'darwin';

// ---------------------------------------------------------------------------- top bar

export function buildTopbar() {
    const bar = $('#topbar');
    const mod = isMac() ? '⌘' : 'Ctrl';

    const groups = h('nav.groups.no-drag', { 'aria-label': 'Sections' },
        GROUPS.map((g) => h('button.group-tab', { dataset: { group: g.id }, onclick: () => navigate(firstVisible(g)) }, g.label)));

    mount(bar,
        h('button.brand.no-drag', { onclick: () => navigate('home'), title: 'Home', 'aria-label': 'Uni Companion, home' },
            logoMark(26), h('span.brand-name', 'Uni ', h('em', 'Companion'))),
        groups,
        h('div.topbar-end',
            h('button.palette-btn.no-drag', { onclick: openPalette, 'aria-label': 'Search and jump to' },
                icon('search', 15), 'Jump to...', h('kbd', `${mod} K`)),
            h('button.icon-btn.no-drag', { dataset: { page: 'activity' }, title: 'Activity', 'aria-label': 'Activity', onclick: () => navigate('activity') }, icon('terminal', 18)),
            h('button.icon-btn.no-drag', { dataset: { page: 'updates' }, title: 'Updates', 'aria-label': 'Updates', onclick: () => navigate('updates') }, icon('refresh', 18), h('span.dot', { hidden: true, id: 'update-dot' })),
            h('button.icon-btn.no-drag', { dataset: { page: 'settings' }, title: 'Settings', 'aria-label': 'Settings', onclick: () => navigate('settings') }, icon('settings', 18))
        )
    );
}

function firstVisible(group) {
    const pages = Object.keys(PAGES).filter((p) => PAGES[p].group === group.id && isEnabled(p));
    return pages.includes(group.first) ? group.first : (pages[0] || 'home');
}

/** Reflect the current page in the top bar and the second-level tabs. Call after every navigation or settings change. */
export function syncNav(page = route()) {
    const group = groupOf(page);
    $('#topbar').querySelectorAll('.group-tab').forEach((b) => {
        const g = GROUPS.find((x) => x.id === b.dataset.group);
        const visible = Object.keys(PAGES).some((p) => PAGES[p].group === g.id && isEnabled(p));
        b.hidden = !visible;
        b.setAttribute('aria-current', String(b.dataset.group === group));
    });
    $('#topbar').querySelectorAll('.icon-btn[data-page]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.page === page)));

    const sub = $('#subnav');
    if (!group) { sub.hidden = true; sub.replaceChildren(); return; }
    sub.hidden = false;
    mount(sub, Object.keys(PAGES).filter((p) => PAGES[p].group === group && isEnabled(p)).map((p) =>
        h('button.subtab', { 'aria-current': p === page ? 'page' : null, onclick: () => navigate(p) }, icon(PAGES[p].icon), PAGES[p].label)));
}

export function setUpdateDot(on) {
    const dot = $('#update-dot');
    if (dot) dot.hidden = !on;
}

// ---------------------------------------------------------------------------- command palette

const ACTIONS = [
    { label: 'Check for updates', icon: 'refresh', keywords: 'upgrade version', run: () => navigate('updates') },
    { label: 'Open the output folder', icon: 'folderOpen', keywords: 'downloads files', run: async () => { const s = app.get().settings; if (s.outputDirectory) api.files.openFolder(s.outputDirectory).catch(() => {}); } },
    { label: 'Repair the download engine', icon: 'zap', keywords: 'yt-dlp youtube fix', run: () => navigate('settings', { section: 'downloads' }) }
];

export function openPalette() {
    const items = [
        ...Object.keys(PAGES).filter(isEnabled).map((p) => ({ label: PAGES[p].label, icon: PAGES[p].icon, hint: groupOf(p) ? GROUPS.find((g) => g.id === groupOf(p)).label : '', keywords: p, run: () => navigate(p) })),
        ...ACTIONS
    ];
    const input = h('input', { placeholder: 'Jump to a page or run an action', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false' });
    const list = h('div.palette-list', { role: 'listbox' });
    let shown = items;
    let sel = 0;
    let close = () => {};

    const draw = () => {
        mount(list, shown.length ? shown.map((it, i) => h('button.palette-item', {
            role: 'option', 'aria-selected': String(i === sel),
            onmouseenter: () => { sel = i; paint(); },
            onclick: () => { close(null); setTimeout(() => it.run(), 0); }
        }, icon(it.icon), it.label, it.hint ? h('span.hint', it.hint) : null)) : h('div.empty', { style: 'padding:24px' }, 'Nothing matches'));
    };
    const paint = () => [...list.children].forEach((c, i) => c.setAttribute('aria-selected', String(i === sel)));
    input.addEventListener('input', () => {
        const q = input.value.toLowerCase().trim();
        shown = !q ? items : items.filter((it) => `${it.label} ${it.keywords || ''}`.toLowerCase().includes(q));
        sel = 0;
        draw();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); paint(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paint(); e.preventDefault(); }
        else if (e.key === 'Enter' && shown[sel]) { const it = shown[sel]; close(null); setTimeout(() => it.run(), 0); }
    });
    draw();

    // The palette is a modal without the card chrome.
    const root = $('#modal-root');
    const scrim = h('div.scrim');
    const box = h('div.palette', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Jump to' }, input, list);
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    close = () => { document.removeEventListener('keydown', onKey, true); scrim.remove(); };
    scrim.append(box);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
    document.addEventListener('keydown', onKey, true);
    root.append(scrim);
    input.focus();
}

// ---------------------------------------------------------------------------- activity dock

export function mountDock() {
    const dock = $('#dock');
    let open = true;

    const render = () => {
        const list = jobs.list();
        if (!list.length) { dock.replaceChildren(); return; }
        const running = list.filter((j) => j.status === 'running');
        const known = running.filter((j) => Number.isFinite(j.percent));
        const avg = known.length ? Math.round(known.reduce((s, j) => s + j.percent, 0) / known.length) : null;

        if (!open) {
            dock.replaceChildren(h('button.dock-pill', { onclick: () => { open = true; render(); }, 'aria-label': 'Show activity' },
                running.length ? h('span.spinner') : icon('check', 16),
                running.length ? `${running.length} running${avg !== null ? ` · ${avg}%` : ''}` : 'Done'));
            return;
        }
        dock.replaceChildren(h('div.dock-card', { role: 'status', 'aria-live': 'polite' },
            h('div.dock-head',
                h('span.title-sm', running.length ? `${running.length} running` : 'Recent'),
                h('button.icon-btn', { onclick: () => { open = false; render(); }, 'aria-label': 'Minimise', title: 'Minimise' }, icon('minus', 16))),
            list.slice(0, 8).map((j) => h('div.dock-job',
                h('div.row.between', { style: 'margin-bottom:6px;gap:8px' },
                    h('span.truncate', { style: 'color:var(--ink);font-weight:500;max-width:230px' }, j.label),
                    j.status === 'running'
                        ? h('button.btn.ghost.sm', { style: 'height:24px;padding:0 8px', onclick: () => j.cancel && j.cancel() }, 'Cancel')
                        : h(`span.badge.${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'err' : ''}`, j.status === 'done' ? 'Done' : j.status === 'failed' ? 'Failed' : 'Cancelled')),
                h(`div.bar${j.status === 'running' && !Number.isFinite(j.percent) ? '.indeterminate' : ''}${j.status === 'done' ? '.ok' : j.status === 'failed' ? '.err' : ''}`, h('i', { style: Number.isFinite(j.percent) || j.status === 'done' ? `width:${j.status === 'done' ? 100 : j.percent}%` : '' })),
                h('div.tiny.soft', { style: 'margin-top:6px' },
                    j.status === 'failed' ? (j.error || 'Failed')
                        : j.status === 'running' ? [j.phase || (Number.isFinite(j.percent) ? `${Math.round(j.percent)}%` : 'Working...'), j.speed ? ` · ${typeof j.speed === 'number' ? speedX(j.speed) : j.speed}` : '', j.eta ? ` · ${typeof j.eta === 'number' ? fmtEta(j.eta) : j.eta} left` : ''].join('')
                            : (j.message || ''))))));
    };
    jobs.subscribe(render);
    render();
}

export { modal, toast };
