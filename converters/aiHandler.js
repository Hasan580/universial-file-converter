/**
 * AI Handler - Powered by Google Gemini
 * Requires user's Gemini API key
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Gemini API key (set by user)
let geminiApiKey = '';

// Store conversation history for chat
let conversationHistory = [];

/**
 * Initialize AI handler
 */
async function initialize() {
    console.log('AI Handler initialized (Gemini mode)');
    return true;
}

/**
 * Set the Gemini API key
 */
function setApiKey(key) {
    geminiApiKey = key || '';
    console.log('Gemini API key', geminiApiKey ? 'configured' : 'cleared');
}

/**
 * Check if API key is set
 */
function hasApiKey() {
    return !!geminiApiKey && geminiApiKey.length > 10;
}

/**
 * Save API keys (for future use)
 */
function saveApiKeys(keys) {
    if (keys && keys.geminiApiKey) {
        setApiKey(keys.geminiApiKey);
    }
    return true;
}

/**
 * Make HTTPS GET request
 */
function httpsGet(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 60000
        };
        
        const req = https.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({ statusCode: res.statusCode, data: buffer, headers: res.headers });
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

/**
 * Make HTTPS POST request
 */
function httpsPost(url, data, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const postData = typeof data === 'string' ? data : JSON.stringify(data);
        
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                ...options.headers
            },
            timeout: options.timeout || 60000
        };
        
        const req = https.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                try {
                    const json = JSON.parse(buffer.toString());
                    resolve({ statusCode: res.statusCode, data: json });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: buffer });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.write(postData);
        req.end();
    });
}

/**
 * Call Gemini API
 */
async function callGemini(prompt, options = {}) {
    if (!hasApiKey()) {
        return { success: false, error: 'Gemini API key not configured. Please add your key in Settings.' };
    }

    return new Promise((resolve, reject) => {
        const model = options.model || 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        const urlObj = new URL(url);

        let contents;
        if (options.imageBase64) {
            // Vision request with image
            contents = [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: options.imageMimeType || 'image/jpeg', data: options.imageBase64 } }
                ]
            }];
        } else if (options.conversationHistory) {
            // Chat with history
            contents = options.conversationHistory.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }]
            }));
            contents.push({ role: 'user', parts: [{ text: prompt }] });
        } else {
            contents = [{ parts: [{ text: prompt }] }];
        }

        const body = {
            contents,
            generationConfig: {
                temperature: options.temperature || 0.7,
                maxOutputTokens: options.maxTokens || 2048,
                topP: 0.95
            }
        };

        if (options.systemInstruction) {
            body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
        }

        const postData = JSON.stringify(body);

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: options.timeout || 60000
        };

        const req = https.request(reqOptions, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                try {
                    const json = JSON.parse(buffer.toString());
                    if (res.statusCode === 200 && json.candidates && json.candidates[0]) {
                        const text = json.candidates[0].content?.parts?.[0]?.text || '';
                        resolve({ success: true, text });
                    } else {
                        const errMsg = json.error?.message || `API error: ${res.statusCode}`;
                        resolve({ success: false, error: errMsg });
                    }
                } catch (e) {
                    resolve({ success: false, error: `Parse error: ${buffer.toString().substring(0, 200)}` });
                }
            });
        });

        req.on('error', (e) => resolve({ success: false, error: e.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ success: false, error: 'Request timeout' });
        });
        req.write(postData);
        req.end();
    });
}

/**
 * Generate image using multiple free providers
 */
