import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { app } from '../core/state.js';
import { navigate, routeParams } from '../core/router.js';
import { toast, errorText, confirmDialog, copyText } from '../core/ui.js';
import { toggle, select, settingRow, sectionCard, notice, field } from '../components/controls.js';
import { pageHead } from '../components/page.js';
import { PAGES } from '../routes.js';
import { bytes } from '../core/format.js';

const BROWSERS = [
    { id: '', label: 'None (recommended unless a site asks you to sign in)' },
    { id: 'firefox', label: 'Firefox (most reliable)' },
    { id: 'chrome', label: 'Chrome' }, { id: 'edge', label: 'Edge' }, { id: 'brave', label: 'Brave' },
    { id: 'opera', label: 'Opera' }, { id: 'vivaldi', label: 'Vivaldi' }, { id: 'chromium', label: 'Chromium' }
];

const FEATURE_LABELS = [
    ['audio', 'Audio converter'], ['video', 'Video converter'], ['image', 'Image converter'], ['compress', 'Image compressor'], ['document', 'Documents and PDF tools'],
    ['download', 'Media downloader'], ['downloads', 'Direct-link downloads'], ['spotify', 'Spotify'],
    ['player', 'Music player'], ['books', 'Books'], ['organizer', 'File organiser'], ['storage', 'Storage analyser'],
    ['ai', 'AI Hub'], ['surf', 'Built-in browser'], ['wallpaper', 'Live wallpaper']
];

async function save(patch) {
    const next = await api.settings.save(patch);
    app.set({ settings: next });
    return next;
}

