/**
 * Document Conversion Handler
 * Supports: PDF, DOCX, DOC, XLSX, XLS, PPTX, TXT, HTML, CSV, RTF, MD, XML, JSON
 */

// ── Polyfills for Electron compatibility (must be before pdf-parse import) ──
if (typeof globalThis.DOMMatrix === 'undefined') {
    globalThis.DOMMatrix = class DOMMatrix {
        constructor(init) {
            const m = new Float64Array(16);
            m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
            Object.assign(this, { a:1,b:0,c:0,d:1,e:0,f:0,
                m11:1,m12:0,m13:0,m14:0,m21:0,m22:1,m23:0,m24:0,
                m31:0,m32:0,m33:1,m34:0,m41:0,m42:0,m43:0,m44:1,
                is2D:true,isIdentity:true });
        }
        inverse() { return new DOMMatrix(); }
        multiply() { return new DOMMatrix(); }
        scale() { return new DOMMatrix(); }
        translate() { return new DOMMatrix(); }
        transformPoint(p) { return p || { x:0, y:0 }; }
    };
}
if (typeof globalThis.Path2D === 'undefined') {
    globalThis.Path2D = class Path2D {
        constructor() {}
        addPath() {}
        moveTo() {}
        lineTo() {}
        bezierCurveTo() {}
        rect() {}
        arc() {}
        closePath() {}
    };
}

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Table, TableRow, TableCell, WidthType, BorderStyle,
    ShadingType, convertInchesToTwip, BiDirectional
} = require('docx');

// Cancellation flag for document operations
let cancelled = false;

function cancelConversion() {
    cancelled = true;
    return true;
}

function resetCancellation() {
    cancelled = false;
}

// pdf-parse v2 for actual PDF text extraction (with DOMMatrix polyfill above)
let PDFParseClass = null;
try {
    const pdfParseModule = require('pdf-parse');
    PDFParseClass = pdfParseModule.PDFParse;
} catch (err) {
    console.warn('pdf-parse not available, PDF text extraction will be limited:', err.message);
}

// Electron BrowserWindow for high-fidelity PDF rendering (DOCX→PDF, HTML→PDF, etc.)
let ElectronBrowserWindow = null;
try {
    ElectronBrowserWindow = require('electron').BrowserWindow;
} catch (e) { /* Not in Electron environment (e.g. testing) */ }

// Supported conversion paths - comprehensive matrix
const conversionMatrix = {
    'docx': ['pdf', 'txt', 'html', 'docx', 'rtf', 'md', 'odt', 'epub'],
    'doc': ['pdf', 'txt', 'html', 'docx', 'rtf', 'md', 'odt'],
    'xlsx': ['csv', 'tsv', 'txt', 'html', 'json', 'xlsx', 'xml', 'ods', 'pdf'],
    'xls': ['csv', 'tsv', 'txt', 'html', 'json', 'xlsx', 'xml', 'ods', 'pdf'],
    'pptx': ['pdf', 'txt', 'html', 'docx', 'md'],
    'txt': ['pdf', 'html', 'docx', 'md', 'rtf', 'json', 'yaml', 'epub'],
    'pdf': ['txt', 'docx', 'html', 'md', 'rtf'],
    'csv': ['xlsx', 'tsv', 'json', 'html', 'txt', 'xml', 'ods'],
    'tsv': ['csv', 'xlsx', 'json', 'html', 'txt', 'xml'],
    'html': ['pdf', 'txt', 'docx', 'md', 'rtf', 'epub'],
    'htm': ['pdf', 'txt', 'docx', 'md', 'rtf', 'epub'],
    'rtf': ['txt', 'html', 'docx', 'pdf', 'md'],
    'json': ['csv', 'tsv', 'txt', 'html', 'xlsx', 'xml', 'yaml'],
    'yaml': ['json', 'txt', 'xml', 'csv'],
    'yml': ['json', 'txt', 'xml', 'csv'],
    'md': ['html', 'pdf', 'txt', 'docx', 'rtf', 'epub', 'latex'],
    'xml': ['json', 'csv', 'tsv', 'txt', 'html', 'yaml'],
    'odt': ['pdf', 'docx', 'txt', 'html', 'md', 'rtf'],
    'ods': ['xlsx', 'csv', 'tsv', 'json', 'html', 'pdf'],
    'epub': ['pdf', 'txt', 'html', 'docx', 'md'],
    'latex': ['pdf', 'html', 'txt', 'docx', 'md'],
    'tex': ['pdf', 'html', 'txt', 'docx', 'md']
};

const commandAvailabilityCache = new Map();
const CONVERTX_INPUT_ALIASES = {
    md: 'markdown',
    htm: 'html',
    yml: 'yaml',
    text: 'txt'
};
const CONVERTX_OUTPUT_ALIASES = {
    md: 'markdown',
    htm: 'html',
    yml: 'yaml',
    text: 'txt'
};

function normalizeForExternalEngine(ext, aliases = {}) {
    const normalized = String(ext || '').trim().toLowerCase();
    return aliases[normalized] || normalized;
}

function canUseConvertXTools() {
    const mode = String(process.env.DOCUMENT_ENGINE || process.env.CONVERTX_DOCUMENT_ENGINE || 'auto').toLowerCase();
    return mode !== 'legacy' && mode !== 'internal';
}

function commandExists(command) {
    if (!command) return Promise.resolve(false);
    if (commandAvailabilityCache.has(command)) {
        return Promise.resolve(commandAvailabilityCache.get(command));
    }

    return new Promise((resolve) => {
        const checker = process.platform === 'win32' ? 'where' : 'which';
        execFile(checker, [command], { windowsHide: true }, (error) => {
            const exists = !error;
            commandAvailabilityCache.set(command, exists);
            resolve(exists);
        });
    });
}

function runCommand(command, args, timeout = 120000) {
    return new Promise((resolve, reject) => {
        execFile(command, args, {
            windowsHide: true,
            timeout,
            maxBuffer: 1024 * 1024 * 10
        }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`${command} failed: ${String(stderr || stdout || error.message).trim()}`));
                return;
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

function escapePowerShellString(value) {
    return String(value || '').replace(/'/g, "''");
}

async function convertWithWordCom(inputPath, outputPath, saveFormat) {
    if (process.platform !== 'win32') return false;

    const resolvedInput = path.resolve(inputPath);
    const resolvedOutput = path.resolve(outputPath);
    const outDir = path.dirname(resolvedOutput);

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const psIn = escapePowerShellString(resolvedInput);
    const psOut = escapePowerShellString(resolvedOutput);

    const script = [
        "$ErrorActionPreference = 'Stop'",
        `$in = '${psIn}'`,
        `$out = '${psOut}'`,
        '$word = $null',
        '$doc = $null',
        'try {',
        '  $word = New-Object -ComObject Word.Application',
        '  $word.Visible = $false',
        '  $word.DisplayAlerts = 0',
        '  $doc = $word.Documents.Open($in, $false, $true)',
        `  $saveFormat = ${Number(saveFormat) || 16}`,
        '  $doc.SaveAs2([ref]$out, [ref]$saveFormat)',
        "  Write-Output 'ok'",
        '} catch {',
        "  Write-Output ('error:' + $_.Exception.Message)",
        '  exit 1',
        '} finally {',
        '  if ($doc -ne $null) { $doc.Close($false) }',
        '  if ($word -ne $null) { $word.Quit() }',
        '  if ($doc -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null }',
        '  if ($word -ne $null) { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null }',
        '  [GC]::Collect()',
        '  [GC]::WaitForPendingFinalizers()',
        '}'
    ].join('\n');

    try {
        await runCommand('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            script
        ], 300000);
    } catch (_) {
        return false;
    }

    return fs.existsSync(resolvedOutput) && fs.statSync(resolvedOutput).size > 0;
}

async function convertPdfToDocxWithWord(inputPath, outputPath) {
    // Word format code 16 = wdFormatXMLDocument (.docx)
    return convertWithWordCom(inputPath, outputPath, 16);
}

async function convertDocToPdfWithWord(inputPath, outputPath) {
    // Word format code 17 = wdFormatPDF (.pdf)
    return convertWithWordCom(inputPath, outputPath, 17);
}

async function convertHtmlToPdfWithWord(inputPath, outputPath) {
    // Word can open HTML/HTM and export with high layout fidelity.
    return convertWithWordCom(inputPath, outputPath, 17);
}

function readTextFileWithEncoding(filePath, fallbackEncoding = 'utf-8') {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length >= 2) {
        // UTF-16 LE BOM
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            return buffer.slice(2).toString('utf16le');
        }
        // UTF-16 BE BOM (convert to LE)
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
            const sliced = buffer.slice(2);
            const swapped = Buffer.allocUnsafe(sliced.length);
            for (let i = 0; i < sliced.length; i += 2) {
                swapped[i] = sliced[i + 1] || 0;
                swapped[i + 1] = sliced[i] || 0;
            }
            return swapped.toString('utf16le');
        }
    }
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return buffer.slice(3).toString('utf8');
    }
    return buffer.toString(fallbackEncoding);
}

function getSofficeOutputPath(inputPath, outputDirectory, outputFormat) {
    const baseName = path.basename(inputPath, path.extname(inputPath));
    return path.join(outputDirectory, `${baseName}.${outputFormat}`);
}

async function convertWithLibreOffice(inputPath, inputExt, outputPath, outputFormat) {
    const sofficeAvailable = await commandExists('soffice');
    if (!sofficeAvailable) return false;

    const outDir = path.dirname(outputPath);
    const normalizedOut = normalizeForExternalEngine(outputFormat, CONVERTX_OUTPUT_ALIASES);
    const normalizedIn = normalizeForExternalEngine(inputExt, CONVERTX_INPUT_ALIASES);
    const args = ['--headless'];

    if (normalizedIn && normalizedIn !== inputExt) {
        args.push(`--infilter=${normalizedIn}`);
    }
    args.push('--convert-to', normalizedOut, '--outdir', outDir, inputPath);

    await runCommand('soffice', args, 180000);

    const generatedPath = getSofficeOutputPath(inputPath, outDir, outputFormat);
    if (!fs.existsSync(generatedPath)) {
        return false;
    }

    if (path.resolve(generatedPath) !== path.resolve(outputPath)) {
        fs.copyFileSync(generatedPath, outputPath);
        try { fs.unlinkSync(generatedPath); } catch (_) {}
    }

    return fs.existsSync(outputPath);
}

async function convertWithPandoc(inputPath, inputExt, outputPath, outputFormat) {
    const pandocAvailable = await commandExists('pandoc');
    if (!pandocAvailable) return false;

    const normalizedIn = normalizeForExternalEngine(inputExt, CONVERTX_INPUT_ALIASES);
    const normalizedOut = normalizeForExternalEngine(outputFormat, CONVERTX_OUTPUT_ALIASES);

    const args = [inputPath, '-f', normalizedIn, '-t', normalizedOut, '-o', outputPath];
    if (normalizedOut === 'pdf' || normalizedOut === 'latex') {
        args.unshift('--pdf-engine=xelatex');
    }

    await runCommand('pandoc', args, 180000);
    return fs.existsSync(outputPath);
}

