// ==UserScript==
// @name         Tongyi query with URL
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Add URL query string search functionality for Tongyi web version, q is for query
// @match        https://www.tongyi.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tongyi.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/tongyi-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/tongyi-url-query.js
// @run-at       document-start
// ==/UserScript==

// Capture query parameter before redirect
const savedQuery = new URLSearchParams(window.location.search).get('q');
if (savedQuery) {
    sessionStorage.setItem('tongyi-query', savedQuery);
}

(async () => {
    'use strict';

    const LOG_PREFIX = '[Tongyi URL Query]';
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const log = (...args) => console.log(LOG_PREFIX, ...args);

    const waitFor = (getter, options = {}) => {
        const { timeout = 15000, scope = document } = options;
        return new Promise((resolve) => {
            const initial = getter();
            if (initial) {
                resolve(initial);
                return;
            }

            const root = scope.nodeType === Node.DOCUMENT_NODE ? scope.documentElement : scope;
            const observer = new MutationObserver(() => {
                const value = getter();
                if (value) {
                    observer.disconnect();
                    clearTimeout(timer);
                    resolve(value);
                }
            });

            observer.observe(root, { childList: true, subtree: true });

            const timer = setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    };

    const simulateInput = async (elem, text) => {
        elem.focus();
        elem.value = '';

        try {
            const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
            descriptor?.set?.call(elem, text);
        } catch (e) {
            elem.value = text;
        }

        elem.dispatchEvent(new Event('input', { bubbles: true }));
        elem.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const simulateEnter = (elem) => {
        elem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        elem.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        elem.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    };

    const simulateClick = (elem) => {
        elem.focus();
        elem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        elem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };

    const isDisabled = (btn) => {
        if (!btn) {
            return true;
        }
        const classList = btn.classList ? Array.from(btn.classList) : btn.className.split(/\s+/);
        return classList.some(cls => cls.startsWith('disabled--')) || btn.getAttribute('aria-disabled') === 'true';
    };

    log('Booting userscript…');
    const queryParam = sessionStorage.getItem('tongyi-query') || new URLSearchParams(window.location.search).get('q');
    const query = typeof queryParam === 'string' ? queryParam.trim() : '';
    if (!query) {
        log('No query parameter detected, aborting.');
        return;
    }
    log('Detected query:', query);
    sessionStorage.removeItem('tongyi-query');

    const maxWaitTime = 15000;
    const startTime = Date.now();
    const inputWrapperSelector = 'div[class^="inputOutWrap--"]';
    const textareaSelector = `${inputWrapperSelector} div[class^="chatTextarea--"] textarea, ${inputWrapperSelector} textarea`;
    const sendBtnSelector = `div[class*="operateBtn--"], button[class*="operateBtn--"], div[class*="sendBtn--"], button[class*="sendBtn--"], div[class*="primaryBtn--"], button[class*="primaryBtn--"]`;

    const getSendButton = (scope = document) => {
        let btn = scope.querySelector(sendBtnSelector);
        if (btn) {
            return btn;
        }

        const iconUse = scope.querySelector('use[href="#icon-fasong_default"], use[xlink\\:href="#icon-fasong_default"]');
        if (iconUse) {
            btn = iconUse.closest('button, div');
            if (btn) {
                return btn;
            }
        }

        const ariaSend = Array.from(scope.querySelectorAll('button, div')).find(el => {
            const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
            return label.includes('send') || label.includes('发送');
        });
        if (ariaSend) {
            return ariaSend;
        }

        const icon = Array.from(scope.querySelectorAll('svg use')).find(useEl => {
            const href = useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
            return href.includes('fasong') || href.includes('send') || href.includes('enter');
        });
        if (icon) {
            const iconBtn = icon.closest('button, div');
            if (iconBtn) {
                return iconBtn;
            }
        }

        return null;
    };

    if (document.readyState !== 'complete') {
        log('Waiting for window load…');
        await new Promise(resolve => {
            window.addEventListener('load', resolve, { once: true });
        });
        log('Window load complete.');
    }

    log('Searching for textarea.');
    const textarea = await waitFor(() => document.querySelector(textareaSelector), { timeout: maxWaitTime });
    if (!textarea) {
        log('Failed to locate textarea within timeout.');
        return;
    }

    const inputWrapper = textarea.closest('div[class^="inputOutWrap--"]') || textarea.parentElement;
    const wrapperNode = inputWrapper || document;
    const sendBtn = await waitFor(() => getSendButton(wrapperNode), { timeout: maxWaitTime, scope: wrapperNode });
    if (!sendBtn) {
        log('Failed to locate send button within timeout.', {
            wrapperPresent: Boolean(inputWrapper)
        });
        return;
    }

    log('Located textarea and send button.', {
        textareaSelector,
        wrapperClass: inputWrapper?.className,
        initialSendBtnClasses: sendBtn.className
    });

    await delay(100);
    await simulateInput(textarea, query);
    log('Inserted query into textarea.');
    await delay(300);
    simulateEnter(textarea);
    log('Simulated Enter key.');
    await delay(100);

    let attempts = 0;
    const maxAttempts = 80;
    let activeSendBtn = sendBtn;

    const refreshSendBtn = () => {
        const candidate = getSendButton(wrapperNode);
        if (candidate) {
            activeSendBtn = candidate;
        }
    };

    const observerRoot = wrapperNode.nodeType === Node.DOCUMENT_NODE ? wrapperNode.documentElement : wrapperNode;
    const wrapperObserver = new MutationObserver(() => {
        refreshSendBtn();
    });
    wrapperObserver.observe(observerRoot, { childList: true, subtree: true });

    while (attempts < maxAttempts) {
        if (!activeSendBtn || !activeSendBtn.isConnected) {
            refreshSendBtn();
        }

        if (activeSendBtn && !isDisabled(activeSendBtn)) {
            simulateClick(activeSendBtn);
            wrapperObserver.disconnect();
            log('Send button enabled, simulated click.');
            return;
        }
        if (attempts % 10 === 0) {
            log('Send button still disabled.', {
                attempt: attempts,
                classes: activeSendBtn?.className,
                ariaDisabled: activeSendBtn?.getAttribute('aria-disabled')
            });
        }
        attempts++;
        await delay(100);
    }

    wrapperObserver.disconnect();
    log('Send button never enabled within allotted attempts, stopping.');
})();
