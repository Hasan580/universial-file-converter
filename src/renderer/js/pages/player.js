import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, errorText } from '../core/ui.js';
import { pageHead, tabs } from '../components/page.js';
import { emptyState } from '../components/controls.js';
import { duration, fileUrl, stem, extname } from '../core/format.js';
import { newId } from '../core/state.js';

/**
 * One audio element for the whole session, so music keeps playing while you use other pages.
 * The page only draws controls around it.
 */
const media = new Audio();
media.preload = 'auto';
const P = { queue: [], index: -1, shuffle: false, repeat: 'off', lyrics: [], art: null, view: null };
media.volume = 0.8;

const current = () => P.queue[P.index] || null;

function parseLrc(text) {
    const lines = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
        const m = raw.match(/^\s*((?:\[\d+:\d+(?:[.:]\d+)?\])+)\s*(.*)$/);
        if (!m) continue;
        for (const t of m[1].match(/\[(\d+):(\d+)(?:[.:](\d+))?\]/g)) {
            const [, mm, ss, ff] = t.match(/\[(\d+):(\d+)(?:[.:](\d+))?\]/);
            lines.push({ at: Number(mm) * 60 + Number(ss) + (ff ? Number(`0.${ff}`) : 0), text: m[2] });
        }
    }
    return lines.sort((a, b) => a.at - b.at);
}

async function play(index) {
    if (index < 0 || index >= P.queue.length) return;
    P.index = index;
    const item = current();
    P.art = item.thumb || null;
    P.lyrics = [];
    redraw();
    try {
        let src = item.src;
        if (item.type === 'stream') {
            const r = await api.stream.url(item.url, { mode: 'audio' });
            src = r.streamUrl;
        }
        media.src = src;
        await media.play();
        if (item.type === 'file') {
            api.files.cover(item.path).then((c) => { if (current() === item && c) { P.art = c; redraw(); } }).catch(() => {});
            api.stream.readLyrics(item.path.replace(/\.[^.\\/]+$/, '.lrc')).then((l) => { if (l && l.content && current() === item) { P.lyrics = parseLrc(l.content); redraw(); } }).catch(() => {});
        }
    } catch (err) {
        toast(`Could not play "${item.title}": ${errorText(err)}`, { type: 'error' });
        if (P.queue.length > 1) next(true);
    }
}

function next(auto) {
    if (!P.queue.length) return;
    if (auto && P.repeat === 'one') { media.currentTime = 0; media.play(); return; }
    let i = P.shuffle ? Math.floor(Math.random() * P.queue.length) : P.index + 1;
    if (i >= P.queue.length) { if (P.repeat === 'all' || !auto) i = 0; else { media.pause(); redraw(); return; } }
    play(i);
}
const prev = () => { if (media.currentTime > 3) media.currentTime = 0; else play((P.index - 1 + P.queue.length) % P.queue.length); };
media.addEventListener('ended', () => next(true));
// The main process closes a hidden, idle window to save memory; it must know music is playing.
const reportBusy = () => { try { window.ufc.send('renderer-busy', !media.paused && !media.ended); } catch (_) { /* optional */ } };
media.addEventListener('play', () => { reportBusy(); redraw(); });
media.addEventListener('pause', () => { reportBusy(); redraw(); });
media.addEventListener('ended', reportBusy);

function addFiles(paths, playNow) {
    const start = P.queue.length;
    for (const p of paths) P.queue.push({ id: newId('t'), type: 'file', path: p, src: fileUrl(p), title: stem(p), artist: extname(p).toUpperCase() });
    if (playNow || P.index < 0) play(start); else redraw();
}

function redraw() { if (P.view) P.view.draw(); }

