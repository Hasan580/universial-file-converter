'use strict';

const { app } = require('electron');
const path = require('path');
const { writeFileAtomic, readJson } = require('./util');
const fs = require('fs');

// Same file and entry shape as v4 (newest first), so the history carries over.
const MAX_LOGS = 500;
let logs = [];
let logFile = null;
let timer = null;
let subscriber = null;

function init() {
    logFile = path.join(app.getPath('userData'), 'app-logs.json');
    const stored = readJson(logFile, []);
    logs = Array.isArray(stored) ? stored.slice(0, MAX_LOGS) : [];
}

function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!logFile) return;
    try {
        writeFileAtomic(logFile, JSON.stringify(logs));
    } catch (err) {
        console.error('Failed to write logs:', err.message);
    }
}

function schedule() {
    if (!timer) timer = setTimeout(flush, 1000);
}

function log(type, category, message, details = null) {
    const entry = {
        id: Date.now() + Math.random().toString(36).slice(2, 11),
        timestamp: new Date().toISOString(),
        type,
        category,
        message: String(message),
        details
    };
    logs.unshift(entry);
    if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
    schedule();

    const line = `[${type.toUpperCase()}] [${category}] ${entry.message}`;
    if (type === 'error') console.error(line, details || '');
    else if (type === 'warning') console.warn(line, details || '');
    else console.log(line);

    if (subscriber) {
        try { subscriber(entry); } catch (_) { /* ignore */ }
    }
    return entry;
}

const info = (cat, msg, d) => log('info', cat, msg, d);
const success = (cat, msg, d) => log('success', cat, msg, d);
const warning = (cat, msg, d) => log('warning', cat, msg, d);
const error = (cat, msg, d) => log('error', cat, msg, d);

function getLogs(filter = {}) {
    let out = logs;
    if (filter.type) out = out.filter((l) => l.type === filter.type);
    if (filter.category) out = out.filter((l) => l.category === filter.category);
    if (filter.limit) out = out.slice(0, filter.limit);
    return out.slice();
}

function clear() {
    logs = [];
    flush();
}

function exportTo(target) {
    try {
        const text = logs
            .map((l) => `[${l.timestamp}] [${l.type.toUpperCase()}] [${l.category}] ${l.message}${l.details ? ' - ' + JSON.stringify(l.details) : ''}`)
            .join('\n');
        fs.writeFileSync(target, text, 'utf8');
        return true;
    } catch (err) {
        console.error('Failed to export logs:', err.message);
        return false;
    }
}

function onEntry(fn) { subscriber = fn; }

module.exports = { init, log, info, success, warning, error, getLogs, clear, exportTo, flush, onEntry };
