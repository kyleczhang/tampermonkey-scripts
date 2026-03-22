// ==UserScript==
// @name         DeepSeek query with URL
// @namespace    http://tampermonkey.net/
// @version      1.2.2
// @description  Submit DeepSeek prompts via ?cq= query parameter
// @author       kyleczhang
// @match        https://chat.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepseek.com
// @license      MIT
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/deepseek-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/deepseek-url-query.js
// @run-at       document-start
// ==/UserScript==

const QUERY_KEY = 'cq';
const STORAGE_QUERY_KEY = 'deepseek-url-query-cq';
const LOG_PREFIX = '[DeepSeek URL Query]';
const COMPOSER_SELECTORS = [
    'textarea#chat-input',
    'textarea[placeholder="Message DeepSeek"]',
    'textarea.ds-scroll-area',
    'textarea'
];

const immediateParams = new URLSearchParams(window.location.search);
const immediateQuery = immediateParams.get(QUERY_KEY);

if (immediateQuery) {
    // Preserve the query across redirects or SPA transitions.
    sessionStorage.setItem(STORAGE_QUERY_KEY, immediateQuery);
    console.log(LOG_PREFIX, 'Query found in URL and cached');
}

(async () => {
    'use strict';

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const waitFor = (resolverOrSelector, options = {}) => {
        const { timeout = 15000, root = document } = options;
        const resolver = typeof resolverOrSelector === 'function'
            ? resolverOrSelector
            : () => root.querySelector(resolverOrSelector);

        return new Promise((resolve) => {
            const initial = resolver();
            if (initial) {
                resolve(initial);
                return;
            }

            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(timer);
                clearInterval(poller);
                resolve(value);
            };

            const check = () => {
                const result = resolver();
                if (result) finish(result);
            };

            const observerRoot = root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
            const observer = new MutationObserver(check);
            if (observerRoot) {
                observer.observe(observerRoot, { childList: true, subtree: true, attributes: true });
            }

            const poller = setInterval(check, 50);
            const timer = setTimeout(() => finish(null), timeout);
        });
    };

    const isVisible = (elem) => {
        if (!elem) return false;
        const style = window.getComputedStyle(elem);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const findComposer = () => {
        for (const selector of COMPOSER_SELECTORS) {
            const candidates = document.querySelectorAll(selector);
            for (const node of candidates) {
                if (node instanceof HTMLTextAreaElement && isVisible(node)) {
                    return node;
                }
            }
        }
        return null;
    };

    const getNativeTextareaValueSetter = () =>
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

    const dispatchInputEvents = (elem) => {
        const value = elem.value || '';
        try {
            elem.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value }));
        } catch (_) {
            elem.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }
        elem.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    };

    const setComposerText = (elem, text) => {
        elem.focus();
        const setter = getNativeTextareaValueSetter();
        if (setter) {
            setter.call(elem, '');
            setter.call(elem, text);
        } else {
            elem.value = text;
        }
        dispatchInputEvents(elem);
    };

    const simulateEnter = (elem) => {
        const eventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        elem.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        elem.dispatchEvent(new KeyboardEvent('keypress', eventInit));
        elem.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    };

    const simulateClick = (elem) => {
        elem.focus();
        elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    const isDisabled = (elem) => elem?.getAttribute('aria-disabled') === 'true' || elem?.disabled;

    const getButtonIconPath = (button) => button?.querySelector('svg path')?.getAttribute('d') || '';
    const isAttachIcon = (path) => path.startsWith('M5.5498 9.75V5H6.9502V9.75');
    const isSendIcon = (path) => path.startsWith('M8.3125 0.981587');
    const isStopIcon = (path) => path.startsWith('M2 4.88');

    const findSendOrStopButton = () => {
        const candidates = Array.from(document.querySelectorAll('.bf38813a div[role="button"]'));
        for (let i = candidates.length - 1; i >= 0; i--) {
            const button = candidates[i];
            if (!isVisible(button)) continue;
            const iconPath = getButtonIconPath(button);
            if (isAttachIcon(iconPath)) continue;
            if (isSendIcon(iconPath) || isStopIcon(iconPath)) return button;
            if (button.classList.contains('ds-icon-button')) return button;
        }
        return null;
    };

    const isSendButtonReady = (button) => {
        if (!button || isDisabled(button)) return false;
        const iconPath = getButtonIconPath(button);
        return isSendIcon(iconPath);
    };

    const params = new URLSearchParams(window.location.search);
    const query =
        sessionStorage.getItem(STORAGE_QUERY_KEY) ||
        params.get(QUERY_KEY);

    if (!query) {
        console.log(LOG_PREFIX, 'No query found, exiting');
        return;
    }

    console.log(LOG_PREFIX, 'Processing query');
    sessionStorage.removeItem(STORAGE_QUERY_KEY);

    const cleanUrl = new URL(window.location.href);
    if (cleanUrl.searchParams.has(QUERY_KEY)) {
        cleanUrl.searchParams.delete(QUERY_KEY);
        window.history.replaceState({}, document.title, cleanUrl.toString());
    }

    console.log(LOG_PREFIX, 'Waiting for composer');
    const composer = await waitFor(findComposer, { timeout: 30000 });
    if (!composer) {
        console.log(LOG_PREFIX, 'Composer not found, exiting');
        return;
    }

    setComposerText(composer, query);
    console.log(LOG_PREFIX, 'Composer filled');

    console.log(LOG_PREFIX, 'Waiting for send button');
    const readySendButton = await waitFor(() => {
        const button = findSendOrStopButton();
        return isSendButtonReady(button) ? button : null;
    }, { timeout: 20000 });

    if (!readySendButton) {
        console.log(LOG_PREFIX, 'Send button did not become ready, trying Enter fallback');
        composer.focus();
        await delay(50);
        simulateEnter(composer);
        return;
    }

    // Prefer Enter first.
    composer.focus();
    await delay(50);
    simulateEnter(composer);

    // Backup click only if the button is still in "send" mode (not "stop generating").
    await delay(220);
    const finalButton = findSendOrStopButton();
    if (isSendButtonReady(finalButton)) {
        simulateClick(finalButton);
    }
})();
