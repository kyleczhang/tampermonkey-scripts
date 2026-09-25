// ==UserScript==
// @name         ChatGPT URL Query
// @namespace    http://tampermonkey.net/
// @version      2.8.0
// @description  Submit ChatGPT prompts via a URL query parameter
// @author       kyleczhang
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chatgpt-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chatgpt-url-query.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

const QUERY_KEY = "cq";
const STORAGE_KEY = "chatgpt-url-query";
const LOG_PREFIX = "[ChatGPT URL Query]";

// The composer lives inside a <form>; scoping to it keeps us off other
// ProseMirror instances on the page (e.g. editing an earlier message).
const FORM_SELECTORS = [
  "form[data-chatgpt-composer]",
  "form[data-thread-find-composer]",
];
const COMPOSER_SELECTORS = [
  '.ProseMirror[contenteditable="true"][data-composer-markdown]',
  '[contenteditable="true"][role="textbox"]',
  '#prompt-textarea[contenteditable="true"]', // legacy builds
  'textarea[name="prompt-textarea"]', // legacy builds
];
// The primary composer button swaps between three states in the same slot:
// voice (empty) -> submit (has text) -> stop (generating). Only the send state
// is type="submit", which makes it the one locale-independent way to spot it;
// aria-label is translated and data-testid no longer exists.
const SEND_SELECTORS = [
  'button[type="submit"]',
  'button[data-testid="send-button"]', // legacy builds
];

const immediateQuery = new URLSearchParams(window.location.search).get(
  QUERY_KEY,
);
if (immediateQuery) {
  // Preserve the query across redirects or SPA reload before the UI is ready.
  console.log(LOG_PREFIX, "Query found in URL, storing:", immediateQuery);
  sessionStorage.setItem(STORAGE_KEY, immediateQuery);
}

