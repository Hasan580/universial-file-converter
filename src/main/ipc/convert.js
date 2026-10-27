'use strict';

const path = require('path');
const { handle } = require('./handle');
const ctx = require('../ctx');
const log = require('../logger');
const settings = require('../settings');
const activity = require('../activity');
const ff = require('../engines/ffmpeg');
const image = require('../engines/image');
const docPairs = require('../engines/docPairs.json');
const { uniquePath } = require('../util');

let docs = null;
const documents = () => docs || (docs = require('../engines/documents'));

const DOC_LABELS = {
    pdf: 'PDF', docx: 'Word (DOCX)', doc: 'Word (DOC)', txt: 'Plain text', html: 'HTML', htm: 'HTML', csv: 'CSV', tsv: 'TSV',
    xlsx: 'Excel (XLSX)', xls: 'Excel (XLS)', json: 'JSON', rtf: 'RTF', md: 'Markdown', xml: 'XML', yaml: 'YAML', yml: 'YAML',
    odt: 'OpenDocument text', ods: 'OpenDocument sheet', epub: 'EPUB', latex: 'LaTeX', tex: 'LaTeX', pptx: 'PowerPoint (PPTX)'
};

/** Run one conversion with logging, a stable job id, taskbar progress and a unified progress event. */
async function runJob(kind, options, runner) {
    const id = options.id || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const opts = { ...options, id, outputDirectory: options.outputDirectory || settings.get().outputDirectory };
    log.info(kind, `Starting ${kind} conversion: ${opts.inputPath}`, { format: opts.outputFormat });
    activity.start(id, `Converting ${path.basename(opts.inputPath || 'file')}`);
    try {
        const result = await runner(opts, (p) => {
            const percent = typeof p === 'number' ? p : p && p.percent;
            activity.progress(id, percent);
            ctx.send('conversion-progress', {
                id,
                progress: Number.isFinite(percent) ? percent : null,
                speed: p && p.speed != null ? p.speed : null,
                eta: p && p.eta != null ? p.eta : null
            });
        });
        log.success(kind, `${kind[0].toUpperCase()}${kind.slice(1)} conversion complete: ${result.outputPath}`, { outputSize: result.outputSize });
        return result;
    } catch (err) {
        if (err && err.cancelled) log.info(kind, `Conversion cancelled: ${path.basename(opts.inputPath || '')}`);
        else log.error(kind, `${kind[0].toUpperCase()}${kind.slice(1)} conversion failed: ${err.message}`, { file: opts.inputPath });
        throw err;
    } finally {
        activity.stop(id);
    }
}

/** Default output path for tools that name their own file (lock, merge). */
function defaultOutput(options, name) {
    if (options.outputPath) return options.outputPath;
    return uniquePath(path.join(options.outputDirectory || settings.get().outputDirectory, name));
}

function register() {
    handle('get-catalog', async () => {
        const [audioVideo, images] = await Promise.all([ff.getCatalog(), image.getCatalog()]);
        const inputs = Object.keys(docPairs).map((ext) => ({
            ext,
            label: DOC_LABELS[ext] || ext.toUpperCase(),
            outputs: docPairs[ext].map((o) => ({ id: o, label: DOC_LABELS[o] || o.toUpperCase() }))
        }));
        return { audio: audioVideo.audio, video: audioVideo.video, resolutions: audioVideo.resolutions, image: images, documents: inputs };
    });

    handle('convert-audio', (o) => runJob('audio', o, ff.convertAudio));
    handle('convert-video', (o) => runJob('video', o, ff.convertVideo));
    handle('extract-audio', (o) => runJob('audio', o, ff.extractAudio));
    handle('convert-image', (o) => runJob('image', o, image.convert));
    handle('compress-image', (o) => runJob('image', o, image.compress));
    handle('convert-document', (o) => runJob('document', o, (opts, cb) => documents().convert(opts, cb)));

    handle('cancel-conversion', (id) => {
        ff.cancel(id);
        image.cancel(id);
        if (docs && docs.cancelConversion) docs.cancelConversion();
        log.info('system', 'Conversion cancellation requested', { id: id || 'all' });
        return { cancelled: true };
    });

    handle('probe-media', (file) => ff.getInfo(file));
    handle('image-info', (file) => image.getInfo(file));
    handle('image-thumbnail', (file, size) => image.makeThumbnail(file, size));
    handle('scan-qr-from-image', (file) => image.scanQr(file));

    // ---- PDF tools
    handle('lock-pdf', async (o) => {
        const base = path.basename(o.inputPath || 'document', path.extname(o.inputPath || ''));
        const result = await documents().lockPDF({ ...o, outputPath: defaultOutput(o, `${base}_locked.pdf`) });
        log.success('document', `PDF locked: ${result.outputPath}`, { encryption: result.encryption });
        return result;
    });
    handle('merge-pdfs', async (o) => {
        const result = await documents().mergePDFs({ ...o, outputPath: defaultOutput(o, 'merged.pdf') });
        log.success('document', `PDFs merged: ${result.outputPath} (${result.pageCount} pages)`);
        return result;
    });
    handle('read-editable-document', (o) => documents().readEditableDocument(o || {}));
    // Edits are saved as a new file next to the original unless the caller explicitly overwrites.
    const sibling = (file, suffix, ext) => uniquePath(path.join(path.dirname(file), `${path.basename(file, path.extname(file))}${suffix}${ext === undefined ? path.extname(file) : ext}`), [file]);
    handle('save-editable-document', (o = {}) => documents().saveEditableDocument(o.overwrite ? o : { ...o, filePath: sibling(o.filePath, ' (edited)') }));
    handle('pdf-add-text', (o = {}) => documents().addTextToPDF({ ...o, outputPath: sibling(o.inputPath, ' (edited)', '.pdf') }));
    handle('read-pdf-text', (o) => documents().readPDFTextForEditing(o || {}));
    handle('save-pdf-text', (o = {}) => documents().savePDFTextEdits({ ...o, outputPath: sibling(o.inputPath, ' (edited)', '.pdf') }));
}

module.exports = { register };
