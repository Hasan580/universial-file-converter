const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cheerio = require('cheerio');

const REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'cache-control': 'no-cache',
    'pragma': 'no-cache'
};
const ZLIB_DOMAINS = [
    'https://z-library.mn',
    'https://z-lib.gd',
    'https://z-lib.io',
    'https://zlibrary-global.se',
    'https://z-library.sk',
    'https://zlibrary.to'
];
const ZLIB_BASE_COOKIES = 'siteLanguage=en; bsrv=0bf492b2e869251834795b4bb6158ed0';

let zlibCookies = ZLIB_BASE_COOKIES;
const MAX_COVER_CACHE_SIZE = 100;
const coverDataUrlCache = new Map();

function setCoverCache(url, dataUrl) {
    if (coverDataUrlCache.has(url)) {
        coverDataUrlCache.delete(url);
    } else if (coverDataUrlCache.size >= MAX_COVER_CACHE_SIZE) {
        const oldestKey = coverDataUrlCache.keys().next().value;
        if (oldestKey) coverDataUrlCache.delete(oldestKey);
    }
    coverDataUrlCache.set(url, dataUrl);
}

function sanitizeFileSegment(value, fallback = 'Unknown') {
    const cleaned = String(value || '')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned || fallback;
}

function ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
}

function getEpubFolder(userDataPath) {
    return ensureDirectory(path.join(userDataPath, 'epub'));
}

function getLibraryMetadataPath(epubFolder) {
    return path.join(epubFolder, 'covers.json');
}

function readLibraryMetadata(epubFolder) {
    const metadataPath = getLibraryMetadataPath(epubFolder);
    if (!fs.existsSync(metadataPath)) {
        return {};
    }

    try {
        return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) || {};
    } catch (_) {
        return {};
    }
}

function writeLibraryMetadata(epubFolder, data) {
    const metadataPath = getLibraryMetadataPath(epubFolder);
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeAuthor(author) {
    if (Array.isArray(author)) {
        const joined = author.filter(Boolean).join(', ').trim();
        return joined || 'Unknown Author';
    }
    return sanitizeFileSegment(author || 'Unknown Author', 'Unknown Author');
}

function ensureUniquePath(filePath) {
    if (!fs.existsSync(filePath)) {
        return filePath;
    }

    const parsed = path.parse(filePath);
    let attempt = 2;
    while (attempt < 1000) {
        const nextPath = path.join(parsed.dir, `${parsed.name} (${attempt})${parsed.ext}`);
        if (!fs.existsSync(nextPath)) {
            return nextPath;
        }
        attempt += 1;
    }

    throw new Error('Could not find a free filename for the book');
}

function buildBookFilename(bookData = {}, extension = 'epub') {
    const title = sanitizeFileSegment(bookData.title || bookData.name || 'Unknown Title', 'Unknown Title');
    const author = normalizeAuthor(bookData.author || bookData.authors || bookData.creator);
    const normalizedExtension = sanitizeFileSegment(extension, 'epub').toLowerCase().replace(/[^a-z0-9]/g, '') || 'epub';
    return `${title} - ${author}.${normalizedExtension}`;
}

function parseFileSizeBytes(sizeText) {
    const match = String(sizeText || '').match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const factors = {
        B: 1,
        KB: 1024,
        MB: 1024 * 1024,
        GB: 1024 * 1024 * 1024,
        TB: 1024 * 1024 * 1024 * 1024
    };

    return Math.round(value * (factors[unit] || 1));
}

function upsertLibraryMetadata(epubFolder, filename, meta) {
    const metadata = readLibraryMetadata(epubFolder);
    metadata[filename] = {
        ...(metadata[filename] || {}),
        ...meta
    };
    writeLibraryMetadata(epubFolder, metadata);
}

function getDisplayTitleAndAuthor(filename, meta = {}) {
    const stem = filename.replace(/\.epub$/i, '');
    let title = stem;
    let author = 'Unknown Author';

    const parts = stem.split(' - ');
    if (parts.length >= 2) {
        title = parts[0].trim();
        author = parts.slice(1).join(' - ').trim();
    }

    if (typeof meta.title === 'string' && meta.title.trim()) {
        title = meta.title.trim();
    }
    if (typeof meta.author === 'string' && meta.author.trim()) {
        author = meta.author.trim();
    }

    return { title, author };
}

async function fetchText(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                ...DEFAULT_HEADERS,
                ...(options.headers || {})
            },
            redirect: 'follow',
            signal: controller.signal
        });
        const text = await response.text();
        return { response, text };
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchBuffer(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                ...DEFAULT_HEADERS,
                ...(options.headers || {})
            },
            redirect: 'follow',
            signal: controller.signal
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        return { response, buffer };
    } finally {
        clearTimeout(timeoutId);
    }
}

