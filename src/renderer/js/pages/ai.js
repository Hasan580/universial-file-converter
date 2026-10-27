import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { api } from '../core/api.js';
import { navigate } from '../core/router.js';
import { toast, errorText, copyText } from '../core/ui.js';
import { pageHead, tabs } from '../components/page.js';
import { chips, notice, field, select } from '../components/controls.js';
import { basename } from '../core/format.js';

const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'tr', 'zh', 'ja', 'ko', 'hi', 'nl', 'pl', 'sv'].map((c) => ({ id: c, label: c.toUpperCase() }));

// Each tool: what it needs, and how to call it. `out(r)` turns the engine result into text.
const TOOLS = {
    summarize: { label: 'Summarise', hint: 'Paste a long text and get the key points.', run: (t) => api.ai.summarize(t, 150) },
    translate: { label: 'Translate', hint: 'Needs a Gemini key.', needsKey: true, extra: 'lang', run: (t, o) => api.ai.translate(t, 'auto', o.lang) },
    improve: { label: 'Improve writing', hint: 'Rewrite for clarity and tone.', extra: 'style', run: (t, o) => api.ai.improve(t, o.style) },
    write: { label: 'Write', hint: 'Describe a theme and get a draft.', extra: 'kind', run: (t, o) => api.ai.write(t, o.kind, 'medium') },
    sentiment: { label: 'Sentiment', hint: 'Is this text positive, negative or neutral?', run: (t) => api.ai.sentiment(t) },
    answer: { label: 'Ask about a text', hint: 'Put the text first, then your question on the last line.', run: (t) => { const lines = t.trim().split('\n'); return api.ai.qa(lines.pop(), lines.join('\n')); } }
};

const pickText = (r) => {
    if (!r) return '';
    if (typeof r === 'string') return r;
    if (r.success === false) throw new Error(r.error || 'The request failed');
    return r.summary || r.translation || r.translated || r.improved || r.text || r.response || r.answer || r.result || r.content || (r.sentiment ? `${r.sentiment}${r.score !== undefined ? ` (${r.score})` : ''}` : JSON.stringify(r, null, 2));
};

