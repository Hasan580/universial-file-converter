import { createConverter } from './_converter.js';
import { api } from '../core/api.js';

const VIDEO_EXT = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'mpg', 'm4v', '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv', 'mxf', 'f4v', 'swf', 'dv', 'gif'];
const FIXED_SIZE = ['dv', 'vob'];
const NO_QUALITY = ['gif', 'apng', 'dv', 'vob', 'prores', 'dnxhd'];

export default createConverter({
    key: 'video',
    title: 'Video converter',
    subtitle: 'Convert between video formats with sensible defaults. The aspect ratio is always preserved.',
    noun: 'videos',
    kind: 'video',
    accept: VIDEO_EXT,
    thumbs: false,
    concurrency: 1,
    formats: (c) => c.video || [],
    defaultFormat: 'mp4',
    categoryOrder: ['Popular', 'Modern', 'Web', 'Apple', 'Animation', 'Mobile', 'Broadcast', 'Camcorder', 'DVD', 'Pro', 'Legacy', 'Open'],
    options: [
        { id: 'resolution', label: 'Resolution', type: 'chips', default: 'original',
          options: [{ id: 'original', label: 'Original' }, { id: '360p', label: '360p' }, { id: '480p', label: '480p' }, { id: '720p', label: '720p' }, { id: '1080p', label: '1080p' }, { id: '1440p', label: '1440p' }, { id: '4k', label: '4K' }],
          when: (s, f) => !FIXED_SIZE.includes(f.id), help: 'Sets the short side, so portrait clips are never squashed.' },
        { id: 'quality', label: 'Quality', type: 'range', min: 10, max: 100, step: 5, default: 75,
          format: (v) => (v >= 90 ? `${v} · near lossless` : v >= 70 ? `${v} · high` : v >= 40 ? `${v} · balanced` : `${v} · small file`),
          when: (s, f) => !NO_QUALITY.includes(f.id) },
        { id: 'fps', label: 'Frame rate', type: 'chips', default: 'original',
          options: [{ id: 'original', label: 'Original' }, { id: 24, label: '24' }, { id: 30, label: '30' }, { id: 60, label: '60' }],
          when: (s, f) => !['gif', 'apng', 'dv', 'vob', 'dnxhd'].includes(f.id) },
        { id: 'gifFps', label: 'Animation frame rate', type: 'chips', default: 15,
          options: [{ id: 10, label: '10 fps' }, { id: 15, label: '15 fps' }, { id: 24, label: '24 fps' }],
          when: (s, f) => ['gif', 'apng'].includes(f.id) },
        { id: 'audioBitrate', label: 'Audio bitrate', type: 'chips', default: '192k',
          options: ['96k', '128k', '192k', '256k', '320k'].map((b) => ({ id: b, label: b.replace('k', ' kbps') })),
          when: (s, f) => f.audio && !['prores', 'dnxhd', 'mxf', 'dv', 'vob'].includes(f.id) }
    ],
    payload: (s) => ({
        resolution: s.opts.resolution || 'original',
        quality: s.opts.quality,
        fps: s.opts.fps || 'original',
        gifFps: s.opts.gifFps,
        audioBitrate: s.opts.audioBitrate
    }),
    run: (p) => api.convert.video(p)
});
