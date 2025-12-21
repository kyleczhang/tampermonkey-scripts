// ==UserScript==
// @name         ChatGPT URL Query
// @namespace    http://tampermonkey.net/
// @version      2.3.5
// @description  Submit ChatGPT prompts via ?cq= query parameter
// @author       kyleczhang
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chatgpt-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chatgpt-url-query.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

const QUERY_KEY = 'cq';
const STORAGE_KEY = 'chatgpt-url-query';
const SEND_SELECTOR = 'button[data-testid="composer-send-button"], button[data-testid="send-button"], form[data-type="unified-composer"] button[type="submit"], button[aria-label="Send"], button[aria-label="Send prompt"]';
const COMPOSER_SELECTORS = [
    '#prompt-textarea[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    'textarea[name="prompt-textarea"]'
];

const immediateQuery = new URLSearchParams(window.location.search).get(QUERY_KEY);
if (immediateQuery) {
    // Preserve the query across redirects or SPA reload before the UI is ready.
    sessionStorage.setItem(STORAGE_KEY, immediateQuery);
}

(async () => {
    'use strict';

    /**
     * Overall flow:
     * - Load and stash the query before SPA routing.
     * - Wait for the composer + send button to exist.
     * - Replace composer text, dispatch input events, then attempt to send.
     * - Prefer clicking Send; fall back to Enter if unavailable/disabled.
     */

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const SEND_POLL_DELAY = 80;

    const waitFor = (resolverOrSelector, options = {}) => {
        // Resolves when the selector matches, retrying on DOM mutations until timeout.
        // Accepts either a selector string or a resolver function that returns a node.
        const { timeout = 5000, root = document } = options;
        const resolver = typeof resolverOrSelector === 'function'
            ? resolverOrSelector
            : () => root.querySelector(resolverOrSelector);

        return new Promise(resolve => {
            const initial = resolver();
            if (initial) {
                resolve(initial);
                return;
            }

            const observerRoot = root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
            const observer = new MutationObserver(() => {
                const result = resolver();
                if (result) {
                    observer.disconnect();
                    clearTimeout(timer);
                    resolve(result);
                }
            });

            observer.observe(observerRoot, { childList: true, subtree: true, attributes: true });

            const timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    };

    const dispatchInputEvents = (elem) => {
        // Fire the same events the UI would emit so React/ProseMirror update state.
        const payload = elem.isContentEditable ? elem.textContent : elem.value;
        try {
            elem.dispatchEvent(new InputEvent('input', { bubbles: true, data: payload || '' }));
        } catch (_) {
            elem.dispatchEvent(new Event('input', { bubbles: true }));
        }
        elem.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const setComposerText = (elem, text) => {
        // Clear then insert text in either a rich editor or a textarea.
        elem.focus();

        if (elem.isContentEditable) {
            try { document.execCommand('selectAll'); document.execCommand('delete'); } catch (_) { elem.textContent = ''; }
            try { if (!document.execCommand('insertText', false, text)) elem.textContent = text; } catch (_) { elem.textContent = text; }
        } else if ('value' in elem) {
            elem.value = '';
            elem.value = text;
        } else {
            elem.textContent = text;
        }

        dispatchInputEvents(elem);
    };

    const simulateEnter = (elem) => {
        const eventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        elem.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        elem.dispatchEvent(new KeyboardEvent('keypress', eventInit));
        elem.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    };

    const simulateClick = (elem) => {
        elem.focus();
        elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    const isDisabled = (elem) => elem?.disabled || elem?.getAttribute?.('aria-disabled') === 'true';

    const isVisible = (elem) => {
        if (!elem) return false;
        const style = window.getComputedStyle(elem);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const findComposer = () => {
        // Prefer current rich editor, then any other contenteditable, then textarea.
        for (const selector of COMPOSER_SELECTORS) {
            const node = document.querySelector(selector);
            if (node && isVisible(node)) return node;
        }
        return null;
    };

    const queryFromStorage = sessionStorage.getItem(STORAGE_KEY);
    const queryFromUrl = new URLSearchParams(window.location.search).get(QUERY_KEY);
    const query = queryFromStorage || queryFromUrl;

    if (!query) {
        // Nothing to do if neither storage nor URL held a query.
        return;
    }

    sessionStorage.removeItem(STORAGE_KEY);

    const cleanedUrl = new URL(window.location.href);
    if (cleanedUrl.searchParams.has(QUERY_KEY)) {
        // Remove the transient query param so the URL stays clean after submission.
        cleanedUrl.searchParams.delete(QUERY_KEY);
        window.history.replaceState({}, document.title, cleanedUrl.toString());
    }

    if (document.readyState !== 'complete') {
        await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
        });
    }

    const composer = await waitFor(findComposer, { timeout: 20000 });
    if (!composer) {
        // Do not hang forever—silently exit so the page works normally.
        return;
    }

    setComposerText(composer, query);
    await delay(120);

    const sendButton = await waitFor(SEND_SELECTOR, { timeout: 5000 });
    if (sendButton) {
        // Wait briefly for ChatGPT debounce/validation to enable the button.
        let current = sendButton;
        for (let i = 0; i < 40 && isDisabled(current); i++) {
            await delay(SEND_POLL_DELAY);
            current = document.querySelector(SEND_SELECTOR) || current;
        }

        if (!isDisabled(current)) {
            simulateClick(current);
            return;
        }
    }

    simulateEnter(composer);
})();
