import { createConverter } from './_converter.js';
import { api } from '../core/api.js';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'avif', 'heif', 'heic'];

export default createConverter({
    key: 'compress',
    historyType: 'compress',
    title: 'Image compressor',
    subtitle: 'Shrink images and keep their format. See exactly how much each one saved.',
    noun: 'images',
    kind: 'compress',
    accept: IMAGE_EXT,
    thumbs: true,
    showSavings: true,
    concurrency: 2,
    // Compression keeps the original format, so there is nothing to choose: one placeholder entry stands in.
    formats: () => [{ id: 'same', label: 'Same format', category: 'Output', available: true }],
    defaultFormat: 'same',
    categoryOrder: ['Output'],
    options: [
        { id: 'quality', label: 'Quality', type: 'range', min: 10, max: 100, step: 5, default: 75,
          format: (v) => (v >= 90 ? `${v} · barely smaller` : v >= 60 ? `${v} · recommended` : `${v} · smallest`),
          help: 'Lower numbers give smaller files and more visible artefacts.' }
    ],
    payload: (s) => ({ quality: s.opts.quality }),
    run: (p) => api.convert.compress(p)
});
