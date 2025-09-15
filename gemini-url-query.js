// ==UserScript==
// @name         Gemini query with URL
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  Add URL query string search functionality for Gemini web version, q is for query
// @match        https://gemini.google.com/app*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/gemini-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/gemini-url-query.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

/**
 * code logic:
 * - Capture ?q= at document-start.
 * - After load, find the Quill editor and the button.
 * - Insert text with execCommand, press Enter, and bail out if the editor clears.
 * - Only click when the button still looks like Send and is enabled.
 * - Keep concise logs behind a DEBUG switch.
 */

const DEBUG = true;
const L = (...a) => DEBUG && console.log('[gemini-url-query]', ...a);
const W = (...a) => DEBUG && console.warn('[gemini-url-query]', ...a);
const E = (...a) => DEBUG && console.error('[gemini-url-query]', ...a);

// Capture query parameter before redirect
try {
    const savedQuery = new URLSearchParams(window.location.search).get('q');
    if (savedQuery) {
        sessionStorage.setItem('gemini-query', savedQuery);
        L('Saved query from URL at document-start:', savedQuery);
    } else {
        L('No ?q= in initial URL at document-start.');
    }
} catch (err) {
    E('Error capturing query at document-start:', err);
}

(async () => {
    'use strict';

    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    // Insert text into Quill contenteditable
    const typeIntoEditor = async (elem, text) => {
        elem.focus();
        try { elem.innerHTML = ''; } catch { }
        try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(elem);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
            const ok = document.execCommand('insertText', false, text);
            L('execCommand insertText result:', ok);
        } catch (err) {
            W('execCommand failed, falling back:', err);
            elem.textContent = text;
        }
        try {
            elem.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
        } catch { }
        elem.dispatchEvent(new Event('input', { bubbles: true }));
        elem.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const pressEnter = (elem) => {
        elem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        elem.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
        elem.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    };

    const buttonState = (btn) => {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const icon = btn.querySelector('mat-icon, [data-mat-icon-name]');
        const iconName = (icon && (icon.getAttribute('data-mat-icon-name') || icon.getAttribute('fonticon') || icon.textContent || '')).toLowerCase();
        const disabled = btn.getAttribute('aria-disabled') === 'true' || !!btn.disabled;
        const isSend = aria.includes('send') || iconName.includes('send');
        const isStop = aria.includes('stop') || aria.includes('cancel') || iconName.includes('stop') || iconName.includes('cancel') || iconName.includes('close');
        return { isSend, isStop, disabled, aria, iconName };
    };

    const editorCleared = (ed) => ((ed.innerText || ed.textContent || '').trim().length === 0);

    // Load query
    const query = sessionStorage.getItem('gemini-query') || new URLSearchParams(window.location.search).get('q');
    if (!query) {
        L('No query found in sessionStorage or URL. Exiting.');
        return;
    }
    sessionStorage.removeItem('gemini-query');
    L('Using query:', query);

    // Wait for load.
    if (document.readyState !== 'complete') {
        L('Waiting for window.load...');
        await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    }
    L('window.load fired.');

    // Find editor and button.
    const editorSelector = 'rich-textarea .ql-editor[contenteditable="true"][role="textbox"]';
    const btnSelector = 'div.send-button-container button[aria-label]';

    let editor = document.querySelector(editorSelector);
    let sendBtn = document.querySelector(btnSelector);

    // Short poll in case Angular mounts a tick later
    const t0 = performance.now();
    while ((!editor || !sendBtn) && performance.now() - t0 < 3000) {
        if (!editor) editor = document.querySelector(editorSelector);
        if (!sendBtn) sendBtn = document.querySelector(btnSelector);
        await delay(100);
    }

    if (!editor || !sendBtn) {
        E('Editor or Send button not found.', { editor, sendBtn });
        return;
    }
    L('Found editor and button.');

    // Inject and send
    await typeIntoEditor(editor, query);
    await delay(200);
    pressEnter(editor);

    // Confirm send by watching the editor clear first
    let sent = false;
    for (let i = 0; i < 20; i++) { // about 2 seconds
        if (editorCleared(editor)) {
            L('Editor cleared, message sent.');
            sent = true;
            break;
        }
        await delay(100);
    }

    // If still not clear, check button state and click only if it still looks like Send
    if (!sent) {
        const st = buttonState(sendBtn);
        L('Post-Enter button state:', st);
        if (st.isSend && !st.disabled) {
            L('Clicking Send button.');
            sendBtn.focus();
            sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } else {
            L('Skipping click to avoid stopping generation or clicking a disabled button.');
        }
    }

    L('Done.');
})();
