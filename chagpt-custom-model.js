// ==UserScript==
// @name         ChatGPT Custom Model
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Customize ChatGPT model with URL query
// @author       kyleczhang
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @license      MIT
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // Parse URL parameters
    function getQueryParam(name) {
        const params = new URLSearchParams(window.location.search);
        return params.get(name);
    }

    // Find button containing specified text
    function findButtonByText(text) {
        const xpath = `//div[@role='button']//span[contains(text(), '${text}')]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        return result.singleNodeValue?.closest('div[role="button"]');
    }

    // Check if button is active
    function isButtonActive(button) {
        return getComputedStyle(button).getPropertyValue('--ds-button-color').includes('77, 107, 254');
    }

    // Trigger React input event
    function setReactInputValue(element, value) {
        const inputEvent = new Event('input', { bubbles: true, composed: true });
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
        ).set;
        nativeInputValueSetter.call(element, value);
        element.dispatchEvent(inputEvent);
    }

    // Handle mode switching
    async function toggleMode(button, shouldEnable) {
        if (!button) return;
        const isActive = isButtonActive(button);
        if (shouldEnable && !isActive) {
            button.click();
            await new Promise(r => setTimeout(r, 200));
        }
        if (!shouldEnable && isActive) {
            button.click();
            await new Promise(r => setTimeout(r, 200));
        }
    }

    // Main processing function
    async function processQueryParams() {
        // Get parameters (bracket issue fixed)
        const mParam = getQueryParam('mqqq');
        const model = mParam ? decodeURIComponent(mParam) : '';

        if (!model) return;

        // Wait for necessary elements to load
        const maxWaitTime = 5000;
        const startTime = Date.now();

        // Wait for model dropdown btn to load
        let modelDropdownBtn;
        while (!(modelDropdownBtn = document.querySelector('[data-testid="model-switcher-dropdown-button"]')) && Date.now() - startTime < maxWaitTime) {
            console.log('waiting for modelDropdownBtn');
            await new Promise(r => setTimeout(r, 100));
        }

        if (!modelDropdownBtn) {
            console.error('modelDropdownBtn not found');
            return;
        }

        console.log('modelDropdownBtn found');
        // Click model dropdown button
        modelDropdownBtn.click();

        // Wait for model option to load
        let modelOption;
        while (!(modelOption = document.querySelector(`[data-testid="model-switcher-${model}"]`)) && Date.now() - startTime < maxWaitTime) {
            await new Promise(r => setTimeout(r, 100));
        }

        if (!modelOption) {
            console.error('modelOption not found');
            return;
        }

        // Click model option
        modelOption.click();
    }

    // Execute after page load completes
    window.addEventListener('load', () => {
        setTimeout(processQueryParams, 1000);
    });
})();