export default async function settingsPage() {
    const cleanups = [];
    const section = routeParams().get('section') || 'general';
    const s = () => app.get().settings;
    const info = app.get().info || {};
    const isWin = info.platform === 'win32';

    const sections = {
        // ------------------------------------------------------------ general
        async general() {
            const startup = await api.system.launchAtStartup().catch(() => false);
            const menuOn = isWin ? await api.system.contextMenu().catch(() => false) : false;
            return [
                sectionCard('Where files go', 'New conversions and downloads are saved here unless you pick another folder.',
                    h('div.row', h('div.grow.truncate.mono.small', { style: 'color:var(--ink)' }, s().outputDirectory || 'Not set'),
                        h('button.btn.secondary.sm', { onclick: async () => { const d = await api.pick.output(); if (d) { await save({ outputDirectory: d }); navigate('settings', { section: 'general' }); } } }, 'Change'),
                        h('button.btn.ghost.sm', { onclick: () => api.files.openFolder(s().outputDirectory).catch((e) => toast(errorText(e), { type: 'error' })) }, 'Open'))),
                sectionCard('Behaviour', null,
                    settingRow('Notifications', 'Tell me when a long task finishes while the window is hidden.', toggle({ checked: s().showNotifications !== false, onChange: (v) => save({ showNotifications: v }) })),
                    settingRow('Sounds', 'A short tone when a conversion succeeds or fails.', toggle({ checked: s().playSounds !== false, onChange: (v) => save({ playSounds: v }) })),
                    settingRow('Keep running in the tray', info.platform === 'linux' ? 'Closing the window hides it to the tray. Only works on desktops that show tray icons.' : 'Closing the window hides it to the tray instead of quitting, so downloads keep going.',
                        toggle({ checked: !!s().minimizeToTray, onChange: (v) => save({ minimizeToTray: v }) })),
                    settingRow('Start when I sign in', 'Opens hidden in the tray. Needs "Keep running in the tray".',
                        toggle({ checked: startup, onChange: async (v) => { const ok = await api.system.setLaunchAtStartup(v); if (!ok) toast('Could not change this setting.', { type: 'error' }); } })),
                    isWin ? settingRow('Explorer right-click menu', 'Adds "Convert with Uni Companion" to files.',
                        toggle({ checked: menuOn, onChange: async (v) => { await (v ? api.system.registerContextMenu() : api.system.unregisterContextMenu()); } })) : null)
            ];
        },

        // ------------------------------------------------------------ performance
        async performance() {
            const mem = h('span.num', { style: 'color:var(--ink)' }, '...');
            const refresh = () => api.system.memory().then((m) => { mem.textContent = `${m.megabytes} MB across ${m.processes} processes`; }).catch(() => { mem.textContent = 'unavailable'; });
            refresh();
            const timer = setInterval(refresh, 3000);
            cleanups.push(() => clearInterval(timer));
            return [
                sectionCard('Memory', 'Uni Companion is built to stay light. This is what it is using right now.',
                    h('div.row.between', h('span.muted', 'Current use'), mem)),
                sectionCard('Rendering', null,
                    settingRow('Graphics acceleration', 'Off uses about half the memory (around 150 MB less) and is still smooth. Turn it on for the most fluid animations on a fast GPU, or if you use live wallpaper. Takes effect after a restart.',
                        toggle({ checked: s().gpuAcceleration === true, onChange: async (v) => {
                            await save({ gpuAcceleration: v });
                            if (await confirmDialog({ title: 'Restart to apply?', message: 'The app restarts so the change takes effect. Anything running is stopped.', confirmLabel: 'Restart now' })) api.system.restart();
                        } })),
                    settingRow('Free memory while hidden', 'When the app is parked in the tray and idle, the window is closed after a minute and reopens instantly when you need it. Needs "Keep running in the tray".',
                        toggle({ checked: s().reclaimMemory !== false, onChange: (v) => save({ reclaimMemory: v }) })))
            ];
        },

        // ------------------------------------------------------------ downloads
        async downloads() {
            const engineHost = h('div', h('div.skeleton', { style: 'height:96px' }));
            const loadEngine = async () => {
                try {
                    const st = await api.dl.engine();
                    const rows = [
                        ['yt-dlp', st.ytdlp.installed ? st.ytdlp.version || 'installed' : 'not installed yet (downloads on first use)'],
                        ['YouTube helper', st.runtime.kind === 'deno' ? `Deno${st.runtime.managed ? ' (managed)' : ''}` : 'Built-in (Electron). Deno installs automatically if needed.'],
                        ['ffmpeg', (st.ffmpeg.version || 'not found').replace(/^ffmpeg version /, '').split(' ')[0]],
                        ['Firefox profile', st.cookies.firefoxFound ? 'found' : 'not found']
                    ];
                    mount(engineHost, h('dl.kv', rows.map(([k, v]) => [h('dt', k), h('dd', v)])));
                } catch (e) { mount(engineHost, notice(errorText(e), 'error', icon('warning'))); }
            };
            loadEngine();

            const busy = (btn, fn) => async () => {
                btn.disabled = true;
                try { await fn(); } catch (e) { toast(errorText(e), { type: 'error' }); } finally { btn.disabled = false; loadEngine(); }
            };
            const updateBtn = h('button.btn.secondary', 'Update yt-dlp');
            updateBtn.onclick = busy(updateBtn, async () => { const r = await api.dl.updateLibs(); toast(r.ytdlp.updated ? `Updated to ${r.ytdlp.version}` : `Already up to date (${r.ytdlp.version})`, { type: 'success' }); });
            const repairBtn = h('button.btn.secondary', icon('zap'), 'Repair download engine');
            repairBtn.onclick = busy(repairBtn, async () => { await api.dl.repair(); toast('Download engine repaired', { type: 'success' }); });

            const bridge = await api.dm.bridge().catch(() => ({}));
            const cookieFile = s().ytdlpCookiesFile;
            return [
                sectionCard('Download engine', 'yt-dlp does the work. It keeps itself up to date, and the app repairs common failures automatically.',
                    engineHost, h('div.row.wrap', { style: 'margin-top:var(--s-4)' }, updateBtn, repairBtn),
                    h('div', { style: 'margin-top:var(--s-4)' }, settingRow('Keep yt-dlp up to date', 'Checks once a day in the background.', toggle({ checked: s().ytdlpAutoUpdate !== false, onChange: (v) => save({ ytdlpAutoUpdate: v }) })))),
                sectionCard('Signing in to sites', 'Some videos (age-restricted, members-only, or when YouTube asks if you are a bot) need your login. Pick a browser you are signed in with; its cookies are read locally and never leave your computer.',
                    field('Browser cookies', select({ options: BROWSERS, value: s().ytdlpCookiesBrowser || '', onChange: (v) => save({ ytdlpCookiesBrowser: v }) }),
                        'Chrome and Edge now encrypt cookies in a way that often blocks this. Firefox works most reliably.'),
                    h('div.row', { style: 'margin-top:var(--s-3)' },
                        h('div.grow.small.muted.truncate', cookieFile ? `cookies.txt: ${cookieFile}` : 'Or use an exported cookies.txt file'),
                        h('button.btn.secondary.sm', { onclick: async () => { const f = await api.pick.cookieFile(); if (f) { await save({ ytdlpCookiesFile: f }); navigate('settings', { section: 'downloads' }); } } }, 'Choose file'),
                        cookieFile ? h('button.btn.ghost.sm', { onclick: async () => { await save({ ytdlpCookiesFile: '' }); navigate('settings', { section: 'downloads' }); } }, 'Remove') : null)),
                sectionCard('Direct-link downloads', 'The download manager for plain file links and the browser extension.',
                    settingRow('Sort finished files into folders', 'Programs, Documents, Videos, Music, Images, Archives.', toggle({ checked: s().dmAutoArrange !== false, onChange: (v) => api.dm.setAutoArrange(v) })),
                    settingRow('Browser extension bridge', bridge.running ? `Listening on 127.0.0.1:${bridge.port}` : 'Not running',
                        bridge.token ? h('button.btn.secondary.sm', { onclick: () => copyText(bridge.token, 'Token copied') }, icon('copy'), 'Copy token') : null))
            ];
        },

        // ------------------------------------------------------------ features
        async features() {
            const hidden = { ...(s().hiddenFeatures || {}) };
            return [sectionCard('Modules', 'Turn off what you do not use. Hidden modules disappear from the navigation and the search. Nothing is uninstalled.',
                FEATURE_LABELS.filter(([k]) => PAGES[k] || ['download', 'spotify'].includes(k)).map(([key, label]) =>
                    settingRow(label, null, toggle({ checked: !hidden[key], onChange: async (v) => { hidden[key] = !v; await save({ hiddenFeatures: { ...hidden } }); } }))))];
        },

        // ------------------------------------------------------------ updates
        async updates() {
            const mode = info.updateMode;
            return [sectionCard('Updates', null,
                settingRow('Check for updates automatically', 'Looks for new releases shortly after the app starts.', toggle({ checked: s().autoUpdate !== false, onChange: (v) => api.updates.setAuto(v).then(() => save({ autoUpdate: v })) })),
                notice(mode === 'auto'
                    ? 'This install updates itself: new versions download in the background and install when you restart.'
                    : info.platform === 'darwin'
                        ? 'On macOS the app tells you when an update exists and opens the download page. Self-installing needs a signed app.'
                        : 'This copy cannot update itself (portable or package install). The app tells you when a new release exists and opens the download page.', 'ok', icon('info')),
                h('div', { style: 'margin-top:var(--s-4)' }, h('button.btn.secondary', { onclick: () => navigate('updates') }, 'Open the updates page')))];
        },

        // ------------------------------------------------------------ AI
        async ai() {
            const has = await api.ai.hasKey().catch(() => false);
            const key = h('input.input.mono', { type: 'password', placeholder: has ? 'A key is saved. Paste a new one to replace it.' : 'Paste your Gemini API key', autocomplete: 'off' });
            return [sectionCard('AI Hub', 'The AI Hub uses Google Gemini with your own API key. Nothing is sent anywhere until you use it.',
                field('Gemini API key', h('div.input-group', key, h('button.btn.primary', { onclick: async () => { if (!key.value.trim()) return; await api.ai.setKey(key.value.trim()); key.value = ''; toast('Key saved', { type: 'success' }); navigate('settings', { section: 'ai' }); } }, 'Save')),
                    h('a', { href: '#', onclick: (e) => { e.preventDefault(); api.files.url('https://aistudio.google.com/apikey'); } }, 'Get a free key from Google AI Studio')),
                h('div', { style: 'margin-top:var(--s-4)' }, field('Model', h('input.input.mono', { value: s().geminiModel || '', onchange: (e) => save({ geminiModel: e.target.value.trim() }) }))))];
        },

        // ------------------------------------------------------------ maintenance
        async maintenance() {
            return [sectionCard('Housekeeping', null,
                settingRow('Clear temporary files', 'Removes leftovers from interrupted downloads and conversions.',
                    h('button.btn.secondary.sm', { onclick: async () => { const r = await api.files.clearTemp(); toast(`Cleared ${r.count} files (${bytes(r.freedSpace)})`, { type: 'success' }); } }, 'Clear')),
                settingRow('Clear conversion history', 'Removes the list on the History page. Files are not touched.',
                    h('button.btn.danger.sm', { onclick: async () => { if (await confirmDialog({ title: 'Clear history?', message: 'The list of past conversions will be emptied. Your files stay where they are.', confirmLabel: 'Clear', danger: true })) { await api.history.clear(); toast('History cleared', { type: 'success' }); } } }, 'Clear')),
                settingRow('Export activity log', 'Save the log as a text file to attach to a bug report.',
                    h('button.btn.secondary.sm', { onclick: async () => { const p = await api.logs.export(); if (p) toast('Log saved', { type: 'success' }); } }, 'Export')))];
        },

        // ------------------------------------------------------------ about
        async about() {
            const links = [['Source code', 'https://github.com/Hasan580/universial-file-converter'], ['Report a problem', 'https://github.com/Hasan580/universial-file-converter/issues'], ['Releases', 'https://github.com/Hasan580/universial-file-converter/releases']];
            return [sectionCard('Uni Companion', 'Free and open source under the MIT licence.',
                h('dl.kv', [['Version', info.version], ['Platform', `${info.platform} ${info.arch}`], ['Electron', info.electron], ['Chromium', info.chrome], ['Node', info.node]].map(([k, v]) => [h('dt', k), h('dd', v || '')])),
                h('div.row.wrap', { style: 'margin-top:var(--s-5)' }, links.map(([label, url]) => h('button.btn.secondary.sm', { onclick: () => api.files.url(url) }, icon('external'), label)))),
            sectionCard('Credits', 'Interface type: Cormorant Garamond, Inter and JetBrains Mono (SIL Open Font License). Conversion by FFmpeg, sharp, pdf-lib and others. Downloads by yt-dlp.')];
        }
    };

    const tabs = [['general', 'General'], ['performance', 'Performance'], ['downloads', 'Downloads'], ['features', 'Modules'], ['updates', 'Updates'], ['ai', 'AI'], ['maintenance', 'Housekeeping'], ['about', 'About']];
    const body = h('div.col', { style: 'gap:var(--s-4)' }, h('div.skeleton', { style: 'height:180px' }));
    const nav = h('nav', tabs.map(([id, label]) => h('button', { dataset: { id }, 'aria-current': String(id === section), onclick: () => navigate('settings', { section: id }) }, label)));

    const el = h('div.page', pageHead('Settings', 'Everything is saved as you change it.'), h('div.pane', nav, body));
    (sections[section] || sections.general)().then((parts) => mount(body, parts.filter(Boolean))).catch((e) => mount(body, notice(errorText(e), 'error', icon('warning'))));
    return { el, destroy: () => cleanups.forEach((fn) => fn()) };
}
