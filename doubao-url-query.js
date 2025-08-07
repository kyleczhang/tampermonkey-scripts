// ==UserScript==
// @name         Doubao query with URL
// @namespace    http://tampermonkey.net/
// @version      1.0.1
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

    const simulateEnter = (elem) => {
        elem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        elem.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        elem.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    };

    const simulateClick = (elem) => {
        elem.focus();
        elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    // Get query from storage or URL
    const query = sessionStorage.getItem('doubao-query') || new URLSearchParams(window.location.search).get('q');
    if (!query) {
        return;
    }
    sessionStorage.removeItem('doubao-query');

    // Wait for elements to load
    const maxWaitTime = 10000;
    const startTime = Date.now();
    let textarea, sendBtn;

    // Wait for page to load
    if (document.readyState !== 'complete') {
        await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
        });
    }

    // Wait for DOM to stabilize
    let lastElementCount = 0;
    let stableCount = 0;
    while (stableCount < 3) {
        const currentElementCount = document.querySelectorAll('*').length;
        stableCount = currentElementCount === lastElementCount ? stableCount + 1 : 0;
        lastElementCount = currentElementCount;
        await delay(100);
    }

    // Find required elements
    while (
        (!(textarea = document.querySelector('textarea[data-testid="chat_input_input"]')) ||
            !(sendBtn = document.querySelector('button[data-testid="chat_input_send_button"]'))) &&
        Date.now() - startTime < maxWaitTime
    ) {
        await delay(100);
    }

    if (!textarea || !sendBtn) {
        return;
    }

    // Input query
    await delay(100);
    await simulateInput(textarea, query);
    await delay(500); // Give more time for UI to react
    simulateEnter(textarea);
    await delay(100);

    // Wait for send button to be enabled
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds
    while (sendBtn.disabled && attempts < maxAttempts) {
        await delay(100);
        attempts++;
    }

    if (!sendBtn.disabled) {
        simulateClick(sendBtn);
    }
})();