async function generateImage(prompt, options = {}) {
    console.log('Generating image for prompt:', prompt);
    
    // Try Pollinations.ai - completely free
    try {
        const encodedPrompt = encodeURIComponent(prompt);
        const seed = Math.floor(Math.random() * 1000000);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true`;
        
        console.log('Fetching from Pollinations:', imageUrl);
        
        const result = await httpsGet(imageUrl, { timeout: 120000 });
        
        if (result.statusCode === 200 && result.data.length > 1000) {
            const base64 = result.data.toString('base64');
            const mimeType = result.headers['content-type'] || 'image/jpeg';
            return {
                success: true,
                image: `data:${mimeType};base64,${base64}`
            };
        }
        
        throw new Error(`Pollinations returned status ${result.statusCode}`);
    } catch (e) {
        console.error('Pollinations failed:', e.message);
    }
    
    // Fallback: Try picsum for a placeholder
    try {
        const result = await httpsGet('https://picsum.photos/1024/1024', { timeout: 30000 });
        if (result.statusCode === 302 || result.statusCode === 301) {
            const redirectUrl = result.headers.location;
            const imageResult = await httpsGet(redirectUrl, { timeout: 30000 });
            if (imageResult.statusCode === 200) {
                const base64 = imageResult.data.toString('base64');
                return {
                    success: true,
                    image: `data:image/jpeg;base64,${base64}`,
                    note: 'Using placeholder image - AI generation temporarily unavailable'
                };
            }
        }
    } catch (e) {
        console.error('Picsum fallback failed:', e.message);
    }
    
    return { success: false, error: 'Image generation service is temporarily unavailable. Please try again later.' };
}

/**
 * AI Chat using Google Gemini
 */
async function chat(message, systemPrompt = null, model = null) {
    if (!hasApiKey()) {
        return { success: false, error: 'Gemini API key required. Please add your key in Settings.' };
    }

    try {
        conversationHistory.push({ role: 'user', content: message });

        const systemMessage = systemPrompt || `You are a friendly, helpful AI assistant built into the Universal Converter app. You help users with:
- File conversions (audio, video, image, documents)
- AI features (image generation, translation, summarization)
- General questions and conversations

Be conversational, helpful, and concise. Use emojis occasionally to be friendly.`;

        const callOptions = {
            systemInstruction: systemMessage,
            conversationHistory: conversationHistory.slice(-10),
            temperature: 0.8
        };
        if (model) callOptions.model = model;

        const result = await callGemini(message, callOptions);

        if (result.success && result.text) {
            conversationHistory.push({ role: 'assistant', content: result.text });

            if (conversationHistory.length > 50) {
                conversationHistory = conversationHistory.slice(-30);
            }

            return { success: true, response: result.text };
        } else {
            // Return the actual Gemini error - don't silently fall back
            const errorMsg = result.error || 'Gemini API returned an empty response';
            console.error('Gemini chat error:', errorMsg);
            conversationHistory.pop(); // Remove the user message since we failed
            return { success: false, error: errorMsg };
        }
    } catch (error) {
        console.error('Chat error:', error);
        conversationHistory.pop(); // Remove the user message since we failed
        return { success: false, error: `Chat error: ${error.message}` };
    }
}

/**
 * Generate local response for chat
 */
function generateLocalResponse(message) {
    const lowerMessage = message.toLowerCase().trim();
    
    // Greeting patterns
    if (/^(hi|hello|hey|greetings|good morning|good afternoon|good evening|yo|sup|what's up)/i.test(lowerMessage)) {
        const greetings = [
            "Hello! 👋 I'm your AI assistant. How can I help you today?",
            "Hi there! What can I assist you with?",
            "Hey! Ready to help you with conversions, editing, or any questions!",
            "Greetings! I'm here to help. What would you like to do?"
        ];
        return greetings[Math.floor(Math.random() * greetings.length)];
    }
    
    // How are you
    if (/how are you|how's it going|how do you do/i.test(lowerMessage)) {
        return "I'm doing great, thank you for asking! 😊 Ready to assist you with any task. What would you like to do today?";
    }
    
    // Help patterns
    if (/help|what can you do|features|capabilities|what do you do/i.test(lowerMessage)) {
        return `I can help you with many things! Here's what I offer:

🎨 **Image Generation** - Create images from text descriptions
📝 **Text Summarization** - Condense long texts into key points
✍️ **Creative Writing** - Generate stories, poems, scripts, and lyrics
🔧 **Text Improvement** - Rewrite text in different styles
🌐 **Translation** - Translate between languages
💬 **Chat** - Answer questions and have conversations

Just tell me what you'd like to do!`;
    }
    
    // Conversion help
    if (/convert|format|file|audio|video|image|document|mp3|mp4|pdf/i.test(lowerMessage)) {
        return `I can help with file conversions! This app supports:

🎵 **Audio:** MP3, WAV, FLAC, AAC, OGG, M4A
🎬 **Video:** MP4, AVI, MKV, MOV, WebM
🖼️ **Image:** PNG, JPG, WebP, GIF, BMP
📄 **Documents:** PDF, DOCX, and more

Just navigate to the appropriate tab and drag & drop your files!`;
    }
    
    // Thank you
    if (/thank|thanks|thx|ty/i.test(lowerMessage)) {
        const thanks = [
            "You're welcome! Let me know if you need anything else. 😊",
            "Happy to help! Feel free to ask anytime.",
            "No problem at all! I'm here whenever you need me."
        ];
        return thanks[Math.floor(Math.random() * thanks.length)];
    }
    
    // Goodbye
    if (/bye|goodbye|see you|later|cya/i.test(lowerMessage)) {
        return "Goodbye! 👋 Feel free to come back anytime you need help!";
    }
    
    // Who are you
    if (/who are you|what are you|your name/i.test(lowerMessage)) {
        return "I'm your AI assistant built into the Universal Converter app! I can help with file conversions, generate images, write creative content, and answer your questions. What would you like to explore?";
    }
    
    // Image generation intent
    if (/generate|create|make|draw.*image|picture|photo|art/i.test(lowerMessage)) {
        return "I can generate images! 🎨 Use the **Image Generator** tool in the AI Hub. Just describe what you want to see, and I'll create it for you!";
    }
    
    // Writing intent
    if (/write|story|poem|lyrics|script/i.test(lowerMessage)) {
        return "I'd love to help with creative writing! ✍️ Use the **Creative Writer** tool in the AI Hub to generate stories, poems, scripts, or song lyrics. Just give me a topic or theme!";
    }
    
    // Default intelligent response
    const responses = [
        `I understand you're asking about "${message.substring(0, 30)}${message.length > 30 ? '...' : ''}". I'm here to help with:\n\n• 🎨 AI image generation\n• 📝 Text summarization & improvement\n• ✍️ Creative writing\n• 🔄 File conversion guidance\n\nWhat would you like to try?`,
        `That's an interesting question! While I'm a focused assistant for this converter app, I can help you with image generation, text processing, and creative writing. What sounds good?`,
        `I'm your Universal Converter AI assistant! I specialize in helping with file conversions and AI-powered tools like image generation and creative writing. How can I assist you today?`
    ];
    return responses[Math.floor(Math.random() * responses.length)];
}

