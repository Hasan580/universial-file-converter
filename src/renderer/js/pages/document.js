import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { app } from '../core/state.js';
import { createConverter } from './_converter.js';
import { toast, errorText } from '../core/ui.js';
import { dropzone } from '../components/dropzone.js';
import { field, notice, sectionCard } from '../components/controls.js';
import { basename, bytes, extname } from '../core/format.js';

const POPULAR = ['pdf', 'docx', 'txt', 'html', 'md'];

// Output formats, taken from the pairs that are verified to work (see test/docs.main.js).
const documentFormats = (catalog) => {
    const labels = new Map();
    for (const d of catalog.documents || []) for (const o of d.outputs) labels.set(o.id, o.label);
    return [...labels.entries()].map(([id, label]) => ({ id, label, category: POPULAR.includes(id) ? 'Popular' : 'More', available: true }));
};

const converter = createConverter({
    key: 'document',
    title: 'Documents',
    subtitle: 'Convert between document, spreadsheet and text formats, and work with PDFs.',
    noun: 'documents',
    kind: 'document',
    accept: ['pdf', 'docx', 'doc', 'txt', 'rtf', 'html', 'htm', 'xlsx', 'xls', 'pptx', 'csv', 'tsv', 'json', 'md', 'xml', 'yaml', 'yml', 'epub', 'odt', 'ods'],
    thumbs: false,
    concurrency: 2,
    formats: documentFormats,
    defaultFormat: 'pdf',
    categoryOrder: ['Popular', 'More'],
    hint: 'Text-based routes (RTF, EPUB, ODT, LaTeX) keep the words but not complex formatting. Old .doc, .ppt and OpenDocument files need LibreOffice installed.',
    options: [],
    validate: (item, session) => {
        const docs = (app.get().catalog || {}).documents || [];
        const entry = docs.find((d) => d.ext === item.ext);
        if (item.ext === session.format) return `Already a ${item.ext.toUpperCase()} file`;
        if (!entry) return `.${item.ext} files cannot be converted here`;
        if (!entry.outputs.some((o) => o.id === session.format)) {
            return `${item.ext.toUpperCase()} cannot become ${session.format.toUpperCase()}. Try ${entry.outputs.slice(0, 4).map((o) => o.id.toUpperCase()).join(', ')}.`;
        }
        return null;
    },
    payload: () => ({}),
    run: (p) => api.convert.document(p)
});

// ---------------------------------------------------------------------------- PDF tools

function lockCard() {
    const result = h('div', { style: 'margin-top:12px' });
    let file = null;
    const pickLabel = h('div.small.muted', 'No PDF chosen');
    const userPw = h('input.input', { type: 'password', placeholder: 'Password to open the file', autocomplete: 'new-password' });
    const ownerPw = h('input.input', { type: 'password', placeholder: 'Optional: separate password to edit or print', autocomplete: 'new-password' });
    const go = h('button.btn.primary', { disabled: true, onclick: async () => {
        if (!userPw.value && !ownerPw.value) { toast('Enter at least one password.', { type: 'warning' }); return; }
        go.disabled = true;
        try {
            const r = await api.pdf.lock({ inputPath: file, userPassword: userPw.value, ownerPassword: ownerPw.value || undefined, outputDirectory: app.get().settings.outputDirectory });
            mount(result, notice(`Saved ${basename(r.outputPath)} (${bytes(r.outputSize)}) with ${r.encryption || 'a password'}.${r.warning ? ' ' + r.warning : ''}`, r.warning ? 'warn' : 'ok', icon(r.warning ? 'warning' : 'check')),
                h('div.row', { style: 'margin-top:8px' }, h('button.btn.secondary.sm', { onclick: () => api.files.reveal(r.outputPath) }, icon('folderOpen'), 'Show in folder')));
            userPw.value = ''; ownerPw.value = '';
        } catch (e) { mount(result, notice(errorText(e), 'error', icon('warning'))); } finally { go.disabled = false; }
    } }, icon('lock'), 'Protect PDF');
    const choose = (paths) => { file = paths[0]; pickLabel.textContent = basename(file); go.disabled = false; };
    return sectionCard('Password-protect a PDF', 'Anyone opening the file will need the password. A copy is saved; your original is untouched.',
        dropzone({ title: 'Drop a PDF', subtitle: 'or click to choose', kind: 'pdf', accept: ['pdf'], onFiles: choose, compact: true, single: true }),
        h('div.col', { style: 'margin-top:12px' }, pickLabel, field('Open password', userPw), field('Edit password (optional)', ownerPw), h('div', go)), result);
}

