'use strict';

/**
 * Runs the engine suites inside Electron, one after another, and exits non-zero if any fail.
 *   node scripts/run-tests.js            conversion matrix + document matrix
 *   node scripts/run-tests.js --network  also the yt-dlp suite (needs internet)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require('electron');

const suites = [
    ['Conversion matrix (audio, video, images)', 'test/matrix.main.js', 'matrix.json'],
    ['Document matrix', 'test/docs.main.js', 'docs.json']
];
if (process.argv.includes('--network')) suites.push(['yt-dlp engine', 'test/ytdlp.main.js', 'ytdlp.json']);

let failed = 0;
for (const [label, file, report] of suites) {
    const out = path.join(os.tmpdir(), `ufc-${report}`);
    try { fs.unlinkSync(out); } catch (_) { /* first run */ }
    console.log(`\n=== ${label}`);
    const args = [path.join(root, file), out];
    if (process.platform === 'linux') args.unshift('--no-sandbox');
    const r = spawnSync(electron, args, { cwd: root, stdio: 'inherit', timeout: 15 * 60 * 1000 });
    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (_) { /* report missing */ }
    const bad = rows.filter((x) => x.ok === false);
    if (!rows.length) { console.log('No report was written: the suite did not finish.'); failed += 1; continue; }
    console.log(`${rows.length - bad.length}/${rows.length} checks passed`);
    for (const b of bad) console.log(`  FAIL ${b.group || b.input || ''} ${b.name || b.output || ''}: ${String(b.detail).slice(0, 200)}`);
    if (r.status !== 0) failed += 1; // each suite exits non-zero when a check that must pass does not
}

process.exit(failed ? 1 : 0);