/**
 * Clear chat history
 */
function clearChat() {
    conversationHistory = [];
    return true;
}

/**
 * Summarize text using Gemini (with local fallback)
 */
async function summarize(text, maxLength = 150) {
    // Use Gemini if key is set
    if (hasApiKey()) {
        try {
            const result = await callGemini(
                `Summarize the following text concisely in about ${maxLength} words. Only output the summary, nothing else.\n\n${text}`,
                { temperature: 0.3, maxTokens: 1024 }
            );
            if (result.success && result.text) {
                return { success: true, summary: result.text.trim() };
            }
        } catch (e) {
            console.error('Gemini summarize failed, using fallback:', e.message);
        }
    }
    
    // Local fallback
    try {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        if (sentences.length <= 2) return { success: true, summary: text };
        const importantWords = ['important', 'key', 'main', 'significant', 'essential', 'critical', 'major', 'primary', 'conclusion', 'result', 'therefore', 'however', 'finally'];
        const scored = sentences.map((sentence, index) => {
            let score = 0;
            const words = sentence.toLowerCase().split(/\s+/);
            score += Math.min(words.length / 5, 3);
            score += (sentences.length - index) / sentences.length * 2;
            importantWords.forEach(word => { if (sentence.toLowerCase().includes(word)) score += 1; });
            return { sentence: sentence.trim(), score };
        });
        scored.sort((a, b) => b.score - a.score);
        const topCount = Math.min(3, Math.ceil(sentences.length / 3));
        const topSentences = scored.slice(0, topCount);
        topSentences.sort((a, b) => sentences.indexOf(a.sentence + '.') - sentences.indexOf(b.sentence + '.'));
        let summary = topSentences.map(s => s.sentence).join(' ');
        if (summary.length > maxLength * 2) summary = summary.substring(0, maxLength * 2 - 3) + '...';
        return { success: true, summary };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Analyze sentiment (local implementation)
 */
async function analyzeSentiment(text) {
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'happy', 'joy', 'best', 'awesome', 'beautiful', 'perfect', 'nice', 'pleased', 'glad', 'delighted', 'superb', 'outstanding', 'brilliant'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'sad', 'angry', 'disappointed', 'poor', 'ugly', 'fail', 'wrong', 'annoying', 'frustrating', 'disgusting', 'pathetic', 'dreadful', 'miserable'];
    
    const lowerText = text.toLowerCase();
    let positiveScore = 0;
    let negativeScore = 0;
    
    positiveWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) positiveScore += matches.length;
    });
    
    negativeWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) negativeScore += matches.length;
    });
    
    let sentiment, confidence;
    const total = positiveScore + negativeScore + 1;
    
    if (positiveScore > negativeScore) {
        sentiment = 'POSITIVE';
        confidence = Math.min(0.95, 0.5 + (positiveScore / total) * 0.5);
    } else if (negativeScore > positiveScore) {
        sentiment = 'NEGATIVE';
        confidence = Math.min(0.95, 0.5 + (negativeScore / total) * 0.5);
    } else {
        sentiment = 'NEUTRAL';
        confidence = 0.6;
    }
    
    return {
        success: true,
        sentiment,
        confidence,
        all: [
            { label: 'POSITIVE', score: positiveScore / total },
            { label: 'NEGATIVE', score: negativeScore / total },
            { label: 'NEUTRAL', score: 1 / total }
        ]
    };
}

