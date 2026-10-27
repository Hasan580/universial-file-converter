import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast, errorText } from '../core/ui.js';
import { pageHead, tabs } from '../components/page.js';
import { emptyState, notice, range } from '../components/controls.js';
import { bytes } from '../core/format.js';

/** epub.js and JSZip are vendored (src/renderer/vendor), loaded only when this page is first opened. */
let libsLoaded = null;
function loadLibs() {
    if (libsLoaded) return libsLoaded;
    const add = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(`Could not load ${src}`)); document.head.append(s); });
    libsLoaded = add('vendor/jszip.min.js').then(() => add('vendor/epub.min.js'));
    return libsLoaded;
}

const cover = (b) => h('div', { style: 'aspect-ratio:2/3;background:var(--raised);border-radius:var(--r-md);overflow:hidden;display:grid;place-items:center;color:var(--muted-soft)' },
    b.coverUrl ? h('img', { src: b.coverUrl, alt: '', loading: 'lazy', style: 'width:100%;height:100%;object-fit:cover' }) : icon('book', 32));

export default async function books() {
    let tab = 'library';
    const body = h('div');

    // ---------------------------------------------------------------- reader
    async function openReader(book) {
        try { await loadLibs(); } catch (e) { toast(errorText(e), { type: 'error' }); return; }
        const data = await api.books.read(book.localPath);
        if (!data.success) { toast(data.message || 'Could not open the book', { type: 'error' }); return; }
        const bin = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0)).buffer;
        const viewer = h('div', { style: 'height:68vh;background:#f5f0e8;border-radius:var(--r-lg);overflow:hidden' });
        let size = 110;
        const progress = h('div.small.soft');
        mount(body, h('div.row.between.wrap', { style: 'margin-bottom:var(--s-3)' },
            h('button.btn.ghost', { onclick: () => draw() }, icon('back'), 'Library'),
            h('div.title-md.truncate', { style: 'max-width:50%' }, book.title),
            h('div.row', h('span.small.muted', 'Text size'), range({ min: 80, max: 200, step: 10, value: size, format: (v) => `${v}%`, onChange: (v) => { size = v; rendition.themes.fontSize(`${v}%`); } }))),
            viewer, h('div.row.between', { style: 'margin-top:12px' },
                h('button.btn.secondary', { onclick: () => rendition.prev() }, icon('chevronLeft'), 'Previous'), progress,
                h('button.btn.secondary', { onclick: () => rendition.next() }, 'Next', icon('chevronRight'))));
        const epub = window.ePub(bin);
        const rendition = epub.renderTo(viewer, { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });
        rendition.themes.default({ body: { color: '#252523 !important', 'font-family': 'Georgia, "Times New Roman", serif !important', 'line-height': '1.65 !important' } });
        rendition.display().catch((e) => toast(errorText(e), { type: 'error' }));
        rendition.on('relocated', (loc) => { progress.textContent = loc && loc.start && loc.start.percentage != null ? `${Math.round(loc.start.percentage * 100)}%` : ''; });
        const key = (e) => { if (e.key === 'ArrowRight') rendition.next(); else if (e.key === 'ArrowLeft') rendition.prev(); };
        document.addEventListener('keydown', key);
        const observer = new MutationObserver(() => { if (!viewer.isConnected) { document.removeEventListener('keydown', key); observer.disconnect(); try { epub.destroy(); } catch (_) { /* gone */ } } });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ---------------------------------------------------------------- library
    async function drawLibrary() {
        const r = await api.books.library().catch(() => ({ books: [] }));
        mount(body,
            h('div.row.wrap', { style: 'margin-bottom:var(--s-4)' },
                h('button.btn.primary', { onclick: async () => { const files = await api.pick.files('books'); if (!files.length) return; const res = await api.books.import(files); toast(res && res.success !== false ? `Added ${files.length} book${files.length > 1 ? 's' : ''}` : (res.message || 'Could not add'), { type: 'success' }); drawLibrary(); } }, icon('plus'), 'Add EPUB files'),
                h('button.btn.secondary', { onclick: async () => { const f = await api.books.folder(); if (f.path) api.files.openFolder(f.path); } }, icon('folderOpen'), 'Open folder')),
            r.books.length
                ? h('div.grid.cols-4', { style: 'grid-template-columns:repeat(auto-fill,minmax(170px,1fr))' }, r.books.map((b) => h('button.feature-card', { style: 'padding:var(--s-3);gap:10px', onclick: () => openReader(b) }, cover(b), h('div', h('div.title-sm.truncate', b.title), h('div.tiny.soft.truncate', b.author || 'Unknown author'), h('div.tiny.soft', bytes(b.fileSize))))))
                : emptyState({ icon: icon('book'), title: 'Your library is empty', text: 'Add EPUB files you own, or search the catalogues for books you have the right to read.' }));
    }

    // ---------------------------------------------------------------- search
    async function drawSearch() {
        const q = h('input.input', { placeholder: 'Title or author' });
        const out = h('div');
        const run = async () => {
            if (!q.value.trim()) return;
            mount(out, h('div.grid.cols-3', [1, 2, 3].map(() => h('div.skeleton', { style: 'height:150px' }))));
            try {
                const [online, offline] = await Promise.allSettled([api.books.searchOnline(q.value), api.books.searchOffline(q.value)]);
                const list = [...(online.value && online.value.books || []).map((b) => ({ ...b, via: 'online' })), ...(offline.value && offline.value.books || []).map((b) => ({ ...b, via: 'offline' }))];
                if (!list.length) { mount(out, emptyState({ title: 'No EPUB found', text: online.status === 'rejected' && offline.status === 'rejected' ? 'The catalogues could not be reached right now.' : 'Try different words.' })); return; }
                mount(out, h('div.grid', { style: 'grid-template-columns:repeat(auto-fill,minmax(170px,1fr))' }, list.map((b) => h('div.feature-card', { style: 'padding:var(--s-3);gap:10px' }, cover(b),
                    h('div', h('div.title-sm', { style: 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden' }, b.title), h('div.tiny.soft.truncate', b.author || ''), b.sizeText ? h('div.tiny.soft', b.sizeText) : null),
                    h('button.btn.secondary.sm', { onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Saving...'; try { const r = await api.books.download({ editionId: b.editionId || b.id, bookData: b }); toast(r && r.success !== false ? 'Saved to your library' : (r.message || 'Could not download'), { type: r && r.success !== false ? 'success' : 'error' }); } catch (er) { toast(errorText(er), { type: 'error' }); } btn.disabled = false; btn.textContent = 'Save to library'; } }, 'Save to library')))));
            } catch (e) { mount(out, notice(errorText(e), 'error', icon('warning'))); }
        };
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
        mount(body, notice('Only save books you have the right to read. Availability depends on third-party catalogues and can change at any time.', '', icon('info')),
            h('div.input-group', { style: 'margin-top:var(--s-4)' }, q, h('button.btn.primary', { onclick: run }, icon('search'), 'Search')), h('div', { style: 'margin-top:var(--s-4)' }, out));
    }

    const draw = () => (tab === 'search' ? drawSearch() : drawLibrary());
    const tabBar = tabs([{ id: 'library', label: 'My library' }, { id: 'search', label: 'Find books' }], tab, (id) => { tab = id; draw(); });
    const el = h('div.page', pageHead('Books', 'Read EPUB books in a calm, paginated reader.'), tabBar, body);
    draw();
    return { el };
}
