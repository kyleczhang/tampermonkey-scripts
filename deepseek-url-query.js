// ==UserScript==
// @name         DeepSeek URL Query
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  Submit DeepSeek prompts via a URL query parameter
// @author       kyleczhang
// @match        https://chat.deepseek.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=deepseek.com
// @license      MIT
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/deepseek-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/deepseek-url-query.js
// @run-at       document-start
// ==/UserScript==

const QUERY_KEY = "cq";
const STORAGE_QUERY_KEY = "deepseek-url-query-cq";
const LOG_PREFIX = "[DeepSeek URL Query]";
const COMPOSER_SELECTORS = [
  "textarea#chat-input",
  'textarea[placeholder*="DeepSeek"]',
  "textarea.ds-scroll-area",
  "textarea",
];
// The send button is the only round primary button on the page. DeepSeek's
// hashed class names (e.g. `.bf38813a`) change between builds, so they are only
// used as a fallback anchor.
const SEND_BUTTON_SELECTORS = [
  'div[role="button"].ds-button--primary.ds-button--circle',
  '.bf38813a div[role="button"].ds-button--circle',
];
const SEND_BUTTON_ROW_SELECTOR = '.bf38813a div[role="button"]';

const immediateParams = new URLSearchParams(window.location.search);
const immediateQuery = immediateParams.get(QUERY_KEY);

if (immediateQuery) {
  // Preserve the query across redirects or SPA transitions.
  sessionStorage.setItem(STORAGE_QUERY_KEY, immediateQuery);
  console.log(LOG_PREFIX, "Query found in URL and cached");
}

(async () => {
  "use strict";

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitFor = (resolverOrSelector, options = {}) => {
    const { timeout = 15000, root = document } = options;
    const resolver =
      typeof resolverOrSelector === "function"
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

      const observerRoot =
        root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
      const observer = new MutationObserver(check);
      if (observerRoot) {
        observer.observe(observerRoot, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      }

      const poller = setInterval(check, 50);
      const timer = setTimeout(() => finish(null), timeout);
    });
  };

  const isVisible = (elem) => {
    if (!elem) return false;
    const style = window.getComputedStyle(elem);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
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
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;

  const dispatchInputEvents = (elem) => {
    const value = elem.value || "";
    try {
      elem.dispatchEvent(
        new InputEvent("input", { bubbles: true, composed: true, data: value }),
      );
    } catch (_) {
      elem.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    elem.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  };

  const setComposerText = (elem, text) => {
    elem.focus();
    const setter = getNativeTextareaValueSetter();
    if (setter) {
      setter.call(elem, "");
      setter.call(elem, text);
    } else {
      elem.value = text;
    }
    dispatchInputEvents(elem);
  };

  const isComposerEmpty = (elem) => !(elem.value || "").trim();

  const simulateEnter = (elem) => {
    const eventInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    elem.dispatchEvent(new KeyboardEvent("keydown", eventInit));
    elem.dispatchEvent(new KeyboardEvent("keypress", eventInit));
    elem.dispatchEvent(new KeyboardEvent("keyup", eventInit));
  };

  const simulateClick = (elem) => {
    elem.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    elem.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
    );
    elem.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  };

  // DeepSeek marks the button disabled while the composer is empty and while a
  // reply is streaming, so this doubles as the "already sending" guard.
  const isDisabled = (elem) =>
    !elem ||
    elem.disabled === true ||
    elem.getAttribute("aria-disabled") === "true" ||
    elem.classList.contains("ds-button--disabled");

  const findSendButton = () => {
    for (const selector of SEND_BUTTON_SELECTORS) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(
        isVisible,
      );
      if (candidates.length) return candidates[candidates.length - 1];
    }
    // Last resort: the trailing button of the composer's action row. The
    // attachment button is a capsule, the send button is not.
    const row = Array.from(
      document.querySelectorAll(SEND_BUTTON_ROW_SELECTOR),
    ).filter(isVisible);
    for (let i = row.length - 1; i >= 0; i--) {
      if (!row[i].classList.contains("ds-button--capsule")) return row[i];
    }
    return null;
  };

  const isSendButtonReady = (button) => Boolean(button) && !isDisabled(button);

  const params = new URLSearchParams(window.location.search);
  const query =
    sessionStorage.getItem(STORAGE_QUERY_KEY) || params.get(QUERY_KEY);

  if (!query) {
    console.log(LOG_PREFIX, "No query found, exiting");
    return;
  }

  console.log(LOG_PREFIX, "Processing query");
  sessionStorage.removeItem(STORAGE_QUERY_KEY);

  const cleanUrl = new URL(window.location.href);
  if (cleanUrl.searchParams.has(QUERY_KEY)) {
    cleanUrl.searchParams.delete(QUERY_KEY);
    window.history.replaceState({}, document.title, cleanUrl.toString());
  }

  console.log(LOG_PREFIX, "Waiting for composer");
  const composer = await waitFor(findComposer, { timeout: 30000 });
  if (!composer) {
    console.log(LOG_PREFIX, "Composer not found, exiting");
    return;
  }

  setComposerText(composer, query);
  console.log(LOG_PREFIX, "Composer filled");

  console.log(LOG_PREFIX, "Waiting for send button");
  const readySendButton = await waitFor(
    () => {
      const button = findSendButton();
      return isSendButtonReady(button) ? button : null;
    },
    { timeout: 10000 },
  );

  if (!readySendButton) {
    console.log(LOG_PREFIX, "Send button never became ready, sending anyway");
  }

  // Enter first; DeepSeek clears the composer once the message is on its way.
  composer.focus();
  await delay(50);
  simulateEnter(composer);

  // Backup click only if Enter left the text sitting in the composer.
  await delay(250);
  if (!isComposerEmpty(composer)) {
    const button = findSendButton();
    if (isSendButtonReady(button)) {
      console.log(LOG_PREFIX, "Enter did not send, clicking the send button");
      simulateClick(button);
      await delay(400);
    }
  }

  console.log(
    LOG_PREFIX,
    isComposerEmpty(composer) ? "Query sent" : "Query may not have been sent",
  );
})();