async function convertWithMarkitdown(inputPath, outputPath, outputFormat) {
    if (String(outputFormat).toLowerCase() !== 'md') return false;
    const markitdownAvailable = await commandExists('markitdown');
    if (!markitdownAvailable) return false;

    await runCommand('markitdown', [inputPath, '-o', outputPath], 180000);
    return fs.existsSync(outputPath);
}

async function tryConvertWithConvertXTools(inputPath, inputExt, outputPath, outputFormat) {
    if (!canUseConvertXTools()) return false;

    const lowerInput = String(inputExt || '').toLowerCase();
    const lowerOutput = String(outputFormat || '').toLowerCase();

    try {
        if ((lowerInput === 'doc' || lowerInput === 'docx') && lowerOutput === 'pdf') {
            const okWordPdf = await convertDocToPdfWithWord(inputPath, outputPath);
            if (okWordPdf) return true;
        }
        if ((lowerInput === 'html' || lowerInput === 'htm') && lowerOutput === 'pdf') {
            const okHtmlPdf = await convertHtmlToPdfWithWord(inputPath, outputPath);
            if (okHtmlPdf) return true;
        }
    } catch (_) {
        // Continue with other engines.
    }

    try {
        const markitdownInputs = new Set(['pdf', 'powerpoint', 'excel', 'docx', 'pptx', 'html', 'htm']);
        if (lowerOutput === 'md' && (markitdownInputs.has(lowerInput) || lowerInput === 'pdf')) {
            const ok = await convertWithMarkitdown(inputPath, outputPath, lowerOutput);
            if (ok) return true;
        }
    } catch (_) {
        // Continue with other engines.
    }

    try {
        const okLibreOffice = await convertWithLibreOffice(inputPath, lowerInput, outputPath, lowerOutput);
        if (okLibreOffice) return true;
    } catch (_) {
        // Continue with other engines.
    }

    try {
        const okPandoc = await convertWithPandoc(inputPath, lowerInput, outputPath, lowerOutput);
        if (okPandoc) return true;
    } catch (_) {
        // Fall back to existing internal pipeline.
    }

    return false;
}

/**
 * Main conversion function
 */
