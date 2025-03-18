// ==UserScript==
// @name         Kimi Moonshot URL Query
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Extracts 'q' URL parameter, populates the chat input, and submits the query on Kimi website
// @author
// @match        https://kimi.moonshot.cn/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=kimi.moonshot.cn
// @license      MIT
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Get URL parameter value by key
    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    // Wait for element to appear in the DOM with a timeout
    async function waitForElement(selector, timeout = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Timeout waiting for element: ${selector}`);
    }


    // Process URL parameters: extract 'q' and submit it
    async function processQueryParams() {
        const query = getQueryParam('q');
        if (!query) return;

        try {
            const chatInput = await waitForElement('.chat-input-editor');
            chatInput.focus();

            chatInput.value = query;
            chatInput.dispatchEvent(new InputEvent('input', { data: query, bubbles: true }));

            // Submit query after a brief delay
            setTimeout(() => {
                chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            }, 500);
        } catch (error) {
            console.error(error);
        }
    }

    // Initialize script after page load
    window.addEventListener('load', () => {
        setTimeout(processQueryParams, 500);
    });
})();
