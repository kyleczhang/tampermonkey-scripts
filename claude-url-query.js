// ==UserScript==
// @name         Claude URL Query
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Submit Claude prompts via ?cq= query parameter
// @author       kyleczhang
// @match        https://claude.ai/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=claude.ai
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/claude-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/claude-url-query.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

const QUERY_KEY = 'cq';
const STORAGE_KEY = 'claude-url-query-cq';
const LOG_PREFIX = '[Claude URL Query]';
const COMPOSER_SELECTOR = 'div[data-testid="chat-input"][contenteditable="true"][role="textbox"]';
const SEND_SELECTOR = 'button[aria-label="Send message"]';
const STOP_SELECTOR = 'button[aria-label="Stop response"]';

const log = (...args) => console.log(LOG_PREFIX, ...args);

const getQueryFromLocation = () => {
    return new URLSearchParams(window.location.search).get(QUERY_KEY) || '';
};

const immediateQuery = getQueryFromLocation();
if (immediateQuery) {
    sessionStorage.setItem(STORAGE_KEY, immediateQuery);
    log('Query captured at document-start');
}

(async () => {
    'use strict';

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const waitFor = (resolver, options = {}) => {
        const { timeout = 30000, root = document } = options;

        return new Promise((resolve) => {
            const initial = resolver();
            if (initial) {
                resolve(initial);
                return;
            }

            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                observer.disconnect();
                clearInterval(poller);
                clearTimeout(timer);
                resolve(value);
            };

            const check = () => {
                const value = resolver();
                if (value) finish(value);
            };

            const observerRoot = root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
            const observer = new MutationObserver(check);
            if (observerRoot) {
                observer.observe(observerRoot, { childList: true, subtree: true, attributes: true });
            }

            const poller = setInterval(check, 30);
            const timer = setTimeout(() => finish(null), timeout);
        });
    };

    const isVisible = (elem) => {
        if (!elem) return false;
        const style = window.getComputedStyle(elem);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const isDisabled = (elem) => elem?.disabled || elem?.getAttribute?.('aria-disabled') === 'true';

    const findComposer = () => {
        const composer = document.querySelector(COMPOSER_SELECTOR);
        return composer && isVisible(composer) ? composer : null;
    };

    const isSendReady = (button) => !!button && isVisible(button) && !isDisabled(button);

    const findReadySendButton = () => {
        const button = document.querySelector(SEND_SELECTOR);
        return isSendReady(button) ? button : null;
    };

    const dispatchInputEvents = (elem, payload) => {
        try {
            elem.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertText',
                data: payload
            }));
        } catch (_) {
            elem.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
        elem.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    };

    const setComposerText = (elem, text) => {
        elem.focus();

        let inserted = false;
        try {
            document.execCommand('selectAll', false);
            document.execCommand('delete', false);
            inserted = document.execCommand('insertText', false, text);
        } catch (_) {
            inserted = false;
        }

        if (!inserted) {
            elem.innerHTML = '';
            const paragraph = document.createElement('p');
            paragraph.textContent = text;
            elem.appendChild(paragraph);
        }

        dispatchInputEvents(elem, text);
    };

    const simulateEnter = (elem) => {
        const eventInit = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        };

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

    const query = sessionStorage.getItem(STORAGE_KEY) || getQueryFromLocation();
    if (!query) return;

    sessionStorage.removeItem(STORAGE_KEY);

    const cleanedUrl = new URL(window.location.href);
    let urlChanged = false;

    if (cleanedUrl.searchParams.has(QUERY_KEY)) {
        cleanedUrl.searchParams.delete(QUERY_KEY);
        urlChanged = true;
    }

    if (urlChanged) {
        window.history.replaceState({}, document.title, cleanedUrl.toString());
    }

    log('Waiting for composer');
    const composer = await waitFor(findComposer, { timeout: 30000 });
    if (!composer) {
        log('Composer not found, exiting');
        return;
    }

    setComposerText(composer, query);

    const readySendButton = await waitFor(findReadySendButton, { timeout: 8000 });

    const activeComposer = findComposer() || composer;
    activeComposer.focus();
    await delay(20);
    simulateEnter(activeComposer);

    // Backup click only if still in send mode; never click when generation already started.
    await delay(220);
    const stopButton = document.querySelector(STOP_SELECTOR);
    if (stopButton && isVisible(stopButton)) {
        return;
    }

    const finalSendButton = readySendButton && isSendReady(readySendButton)
        ? readySendButton
        : findReadySendButton();

    if (finalSendButton) {
        simulateClick(finalSendButton);
    }
})();
