import { createConverter } from './_converter.js';
import { api } from '../core/api.js';

// Video files are accepted too: the audio track is extracted.
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'wma', 'm4a', 'aiff', 'aif', 'opus', 'ac3', 'dts', 'amr', 'wv', 'ape', 'mka', 'mp2', 'au', 'caf', 'voc', 'w64', 'tta', 'spx', 'ra',
    'mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'm4v'];

export default createConverter({
    key: 'audio',
    title: 'Audio converter',
    subtitle: 'Convert between audio formats, or pull the sound out of a video. Cover art and tags are kept.',
    noun: 'audio files',
    kind: 'audio',
    accept: AUDIO_EXT,
    thumbs: false,
    concurrency: 1,
    formats: (c) => c.audio || [],
    defaultFormat: 'mp3',
    categoryOrder: ['Popular', 'Lossless', 'Open', 'Surround', 'Voice', 'Legacy', 'Broadcast', 'Apple', 'Pro'],
    options: [
        { id: 'bitrate', label: 'Bitrate', type: 'chips', default: '192k',
          options: ['64k', '96k', '128k', '160k', '192k', '256k', '320k'].map((b) => ({ id: b, label: b.replace('k', ' kbps') })),
          when: (s, f) => f.bitrate },
        { id: 'sampleRate', label: 'Sample rate', type: 'chips', default: 'original',
          options: [{ id: 'original', label: 'Keep original' }, { id: 22050, label: '22 kHz' }, { id: 44100, label: '44.1 kHz' }, { id: 48000, label: '48 kHz' }, { id: 96000, label: '96 kHz' }] },
        { id: 'channels', label: 'Channels', type: 'chips', default: 'original',
          options: [{ id: 'original', label: 'Keep original' }, { id: 1, label: 'Mono' }, { id: 2, label: 'Stereo' }, { id: 6, label: '5.1' }] },
        { id: 'volume', label: 'Volume', type: 'range', min: 25, max: 200, step: 5, default: 100, format: (v) => `${v}%` },
        { id: 'normalize', label: 'Normalise loudness', type: 'switch', default: false, help: 'Evens out quiet and loud tracks (EBU R128).' },
        { id: 'preserveMetadata', label: 'Keep tags and cover art', type: 'switch', default: true }
    ],
    payload: (s) => ({
        bitrate: s.opts.bitrate,
        sampleRate: s.opts.sampleRate,
        channels: s.opts.channels,
        volume: s.opts.volume === 100 ? null : `${s.opts.volume}%`,
        normalize: !!s.opts.normalize,
        preserveMetadata: s.opts.preserveMetadata !== false
    }),
    run: (p) => api.convert.audio(p)
});
