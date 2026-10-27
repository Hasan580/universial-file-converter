import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { toast } from '../core/ui.js';
import { extname } from '../core/format.js';

/** Resolve dropped File objects to real paths, keeping only those whose extension is accepted. */
export function pathsFromDrop(fileList, accept) {
    const out = [];
    let rejected = 0;
    for (const f of fileList || []) {
        const p = api.pathFor(f);
        if (!p) continue;
        if (accept && accept.length && !accept.includes(extname(p))) { rejected += 1; continue; }
        out.push(p);
    }
    return { paths: out, rejected };
}

/**
 * Drop target that also opens the file picker on click or Enter.
 * `kind` picks the dialog filter, `accept` filters dropped files by extension.
 */
export function dropzone({ title = 'Drop files here', subtitle = 'or click to browse', kind = 'any', accept, onFiles, compact = false, single = false }) {
    const el = h(`div.dropzone${compact ? '.compact' : ''}`, { tabindex: '0', role: 'button', 'aria-label': `${title}. ${subtitle}` },
        h('div.dz-ico', icon('upload')),
        h('div', h('h3', title), h('p', subtitle)));

    const pick = async () => {
        const paths = await api.pick.files(kind, { single });
        if (paths && paths.length) onFiles(paths);
    };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });

    let depth = 0;
    el.addEventListener('dragenter', (e) => { e.preventDefault(); depth += 1; el.classList.add('over'); });
    el.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) el.classList.remove('over'); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        depth = 0;
        el.classList.remove('over');
        const { paths, rejected } = pathsFromDrop(e.dataTransfer.files, accept);
        if (rejected) toast(`${rejected} file${rejected > 1 ? 's were' : ' was'} skipped: not a supported type here.`, { type: 'warning' });
        if (paths.length) onFiles(single ? paths.slice(0, 1) : paths);
    });
    return el;
}
