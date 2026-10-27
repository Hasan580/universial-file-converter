import { $, h } from './core/dom.js';
import { api } from './core/api.js';
import { app, jobs } from './core/state.js';
import { startRouter, navigate, onRoute } from './core/router.js';
import { buildTopbar, syncNav, mountDock, openPalette, setUpdateDot } from './core/nav.js';
import { toast, errorText } from './core/ui.js';
import { handOver } from './core/handover.js';
import { icon } from './core/icons.js';
import { pathsFromDrop } from './components/dropzone.js';

const MIN_SPLASH_MS = 650;
const started = performance.now();
const splashStatus = (text) => { const el = $('#splash-status'); if (el) el.textContent = text; };

// Keep UI problems visible in the Activity log without ever interrupting the user.
let reported = 0;
function report(message) {
    if (reported++ > 20) return;
    api.logs.add('error', 'ui', String(message).slice(0, 400)).catch(() => {});
}
window.addEventListener('error', (e) => report(e.message));
window.addEventListener('unhandledrejection', (e) => report((e.reason && e.reason.message) || e.reason));

async function boot() {
    document.body.dataset.platform = api.platform();

    splashStatus('Loading your settings');
    const [info, settings] = await Promise.all([api.ready(), api.settings.get()]);
    app.set({ info, settings });

    splashStatus('Preparing converters');
    try { app.set({ catalog: await api.catalog() }); } catch (err) { app.set({ catalog: { audio: [], video: [], image: [], documents: [], resolutions: [] } }); toast(`Could not read the list of formats: ${errorText(err)}`, { type: 'error' }); }

    buildTopbar();
    mountDock();
    app.subscribe(() => syncNav());
    onRoute((name) => { syncNav(name); document.title = name === 'home' ? 'Uni Companion' : `${name[0].toUpperCase()}${name.slice(1)} · Uni Companion`; });
    wireEvents();
    wireKeyboard();
    wireWindowDrop();
    startRouter();
    syncNav();

    const wait = Math.max(0, MIN_SPLASH_MS - (performance.now() - started));
    setTimeout(() => {
        $('#app').classList.add('ready');
        const splash = $('#splash');
        splash.classList.add('done');
        setTimeout(() => splash.remove(), 600);
    }, wait);

    // Non-essential work happens after the first paint.
    setTimeout(afterFirstPaint, 1500);
}

function afterFirstPaint() {
    api.system.alerts().then(showAlerts).catch(() => {});
}

// ------------------------------------------------------------------ events from the main process

function wireEvents() {
    api.on('navigate', (page) => navigate(page));

    api.on('update-available', (u) => {
        app.set({ updateInfo: u });
        setUpdateDot(true);
        toast(`Version ${u.version} is available`, { type: 'info', timeout: 9000, action: { label: 'View', run: () => navigate('updates') } });
    });
    api.on('update-downloaded', () => { setUpdateDot(true); toast('Update ready. Restart to install it.', { type: 'success', timeout: 0, action: { label: 'Restart now', run: () => api.updates.install() } }); });

    api.on('context-menu-convert', (filePath) => handOver([filePath]));

    api.on('auto-organize-file', (e) => {
        if (e.success) toast(`Organised ${e.fileName} into ${e.targetFolder}`, { type: 'success', timeout: 2500 });
    });

    // yt-dlp and its helpers are downloaded the first time they are needed: show that as a normal job.
    const engineJobs = new Set();
    api.on('engine-progress', ({ id, label, percent }) => {
        const jobId = `engine-${id}`;
        if (!engineJobs.has(jobId)) { engineJobs.add(jobId); jobs.start({ id: jobId, kind: 'engine', label }); }
        if (percent >= 100) { jobs.finish(jobId, 'done', { message: label }); engineJobs.delete(jobId); } else jobs.update(jobId, { label, percent });
    });

    // Keep settings in sync if another page changes them.
    app.subscribe((s) => { if (s.updateInfo) setUpdateDot(true); });
}

function wireKeyboard() {
    window.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
        else if (mod && e.key === ',') { e.preventDefault(); navigate('settings'); }
    });
}

// ------------------------------------------------------------------ files dropped on the window

function wireWindowDrop() {
    let depth = 0;
    let veil = null;
    const show = () => {
        if (veil) return;
        veil = h('div.scrim', { style: 'z-index:70;background:rgba(24,23,21,.88);pointer-events:none' },
            h('div.empty', icon('upload'), h('h3', 'Drop to convert'), h('p', 'Release the files anywhere to send them to the right converter.')));
        $('#modal-root').append(veil);
    };
    const hide = () => { depth = 0; if (veil) { veil.remove(); veil = null; } };
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth += 1; show(); } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) hide(); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        hide();
        const { paths } = pathsFromDrop(e.dataTransfer.files);
        if (paths.length && !e.defaultPrevented) handOver(paths);
    });
}

// ------------------------------------------------------------------ remote notices (alerts.json)

function showAlerts(alerts) {
    let dismissed = [];
    try { dismissed = JSON.parse(localStorage.getItem('ufc.alerts') || '[]'); } catch (_) { /* optional */ }
    const live = (alerts || []).filter((a) => a && a.active && !dismissed.includes(`${a.id}@${a.version || 1}`));
    if (!live.length) return;
    const a = live[0];
    // v4's alerts file spells the severity "crictal"; both spellings mean the same thing.
    const critical = a.type === 'critical' || a.type === 'crictal';
    const el = h(`div.notice${critical ? '.warn' : ''}`,
        icon(critical ? 'warning' : 'info'), h('div.grow', String(a.message || '')),
        a.dismissible !== false ? h('button.icon-btn', { style: 'width:24px;height:24px', 'aria-label': 'Dismiss', onclick: () => {
            dismissed.push(`${a.id}@${a.version || 1}`);
            try { localStorage.setItem('ufc.alerts', JSON.stringify(dismissed)); } catch (_) { /* optional */ }
            el.remove();
            $('#banner').hidden = true;
        } }, icon('x', 14)) : null);
    const slot = $('#banner');
    slot.replaceChildren(el);
    slot.hidden = false;
}

boot().catch((err) => {
    console.error(err);
    splashStatus(`Startup problem: ${errorText(err)}`);
    $('#splash').classList.remove('done');
});
