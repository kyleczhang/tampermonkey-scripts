// ==UserScript==
// @name         Kimi Moonshot URL Query
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Extracts q query parameter from URL, fills in the input box, and submits the search
// @author       kyleczhang
// @match        https://kimi.moonshot.cn/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=kimi.moonshot.cn
// @license      MIT
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


    const chat = await waitForElement('.chat-input-editor');
    chat.value = query;
    chat.dispatchEvent(new InputEvent('input', { data: query, bubbles: true }));

    await delay(500);
    chat.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
})();