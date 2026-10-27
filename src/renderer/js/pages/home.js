import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { app } from '../core/state.js';
import { navigate } from '../core/router.js';
import { ago, bytes, basename } from '../core/format.js';
import { dropzone } from '../components/dropzone.js';
import { handOver } from '../core/handover.js';
import { prefs } from '../components/page.js';
import { isEnabled } from '../core/nav.js';

const CARDS = [
    { page: 'audio', icon: 'audio', title: 'Audio', text: 'MP3, FLAC, AAC, Opus and more, with cover art kept.' },
    { page: 'video', icon: 'video', title: 'Video', text: 'MP4, WebM, MKV, GIF and 20 other formats.' },
    { page: 'image', icon: 'image', title: 'Images', text: 'Convert, resize and read HEIC, WebP, AVIF, PSD.' },
    { page: 'document', icon: 'document', title: 'Documents', text: 'PDF, Word, Excel, Markdown, EPUB and PDF tools.' },
    { page: 'download', icon: 'download', title: 'Download media', text: 'Save video or audio from thousands of sites.' },
    { page: 'organizer', icon: 'layers', title: 'Organise files', text: 'Sort a messy folder into tidy ones, once or automatically.' }
];

const TYPE_ICON = { audio: 'audio', video: 'video', image: 'image', compress: 'compress', document: 'document', download: 'download' };

export default async function home() {
    const [history, stats] = await Promise.all([api.history.list().catch(() => []), api.history.stats().catch(() => ({}))]);
    const recent = history.filter((x) => x.status === 'success').slice(0, 5);
    const update = app.get().updateInfo;
    const welcomed = prefs.get('welcomed.5', false);

    const hero = h('section.hero',
        h('div.eyebrow', `Uni Companion · version ${app.get().info ? app.get().info.version : ''}`),
        h('h1.display-xl', 'Convert anything.', h('br'), h('span.italic-serif', { style: 'color:var(--coral)' }, 'Keep everything.')),
        h('p.hero-sub', 'Audio, video, images and documents, converted on your own computer. Nothing is uploaded, and nothing needs an account.'));

    const drop = dropzone({
        title: 'Drop files to begin', subtitle: 'We will send each one to the right converter',
        kind: 'any', onFiles: (paths) => handOver(paths)
    });
    drop.classList.add('hero-drop');

    const cards = h('div.grid.cols-3', CARDS.filter((c) => isEnabled(c.page)).map((c) =>
        h('button.feature-card', { onclick: () => navigate(c.page) },
            h('div.ico', icon(c.icon)), h('h3', c.title), h('p', c.text))));

    const recentCard = h('section.card',
        h('div.card-title', h('h3.title-md', 'Recent'), recent.length ? h('button.btn.ghost.sm', { onclick: () => navigate('history') }, 'See all', icon('arrowRight')) : null),
        recent.length
            ? recent.map((it) => h('div.list-row',
                h('div.file-ico', { style: 'width:36px;height:36px;flex:none' }, icon(TYPE_ICON[it.type] || 'document', 18)),
                h('div.grow', h('div.truncate', { style: 'color:var(--ink);font-weight:500' }, it.inputName),
                    h('div.tiny.soft', `${it.outputPath ? basename(it.outputPath) : ''}`.slice(0, 60), ' · ', bytes(it.outputSize), ' · ', ago(it.timestamp))),
                it.outputPath ? h('button.icon-btn', { title: 'Show in folder', 'aria-label': 'Show in folder', onclick: () => api.files.reveal(it.outputPath) }, icon('folderOpen', 16)) : null))
            : h('div.empty', { style: 'padding:var(--s-5) 0' }, h('p', 'Converted files will appear here, so you can find them again.')));

    const side = h('div.col', { style: 'gap:var(--s-4)' },
        h('section.card', h('div.stat', h('b.num', String(stats.totalConverted || 0)), h('span', 'files converted so far')),
            h('div.row', { style: 'margin-top:var(--s-4)' }, h('span.badge.teal', h('span.dot-live'), 'Private'), h('span.small.muted', 'Everything stays on this computer'))),
        update
            ? h('section.callout', { style: 'flex-direction:column;align-items:flex-start;padding:var(--s-5)' },
                h('div', h('h2', { style: 'font-size:26px' }, `Version ${update.version} is ready`), h('p', 'A newer release is available with the latest fixes.')),
                h('button.btn', { onclick: () => navigate('updates') }, 'See what is new'))
            : !welcomed
                ? h('section.callout', { style: 'flex-direction:column;align-items:flex-start;padding:var(--s-5)' },
                    h('div', h('h2', { style: 'font-size:26px' }, 'Welcome to 5.0'), h('p', 'A new engine, a calmer look, and downloads that repair themselves when a site changes.')),
                    h('button.btn', { onclick: () => { prefs.set('welcomed.5', true); navigate('updates'); } }, 'What changed'))
                : null);

    const el = h('div.page', hero, drop, h('div.section-gap'), cards, h('div.section-gap'), h('div.home-grid', recentCard, side));
    return { el };
}
