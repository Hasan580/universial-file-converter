'use strict';

const fs = require('fs');
const { dialog } = require('electron');
const { handle } = require('./handle');
const ctx = require('../ctx');
const log = require('../logger');
const settings = require('../settings');

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
