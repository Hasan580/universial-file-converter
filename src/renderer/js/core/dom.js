/** Minimal DOM helpers: no framework, no virtual DOM. Elements are built once and updated in place. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('div.card', { onclick }, child, 'text')
 * Props: class/className, style (string or object), dataset, on* handlers, boolean attributes, aria-*.
 */
export function h(tag, props, ...children) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.className = classes.join(' ');
    if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
        for (const [key, value] of Object.entries(props)) {
            if (value === undefined || value === null || value === false) continue;
            if (key === 'class' || key === 'className') el.className = [el.className, value].filter(Boolean).join(' ');
            else if (key === 'style') { if (typeof value === 'string') el.style.cssText = value; else Object.assign(el.style, value); }
            else if (key === 'dataset') Object.assign(el.dataset, value);
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
            else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') el[key] = value;
            else if (value === true) el.setAttribute(key, '');
            else el.setAttribute(key, String(value));
        }
    } else if (props !== undefined && props !== null) {
        children.unshift(props);
    }
    append(el, children);
    return el;
}

export function append(el, children) {
    for (const child of children.flat(Infinity)) {
        if (child === null || child === undefined || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

/** Replace all children of `el`. */
export function mount(el, ...children) {
    el.replaceChildren();
    return append(el, children);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Build an inline SVG from constant markup (only ever used with the built-in icon strings). */
export function svg(inner, attrs = {}) {
    const el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.75');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.innerHTML = inner;
    return el;
}

export function debounce(fn, ms = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Run `fn` on the next animation frame at most once, however often it is called. */
export function frame(fn) {
    let queued = false;
    return (...args) => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; fn(...args); });
    };
}
