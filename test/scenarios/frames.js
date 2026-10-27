'use strict';

/** Measures how smooth the interface is: frame-to-frame times across page transitions and a long scroll. */
module.exports = async ({ js, report }) => {
    const r = await js(`(async () => {
        const deltas = []; let last = performance.now(); let running = true;
        const loop = (t) => { deltas.push(t - last); last = t; if (running) requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        const pages = ['audio', 'video', 'image', 'settings', 'history', 'home'];
        for (let round = 0; round < 3; round += 1) for (const p of pages) { location.hash = '#/' + p; await wait(450); }
        location.hash = '#/settings?section=features'; await wait(500);
        const view = document.querySelector('#view');
        for (let y = 0; y < 1600; y += 32) { view.scrollTop = y; await new Promise((res) => requestAnimationFrame(res)); }
        for (let y = 1600; y > 0; y -= 32) { view.scrollTop = y; await new Promise((res) => requestAnimationFrame(res)); }
        running = false; await wait(60);
        deltas.shift(); const sorted = deltas.slice().sort((a, b) => a - b);
        const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
        return { frames: sorted.length, p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), p99: +pct(0.99).toFixed(1), max: +sorted[sorted.length - 1].toFixed(1), slowFrames: sorted.filter((d) => d > 20).length };
    })()`);
    report.scenario.frames = r;
};
