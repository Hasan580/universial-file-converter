import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { app, jobs, newId } from '../core/state.js';
import { navigate } from '../core/router.js';
import { toast, playSound } from '../core/ui.js';
import { chips, toggle, select, field, notice, progressBar } from '../components/controls.js';
import { pageHead, prefs } from '../components/page.js';
import { bytes, duration } from '../core/format.js';

const session = { queue: [], info: null, playlist: null, view: null };

// Registered once for the whole session so progress keeps updating while the user is on another page.
let listening = false;
function listen() {
    if (listening) return;
    listening = true;
    api.on('download-progress', (p) => {
        const it = session.queue.find((q) => q.id === p.id);
        if (!it || it.status !== 'running') return;
        it.percent = p.progress;
        it.phase = p.status || (p.phase === 'audio' ? 'Downloading audio' : p.phase === 'merge' ? 'Processing' : 'Downloading');
        it.note = p.phase === 'recover' ? p.status : [it.phase, p.speed, p.eta ? `${p.eta} left` : ''].filter(Boolean).join(' · ');
        jobs.update(p.id, { percent: p.progress, phase: it.note });
        const host = session.view && session.view.queueHost;
        const rowEl = host && host.querySelector(`[data-id="${p.id}"]`);
        if (!rowEl) return;
        const barEl = rowEl.querySelector('.bar');
        if (barEl) { barEl.className = 'bar'; barEl.firstChild.style.width = `${p.progress || 0}%`; }
        const line = rowEl.querySelector('.dl-line');
        if (line) line.textContent = it.note;
    });
}

const AUDIO_FORMATS = [{ id: 'mp3', label: 'MP3' }, { id: 'm4a', label: 'M4A' }, { id: 'flac', label: 'FLAC' }, { id: 'opus', label: 'Opus' }, { id: 'wav', label: 'WAV' }];
const looksLikePlaylist = (u) => /[?&]list=|\/playlist\b|\/sets\/|\/album\//i.test(u);