export default async function player() {
    let tab = 'queue';
    const art = h('div.player-art');
    const meta = h('div');
    const seek = h('input.range', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Seek', oninput: () => { if (media.duration) media.currentTime = (seek.value / 1000) * media.duration; } });
    const tCur = h('span.tiny.soft.num', '0:00');
    const tTot = h('span.tiny.soft.num', '0:00');
    const btn = (name, label, fn, extra) => h('button.icon-btn', { title: label, 'aria-label': label, onclick: fn, ...(extra || {}) }, icon(name, 20));
    const playBtn = h('button.btn.primary', { style: 'width:52px;height:52px;border-radius:50%;padding:0', 'aria-label': 'Play or pause', onclick: () => { if (!current() && P.queue.length) play(0); else if (media.paused) media.play(); else media.pause(); } });
    const shuffleBtn = btn('shuffle', 'Shuffle', () => { P.shuffle = !P.shuffle; redraw(); });
    const repeatBtn = btn('repeat', 'Repeat', () => { P.repeat = P.repeat === 'off' ? 'all' : P.repeat === 'all' ? 'one' : 'off'; redraw(); });
    const volume = h('input.range', { type: 'range', min: 0, max: 100, value: media.volume * 100, 'aria-label': 'Volume', style: 'max-width:120px', oninput: () => { media.volume = volume.value / 100; } });
    const body = h('div');

    const lyricsEl = h('div.lyrics');
    const drawLyrics = () => {
        mount(lyricsEl, P.lyrics.length ? P.lyrics.map((l, i) => h('div', { dataset: { i } }, l.text || '...')) : h('div', { style: 'font-size:16px;font-family:var(--font-ui)' }, 'No lyrics loaded.'));
    };

    function drawBody() {
        if (tab === 'find') return drawFind();
        if (tab === 'lyrics') {
            mount(body, h('div.row', { style: 'margin-bottom:12px' }, h('button.btn.secondary.sm', { onclick: async () => { const r = await api.stream.pickLyrics(); if (r && r.content) { P.lyrics = parseLrc(r.content); drawLyrics(); } else if (r && r.error) toast(r.error, { type: 'error' }); } }, icon('document'), 'Load .lrc file')), h('section.card', lyricsEl));
            drawLyrics();
            return;
        }
        mount(body, h('div.row', { style: 'margin-bottom:12px' }, h('button.btn.primary.sm', { onclick: async () => { const f = await api.pick.files('player'); if (f.length) addFiles(f, false); } }, icon('plus'), 'Add files'),
            P.queue.length ? h('button.btn.ghost.sm', { onclick: () => { media.pause(); media.removeAttribute('src'); P.queue = []; P.index = -1; P.art = null; redraw(); } }, 'Clear queue') : null),
            P.queue.length ? h('section.card.tight', P.queue.map((t, i) => h(`div.queue-row${i === P.index ? '.playing' : ''}`, { onclick: () => play(i) },
                h('span.tiny.soft.num', i === P.index && !media.paused ? '▶' : String(i + 1)),
                h('div', { style: 'min-width:0' }, h('div.truncate', { style: 'color:var(--ink)' }, t.title), h('div.tiny.soft.truncate', t.artist || '')),
                h('button.icon-btn', { title: 'Remove', 'aria-label': 'Remove', onclick: (e) => { e.stopPropagation(); const wasCurrent = i === P.index; P.queue.splice(i, 1); if (i < P.index) P.index -= 1; else if (wasCurrent) { media.pause(); P.index = Math.min(P.index, P.queue.length - 1); } redraw(); } }, icon('x', 16)))))
                : emptyState({ icon: icon('music'), title: 'Nothing queued', text: 'Add music from your computer, or find a song online.' }));
    }

    function drawFind() {
        const q = h('input.input', { placeholder: 'Song, artist, or a link', 'aria-label': 'Search' });
        const out = h('div');
        const run = async () => {
            if (!q.value.trim()) return;
            mount(out, h('div.skeleton', { style: 'height:180px' }));
            try {
                const items = await api.stream.search(q.value.trim());
                mount(out, items.length ? h('section.card.tight', items.map((r) => h('div.list-row',
                    h('div.file-ico', { style: 'width:48px;height:48px;flex:none' }, r.thumbnail ? h('img', { src: r.thumbnail, alt: '', loading: 'lazy' }) : icon('music', 20)),
                    h('div.grow', h('div.truncate', { style: 'color:var(--ink);font-weight:500' }, r.title), h('div.tiny.soft.truncate', [r.uploader || r.artist, r.duration ? duration(r.duration) : ''].filter(Boolean).join(' · '))),
                    h('button.btn.secondary.sm', { onclick: () => { P.queue.push({ id: newId('t'), type: 'stream', url: r.url, title: r.title, artist: r.uploader || r.artist || '', thumb: r.thumbnail }); if (P.index < 0) play(P.queue.length - 1); else { toast('Added to the queue', { type: 'success', timeout: 1500 }); redraw(); } } }, icon('plus'), 'Add'),
                    h('button.btn.primary.sm', { onclick: () => { P.queue.push({ id: newId('t'), type: 'stream', url: r.url, title: r.title, artist: r.uploader || r.artist || '', thumb: r.thumbnail }); play(P.queue.length - 1); } }, icon('play'), 'Play'))))
                    : emptyState({ title: 'No results', text: 'Try different words.' }));
            } catch (e) { mount(out, h('div.notice.error', icon('warning'), h('div', errorText(e)))); }
        };
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
        mount(body, h('div.input-group', q, h('button.btn.primary', { onclick: run }, icon('search'), 'Search')), h('div', { style: 'margin-top:var(--s-4)' }, out));
    }

    function draw() {
        const it = current();
        mount(art, P.art ? h('img', { src: P.art, alt: '' }) : icon('music', 56));
        mount(meta, h('div.title-md.truncate', it ? it.title : 'Nothing playing'), h('div.small.muted.truncate', it ? it.artist || '' : 'Add something to the queue'));
        playBtn.replaceChildren(icon(!media.paused && current() ? 'pause' : 'play', 22));
        shuffleBtn.style.color = P.shuffle ? 'var(--coral)' : '';
        repeatBtn.style.color = P.repeat !== 'off' ? 'var(--coral)' : '';
        repeatBtn.title = `Repeat: ${P.repeat}`;
        if (tab === 'queue') drawBody();
    }

    const tick = () => {
        if (!media.duration || !isFinite(media.duration)) return;
        seek.value = Math.round((media.currentTime / media.duration) * 1000);
        tCur.textContent = duration(media.currentTime);
        tTot.textContent = duration(media.duration);
        if (P.lyrics.length && tab === 'lyrics') {
            let idx = -1;
            for (let i = 0; i < P.lyrics.length; i += 1) if (P.lyrics[i].at <= media.currentTime) idx = i; else break;
            lyricsEl.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
            const line = lyricsEl.querySelector(`[data-i="${idx}"]`);
            if (line) { line.classList.add('on'); line.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        }
    };
    media.addEventListener('timeupdate', tick);

    const tabBar = tabs([{ id: 'queue', label: 'Queue' }, { id: 'find', label: 'Find music' }, { id: 'lyrics', label: 'Lyrics' }], tab, (id) => { tab = id; drawBody(); });
    const left = h('section.card', art, h('div', { style: 'margin:var(--s-4) 0 var(--s-2)' }, meta),
        h('div.row', tCur, h('div.grow', seek), tTot),
        h('div.row.between', { style: 'margin-top:var(--s-2)' }, shuffleBtn, h('div.row', { style: 'gap:6px' }, btn('prev', 'Previous', prev), playBtn, btn('next', 'Next', () => next(false))), repeatBtn),
        h('div.row', { style: 'margin-top:var(--s-3)' }, icon('volume', 16), volume));
    const el = h('div.page', pageHead('Player', 'Play your music, or find a song online. Playback continues while you use other pages.'),
        h('div.player-shell', left, h('div', tabBar, body)));

    P.view = { draw };
    draw();
    drawBody();
    tick();
    return { el, destroy: () => { media.removeEventListener('timeupdate', tick); P.view = null; } };
}
