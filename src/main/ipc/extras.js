'use strict';

const fs = require('fs');
const path = require('path');
const { app, dialog, net } = require('electron');
const { handle } = require('./handle');
const ctx = require('../ctx');
const log = require('../logger');
const settings = require('../settings');
const activity = require('../activity');
const { ensureDir, sanitizeFileName, uniquePath } = require('../util');

// ------------------------------------------------------------------ AI hub (Gemini)

let ai = null;
async function aiHandler() {
    if (!ai) {
        ai = require('../engines/ai');
        await ai.initialize();
    }
    const key = settings.get().geminiApiKey;
    if (key && !ai.hasApiKey()) ai.setApiKey(key);
    return ai;
}

const AI_CALLS = {
    'ai-summarize': 'summarize',
    'ai-translate': 'translate',
    'ai-sentiment': 'analyzeSentiment',
    'ai-question-answer': 'answerQuestion',
    'ai-describe-image': 'describeImage',
    'ai-creative-write': 'generateCreativeText',
    'ai-improve-text': 'improveText',
    'ai-get-capabilities': 'getCapabilities',
    'ai-save-keys': 'saveApiKeys'
};

// ------------------------------------------------------------------ books

let books = null;
const booksEngine = () => books || (books = require('../engines/books'));

// ------------------------------------------------------------------ Spotify (SpotiFLAC)

let spotify = null;
const spotifyEngine = () => spotify || (spotify = require('../engines/spotify'));
const plain = (v) => JSON.parse(JSON.stringify(v));

function register() {
    // ---- AI
    handle('ai-chat', async (message, systemPrompt = null, model = null) => (await aiHandler()).chat(message, systemPrompt, model || settings.get().geminiModel || null));
    handle('ai-clear-chat', () => (ai ? ai.clearChat() : true));
    for (const [channel, method] of Object.entries(AI_CALLS)) {
        handle(channel, async (...args) => { const a = await aiHandler(); return a[method](...args); });
    }
    for (const [channel, method, label] of [
        ['ai-generate-image', 'generateImage', 'Generating image'],
        ['ai-remove-background', 'removeBackground', 'Removing background'],
        ['ai-upscale-image', 'upscaleImage', 'Upscaling image'],
        ['ai-transcribe', 'transcribeAudio', 'Transcribing audio']
    ]) {
        handle(channel, async (a, b) => {
            log.info('ai', label);
            const result = await (await aiHandler())[method](a, b);
            if (result && result.success) log.success('ai', `${label}: done`);
            return result;
        });
    }
    handle('ai-set-gemini-key', async (key) => {
        settings.update({ geminiApiKey: String(key || '') });
        (await aiHandler()).setApiKey(String(key || ''));
        return { success: true };
    });
    handle('ai-has-key', () => !!settings.get().geminiApiKey);

    // ---- books
    handle('books-search-online', (q) => booksEngine().searchOnlineBooks(q));
    handle('books-get-online-links', (p) => booksEngine().getOnlineBookLinks(p));
    handle('books-fetch-cover-data-url', (u) => booksEngine().fetchCoverDataUrl(u));
    handle('books-search-offline', (q) => booksEngine().searchOfflineBooks(q));
    handle('books-download-offline', (payload) => {
        const p = payload || {};
        return booksEngine().downloadOfflineBook(p.editionId, p.bookData || {}, app.getPath('userData'));
    });
    handle('books-get-library', () => booksEngine().getEpubLibrary(app.getPath('userData')));
    handle('books-read-epub-file', (p) => booksEngine().readEpubFile(p));
    handle('books-get-library-folder', () => ({ success: true, path: booksEngine().getEpubFolder(app.getPath('userData')) }));
    handle('books-import-files', (paths) => booksEngine().importEpubFiles(paths, app.getPath('userData')));

    // ---- Spotify
    handle('spotify-search', async (query, limit) => plain(await spotifyEngine().search(query, limit || 20)));
    handle('spotify-get-metadata', async (url) => plain(await spotifyEngine().getMetadata(url)));
    handle('spotify-check-availability', async (id) => plain(await spotifyEngine().checkAvailability(id)));
    handle('spotify-download', async (options) => {
        const jobId = `spotify-${Date.now()}`;
        activity.start(jobId, 'Downloading track');
        try {
            const r = await spotifyEngine().downloadTrack(options, (p) => ctx.send('spotify-download-progress', { phase: p.phase || '', percent: p.percent || 0 }));
            return { success: true, path: r.path, alreadyExists: !!r.alreadyExists };
        } catch (err) {
            return { success: false, error: (err && err.message) || String(err) };
        } finally { activity.stop(jobId); }
    });
    handle('spotify-download-lyrics', async (options) => {
        try { return await spotifyEngine().downloadLyrics(options); } catch (err) { return { success: false, error: (err && err.message) || String(err) }; }
    });
    handle('spotify-save-cover', async ({ coverUrl, outputDir, fileName } = {}) => {
        try {
            if (!coverUrl || !outputDir || !fileName) return { success: false, error: 'Missing parameters' };
            if (!/^https?:\/\//i.test(coverUrl)) return { success: false, error: 'Invalid cover URL' };
            ensureDir(outputDir);
            const dest = uniquePath(path.join(outputDir, sanitizeFileName(path.basename(fileName), 'cover.jpg')));
            const res = await net.fetch(coverUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!res.ok) throw new Error(`Failed to download image: HTTP ${res.status}`);
            fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
            return { success: true, path: dest };
        } catch (err) {
            return { success: false, error: (err && err.message) || String(err) };
        }
    });

    // ---- lyrics files for the player
    handle('select-lrc-file', async () => {
        const r = await dialog.showOpenDialog(ctx.getWindow(), {
            title: 'Select lyrics file', properties: ['openFile'],
            filters: [{ name: 'Lyrics', extensions: ['lrc', 'txt'] }, { name: 'All files', extensions: ['*'] }]
        });
        if (r.canceled || !r.filePaths.length) return null;
        try { return { path: r.filePaths[0], content: fs.readFileSync(r.filePaths[0], 'utf8') }; } catch (err) { return { error: err.message }; }
    });
    handle('read-lrc-file', (p) => {
        try {
            if (!fs.existsSync(p)) return { error: 'File not found' };
            return { path: p, content: fs.readFileSync(p, 'utf8') };
        } catch (err) { return { error: err.message }; }
    });
}

module.exports = { register };
