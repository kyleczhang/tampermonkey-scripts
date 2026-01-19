// ==UserScript==
// @name         ChatGPT URL Query
// @namespace    http://tampermonkey.net/
// @version      2.7.1
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
const LOG_PREFIX = '[ChatGPT URL Query]';
const SEND_SELECTOR = 'button[data-testid="composer-send-button"], button[data-testid="send-button"], form[data-type="unified-composer"] button[type="submit"], button[aria-label="Send"], button[aria-label="Send prompt"]';
const COMPOSER_SELECTORS = [
    '#prompt-textarea[contenteditable="true"]',
    '.ProseMirror[contenteditable="true"]',
    'textarea[name="prompt-textarea"]'
];

const immediateQuery = new URLSearchParams(window.location.search).get(QUERY_KEY);
if (immediateQuery) {
    // Preserve the query across redirects or SPA reload before the UI is ready.
    console.log(LOG_PREFIX, 'Query found in URL, storing:', immediateQuery);
    sessionStorage.setItem(STORAGE_KEY, immediateQuery);
}

(async () => {
    'use strict';

    /**
     * Overall flow:
     * - Load and stash the query before SPA routing.
     * - Fill the textarea ASAP when it appears (don't wait for button).
     * - After filling, wait for the enabled Send button to appear.
     * - Prefer Enter key for sending; fall back to clicking if needed.
     */

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const SEND_POLL_DELAY = 50;

    const waitFor = (resolverOrSelector, options = {}) => {
        // Resolves when the selector matches, checking on mutations AND polling.
        // Polling ensures we catch elements that exist but are settling from animations.
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

            let resolved = false;
            const checkAndResolve = () => {
                if (resolved) return;
                const result = resolver();
                if (result) {
                    resolved = true;
                    observer.disconnect();
                    clearTimeout(timer);
                    clearInterval(pollInterval);
                    resolve(result);
                }
            };

            const observerRoot = root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
            const observer = new MutationObserver(checkAndResolve);
            observer.observe(observerRoot, { childList: true, subtree: true, attributes: true });

            // Poll every 50ms for fast detection of changes
            const pollInterval = setInterval(checkAndResolve, 50);

            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    observer.disconnect();
                    clearInterval(pollInterval);
                    resolve(null);
                }
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

    const isSendButtonReady = (button) => {
        // The send button is ready when it's:
        // 1. Not disabled
        // 2. Has send-button test id (not voice mode button)
        // 3. aria-label contains "Send"
        if (!button || isDisabled(button)) return false;
        const testId = button.getAttribute('data-testid');
        const ariaLabel = button.getAttribute('aria-label');
        return testId === 'send-button' && ariaLabel && ariaLabel.toLowerCase().includes('send');
    };

    const queryFromStorage = sessionStorage.getItem(STORAGE_KEY);
    const queryFromUrl = new URLSearchParams(window.location.search).get(QUERY_KEY);
    const query = queryFromStorage || queryFromUrl;

    if (!query) {
        // Nothing to do if neither storage nor URL held a query.
        console.log(LOG_PREFIX, 'No query found, exiting');
        return;
    }

    console.log(LOG_PREFIX, 'Processing query:', query);

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

    // STEP 1: Wait for composer and fill it ASAP (don't wait for button)
    console.log(LOG_PREFIX, 'Waiting for composer...');
    const composer = await waitFor(findComposer, { timeout: 20000 });
    if (!composer) {
        // Do not hang forever—silently exit so the page works normally.
        console.log(LOG_PREFIX, 'Composer not found, exiting');
        return;
    }

    console.log(LOG_PREFIX, 'Composer found, filling text');
    setComposerText(composer, query);
    await delay(80);
    console.log(LOG_PREFIX, 'Text filled, waiting for send button to become ready');

    // STEP 2: Now wait for the send button to become enabled and ready
    // The button transitions: disabled → voice mode → enabled send button
    const readySendButton = await waitFor(() => {
        const btn = document.querySelector(SEND_SELECTOR);
        return isSendButtonReady(btn) ? btn : null;
    }, { timeout: 15000 });

    if (!readySendButton) {
        // If button never becomes ready, try Enter key as fallback
        console.log(LOG_PREFIX, 'Send button never became ready, trying Enter key as fallback');
        composer.focus();
        await delay(50);
        simulateEnter(composer);
        return;
    }

    console.log(LOG_PREFIX, 'Send button is ready');

    // STEP 3: Button is ready, give ChatGPT's validation a moment to settle
    await delay(100);

    // Re-find and focus composer (DOM might have updated)
    const activeComposer = findComposer() || composer;
    console.log(LOG_PREFIX, 'Focusing composer and attempting to send');
    activeComposer.focus();
    await delay(50);

    // Try Enter key first (preferred method)
    console.log(LOG_PREFIX, 'Simulating Enter key press');
    simulateEnter(activeComposer);

    // If Enter didn't work after a short wait, click the button as backup
    await delay(200);
    const finalButton = document.querySelector(SEND_SELECTOR);
    if (finalButton && isSendButtonReady(finalButton)) {
        console.log(LOG_PREFIX, 'Enter key might not have worked, clicking send button as backup');
        simulateClick(finalButton);
    } else {
        console.log(LOG_PREFIX, 'Send attempt completed');
    }
})();
