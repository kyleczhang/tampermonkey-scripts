// ==UserScript==
// @name         ChatGPT URL Query
// @namespace    http://tampermonkey.net/
// @version      2.3.1
// @description  Submit ChatGPT prompts via ?cq= query parameter
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

const immediateQuery = new URLSearchParams(window.location.search).get(QUERY_KEY);
if (immediateQuery) {
    sessionStorage.setItem(STORAGE_KEY, immediateQuery);
}

(async () => {
    'use strict';

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const BEFORE_CLEAR_DELAY = 30;
    const BEFORE_POPULATE_DELAY = 20;
    const BEFORE_SUBMIT_DELAY = 100;
    const HIDDEN_COMPOSER_DELAY = 200;
    const SEND_POLL_DELAY = 80;

    const waitFor = (resolverOrSelector, options = {}) => {
        const { timeout = 15000, root = document } = options;
        const resolver = typeof resolverOrSelector === 'function'
            ? resolverOrSelector
            : () => root.querySelector(resolverOrSelector);

        return new Promise(resolve => {
            const initial = resolver();
            if (initial) {
                resolve(initial);
                return;
            }

            const observerRoot = root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
            const observer = new MutationObserver(() => {
                const result = resolver();
                if (result) {
                    observer.disconnect();
                    clearTimeout(timer);
                    resolve(result);
                }
            });

            observer.observe(observerRoot, { childList: true, subtree: true });

            const timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    };

    const safeExecCommand = (command, value) => {
        try {
            return document.execCommand(command, false, value);
        } catch (error) {
            return false;
        }
    };

    const getNativeValueSetter = (element) => {
        if (element instanceof HTMLTextAreaElement) {
            return Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        }
        if (element instanceof HTMLInputElement) {
            return Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        }
        return null;
    };

    const dispatchInputEvents = (elem) => {
        const payload = elem.isContentEditable ? elem.textContent : elem.value;
        try {
            elem.dispatchEvent(new InputEvent('input', { bubbles: true, data: payload || '' }));
        } catch (_) {
            elem.dispatchEvent(new Event('input', { bubbles: true }));
        }
        elem.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const clearComposer = (elem) => {
        elem.focus();
        if (elem.isContentEditable) {
            if (!safeExecCommand('selectAll')) {
                const selection = window.getSelection();
                selection?.removeAllRanges();
                const range = document.createRange();
                range.selectNodeContents(elem);
                selection?.addRange(range);
            }
            safeExecCommand('delete');
            elem.textContent = '';
        } else {
            const setter = getNativeValueSetter(elem);
            if (setter) {
                setter.call(elem, '');
            } else if ('value' in elem) {
                elem.value = '';
            }
        }
        dispatchInputEvents(elem);
    };

    const populateComposer = (elem, text) => {
        elem.focus();
        if (elem.isContentEditable) {
            if (!safeExecCommand('insertText', text)) {
                elem.textContent = text;
            }
        } else {
            const setter = getNativeValueSetter(elem);
            if (setter) {
                setter.call(elem, text);
            } else if ('value' in elem) {
                elem.value = text;
            } else {
                elem.textContent = text;
            }
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

    const isDisabled = (elem) => elem?.disabled || elem?.getAttribute?.('aria-disabled') === 'true';

    const isVisible = (elem) => {
        if (!elem) return false;
        const style = window.getComputedStyle(elem);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    const findComposer = () => {
        const preferRich = document.querySelector('#prompt-textarea[contenteditable="true"]');
        if (preferRich && isVisible(preferRich)) {
            return { node: preferRich, type: 'rich' };
        }
        const otherRich = Array.from(document.querySelectorAll('.ProseMirror[contenteditable="true"]')).find(isVisible);
        if (otherRich) {
            return { node: otherRich, type: 'rich' };
        }
        const textareas = Array.from(document.querySelectorAll('textarea[name="prompt-textarea"]'));
        const visibleTextarea = textareas.find(isVisible);
        if (visibleTextarea) {
            return { node: visibleTextarea, type: 'textarea' };
        }
        if (preferRich) {
            return { node: preferRich, type: 'rich-hidden' };
        }
        return null;
    };

    const queryFromStorage = sessionStorage.getItem(STORAGE_KEY);
    const queryFromUrl = new URLSearchParams(window.location.search).get(QUERY_KEY);
    const query = queryFromStorage || queryFromUrl;

    if (!query) {
        return;
    }

    sessionStorage.removeItem(STORAGE_KEY);

    const cleanedUrl = new URL(window.location.href);
    if (cleanedUrl.searchParams.has(QUERY_KEY)) {
        cleanedUrl.searchParams.delete(QUERY_KEY);
        window.history.replaceState({}, document.title, cleanedUrl.toString());
    }

    if (document.readyState !== 'complete') {
        await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
        });
    }

    const selectors = {
        send: 'button[data-testid="composer-send-button"], button[data-testid="send-button"], form[data-type="unified-composer"] button[type="submit"], button[aria-label="Send"], button[aria-label="Send prompt"]'
    };

    const composerInfo = await waitFor(findComposer, { timeout: 20000 });
    if (!composerInfo) {
        return;
    }

    let composerNode = composerInfo.node;
    if (composerInfo.type === 'rich-hidden') {
        await delay(HIDDEN_COMPOSER_DELAY);
        const retryInfo = findComposer();
        if (retryInfo && retryInfo.type !== 'rich-hidden') {
            composerNode = retryInfo.node;
        }
    }

    const targetComposer = composerNode;

    await delay(BEFORE_CLEAR_DELAY);
    clearComposer(targetComposer);
    await delay(BEFORE_POPULATE_DELAY);
    populateComposer(targetComposer, query);
    await delay(BEFORE_SUBMIT_DELAY);

    const sendButton = await waitFor(selectors.send, { timeout: 5000 });
    if (sendButton) {
        let currentSendButton = sendButton;
        const observer = new MutationObserver(() => {
            const replacement = document.querySelector(selectors.send);
            if (replacement) {
                currentSendButton = replacement;
            }
        });
        observer.observe(currentSendButton.parentNode || document.body, { childList: true, subtree: true });

        let attempts = 0;
        const maxAttempts = 50;
        while (isDisabled(currentSendButton) && attempts < maxAttempts) {
            await delay(SEND_POLL_DELAY);
            attempts++;
        }

        observer.disconnect();

        if (!isDisabled(currentSendButton)) {
            simulateClick(currentSendButton);
            return;
        }
    }

    simulateEnter(targetComposer);
})();
