'use strict';

/**
 * Small, dependency-free writers for raster formats libvips cannot produce.
 * Every writer takes raw 8-bit pixels (no padding) and returns a Buffer holding a *real* file
 * of that format, not a renamed PNG.
 */

function bmp24(rgb, w, h) {
    const rowSize = Math.ceil((w * 3) / 4) * 4;
    const dataSize = rowSize * h;
    const buf = Buffer.alloc(54 + dataSize);
    buf.write('BM', 0, 'latin1');
    buf.writeUInt32LE(54 + dataSize, 2);
    buf.writeUInt32LE(54, 10);
    buf.writeUInt32LE(40, 14);
    buf.writeInt32LE(w, 18);
    buf.writeInt32LE(h, 22); // positive height = rows stored bottom-up
    buf.writeUInt16LE(1, 26);
    buf.writeUInt16LE(24, 28);
    buf.writeUInt32LE(dataSize, 34);
    buf.writeInt32LE(2835, 38);
    buf.writeInt32LE(2835, 42);
    for (let y = 0; y < h; y += 1) {
        let src = (h - 1 - y) * w * 3;
        let dst = 54 + y * rowSize;
        for (let x = 0; x < w; x += 1, src += 3, dst += 3) {
            buf[dst] = rgb[src + 2];
            buf[dst + 1] = rgb[src + 1];
            buf[dst + 2] = rgb[src];
        }
    }
    return buf;
}

function tga32(rgba, w, h) {
    const buf = Buffer.alloc(18 + w * h * 4);
    buf[2] = 2; // uncompressed true-colour
    buf.writeUInt16LE(w, 12);
    buf.writeUInt16LE(h, 14);
    buf[16] = 32;
    buf[17] = 0x28; // 8 alpha bits, top-left origin
    let dst = 18;
    for (let i = 0; i < w * h * 4; i += 4, dst += 4) {
        buf[dst] = rgba[i + 2];
        buf[dst + 1] = rgba[i + 1];
        buf[dst + 2] = rgba[i];
        buf[dst + 3] = rgba[i + 3];
    }
    return buf;
}

const ppm = (rgb, w, h) => Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`, 'latin1'), rgb]);
const pgm = (gray, w, h) => Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`, 'latin1'), gray]);

function packBits(gray, w, h, { blackIsOne }) {
    const rowBytes = Math.ceil(w / 8);
    const out = Buffer.alloc(rowBytes * h);
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const dark = gray[y * w + x] < 128;
            const bit = blackIsOne ? dark : !dark;
            if (bit) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
    return out;
}

const pbm = (gray, w, h) => Buffer.concat([Buffer.from(`P4\n${w} ${h}\n`, 'latin1'), packBits(gray, w, h, { blackIsOne: true })]);

function multiByteInt(n) {
    const bytes = [n & 0x7f];
    let v = n >> 7;
    while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
    return Buffer.from(bytes);
}

const wbmp = (gray, w, h) => Buffer.concat([
    Buffer.from([0, 0]), multiByteInt(w), multiByteInt(h), packBits(gray, w, h, { blackIsOne: false })
]);

function psd(rgb, w, h) {
    if (w > 30000 || h > 30000) throw new Error('PSD supports at most 30,000 pixels per side.');
    const header = Buffer.alloc(26);
    header.write('8BPS', 0, 'latin1');
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(3, 12); // channels
    header.writeUInt32BE(h, 14);
    header.writeUInt32BE(w, 18);
    header.writeUInt16BE(8, 22); // bit depth
    header.writeUInt16BE(3, 24); // RGB
    const sections = Buffer.alloc(12); // colour mode data, image resources, layers: all empty
    const compression = Buffer.alloc(2); // 0 = raw
    const planes = Buffer.alloc(w * h * 3);
    const n = w * h;
    for (let i = 0; i < n; i += 1) {
        planes[i] = rgb[i * 3];
        planes[n + i] = rgb[i * 3 + 1];
        planes[2 * n + i] = rgb[i * 3 + 2];
    }
    return Buffer.concat([header, sections, compression, planes]);
}

function eps(rgb, w, h) {
    const head = `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${w} ${h}\n%%Pages: 1\n%%EndComments\n`
        + `/picstr ${w * 3} string def\ngsave\n${w} ${h} scale\n${w} ${h} 8 [${w} 0 0 -${h} 0 ${h}]\n`
        + '{currentfile picstr readhexstring pop} false 3 colorimage\n';
    const lines = [];
    const rowBytes = w * 3;
    for (let y = 0; y < h; y += 1) lines.push(rgb.subarray(y * rowBytes, (y + 1) * rowBytes).toString('hex'));
    return Buffer.from(`${head}${lines.join('\n')}\ngrestore\nshowpage\n%%EOF\n`, 'latin1');
}

/** Multi-resolution ICO whose entries are PNG images (supported since Windows Vista). */
function ico(pngBuffers) {
    const count = pngBuffers.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(count, 4);
    const dir = Buffer.alloc(16 * count);
    let offset = 6 + 16 * count;
    pngBuffers.forEach(({ size, data }, i) => {
        const o = i * 16;
        dir[o] = size >= 256 ? 0 : size;
        dir[o + 1] = size >= 256 ? 0 : size;
        dir.writeUInt16LE(1, o + 4);
        dir.writeUInt16LE(32, o + 6);
        dir.writeUInt32LE(data.length, o + 8);
        dir.writeUInt32LE(offset, o + 12);
        offset += data.length;
    });
    return Buffer.concat([header, dir, ...pngBuffers.map((p) => p.data)]);
}

module.exports = { bmp24, tga32, ppm, pgm, pbm, wbmp, psd, eps, ico };