/**
 * Answer questions based on context - uses Gemini when available
 */
async function answerQuestion(question, context) {
    if (hasApiKey()) {
        try {
            const result = await callGemini(
                `Based on the following context, answer the question. Only provide the answer, be concise.\n\nContext:\n${context}\n\nQuestion: ${question}`,
                { temperature: 0.3, maxTokens: 1024 }
            );
            if (result.success && result.text) {
                return { success: true, answer: result.text.trim(), confidence: 0.9 };
            }
        } catch (e) {
            console.error('Gemini QA failed, using fallback:', e.message);
        }
    }
    
    try {
        const lowerQuestion = question.toLowerCase();
        const sentences = context.match(/[^.!?]+[.!?]+/g) || [context];
        const stopWords = ['what', 'where', 'when', 'who', 'why', 'how', 'is', 'are', 'was', 'were', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
        const questionWords = lowerQuestion.split(/\s+/).filter(w => w.length > 2 && !stopWords.includes(w));
        let bestMatch = sentences[0];
        let bestScore = 0;
        sentences.forEach(sentence => {
            const lowerSentence = sentence.toLowerCase();
            let score = 0;
            questionWords.forEach(word => {
                if (lowerSentence.includes(word)) { score += 2; if (new RegExp(`\\b${word}\\b`).test(lowerSentence)) score += 1; }
            });
            if (score > bestScore) { bestScore = score; bestMatch = sentence; }
        });
        return { success: true, answer: bestMatch.trim(), confidence: Math.min(0.9, bestScore / (questionWords.length * 3)) };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Describe image using Gemini Vision
 */
async function describeImage(imagePath) {
    if (!hasApiKey()) {
        return { success: false, error: 'Gemini API key required. Please add your key in Settings.' };
    }

    try {
        if (!fs.existsSync(imagePath)) {
            return { success: false, error: 'Image file not found' };
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString('base64');
        const ext = path.extname(imagePath).toLowerCase();
        const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
        const mimeType = mimeMap[ext] || 'image/jpeg';

        const result = await callGemini('Describe this image in detail. What do you see?', {
            imageBase64: base64,
            imageMimeType: mimeType,
            temperature: 0.4
        });

        if (result.success && result.text) {
            return { success: true, description: result.text };
        }

        return { success: false, error: result.error || 'Image description failed' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Remove background from image (requires external service - not available with Gemini)
 */
async function removeBackground(imagePath) {
    return { success: false, error: 'Background removal is not available with the current AI provider. This feature requires a dedicated image processing service.' };
}

/**
 * Upscale image (requires external service - not available with Gemini)
 */
async function upscaleImage(imagePath) {
    return { success: false, error: 'Image upscaling is not available with the current AI provider. This feature requires a dedicated image processing service.' };
}

/**
 * Translate text using Gemini
 */
async function translate(text, sourceLang = 'en', targetLang = 'es') {
    if (!hasApiKey()) {
        return { success: false, error: 'Gemini API key required. Please add your key in Settings.' };
    }

    const langNames = {
        'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
        'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'zh': 'Chinese',
        'ja': 'Japanese', 'ar': 'Arabic', 'nl': 'Dutch', 'pl': 'Polish',
        'hi': 'Hindi', 'ko': 'Korean', 'tr': 'Turkish', 'sv': 'Swedish',
        'da': 'Danish', 'fi': 'Finnish', 'no': 'Norwegian', 'th': 'Thai'
    };

    const srcName = langNames[sourceLang] || sourceLang;
    const tgtName = langNames[targetLang] || targetLang;

    try {
        const result = await callGemini(
            `Translate the following text from ${srcName} to ${tgtName}. Only output the translation, nothing else.\n\n${text}`,
            { temperature: 0.3 }
        );
        
        if (result.success && result.text) {
            return { success: true, translation: result.text.trim() };
        }
        
        return { success: false, error: result.error || 'Translation failed' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * Transcribe audio (requires external service - not available with Gemini)
 */
async function transcribeAudio(audioPath) {
    return { success: false, error: 'Audio transcription is not available with the current AI provider. This feature requires a dedicated speech-to-text service.' };
}

/**
 * Generate creative writing using Gemini
 */
async function generateCreativeText(prompt, type = 'story', length = 'medium') {
    if (hasApiKey()) {
        try {
            const lengthGuide = { short: '100-200 words', medium: '300-500 words', long: '700-1000 words' };
            const typeGuide = { story: 'a short story', poem: 'a poem', script: 'a dialogue/script', lyrics: 'song lyrics' };
            
            const result = await callGemini(
                `Write ${typeGuide[type] || 'a creative piece'} about: ${prompt}. Length: ${lengthGuide[length] || '300-500 words'}. Be creative, engaging, and original. Add emojis and formatting.`,
                { temperature: 0.9, maxTokens: 2048, systemInstruction: 'You are a talented creative writer. Produce engaging, original creative content.' }
            );
            if (result.success && result.text) {
                return { success: true, text: result.text };
            }
        } catch (e) {
            console.error('Gemini creative failed, using fallback:', e.message);
        }
    }
    
    // Local fallback
    const templates = {
        poem: generatePoem(prompt),
        story: generateStory(prompt),
        script: generateScript(prompt),
        lyrics: generateLyrics(prompt)
    };
    return { success: true, text: templates[type] || templates.story };
}

function generatePoem(theme) {
    const themeWords = theme.split(' ').slice(0, 3).join(' ');
    return `✨ **A Poem About ${theme}** ✨

In the quiet whispers of the dawn,
Where ${themeWords.toLowerCase()} gently carries on,
Through misty veils of morning light,
Dreams take flight, burning bright.

Like rivers flowing to the sea,
${theme} sets our spirits free,
In every heartbeat, every breath,
A dance of life that conquers death.

The stars above, they seem to know,
The secrets that the ${themeWords.toLowerCase()} show,
And in this moment, pure and true,
I find my peace, I find it through.

So let us cherish what we find,
The treasures of the heart and mind,
For in the end, what matters most,
Is love—our guide, our gracious host.

— *Generated with ❤️*`;
}

function generateStory(theme) {
    const protagonist = ['Emma', 'Alex', 'Sam', 'Jordan', 'Casey'][Math.floor(Math.random() * 5)];
    return `📖 **A Tale of ${theme}**

Once upon a time, in a world where ${theme.toLowerCase()} held the power to change everything, there lived a young dreamer named ${protagonist}.

${protagonist} had always known there was something special about their destiny. Growing up in a small village at the edge of the Whispering Woods, they spent countless hours gazing at the stars, wondering what adventures awaited beyond the horizon.

One fateful morning, everything changed. A mysterious letter arrived, sealed with an ancient symbol that seemed to glow with an inner light. The message was simple yet profound:

*"The time has come. ${theme} awaits those brave enough to seek it. Follow the path where shadows meet light, and you shall find what your heart truly desires."*

With trembling hands but a determined spirit, ${protagonist} packed a small bag with essentials—a worn journal, a compass that belonged to their grandmother, and a locket containing a photograph of their family.

The journey ahead would test their courage, challenge their beliefs, and ultimately reveal the true meaning of ${theme.toLowerCase()}. Little did they know that this was just the beginning of an adventure that would change not only their life but the fate of the entire realm.

*To be continued...*

— *Generated with ❤️*`;
}

function generateScript(theme) {
    return `🎬 **Scene: "${theme}"**

FADE IN:

INT. COZY CAFÉ - LATE AFTERNOON

*Warm sunlight streams through large windows. Two friends, ALEX and MORGAN, sit across from each other at a corner table, steam rising from their cups.*

**ALEX**
*(stirring coffee thoughtfully)*
You know, I've been thinking a lot about ${theme.toLowerCase()} lately.

**MORGAN**
*(leans forward, intrigued)*
Really? What brought that on?

**ALEX**
It's just... everywhere I look, I see it. In the way strangers help each other, in the small moments we usually overlook.

**MORGAN**
*(nodding slowly)*
I think I know what you mean. Like yesterday, when that kid helped the elderly woman cross the street. No one asked him to.

**ALEX**
Exactly! That's ${theme.toLowerCase()} in its purest form.

*A beat of comfortable silence. Both take sips of their drinks.*

**MORGAN**
So what do we do with this realization?

**ALEX**
*(smiles)*
I think we just... live it. Every day. In every choice we make.

*They share a meaningful look as the scene fades.*

FADE OUT.

— *Generated with ❤️*`;
}

function generateLyrics(theme) {
    return `🎵 **"${theme}" — Original Song**

**[Verse 1]**
In the morning light, I see it clear
${theme} is calling, drawing near
Every step I take, every road I find
Leads me back to what's on my mind

**[Pre-Chorus]**
Can you feel it rising up inside?
A feeling we can no longer hide

**[Chorus]**
${theme}, ${theme}
You're the rhythm in my heart
${theme}, ${theme}
We were never meant to be apart
Through the highs and lows, we'll find our way
With ${theme.toLowerCase()} lighting up each day

**[Verse 2]**
Through the stormy nights and sunny days
${theme} guides us through the maze
Hand in hand, we'll face the unknown
Together we will find our home

**[Pre-Chorus]**
Can you feel it rising up inside?
A feeling we can no longer hide

**[Chorus]**
${theme}, ${theme}
You're the rhythm in my heart
${theme}, ${theme}
We were never meant to be apart

**[Bridge]**
And when the world gets heavy
And the nights feel so long
I'll remember ${theme.toLowerCase()}
That's where I belong

**[Outro]**
${theme}... ${theme}...
Forever in my heart...

— *Generated with ❤️*`;
}

/**
 * Improve/rewrite text in different styles using Gemini
 */
async function improveText(text, style = 'professional') {
    if (hasApiKey()) {
        try {
            const styleGuide = {
                professional: 'Rewrite in a professional, polished business tone',
                casual: 'Rewrite in a casual, friendly conversational tone',
                academic: 'Rewrite in a formal academic/scholarly tone',
                creative: 'Rewrite with vivid, creative, literary flair',
                concise: 'Rewrite to be as concise and direct as possible, removing filler words'
            };
            
            const result = await callGemini(
                `${styleGuide[style] || styleGuide.professional}. Only output the rewritten text, nothing else.\n\nOriginal text:\n${text}`,
                { temperature: 0.5, maxTokens: 2048 }
            );
            if (result.success && result.text) {
                return { success: true, text: result.text.trim() };
            }
        } catch (e) {
            console.error('Gemini improve failed, using fallback:', e.message);
        }
    }
    
    // Local fallback
    const improvers = {
        professional: improveProfessional,
        casual: improveCasual,
        academic: improveAcademic,
        creative: improveCreative,
        concise: improveConcise
    };
    const improver = improvers[style] || improvers.professional;
    return { success: true, text: improver(text) };
}

function improveProfessional(text) {
    let improved = text
        .replace(/\bi'm\b/gi, "I am")
        .replace(/\bdon't\b/gi, "do not")
        .replace(/\bcan't\b/gi, "cannot")
        .replace(/\bwon't\b/gi, "will not")
        .replace(/\bit's\b/gi, "it is")
        .replace(/\bwe're\b/gi, "we are")
        .replace(/\bthey're\b/gi, "they are")
        .replace(/\bgonna\b/gi, "going to")
        .replace(/\bwanna\b/gi, "want to")
        .replace(/\bgotta\b/gi, "have to")
        .replace(/\byeah\b/gi, "yes")
        .replace(/\bnope\b/gi, "no")
        .replace(/\bkinda\b/gi, "somewhat")
        .replace(/\blots of\b/gi, "numerous")
        .replace(/\ba lot\b/gi, "significantly")
        .replace(/\breally\b/gi, "considerably")
        .replace(/\bpretty\b/gi, "quite")
        .replace(/\bget\b/gi, "obtain")
        .replace(/\bgot\b/gi, "obtained");
    
    // Capitalize sentences
    improved = improved.replace(/(^\s*\w|[.!?]\s*\w)/g, c => c.toUpperCase());
    
    return improved;
}

function improveCasual(text) {
    let improved = text
        .replace(/\bI am\b/gi, "I'm")
        .replace(/\bdo not\b/gi, "don't")
        .replace(/\bcannot\b/gi, "can't")
        .replace(/\bwill not\b/gi, "won't")
        .replace(/\bgoing to\b/gi, "gonna")
        .replace(/\bwant to\b/gi, "wanna")
        .replace(/\bhave to\b/gi, "gotta");
    
    return improved;
}

function improveAcademic(text) {
    let improved = text
        .replace(/\bi think\b/gi, "It is believed that")
        .replace(/\bshows\b/gi, "demonstrates")
        .replace(/\bgets\b/gi, "obtains")
        .replace(/\bbig\b/gi, "significant")
        .replace(/\bsmall\b/gi, "minimal")
        .replace(/\balso\b/gi, "furthermore")
        .replace(/\bbut\b/gi, "however")
        .replace(/\bso\b/gi, "therefore")
        .replace(/\bbecause\b/gi, "due to the fact that")
        .replace(/\buse\b/gi, "utilize")
        .replace(/\babout\b/gi, "regarding")
        .replace(/\blike\b/gi, "such as");
    
    return improved.charAt(0).toUpperCase() + improved.slice(1);
}

function improveCreative(text) {
    const adjectives = ['magnificent', 'extraordinary', 'breathtaking', 'remarkable', 'stunning', 'enchanting'];
    const randomAdj = () => adjectives[Math.floor(Math.random() * adjectives.length)];
    
    let improved = text
        .replace(/\bgood\b/gi, randomAdj())
        .replace(/\bnice\b/gi, 'delightful')
        .replace(/\bsad\b/gi, 'melancholic')
        .replace(/\bhappy\b/gi, 'elated')
        .replace(/\bbig\b/gi, 'colossal')
        .replace(/\bsmall\b/gi, 'tiny')
        .replace(/\bsaid\b/gi, 'whispered')
        .replace(/\bwalked\b/gi, 'wandered');
    
    return `✨ ${improved}`;
}

function improveConcise(text) {
    let improved = text
        .replace(/\bvery\s+/gi, '')
        .replace(/\breally\s+/gi, '')
        .replace(/\bjust\s+/gi, '')
        .replace(/\bactually\s+/gi, '')
        .replace(/\bbasically\s+/gi, '')
        .replace(/\bliterally\s+/gi, '')
        .replace(/\bdefinitely\s+/gi, '')
        .replace(/\babsolutely\s+/gi, '')
        .replace(/\bin order to\b/gi, 'to')
        .replace(/\bdue to the fact that\b/gi, 'because')
        .replace(/\bat this point in time\b/gi, 'now')
        .replace(/\bin the event that\b/gi, 'if')
        .replace(/\s+/g, ' ')
        .trim();
    
    return improved;
}

/**
 * Format file size helper
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

/**
 * Get AI capabilities info
 */
function getCapabilities() {
    const keySet = hasApiKey();
    return {
        hasKey: keySet,
        chat: { available: keySet, description: 'Conversational AI assistant (Gemini)', requiresKey: true },
        summarize: { available: true, description: 'Summarize long texts', requiresKey: false },
        translate: { available: keySet, description: 'Translate between 20+ languages (Gemini)', requiresKey: true },
        sentiment: { available: true, description: 'Analyze text sentiment', requiresKey: false },
        questionAnswer: { available: true, description: 'Answer questions from context', requiresKey: false },
        generateImage: { available: true, description: 'Generate images from text (Pollinations AI)', requiresKey: false },
        describeImage: { available: keySet, description: 'AI-powered image descriptions (Gemini Vision)', requiresKey: true },
        removeBackground: { available: false, description: 'Remove image background (unavailable)', requiresKey: true },
        upscaleImage: { available: false, description: 'Upscale image (unavailable)', requiresKey: true },
        transcribeAudio: { available: false, description: 'Speech to text (unavailable)', requiresKey: true },
        creativeWriting: { available: true, types: ['story', 'poem', 'script', 'lyrics'], requiresKey: false },
        improveText: { available: true, styles: ['professional', 'casual', 'academic', 'creative', 'concise'], requiresKey: false }
    };
}

module.exports = {
    initialize,
    setApiKey,
    hasApiKey,
    saveApiKeys,
    getCapabilities,
    chat,
    clearChat,
    summarize,
    analyzeSentiment,
    answerQuestion,
    describeImage,
    generateImage,
    removeBackground,
    upscaleImage,
    translate,
    transcribeAudio,
    generateCreativeText,
    improveText
};
