import { createConverter } from './_converter.js';
import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { dropzone } from '../components/dropzone.js';
import { toast, copyText, errorText } from '../core/ui.js';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'ico', 'svg', 'avif', 'heif', 'heic', 'jp2', 'jxl', 'tga', 'psd', 'ppm', 'pgm', 'pbm'];
const EXIF_FORMATS = ['jpg', 'png', 'webp', 'avif', 'tiff', 'heif'];

/** Reads a QR code out of any image. It lives under the converter because it shares the same decoders. */
function qrCard() {
    const result = h('div.small', { style: 'margin-top:12px' });
    const scan = async (paths) => {
        result.replaceChildren(h('span.muted', 'Scanning...'));
        try {
            const r = await api.convert.qr(paths[0]);
            if (!r.success) { result.replaceChildren(h('span.muted', r.error)); return; }
            const isUrl = /^https?:\/\//i.test(r.data);
            result.replaceChildren(
                h('div.notice.ok', icon('check'), h('div.grow', { style: 'word-break:break-all' }, r.data)),
                h('div.row', { style: 'margin-top:8px' },
                    h('button.btn.secondary.sm', { onclick: () => copyText(r.data) }, icon('copy'), 'Copy'),
                    isUrl ? h('button.btn.secondary.sm', { onclick: () => api.files.url(r.data) }, icon('external'), 'Open link') : null));
        } catch (err) {
            result.replaceChildren(h('span', { style: 'color:var(--error-ink)' }, errorText(err)));
            toast(errorText(err), { type: 'error' });
        }
    };
    return h('section.card', h('h3.title-md', 'Read a QR code'), h('p.card-sub', 'Drop any image that contains a QR code to read what is inside.'),
        dropzone({ title: 'Drop an image', subtitle: 'or click to browse', kind: 'image', accept: IMAGE_EXT, onFiles: scan, compact: true, single: true }), result);
}

export default createConverter({
    key: 'image',
    title: 'Image converter',
    subtitle: 'Convert, resize and clean up images. Transparency is handled properly, and HEIC photos open too.',
    noun: 'images',
    kind: 'image',
    accept: IMAGE_EXT,
    thumbs: true,
    concurrency: 2,
    formats: (c) => c.image || [],
    defaultFormat: 'png',
    categoryOrder: ['Popular', 'Modern', 'Pro', 'Icons', 'Vector', 'Netpbm', 'Legacy'],
    options: [
        { id: 'quality', label: 'Quality', type: 'range', min: 10, max: 100, step: 5, default: 85, format: (v) => (v >= 100 ? 'Lossless' : String(v)), when: (s, f) => f.quality },
        { id: 'compression', label: 'Encoding effort', type: 'chips', default: 'default',
          options: [{ id: 'default', label: 'Balanced' }, { id: 'high', label: 'Smallest file (slower)' }],
          when: (s, f) => ['jpg', 'png', 'webp', 'avif', 'heif', 'gif'].includes(f.id) },
        { id: 'width', label: 'Max width (px)', type: 'number', min: 1, placeholder: 'Keep original', default: null },
        { id: 'height', label: 'Max height (px)', type: 'number', min: 1, placeholder: 'Keep original', default: null },
        { id: 'maintainAspectRatio', label: 'Keep proportions', type: 'switch', default: true },
        { id: 'rotate', label: 'Rotate', type: 'chips', default: 0, options: [{ id: 0, label: 'None' }, { id: 90, label: '90°' }, { id: 180, label: '180°' }, { id: 270, label: '270°' }] },
        { id: 'flop', label: 'Mirror horizontally', type: 'switch', default: false },
        { id: 'flip', label: 'Flip vertically', type: 'switch', default: false },
        { id: 'grayscale', label: 'Black and white', type: 'switch', default: false },
        { id: 'preserveMetadata', label: 'Keep EXIF data', type: 'switch', default: true, when: (s, f) => EXIF_FORMATS.includes(f.id) }
    ],
    payload: (s) => ({ ...s.opts, width: s.opts.width || null, height: s.opts.height || null }),
    run: (p) => api.convert.image(p),
    extras: () => qrCard()
});
