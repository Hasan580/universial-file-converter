'use strict';

/** Extension groups used for file dialogs and for classifying dropped files. */
const AUDIO = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'oga', 'wma', 'm4a', 'aiff', 'aif', 'opus', 'ac3', 'dts', 'amr', 'wv', 'ape', 'mka', 'mp2', 'au', 'caf', 'voc', 'w64', 'tta', 'spx', 'ra'];
const VIDEO = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'mpeg', 'mpg', 'm4v', '3gp', 'ts', 'mts', 'm2ts', 'vob', 'ogv', 'mxf', 'f4v', 'swf', 'dv', 'gif'];
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'ico', 'svg', 'avif', 'heif', 'heic', 'jp2', 'jxl', 'tga', 'psd', 'ppm', 'pgm', 'pbm'];
const DOCUMENT = ['pdf', 'docx', 'doc', 'txt', 'rtf', 'html', 'htm', 'xlsx', 'xls', 'pptx', 'csv', 'tsv', 'json', 'md', 'xml', 'yaml', 'yml', 'epub', 'odt', 'ods'];

const GROUPS = {
    audio: [{ name: 'Audio', extensions: AUDIO }],
    video: [{ name: 'Video', extensions: VIDEO }],
    image: [{ name: 'Images', extensions: IMAGE }],
    compress: [{ name: 'Images', extensions: IMAGE.filter((e) => !['ico', 'svg'].includes(e)) }],
    document: [{ name: 'Documents', extensions: DOCUMENT }],
    pdf: [{ name: 'PDF', extensions: ['pdf'] }],
    books: [{ name: 'EPUB books', extensions: ['epub'] }],
    player: [{ name: 'Media', extensions: [...AUDIO, ...VIDEO.filter((e) => e !== 'gif')] }],
    lyrics: [{ name: 'Lyrics', extensions: ['lrc', 'txt'] }],
    any: [{ name: 'Supported files', extensions: [...AUDIO, ...VIDEO, ...IMAGE, ...DOCUMENT] }]
};

function typeOf(ext) {
    const e = String(ext || '').toLowerCase().replace(/^\./, '');
    // GIF is both an image and a video container: treat it as an image unless asked otherwise.
    if (e === 'gif') return 'image';
    if (AUDIO.includes(e)) return 'audio';
    if (VIDEO.includes(e)) return 'video';
    if (IMAGE.includes(e)) return 'image';
    if (DOCUMENT.includes(e)) return 'document';
    return 'unknown';
}

module.exports = { AUDIO, VIDEO, IMAGE, DOCUMENT, GROUPS, typeOf };