async function convert(options, progressCallback) {
    resetCancellation();
    const {
        inputPath,
        outputFormat,
        outputDirectory
    } = options;

    const inputExt = path.extname(inputPath).toLowerCase().slice(1);
    const inputName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDirectory, `${inputName}.${outputFormat.toLowerCase()}`);

    // Ensure output directory exists
    if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
    }

    if (progressCallback) progressCallback(10);

    try {
        const usedExternalEngine = await tryConvertWithConvertXTools(inputPath, inputExt, outputPath, outputFormat);
        if (usedExternalEngine) {
            if (progressCallback) progressCallback(100);
            return {
                success: true,
                outputPath,
                outputSize: fs.statSync(outputPath).size,
                engine: 'convertx-tools'
            };
        }

        // Route to appropriate converter
        switch (inputExt) {
            case 'docx':
            case 'doc':
                await convertWord(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'xlsx':
            case 'xls':
                await convertExcel(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'pptx':
                await convertPowerPoint(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'csv':
                await convertCSV(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'pdf':
                await convertPDF(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'txt':
                await convertText(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'html':
            case 'htm':
                await convertHTML(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'rtf':
                await convertRTF(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'json':
                await convertJSON(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'md':
            case 'markdown':
                await convertMarkdown(inputPath, outputPath, outputFormat, progressCallback);
                break;
            case 'xml':
                await convertXML(inputPath, outputPath, outputFormat, progressCallback);
                break;
            default:
                throw new Error(`Unsupported input format: ${inputExt}`);
        }

        if (progressCallback) progressCallback(100);

        return {
            success: true,
            outputPath,
            outputSize: fs.statSync(outputPath).size
        };
    } catch (err) {
        console.error('Document conversion error:', err);
        throw new Error(`Conversion failed: ${err.message}`);
    }
}

/**
 * Convert Word documents (DOCX/DOC) - improved with better formatting preservation
 */
async function convertWord(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(20);

    switch (outputFormat.toLowerCase()) {
        case 'txt': {
            const result = await mammoth.extractRawText({ path: inputPath });
            fs.writeFileSync(outputPath, result.value, 'utf-8');
            break;
        }
        case 'html': {
            const htmlResult = await mammoth.convertToHtml({ path: inputPath }, {
                styleMap: [
                    "p[style-name='Heading 1'] => h1:fresh",
                    "p[style-name='Heading 2'] => h2:fresh",
                    "p[style-name='Heading 3'] => h3:fresh",
                    "b => strong",
                    "i => em",
                    "u => u",
                    "table => table.doc-table"
                ]
            });
            const hasRTL = /[\u0600-\u06FF\u0590-\u05FF]/.test(htmlResult.value);
            const dir = hasRTL ? ' dir="rtl"' : '';
            const html = `<!DOCTYPE html>
<html${dir} lang="${hasRTL ? 'ar' : 'en'}">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(path.basename(inputPath))}</title>
    <style>
        body { font-family: ${hasRTL ? "'Arial','Tahoma'" : "'Calibri','Arial'"}, sans-serif; 
               margin: 40px; line-height: 1.8; ${hasRTL ? 'text-align:right;' : ''} }
        h1 { color: #1a365d; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }
        h2 { color: #1e40af; }
        h3 { color: #3730a3; }
        table.doc-table { border-collapse: collapse; width: 100%; margin: 15px 0; }
        table.doc-table th, table.doc-table td { border: 1px solid #d1d5db; padding: 8px 12px; }
        table.doc-table th { background: #1e40af; color: white; }
        table.doc-table tr:nth-child(even) { background: #f8fafc; }
        img { max-width: 100%; height: auto; }
    </style>
</head>
<body>
    ${htmlResult.value}
</body>
</html>`;
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;
        }
        case 'pdf': {
            // Highest fidelity on Windows: Word handles its own formats best.
            const convertedWithWord = await convertDocToPdfWithWord(inputPath, outputPath);
            if (convertedWithWord) break;

            // Fallback: DOCX -> HTML via mammoth, then render to PDF via Electron.
            const htmlResult = await mammoth.convertToHtml({ path: inputPath });
            const hasRTLw = /[\u0600-\u06FF\u0590-\u05FF]/.test(htmlResult.value);
            const richHtml = generatePrintableHTML(htmlResult.value, path.basename(inputPath), hasRTLw);
            try {
                await htmlToPdf(richHtml, outputPath);
            } catch (e) {
                // Final fallback: text-based PDF.
                console.warn('printToPDF unavailable, using text fallback:', e.message);
                const textResult = await mammoth.extractRawText({ path: inputPath });
                await textToPDF(textResult.value, outputPath);
            }
            break;
        }
        case 'docx': {
            // Re-export: extract HTML for structure, then rebuild DOCX
            const result = await mammoth.extractRawText({ path: inputPath });
            await textToDocx(result.value, outputPath, path.basename(inputPath, path.extname(inputPath)));
            break;
        }
        default:
            throw new Error(`Cannot convert Word to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Convert Excel files (XLSX/XLS)
 */
async function convertExcel(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const workbook = xlsx.readFile(inputPath);

    if (progressCallback) progressCallback(50);

    switch (outputFormat.toLowerCase()) {
        case 'csv':
            // Convert first sheet to CSV
            const csvSheet = workbook.Sheets[workbook.SheetNames[0]];
            const csv = xlsx.utils.sheet_to_csv(csvSheet);
            fs.writeFileSync(outputPath, csv, 'utf-8');
            break;
        case 'txt':
            // Convert to tab-separated text
            const txtSheet = workbook.Sheets[workbook.SheetNames[0]];
            const txt = xlsx.utils.sheet_to_txt(txtSheet);
            fs.writeFileSync(outputPath, txt, 'utf-8');
            break;
        case 'html':
            // Convert to HTML table
            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Excel Export</title>';
            html += '<style>table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background:#4a4a4a;color:white;}tr:nth-child(even){background:#f2f2f2;}</style></head><body>';
            for (const sheetName of workbook.SheetNames) {
                const sheet = workbook.Sheets[sheetName];
                html += `<h2>${sheetName}</h2>`;
                html += xlsx.utils.sheet_to_html(sheet);
            }
            html += '</body></html>';
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;
        case 'json':
            // Convert to JSON
            const jsonSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = xlsx.utils.sheet_to_json(jsonSheet);
            fs.writeFileSync(outputPath, JSON.stringify(json, null, 2), 'utf-8');
            break;
        case 'xlsx':
            // Re-export (useful for XLS to XLSX conversion)
            xlsx.writeFile(workbook, outputPath);
            break;
        default:
            throw new Error(`Cannot convert Excel to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Convert PowerPoint files (PPTX) - improved extraction
 * Extracts text with formatting, tables, notes, and shape content
 */
async function convertPowerPoint(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(20);

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(inputPath);
    const zipEntries = zip.getEntries();

    // Collect slides in order
    const slideEntries = [];
    const noteEntries = {};
    const slideLayoutInfo = {};

    for (const entry of zipEntries) {
        const name = entry.entryName;
        // Match slide files (slide1.xml, slide2.xml, etc.)
        const slideMatch = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
        if (slideMatch) {
            slideEntries.push({ index: parseInt(slideMatch[1]), entry });
        }
        // Match slide notes
        const noteMatch = name.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/);
        if (noteMatch) {
            noteEntries[parseInt(noteMatch[1])] = entry;
        }
    }

    // Sort slides by number
    slideEntries.sort((a, b) => a.index - b.index);

    if (progressCallback) progressCallback(30);

    const slides = [];

    for (const slideInfo of slideEntries) {
        const xml = slideInfo.entry.getData().toString('utf8');
        const slideData = {
            number: slideInfo.index,
            title: '',
            texts: [],
            tables: [],
            notes: ''
        };

        // ── Extract title (usually in <p:sp> with <p:ph type="title"> or type="ctrTitle") ──
        const titleMatch = xml.match(/<p:ph[^>]*type="(?:title|ctrTitle)"[^>]*\/>([\s\S]*?)<\/p:sp>/);
        if (titleMatch) {
            const titleTexts = extractPPTXTexts(titleMatch[1]);
            slideData.title = titleTexts.join(' ').trim();
        }

        // ── Extract all text runs with formatting ──
        // Parse each shape (<p:sp>) separately
        const shapeRegex = /<p:sp>([\s\S]*?)<\/p:sp>/g;
        let shapeMatch;
        while ((shapeMatch = shapeRegex.exec(xml)) !== null) {
            const shapeXml = shapeMatch[1];
            const shapeTexts = extractPPTXTexts(shapeXml);
            if (shapeTexts.length > 0) {
                // Check if this is NOT the title shape (avoid duplication)
                const text = shapeTexts.join(' ').trim();
                if (text && text !== slideData.title) {
                    slideData.texts.push(...shapeTexts);
                }
            }
        }

        // ── Extract group shapes (<p:grpSp>) ──
        const grpRegex = /<p:grpSp>([\s\S]*?)<\/p:grpSp>/g;
        let grpMatch;
        while ((grpMatch = grpRegex.exec(xml)) !== null) {
            const grpTexts = extractPPTXTexts(grpMatch[1]);
            if (grpTexts.length > 0) {
                slideData.texts.push(...grpTexts);
            }
        }

        // ── Extract tables (<a:tbl>) ──
        const tableRegex = /<a:tbl>([\s\S]*?)<\/a:tbl>/g;
        let tableMatch;
        while ((tableMatch = tableRegex.exec(xml)) !== null) {
            const tableXml = tableMatch[1];
            const table = extractPPTXTable(tableXml);
            if (table.length > 0) {
                slideData.tables.push(table);
            }
        }

        // ── Extract notes ──
        if (noteEntries[slideInfo.index]) {
            try {
                const noteXml = noteEntries[slideInfo.index].getData().toString('utf8');
                const noteTexts = extractPPTXTexts(noteXml);
                slideData.notes = noteTexts.join(' ').trim();
            } catch (e) { /* skip */ }
        }

        slides.push(slideData);
    }

    if (progressCallback) progressCallback(60);

    // ── Generate output ──
    switch (outputFormat.toLowerCase()) {
        case 'txt': {
            let output = '';
            for (const slide of slides) {
                output += `${'═'.repeat(50)}\n`;
                output += `  Slide ${slide.number}`;
                if (slide.title) output += `: ${slide.title}`;
                output += `\n${'═'.repeat(50)}\n\n`;
                
                for (const text of slide.texts) {
                    output += `${text}\n`;
                }
                
                for (const table of slide.tables) {
                    output += '\n' + formatTableAsText(table) + '\n';
                }
                
                if (slide.notes) {
                    output += `\n[Notes: ${slide.notes}]\n`;
                }
                output += '\n';
            }
            fs.writeFileSync(outputPath, output, 'utf-8');
            break;
        }

        case 'html': {
            const hasRTL = slides.some(s => 
                /[\u0600-\u06FF\u0590-\u05FF]/.test(s.title + s.texts.join(''))
            );
            const dir = hasRTL ? ' dir="rtl"' : '';

            let html = `<!DOCTYPE html>
<html${dir} lang="${hasRTL ? 'ar' : 'en'}">
<head>
    <meta charset="UTF-8">
    <title>PowerPoint Export</title>
    <style>
        body { font-family: ${hasRTL ? "'Arial','Tahoma'" : "'Calibri','Arial'"}, sans-serif; padding: 30px; background: #f0f0f0; }
        .slide { background: white; padding: 30px 40px; margin: 25px 0; border-radius: 12px;
                 box-shadow: 0 4px 12px rgba(0,0,0,0.1); max-width: 900px; margin-left: auto; margin-right: auto; }
        .slide-header { display: flex; align-items: center; gap: 12px; margin-bottom: 15px;
                        padding-bottom: 10px; border-bottom: 2px solid #e5e7eb; }
        .slide-num { background: #2563eb; color: white; border-radius: 50%; width: 32px; height: 32px;
                     display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; flex-shrink: 0; }
        .slide-title { font-size: 20px; font-weight: 700; color: #1e293b; }
        .slide-content p { margin: 6px 0; line-height: 1.7; color: #334155; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        th, td { border: 1px solid #d1d5db; padding: 8px 12px; ${hasRTL ? 'text-align: right;' : 'text-align: left;'} }
        th { background: #1e40af; color: white; font-weight: 600; }
        tr:nth-child(even) { background: #f8fafc; }
        .notes { background: #fef3c7; padding: 10px 15px; border-radius: 6px; margin-top: 15px;
                 font-size: 13px; color: #92400e; border-left: 4px solid #f59e0b; }
    </style>
</head>
<body>`;

            for (const slide of slides) {
                html += `<div class="slide">`;
                html += `<div class="slide-header">`;
                html += `<span class="slide-num">${slide.number}</span>`;
                html += `<span class="slide-title">${escapeHtml(slide.title || `Slide ${slide.number}`)}</span>`;
                html += `</div><div class="slide-content">`;
                
                for (const text of slide.texts) {
                    html += `<p>${escapeHtml(text)}</p>`;
                }

                for (const table of slide.tables) {
                    html += '<table>';
                    table.forEach((row, ri) => {
                        html += '<tr>';
                        row.forEach(cell => {
                            html += ri === 0 ? `<th>${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`;
                        });
                        html += '</tr>';
                    });
                    html += '</table>';
                }

                if (slide.notes) {
                    html += `<div class="notes"><strong>Notes:</strong> ${escapeHtml(slide.notes)}</div>`;
                }

                html += `</div></div>`;
            }

            html += '</body></html>';
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;
        }

        case 'pdf': {
            const fullText = slides.map(s => {
                let t = `── Slide ${s.number} ──\n`;
                if (s.title) t += `${s.title}\n\n`;
                t += s.texts.join('\n');
                for (const table of s.tables) {
                    t += '\n' + formatTableAsText(table);
                }
                return t;
            }).join('\n\n');
            await textToPDF(fullText, outputPath);
            break;
        }

        case 'docx': {
            await pptxToDocx(slides, outputPath, path.basename(inputPath, '.pptx'));
            break;
        }

        default:
            throw new Error(`Cannot convert PowerPoint to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(90);
}

/**
 * Extract text runs from PPTX XML fragment
 * Returns array of text lines (paragraphs)
 */
function extractPPTXTexts(xml) {
    const texts = [];
    // Match each paragraph (<a:p>)
    const paraRegex = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g;
    let paraMatch;

    while ((paraMatch = paraRegex.exec(xml)) !== null) {
        const paraXml = paraMatch[1];
        // Get all text runs in this paragraph
        const runTexts = [];
        const textRegex = /<a:t>([^<]*)<\/a:t>/g;
        let textMatch;

        while ((textMatch = textRegex.exec(paraXml)) !== null) {
            if (textMatch[1]) runTexts.push(textMatch[1]);
        }

        const line = runTexts.join('').trim();
        if (line) texts.push(line);
    }

    return texts;
}

/**
 * Extract table data from PPTX <a:tbl> XML
 * Returns 2D array of cell texts
 */
function extractPPTXTable(tableXml) {
    const rows = [];
    const rowRegex = /<a:tr[^>]*>([\s\S]*?)<\/a:tr>/g;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
        const rowXml = rowMatch[1];
        const cells = [];
        const cellRegex = /<a:tc[^>]*>([\s\S]*?)<\/a:tc>/g;
        let cellMatch;

        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
            const cellXml = cellMatch[1];
            const cellTexts = [];
            const textRegex = /<a:t>([^<]*)<\/a:t>/g;
            let textMatch;

            while ((textMatch = textRegex.exec(cellXml)) !== null) {
                if (textMatch[1]) cellTexts.push(textMatch[1]);
            }
            cells.push(cellTexts.join(' ').trim());
        }

        if (cells.length > 0) rows.push(cells);
    }

    return rows;
}

/**
 * Format a 2D table array as readable text
 */
function formatTableAsText(table) {
    if (!table || table.length === 0) return '';

    // Calculate column widths
    const colWidths = [];
    for (const row of table) {
        row.forEach((cell, i) => {
            const len = (cell || '').length;
            colWidths[i] = Math.max(colWidths[i] || 0, len + 2);
        });
    }

    let result = '';
    const separator = '+' + colWidths.map(w => '-'.repeat(w)).join('+') + '+\n';

    result += separator;
    table.forEach((row, ri) => {
        result += '|' + row.map((cell, ci) => {
            const w = colWidths[ci] || 10;
            return (' ' + (cell || '') + ' ').padEnd(w);
        }).join('|') + '|\n';
        if (ri === 0) result += separator; // Header separator
    });
    result += separator;

    return result;
}

/**
 * Convert PPTX slides to structured DOCX
 */
async function pptxToDocx(slides, outputPath, title) {
    const hasRTL = slides.some(s =>
        /[\u0600-\u06FF\u0590-\u05FF]/.test(s.title + s.texts.join(''))
    );
    const font = hasRTL ? 'Arial' : 'Calibri';
    const docChildren = [];

    // Title
    docChildren.push(new Paragraph({
        children: [new TextRun({ text: title || 'Presentation', bold: true, size: 36, font })],
        heading: HeadingLevel.TITLE,
        spacing: { after: 400 },
        bidirectional: hasRTL,
        alignment: hasRTL ? AlignmentType.RIGHT : AlignmentType.CENTER
    }));

    for (const slide of slides) {
        // Slide heading
        let headingText = `Slide ${slide.number}`;
        if (slide.title) headingText += ` – ${slide.title}`;

        docChildren.push(new Paragraph({
            children: [new TextRun({ text: headingText, bold: true, size: 28, font, color: '1e40af' })],
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
            bidirectional: hasRTL,
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: '2563eb' } }
        }));

        // Slide text content
        for (const text of slide.texts) {
            docChildren.push(new Paragraph({
                children: [new TextRun({ text, size: 24, font })],
                spacing: { after: 100, line: 276 },
                bidirectional: hasRTL,
                alignment: hasRTL ? AlignmentType.RIGHT : AlignmentType.LEFT
            }));
        }

        // Tables
        for (const tableData of slide.tables) {
            if (tableData.length > 0) {
                const tableRows = tableData.map((row, ri) =>
                    new TableRow({
                        children: row.map(cell =>
                            new TableCell({
                                children: [new Paragraph({
                                    children: [new TextRun({
                                        text: cell || '',
                                        bold: ri === 0,
                                        size: 22,
                                        font,
                                        color: ri === 0 ? 'FFFFFF' : '000000'
                                    })],
                                    bidirectional: hasRTL
                                })],
                                shading: ri === 0 ? { fill: '1e40af', type: ShadingType.CLEAR } : undefined,
                                width: { size: Math.floor(9000 / row.length), type: WidthType.DXA }
                            })
                        )
                    })
                );

                docChildren.push(new Table({
                    rows: tableRows,
                    width: { size: 9000, type: WidthType.DXA }
                }));
                docChildren.push(new Paragraph({ spacing: { after: 200 } })); // gap after table
            }
        }

        // Notes
        if (slide.notes) {
            docChildren.push(new Paragraph({
                children: [
                    new TextRun({ text: 'Notes: ', bold: true, italics: true, size: 20, font, color: '92400e' }),
                    new TextRun({ text: slide.notes, italics: true, size: 20, font, color: '78716c' })
                ],
                spacing: { before: 100, after: 200 },
                bidirectional: hasRTL
            }));
        }
    }

    const doc = new Document({
        sections: [{
            properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
            children: docChildren
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
}

/**
 * Convert CSV files
 */
async function convertCSV(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const csvContent = fs.readFileSync(inputPath, 'utf-8');

    switch (outputFormat.toLowerCase()) {
        case 'xlsx':
            const workbook = xlsx.utils.book_new();
            const worksheet = xlsx.utils.aoa_to_sheet(
                csvContent.split('\n').map(row => row.split(','))
            );
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
            xlsx.writeFile(workbook, outputPath);
            break;
        case 'json':
            const lines = csvContent.split('\n').filter(l => l.trim());
            const headers = lines[0].split(',').map(h => h.trim());
            const data = lines.slice(1).map(line => {
                const values = line.split(',');
                const obj = {};
                headers.forEach((h, i) => obj[h] = values[i]?.trim() || '');
                return obj;
            });
            fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
            break;
        case 'html':
            const rows = csvContent.split('\n').filter(l => l.trim());
            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>CSV Export</title>';
            html += '<style>table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ddd;padding:8px;text-align:left;}th{background:#4a4a4a;color:white;}tr:nth-child(even){background:#f2f2f2;}</style></head><body><table>';
            rows.forEach((row, i) => {
                const cells = row.split(',');
                html += '<tr>' + cells.map(c => i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`).join('') + '</tr>';
            });
            html += '</table></body></html>';
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;
        case 'txt':
            // Convert CSV to readable text format
            const txtRows = csvContent.split('\n').filter(l => l.trim());
            const txtOutput = txtRows.map(row => row.split(',').join('\t')).join('\n');
            fs.writeFileSync(outputPath, txtOutput, 'utf-8');
            break;
        default:
            throw new Error(`Cannot convert CSV to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Convert PDF files - full text extraction using pdf-parse with fallback
 */
async function convertPDF(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(10);

    // Best fidelity on Windows: let Microsoft Word import PDF and save DOCX.
    if (String(outputFormat || '').toLowerCase() === 'docx') {
        if (progressCallback) progressCallback(25);
        const convertedWithWord = await convertPdfToDocxWithWord(inputPath, outputPath);
        if (convertedWithWord) {
            if (progressCallback) progressCallback(100);
            return;
        }
    }

    const pdfBuffer = fs.readFileSync(inputPath);
    let extractedText = '';
    let pageTexts = []; // per-page text for structured output
    let metadata = {};

    // ── Strategy 1: pdf-parse v2 (full text extraction) ──
    if (PDFParseClass) {
        try {
            // pdf-parse v2 uses PDFParse class with options
            const parser = new PDFParseClass({ data: pdfBuffer });
            const textResult = await parser.getText({
                lineEnforce: true,
                cellSeparator: '\t'
            });
            extractedText = textResult.text || '';
            metadata.pageCount = textResult.total || 0;

            // Try to get document info
            try {
                const info = await parser.getInfo();
                if (info.info) {
                    metadata.title = info.info.Title;
                    metadata.author = info.info.Author;
                    metadata.subject = info.info.Subject;
                }
                metadata.pageCount = info.total || metadata.pageCount;
            } catch (e) { /* info extraction is optional */ }

            await parser.destroy();
            console.log(`PDF parsed (v2): ${metadata.pageCount} pages, ${extractedText.length} chars extracted`);
        } catch (err) {
            console.warn('pdf-parse v2 failed, trying fallback:', err.message);
            extractedText = '';
        }
    }

    if (progressCallback) progressCallback(30);

    // ── Strategy 2: Manual stream extraction (fallback) ──
    if (!extractedText || extractedText.trim().length < 20) {
        try {
            extractedText = extractTextFromPDFBuffer(pdfBuffer);
            console.log(`Manual PDF extraction: ${extractedText.length} chars`);
        } catch (err) {
            console.warn('Manual PDF extraction failed:', err.message);
        }
    }

    // ── Strategy 3: pdf-lib metadata only (last resort) ──
    if (!extractedText || extractedText.trim().length < 10) {
        try {
            const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
            const pages = pdfDoc.getPages();
            metadata.pageCount = pages.length;
            metadata.title = pdfDoc.getTitle();
            metadata.author = pdfDoc.getAuthor();
            metadata.subject = pdfDoc.getSubject();

            extractedText = `[PDF Document - ${pages.length} page(s)]\n\n`;
            extractedText += `Note: This PDF may contain scanned images or non-extractable text.\n`;
            extractedText += `For scanned documents, OCR software is required.\n`;
            if (metadata.title) extractedText += `\nTitle: ${metadata.title}`;
            if (metadata.author) extractedText += `\nAuthor: ${metadata.author}`;
        } catch (err) {
            extractedText = '[Could not read PDF - file may be encrypted or corrupted]';
        }
    }

    if (progressCallback) progressCallback(50);

    // Clean up extracted text
    extractedText = cleanPDFText(extractedText);

    if (progressCallback) progressCallback(60);

    switch (outputFormat.toLowerCase()) {
        case 'txt':
            fs.writeFileSync(outputPath, extractedText, 'utf-8');
            break;

        case 'docx':
            await pdfTextToDocx(extractedText, outputPath, path.basename(inputPath, '.pdf'), metadata);
            break;

        case 'html':
            const htmlContent = pdfTextToHTML(extractedText, path.basename(inputPath));
            fs.writeFileSync(outputPath, htmlContent, 'utf-8');
            break;

        case 'md':
            fs.writeFileSync(outputPath, extractedText, 'utf-8');
            break;

        default:
            throw new Error(`Cannot convert PDF to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(90);
}

/**
 * Manual PDF text extraction from raw buffer (fallback when pdf-parse fails)
 * Handles text streams in PDF binary format
 */
function extractTextFromPDFBuffer(buffer) {
    const content = buffer.toString('binary');
    const texts = [];

    // Find all text streams between BT...ET markers
    const btEtRegex = /BT\s([\s\S]*?)ET/g;
    let match;
    while ((match = btEtRegex.exec(content)) !== null) {
        const block = match[1];
        // Extract text from Tj, TJ, ' and " operators
        const tjRegex = /\(([^)]*)\)\s*Tj/g;
        const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
        let tm;

        while ((tm = tjRegex.exec(block)) !== null) {
            const decoded = decodePDFString(tm[1]);
            if (decoded.trim()) texts.push(decoded);
        }

        while ((tm = tjArrayRegex.exec(block)) !== null) {
            const arr = tm[1];
            const parts = [];
            const strRegex = /\(([^)]*)\)/g;
            let sm;
            while ((sm = strRegex.exec(arr)) !== null) {
                parts.push(decodePDFString(sm[1]));
            }
            if (parts.join('').trim()) texts.push(parts.join(''));
        }
    }

    // Also try to find Unicode text streams (hex-encoded)
    const hexRegex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    while ((match = hexRegex.exec(content)) !== null) {
        const hex = match[1].replace(/\s/g, '');
        try {
            let str = '';
            for (let i = 0; i < hex.length; i += 4) {
                const code = parseInt(hex.substr(i, 4), 16);
                if (code > 0) str += String.fromCharCode(code);
            }
            if (str.trim()) texts.push(str);
        } catch (e) { /* skip */ }
    }

    return texts.join(' ');
}

/**
 * Decode PDF escape sequences in text strings
 */
function decodePDFString(str) {
    return str
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\\/g, '\\')
        .replace(/\\([()])/g, '$1')
        .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

/**
 * Clean up extracted PDF text - normalize whitespace, fix common issues
 */
function cleanPDFText(text) {
    if (!text) return '';
    
    return text
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Remove page markers like "-- 1 of 1 --" or "-- 3 of 5 --"
        .replace(/^\s*--\s*\d+\s*of\s*\d+\s*--\s*$/gm, '')
        // Remove excessive blank lines (more than 2 → 2)
        .replace(/\n{4,}/g, '\n\n\n')
        // Remove lines that are just whitespace
        .replace(/^\s+$/gm, '')
        // Collapse excessive spaces (3+ spaces → tab) for table detection
        .replace(/ {3,}/g, '\t')
        // Collapse multiple tabs
        .replace(/\t{2,}/g, '\t')
        // Fix broken words across lines (word-\nword → word-word)
        .replace(/(\w)-\n(\w)/g, '$1$2')
        // Trim each line
        .split('\n').map(l => l.trimEnd()).join('\n')
        .trim();
}

/**
 * Convert PDF extracted text to a well-structured DOCX
 * Features: table detection from tab data, smart heading detection, RTL support
 */
async function pdfTextToDocx(text, outputPath, title, metadata = {}) {
    const lines = text.split('\n');
    const docChildren = [];

    // Detect if text contains RTL characters (Arabic, Hebrew, etc.)
    const hasRTL = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF]/.test(text);
    const font = hasRTL ? 'Arial' : 'Calibri';

    // Add document title
    if (title) {
        docChildren.push(new Paragraph({
            children: [new TextRun({ text: title, bold: true, size: 32, font })],
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 300 },
            bidirectional: hasRTL,
            alignment: hasRTL ? AlignmentType.RIGHT : AlignmentType.LEFT
        }));
    }

    // Process lines with table detection and structure analysis
    let i = 0;
    while (i < lines.length) {
        const trimmed = lines[i].trim();

        // Skip empty lines
        if (!trimmed) { i++; continue; }

        // Skip page markers
        if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(trimmed)) { i++; continue; }

        // Detect separator lines (─── or === or ---)
        if (/^[-=_]{3,}$/.test(trimmed) || /^[─━═]{2,}$/.test(trimmed)) {
            docChildren.push(new Paragraph({
                spacing: { before: 100, after: 100 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } }
            }));
            i++; continue;
        }

        // ── Table detection: consecutive lines with tab characters ──
        if (trimmed.includes('\t')) {
            const tableRows = [];
            let j = i;
            while (j < lines.length) {
                const tline = lines[j].trim();
                if (!tline) { j++; continue; } // skip blank lines in table region
                if (!tline.includes('\t')) break; // end of table region
                const cells = tline.split('\t').map(c => c.trim()).filter(c => c);
                if (cells.length >= 2) {
                    tableRows.push(cells);
                } else {
                    break; // single-cell "table" is not a table
                }
                j++;
            }

            if (tableRows.length >= 2) {
                // We have a real table — normalize column count and create a DOCX table
                const maxCols = Math.max(...tableRows.map(r => r.length));
                const normalizedRows = tableRows.map(r => {
                    while (r.length < maxCols) r.push('');
                    return r;
                });

                const table = new Table({
                    rows: normalizedRows.map((row, ri) =>
                        new TableRow({
                            children: row.map(cell =>
                                new TableCell({
                                    children: [new Paragraph({
                                        children: [new TextRun({
                                            text: cell,
                                            bold: ri === 0,
                                            size: 22,
                                            font,
                                            color: ri === 0 ? 'FFFFFF' : '000000'
                                        })],
                                        bidirectional: hasRTL,
                                        alignment: hasRTL ? AlignmentType.RIGHT : AlignmentType.LEFT
                                    })],
                                    shading: ri === 0 ? { fill: '1e40af', type: ShadingType.CLEAR } : undefined,
                                    width: { size: Math.floor(9000 / maxCols), type: WidthType.DXA }
                                })
                            )
                        })
                    ),
                    width: { size: 9000, type: WidthType.DXA }
                });

                docChildren.push(table);
                docChildren.push(new Paragraph({ spacing: { after: 200 } }));
                i = j;
                continue;
            }
            // If only 1 row with tabs, treat as regular paragraph (clean tabs → spaces)
        }

        // ── Heading detection (strict rules — avoid marking regular text as headings) ──
        const isHeading = !trimmed.includes('\t') && trimmed.length < 80 && (
            // ALL CAPS English with at least 3 uppercase letters
            (trimmed === trimmed.toUpperCase() && /[A-Z]{3,}/.test(trimmed) && trimmed.length < 60) ||
            // Numbered section: "1. Title" or "1) Title" or "1 - Title"
            (/^\d+[\.\)]\s/.test(trimmed) && trimmed.length < 80) ||
            (/^\d+\s*[-–]\s/.test(trimmed) && trimmed.length < 80) ||
            // Short line ending with colon (section label)
            (trimmed.endsWith(':') && trimmed.length < 50)
        );

        if (isHeading) {
            docChildren.push(new Paragraph({
                children: [new TextRun({
                    text: trimmed.replace(/\t/g, ' '),
                    bold: true,
                    size: 28,
                    font
                })],
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 240, after: 120 },
                bidirectional: hasRTL,
                alignment: hasRTL ? AlignmentType.RIGHT : AlignmentType.LEFT
            }));
            i++;
            continue;
        }

        // ── Regular paragraph — collect consecutive non-empty, non-tab, non-heading lines ──
        const paraLines = [trimmed.replace(/\t/g, ' ')];
        i++;
        while (i < lines.length) {
            const next = lines[i].trim();
            if (!next) break; // empty line ends paragraph
            if (next.includes('\t')) break; // tab line starts potential table
            if (/^[-=_]{3,}$/.test(next) || /^[─━═]{2,}$/.test(next)) break; // separator
            if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(next)) break; // page marker
            // Check if next line would be a heading
            const nextIsHeading = !next.includes('\t') && next.length < 80 && (
                (next === next.toUpperCase() && /[A-Z]{3,}/.test(next) && next.length < 60) ||
                (/^\d+[\.\)]\s/.test(next) && next.length < 80) ||
                (/^\d+\s*[-–]\s/.test(next) && next.length < 80) ||
                (next.endsWith(':') && next.length < 50)
            );
            if (nextIsHeading) break;
            paraLines.push(next.replace(/\t/g, ' '));
            i++;
        }

        docChildren.push(createSmartParagraph(paraLines.join(' '), hasRTL));
    }

    // If no content was extracted, add a note
    if (docChildren.length <= 1) {
        docChildren.push(new Paragraph({
            children: [new TextRun({
                text: 'Note: Limited text could be extracted from this PDF. The document may contain scanned images that require OCR.',
                italics: true,
                color: '999999',
                size: 22
            })],
            spacing: { before: 200, after: 200 }
        }));
    }

    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: { top: 720, bottom: 720, left: 720, right: 720 }
                }
            },
            children: docChildren
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
}

