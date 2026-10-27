'use strict';

/**
 * Rebuilds the channel allowlists inside src/preload/index.js from the main-process source.
 *   node scripts/gen-preload.js          write the file
 *   node scripts/gen-preload.js --check  exit 1 if it is out of date (used by the tests)
 *
 * The preload runs sandboxed and cannot require local files, so the lists have to be inline.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const preloadFile = path.join(root, 'src', 'preload', 'index.js');

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

function collect() {
    const invoke = new Set();
    const send = new Set();
    const events = new Set();
    for (const file of walk(path.join(root, 'src', 'main'))) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/(?<![\w.])handle\(\s*'([^']+)'/g)) invoke.add(m[1]);
        for (const m of src.matchAll(/(?<![\w.])on\(\s*'([^']+)'/g)) send.add(m[1]);
        for (const m of src.matchAll(/(?:ctx\.)?send\(\s*'([^']+)'/g)) events.add(m[1]);
    }
    return { invoke: [...invoke].sort(), send: [...send].sort(), events: [...events].sort() };
}

function render(list) {
    const fmt = (arr) => `[\n${arr.map((c) => `    '${c}'`).join(',\n')}\n]`;
    return `// <generated:channels>\nconst INVOKE = new Set(${fmt(list.invoke)});\nconst SEND = new Set(${fmt(list.send)});\nconst EVENTS = new Set(${fmt(list.events)});\n// </generated:channels>`;
}

function build() {
    const current = fs.readFileSync(preloadFile, 'utf8');
    const block = render(collect());
    const next = current.replace(/\/\/ <generated:channels>[\s\S]*?\/\/ <\/generated:channels>/, block);
    return { current, next };
}

if (require.main === module) {
    const { current, next } = build();
    if (process.argv.includes('--check')) {
        if (current !== next) { console.error('src/preload/index.js is out of date: run `node scripts/gen-preload.js`'); process.exit(1); }
        console.log('preload channel lists are up to date');
    } else {
        fs.writeFileSync(preloadFile, next);
        console.log('preload channel lists updated');
    }
}

module.exports = { collect, build };
