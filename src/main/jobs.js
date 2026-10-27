'use strict';

const { spawn, execFile } = require('child_process');

/**
 * Registry of running external processes, so any job can be cancelled by id and
 * everything can be killed on quit. Process *trees* are killed: yt-dlp starts
 * ffmpeg children that would otherwise keep running after a cancel.
 */
const running = new Map();   // id -> { child, group }
const cancelled = new Set(); // ids cancelled by the user (consumed by wasCancelled)

function killTree(child) {
    if (!child || child.exitCode !== null || !child.pid) return;
    try {
        if (process.platform === 'win32') {
            execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
        } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { child.kill('SIGKILL'); }
        }
    } catch (_) { /* already gone */ }
}

/**
 * Spawn a process and track it under `id`. Returns the child process.
 * On POSIX the child leads its own process group so the whole tree can be signalled.
 */
function spawnTracked(id, group, command, args, options = {}) {
    cancelled.delete(id);
    const child = spawn(command, args, {
        windowsHide: true,
        detached: process.platform !== 'win32',
        ...options
    });
    const entry = { child, group };
    running.set(id, entry);
    const cleanup = () => { if (running.get(id) === entry) running.delete(id); };
    child.once('close', cleanup);
    child.once('error', cleanup);
    return child;
}

/** True once if the user cancelled this id. Call it after the process exits. */
function wasCancelled(id) {
    return cancelled.delete(id);
}

/** Cancel one job by id. Returns true when something was running. */
function cancel(id) {
    const entry = running.get(id);
    if (!entry) return false;
    cancelled.add(id);
    killTree(entry.child);
    return true;
}

/** Cancel every running job, optionally only those in a group. */
function cancelAll(group) {
    let any = false;
    for (const [id, entry] of running) {
        if (group && entry.group !== group) continue;
        cancelled.add(id);
        killTree(entry.child);
        any = true;
    }
    return any;
}

function activeCount(group) {
    let n = 0;
    for (const [, entry] of running) if (!group || entry.group === group) n += 1;
    return n;
}

module.exports = { spawnTracked, cancel, cancelAll, activeCount, wasCancelled, killTree };
