'use strict';

/**
 * Format tables for the ffmpeg-backed converters. The renderer receives a filtered copy
 * of these through `get-catalog`, so the UI only ever offers formats that really work.
 */

// `bitrate: true` means the -b:a value is honoured. `fixed` pins parameters the codec demands.
const AUDIO = {
    mp3:  { label: 'MP3',          codec: 'libmp3lame',         ext: 'mp3',  muxer: 'mp3',      category: 'Popular',  lossy: true, bitrate: true, maxChannels: 2, cover: true },
    m4a:  { label: 'M4A (AAC)',    codec: 'aac',                ext: 'm4a',  muxer: 'ipod',     category: 'Popular',  lossy: true, bitrate: true, cover: true },
    aac:  { label: 'AAC',          codec: 'aac',                ext: 'aac',  muxer: 'adts',     category: 'Popular',  lossy: true, bitrate: true },
    wav:  { label: 'WAV',          codec: 'pcm_s16le',          ext: 'wav',  muxer: 'wav',      category: 'Lossless' },
    flac: { label: 'FLAC',         codec: 'flac',               ext: 'flac', muxer: 'flac',     category: 'Lossless', cover: true },
    alac: { label: 'ALAC',         codec: 'alac',               ext: 'm4a',  muxer: 'ipod',     category: 'Lossless', cover: true },
    aiff: { label: 'AIFF',         codec: 'pcm_s16be',          ext: 'aiff', muxer: 'aiff',     category: 'Lossless' },
    wv:   { label: 'WavPack',      codec: 'wavpack',            ext: 'wv',   muxer: 'wv',       category: 'Lossless' },
    tta:  { label: 'TTA',          codec: 'tta',                ext: 'tta',  muxer: 'tta',      category: 'Lossless' },
    ogg:  { label: 'OGG Vorbis',   codec: 'libvorbis',          ext: 'ogg',  muxer: 'ogg',      category: 'Open',     lossy: true, bitrate: true },
    opus: { label: 'Opus',         codec: 'libopus',            ext: 'opus', muxer: 'ogg',      category: 'Open',     lossy: true, bitrate: true },
    oga:  { label: 'OGA',          codec: 'libvorbis',          ext: 'oga',  muxer: 'ogg',      category: 'Open',     lossy: true, bitrate: true },
    mka:  { label: 'MKA',          codec: 'libvorbis',          ext: 'mka',  muxer: 'matroska', category: 'Open',     lossy: true, bitrate: true },
    wma:  { label: 'WMA',          codec: 'wmav2',              ext: 'wma',  muxer: 'asf',      category: 'Legacy',   lossy: true, bitrate: true },
    ac3:  { label: 'AC-3',         codec: 'ac3',                ext: 'ac3',  muxer: 'ac3',      category: 'Surround', lossy: true, bitrate: true, maxChannels: 6 },
    dts:  { label: 'DTS',          codec: 'dca',                ext: 'dts',  muxer: 'dts',      category: 'Surround', lossy: true, bitrate: true, strict: true, minBitrate: 448 },
    mp2:  { label: 'MP2',          codec: 'mp2',                ext: 'mp2',  muxer: 'mp2',      category: 'Broadcast', lossy: true, bitrate: true, maxChannels: 2 },
    amr:  { label: 'AMR (voice)',  codec: 'libopencore_amrnb',  ext: 'amr',  muxer: 'amr',      category: 'Voice',    lossy: true, fixed: { sampleRate: 8000, channels: 1, bitrate: '12.2k' } },
    spx:  { label: 'Speex (voice)', codec: 'libspeex',          ext: 'spx',  muxer: 'ogg',      category: 'Voice',    lossy: true, bitrate: true, fixed: { sampleRate: 16000, channels: 1 } },
    au:   { label: 'AU',           codec: 'pcm_s16be',          ext: 'au',   muxer: 'au',       category: 'Legacy' },
    caf:  { label: 'CAF',          codec: 'alac',               ext: 'caf',  muxer: 'caf',      category: 'Apple' },
    voc:  { label: 'VOC',          codec: 'pcm_u8',             ext: 'voc',  muxer: 'voc',      category: 'Legacy' },
    w64:  { label: 'Wave64',       codec: 'pcm_s16le',          ext: 'w64',  muxer: 'w64',      category: 'Pro' },
    ra:   { label: 'RealAudio',    codec: 'real_144',           ext: 'ra',   muxer: 'rm',       category: 'Legacy',   fixed: { sampleRate: 8000, channels: 1 } },
    ape:  { label: "Monkey's Audio", codec: 'ape',              ext: 'ape',  muxer: 'ape',      category: 'Lossless' }
};

