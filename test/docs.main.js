'use strict';

/**
 * Document conversion matrix (runs inside Electron).
 *   node_modules/electron/dist/electron.exe test/docs.main.js [outfile.json]
 * Builds a sample file for each input type, converts it to every advertised output, and
 * records which pairs work natively. The result drives which pairs the UI offers.
 */

const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
// The HTML->PDF path opens and closes a hidden window; do not let that quit the app.
app.on('window-all-closed', (e) => e.preventDefault());
console.error = () => {};
require('../src/main/paths').pinUserData();
const report = process.argv.find((a) => a.endsWith('.json')) || path.join(os.tmpdir(), 'ufc-docs.json');

app.whenReady().then(async () => {
    const docs = require('../src/main/engines/documents');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ufc-docs-'));
    const out = path.join(work, 'out');
    fs.mkdirSync(out);
    const rows = [];

    const inputs = {};
    const put = (ext, content) => { const p = path.join(work, `sample.${ext}`); fs.writeFileSync(p, content); inputs[ext] = p; };

    put('txt', 'Universal File Converter\n\nFirst paragraph with some words.\nSecond line.\n\nA third paragraph.\n');
    put('md', '# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    put('html', '<html><head><title>Sample</title></head><body><h1>Sample</h1><p>Hello <b>world</b>.</p><ul><li>one</li><li>two</li></ul></body></html>');
    put('csv', 'name,age,city\nAda,36,London\nLinus,55,Portland\n');
    put('tsv', 'name\tage\tcity\nAda\t36\tLondon\nLinus\t55\tPortland\n');
    put('json', JSON.stringify([{ name: 'Ada', age: 36 }, { name: 'Linus', age: 55 }]));
    put('yaml', '- name: Ada\n  age: 36\n- name: Linus\n  age: 55\n');
    put('xml', '<?xml version="1.0"?><people><person><name>Ada</name><age>36</age></person><person><name>Linus</name><age>55</age></person></people>');
    put('rtf', '{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}}\\f0\\fs24 Hello \\b world\\b0.\\par Second paragraph.\\par}');

    try {
        const JSZip = require('jszip');
        const zip = new JSZip();
        const slide = (t1, t2) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t1}</a:t></a:r></a:p><a:p><a:r><a:t>${t2}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
        zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
        zip.file('ppt/slides/slide1.xml', slide('Slide one title', 'First slide body text'));
        zip.file('ppt/slides/slide2.xml', slide('Slide two title', 'Second slide body text'));
        fs.writeFileSync(path.join(work, 'sample.pptx'), await zip.generateAsync({ type: 'nodebuffer' })); inputs.pptx = path.join(work, 'sample.pptx');
    } catch (e) { rows.push({ input: 'pptx', output: '*', ok: false, detail: `could not build sample: ${e.message}` }); }
    try {
        const { Document, Packer, Paragraph, TextRun } = require('docx');
        const buf = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: 'Heading text', bold: true })] }), new Paragraph('Body paragraph one.'), new Paragraph('Body paragraph two.')] }] }));
        fs.writeFileSync(path.join(work, 'sample.docx'), buf); inputs.docx = path.join(work, 'sample.docx');
    } catch (e) { rows.push({ input: 'docx', output: '*', ok: false, detail: `could not build sample: ${e.message}` }); }
    try {
        const XLSX = require('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['name', 'age'], ['Ada', 36], ['Linus', 55]]), 'Sheet1');
        XLSX.writeFile(wb, path.join(work, 'sample.xlsx')); inputs.xlsx = path.join(work, 'sample.xlsx');
    } catch (e) { rows.push({ input: 'xlsx', output: '*', ok: false, detail: `could not build sample: ${e.message}` }); }
    try {
        const { PDFDocument, StandardFonts } = require('pdf-lib');
        const pdf = await PDFDocument.create();
        const page = pdf.addPage([400, 300]);
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        page.drawText('Hello from a PDF sample', { x: 40, y: 240, size: 18, font });
        page.drawText('Second line of text.', { x: 40, y: 210, size: 12, font });
        fs.writeFileSync(path.join(work, 'sample.pdf'), await pdf.save()); inputs.pdf = path.join(work, 'sample.pdf');
    } catch (e) { rows.push({ input: 'pdf', output: '*', ok: false, detail: `could not build sample: ${e.message}` }); }

    for (const [inExt, outs] of Object.entries(docs.conversionMatrix)) {
        if (!inputs[inExt]) continue;
        for (const outExt of outs) {
            if (outExt === inExt) continue;
            const started = Date.now();
            try {
                const r = await Promise.race([
                    docs.convert({ inputPath: inputs[inExt], outputFormat: outExt, outputDirectory: out }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 60s')), 60000))
                ]);
                const size = fs.existsSync(r.outputPath) ? fs.statSync(r.outputPath).size : 0;
                rows.push({ input: inExt, output: outExt, ok: size > 0, detail: `${size}B${r.engine ? ' via ' + r.engine : ''}`, ms: Date.now() - started });
            } catch (e) {
                rows.push({ input: inExt, output: outExt, ok: false, detail: String(e.message).slice(0, 160), ms: Date.now() - started });
            }
        }
    }

    fs.writeFileSync(report, JSON.stringify(rows, null, 2));
    if (process.argv.includes('--write-pairs')) {
        const pairs = {};
        for (const r of rows) if (r.ok) (pairs[r.input] = pairs[r.input] || []).push(r.output);
        fs.writeFileSync(path.join(__dirname, '..', 'src', 'main', 'engines', 'docPairs.json'), JSON.stringify(pairs, null, 2) + '\n');
    } else {
        // Regression guard: every pair we advertise must still pass.
        const listed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'engines', 'docPairs.json'), 'utf8'));
        const broken = rows.filter((r) => !r.ok && (listed[r.input] || []).includes(r.output));
        if (broken.length) { fs.writeFileSync(report, JSON.stringify(rows, null, 2)); app.exit(1); return; }
    }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    app.exit(0);
});