(async () => {
  "use strict";

  /**
   * Overall flow:
   * - Load and stash the query before SPA routing.
   * - Fill the composer ASAP when it appears (don't wait for the button).
   * - After filling, wait for the enabled Send button to appear.
   * - Send, then verify; escalate through Enter -> click -> requestSubmit,
   *   re-checking "has it already gone out?" before every escalation.
   */

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitFor = (resolver, options = {}) => {
    // Resolves when resolver returns a truthy value, checking on mutations AND polling.
    // Polling ensures we catch elements that exist but are settling from animations.
    const { timeout = 5000, root = document } = options;

    return new Promise((resolve) => {
      const initial = resolver();
      if (initial) {
        resolve(initial);
        return;
      }

      let resolved = false;
      const checkAndResolve = () => {
        if (resolved) return;
        const result = resolver();
        if (result) {
          resolved = true;
          observer.disconnect();
          clearTimeout(timer);
          clearInterval(pollInterval);
          resolve(result);
        }
      };

      const observerRoot =
        root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
      const observer = new MutationObserver(checkAndResolve);
      observer.observe(observerRoot, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      // Poll every 50ms for fast detection of changes
      const pollInterval = setInterval(checkAndResolve, 50);

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          clearInterval(pollInterval);
          resolve(null);
        }
      }, timeout);
    });
  };

  const dispatchInputEvents = (elem) => {
    // Fire the same events the UI would emit so React/ProseMirror update state.
    const payload = elem.isContentEditable ? elem.textContent : elem.value;
    try {
      elem.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: payload || "" }),
      );
    } catch (_) {
      elem.dispatchEvent(new Event("input", { bubbles: true }));
    }
    elem.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const setComposerText = (elem, text) => {
    // Clear then insert text in either a rich editor or a textarea.
    elem.focus();

    if (elem.isContentEditable) {
      try {
        document.execCommand("selectAll");
        document.execCommand("delete");
      } catch (_) {
        elem.textContent = "";
      }
      try {
        if (!document.execCommand("insertText", false, text))
          elem.textContent = text;
      } catch (_) {
        elem.textContent = text;
      }
    } else if ("value" in elem) {
      elem.value = "";
      elem.value = text;
    } else {
      elem.textContent = text;
    }

    dispatchInputEvents(elem);
  };

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
    elem.focus();
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

  const isDisabled = (elem) =>
    elem?.disabled || elem?.getAttribute?.("aria-disabled") === "true";

  const isVisible = (elem) => {
    if (!elem) return false;
    const style = window.getComputedStyle(elem);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  };

  const findFirst = (selectors, root = document) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node && isVisible(node)) return node;
    }
    return null;
  };

  const findComposerForm = () => findFirst(FORM_SELECTORS);

  const findComposer = () => {
    // Prefer the composer inside the form; fall back to a page-wide lookup in
    // case the form wrapper is renamed again.
    const form = findComposerForm();
    return (
      (form && findFirst(COMPOSER_SELECTORS, form)) ||
      findFirst(COMPOSER_SELECTORS)
    );
  };

  const findSendButton = () => {
    const form = findComposerForm();
    const button =
      (form && findFirst(SEND_SELECTORS, form)) || findFirst(SEND_SELECTORS);
    return button && !isDisabled(button) ? button : null;
  };

  const composerIsEmpty = (elem) =>
    !(elem.isContentEditable ? elem.textContent : elem.value || "").trim();

  const hasBeenSent = (elem) => {
    // Once the prompt goes out, ChatGPT clears the composer and the submit
    // button is replaced by the stop/voice button. Both must hold, so we never
    // escalate into a second send while the first one is still in flight.
    if (!document.contains(elem)) return true;
    return composerIsEmpty(elem) && !findSendButton();
  };

  const waitUntilSent = (elem, timeout) =>
    waitFor(() => (hasBeenSent(elem) ? true : null), { timeout });

  const queryFromStorage = sessionStorage.getItem(STORAGE_KEY);
  const queryFromUrl = new URLSearchParams(window.location.search).get(
    QUERY_KEY,
  );
  const query = queryFromStorage || queryFromUrl;

  if (!query) {
    // Nothing to do if neither storage nor URL held a query.
    console.log(LOG_PREFIX, "No query found, exiting");
    return;
  }

  console.log(LOG_PREFIX, "Processing query:", query);

  sessionStorage.removeItem(STORAGE_KEY);

  const cleanedUrl = new URL(window.location.href);
  if (cleanedUrl.searchParams.has(QUERY_KEY)) {
    // Remove the transient query param so the URL stays clean after submission.
    cleanedUrl.searchParams.delete(QUERY_KEY);
    window.history.replaceState({}, document.title, cleanedUrl.toString());
  }

  if (!document.documentElement) {
    // waitFor observes documentElement, so make sure it exists. We deliberately
    // do NOT wait for "load" — the composer is usually interactive well before
    // ChatGPT finishes fetching everything else.
    await new Promise((resolve) => {
      document.addEventListener("readystatechange", resolve, { once: true });
    });
  }

  // STEP 1: Wait for composer and fill it ASAP (don't wait for button)
  console.log(LOG_PREFIX, "Waiting for composer...");
  const composer = await waitFor(findComposer, { timeout: 20000 });
  if (!composer) {
    // Do not hang forever—silently exit so the page works normally.
    console.log(LOG_PREFIX, "Composer not found, exiting");
    return;
  }

  console.log(LOG_PREFIX, "Composer found, filling text");
  setComposerText(composer, query);

  // STEP 2: Wait for the send button to appear. The composer button starts as
  // voice input and only becomes a submit button once React sees the text.
  console.log(LOG_PREFIX, "Text filled, waiting for send button");
  const sendButton = await waitFor(findSendButton, { timeout: 8000 });
  console.log(
    LOG_PREFIX,
    sendButton
      ? "Send button is ready"
      : "Send button never appeared, sending blind",
  );

  // STEP 3: Send, verifying after each attempt instead of guessing at delays.
  const activeComposer = findComposer() || composer;
  activeComposer.focus();

  console.log(LOG_PREFIX, "Simulating Enter key press");
  simulateEnter(activeComposer);
  if (await waitUntilSent(activeComposer, 1200)) {
    console.log(LOG_PREFIX, "Sent via Enter key");
    return;
  }

  const clickable = findSendButton();
  if (clickable) {
    console.log(LOG_PREFIX, "Enter did not send, clicking send button");
    simulateClick(clickable);
    if (await waitUntilSent(activeComposer, 1200)) {
      console.log(LOG_PREFIX, "Sent via send button");
      return;
    }
  }

  const form = findComposerForm();
  if (form && findSendButton() && typeof form.requestSubmit === "function") {
    console.log(LOG_PREFIX, "Click did not send, submitting the form directly");
    form.requestSubmit(findSendButton());
    if (await waitUntilSent(activeComposer, 1200)) {
      console.log(LOG_PREFIX, "Sent via form submit");
      return;
    }
  }

  console.log(
    LOG_PREFIX,
    "Could not confirm the prompt was sent; leaving the text in the composer",
  );
})();
