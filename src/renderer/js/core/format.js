export function bytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** 83 -> "1:23", 3725 -> "1:02:05" */
export function duration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function ago(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function clockTime(iso) {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

export const basename = (p) => String(p || '').split(/[\\/]/).pop();
export const dirname = (p) => String(p || '').replace(/[\\/][^\\/]*$/, '');
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export const stem = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };

export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

/** Local file path -> file:// URL that works on Windows, macOS and Linux. */
export function fileUrl(p) {
    const s = String(p || '').replace(/\\/g, '/');
    return encodeURI(s.startsWith('/') ? `file://${s}` : `file:///${s}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

export function eta(seconds) {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
    return duration(seconds);
}

/** Turn a speed multiplier from ffmpeg (1.5) into "1.5x". */
export const speedX = (x) => (Number.isFinite(x) && x > 0 ? `${x.toFixed(x >= 10 ? 0 : 1)}x` : '');
