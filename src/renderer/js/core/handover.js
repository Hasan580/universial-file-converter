import { api } from './api.js';
import { app } from './state.js';
import { navigate } from './router.js';
import { toast } from './ui.js';
import { PAGE_FOR_TYPE } from '../routes.js';

/**
 * Send files to the converter that fits their type. They are queued in app state and the destination
 * page picks them up when it opens. Used for the window drop, the OS "open with" and the Home page.
 */
export async function handOver(paths) {
    const infos = await api.files.infoMany(paths).catch(() => []);
    const usable = infos.filter((i) => PAGE_FOR_TYPE[i.type]);
    if (!usable.length) { toast('None of those files can be converted here.', { type: 'warning' }); return; }

    const byPage = {};
    for (const i of usable) (byPage[PAGE_FOR_TYPE[i.type]] ||= []).push(i.path);
    const target = Object.keys(byPage).sort((a, b) => byPage[b].length - byPage[a].length)[0];

    app.set({ pendingFiles: [...app.get().pendingFiles, ...usable.map((i) => i.path)] });
    navigate(target);
    const skipped = infos.length - usable.length;
    toast(`${usable.length} file${usable.length > 1 ? 's' : ''} added${skipped ? `, ${skipped} skipped` : ''}`, { type: 'info', timeout: 2400 });
}