/**
 * Create a paragraph with smart RTL/LTR detection
 */
function createSmartParagraph(text, defaultRTL) {
    const lineRTL = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF]/.test(text) || defaultRTL;
    
    // Split by tab to detect table-like data
    const parts = text.split('\t');
    
    const runs = [new TextRun({
        text: text,
        size: 24, // 12pt
        font: lineRTL ? 'Arial' : 'Calibri'
    })];

    return new Paragraph({
        children: runs,
        spacing: { after: 120, line: 276 }, // 1.15 line spacing
        bidirectional: lineRTL,
        alignment: lineRTL ? AlignmentType.RIGHT : AlignmentType.LEFT
    });
}

/**
 * Convert PDF text to a structured HTML document
 */
function pdfTextToHTML(text, title) {
    const hasRTL = /[\u0600-\u06FF\u0590-\u05FF]/.test(text);
    const dir = hasRTL ? ' dir="rtl"' : '';
    const align = hasRTL ? 'text-align: right;' : '';

    const lines = text.split('\n');
    let htmlBody = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            htmlBody += '<br>\n';
            continue;
        }
        // Detect headings
        if (trimmed.length < 60 && (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) || trimmed.endsWith(':'))) {
            htmlBody += `<h3${dir}>${escapeHtml(trimmed)}</h3>\n`;
        } else {
            htmlBody += `<p${dir}>${escapeHtml(trimmed)}</p>\n`;
        }
    }

    return `<!DOCTYPE html>
<html${dir} lang="${hasRTL ? 'ar' : 'en'}">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)}</title>
    <style>
        body { font-family: ${hasRTL ? "'Arial', 'Tahoma'" : "'Calibri', 'Arial'"}, sans-serif; margin: 40px; line-height: 1.8; ${align} }
        h1 { color: #1a365d; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
        h3 { color: #1e40af; margin-top: 20px; }
        p { margin: 4px 0; }
    </style>
</head>
<body>
    <h1>${escapeHtml(title)}</h1>
    ${htmlBody}
</body>
</html>`;
}

