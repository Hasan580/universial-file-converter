'use strict';

/**
 * PDF text extraction straight on pdfjs-dist. It replaces `pdf-parse`, which pulls in a 36 MB native
 * canvas just to offer screenshots this app never uses. Same shape: new PDFParse({ data }).getText().
 */

let lib = null;
const load = async () => lib || (lib = await import('pdfjs-dist/legacy/build/pdf.mjs'));

class PDFParse {
    constructor({ data }) {
        this._data = data;
        this._doc = null;
    }

    async _open() {
        if (this._doc) return this._doc;
        const pdfjs = await load();
        const task = pdfjs.getDocument({
            data: Uint8Array.from(this._data), // pdf.js may transfer (detach) the buffer it is given, so hand it a copy
            disableFontFace: true,
            useSystemFonts: false,
            isEvalSupported: false,
            verbosity: 0
        });
        this._doc = await task.promise;
        return this._doc;
    }

    /** Text of every page. Items on one line are joined; wide gaps become the cell separator (a tab by default). */
    async getText({ cellSeparator = '\t' } = {}) {
        const doc = await this._open();
        const pages = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
            const page = await doc.getPage(n);
            const content = await page.getTextContent();
            const lines = [];
            let line = '';
            let lastY = null;
            let lastEnd = null;
            for (const item of content.items) {
                if (typeof item.str !== 'string') continue;
                const y = item.transform[5];
                const x = item.transform[4];
                if (lastY !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; lastEnd = null; }
                if (lastEnd !== null && line) {
                    const gap = x - lastEnd;
                    const size = Math.abs(item.transform[0]) || 10;
                    if (gap > size * 1.6) line += cellSeparator;
                    else if (gap > size * 0.15 && !/\s$/.test(line) && !/^\s/.test(item.str)) line += ' ';
                }
                line += item.str;
                lastY = y;
                lastEnd = x + (item.width || 0);
                if (item.hasEOL) { lines.push(line); line = ''; lastY = null; lastEnd = null; }
            }
            if (line) lines.push(line);
            pages.push(lines.join('\n'));
            page.cleanup();
        }
        return { text: pages.join('\n\n'), total: doc.numPages };
    }

    async getInfo() {
        const doc = await this._open();
        const meta = await doc.getMetadata().catch(() => null);
        return { info: (meta && meta.info) || {}, total: doc.numPages };
    }

    async destroy() {
        if (!this._doc) return;
        try { await this._doc.destroy(); } catch (_) { /* already gone */ }
        this._doc = null;
    }
}

module.exports = { PDFParse };