function buildImageReferer(targetUrl) {
    try {
        const parsed = new URL(targetUrl);
        const host = parsed.hostname.toLowerCase();
        if (host.includes('z-library') || host.includes('zlibrary') || host.includes('z-lib')) {
            return 'https://z-library.mn/';
        }
        return `${parsed.protocol}//${parsed.host}/`;
    } catch (_) {
        return 'https://z-library.mn/';
    }
}

function solveZlibChallenge(body) {
    try {
        const match = String(body || '').match(/const a0_0x2a54=\[(.*?)\];/);
        if (!match) return null;

        const arrayItems = match[1].split(',').map((item) => item.trim().replace(/['"]/g, ''));
        const challengeSeed = arrayItems.find((item) => /^[A-F0-9]{40}$/.test(item));
        if (!challengeSeed) return null;

        const offset = parseInt(challengeSeed[0], 16);
        let i = 0;
        while (i < 2000000) {
            const hash = crypto.createHash('sha1').update(challengeSeed + i).digest();
            if (hash[offset] === 0xb0 && hash[offset + 1] === 0x0b) {
                return challengeSeed + i;
            }
            i += 1;
        }
    } catch (_) {
        return null;
    }

    return null;
}

function buildZlibUrl(target, domain) {
    const value = String(target || '').trim();
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    return `${domain}${value.startsWith('/') ? value : `/${value}`}`;
}

function normalizeZlibPath(bookPath) {
    const value = String(bookPath || '').trim();
    if (!value) {
        throw new Error('Book path is required');
    }

    if (/^https?:\/\//i.test(value)) {
        const parsed = new URL(value);
        return `${parsed.pathname}${parsed.search || ''}`;
    }

    return value.startsWith('/') ? value : `/${value}`;
}

function mergeCookieString(existing, additions) {
    const map = new Map();

    String(existing || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((entry) => {
            const idx = entry.indexOf('=');
            const key = idx === -1 ? entry : entry.slice(0, idx).trim();
            const value = idx === -1 ? '' : entry.slice(idx + 1).trim();
            if (key) map.set(key, value);
        });

    additions.forEach((entry) => {
        const cookie = String(entry || '').split(';')[0].trim();
        const idx = cookie.indexOf('=');
        const key = idx === -1 ? cookie : cookie.slice(0, idx).trim();
        const value = idx === -1 ? '' : cookie.slice(idx + 1).trim();
        if (key) map.set(key, value);
    });

    return Array.from(map.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

function getSetCookieHeaders(headers) {
    if (!headers) return [];
    if (typeof headers.getSetCookie === 'function') {
        return headers.getSetCookie();
    }

    const single = headers.get('set-cookie');
    return single ? [single] : [];
}

async function zlibFetch(target, options = {}) {
    let lastError = null;

    for (const domain of ZLIB_DOMAINS) {
        const url = buildZlibUrl(target, domain);

        try {
            let requestHeaders = {
                cookie: zlibCookies,
                referer: `${domain}/`,
                ...(options.headers || {})
            };
            let result = await fetchText(url, { headers: requestHeaders, timeoutMs: options.timeoutMs });

            const responseCookies = getSetCookieHeaders(result.response.headers);
            if (responseCookies.length) {
                zlibCookies = mergeCookieString(zlibCookies, responseCookies);
            }

            if (result.response.status === 503) {
                const token = solveZlibChallenge(result.text);
                if (token) {
                    zlibCookies = mergeCookieString(zlibCookies, [
                        `c_token=${token}`,
                        `_cookie_${Date.now()}=true`
                    ]);
                    requestHeaders = {
                        ...requestHeaders,
                        cookie: zlibCookies
                    };
                    result = await fetchText(url, { headers: requestHeaders, timeoutMs: options.timeoutMs });
                }
            }

            if (result.response.ok) {
                return {
                    ...result,
                    domain,
                    requestUrl: url
                };
            }

            lastError = new Error(`Z-Library request failed with status ${result.response.status}`);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('Z-Library is unavailable right now');
}

async function searchOnlineBooks(query) {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
        return { success: true, books: [] };
    }

    const { text } = await zlibFetch(`/s/${encodeURIComponent(trimmedQuery)}`);
    const $ = cheerio.load(text);
    const books = [];

    $('.resItemBoxBooks z-bookcard').each((_, element) => {
        const card = $(element);
        const href = card.attr('href');
        const extension = String(card.attr('extension') || '').trim().toLowerCase();
        const title = card.find('div[slot="title"]').text().trim();
        const author = card.find('div[slot="author"]').text().trim();
        const cover = card.find('img').attr('data-src') || card.find('img').attr('src') || '';

        if (!href || !title || extension !== 'epub') return;

        books.push({
            title,
            author,
            coverUrl: cover,
            fileExtension: extension,
            bookPath: href
        });
    });

    return { success: true, books };
}

async function getOnlineBookLinks(bookPath) {
    const normalizedPath = normalizeZlibPath(bookPath);
    const { text, domain } = await zlibFetch(normalizedPath);
    const $ = cheerio.load(text);

    const readHref = $('a.reader-link').attr('href');
    let downloadBtn = $('a.addDownloadedBook').first();
    if (!downloadBtn.length) {
        downloadBtn = $('.book-details-button:not(.read-online) a.addDownloadedBook').first();
    }

    const downloadHref = downloadBtn.attr('href');
    const downloadText = downloadBtn.text().trim();
    const sizeMatch = downloadText.match(/(\d+\.?\d*\s*[KMGT]?B)/i);
    const extensionMatch = downloadText.match(/\b(epub|pdf|mobi|azw3|txt)\b/i);

    return {
        success: Boolean(readHref || downloadHref),
        readLink: readHref ? buildZlibUrl(readHref, domain) : null,
        downloadLink: downloadHref ? buildZlibUrl(downloadHref, domain) : null,
        downloadExtension: extensionMatch ? extensionMatch[1].toLowerCase() : 'epub',
        downloadSize: sizeMatch ? sizeMatch[1] : ''
    };
}

async function searchOfflineBooks(query) {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
        return { success: true, books: [] };
    }

    const searchUrl = `https://libgen.li/index.php?req=${encodeURIComponent(trimmedQuery)}&curtab=f`;
    const { text } = await fetchText(searchUrl);
    const $ = cheerio.load(text);
    const books = [];

    $('table tbody tr, table tr').each((_, element) => {
        const row = $(element);
        const cells = row.find('td');
        if (cells.length < 8) return;

        const firstCell = cells.eq(0);
        const titleLink = firstCell.find('a[href*="edition.php"]').first();
        if (!titleLink.length) return;

        const title = titleLink.text().trim();
        const editionHref = titleLink.attr('href') || '';
        const editionId = editionHref.match(/id=(\d+)/)?.[1];
        if (!title || !editionId) return;

        const author = cells.eq(1).text().trim();
        const publisher = cells.eq(2).text().trim();
        const year = cells.eq(3).text().trim();
        const language = cells.eq(4).text().trim();
        const pages = cells.eq(5).text().trim();
        const size = cells.eq(6).find('a').text().trim() || cells.eq(6).text().trim();
        const format = cells.eq(7).text().trim().toLowerCase();

        if (format !== 'epub') return;

        books.push({
            title,
            author,
            publisher,
            year,
            language,
            pages,
            sizeText: size,
            fileSize: parseFileSizeBytes(size),
            fileExtension: format,
            editionId
        });
    });

    return { success: true, books };
}

async function resolveLibgenDownload(editionId) {
    const safeEditionId = String(editionId || '').trim();
    if (!safeEditionId) {
        throw new Error('Edition ID is required');
    }

    const editionUrl = `https://libgen.li/edition.php?id=${encodeURIComponent(safeEditionId)}`;
    const editionResponse = await fetchText(editionUrl);
    const edition$ = cheerio.load(editionResponse.text);

    const adsLink = edition$('a[href^="ads.php?md5="]').first().attr('href') || '';
    const md5 = adsLink.match(/md5=([a-f0-9]+)/i)?.[1];
    if (!md5) {
        throw new Error('Could not resolve the download link for this book');
    }

    const adsUrl = `https://libgen.li/ads.php?md5=${md5}`;
    const adsResponse = await fetchText(adsUrl);
    const ads$ = cheerio.load(adsResponse.text);
    const downloadHref = ads$('table#main a[href^="get.php"]').first().attr('href') || '';
    if (!downloadHref) {
        throw new Error('Download URL is missing for this book');
    }

    const fileInfo = {};
    edition$('table#tablelibgen tr').each((_, row) => {
        const cells = edition$(row).find('td');
        if (cells.length < 2) return;
        const text = cells.eq(1).text();

        const sizeMatch = text.match(/Size:\s*([^\r\n]+)/i);
        const extMatch = text.match(/Extension:\s*(\w+)/i);
        const pagesMatch = text.match(/Pages:\s*(\d+)/i);

        if (sizeMatch) fileInfo.size = sizeMatch[1].trim();
        if (extMatch) fileInfo.extension = extMatch[1].trim().toLowerCase();
        if (pagesMatch) fileInfo.pages = pagesMatch[1].trim();
    });

    return {
        md5,
        adsUrl,
        downloadUrl: `https://libgen.li/${downloadHref.replace(/^\//, '')}`,
        fileInfo
    };
}

async function downloadOfflineBook(editionId, bookData, userDataPath) {
    const resolved = await resolveLibgenDownload(editionId);
    const epubFolder = getEpubFolder(userDataPath);
    const extensionCandidate = String(resolved.fileInfo.extension || bookData.fileExtension || 'epub')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    const extension = ['epub', 'pdf', 'mobi', 'azw3', 'txt'].includes(extensionCandidate)
        ? extensionCandidate
        : 'epub';
    const targetPath = ensureUniquePath(path.join(epubFolder, buildBookFilename(bookData, extension)));
    const downloadResult = await fetchBuffer(resolved.downloadUrl, {
        headers: {
            referer: resolved.adsUrl
        },
        timeoutMs: 120000
    });

    if (!downloadResult.response.ok) {
        throw new Error(`Download failed with status ${downloadResult.response.status}`);
    }

    fs.writeFileSync(targetPath, downloadResult.buffer);

    const filename = path.basename(targetPath);
    upsertLibraryMetadata(epubFolder, filename, {
        title: String(bookData.title || '').trim() || path.parse(filename).name,
        author: normalizeAuthor(bookData.author),
        coverUrl: bookData.coverUrl || null,
        source: 'libgen',
        sourceUrl: resolved.downloadUrl,
        savedAt: new Date().toISOString(),
        sizeText: resolved.fileInfo.size || bookData.sizeText || '',
        publisher: bookData.publisher || '',
        year: bookData.year || '',
        language: bookData.language || '',
        pages: resolved.fileInfo.pages || bookData.pages || ''
    });

    return {
        success: true,
        path: targetPath,
        filename,
        folder: epubFolder,
        size: downloadResult.buffer.length
    };
}

function getEpubLibrary(userDataPath) {
    const epubFolder = getEpubFolder(userDataPath);
    const metadata = readLibraryMetadata(epubFolder);

    const books = fs.readdirSync(epubFolder)
        .filter((entry) => entry.toLowerCase().endsWith('.epub'))
        .map((filename) => {
            const filePath = path.join(epubFolder, filename);
            const stat = fs.statSync(filePath);
            const meta = metadata[filename] || {};
            const display = getDisplayTitleAndAuthor(filename, meta);

            return {
                id: filename,
                title: display.title,
                author: display.author,
                filename,
                localPath: filePath,
                fileExtension: 'epub',
                fileSize: stat.size,
                downloadedAt: stat.mtime.toISOString(),
                source: meta.source || 'library',
                coverUrl: meta.coverUrl || '',
                sizeText: meta.sizeText || '',
                publisher: meta.publisher || '',
                year: meta.year || '',
                language: meta.language || '',
                pages: meta.pages || ''
            };
        })
        .sort((left, right) => new Date(right.downloadedAt).getTime() - new Date(left.downloadedAt).getTime());

    return {
        success: true,
        folder: epubFolder,
        books
    };
}

function readEpubFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, message: 'Book file not found' };
    }

    const buffer = fs.readFileSync(filePath);
    return {
        success: true,
        base64: buffer.toString('base64'),
        mime: 'application/epub+zip'
    };
}

async function fetchCoverDataUrl(coverUrl) {
    const normalizedUrl = String(coverUrl || '').trim();
    if (!normalizedUrl) {
        return { success: false, message: 'Cover URL is required' };
    }

    if (coverDataUrlCache.has(normalizedUrl)) {
        return {
            success: true,
            dataUrl: coverDataUrlCache.get(normalizedUrl)
        };
    }

    const result = await fetchBuffer(normalizedUrl, {
        headers: {
            accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            referer: buildImageReferer(normalizedUrl)
        },
        timeoutMs: 120000
    });

    if (!result.response.ok) {
        return {
            success: false,
            message: `Cover request failed with status ${result.response.status}`
        };
    }

    const mime = result.response.headers.get('content-type') || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${result.buffer.toString('base64')}`;
    setCoverCache(normalizedUrl, dataUrl);
    return {
        success: true,
        dataUrl
    };
}

function importEpubFiles(filePaths, userDataPath) {
    const epubFolder = getEpubFolder(userDataPath);
    const imported = [];

    for (const originalPath of Array.isArray(filePaths) ? filePaths : []) {
        if (!originalPath || !fs.existsSync(originalPath) || path.extname(originalPath).toLowerCase() !== '.epub') {
            continue;
        }

        const sourceName = path.basename(originalPath);
        const targetPath = ensureUniquePath(path.join(epubFolder, sourceName));
        fs.copyFileSync(originalPath, targetPath);

        const filename = path.basename(targetPath);
        const display = getDisplayTitleAndAuthor(filename);
        upsertLibraryMetadata(epubFolder, filename, {
            title: display.title,
            author: display.author,
            source: 'import',
            sourceUrl: originalPath,
            savedAt: new Date().toISOString()
        });

        imported.push({
            filename,
            path: targetPath
        });
    }

    return {
        success: true,
        folder: epubFolder,
        imported
    };
}

module.exports = {
    fetchCoverDataUrl,
    getEpubFolder,
    getEpubLibrary,
    getOnlineBookLinks,
    importEpubFiles,
    downloadOfflineBook,
    readEpubFile,
    searchOnlineBooks,
    searchOfflineBooks
};
