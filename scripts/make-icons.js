'use strict';

/**
 * Generates every brand image from one description of the mark, so the icon, installer art, tray
 * icon, README banner and in-app logo always match.
 *   node scripts/make-icons.js
 *
 * The mark: a circle becoming a square. Original artwork, in the warm cream / coral / near-black palette.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { ico } = require('../src/main/engines/rasterWriters');

const root = path.join(__dirname, '..');
const build = path.join(root, 'build');
const docs = path.join(root, 'docs');
fs.mkdirSync(build, { recursive: true });
fs.mkdirSync(docs, { recursive: true });

const C = { canvas: '#181715', raised: '#252320', cream: '#faf9f5', coral: '#cc785c', muted: '#a09d96' };

/** The glyph on its own, drawn on a 1024 grid. `ink` is the colour of the chevron cut into the square. */
const glyph = (ring = C.cream, ink = C.canvas) => `
  <circle cx="380" cy="512" r="190" fill="none" stroke="${ring}" stroke-width="54"/>
  <rect x="452" y="318" width="388" height="388" rx="100" fill="${C.coral}"/>
  <path d="M588 462 L690 512 L588 562" fill="none" stroke="${ink}" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>`;

const tile = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2824"/><stop offset="1" stop-color="${C.canvas}"/></linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.3" r="0.7"><stop offset="0" stop-color="${C.coral}" stop-opacity="0.16"/><stop offset="1" stop-color="${C.coral}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#bg)"/>
  <rect width="1024" height="1024" rx="228" fill="url(#glow)"/>
  <rect x="2" y="2" width="1020" height="1020" rx="226" fill="none" stroke="${C.cream}" stroke-opacity="0.10" stroke-width="4"/>
  ${inner}
</svg>`;

const iconSvg = tile(glyph());
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="190 280 690 470" width="690" height="470">${glyph()}</svg>`;

const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** 24-bit bottom-up BMP, the only image format NSIS installer pages accept. */
function bmp(rgb, w, h) {
    const row = Math.ceil((w * 3) / 4) * 4;
    const out = Buffer.alloc(54 + row * h);
    out.write('BM', 0, 'latin1'); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10); out.writeUInt32LE(40, 14);
    out.writeInt32LE(w, 18); out.writeInt32LE(h, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(row * h, 34);
    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const s = ((h - 1 - y) * w + x) * 3; const d = 54 + y * row + x * 3;
            out[d] = rgb[s + 2]; out[d + 1] = rgb[s + 1]; out[d + 2] = rgb[s];
        }
    }
    return out;
}

async function toBmp(svg, w, h) {
    const { data } = await sharp(Buffer.from(svg), { density: 192 }).resize(w, h).flatten({ background: C.canvas }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return bmp(data, w, h);
}

const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 164 314" width="164" height="314">
  <rect width="164" height="314" fill="${C.canvas}"/>
  <rect width="164" height="314" fill="${C.coral}" opacity="0.06"/>
  <g transform="translate(26 36) scale(0.11)">${glyph()}</g>
  <text x="20" y="194" font-family="Georgia, 'Times New Roman', serif" font-size="34" fill="${C.cream}" letter-spacing="-0.6">Uni</text>
  <text x="20" y="230" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-style="italic" fill="${C.coral}" letter-spacing="-0.6">Companion</text>
  <text x="20" y="268" font-family="Arial, sans-serif" font-size="9" fill="${C.muted}" letter-spacing="1.6">CONVERT</text>
  <text x="20" y="282" font-family="Arial, sans-serif" font-size="9" fill="${C.muted}" letter-spacing="1.6">DOWNLOAD</text>
  <text x="20" y="296" font-family="Arial, sans-serif" font-size="9" fill="${C.muted}" letter-spacing="1.6">KEEP</text>
</svg>`;

const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 57" width="150" height="57">
  <rect width="150" height="57" fill="${C.canvas}"/>
  <g transform="translate(14 9) scale(0.038)">${glyph()}</g>
</svg>`;

const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640">
  <defs><radialGradient id="g" cx="0.85" cy="0.1" r="0.9"><stop offset="0" stop-color="${C.coral}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.coral}" stop-opacity="0"/></radialGradient></defs>
  <rect width="1280" height="640" fill="${C.canvas}"/><rect width="1280" height="640" fill="url(#g)"/>
  <g transform="translate(20 -24) scale(0.42)">${glyph()}</g>
  <text x="96" y="410" font-family="Georgia, 'Times New Roman', serif" font-size="132" fill="${C.cream}" letter-spacing="-3.5">Uni <tspan font-style="italic" fill="${C.coral}">Companion</tspan></text>
  <text x="100" y="466" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="${C.muted}">Convert audio, video, images and documents. Download media. Private, offline-first.</text>
  <text x="100" y="530" font-family="Arial, Helvetica, sans-serif" font-size="22" fill="${C.cream}" opacity="0.6" letter-spacing="2">WINDOWS  ·  MACOS  ·  LINUX</text>
</svg>`;

async function main() {
    fs.writeFileSync(path.join(build, 'icon.svg'), iconSvg);
    fs.writeFileSync(path.join(root, 'src', 'renderer', 'assets', 'logo.svg'), logoSvg);

    fs.writeFileSync(path.join(build, 'icon.png'), await png(iconSvg, 1024));
    fs.writeFileSync(path.join(build, 'tray.png'), await png(iconSvg, 64));
    fs.writeFileSync(path.join(root, 'src', 'renderer', 'assets', 'icon-256.png'), await png(iconSvg, 256));

    const entries = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256]) entries.push({ size, data: await png(iconSvg, size) });
    fs.writeFileSync(path.join(build, 'icon.ico'), ico(entries));

    fs.writeFileSync(path.join(build, 'installerSidebar.bmp'), await toBmp(sidebarSvg, 164, 314));
    fs.writeFileSync(path.join(build, 'installerHeader.bmp'), await toBmp(headerSvg, 150, 57));

    await sharp(Buffer.from(bannerSvg), { density: 144 }).png().toFile(path.join(docs, 'banner.png'));

    // A contact sheet so the mark can be checked at every size at a glance.
    const sizes = [256, 128, 64, 48, 32, 24, 16];
    const tiles = await Promise.all(sizes.map(async (s) => ({ s, buf: await png(iconSvg, s) })));
    const sheet = sharp({ create: { width: 640, height: 300, channels: 3, background: C.raised } });
    let x = 20;
    const composites = tiles.map((t) => { const c = { input: t.buf, left: x, top: 20 + (256 - t.s) / 2 }; x += t.s + 16; return c; });
    await sheet.composite(composites).png().toFile(path.join(require('os').tmpdir(), 'uni-companion-icon-sizes.png'));
    console.log('Brand images written to build/, docs/ and src/renderer/assets/');
}

main().catch((e) => { console.error(e); process.exit(1); });
