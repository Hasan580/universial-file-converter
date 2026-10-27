'use strict';

const ctx = require('./ctx');
const tray = require('./tray');
const paths = require('./paths');

/**
 * Tracks running jobs so the taskbar/dock icon shows overall progress and the tray tooltip
 * says what the app is busy with.
 */
const jobs = new Map(); // id -> { label, percent }

function refresh() {
    const w = ctx.getWindow();
    if (!jobs.size) {
        if (w) w.setProgressBar(-1);
        tray.setTooltip(paths.APP_TITLE);
        return;
    }
    const values = [...jobs.values()];
    const known = values.filter((j) => Number.isFinite(j.percent));
    const avg = known.length ? known.reduce((s, j) => s + j.percent, 0) / known.length : 0;
    if (w) w.setProgressBar(known.length ? Math.min(0.99, avg / 100) : 2); // 2 = indeterminate
    const label = values.length === 1 ? values[0].label : `${values.length} tasks`;
    tray.setTooltip(`${paths.APP_TITLE} - ${label}`);
}

function start(id, label) { jobs.set(id, { label, percent: NaN }); refresh(); }
function progress(id, percent) {
    const j = jobs.get(id);
    if (!j) return;
    j.percent = Number.isFinite(percent) ? percent : NaN;
    refresh();
}
function stop(id) { jobs.delete(id); refresh(); }
function count() { return jobs.size; }

module.exports = { start, progress, stop, count };
