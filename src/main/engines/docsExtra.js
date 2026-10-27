'use strict';

/**
 * Conversions the core document engine does not cover: TSV and YAML as inputs, spreadsheet
 * exports (TSV, XML, ODS, PDF), and text-based RTF / EPUB / ODT / LaTeX / YAML / JSON / Markdown
 * output. Rich formatting is not preserved by the text-based routes and the UI says so.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SHEET_IN = new Set(['csv', 'tsv', 'xlsx', 'xls', 'ods']);
const TEXT_IN = new Set(['txt', 'md', 'html', 'htm', 'rtf', 'docx', 'doc', 'pdf']);
const SHEET_OUT = new Set(['tsv', 'xml', 'ods', 'pdf', 'csv', 'xlsx', 'json', 'html', 'txt']);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const readText = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

/** Returns true when this module should handle the pair (core routes keep what already works). */
function handles(inExt, outExt) {
    if (inExt === outExt) return false;
    if (inExt === 'yaml' || inExt === 'yml') return ['json', 'txt', 'xml', 'csv'].includes(outExt);
    if (inExt === 'tsv') return SHEET_OUT.has(outExt);
    if (SHEET_IN.has(inExt)) return ['tsv', 'xml', 'ods', 'pdf'].includes(outExt);
    if (inExt === 'json' || inExt === 'xml') return ['tsv', 'yaml'].includes(outExt);
    if (inExt === 'txt') return ['md', 'rtf', 'json', 'yaml', 'epub', 'odt'].includes(outExt);
    if (TEXT_IN.has(inExt)) {
        if (['rtf', 'epub', 'odt', 'latex', 'tex'].includes(outExt)) return true;
        return outExt === 'md' && inExt === 'rtf';
    }
    return false;
}

// ---------------------------------------------------------------- spreadsheets

function readRows(inputPath, ext) {
    const XLSX = require('xlsx');
    let wb;
    if (ext === 'csv' || ext === 'tsv') {
        wb = XLSX.read(readText(inputPath), { type: 'string', FS: ext === 'tsv' ? '\t' : undefined, raw: true });
    } else {
        wb = XLSX.read(fs.readFileSync(inputPath), { type: 'buffer' });
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
}

function rowsToObjects(rows) {
    const [head = [], ...body] = rows;
    const keys = head.map((h, i) => String(h || `column${i + 1}`));
    return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] === undefined ? '' : r[i]])));
}

function writeRows(rows, outputPath, outExt, baseConvert) {
    const XLSX = require('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    switch (outExt) {
        case 'tsv': fs.writeFileSync(outputPath, XLSX.utils.sheet_to_csv(sheet, { FS: '\t' }), 'utf8'); return null;
        case 'csv': fs.writeFileSync(outputPath, XLSX.utils.sheet_to_csv(sheet), 'utf8'); return null;
        case 'txt': fs.writeFileSync(outputPath, rows.map((r) => r.join('\t')).join('\n'), 'utf8'); return null;
        case 'json': fs.writeFileSync(outputPath, JSON.stringify(rowsToObjects(rows), null, 2), 'utf8'); return null;
        case 'xlsx':
        case 'ods': {
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
            XLSX.writeFile(wb, outputPath, { bookType: outExt });
            return null;
        }
        case 'html': {
            const [head = [], ...body] = rows;
            const cells = (r, tag) => `<tr>${r.map((c) => `<${tag}>${esc(c)}</${tag}>`).join('')}</tr>`;
            fs.writeFileSync(outputPath, `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Table</title></head><body><table border="1" cellpadding="6" cellspacing="0">${cells(head, 'th')}${body.map((r) => cells(r, 'td')).join('')}</table></body></html>`, 'utf8');
            return null;
        }
        case 'xml': {
            const objs = rowsToObjects(rows);
            const tag = (k) => String(k).replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^([^A-Za-z_])/, '_$1');
            const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rows>\n${objs.map((o) => `  <row>\n${Object.entries(o).map(([k, v]) => `    <${tag(k)}>${esc(v)}</${tag(k)}>`).join('\n')}\n  </row>`).join('\n')}\n</rows>\n`;
            fs.writeFileSync(outputPath, xml, 'utf8');
            return null;
        }
        case 'pdf': return 'pdf';
        default: throw new Error(`Cannot convert a table to ${outExt}`);
    }
}

// ---------------------------------------------------------------- text pipeline

function textToRtf(text) {
    const body = String(text).replace(/\r\n?/g, '\n').split('\n').map((line) => {
        let out = '';
        for (const ch of line) {
            const code = ch.codePointAt(0);
            if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`;
            else if (code > 126) out += `\\u${code > 32767 ? code - 65536 : code}?`;
            else out += ch;
        }
        return out;
    }).join('\\par\n');
    return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil Calibri;}}\\f0\\fs22\n${body}\\par\n}`;
}

function textToHtmlBody(text) {
    const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    return blocks.map((b) => `<p>${esc(b).replace(/\n/g, '<br/>')}</p>`).join('\n');
}

async function writeEpub(htmlBody, title, outputPath) {
    const JSZip = require('jszip');
    const id = `urn:uuid:${crypto.randomUUID()}`;
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`);
    zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title></head><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${esc(title)}</a></li></ol></nav></body></html>`);
    zip.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(title)}</title><meta charset="utf-8"/></head><body><h1>${esc(title)}</h1>${htmlBody}</body></html>`);
    fs.writeFileSync(outputPath, await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }));
}

