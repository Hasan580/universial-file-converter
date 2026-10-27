'use strict';

/** Opens a generated audio file the way "Open with" does, converts it through the real UI, and checks the result. */
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, js, sleep, shot, ctx, report, out, data }) => {
    const bin = require('../../src/main/binaries');
    const work = path.join(data, 'work');
    const dest = path.join(data, 'converted');
    fs.mkdirSync(work, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });

    const sample = path.join(work, 'Song One.wav');
    const r = await bin.runCapture(bin.ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', sample], { timeout: 30000 });
    if (!r.ok) throw new Error('could not create the sample file');

    // Output goes to a throwaway folder, never the real Downloads folder.
    // The page keeps its own copy of the settings, so reload after changing them to behave like a fresh start.
    await js(`window.ufc.invoke('save-settings', { outputDirectory: ${JSON.stringify(dest)}, playSounds: false })`);
    await js(`location.reload()`);
    await sleep(2600);

    ctx.send('context-menu-convert', sample);
    await sleep(1500);
    await shot('convert-1-added');

    const added = await js(`document.querySelectorAll('.file').length`);
    const title = await js(`document.querySelector('h1') && document.querySelector('h1').textContent`);

    await js(`document.querySelector('.chip[data-id="flac"]').click()`);
    await sleep(200);
    await js(`[...document.querySelectorAll('.btn.primary')].find(b => /Convert/.test(b.textContent)).click()`);

    let done = false;
    for (let i = 0; i < 80 && !done; i += 1) {
        await sleep(250);
        done = await js(`!!document.querySelector('.file.done')`);
    }
    await sleep(400);
    await shot('convert-2-done');

    const outputs = fs.readdirSync(dest);
    const history = await js(`window.ufc.invoke('get-conversion-history')`);
    report.scenario.convert = {
        pageTitle: title,
        filesListed: added,
        finished: done,
        outputs,
        historyTop: history[0] && { type: history[0].type, status: history[0].status, inputName: history[0].inputName },
        ok: title === 'Audio converter' && added === 1 && done && outputs.length === 1 && /\.flac$/.test(outputs[0]) && history[0] && history[0].status === 'success'
    };
    if (!report.scenario.convert.ok) report.errors.push('convert scenario failed: ' + JSON.stringify(report.scenario.convert));
};