// `vcodec`/`acodec` are defaults. `crf` maps the quality slider (1-100) to the codec's CRF scale.
const VIDEO = {
    mp4:   { label: 'MP4 (H.264)',  muxer: 'mp4',      vcodec: 'libx264',    acodec: 'aac',        ext: 'mp4',  category: 'Popular',   faststart: true },
    mkv:   { label: 'MKV',          muxer: 'matroska', vcodec: 'libx264',    acodec: 'aac',        ext: 'mkv',  category: 'Popular' },
    webm:  { label: 'WebM (VP9)',   muxer: 'webm',     vcodec: 'libvpx-vp9', acodec: 'libopus',    ext: 'webm', category: 'Web' },
    mov:   { label: 'MOV',          muxer: 'mov',      vcodec: 'libx264',    acodec: 'aac',        ext: 'mov',  category: 'Apple',     faststart: true },
    m4v:   { label: 'M4V',          muxer: 'mp4',      vcodec: 'libx264',    acodec: 'aac',        ext: 'm4v',  category: 'Apple',     faststart: true },
    hevc:  { label: 'HEVC (H.265)', muxer: 'mp4',      vcodec: 'libx265',    acodec: 'aac',        ext: 'mp4',  category: 'Modern',    faststart: true, nameSuffix: 'hevc' },
    av1:   { label: 'AV1',          muxer: 'mp4',      vcodec: 'libsvtav1',  acodec: 'aac',        ext: 'mp4',  category: 'Modern',    faststart: true, nameSuffix: 'av1' },
    gif:   { label: 'GIF',          muxer: 'gif',      vcodec: 'gif',        acodec: null,         ext: 'gif',  category: 'Animation' },
    apng:  { label: 'APNG',         muxer: 'apng',     vcodec: 'apng',       acodec: null,         ext: 'png',  category: 'Animation' },
    avi:   { label: 'AVI',          muxer: 'avi',      vcodec: 'mpeg4',      acodec: 'libmp3lame', ext: 'avi',  category: 'Legacy' },
    wmv:   { label: 'WMV',          muxer: 'asf',      vcodec: 'wmv2',       acodec: 'wmav2',      ext: 'wmv',  category: 'Legacy' },
    flv:   { label: 'FLV',          muxer: 'flv',      vcodec: 'flv',        acodec: 'libmp3lame', ext: 'flv',  category: 'Legacy',    audioRate: 44100 },
    f4v:   { label: 'F4V',          muxer: 'flv',      vcodec: 'libx264',    acodec: 'aac',        ext: 'f4v',  category: 'Web' },
    swf:   { label: 'SWF',          muxer: 'swf',      vcodec: 'flv',        acodec: 'libmp3lame', ext: 'swf',  category: 'Legacy',    audioRate: 44100 },
    '3gp': { label: '3GP',          muxer: '3gp',      vcodec: 'libx264',    acodec: 'aac',        ext: '3gp',  category: 'Mobile',    audioRate: 44100, audioChannels: 1 },
    ogv:   { label: 'OGV',          muxer: 'ogg',      vcodec: 'libtheora',  acodec: 'libvorbis',  ext: 'ogv',  category: 'Open' },
    ts:    { label: 'MPEG-TS',      muxer: 'mpegts',   vcodec: 'libx264',    acodec: 'aac',        ext: 'ts',   category: 'Broadcast' },
    mts:   { label: 'MTS',          muxer: 'mpegts',   vcodec: 'libx264',    acodec: 'aac',        ext: 'mts',  category: 'Camcorder' },
    m2ts:  { label: 'M2TS',         muxer: 'mpegts',   vcodec: 'libx264',    acodec: 'ac3',        ext: 'm2ts', category: 'Camcorder' },
    mpeg:  { label: 'MPEG-2',       muxer: 'mpeg',     vcodec: 'mpeg2video', acodec: 'mp2',        ext: 'mpeg', category: 'Broadcast', audioRate: 48000 },
    mpg:   { label: 'MPEG-1',       muxer: 'mpeg',     vcodec: 'mpeg1video', acodec: 'mp2',        ext: 'mpg',  category: 'Broadcast', audioRate: 44100 },
    vob:   { label: 'VOB (DVD)',    muxer: 'vob',      vcodec: 'mpeg2video', acodec: 'ac3',        ext: 'vob',  category: 'DVD',       target: 'pal-dvd' },
    mxf:   { label: 'MXF',          muxer: 'mxf',      vcodec: 'mpeg2video', acodec: 'pcm_s16le',  ext: 'mxf',  category: 'Pro',       audioRate: 48000, audioChannels: 2 },
    prores: { label: 'Apple ProRes', muxer: 'mov',     vcodec: 'prores_ks',  acodec: 'pcm_s16le',  ext: 'mov',  category: 'Pro',       nameSuffix: 'prores', audioRate: 48000 },
    dnxhd: { label: 'Avid DNxHD',   muxer: 'mov',      vcodec: 'dnxhd',      acodec: 'pcm_s16le',  ext: 'mov',  category: 'Pro',       nameSuffix: 'dnxhd', audioRate: 48000 },
    dv:    { label: 'DV',           muxer: 'dv',       vcodec: 'dvvideo',    acodec: 'pcm_s16le',  ext: 'dv',   category: 'Camcorder', target: 'pal-dv' }
};

const RESOLUTIONS = {
    '360p':  { height: 360,  label: '360p' },
    '480p':  { height: 480,  label: '480p' },
    '720p':  { height: 720,  label: '720p HD' },
    '1080p': { height: 1080, label: '1080p Full HD' },
    '1440p': { height: 1440, label: '1440p 2K' },
    '4k':    { height: 2160, label: '4K UHD' },
    '8k':    { height: 4320, label: '8K' }
};

// Codec fallbacks when the requested encoder is missing from this ffmpeg build.
const CODEC_FALLBACKS = {
    libsvtav1: ['libaom-av1', 'libx265', 'libx264'],
    'libaom-av1': ['libsvtav1', 'libx265', 'libx264'],
    libx265: ['libx264'],
    'libvpx-vp9': ['libvpx', 'libx264'],
    libtheora: ['mpeg4'],
    libopus: ['libvorbis', 'aac'],
    libvorbis: ['aac']
};

module.exports = { AUDIO, VIDEO, RESOLUTIONS, CODEC_FALLBACKS };