export default async function download() {
    listen();
    const saved = prefs.get('dl.options', { mode: 'video', quality: 'best', vformat: 'mp4', aformat: 'mp3', abr: '192', subs: false, thumb: false, lang: 'en' });
    const opt = { ...saved };
    const persist = () => prefs.set('dl.options', opt);

    // ------------------------------------------------------------ engine readiness
    const engineBanner = h('div');
    api.dl.check().then((r) => {
        if (r.available) return;
        mount(engineBanner, notice(`The download engine could not be set up: ${r.error || 'unknown problem'}. Check your connection, then open Settings > Downloads > Repair.`, 'error', icon('warning')));
    }).catch(() => {});

    // ------------------------------------------------------------ link input
    const input = h('input.input', { type: 'url', placeholder: 'Paste a video, music or playlist link', 'aria-label': 'Link', spellcheck: 'false', autocomplete: 'off' });
    const fetchBtn = h('button.btn.primary', icon('search'), 'Look up');
    const detail = h('div');
    const status = h('div.small.soft');

    async function lookup() {
        const url = input.value.trim();
        if (!/^https?:\/\//i.test(url)) { toast('Paste a full link that starts with http or https.', { type: 'warning' }); return; }
        fetchBtn.disabled = true;
        session.info = null; session.playlist = null;
        mount(detail, h('div.skeleton', { style: 'height:180px' }));
        status.style.marginTop = '8px';
        status.textContent = 'Reading the link...';
        const off = api.on('download-status', ({ note }) => { status.textContent = note; });
        try {
            if (looksLikePlaylist(url) && !/[?&]v=/.test(url) || /\/playlist\b/.test(url)) {
                session.playlist = await api.dl.playlist(url);
                session.playlist.url = url;
            } else {
                session.info = await api.dl.info(url);
            }
            status.textContent = ''; status.style.marginTop = '';
            drawDetail();
        } catch (err) {
            status.textContent = ''; status.style.marginTop = '';
            mount(detail, failure(err));
        } finally { off(); fetchBtn.disabled = false; }
    }
    fetchBtn.onclick = lookup;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });

    // ------------------------------------------------------------ failure with the right next step
    function failure(err) {
        const fix = (() => {
            if (['bot', 'age', 'login'].includes(err.kind)) return h('button.btn.secondary.sm', { onclick: () => navigate('settings', { section: 'downloads' }) }, icon('settings'), 'Sign-in settings');
            if (['ejs', 'ffmpeg'].includes(err.kind)) return h('button.btn.secondary.sm', { onclick: () => navigate('settings', { section: 'downloads' }) }, icon('zap'), 'Repair the engine');
            return null;
        })();
        return h('div.notice.error', icon('warning'), h('div.grow', h('div', { style: 'color:var(--ink);font-weight:500' }, err.message || 'Something went wrong'),
            err.attempts && err.attempts.length > 1 ? h('div.tiny.soft', { style: 'margin-top:4px' }, `The app already tried ${err.attempts.length} different approaches.`) : null,
            fix ? h('div', { style: 'margin-top:10px' }, fix) : null));
    }

    // ------------------------------------------------------------ options + download
    function currentOptions() {
        const audio = opt.mode === 'audio';
        return {
            format: audio ? opt.aformat : opt.vformat,
            audioOnly: audio,
            quality: audio ? 'best' : opt.quality,
            audioBitrate: opt.abr,
            downloadSubtitles: !audio && opt.subs,
            subtitleLanguage: opt.lang,
            downloadThumbnail: opt.thumb
        };
    }

    function optionsPanel(info) {
        const heights = [...new Set((info && info.formats ? info.formats.video : []).map((v) => v.height))].sort((a, b) => b - a);
        const qualityOptions = [{ id: 'best', label: 'Best available' }, ...heights.map((hgt) => ({ id: String(hgt), label: `${hgt}p` }))];
        if (!qualityOptions.some((q) => q.id === opt.quality)) opt.quality = 'best';
        const host = h('div.col', { style: 'gap:var(--s-4)' });

        const draw = () => {
            const audio = opt.mode === 'audio';
            mount(host,
                field('Save as', chips({ options: [{ id: 'video', label: 'Video' }, { id: 'audio', label: 'Audio only' }], value: opt.mode, onChange: (v) => { opt.mode = v; persist(); draw(); } })),
                audio
                    ? [field('Format', chips({ options: AUDIO_FORMATS, value: opt.aformat, onChange: (v) => { opt.aformat = v; persist(); } })),
                        opt.aformat !== 'flac' && opt.aformat !== 'wav' ? field('Quality', chips({ options: ['128', '192', '256', '320'].map((b) => ({ id: b, label: `${b} kbps` })), value: opt.abr, onChange: (v) => { opt.abr = v; persist(); } })) : null]
                    : [field('Quality', chips({ options: qualityOptions, value: opt.quality, onChange: (v) => { opt.quality = v; persist(); } })),
                        field('Format', chips({ options: [{ id: 'mp4', label: 'MP4 (plays everywhere)' }, { id: 'webm', label: 'WebM' }], value: opt.vformat, onChange: (v) => { opt.vformat = v; persist(); } }))],
                h('div.row.between', h('span.label', 'Save the thumbnail image too'), toggle({ checked: opt.thumb, onChange: (v) => { opt.thumb = v; persist(); } })),
                !audio && info && (info.hasSubtitles || info.hasAutoSubtitles) ? h('div.col', { style: 'gap:8px' },
                    h('div.row.between', h('span.label', 'Subtitles'), toggle({ checked: opt.subs, onChange: (v) => { opt.subs = v; persist(); draw(); } })),
                    opt.subs ? select({ options: (info.availableSubtitleLangs || ['en']).map((l) => ({ id: l.split(' ')[0], label: l })), value: opt.lang, onChange: (v) => { opt.lang = v; persist(); } }) : null) : null);
        };
        draw();
        return host;
    }

    async function start(entry) {
        const id = newId('dl');
        const item = { id, title: entry.title || entry.url, thumb: entry.thumbnail || null, url: entry.url, status: 'running', percent: 0, phase: 'Starting...', note: '', opts: currentOptions() };
        session.queue.unshift(item);
        drawQueue();
        jobs.start({ id, kind: 'download', label: item.title, cancel: () => api.dl.cancel(id) });
        try {
            const r = await api.dl.start({ id, url: entry.url, ...item.opts });
            item.status = 'done'; item.result = r; item.percent = 100;
            jobs.finish(id, 'done', { message: bytes(r.outputSize) });
            api.history.add({ type: 'download', inputName: item.title, outputPath: r.outputPath, inputSize: 0, outputSize: r.outputSize, timestamp: Date.now(), status: 'success', format: item.opts.format }).catch(() => {});
            playSound('success', app.get().settings.playSounds);
            if (r.recoveries) toast(`Finished after ${r.recoveries} automatic repair${r.recoveries > 1 ? 's' : ''}.`, { type: 'success', timeout: 3500 });
        } catch (err) {
            if (err.cancelled) { item.status = 'cancelled'; jobs.finish(id, 'cancelled'); }
            else {
                item.status = 'failed'; item.error = err;
                jobs.finish(id, 'failed', { error: err.message });
                api.history.add({ type: 'download', inputName: item.title, outputPath: null, inputSize: 0, outputSize: 0, timestamp: Date.now(), status: 'failed', error: err.message }).catch(() => {});
                playSound('failed', app.get().settings.playSounds);
            }
        }
        drawQueue();
    }

    function drawDetail() {
        if (session.info) {
            const i = session.info;
            mount(detail, h('section.card', h('div.media-card',
                h('div', h('div.thumb', i.thumbnail ? h('img', { src: i.thumbnail, alt: '' }) : icon('video', 32)),
                    h('div.row.wrap', { style: 'margin-top:12px;gap:6px' }, i.site ? h('span.badge', i.site) : null, i.isLive ? h('span.badge.warn', 'Live') : null, i.duration ? h('span.badge', duration(i.duration)) : null)),
                h('div.col', { style: 'gap:var(--s-4)' },
                    h('div', h('h2.title-md', { style: 'margin-bottom:4px' }, i.title), h('div.small.muted', i.uploader)),
                    optionsPanel(i),
                    h('button.btn.primary.lg', { onclick: () => start({ ...i }) }, icon('download'), opt.mode === 'audio' ? 'Download audio' : 'Download video')))));
        } else if (session.playlist) {
            const p = session.playlist;
            const picked = new Set(p.entries.map((e) => e.url));
            const countLabel = h('span.small.muted');
            const upd = () => { countLabel.textContent = `${picked.size} of ${p.entries.length} selected`; };
            const rows = p.entries.map((e) => h('label.list-row', { style: 'cursor:pointer' },
                h('input', { type: 'checkbox', checked: true, onchange: (ev) => { if (ev.target.checked) picked.add(e.url); else picked.delete(e.url); upd(); } }),
                h('div.grow.truncate', { style: 'color:var(--ink)' }, e.title), h('span.tiny.soft', e.duration ? duration(e.duration) : '')));
            upd();
            mount(detail, h('section.card',
                h('div.row.between.wrap', h('div', h('h2.title-md', p.title), h('div.small.muted', `${p.count} items${p.uploader ? ` · ${p.uploader}` : ''}`)), countLabel),
                h('hr'), h('div.grid.cols-2', { style: 'gap:var(--s-5)' },
                    h('div', { style: 'max-height:340px;overflow:auto;padding-right:8px' }, rows),
                    h('div.col', { style: 'gap:var(--s-4)' }, optionsPanel(null),
                        h('button.btn.primary.lg', { onclick: async () => {
                            const chosen = p.entries.filter((e) => picked.has(e.url));
                            if (!chosen.length) return;
                            toast(`Downloading ${chosen.length} items one after another`, { type: 'info' });
                            for (const e of chosen) await start({ title: e.title, url: e.url, thumbnail: e.thumbnail });
                        } }, icon('download'), 'Download selected')))));
        }
    }

    // ------------------------------------------------------------ queue
    const queueHost = h('div');
    function drawQueue() {
        if (session.view && session.view.queueHost !== queueHost) return; // a newer copy of the page owns the list
        mount(queueHost, session.queue.length ? [
            h('div.row.between', { style: 'margin:var(--s-7) 0 var(--s-3)' }, h('h2.title-lg', 'Downloads'),
                h('button.btn.ghost.sm', { onclick: () => { session.queue = session.queue.filter((q) => q.status === 'running'); drawQueue(); } }, 'Clear finished')),
            h('div.files', session.queue.map(row))] : '');
    }

    function row(it) {
        const bar = progressBar(it.status === 'running' && it.percent ? it.percent : (it.status === 'running' ? null : it.percent), it.status === 'done' ? 'ok' : it.status === 'failed' ? 'err' : '');
        return h(`div.file${it.status === 'done' ? '.done' : it.status === 'failed' ? '.failed' : ''}`, { dataset: { id: it.id, type: 'video' } },
            h('div.file-ico', it.thumb ? h('img', { src: it.thumb, alt: '' }) : icon(it.opts.audioOnly ? 'audio' : 'video')),
            h('div', { style: 'min-width:0' },
                h('div.file-name.truncate', it.title),
                h('div.file-status', it.status === 'running' ? [bar, h('div.tiny.soft.dl-line', it.note || it.phase)]
                    : it.status === 'done' ? h('div.tiny', { style: 'color:var(--success)' }, `Saved · ${bytes(it.result.outputSize)}`)
                        : it.status === 'failed' ? failure(it.error)
                            : h('div.tiny.soft', 'Cancelled'))),
            h('div.file-actions',
                it.status === 'running' ? h('button.icon-btn', { title: 'Cancel', 'aria-label': 'Cancel', onclick: () => api.dl.cancel(it.id) }, icon('stop', 16))
                    : [it.status === 'done' ? [h('button.icon-btn', { title: 'Open', 'aria-label': 'Open', onclick: () => api.files.open(it.result.outputPath) }, icon('play', 16)),
                        h('button.icon-btn', { title: 'Show in folder', 'aria-label': 'Show in folder', onclick: () => api.files.reveal(it.result.outputPath) }, icon('folderOpen', 16))] : null,
                    it.status !== 'done' ? h('button.icon-btn', { title: 'Try again', 'aria-label': 'Try again', onclick: () => { session.queue = session.queue.filter((q) => q.id !== it.id); start({ title: it.title, url: it.url, thumbnail: it.thumb }); } }, icon('refresh', 16)) : null,
                    h('button.icon-btn', { title: 'Remove', 'aria-label': 'Remove', onclick: () => { session.queue = session.queue.filter((q) => q.id !== it.id); drawQueue(); } }, icon('x', 16))]));
    }

    session.view = { queueHost };

    const el = h('div.page', pageHead('Download media', 'Save video or audio from YouTube and thousands of other sites. If a site changes how it works, the app repairs the download by itself.'),
        engineBanner,
        h('section.card.raised', h('div.input-group', input, fetchBtn), status),
        h('div', { style: 'height:var(--s-4)' }), detail, queueHost);
    drawDetail();
    drawQueue();
    return { el, destroy: () => { session.view = null; } };
}
