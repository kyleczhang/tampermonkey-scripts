// ==UserScript==
// @name         ChatGPT URL Query
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Submit ChatGPT prompts via ?cq= query parameters without touching the UI manually
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
const initialSearchParams = new URLSearchParams(window.location.search);

const immediateQuery = initialSearchParams.get(QUERY_KEY);
if (immediateQuery) {
    sessionStorage.setItem(STORAGE_KEY, immediateQuery);
}

(async () => {
    'use strict';

    const waitFor = (selectorOrResolver, { timeout = 15000 } = {}) => {
        const resolver = typeof selectorOrResolver === 'function'
            ? selectorOrResolver
            : () => document.querySelector(selectorOrResolver);

        return new Promise(resolve => {
            const initial = resolver();
            if (initial) {
                resolve(initial);
                return;
            }

            const observer = new MutationObserver(() => {
                const result = resolver();
                if (result) {
                    observer.disconnect();
                    clearTimeout(timer);
                    resolve(result);
                }
            });

            observer.observe(document.documentElement, { childList: true, subtree: true });

            const timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    };

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    const applyPrompt = (textarea, text) => {
        textarea.focus();
        if (valueDescriptor?.set) {
            valueDescriptor.set.call(textarea, text);
        } else {
            textarea.value = text;
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const submitPrompt = (textarea) => {
        const eventInit = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
        };
        textarea.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        textarea.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    };

    const storedQuery = sessionStorage.getItem(STORAGE_KEY);
    const fallbackQuery = initialSearchParams.get(QUERY_KEY);
    const query = storedQuery || fallbackQuery;

    if (!query) {
        return;
    }

    sessionStorage.removeItem(STORAGE_KEY);

    const cleanedUrl = new URL(window.location.href);
    let urlUpdated = false;
    if (cleanedUrl.searchParams.has(QUERY_KEY)) {
        cleanedUrl.searchParams.delete(QUERY_KEY);
        urlUpdated = true;
    }

    if (urlUpdated) {
        window.history.replaceState({}, document.title, cleanedUrl.toString());
    }

    if (document.readyState === 'loading') {
        await new Promise(resolve => {
            document.addEventListener('DOMContentLoaded', resolve, { once: true });
        });
    }

    const promptTextarea = await waitFor('#prompt-textarea');
    if (!promptTextarea) {
        return;
    }

    applyPrompt(promptTextarea, query);
    await delay(200);
    submitPrompt(promptTextarea);
})();
