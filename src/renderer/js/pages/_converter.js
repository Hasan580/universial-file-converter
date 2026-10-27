import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { app, jobs, newId } from '../core/state.js';
import { toast, errorText, playSound } from '../core/ui.js';
import { bytes, duration, extname, speedX, eta as fmtEta } from '../core/format.js';
import { dropzone } from '../components/dropzone.js';
import { groupedChips, chips, range, toggle, field, progressBar } from '../components/controls.js';
import { pageHead, prefs } from '../components/page.js';

const sessions = {}; // one per converter, so the queue survives navigating away and back

/**
 * Shared converter page. A config module supplies the formats, option fields and how to call the engine;
 * everything else (queue, drop, progress, history, cancel) lives here.
 *
 * cfg: { key, title, subtitle, kind, accept, historyType, concurrency, formats(catalog), defaultFormat,
 *        categoryOrder, options: [field...], payload(session, item), run(payload), extras?(session) }
 * option field: { id, label, type: 'chips'|'range'|'switch'|'number', default, options?, min,max,step,format, when?(session), help }
 */
export function createConverter(cfg) {
    return async function page() {
        const catalog = app.get().catalog || {};
        const formats = cfg.formats(catalog).filter((f) => f.available); // formats this build cannot write are not offered
        const saved = prefs.get(`conv.${cfg.key}`, {});

        const session = sessions[cfg.key] || (sessions[cfg.key] = {
            items: [],
            format: saved.format && formats.find((f) => f.id === saved.format && f.available) ? saved.format : cfg.defaultFormat,
            opts: Object.fromEntries(cfg.options.map((o) => [o.id, saved.opts && saved.opts[o.id] !== undefined ? saved.opts[o.id] : o.default])),
            outputDir: null,
            running: false,
            cancelled: false
        });
        const outputDir = () => session.outputDir || app.get().settings.outputDirectory || '';
        const formatOf = (id) => formats.find((f) => f.id === id);
        const persist = () => prefs.set(`conv.${cfg.key}`, { format: session.format, opts: session.opts });

        // ---------------------------------------------------------------- queue rows
        const rows = new Map();
        const list = h('div.files');
        const queueHost = h('div');

        const rowStatus = (it) => {
            if (it.status === 'running') {
                const bar = progressBar(it.percent);
                return h('div.file-status', bar, h('div.tiny.soft',
                    Number.isFinite(it.percent) ? `${Math.round(it.percent)}%` : 'Working...',
                    it.speed ? ` · ${speedX(it.speed)}` : '', it.eta ? ` · ${fmtEta(it.eta)} left` : ''));
            }
            if (it.status === 'done') {
                const diff = it.result && it.size ? Math.round((1 - it.result.outputSize / it.size) * 100) : null;
                return h('div.file-status.tiny', { style: 'color:var(--success)' }, `Done · ${bytes(it.result.outputSize)}`,
                    diff !== null && cfg.showSavings ? h('span.soft', ` · ${diff >= 0 ? `${diff}% smaller` : `${-diff}% larger`}`) : null);
            }
            if (it.status === 'failed') return h('div.file-status.tiny', { style: 'color:var(--error-ink)' }, it.error || 'Failed');
            const problem = cfg.validate && cfg.validate(it, session);
            if (problem) return h('div.file-status.tiny', { style: 'color:var(--amber)' }, problem);
            if (it.status === 'cancelled') return h('div.file-status.tiny.soft', 'Cancelled');
            return null;
        };

        const renderRow = (it) => {
            const iconEl = h('div.file-ico', it.thumb ? h('img', { src: it.thumb, alt: '' }) : icon(it.type === 'audio' ? 'audio' : it.type === 'video' ? 'video' : it.type === 'image' ? 'image' : 'document'));
            const meta = h('div.file-meta', it.ext.toUpperCase(), h('span.sep', '·'), bytes(it.size),
                it.info && it.info.duration ? [h('span.sep', '·'), duration(it.info.duration)] : null,
                it.info && it.info.video ? [h('span.sep', '·'), `${it.info.video.width}×${it.info.video.height}`] : null,
                it.info && it.info.width ? [h('span.sep', '·'), `${it.info.width}×${it.info.height}`] : null);
            const actions = h('div.file-actions',
                it.status === 'done' ? [
                    h('button.icon-btn', { title: 'Open', 'aria-label': 'Open converted file', onclick: () => api.files.open(it.result.outputPath) }, icon('play', 16)),
                    h('button.icon-btn', { title: 'Show in folder', 'aria-label': 'Show in folder', onclick: () => api.files.reveal(it.result.outputPath) }, icon('folderOpen', 16))
                ] : null,
                it.status === 'running'
                    ? h('button.icon-btn', { title: 'Cancel', 'aria-label': 'Cancel', onclick: () => api.convert.cancel(it.jobId) }, icon('stop', 16))
                    : h('button.icon-btn', { title: 'Remove', 'aria-label': `Remove ${it.name}`, onclick: () => remove(it.id) }, icon('x', 16)));
            return h(`div.file${it.status === 'done' ? '.done' : it.status === 'failed' ? '.failed' : ''}`, { dataset: { id: it.id, type: it.type } },
                iconEl, h('div', { style: 'min-width:0' }, h('div.file-name.truncate', { title: it.path }, it.name), meta, rowStatus(it)), actions);
        };

        const refreshRow = (it) => {
            const old = rows.get(it.id);
            if (!old || !old.isConnected) return;
            const next = renderRow(it);
            old.replaceWith(next);
            rows.set(it.id, next);
        };

        const redrawQueue = () => {
            rows.clear();
            list.replaceChildren(...session.items.map((it) => { const r = renderRow(it); rows.set(it.id, r); return r; }));
            queueHost.replaceChildren(session.items.length ? list : '');
            dz.classList.toggle('compact', session.items.length > 0);
            refreshSummary();
        };

        const remove = (id) => {
            const it = session.items.find((x) => x.id === id);
            if (!it || it.status === 'running') return;
            session.items = session.items.filter((x) => x.id !== id);
            redrawQueue();
        };

        // ---------------------------------------------------------------- adding files
        async function addFiles(paths) {
            const known = new Set(session.items.map((i) => i.path));
            const fresh = paths.filter((p) => !known.has(p));
            if (!fresh.length) { toast('Those files are already in the list.', { type: 'info' }); return; }
            let infos = [];
            try { infos = await api.files.infoMany(fresh); } catch (err) { toast(errorText(err), { type: 'error' }); return; }
            for (const info of infos) {
                const item = { id: newId('f'), path: info.path, name: info.name, size: info.size, ext: info.extension || extname(info.path), type: info.type, status: 'queued', percent: null };
                session.items.push(item);
                enrich(item);
            }
            redrawQueue();
        }

        // Thumbnails and durations arrive after the row is already on screen.
        async function enrich(item) {
            try {
                if (item.type === 'image' || cfg.thumbs) {
                    const [thumb, info] = await Promise.all([api.files.thumb(item.path, 96).catch(() => null), api.files.imageInfo(item.path).catch(() => null)]);
                    item.thumb = thumb; item.info = info;
                } else if (item.type === 'audio' || item.type === 'video') {
                    item.info = await api.files.probe(item.path).catch(() => null);
                }
                refreshRow(item);
            } catch (_) { /* previews are optional */ }
        }

        // ---------------------------------------------------------------- running
        async function convertOne(item) {
            const id = newId(cfg.key);
            item.jobId = id; item.status = 'running'; item.percent = null; item.error = null;
            refreshRow(item);
            const fmt = formatOf(session.format);
            jobs.start({ id, kind: cfg.key, label: `${item.name} → ${fmt ? fmt.label : session.format}`, cancel: () => api.convert.cancel(id) });
            const payload = { ...cfg.payload(session, item), id, inputPath: item.path, outputFormat: session.format, outputDirectory: outputDir() };
            try {
                const result = await cfg.run(payload);
                item.status = 'done'; item.result = result; item.percent = 100;
                jobs.finish(id, 'done', { message: bytes(result.outputSize) });
                recordHistory(item, 'success');
            } catch (err) {
                if (err.cancelled || session.cancelled) {
                    item.status = 'cancelled';
                    jobs.finish(id, 'cancelled');
                } else {
                    item.status = 'failed'; item.error = errorText(err);
                    jobs.finish(id, 'failed', { error: item.error });
                    recordHistory(item, 'failed', item.error);
                }
            }
            refreshRow(item);
        }

        function recordHistory(item, status, error) {
            api.history.add({
                type: cfg.historyType || cfg.key, inputName: item.name,
                outputPath: status === 'success' ? item.result.outputPath : null,
                inputSize: item.size, outputSize: status === 'success' ? item.result.outputSize : 0,
                timestamp: Date.now(), status, format: session.format, ...(error ? { error } : {})
            }).catch(() => {});
            if (status === 'success') {
                api.history.stats().then((s) => api.history.saveStats({
                    totalConverted: (s.totalConverted || 0) + 1,
                    totalSavedBytes: (s.totalSavedBytes || 0) + Math.max(0, item.size - item.result.outputSize),
                    lastUpdated: Date.now()
                })).catch(() => {});
            }
        }

        async function run() {
            if (session.running) return;
            const todo = session.items.filter((i) => (i.status === 'queued' || i.status === 'failed' || i.status === 'cancelled') && !(cfg.validate && cfg.validate(i, session)));
            if (!todo.length) { toast('None of the files in the list can be converted to that format.', { type: 'warning' }); return; }
            session.running = true; session.cancelled = false;
            refreshSummary();
            let index = 0;
            const worker = async () => { while (index < todo.length && !session.cancelled) { const it = todo[index++]; await convertOne(it); } };
            await Promise.all(Array.from({ length: Math.min(cfg.concurrency || 1, todo.length) }, worker));
            for (const it of todo) if (it.status === 'queued') { it.status = 'cancelled'; refreshRow(it); }
            session.running = false;
            refreshSummary();

            const ok = todo.filter((i) => i.status === 'done').length;
            const bad = todo.filter((i) => i.status === 'failed').length;
            if (ok || bad) {
                const s = app.get().settings;
                playSound(bad && !ok ? 'failed' : 'success', s.playSounds);
                toast(bad ? `${ok} converted, ${bad} failed` : `${ok} file${ok > 1 ? 's' : ''} converted`, { type: bad ? 'warning' : 'success', action: ok ? { label: 'Show folder', run: () => api.files.reveal(todo.find((i) => i.status === 'done').result.outputPath) } : null });
                if (document.hidden) api.files.notify('Conversion finished', bad ? `${ok} converted, ${bad} failed` : `${ok} file${ok > 1 ? 's' : ''} ready`);
            }
        }

        function cancelAll() {
            session.cancelled = true;
            session.items.filter((i) => i.status === 'running').forEach((i) => api.convert.cancel(i.jobId));
        }

        // ---------------------------------------------------------------- settings panel
        const summary = h('div.small.muted', { style: 'text-align:center' });
        const primary = h('button.btn.primary.lg.block', { onclick: run });
        const cancelBtn = h('button.btn.secondary.block', { onclick: cancelAll }, icon('stop'), 'Cancel');
        const outLabel = h('div.truncate.small', { style: 'color:var(--ink)' });

        function refreshSummary() {
            const waiting = session.items.filter((i) => (i.status === 'queued' || i.status === 'failed' || i.status === 'cancelled') && !(cfg.validate && cfg.validate(i, session))).length;
            const fmt = formatOf(session.format);
            primary.disabled = session.running || !waiting;
            primary.replaceChildren(session.running ? h('span.spinner') : icon('zap'), session.running ? 'Converting...' : waiting ? `Convert ${waiting} file${waiting > 1 ? 's' : ''}` : 'Add files to start');
            cancelBtn.hidden = !session.running;
            summary.textContent = session.items.length ? `${session.items.length} file${session.items.length > 1 ? 's' : ''} → ${fmt ? fmt.label : session.format}` : '';
            outLabel.textContent = outputDir() || 'Not set';
            outLabel.title = outputDir();
        }

        const formatPicker = (() => {
            const order = cfg.categoryOrder || [];
            const byCat = new Map();
            for (const f of formats) {
                if (!byCat.has(f.category)) byCat.set(f.category, []);
                byCat.get(f.category).push({ id: f.id, label: f.label, disabled: !f.available, title: f.available ? null : 'Not available in this build' });
            }
            const groups = [...byCat.entries()].sort((a, b) => (order.indexOf(a[0]) + 100 * (order.indexOf(a[0]) < 0)) - (order.indexOf(b[0]) + 100 * (order.indexOf(b[0]) < 0)));
            return groupedChips({ groups, value: session.format, onChange: (v) => { session.format = v; persist(); drawOptions(); redrawQueue(); } });
        })();

        const optionsHost = h('div.col', { style: 'gap:18px' });
        function drawOptions() {
            const fmt = formatOf(session.format) || {};
            optionsHost.replaceChildren(...cfg.options.filter((o) => !o.when || o.when(session, fmt)).map((o) => {
                const set = (v) => { session.opts[o.id] = v; persist(); };
                const cur = session.opts[o.id];
                let control;
                if (o.type === 'chips') control = chips({ options: o.options, value: cur, onChange: set, label: o.label });
                else if (o.type === 'range') control = range({ min: o.min, max: o.max, step: o.step, value: cur, format: o.format, onChange: set });
                else if (o.type === 'switch') {
                    return h('div.row.between', h('div', h('div.label', o.label), o.help ? h('div.tiny.soft', o.help) : null), toggle({ checked: !!cur, onChange: set, label: o.label }));
                } else if (o.type === 'number') {
                    control = h('input.input', { type: 'number', min: o.min || 0, placeholder: o.placeholder || '', value: cur || '', oninput: (e) => set(e.target.value ? Number(e.target.value) : null) });
                }
                return field(o.label, control, o.help);
            }));
        }

        const settingsCard = h('section.card',
            h('h3.title-md', { style: 'margin-bottom:var(--s-4)' }, 'Convert to'),
            formatPicker,
            cfg.options.length ? [h('hr'), optionsHost] : null,
            h('hr'),
            h('div.field', h('label', 'Save to'),
                h('div.row', outLabel,
                    h('button.btn.secondary.sm', { style: 'margin-left:auto', onclick: async () => { const d = await api.pick.output(); if (d) { session.outputDir = d; refreshSummary(); } } }, 'Change'))),
            h('div.col', { style: 'margin-top:var(--s-5);gap:var(--s-2)' }, primary, cancelBtn, summary));

        // ---------------------------------------------------------------- page
        const dz = dropzone({
            title: cfg.dropTitle || `Drop ${cfg.noun || 'files'} here`,
            subtitle: cfg.dropSubtitle || 'or click to choose from your computer', kind: cfg.kind, accept: cfg.accept, onFiles: addFiles
        });

        const main = h('div.col', { style: 'gap:var(--s-4)' }, dz, queueHost,
            cfg.hint ? h('p.small.soft', { style: 'margin:0' }, cfg.hint) : null,
            ...(cfg.extras ? [cfg.extras(session, addFiles)] : []));

        const el = h('div.page', pageHead(cfg.title, cfg.subtitle, cfg.headActions ? cfg.headActions() : null),
            h('div.workspace', main, h('aside', settingsCard)));

        drawOptions();
        redrawQueue();

        // Files handed over by the OS (context menu, dropped on the window) for this converter.
        const pending = app.get().pendingFiles.filter((p) => cfg.accept.includes(extname(p)));
        if (pending.length) {
            app.set({ pendingFiles: app.get().pendingFiles.filter((p) => !pending.includes(p)) });
            addFiles(pending);
        }

        const off = api.on('conversion-progress', ({ id, progress, speed, eta }) => {
            const it = session.items.find((i) => i.jobId === id);
            if (!it || it.status !== 'running') return;
            it.percent = progress; it.speed = speed; it.eta = eta;
            jobs.update(id, { percent: progress, speed, eta });
            const row = rows.get(it.id);
            if (!row || !row.isConnected) return;
            const status = row.querySelector('.file-status');
            if (!status) { refreshRow(it); return; }
            const bar = status.querySelector('.bar');
            bar.className = `bar${Number.isFinite(progress) ? '' : ' indeterminate'}`;
            bar.firstChild.style.width = Number.isFinite(progress) ? `${progress}%` : '';
            status.lastChild.textContent = `${Number.isFinite(progress) ? `${Math.round(progress)}%` : 'Working...'}${speed ? ` · ${speedX(speed)}` : ''}${eta ? ` · ${fmtEta(eta)} left` : ''}`;
        });

        return { el, destroy: () => off() };
    };
}
