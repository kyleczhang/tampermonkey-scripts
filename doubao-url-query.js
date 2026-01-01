// ==UserScript==
// @name         Doubao query with URL
// @namespace    http://tampermonkey.net/
// @version      1.0.4
// @description  Add URL query string search functionality for Doubao web version, q is for query
// @match        https://www.doubao.com/chat/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=doubao.com
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/doubao-url-query.js
// @updateURL   https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/doubao-url-query.js
// @run-at      document-start
// ==/UserScript==

// Capture query parameter before redirect
const savedQuery = new URLSearchParams(window.location.search).get('q');
if (savedQuery) {
    sessionStorage.setItem('doubao-query', savedQuery);
}

(async () => {
    'use strict';

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = (resolver, options = {}) => {
        const { timeout = 10000, root = document } = options;
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

            observer.observe(observerRoot, { childList: true, subtree: true });

            const timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    };

    const simulateInput = async (elem, text) => {

        // Focus the element first
        elem.focus();

        // Clear existing content
        elem.value = '';

        try {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                'value'
            ).set;
            nativeInputValueSetter.call(elem, text);
            elem.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {
        }

        // Final events
        elem.dispatchEvent(new Event('change', { bubbles: true }));

    };

    const simulateClick = (elem) => {
        elem.focus();
        elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    const simulateEnter = (elem) => {
        const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        elem.dispatchEvent(new KeyboardEvent('keydown', opts));
        elem.dispatchEvent(new KeyboardEvent('keypress', opts));
        elem.dispatchEvent(new KeyboardEvent('keyup', opts));
    };

    // Get query from storage or URL
    const query = sessionStorage.getItem('doubao-query') || new URLSearchParams(window.location.search).get('q');
    if (!query) {
        return;
    }
    sessionStorage.removeItem('doubao-query');

    const maxWaitTime = 10000;

    if (document.readyState !== 'complete') {
        await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
        });
    }

    const selectors = {
        input: 'textarea[data-testid="chat_input_input"]',
        send: 'button[data-testid="chat_input_send_button"]'
    };

    // Doubao now renders the send button only after text exists, so wait for the input first.
    const textarea = await waitFor(() => document.querySelector(selectors.input), { timeout: maxWaitTime });
    if (!textarea) {
        return;
    }

    // Input query
    await delay(100);
    await simulateInput(textarea, query);
    await delay(500); // Give more time for UI to react

    // Fast path: try sending via Enter
    simulateEnter(textarea);
    await delay(200);
    if (!textarea.value || textarea.value.trim().length === 0) {
        return;
    }

    // Wait for send button to appear after input shows up
    let currentSendBtn = await waitFor(() => document.querySelector(selectors.send), { timeout: maxWaitTime });
    if (!currentSendBtn) {
        return;
    }

    const isDisabled = (btn) => {
        if (!btn) return true;
        if (btn.disabled) return true;
        const ariaDisabled = btn.getAttribute('aria-disabled');
        if (ariaDisabled && ariaDisabled !== 'false') return true;
        const dataDisabled = btn.getAttribute('data-disabled');
        return dataDisabled && dataDisabled !== 'false';
    };

    // Track possible re-render of the send button
    const observer = new MutationObserver(() => {
        const replacement = document.querySelector(selectors.send);
        if (replacement) {
            currentSendBtn = replacement;
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Wait for send button to be enabled
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds
    while (isDisabled(currentSendBtn) && attempts < maxAttempts) {
        await delay(100);
        attempts++;
    }

    observer.disconnect();

    if (!isDisabled(currentSendBtn)) {
        simulateClick(currentSendBtn);
    }
})();
