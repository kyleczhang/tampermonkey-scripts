// ==UserScript==
// @name         Doubao URL Query
// @namespace    http://tampermonkey.net/
// @version      1.4.0
// @description  Submit Doubao prompts via a URL query parameter
// @author       kyleczhang
// @match        https://www.doubao.com/chat/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=doubao.com
// @license      MIT
// @downloadURL https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/doubao-url-query.js
// @updateURL   https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/doubao-url-query.js
// @run-at      document-start
// ==/UserScript==

// Capture query parameter before redirect
const savedQuery = new URLSearchParams(window.location.search).get("q");
if (savedQuery) {
  sessionStorage.setItem("doubao-query", savedQuery);
}

(async () => {
  "use strict";

  const log = (...args) => console.log("[doubao-url-query]", ...args);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitFor = (resolver, timeout) =>
    new Promise((resolve) => {
      const initial = resolver();
      if (initial) {
        resolve(initial);
        return;
      }

      const observer = new MutationObserver(() => {
        const result = resolver();
        if (result) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(result);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });

  const isVisible = (elem) =>
    !!elem &&
    elem.isConnected &&
    !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length);

  // Doubao keeps several input containers in the DOM at once (the centred one
  // on a new chat, the bottom bar inside a conversation) and swaps them as the
  // conversation starts, so always look up the visible one instead of holding
  // on to a node.
  const findEditor = () => {
    const editors = document.querySelectorAll(
      '.guidance-input-editor-wrapper [contenteditable="true"], div.ProseMirror[contenteditable="true"]',
    );
    return [...editors].find(isVisible) || null;
  };

  // Those containers duplicate the send button's id, and the button is only
  // enabled while a message is pending, so skip the disabled ones.
  const findSendBtn = () => {
    const buttons = document.querySelectorAll("#flow-end-msg-send");
    return (
      [...buttons].find(
        (btn) =>
          isVisible(btn) &&
          !btn.disabled &&
          btn.getAttribute("aria-disabled") !== "true",
      ) || null
    );
  };

  const editorText = (elem) =>
    elem ? (elem.innerText || elem.textContent || "").trim() : "";

  const selectContents = (elem, collapseToEnd) => {
    elem.focus();
    const range = document.createRange();
    range.selectNodeContents(elem);
    if (collapseToEnd) range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };

  // The editor is a TipTap/ProseMirror contenteditable: it ignores direct DOM
  // writes, but handles a synthetic paste like a real one.
  const fillEditor = async (elem, text) => {
    selectContents(elem, false);
    const data = new DataTransfer();
    data.setData("text/plain", text);
    elem.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );

    await delay(100);
    return editorText(elem) === text;
  };

  // ProseMirror binds keydown on the editable node, so a synthetic Enter
  // reaches its keymap - unlike a click, which never reached React's handler.
  const pressEnter = (elem) => {
    selectContents(elem, true);
    for (const type of ["keydown", "keypress", "keyup"]) {
      elem.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  };

  // Once the message is on its way the button is either gone (empty editor) or
  // disabled (reply streaming), so its absence means we are done.
  const waitUntilSent = async (timeout) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (!findSendBtn()) return true;
      await delay(100);
    }
    return !findSendBtn();
  };

  try {
    const query =
      sessionStorage.getItem("doubao-query") ||
      new URLSearchParams(window.location.search).get("q");
    if (!query) {
      return;
    }
    sessionStorage.removeItem("doubao-query");

    if (document.readyState !== "complete") {
      await new Promise((resolve) => {
        window.addEventListener("load", resolve, { once: true });
      });
    }

    const editor = await waitFor(findEditor, 10000);
    if (!editor) {
      log("editor not found");
      return;
    }

    await delay(100);
    if (!(await fillEditor(editor, query))) {
      log("could not fill the editor");
      return;
    }

    // Doubao renders the send button only once the editor holds text.
    if (!(await waitFor(findSendBtn, 5000))) {
      log("send button never became available");
      return;
    }

    pressEnter(editor);
    if (await waitUntilSent(1500)) {
      return;
    }

    log("Enter did not send, falling back to clicking");
    findSendBtn()?.click();
    if (!(await waitUntilSent(1500))) {
      log("failed to send");
    }
  } catch (e) {
    log("unexpected error", e);
  }
})();
