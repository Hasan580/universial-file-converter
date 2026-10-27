import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { app } from '../core/state.js';
import { toast, errorText } from '../core/ui.js';
import { pageHead } from '../components/page.js';
import { select, field, notice, emptyState, progressBar } from '../components/controls.js';

const SERVICES = [{ id: 'tidal', label: 'Tidal' }, { id: 'qobuz', label: 'Qobuz' }, { id: 'amazon', label: 'Amazon Music' }, { id: 'deezer', label: 'Deezer' }, { id: 'youtube', label: 'YouTube' }];

/** Normalise the different shapes Spotify metadata comes back in into a flat list of tracks. */
function tracksFrom(meta) {
    if (!meta) return [];
    const raw = meta.tracks || meta.track_list || meta.items || (meta.track ? [meta.track] : [meta]);
    return raw.map((t) => ({
        id: t.id || t.spotify_id || t.spotifyID, name: t.name || t.title, artists: Array.isArray(t.artists) ? t.artists.map((a) => a.name || a).join(', ') : t.artists || t.artist || '',
        album: t.album && t.album.name ? t.album.name : t.album || '', duration: t.duration || '', cover: t.cover || t.cover_url || (t.images && t.images[0] && t.images[0].url) || null
    })).filter((t) => t.id && t.name);
}

export default async function spotify() {
    const prefsService = { v: 'tidal' };
    const input = h('input.input', { placeholder: 'Search for a song, or paste a Spotify link', 'aria-label': 'Search' });
    const results = h('div');
    const service = select({ options: SERVICES, value: prefsService.v, onChange: (v) => { prefsService.v = v; }, label: 'Source' });

    const off = api.on('spotify-download-progress', ({ phase, percent }) => {
        document.querySelectorAll('.sp-progress').forEach((el) => { el.firstChild.style.width = `${percent || 0}%`; el.nextSibling.textContent = phase || ''; });
    });

    async function download(t, button) {
        button.disabled = true;
        const bar = progressBar(0);
        bar.classList.add('sp-progress');
        const line = h('div.tiny.soft', 'Starting...');
        button.replaceWith(h('div', { style: 'min-width:150px' }, bar, line));
        try {
            const r = await api.spotify.download({ spotifyID: t.id, service: prefsService.v, outputDir: app.get().settings.outputDirectory, quality: 'LOSSLESS', trackInfo: { name: t.name, artists: t.artists, album: t.album, cover: t.cover } });
            if (r.success) { line.replaceWith(h('div.tiny', { style: 'color:var(--success)' }, r.alreadyExists ? 'Already downloaded' : 'Saved')); bar.set(100, 'ok'); bar.classList.remove('sp-progress'); toast(`Saved ${t.name}`, { type: 'success', action: { label: 'Show', run: () => api.files.reveal(r.path) } }); }
            else throw new Error(r.error || 'The download failed');
        } catch (e) { bar.classList.remove('sp-progress'); line.replaceWith(h('div.tiny', { style: 'color:var(--error-ink)' }, errorText(e))); bar.set(0, 'err'); }
    }

    const row = (t) => {
        const btn = h('button.btn.secondary.sm', icon('download'), 'Download');
        btn.onclick = () => download(t, btn);
        return h('div.list-row', h('div.file-ico', { style: 'width:48px;height:48px;flex:none' }, t.cover ? h('img', { src: t.cover, alt: '', loading: 'lazy' }) : icon('music', 20)),
            h('div.grow', h('div.truncate', { style: 'color:var(--ink);font-weight:500' }, t.name), h('div.tiny.soft.truncate', [t.artists, t.album, t.duration].filter(Boolean).join(' · '))), btn);
    };

    async function go() {
        const q = input.value.trim();
        if (!q) return;
        mount(results, h('div.skeleton', { style: 'height:200px' }));
        try {
            const tracks = /spotify\.com|^spotify:/i.test(q) ? tracksFrom(await api.spotify.meta(q)) : (await api.spotify.search(q, 20)).results.tracks.map((t) => ({ ...t }));
            mount(results, tracks.length ? h('section.card.tight', tracks.map(row)) : emptyState({ icon: icon('music'), title: 'Nothing found', text: 'Try the artist and song name, or paste a link.' }));
        } catch (e) { mount(results, notice(errorText(e), 'error', icon('warning'))); }
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

    const el = h('div.page', pageHead('Spotify', 'Find a track and save it as a lossless file from the first catalogue that has it.'),
        notice('This needs Python 3 on your computer; the first download installs the SpotiFLAC package. Only save music you are allowed to keep, and follow the terms of the services you use.', 'warn', icon('info')),
        h('div', { style: 'height:var(--s-4)' }),
        h('section.card.raised', h('div.input-group', input, h('button.btn.primary', { onclick: go }, icon('search'), 'Search')), h('div', { style: 'margin-top:var(--s-3);max-width:260px' }, field('Prefer', service))),
        h('div', { style: 'height:var(--s-4)' }), results);
    return { el, destroy: () => off() };
}
