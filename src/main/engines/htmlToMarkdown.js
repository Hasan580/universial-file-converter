'use strict';

/**
 * A small HTML to Markdown converter with no external tool and no DOM, so Word, PowerPoint and HTML
 * can become Markdown on every machine. It keeps headings, emphasis, links, lists, code, quotes and
 * tables. Scripts, styles and embedded images are dropped.
 */

const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™', bull: '•'
};

function decode(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === '#') {
            const code = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
            try { return String.fromCodePoint(code); } catch (_) { return match; }
        }
        const value = ENTITIES[entity.toLowerCase()];
        return value === undefined ? match : value;
    });
}

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'base', 'embed', 'track']);

// Opening one of these tag names closes an open element of the listed names, but only
// when no `stop` element sits between them (so a nested list keeps its parent item open).
const IMPLIED_CLOSE = {
    li: { closes: ['li'], stop: ['ul', 'ol'] },
    p: { closes: ['p'], stop: ['div', 'td', 'th', 'li', 'blockquote', 'body', 'table', 'section', 'article'] },
    tr: { closes: ['tr'], stop: ['table', 'thead', 'tbody', 'tfoot'] },
    td: { closes: ['td', 'th'], stop: ['tr', 'table'] },
    th: { closes: ['td', 'th'], stop: ['tr', 'table'] },
    dt: { closes: ['dt', 'dd'], stop: ['dl'] },
    dd: { closes: ['dt', 'dd'], stop: ['dl'] }
};

const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'hr',
    'dl', 'dt', 'dd', 'form', 'fieldset', 'address', 'body', 'html', 'center', 'details', 'summary']);

function parseAttributes(raw) {
    const attrs = {};
    const re = /([^\s=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let m;
    while ((m = re.exec(raw || ''))) attrs[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : (m[4] || ''));
    return attrs;
}

function parse(html) {
    const root = { tag: '#root', children: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];

    const open = (tag, rawAttrs) => {
        const rule = IMPLIED_CLOSE[tag];
        if (rule) {
            for (let i = stack.length - 1; i > 0; i -= 1) {
                const name = stack[i].tag;
                if (rule.closes.includes(name)) { stack.length = i; break; }
                if (rule.stop.includes(name)) break;
            }
        }
        const node = { tag, attrs: parseAttributes(rawAttrs), children: [] };
        top().children.push(node);
        if (!VOID.has(tag) && !/\/\s*$/.test(rawAttrs || '')) stack.push(node);
    };
    const close = (tag) => {
        for (let i = stack.length - 1; i > 0; i -= 1) {
            if (stack[i].tag === tag) { stack.length = i; return; }
        }
    };

    const re = /<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[1]) close(m[1].toLowerCase());
        else if (m[2]) open(m[2].toLowerCase(), m[3]);
        else if (m[4] !== undefined) top().children.push({ text: m[4] });
    }
    return root;
}

// ---------------------------------------------------------------- rendering

const BREAK = '\u0001';
const isText = (n) => n.text !== undefined;

function inlineText(text) { return decode(text).replace(/\s+/g, ' '); }

/** Collapse whitespace; hard line breaks (from <br>) survive as Markdown line breaks. */
function tidy(s) {
    return s.replace(/\s+/g, ' ').trim()
        .replace(new RegExp(` ?${BREAK} ?`, 'g'), '  \n')
        .replace(/^(?: {2}\n)+|(?: {2}\n)+$/g, '').trim();
}

function wrap(content, mark) {
    const m = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : content;
}

function rawText(node) {
    if (isText(node)) return decode(node.text);
    if (node.tag === 'br') return '\n';
    return node.children.map(rawText).join('');
}

function inlineChildren(node) {
    return node.children.map((c) => (isText(c) ? inlineText(c.text) : renderInline(c))).join('');
}

