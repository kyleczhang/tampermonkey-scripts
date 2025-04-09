// ==UserScript==
// @name         Tencent Yuanbao query with URL
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Add URL query string search functionality for Tencent Yuanbao web version, q is for query
// @match        https://yuanbao.tencent.com/chat/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=yuanbao.tencent.com
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/yuanbao-url-query.js
// @updateURL   https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/yuanbao-url-query.js
// ==/UserScript==

(async () => {
    'use strict';
    const query = new URLSearchParams(window.location.search).get('q');
    if (!query) return;

    const waitForElement = (selector) => {
        return new Promise((resolve) => {
            const elem = document.querySelector(selector);
            if (elem) {
                return resolve(elem);
            }

            const observer = new MutationObserver(() => {
                const elem = document.querySelector(selector);
                if (elem) {
                    observer.disconnect();
                    resolve(elem);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    };
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    const simulateInput = (elem, text) => {
        elem.value = text;
        if (elem.contentEditable === 'true') {
            elem.textContent = text;
            elem.innerHTML = text;
        }
        elem.dispatchEvent(new InputEvent('input', { data: text, bubbles: true }));
    };
    const simulateEnter = (elem, event = 'keydown') => {
        elem.dispatchEvent(new KeyboardEvent(event, { key: 'Enter', keyCode: 13, bubbles: true }));
    };
    const simulateClick = (elem) => {
        elem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    const button = await waitForElement('button[dt-button-id="model_switch"]');
    button.setAttribute("dt-model-id", "deep_seek");
    button.setAttribute("dt-ext1", "deep_seek");
    button.querySelector('span').textContent = "DeepSeek";

    const chat = await waitForElement('.ql-editor');

    const sendBtn = await waitForElement('.style__send-btn___ZsLmU');

    await delay(100);
    simulateInput(chat, query);
    await delay(100);
    simulateEnter(chat);
    await delay(100);
    simulateClick(sendBtn);
})();