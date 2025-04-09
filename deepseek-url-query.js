// ==UserScript==
// @name         DeepSeek query with URL
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Add URL query string search functionality for DeepSeek web version, q is for query, r for DeepThink
// @match        https://chat.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepseek.com
// @license      MIT
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/deepseek-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/deepseek-url-query.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Parse URL parameters
    function getQueryParam(name) {
        const params = new URLSearchParams(window.location.search);
        return params.get(name);
    }

    // Find button by text
    function findButtonByText(text) {
        const xpath = `//div[@role='button']//span[contains(text(), '${text}')]`;
        const result = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        );
        return result.singleNodeValue?.closest('div[role="button"]');
    }

    // Check if the button is active
    function isButtonActive(button) {
        return getComputedStyle(button)
            .getPropertyValue('--ds-button-color')
            .includes('77, 107, 254');
    }

    // Trigger React's input event
    function setReactInputValue(element, value) {
        const inputEvent = new Event('input', { bubbles: true, composed: true });
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
        ).set;
        nativeInputValueSetter.call(element, value);
        element.dispatchEvent(inputEvent);
    }

    // Toggle mode (activate or deactivate) based on shouldEnable flag
    async function toggleMode(button, shouldEnable) {
        if (!button) return;
        const isActive = isButtonActive(button);
        if (shouldEnable && !isActive) {
            button.click();
            await new Promise((r) => setTimeout(r, 200));
        }
        if (!shouldEnable && isActive) {
            button.click();
            await new Promise((r) => setTimeout(r, 200));
        }
    }

    // Main function to process URL query parameters
    async function processQueryParams() {
        const qParam = getQueryParam('q');
        const query = qParam ? decodeURIComponent(qParam) : '';
        const needDeepThinking = getQueryParam('r') === 'true';

        if (!query) return;

        // Wait for necessary elements to load
        const maxWaitTime = 5000;
        const startTime = Date.now();
        let textarea;

        // Wait for the input box to load
        while (!(textarea = document.getElementById('chat-input')) && Date.now() - startTime < maxWaitTime) {
            await new Promise((r) => setTimeout(r, 100));
        }

        if (!textarea) {
            console.error('Could not find the input box');
            return;
        }

        // Set the query content in the input box
        setReactInputValue(textarea, query);

        // Force enable online search (if needed)
        // const webSearchBtn = findButtonByText('Search');
        // await toggleMode(webSearchBtn, true);

        // Process DeepThink mode
        const deepThinkBtn = findButtonByText('DeepThink (R1)');
        await toggleMode(deepThinkBtn, needDeepThinking);

        // Click the send button
        const sendBtn = document.querySelector('div[role="button"][aria-disabled="false"]');
        if (sendBtn) {
            sendBtn.click();
        } else {
            const observer = new MutationObserver(() => {
                const activeSendBtn = document.querySelector('div[role="button"][aria-disabled="false"]');
                if (activeSendBtn) {
                    observer.disconnect();
                    activeSendBtn.click();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    }

    // Execute processQueryParams after the page has loaded
    window.addEventListener('load', () => {
        setTimeout(processQueryParams, 1000);
    });
})();