function renderInline(node) {
    const inner = () => inlineChildren(node);
    switch (node.tag) {
        case 'br': return BREAK;
        case 'strong': case 'b': return wrap(inner(), '**');
        case 'em': case 'i': case 'cite': return wrap(inner(), '*');
        case 'del': case 's': case 'strike': return wrap(inner(), '~~');
        case 'code': case 'kbd': case 'samp': case 'tt': {
            const text = rawText(node).replace(/\s+/g, ' ');
            if (!text.trim()) return '';
            return text.includes('`') ? `\`\` ${text.trim()} \`\`` : `\`${text.trim()}\``;
        }
        case 'a': {
            const text = tidy(inner());
            const href = (node.attrs.href || '').trim();
            if (!text) return '';
            if (!href || /^(javascript:|#)/i.test(href)) return text;
            return `[${text}](${href.replace(/ /g, '%20').replace(/\)/g, '%29')})`;
        }
        case 'img': {
            const src = (node.attrs.src || '').trim();
            if (!src || /^data:/i.test(src)) return '';
            return `![${(node.attrs.alt || '').replace(/[[\]]/g, '')}](${src.replace(/ /g, '%20')})`;
        }
        case 'input': return '';
        default: return inner();
    }
}

function renderBlocks(nodes) {
    const out = [];
    let run = '';
    const flush = () => { const t = tidy(run); if (t) out.push(t); run = ''; };
    for (const n of nodes) {
        if (isText(n)) { run += inlineText(n.text); continue; }
        if (!BLOCK.has(n.tag)) { run += renderInline(n); continue; }
        flush();
        out.push(...renderBlock(n));
    }
    flush();
    return out;
}

function renderList(node) {
    const ordered = node.tag === 'ol';
    const start = ordered ? parseInt(node.attrs.start, 10) || 1 : 1;
    const lines = [];
    let index = 0;
    for (const item of node.children) {
        if (isText(item) || item.tag !== 'li') continue;
        const marker = ordered ? `${start + index}. ` : '- ';
        index += 1;
        const [first = '', ...rest] = renderBlocks(item.children);
        const pad = ' '.repeat(marker.length);
        const indent = (block) => block.split('\n').map((l) => (l ? pad + l : l)).join('\n');
        lines.push([marker + first.split('\n').join(`\n${pad}`), ...rest.map(indent)].join('\n'));
    }
    return lines.join('\n');
}

function cellText(cell) {
    return renderBlocks(cell.children).join(' ').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderTable(node) {
    const rows = [];
    const collect = (n) => {
        for (const c of n.children) {
            if (isText(c)) continue;
            if (c.tag === 'tr') rows.push(c.children.filter((x) => !isText(x) && (x.tag === 'td' || x.tag === 'th')).map(cellText));
            else if (['thead', 'tbody', 'tfoot'].includes(c.tag)) collect(c);
        }
    };
    collect(node);
    const filled = rows.filter((r) => r.length);
    if (!filled.length) return [];
    const width = Math.max(...filled.map((r) => r.length));
    const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`;
    return [[line(filled[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...filled.slice(1).map(line)].join('\n')];
}

function renderBlock(node) {
    const tag = node.tag;
    if (/^h[1-6]$/.test(tag)) {
        const text = tidy(inlineChildren(node));
        return text ? [`${'#'.repeat(Number(tag[1]))} ${text}`] : [];
    }
    switch (tag) {
        case 'hr': return ['---'];
        case 'pre': {
            const code = node.children.find((c) => !isText(c) && c.tag === 'code');
            const lang = (((code && code.attrs.class) || node.attrs.class || '').match(/(?:language|lang)-([\w+-]+)/) || [])[1] || '';
            const text = rawText(node).replace(/^\n+|\s+$/g, '');
            return text ? [`\`\`\`${lang}\n${text}\n\`\`\``] : [];
        }
        case 'blockquote': {
            const body = renderBlocks(node.children).join('\n\n');
            return body ? [body.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')] : [];
        }
        case 'ul': case 'ol': { const list = renderList(node); return list ? [list] : []; }
        case 'table': return renderTable(node);
        case 'dt': { const t = tidy(inlineChildren(node)); return t ? [`**${t}**`] : []; }
        default: return renderBlocks(node.children);
    }
}

/** @param {string} html @returns {string} Markdown text ending in a newline. */
function htmlToMarkdown(html) {
    const cleaned = String(html || '').replace(/<(script|style|head|noscript|template|svg|iframe)\b[\s\S]*?<\/\1\s*>/gi, '');
    const blocks = renderBlocks(parse(cleaned).children);
    return `${blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

module.exports = { htmlToMarkdown };
