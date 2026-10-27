'use strict';

const paths = require('./paths');
const { readJson, writeFileAtomic } = require('./util');

/** Tiny JSON-file stores (history, stats) with debounced atomic writes. Same files as v4. */
function createStore(fileName, fallback, { limit = 0 } = {}) {
    let data = null;
    let timer = null;
    const file = () => paths.userData(fileName);
    const load = () => {
        if (data === null) {
            data = readJson(file(), fallback);
            if (Array.isArray(fallback) && !Array.isArray(data)) data = [];
        }
        return data;
    };
    const flush = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (data === null) return;
        try { writeFileAtomic(file(), JSON.stringify(data, null, 2)); } catch (err) { console.error(`Failed to save ${fileName}:`, err.message); }
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(flush, 400); };
    return {
        get: () => load(),
        set: (value) => {
            data = value;
            if (limit && Array.isArray(data) && data.length > limit) data = data.slice(0, limit);
            schedule();
            return data;
        },
        flush
    };
}

const history = createStore('conversion-history.json', [], { limit: 200 });
const stats = createStore('conversion-stats.json', { totalConverted: 0, totalSavedBytes: 0, lastUpdated: null });

function addHistory(item) {
    const list = history.get().slice();
    list.unshift(item);
    history.set(list);
}

function flushAll() {
    history.flush();
    stats.flush();
}

module.exports = { history, stats, addHistory, flushAll };