function mergeCard() {
    let files = [];
    const list = h('div.files');
    const result = h('div', { style: 'margin-top:12px' });
    const go = h('button.btn.primary', { disabled: true });
    const draw = () => {
        go.disabled = files.length < 2;
        go.replaceChildren(icon('merge'), files.length < 2 ? 'Add at least two PDFs' : `Merge ${files.length} PDFs`);
        mount(list, files.map((f, i) => h('div.file', { style: 'padding:8px 12px' },
            h('div.file-ico', { style: 'width:32px;height:32px' }, icon('document', 16)),
            h('div.file-name.truncate', `${i + 1}. ${basename(f)}`),
            h('div.file-actions',
                i > 0 ? h('button.icon-btn', { title: 'Move up', 'aria-label': 'Move up', onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); } }, icon('sort', 16)) : null,
                h('button.icon-btn', { title: 'Remove', 'aria-label': 'Remove', onclick: () => { files = files.filter((_, k) => k !== i); draw(); } }, icon('x', 16))))));
    };
    go.onclick = async () => {
        go.disabled = true;
        try {
            const r = await api.pdf.merge({ inputPaths: files, outputDirectory: app.get().settings.outputDirectory });
            mount(result, notice(`Merged ${r.pageCount} pages into ${basename(r.outputPath)} (${bytes(r.outputSize)}).`, 'ok', icon('check')),
                h('div.row', { style: 'margin-top:8px' }, h('button.btn.secondary.sm', { onclick: () => api.files.reveal(r.outputPath) }, icon('folderOpen'), 'Show in folder')));
        } catch (e) { mount(result, notice(errorText(e), 'error', icon('warning'))); } finally { draw(); }
    };
    draw();
    return sectionCard('Merge PDFs', 'Combine several PDFs into one, in the order listed.',
        dropzone({ title: 'Drop PDFs', subtitle: 'add two or more', kind: 'pdf', accept: ['pdf'], onFiles: (p) => { files = [...files, ...p.filter((x) => !files.includes(x))]; draw(); }, compact: true }),
        h('div', { style: 'margin-top:12px' }, list), h('div', { style: 'margin-top:12px' }, go), result);
}

function editCard() {
    let file = null;
    let isPdf = false;
    const area = h('textarea.textarea.mono', { rows: 14, hidden: true, spellcheck: 'false', 'aria-label': 'Document text' });
    const info = h('div.small.muted', 'Open a PDF or a text-based file (TXT, MD, HTML, JSON, XML, CSV, RTF).');
    const save = h('button.btn.primary', { hidden: true }, icon('save'), 'Save a copy');
    const result = h('div', { style: 'margin-top:12px' });

    const open = async (paths) => {
        file = paths[0]; isPdf = extname(file) === 'pdf';
        mount(result);
        try {
            const r = isPdf ? await api.pdf.readText({ inputPath: file }) : await api.pdf.readDoc({ filePath: file });
            area.value = isPdf ? r.text : r.content;
            area.hidden = false; save.hidden = false;
            info.textContent = isPdf ? `${basename(file)} · ${r.pageCount || '?'} pages. Saving rebuilds the PDF from this text; layout and images are not kept.` : basename(file);
        } catch (e) { mount(result, notice(errorText(e), 'error', icon('warning'))); }
    };
    save.onclick = async () => {
        save.disabled = true;
        try {
            const r = isPdf ? await api.pdf.saveText({ inputPath: file, text: area.value }) : await api.pdf.saveDoc({ filePath: file, content: area.value });
            const out = r.outputPath || r.filePath;
            mount(result, notice(`Saved ${basename(out)}.`, 'ok', icon('check')), h('div.row', { style: 'margin-top:8px' }, h('button.btn.secondary.sm', { onclick: () => api.files.reveal(out) }, icon('folderOpen'), 'Show in folder')));
        } catch (e) { mount(result, notice(errorText(e), 'error', icon('warning'))); } finally { save.disabled = false; }
    };
    return sectionCard('Edit text', 'Fix a typo in a text file or a PDF without opening another program. Your original is never changed.',
        dropzone({ title: 'Drop a file to edit', subtitle: 'PDF or text', kind: 'any', accept: ['pdf', 'txt', 'md', 'html', 'htm', 'json', 'xml', 'csv', 'rtf'], onFiles: open, compact: true, single: true }),
        h('div.col', { style: 'margin-top:12px' }, info, area, h('div', save)), result);
}

export default async function documentPage(ctx) {
    const base = await converter(ctx);
    const tools = h('div', h('h2.title-lg', { style: 'margin:var(--s-7) 0 var(--s-4)' }, 'PDF tools'),
        h('div.grid.cols-2', lockCard(), mergeCard()), h('div', { style: 'height:var(--s-4)' }), editCard());
    base.el.append(tools);
    return base;
}
