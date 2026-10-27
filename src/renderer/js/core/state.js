/** Small observable stores. Pages read them; the shell and event wiring write them. */

export function store(initial) {
    let state = initial;
    const subs = new Set();
    return {
        get: () => state,
        set(patch) {
            state = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
            subs.forEach((fn) => fn(state));
        },
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
    };
}

/** Global app state. */
export const app = store({
    ready: false,
    info: null,          // version, platform, update mode...
    settings: {},
    catalog: null,       // formats the engines can really produce
    updateInfo: null,    // set when a newer release exists
    pendingFiles: []     // files handed over by the OS (context menu, drag onto the window)
});

/**
 * Running and recent jobs, shown in the activity dock. A job is { id, kind, label, percent, status,
 * phase, speed, eta, error, cancel }. Status is running | done | failed | cancelled.
 */
function createJobs() {
    const s = store({ list: [] });
    const timers = new Map();

    const patchJob = (id, patch) => s.set((st) => ({ list: st.list.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));

    return {
        subscribe: s.subscribe,
        list: () => s.get().list,
        get: (id) => s.get().list.find((j) => j.id === id),
        start(job) {
            clearTimeout(timers.get(job.id));
            s.set((st) => ({ list: [{ percent: null, status: 'running', startedAt: Date.now(), ...job }, ...st.list.filter((j) => j.id !== job.id)] }));
        },
        update(id, patch) { patchJob(id, patch); },
        finish(id, status, extra = {}) {
            patchJob(id, { status, percent: status === 'done' ? 100 : undefined, finishedAt: Date.now(), ...extra });
            // Finished jobs linger briefly so the result is visible, then drop off the dock.
            clearTimeout(timers.get(id));
            timers.set(id, setTimeout(() => s.set((st) => ({ list: st.list.filter((j) => j.id !== id) })), status === 'failed' ? 20000 : 7000));
        },
        remove(id) { s.set((st) => ({ list: st.list.filter((j) => j.id !== id) })); },
        running: () => s.get().list.filter((j) => j.status === 'running')
    };
}

export const jobs = createJobs();

let seq = 0;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1).toString(36)}`;