/**
 * Convert text files
 */
async function convertText(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const text = fs.readFileSync(inputPath, 'utf-8');

    switch (outputFormat.toLowerCase()) {
        case 'html':
            const html = wrapInHTML(
                `<pre>${escapeHtml(text)}</pre>`,
                path.basename(inputPath)
            );
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;
        case 'pdf':
            await textToPDF(text, outputPath);
            break;
        case 'docx':
            await textToDocx(text, outputPath, path.basename(inputPath, '.txt'));
            break;
        default:
            throw new Error(`Cannot convert Text to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Convert HTML files
 */
async function convertHTML(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const html = readTextFileWithEncoding(inputPath, 'utf-8');

    switch (outputFormat.toLowerCase()) {
        case 'txt':
            // Strip HTML tags
            const text = html.replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();
            fs.writeFileSync(outputPath, text, 'utf-8');
            break;
        case 'pdf': {
            // Highest fidelity on Windows: let Word open HTML and export to PDF.
            const convertedWithWord = await convertHtmlToPdfWithWord(inputPath, outputPath);
            if (convertedWithWord) break;

            // Fallback: render HTML directly via Electron printToPDF.
            try {
                const fullHtml = html.includes('<html') ? html : generatePrintableHTML(html, path.basename(inputPath), false);
                await htmlToPdf(fullHtml, outputPath);
            } catch (e) {
                console.warn('printToPDF unavailable, using text fallback:', e.message);
                const strippedText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                await textToPDF(strippedText, outputPath);
            }
            break;
        }
        case 'docx':
            const docxText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            await textToDocx(docxText, outputPath, path.basename(inputPath, '.html'));
            break;
        default:
            throw new Error(`Cannot convert HTML to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Convert RTF files
 */
async function convertRTF(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const rtf = fs.readFileSync(inputPath, 'utf-8');

    // Basic RTF to text conversion
    const text = rtf
        .replace(/\\par[d]?/g, '\n')
        .replace(/\{\*?\\[^{}]+\}|[{}]|\\\n?[A-Za-z]+\n?(?:-?\d+)?[ ]?/g, '')
        .replace(/\\'[0-9a-zA-Z]{2}/g, '')
        .trim();

    switch (outputFormat.toLowerCase()) {
        case 'txt':
            fs.writeFileSync(outputPath, text, 'utf-8');
            break;
        case 'html':
            const html = wrapInHTML(`<pre>${escapeHtml(text)}</pre>`, path.basename(inputPath));
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;
        case 'docx':
            await textToDocx(text, outputPath, path.basename(inputPath, '.rtf'));
            break;
        case 'pdf': {
            // Try high-fidelity rendering
            try {
                const rtfHtml = generatePrintableHTML(`<pre style="white-space:pre-wrap;font-family:monospace;">${escapeHtml(text)}</pre>`, path.basename(inputPath), false);
                await htmlToPdf(rtfHtml, outputPath);
            } catch (e) {
                await textToPDF(text, outputPath);
            }
            break;
        }
        default:
            throw new Error(`Cannot convert RTF to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Helper: Convert text to PDF with improved layout
 * Note: Standard PDF fonts do NOT support Arabic/CJK. For Arabic PDFs, use Word→PDF via other tools.
 * This function handles Latin text well and provides best-effort for Unicode.
 */
async function textToPDF(text, outputPath) {
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const fontSize = 11;
    const headingSize = 14;
    const margin = 50;
    const lineHeight = fontSize * 1.5;
    const headingLineHeight = headingSize * 1.8;
    const pageWidth = 595; // A4
    const pageHeight = 842; // A4
    const maxWidth = pageWidth - margin * 2;

    const lines = text.split('\n');
    let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    let yPosition = pageHeight - margin;

    for (const line of lines) {
        const trimmed = line.trim();

        // Check if we need a new page
        if (yPosition < margin + 30) {
            currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
            yPosition = pageHeight - margin;
        }

        // Skip empty lines but add space
        if (!trimmed) {
            yPosition -= lineHeight * 0.5;
            continue;
        }

        // Detect heading-like lines
        const isHeading = trimmed.length < 80 && (
            (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) ||
            /^(Slide \d|──|═{3,}|---+)/.test(trimmed) ||
            trimmed.endsWith(':')
        );

        // Filter to only characters the font can render
        // Standard fonts support Latin-1 and some extended Latin
        let safeText = '';
        for (const char of trimmed) {
            try {
                font.encodeText(char);
                safeText += char;
            } catch {
                safeText += '?'; // Replace unsupported chars
            }
        }

        // Word wrap long lines
        const wrappedLines = wordWrap(safeText, isHeading ? boldFont : font, isHeading ? headingSize : fontSize, maxWidth);

        for (const wLine of wrappedLines) {
            if (yPosition < margin + 20) {
                currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
                yPosition = pageHeight - margin;
            }

            currentPage.drawText(wLine || ' ', {
                x: margin,
                y: yPosition,
                size: isHeading ? headingSize : fontSize,
                font: isHeading ? boldFont : font,
                color: isHeading ? rgb(0.1, 0.15, 0.4) : rgb(0, 0, 0)
            });

            yPosition -= isHeading ? headingLineHeight : lineHeight;
        }

        // Extra space after headings
        if (isHeading) yPosition -= 4;
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
}

/**
 * Word-wrap text to fit within maxWidth using the given font metrics
 */
function wordWrap(text, font, fontSize, maxWidth) {
    if (!text) return [''];
    
    try {
        const textWidth = font.widthOfTextAtSize(text, fontSize);
        if (textWidth <= maxWidth) return [text];
    } catch {
        return [text.substring(0, 80)];
    }

    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        try {
            const testWidth = font.widthOfTextAtSize(testLine, fontSize);
            if (testWidth > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        } catch {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);

    return lines.length > 0 ? lines : [''];
}

/**
 * High-fidelity HTML to PDF conversion using Electron's BrowserWindow + printToPDF
 * This renders HTML through Chromium's engine, producing high-quality PDFs with
 * proper fonts, tables, images, RTL support, and CSS styling.
 */
async function htmlToPdf(htmlString, outputPath) {
    if (!ElectronBrowserWindow) {
        throw new Error('Electron BrowserWindow not available for PDF rendering');
    }

    const os = require('os');
    const tmpPath = path.join(os.tmpdir(), `ufc_print_${Date.now()}.html`);

    try {
        fs.writeFileSync(tmpPath, htmlString, 'utf-8');

        const win = new ElectronBrowserWindow({
            width: 794,
            height: 1123,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                javascript: false
            }
        });

        await win.loadURL(`file:///${tmpPath.replace(/\\/g, '/')}`);

        // Wait for full rendering (fonts, images, CSS layout)
        await new Promise(resolve => setTimeout(resolve, 1000));

        const pdfBuffer = await win.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: {
                marginType: 'custom',
                top: 0.4,
                bottom: 0.4,
                left: 0.4,
                right: 0.4
            }
        });

        fs.writeFileSync(outputPath, pdfBuffer);
        win.destroy();
    } finally {
        try { fs.unlinkSync(tmpPath); } catch (e) { /* cleanup */ }
    }
}

/**
 * Generate a rich, printable HTML document from content HTML
 * Used for high-fidelity DOCX→PDF, etc.
 */
function generatePrintableHTML(bodyContent, title, hasRTL) {
    const dir = hasRTL ? ' dir="rtl"' : '';
    const lang = hasRTL ? 'ar' : 'en';
    const fontFamily = hasRTL ? "'Arial', 'Tahoma', sans-serif" : "'Calibri', 'Arial', sans-serif";
    const textAlign = hasRTL ? 'text-align: right;' : '';

    return `<!DOCTYPE html>
<html${dir} lang="${lang}">
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title || 'Document')}</title>
    <style>
        @page { size: A4; margin: 2cm; }
        body {
            font-family: ${fontFamily};
            font-size: 12pt;
            line-height: 1.6;
            color: #000;
            margin: 0;
            padding: 20px 30px;
            ${textAlign}
        }
        h1 { font-size: 22pt; color: #1a365d; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-top: 0; }
        h2 { font-size: 16pt; color: #1e40af; margin-top: 18px; }
        h3 { font-size: 14pt; color: #3730a3; margin-top: 14px; }
        p { margin: 6px 0; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: avoid; }
        th, td { border: 1px solid #d1d5db; padding: 8px 10px; ${textAlign || 'text-align: left;'} }
        th { background-color: #1e40af; color: white; font-weight: 600; }
        tr:nth-child(even) { background-color: #f8fafc; }
        img { max-width: 100%; height: auto; }
        ul, ol { padding-left: 20px; }
        strong { font-weight: 700; }
        em { font-style: italic; }
    </style>
</head>
<body>
    ${bodyContent}
</body>
</html>`;
}

/**
 * Helper: Wrap content in HTML template
 */
function wrapInHTML(content, title) {
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        h1 { color: #333; border-bottom: 2px solid #7c3aed; padding-bottom: 10px; }
        pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    ${content}
</body>
</html>`;
}

/**
 * Helper: Escape HTML entities
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Helper: Convert text to DOCX with proper paragraph structure and RTL support
 */
async function textToDocx(text, outputPath, title) {
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    const hasRTL = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF]/.test(text);
    const font = hasRTL ? 'Arial' : 'Calibri';

    const docChildren = [];

    if (title) {
        docChildren.push(
            new Paragraph({
                children: [
                    new TextRun({ text: title, bold: true, size: 32, font })
                ],
                heading: HeadingLevel.HEADING_1,
                spacing: { after: 300 },
                bidirectional: hasRTL,
                alignment: hasRTL ? AlignmentType.RIGHT : AlignmentType.LEFT
            })
        );
    }

    for (const para of paragraphs) {
        const trimmed = para.trim();
        const isHeading = trimmed.length < 100 && (
            (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) ||
            trimmed.endsWith(':') ||
            /^(\d+[\.)\-]\s|[A-Z]\.|\*\s|[-–•]\s)/.test(trimmed)
        );

        const lines = para.split('\n');
        const textRuns = [];

        lines.forEach((line, index) => {
            textRuns.push(new TextRun({
                text: line.trim(),
                bold: isHeading,
                size: isHeading ? 28 : 24,
                font
            }));
            if (index < lines.length - 1) {
                textRuns.push(new TextRun({ break: 1 }));
            }
        });

        docChildren.push(
            new Paragraph({
                children: textRuns,
                heading: isHeading ? HeadingLevel.HEADING_2 : undefined,
                spacing: { after: 120, line: 276 },
                bidirectional: hasRTL,
                alignment: hasRTL ? AlignmentType.RIGHT : AlignmentType.LEFT
            })
        );
    }

    const doc = new Document({
        sections: [{
            properties: {
                page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } }
            },
            children: docChildren
        }]
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
}

/**
 * Convert JSON files
 */
async function convertJSON(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const jsonContent = fs.readFileSync(inputPath, 'utf-8');
    let data;
    
    try {
        data = JSON.parse(jsonContent);
    } catch (err) {
        throw new Error('Invalid JSON file');
    }

    if (progressCallback) progressCallback(50);

    switch (outputFormat.toLowerCase()) {
        case 'csv':
            // Convert JSON array to CSV
            if (Array.isArray(data) && data.length > 0) {
                const headers = Object.keys(data[0]);
                const csvLines = [headers.join(',')];
                
                data.forEach(row => {
                    const values = headers.map(h => {
                        let val = row[h] || '';
                        // Escape quotes and wrap in quotes if contains comma
                        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                            val = '"' + val.replace(/"/g, '""') + '"';
                        }
                        return val;
                    });
                    csvLines.push(values.join(','));
                });
                
                fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf-8');
            } else {
                throw new Error('JSON must be an array of objects for CSV conversion');
            }
            break;

        case 'txt':
            fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
            break;

        case 'html':
            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>JSON Export</title>';
            html += '<style>body{font-family:monospace;padding:20px;background:#f5f5f5;}pre{background:white;padding:20px;border-radius:5px;overflow-x:auto;}</style></head><body>';
            html += '<h2>JSON Data</h2>';
            html += '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
            html += '</body></html>';
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;

        case 'xlsx':
            if (Array.isArray(data)) {
                const workbook = xlsx.utils.book_new();
                const worksheet = xlsx.utils.json_to_sheet(data);
                xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
                xlsx.writeFile(workbook, outputPath);
            } else {
                // Convert object to array format
                const arr = Object.entries(data).map(([key, value]) => ({ Key: key, Value: JSON.stringify(value) }));
                const workbook = xlsx.utils.book_new();
                const worksheet = xlsx.utils.json_to_sheet(arr);
                xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
                xlsx.writeFile(workbook, outputPath);
            }
            break;

        case 'xml':
            const jsonToXml = (obj, rootName = 'root') => {
                let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${rootName}>\n`;
                const convert = (item, indent = '  ') => {
                    if (Array.isArray(item)) {
                        return item.map(i => convert(i, indent)).join('\n');
                    } else if (typeof item === 'object' && item !== null) {
                        return Object.entries(item).map(([k, v]) => {
                            const safeKey = k.replace(/[^a-zA-Z0-9_]/g, '_');
                            if (typeof v === 'object') {
                                return `${indent}<${safeKey}>\n${convert(v, indent + '  ')}\n${indent}</${safeKey}>`;
                            }
                            return `${indent}<${safeKey}>${escapeHtml(String(v))}</${safeKey}>`;
                        }).join('\n');
                    }
                    return `${indent}${escapeHtml(String(item))}`;
                };
                xml += convert(data) + `\n</${rootName}>`;
                return xml;
            };
            fs.writeFileSync(outputPath, jsonToXml(data), 'utf-8');
            break;

        default:
            throw new Error(`Cannot convert JSON to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Convert Markdown files
 */
async function convertMarkdown(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const mdContent = fs.readFileSync(inputPath, 'utf-8');
    
    if (progressCallback) progressCallback(50);

    switch (outputFormat.toLowerCase()) {
        case 'html':
            // Simple markdown to HTML conversion
            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Markdown Export</title>';
            html += '<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6;}code{background:#f4f4f4;padding:2px 6px;border-radius:3px;}pre{background:#f4f4f4;padding:15px;border-radius:5px;overflow-x:auto;}blockquote{border-left:4px solid #ddd;margin:0;padding-left:20px;color:#666;}</style></head><body>';
            html += markdownToHtml(mdContent);
            html += '</body></html>';
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;

        case 'txt':
            // Strip markdown formatting
            const plainText = mdContent
                .replace(/#{1,6}\s/g, '')
                .replace(/\*\*(.+?)\*\*/g, '$1')
                .replace(/\*(.+?)\*/g, '$1')
                .replace(/`(.+?)`/g, '$1')
                .replace(/\[(.+?)\]\(.+?\)/g, '$1')
                .replace(/!\[.*?\]\(.+?\)/g, '')
                .replace(/^[-*+]\s/gm, '• ')
                .replace(/^>\s/gm, '');
            fs.writeFileSync(outputPath, plainText, 'utf-8');
            break;

        case 'pdf': {
            // Convert markdown to HTML first, then render as PDF
            let mdHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Markdown Export</title>';
            mdHtml += '<style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6;}code{background:#f4f4f4;padding:2px 6px;border-radius:3px;}pre{background:#f4f4f4;padding:15px;border-radius:5px;overflow-x:auto;}blockquote{border-left:4px solid #ddd;margin:0;padding-left:20px;color:#666;}h1{color:#1a365d;border-bottom:2px solid #2563eb;padding-bottom:8px;}h2{color:#1e40af;}</style></head><body>';
            mdHtml += markdownToHtml(mdContent);
            mdHtml += '</body></html>';
            try {
                await htmlToPdf(mdHtml, outputPath);
            } catch (e) {
                await textToPDF(mdContent, outputPath);
            }
            break;
        }

        case 'docx':
            await textToDocx(mdContent, outputPath, path.basename(inputPath, path.extname(inputPath)));
            break;

        default:
            throw new Error(`Cannot convert Markdown to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Convert XML files
 */
async function convertXML(inputPath, outputPath, outputFormat, progressCallback) {
    if (progressCallback) progressCallback(30);

    const xmlContent = fs.readFileSync(inputPath, 'utf-8');
    
    // Simple XML parser
    const parseXml = (xml) => {
        const result = {};
        const tagRegex = /<([^\/\s>]+)(?:[^>]*)>([\s\S]*?)<\/\1>/g;
        let match;
        
        while ((match = tagRegex.exec(xml)) !== null) {
            const [, tag, content] = match;
            const innerMatch = /<[^>]+>/.test(content);
            
            if (innerMatch) {
                result[tag] = parseXml(content);
            } else {
                if (result[tag]) {
                    if (!Array.isArray(result[tag])) {
                        result[tag] = [result[tag]];
                    }
                    result[tag].push(content.trim());
                } else {
                    result[tag] = content.trim();
                }
            }
        }
        return result;
    };
    
    const data = parseXml(xmlContent);
    
    if (progressCallback) progressCallback(50);

    switch (outputFormat.toLowerCase()) {
        case 'json':
            fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
            break;

        case 'txt':
            fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
            break;

        case 'csv':
            // Try to flatten for CSV
            const flatten = (obj, prefix = '') => {
                const result = {};
                for (const [key, value] of Object.entries(obj)) {
                    const newKey = prefix ? `${prefix}.${key}` : key;
                    if (typeof value === 'object' && !Array.isArray(value)) {
                        Object.assign(result, flatten(value, newKey));
                    } else {
                        result[newKey] = Array.isArray(value) ? value.join('; ') : value;
                    }
                }
                return result;
            };
            const flatData = flatten(data);
            const csvContent = Object.entries(flatData).map(([k, v]) => `"${k}","${v}"`).join('\n');
            fs.writeFileSync(outputPath, 'Key,Value\n' + csvContent, 'utf-8');
            break;

        case 'html':
            let html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>XML Export</title>';
            html += '<style>body{font-family:monospace;padding:20px;background:#f5f5f5;}pre{background:white;padding:20px;border-radius:5px;overflow-x:auto;}</style></head><body>';
            html += '<h2>XML Data</h2>';
            html += '<pre>' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
            html += '</body></html>';
            fs.writeFileSync(outputPath, html, 'utf-8');
            break;

        default:
            throw new Error(`Cannot convert XML to ${outputFormat}`);
    }

    if (progressCallback) progressCallback(80);
}

/**
 * Simple markdown to HTML converter
 */
function markdownToHtml(md) {
    return md
        // Headers
        .replace(/^######\s(.+)$/gm, '<h6>$1</h6>')
        .replace(/^#####\s(.+)$/gm, '<h5>$1</h5>')
        .replace(/^####\s(.+)$/gm, '<h4>$1</h4>')
        .replace(/^###\s(.+)$/gm, '<h3>$1</h3>')
        .replace(/^##\s(.+)$/gm, '<h2>$1</h2>')
        .replace(/^#\s(.+)$/gm, '<h1>$1</h1>')
        // Bold and italic
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Code blocks
        .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        // Links and images
        .replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1">')
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
        // Blockquotes
        .replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>')
        // Horizontal rules
        .replace(/^---$/gm, '<hr>')
        // Line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/^(.+)$/gm, '<p>$1</p>')
        .replace(/<p><\/p>/g, '')
        .replace(/<p>(<h[1-6]>)/g, '$1')
        .replace(/(<\/h[1-6]>)<\/p>/g, '$1');
}

/**
 * Get supported formats for a given input type
 */
function getSupportedFormats(inputExt) {
    if (inputExt && conversionMatrix[inputExt.toLowerCase()]) {
        return conversionMatrix[inputExt.toLowerCase()];
    }
    return ['pdf', 'txt', 'html', 'csv', 'xlsx', 'json', 'docx', 'md', 'xml', 'rtf'];
}

/**
 * Get all supported input formats
 */
function getSupportedInputFormats() {
    return Object.keys(conversionMatrix);
}

const PDF_PASSWORD_PADDING = Buffer.from([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
    0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
    0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

function padPdfPassword(password) {
    const value = Buffer.from(String(password || ''), 'latin1');
    if (value.length >= 32) return value.subarray(0, 32);
    return Buffer.concat([value, PDF_PASSWORD_PADDING.subarray(0, 32 - value.length)]);
}

function md5Buffer(...parts) {
    const hash = crypto.createHash('md5');
    parts.forEach((part) => hash.update(part));
    return hash.digest();
}

function rc4Cipher(key, data) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;

    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + s[i] + key[i % key.length]) & 0xff;
        const temp = s[i];
        s[i] = s[j];
        s[j] = temp;
    }

    const out = Buffer.alloc(data.length);
    let i = 0;
    j = 0;
    for (let idx = 0; idx < data.length; idx++) {
        i = (i + 1) & 0xff;
        j = (j + s[i]) & 0xff;
        const temp = s[i];
        s[i] = s[j];
        s[j] = temp;
        const keyByte = s[(s[i] + s[j]) & 0xff];
        out[idx] = data[idx] ^ keyByte;
    }
    return out;
}

function computePdfOwnerKey(userPassword, ownerPassword) {
    const ownerPad = padPdfPassword(ownerPassword || userPassword || '');
    const userPad = padPdfPassword(userPassword || '');
    const ownerDigest = md5Buffer(ownerPad);
    return rc4Cipher(ownerDigest.subarray(0, 5), userPad);
}

function computePdfFileKey(userPassword, ownerKey, permissions, fileId) {
    const userPad = padPdfPassword(userPassword || '');
    const permissionsBuffer = Buffer.alloc(4);
    permissionsBuffer.writeInt32LE(permissions, 0);
    return md5Buffer(userPad, ownerKey, permissionsBuffer, fileId).subarray(0, 5);
}

function computePdfUserKey(fileKey) {
    return rc4Cipher(fileKey, PDF_PASSWORD_PADDING);
}

function computePdfObjectKey(fileKey, objectNumber, generationNumber) {
    const objectBytes = Buffer.from([
        objectNumber & 0xff,
        (objectNumber >> 8) & 0xff,
        (objectNumber >> 16) & 0xff,
        generationNumber & 0xff,
        (generationNumber >> 8) & 0xff
    ]);
    return md5Buffer(fileKey, objectBytes).subarray(0, Math.min(fileKey.length + 5, 16));
}

function bytesToPdfHex(bytes) {
    return Buffer.from(bytes).toString('hex').toUpperCase();
}

function readLiteralPdfString(text, startIndex) {
    let index = startIndex + 1;
    let depth = 1;
    const bytes = [];

    while (index < text.length) {
        const char = text[index];

        if (char === '\\') {
            index++;
            if (index >= text.length) break;

            const escaped = text[index];
            switch (escaped) {
                case 'n':
                    bytes.push(0x0a);
                    index++;
                    break;
                case 'r':
                    bytes.push(0x0d);
                    index++;
                    break;
                case 't':
                    bytes.push(0x09);
                    index++;
                    break;
                case 'b':
                    bytes.push(0x08);
                    index++;
                    break;
                case 'f':
                    bytes.push(0x0c);
                    index++;
                    break;
                case '(':
                case ')':
                case '\\':
                    bytes.push(escaped.charCodeAt(0));
                    index++;
                    break;
                case '\r':
                    index++;
                    if (text[index] === '\n') index++;
                    break;
                case '\n':
                    index++;
                    break;
                default: {
                    if (/[0-7]/.test(escaped)) {
                        let octal = escaped;
                        index++;
                        for (let count = 0; count < 2 && index < text.length && /[0-7]/.test(text[index]); count++, index++) {
                            octal += text[index];
                        }
                        bytes.push(parseInt(octal, 8));
                    } else {
                        bytes.push(escaped.charCodeAt(0));
                        index++;
                    }
                    break;
                }
            }
            continue;
        }

        if (char === '(') {
            depth++;
            bytes.push(char.charCodeAt(0));
            index++;
            continue;
        }

        if (char === ')') {
            depth--;
            if (depth === 0) {
                index++;
                break;
            }
            bytes.push(char.charCodeAt(0));
            index++;
            continue;
        }

        bytes.push(char.charCodeAt(0));
        index++;
    }

    return {
        value: Buffer.from(bytes),
        endIndex: index
    };
}

function readHexPdfString(text, startIndex) {
    let index = startIndex + 1;
    let hex = '';

    while (index < text.length) {
        const char = text[index];
        if (char === '>') {
            index++;
            break;
        }
        if (!/\s/.test(char)) hex += char;
        index++;
    }

    if (hex.length % 2 === 1) hex += '0';

    return {
        value: Buffer.from(hex, 'hex'),
        endIndex: index
    };
}

function encryptPdfSyntaxSection(sectionText, objectKey) {
    if (!sectionText) return Buffer.alloc(0);

    const chunks = [];
    let cursor = 0;
    let index = 0;

    const flushPlain = (end) => {
        if (end > cursor) {
            chunks.push(Buffer.from(sectionText.slice(cursor, end), 'latin1'));
        }
    };

    while (index < sectionText.length) {
        const char = sectionText[index];

        if (char === '%') {
            index++;
            while (index < sectionText.length && sectionText[index] !== '\n' && sectionText[index] !== '\r') {
                index++;
            }
            continue;
        }

        if (char === '(') {
            flushPlain(index);
            const literal = readLiteralPdfString(sectionText, index);
            chunks.push(Buffer.from(`<${bytesToPdfHex(rc4Cipher(objectKey, literal.value))}>`, 'latin1'));
            index = literal.endIndex;
            cursor = index;
            continue;
        }

        // Hex strings use <...>, but dictionaries use <<...>>.
        // Skip both angle brackets that belong to a dictionary delimiter.
        if (char === '<' && sectionText[index + 1] !== '<' && sectionText[index - 1] !== '<') {
            flushPlain(index);
            const hexString = readHexPdfString(sectionText, index);
            chunks.push(Buffer.from(`<${bytesToPdfHex(rc4Cipher(objectKey, hexString.value))}>`, 'latin1'));
            index = hexString.endIndex;
            cursor = index;
            continue;
        }

        index++;
    }

    flushPlain(sectionText.length);
    return Buffer.concat(chunks);
}

function transformPdfObjectBody(rawBodyBuffer, objectNumber, generationNumber, fileKey) {
    const objectKey = computePdfObjectKey(fileKey, objectNumber, generationNumber);
    const bodyText = rawBodyBuffer.toString('latin1');
    const streamMatch = bodyText.match(/(^|[\r\n])stream\r?\n/);

    if (!streamMatch) {
        return encryptPdfSyntaxSection(bodyText.trim(), objectKey);
    }

    const streamIndex = bodyText.indexOf('stream', streamMatch.index);
    const streamLineBreakLength = bodyText[streamIndex + 6] === '\r' && bodyText[streamIndex + 7] === '\n' ? 2 : 1;
    const dictionaryText = bodyText.slice(0, streamIndex).trim();
    const lengthMatch = dictionaryText.match(/\/Length\s+(\d+)\b/);

    if (!lengthMatch) {
        throw new Error(`Could not determine stream length for object ${objectNumber} ${generationNumber}`);
    }

    const streamStart = streamIndex + 6 + streamLineBreakLength;
    const streamLength = parseInt(lengthMatch[1], 10);
    const streamEnd = streamStart + streamLength;
    const streamData = rawBodyBuffer.subarray(streamStart, streamEnd);

    let suffixStart = streamEnd;
    if (bodyText[suffixStart] === '\r' && bodyText[suffixStart + 1] === '\n') suffixStart += 2;
    else if (bodyText[suffixStart] === '\n') suffixStart += 1;

    const endstreamIndex = bodyText.indexOf('endstream', suffixStart);
    if (endstreamIndex === -1) {
        throw new Error(`Malformed PDF stream object ${objectNumber} ${generationNumber}`);
    }

    const suffixText = bodyText.slice(endstreamIndex + 9).trim();
    const parts = [
        encryptPdfSyntaxSection(dictionaryText, objectKey),
        Buffer.from('\nstream\n', 'latin1'),
        rc4Cipher(objectKey, streamData),
        Buffer.from('\nendstream', 'latin1')
    ];

    if (suffixText) {
        parts.push(Buffer.from('\n', 'latin1'));
        parts.push(encryptPdfSyntaxSection(suffixText, objectKey));
    }

    return Buffer.concat(parts);
}

function buildEncryptedPdf(savedBytes, userPassword, ownerPassword) {
    const pdfText = savedBytes.toString('latin1');
    const objectRegex = /(^|[\r\n])(\d+)\s+(\d+)\s+obj\b/gm;
    const objects = [];
    let match;

    while ((match = objectRegex.exec(pdfText)) !== null) {
        const prefixLength = match[1] ? match[1].length : 0;
        const objectStart = match.index + prefixLength;
        const objectNumber = parseInt(match[2], 10);
        const generationNumber = parseInt(match[3], 10);
        const headerText = `${match[2]} ${match[3]} obj`;

        let contentStart = objectStart + headerText.length;
        if (pdfText[contentStart] === '\r' && pdfText[contentStart + 1] === '\n') contentStart += 2;
        else if (pdfText[contentStart] === '\n') contentStart += 1;

        objects.push({ objectStart, objectNumber, generationNumber, contentStart });
    }

    if (objects.length === 0) {
        throw new Error('Could not parse PDF structure for encryption');
    }

    let xrefIndex = pdfText.lastIndexOf('\nxref');
    if (xrefIndex !== -1) xrefIndex += 1;
    if (xrefIndex === -1) {
        xrefIndex = pdfText.lastIndexOf('\r\nxref');
        if (xrefIndex !== -1) xrefIndex += 2;
    }
    if (xrefIndex === -1) {
        xrefIndex = pdfText.lastIndexOf('xref');
    }
    if (xrefIndex === -1) {
        throw new Error('PDF cross-reference table not found');
    }

    const trailerIndex = pdfText.lastIndexOf('trailer');
    if (trailerIndex === -1) {
        throw new Error('PDF trailer not found');
    }

    const trailerText = pdfText.slice(trailerIndex, xrefIndex > trailerIndex ? xrefIndex : undefined);
    const rootMatch = trailerText.match(/\/Root\s+(\d+\s+\d+\s+R)/);
    const infoMatch = trailerText.match(/\/Info\s+(\d+\s+\d+\s+R)/);
    if (!rootMatch) {
        throw new Error('PDF root object not found');
    }

    const headerBuffer = savedBytes.subarray(0, objects[0].objectStart);
    const permissions = -4;
    const fileId = crypto.randomBytes(16);
    const ownerKey = computePdfOwnerKey(userPassword, ownerPassword);
    const fileKey = computePdfFileKey(userPassword, ownerKey, permissions, fileId);
    const userKey = computePdfUserKey(fileKey);
    const maxObjectNumber = Math.max(...objects.map((item) => item.objectNumber));
    const encryptObjectNumber = maxObjectNumber + 1;

    const rewrittenObjects = objects.map((object, idx) => {
        const boundary = idx + 1 < objects.length ? objects[idx + 1].objectStart : xrefIndex;
        const endObjectIndex = pdfText.indexOf('endobj', object.contentStart);
        if (endObjectIndex === -1 || endObjectIndex >= boundary) {
            throw new Error(`Could not parse object ${object.objectNumber} ${object.generationNumber}`);
        }

        const rawBodyBuffer = savedBytes.subarray(object.contentStart, endObjectIndex);
        return {
            objectNumber: object.objectNumber,
            generationNumber: object.generationNumber,
            body: transformPdfObjectBody(rawBodyBuffer, object.objectNumber, object.generationNumber, fileKey)
        };
    });

    rewrittenObjects.push({
        objectNumber: encryptObjectNumber,
        generationNumber: 0,
        body: Buffer.from(`<<
/Filter /Standard
/V 1
/R 2
/Length 40
/O <${bytesToPdfHex(ownerKey)}>
/U <${bytesToPdfHex(userKey)}>
/P ${permissions}
>>`, 'latin1')
    });

    rewrittenObjects.sort((a, b) => a.objectNumber - b.objectNumber);

    const chunks = [headerBuffer];
    const offsets = new Map();
    let offset = headerBuffer.length;

    rewrittenObjects.forEach((object) => {
        const objectChunk = Buffer.concat([
            Buffer.from(`${object.objectNumber} ${object.generationNumber} obj\n`, 'latin1'),
            object.body,
            Buffer.from('\nendobj\n\n', 'latin1')
        ]);

        offsets.set(object.objectNumber, offset);
        chunks.push(objectChunk);
        offset += objectChunk.length;
    });

    const xrefStart = offset;
    const totalObjects = encryptObjectNumber + 1;
    const xrefLines = ['xref', `0 ${totalObjects}`, '0000000000 65535 f '];
    for (let objectNumber = 1; objectNumber < totalObjects; objectNumber++) {
        const objectOffset = offsets.get(objectNumber) || 0;
        const state = offsets.has(objectNumber) ? 'n' : 'f';
        xrefLines.push(`${String(objectOffset).padStart(10, '0')} 00000 ${state} `);
    }

    chunks.push(Buffer.from(`${xrefLines.join('\n')}\n`, 'latin1'));

    const trailerLines = [
        'trailer',
        '<<',
        `/Size ${totalObjects}`,
        `/Root ${rootMatch[1]}`,
        `/Encrypt ${encryptObjectNumber} 0 R`,
        `/ID [<${bytesToPdfHex(fileId)}> <${bytesToPdfHex(fileId)}>]`
    ];

    if (infoMatch) trailerLines.push(`/Info ${infoMatch[1]}`);
    trailerLines.push('>>', '', 'startxref', String(xrefStart), '%%EOF');

    chunks.push(Buffer.from(trailerLines.join('\n'), 'latin1'));
    return Buffer.concat(chunks);
}

// =====================================================
// PDF Lock (Password Protection)
// =====================================================

async function lockPDF(options) {
    const { inputPath, outputPath, userPassword, ownerPassword } = options;
    
    if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error('Input PDF file not found');
    }
    if (!userPassword && !ownerPassword) {
        throw new Error('At least one password is required');
    }

    const pdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // pdf-lib doesn't natively support encryption, so we use a manual approach
    // We'll use the qpdf command-line tool if available, otherwise use a JS approach
    
    // Save the document first (unencrypted copy)
    const savedBytes = await pdfDoc.save({ useObjectStreams: false });
    const tempPath = outputPath + '.tmp';
    fs.writeFileSync(tempPath, savedBytes);
    
    // Try using qpdf for proper encryption
    try {
        const { execFileSync } = require('child_process');
        const args = ['--encrypt'];
        args.push(userPassword || '');
        args.push(ownerPassword || userPassword || '');
        args.push('256'); // AES-256 encryption
        args.push('--');
        args.push(tempPath);
        args.push(outputPath);
        
        execFileSync('qpdf', args, { timeout: 30000 });
        
        // Clean up temp
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        
        const stats = fs.statSync(outputPath);
        return { success: true, outputPath, outputSize: stats.size };
    } catch (qpdfErr) {
        // qpdf not available, try pdftk
        try {
            const { execFileSync } = require('child_process');
            const args = [tempPath, 'output', outputPath];
            if (userPassword) args.push('user_pw', userPassword);
            if (ownerPassword) args.push('owner_pw', ownerPassword);
            
            execFileSync('pdftk', args, { timeout: 30000 });
            
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            
            const stats = fs.statSync(outputPath);
            return { success: true, outputPath, outputSize: stats.size };
        } catch (pdftkErr) {
            try {
                const encryptedBytes = buildEncryptedPdf(Buffer.from(savedBytes), userPassword, ownerPassword || userPassword);
                fs.writeFileSync(outputPath, encryptedBytes);
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                const stats = fs.statSync(outputPath);
                return { success: true, outputPath, outputSize: stats.size };
            } catch (fallbackErr) {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                throw new Error(`Failed to lock PDF: ${fallbackErr.message}`);
            }
        }
    }
}

// =====================================================
// PDF Merge
// =====================================================

async function mergePDFs(options) {
    const { inputPaths, outputPath } = options;
    
    if (!inputPaths || inputPaths.length < 2) {
        throw new Error('At least 2 PDF files are required for merging');
    }
    
    // Validate all files exist and are PDFs
    for (const filePath of inputPaths) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
    }

    const mergedDoc = await PDFDocument.create();
    
    for (let i = 0; i < inputPaths.length; i++) {
        const pdfBytes = fs.readFileSync(inputPaths[i]);
        try {
            const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
            const pageCount = srcDoc.getPageCount();
            const indices = Array.from({ length: pageCount }, (_, j) => j);
            const copiedPages = await mergedDoc.copyPages(srcDoc, indices);
            copiedPages.forEach(page => mergedDoc.addPage(page));
        } catch (err) {
            throw new Error(`Failed to load PDF: ${path.basename(inputPaths[i])} - ${err.message}`);
        }
    }
    
    const mergedBytes = await mergedDoc.save();
    fs.writeFileSync(outputPath, mergedBytes);
    
    const stats = fs.statSync(outputPath);
    return {
        success: true,
        outputPath,
        outputSize: stats.size,
        pageCount: mergedDoc.getPageCount()
    };
}

function parseHexColor(hex) {
    const raw = String(hex || '').trim();
    const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return rgb(0.07, 0.07, 0.07);
    }
    const r = parseInt(normalized.slice(0, 2), 16) / 255;
    const g = parseInt(normalized.slice(2, 4), 16) / 255;
    const b = parseInt(normalized.slice(4, 6), 16) / 255;
    return rgb(r, g, b);
}

async function readEditableDocument(options) {
    const { filePath } = options || {};
    if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('Document file not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const editableExts = new Set(['.html', '.htm', '.txt', '.md', '.xml', '.json', '.csv', '.rtf']);
    if (!editableExts.has(ext)) {
        throw new Error('Only text-based files are supported for this editor');
    }

    const content = readTextFileWithEncoding(filePath, 'utf-8');
    return { success: true, filePath, content };
}

async function saveEditableDocument(options) {
    const { filePath, content } = options || {};
    if (!filePath) {
        throw new Error('Target file path is required');
    }

    const outputDir = path.dirname(filePath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(filePath, String(content || ''), 'utf-8');
    const stats = fs.statSync(filePath);
    return { success: true, filePath, outputSize: stats.size };
}

async function addTextToPDF(options) {
    const {
        inputPath,
        outputPath,
        text,
        pageNumber = 1,
        x = 50,
        y = 50,
        fontSize = 18,
        color = '#111111'
    } = options || {};

    if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error('Input PDF file not found');
    }

    if (!outputPath) {
        throw new Error('Output PDF path is required');
    }

    const overlayText = String(text || '').trim();
    if (!overlayText) {
        throw new Error('Text to add is required');
    }

    const pdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    if (pages.length === 0) {
        throw new Error('PDF has no pages');
    }

    const safePageIndex = Math.max(0, Math.min(pages.length - 1, Number(pageNumber) - 1));
    const page = pages[safePageIndex];
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    page.drawText(overlayText, {
        x: Number.isFinite(Number(x)) ? Number(x) : 50,
        y: Number.isFinite(Number(y)) ? Number(y) : 50,
        size: Number.isFinite(Number(fontSize)) ? Number(fontSize) : 18,
        font,
        color: parseHexColor(color)
    });

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const bytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, bytes);

    return {
        success: true,
        outputPath,
        pageCount: pages.length,
        pageNumber: safePageIndex + 1,
        outputSize: fs.statSync(outputPath).size
    };
}

async function readPDFTextForEditing(options) {
    const { inputPath } = options || {};
    if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error('Input PDF file not found');
    }

    const pdfBuffer = fs.readFileSync(inputPath);
    let extractedText = '';
    let pageCount = 0;

    if (PDFParseClass) {
        try {
            const parser = new PDFParseClass({ data: pdfBuffer });
            const textResult = await parser.getText({ lineEnforce: true, cellSeparator: '\t' });
            extractedText = textResult.text || '';
            pageCount = textResult.total || 0;
            await parser.destroy();
        } catch (_) {
            extractedText = '';
        }
    }

    if (!extractedText || extractedText.trim().length < 20) {
        try {
            extractedText = extractTextFromPDFBuffer(pdfBuffer);
        } catch (_) {
            extractedText = '';
        }
    }

    if (!extractedText || extractedText.trim().length < 5) {
        extractedText = '[Could not extract editable text from this PDF. It may be scanned or protected.]';
    }

    return {
        success: true,
        inputPath,
        pageCount,
        text: cleanPDFText(extractedText)
    };
}

async function savePDFTextEdits(options) {
    const { inputPath, outputPath, text } = options || {};
    if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error('Input PDF file not found');
    }
    if (!outputPath) {
        throw new Error('Output path is required');
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    await textToPDF(String(text || ''), outputPath);
    return {
        success: true,
        outputPath,
        outputSize: fs.statSync(outputPath).size
    };
}

module.exports = {
    convert,
    getSupportedFormats,
    getSupportedInputFormats,
    conversionMatrix,
    canUseConvertXTools,
    cancelConversion,
    resetCancellation,
    lockPDF,
    mergePDFs,
    readEditableDocument,
    saveEditableDocument,
    addTextToPDF,
    readPDFTextForEditing,
    savePDFTextEdits
};