export default async function ai() {
    const hasKey = await api.ai.hasKey().catch(() => false);
    let tab = 'chat';
    const body = h('div');

    // ---------------------------------------------------------------- chat
    const log = h('div.col', { style: 'gap:12px;min-height:240px;max-height:52vh;overflow:auto;padding:4px' });
    const input = h('textarea.textarea', { rows: 2, placeholder: 'Ask anything. Enter to send, Shift+Enter for a new line.', style: 'min-height:56px' });
    const bubble = (who, text, error) => h('div', { style: `align-self:${who === 'me' ? 'flex-end' : 'flex-start'};max-width:82%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;line-height:1.55;${who === 'me' ? 'background:var(--coral-soft);color:var(--ink)' : error ? 'background:var(--error-soft);color:var(--error-ink)' : 'background:var(--raised);color:var(--body)'}` }, text);
    const send = async () => {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        log.append(bubble('me', text));
        const wait = bubble('ai', 'Thinking...');
        log.append(wait); log.scrollTop = log.scrollHeight;
        try {
            const r = await api.ai.chat(text);
            wait.replaceWith(r.success ? bubble('ai', r.response) : bubble('ai', r.error || 'No answer', true));
        } catch (e) { wait.replaceWith(bubble('ai', errorText(e), true)); }
        log.scrollTop = log.scrollHeight;
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

    function drawChat() {
        mount(body, !hasKey ? notice('Chat needs a free Gemini API key. Add one under Settings > AI. The other tools below work without it.', 'warn', icon('info')) : null,
            h('section.card', { style: 'margin-top:var(--s-4)' }, log, h('div.row', { style: 'margin-top:12px;align-items:flex-end' }, h('div.grow', input), h('button.btn.primary', { onclick: send, disabled: !hasKey }, icon('arrowRight'), 'Send')),
                h('div.row', { style: 'margin-top:8px' }, h('button.btn.ghost.sm', { onclick: () => { api.ai.clear(); log.replaceChildren(); } }, 'New conversation'),
                    !hasKey ? h('button.btn.secondary.sm', { onclick: () => navigate('settings', { section: 'ai' }) }, 'Add a key') : null)));
    }

    // ---------------------------------------------------------------- tools
    function drawTools() {
        let current = 'summarize';
        const opts = { lang: 'es', style: 'professional', kind: 'story' };
        const text = h('textarea.textarea', { rows: 9, placeholder: 'Your text', style: 'min-height:200px' });
        const out = h('div');
        const hint = h('div.small.muted');
        const extra = h('div');
        const run = h('button.btn.primary', icon('wand'), 'Run');

        const refresh = () => {
            const t = TOOLS[current];
            hint.textContent = t.hint;
            mount(extra, t.extra === 'lang' ? field('Translate into', select({ options: LANGS, value: opts.lang, onChange: (v) => { opts.lang = v; } }))
                : t.extra === 'style' ? field('Style', chips({ options: ['professional', 'casual', 'academic', 'creative', 'concise'].map((s) => ({ id: s, label: s })), value: opts.style, onChange: (v) => { opts.style = v; } }))
                    : t.extra === 'kind' ? field('Type', chips({ options: ['story', 'poem', 'script', 'lyrics'].map((s) => ({ id: s, label: s })), value: opts.kind, onChange: (v) => { opts.kind = v; } })) : '');
            run.disabled = !!(t.needsKey && !hasKey);
        };
        run.onclick = async () => {
            if (!text.value.trim()) { toast('Add some text first.', { type: 'warning' }); return; }
            run.disabled = true; mount(out, h('div.skeleton', { style: 'height:96px' }));
            try {
                const result = pickText(await TOOLS[current].run(text.value, opts));
                mount(out, h('section.card.raised', h('div.row.between', h('span.eyebrow', 'Result'), h('button.btn.ghost.sm', { onclick: () => copyText(result) }, icon('copy'), 'Copy')), h('div', { style: 'white-space:pre-wrap;margin-top:8px;line-height:1.6' }, result)));
            } catch (e) { mount(out, notice(errorText(e), 'error', icon('warning'))); } finally { refresh(); }
        };
        const picker = chips({ options: Object.entries(TOOLS).map(([id, t]) => ({ id, label: t.label })), value: current, onChange: (v) => { current = v; refresh(); } });
        mount(body, h('section.card', { style: 'margin-top:var(--s-4)' }, picker, h('div', { style: 'margin:12px 0 8px' }, hint), text, h('div', { style: 'margin-top:12px' }, extra), h('div', { style: 'margin-top:12px' }, run)), h('div', { style: 'margin-top:var(--s-4)' }, out));
        refresh();
    }

    // ---------------------------------------------------------------- image describe
    function drawVision() {
        const out = h('div');
        const go = async () => {
            const [file] = await api.pick.files('image', { single: true });
            if (!file) return;
            mount(out, h('div.skeleton', { style: 'height:96px' }));
            try { const r = pickText(await api.ai.describe(file)); mount(out, h('section.card.raised', h('div.eyebrow', basename(file)), h('div', { style: 'white-space:pre-wrap;margin-top:8px;line-height:1.6' }, r))); }
            catch (e) { mount(out, notice(errorText(e), 'error', icon('warning'))); }
        };
        mount(body, h('section.card', { style: 'margin-top:var(--s-4)' }, h('h3.title-md', 'Describe an image'), h('p.card-sub', hasKey ? 'Pick a picture and Gemini describes what it shows.' : 'Needs a Gemini API key (Settings > AI).'),
            h('button.btn.primary', { disabled: !hasKey, onclick: go }, icon('image'), 'Choose an image')), h('div', { style: 'margin-top:var(--s-4)' }, out));
    }

    const draw = () => (tab === 'tools' ? drawTools() : tab === 'vision' ? drawVision() : drawChat());
    const tabBar = tabs([{ id: 'chat', label: 'Chat' }, { id: 'tools', label: 'Text tools' }, { id: 'vision', label: 'Images' }], tab, (id) => { tab = id; draw(); });
    const el = h('div.page', pageHead('AI Hub', 'Chat, summarise, translate and more, powered by Google Gemini with your own key. Nothing is sent until you press Run.'), tabBar, body);
    draw();
    return { el };
}
