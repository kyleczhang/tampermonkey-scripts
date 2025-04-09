// ==UserScript==
// @name         ChatGPT Custom Model
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Customize ChatGPT by selecting a model and submitting a query via URL parameters
// @author       kyleczhang
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chagpt-custom-model.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chagpt-custom-model.js
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Get URL parameter value by key
    function getQueryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    // Wait for element to appear in DOM with timeout
    async function waitForElement(selector, timeout = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Timeout waiting for element: ${selector}`);
    }

    // Dispatch pointer event to target element
    function dispatchPointerEvent(target, type) {
        const event = new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerType: 'mouse',
            isPrimary: true,
        });
        target.dispatchEvent(event);
        console.log(`Dispatched pointer event: ${type}`);
    }

    // Execute multiple pointer events on target
    function simulatePointerEvents(target, events) {
        events.forEach(type => dispatchPointerEvent(target, type));
    }

    // Simulate Enter key press on target element
    function simulateEnterKey(target) {
        const keyEventProps = {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            charCode: 13,
            keyCode: 13,
        };
        target.dispatchEvent(new KeyboardEvent('keydown', keyEventProps));
        console.log('Dispatched keydown for Enter');
        target.dispatchEvent(new KeyboardEvent('keyup', keyEventProps));
        console.log('Dispatched keyup for Enter');
    }

    // Process URL params to select model and submit query
    async function processQueryParams() {
        const mParam = getQueryParam('cm');
        const qParam = getQueryParam('cq');
        const model = mParam ? decodeURIComponent(mParam) : '';
        const query = qParam ? decodeURIComponent(qParam) : '';

        // Exit if no parameters provided
        if (!model && !query) return;

        try {
            // Select model from dropdown
            const modelDropdownButton = await waitForElement('[data-testid="model-switcher-dropdown-button"]');
            simulatePointerEvents(modelDropdownButton, ['pointerover', 'pointerenter', 'pointermove', 'pointerdown', 'pointerup']);

            // Select specific model
            const modelOptionSelector = `[data-testid="model-switcher-${model}"]`;
            const modelOption = await waitForElement(modelOptionSelector);
            simulatePointerEvents(modelOption, ['pointerover', 'pointerenter', 'pointermove', 'click']);

            // Focus and populate prompt textarea
            const promptTextarea = await waitForElement('#prompt-textarea');
            simulatePointerEvents(promptTextarea, ['pointerover', 'pointerenter', 'pointermove', 'click']);
            promptTextarea.focus();

            // Insert text and trigger input event
            document.execCommand('insertText', false, query);
            promptTextarea.dispatchEvent(new Event('input', { bubbles: true }));
            console.log("Dispatched input event");

            // Submit query after brief delay
            setTimeout(() => {
                simulateEnterKey(promptTextarea);
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
