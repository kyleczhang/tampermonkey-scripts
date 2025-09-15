// ==UserScript==
// @name         Tencent Yuanbao query with URL
// @namespace    http://tampermonkey.net/
// @version      1.2.9
// @description  Add URL query string search functionality for Tencent Yuanbao web version, q is for query
// @match        https://yuanbao.tencent.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=yuanbao.tencent.com
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/yuanbao-url-query.js
// @updateURL   https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/yuanbao-url-query.js
// @run-at      document-start
// ==/UserScript==

// Capture query parameter before redirect
const savedQuery = new URLSearchParams(window.location.search).get('q');
if (savedQuery) {
    sessionStorage.setItem('yuanbao-query', savedQuery);
}

(async () => {
    'use strict';

    // Get query from storage or URL
    const query = sessionStorage.getItem('yuanbao-query') || new URLSearchParams(window.location.search).get('q');
    if (!query) {
        return;
    }
    sessionStorage.removeItem('yuanbao-query');

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const simulateInput = (elem, text) => {
        elem.focus();
        elem.textContent = text;
        elem.dispatchEvent(new Event('focus', { bubbles: true }));
        elem.dispatchEvent(new InputEvent('input', {
            data: text,
            bubbles: true,
            inputType: 'insertText'
        }));
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

    // Wait for elements to load
    const maxWaitTime = 10000;
    const startTime = Date.now();
    let button, chat, sendBtn;

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
        (!(button = document.querySelector('button[dt-button-id="model_switch"]')) ||
            !(chat = document.querySelector('.ql-editor')) ||
            !(sendBtn = document.querySelector('.style__send-btn___ZsLmU'))) &&
        Date.now() - startTime < maxWaitTime
    ) {
        await delay(100);
    }

    if (!button || !chat || !sendBtn) {
        return;
    }

    // Set model to DeepSeek
    button.setAttribute("dt-model-id", "deep_seek");
    button.setAttribute("dt-ext1", "deep_seek");
    button.querySelector('span').textContent = "DeepSeek";

    // Input query
    await delay(100);
    simulateInput(chat, query);
    await delay(100);
    simulateEnter(chat);
    await delay(100);
    simulateClick(sendBtn);
})();