async function writeOdt(text, outputPath) {
    const JSZip = require('jszip');
    const paras = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => `<text:p>${esc(l)}</text:p>`).join('');
    const zip = new JSZip();
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
    zip.file('META-INF/manifest.xml', '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
    zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>${paras}</office:text></office:body></office:document-content>`);
    fs.writeFileSync(outputPath, await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/vnd.oasis.opendocument.text' }));
}

function markdownToLatex(md, title) {
    const texEsc = (s) => s.replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
    const inline = (s) => texEsc(s).replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}').replace(/\*(.+?)\*/g, '\\textit{$1}').replace(/`(.+?)`/g, '\\texttt{$1}');
    const out = [];
    let inList = false;
    for (const raw of md.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trimEnd();
        const li = line.match(/^\s*[-*+]\s+(.*)$/);
        if (li) { if (!inList) { out.push('\\begin{itemize}'); inList = true; } out.push(`  \\item ${inline(li[1])}`); continue; }
        if (inList) { out.push('\\end{itemize}'); inList = false; }
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) out.push(`\\${['section', 'subsection', 'subsubsection'][h[1].length - 1]}{${inline(h[2])}}`);
        else out.push(inline(line));
    }
    if (inList) out.push('\\end{itemize}');
    return `\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\title{${texEsc(title)}}\n\\begin{document}\n\\maketitle\n${out.join('\n')}\n\\end{document}\n`;
}

// ---------------------------------------------------------------- entry point

async function convert(inputPath, inExt, outputPath, outExt, baseConvert) {
    const title = path.basename(inputPath, path.extname(inputPath));

    // YAML input
    if (inExt === 'yaml' || inExt === 'yml') {
        const YAML = require('yaml');
        const data = YAML.parse(readText(inputPath));
        if (outExt === 'json') fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
        else if (outExt === 'txt') fs.writeFileSync(outputPath, YAML.stringify(data), 'utf8');
        else if (outExt === 'xml' || outExt === 'csv') {
            const tmp = path.join(os.tmpdir(), `ufc-${Date.now()}.json`);
            fs.writeFileSync(tmp, JSON.stringify(data));
            try { await baseConvert(tmp, 'json', outputPath, outExt); } finally { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } }
        }
        return;
    }

    // JSON / XML -> YAML, TSV
    if (outExt === 'yaml' && (inExt === 'json' || inExt === 'xml' || inExt === 'txt')) {
        const YAML = require('yaml');
        let data;
        if (inExt === 'json') data = JSON.parse(readText(inputPath));
        else if (inExt === 'txt') data = { text: readText(inputPath) };
        else {
            const tmp = path.join(os.tmpdir(), `ufc-${Date.now()}.json`);
            await baseConvert(inputPath, 'xml', tmp, 'json');
            try { data = JSON.parse(readText(tmp)); } finally { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } }
        }
        fs.writeFileSync(outputPath, YAML.stringify(data), 'utf8');
        return;
    }
    if (outExt === 'tsv' && (inExt === 'json' || inExt === 'xml')) {
        const tmp = path.join(os.tmpdir(), `ufc-${Date.now()}.csv`);
        await baseConvert(inputPath, inExt, tmp, 'csv');
        try { writeRows(readRows(tmp, 'csv'), outputPath, 'tsv'); } finally { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } }
        return;
    }

    // Spreadsheet-like inputs
    if (SHEET_IN.has(inExt)) {
        const rows = readRows(inputPath, inExt);
        const needsPdf = writeRows(rows, outputPath, outExt, baseConvert);
        if (needsPdf) {
            const tmp = path.join(os.tmpdir(), `ufc-${Date.now()}.txt`);
            fs.writeFileSync(tmp, rows.map((r) => r.join('    ')).join('\n'), 'utf8');
            try { await baseConvert(tmp, 'txt', outputPath, 'pdf'); } finally { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } }
        }
        return;
    }

    // Everything else goes through plain text (or markdown / html where the source has it)
    let text;
    if (inExt === 'txt') text = readText(inputPath);
    else if (inExt === 'md') text = readText(inputPath);
    else {
        const tmp = path.join(os.tmpdir(), `ufc-${Date.now()}.txt`);
        await baseConvert(inputPath, inExt, tmp, 'txt');
        try { text = readText(tmp); } finally { try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ } }
    }

    switch (outExt) {
        case 'md': fs.writeFileSync(outputPath, text, 'utf8'); break;
        case 'json': fs.writeFileSync(outputPath, JSON.stringify({ text }, null, 2), 'utf8'); break;
        case 'rtf': fs.writeFileSync(outputPath, textToRtf(text), 'latin1'); break;
        case 'odt': await writeOdt(text, outputPath); break;
        case 'epub': await writeEpub(textToHtmlBody(text), title, outputPath); break;
        case 'latex': case 'tex': fs.writeFileSync(outputPath, markdownToLatex(text, title), 'utf8'); break;
        default: throw new Error(`Cannot convert ${inExt} to ${outExt}`);
    }
}

module.exports = { handles, convert };
