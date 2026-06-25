// ==UserScript==
// @name         Gemini URL Query
// @namespace    http://tampermonkey.net/
// @version      1.0.9
// @description  Submit Gemini prompts via a URL query parameter
// @author       kyleczhang
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
const L = (...a) => DEBUG && console.log("[Gemini URL Query]", ...a);
const W = (...a) => DEBUG && console.warn("[Gemini URL Query]", ...a);
const E = (...a) => DEBUG && console.error("[Gemini URL Query]", ...a);

// Capture query parameter before redirect
try {
  const savedQuery = new URLSearchParams(window.location.search).get("q");
  if (savedQuery) {
    sessionStorage.setItem("gemini-query", savedQuery);
    L("Saved query from URL at document-start:", savedQuery);
  } else {
    L("No ?q= in initial URL at document-start.");
  }
} catch (err) {
  E("Error capturing query at document-start:", err);
}

(async () => {
  "use strict";

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = (resolver, options = {}) => {
    // Resolve when resolver returns truthy, watching DOM mutations up to timeout.
    const { timeout = 5000, root = document } = options;
    return new Promise((resolve) => {
      const initial = resolver();
      if (initial) {
        resolve(initial);
        return;
      }

      const observerRoot =
        root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
      const observer = new MutationObserver(() => {
        const value = resolver();
        if (value) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(value);
        }
      });

      observer.observe(observerRoot, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  };

  // Insert text into Quill contenteditable
  const typeIntoEditor = async (elem, text) => {
    // Clear existing content first; Gemini sometimes seeds a placeholder.
    elem.focus();
    try {
      elem.innerHTML = "";
    } catch {}
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(elem);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("insertText", false, text);
      L("execCommand insertText result:", ok);
    } catch (err) {
      W("execCommand failed, falling back:", err);
      elem.textContent = text;
    }
    // Trigger Quill/react input handlers so UI state reflects the new text.
    try {
      elem.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        }),
      );
    } catch {}
    elem.dispatchEvent(new Event("input", { bubbles: true }));
    elem.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const pressEnter = (elem) => {
    // Gemini sends on Enter; mimic real key sequence to trigger handlers.
    elem.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
    elem.dispatchEvent(
      new KeyboardEvent("keypress", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
    elem.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const buttonState = (btn) => {
    // Determine whether the button is currently a Send or Stop button.
    const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
    const icon = btn.querySelector("mat-icon, [data-mat-icon-name]");
    const iconName = (
      icon &&
      (icon.getAttribute("data-mat-icon-name") ||
        icon.getAttribute("fonticon") ||
        icon.textContent ||
        "")
    ).toLowerCase();
    const disabled =
      btn.getAttribute("aria-disabled") === "true" || !!btn.disabled;
    const isSend = aria.includes("send") || iconName.includes("send");
    const isStop =
      aria.includes("stop") ||
      aria.includes("cancel") ||
      iconName.includes("stop") ||
      iconName.includes("cancel") ||
      iconName.includes("close");
    return { isSend, isStop, disabled, aria, iconName };
  };

  const editorCleared = (ed) =>
    (ed.innerText || ed.textContent || "").trim().length === 0;

  // Load query
  const query =
    sessionStorage.getItem("gemini-query") ||
    new URLSearchParams(window.location.search).get("q");
  if (!query) {
    L("No query found in sessionStorage or URL. Exiting.");
    return;
  }
  // Clear storage immediately to avoid resubmitting on refresh.
  sessionStorage.removeItem("gemini-query");
  L("Using query:", query);

  // Wait for load.
  if (document.readyState !== "complete") {
    L("Waiting for window.load...");
    await new Promise((resolve) =>
      window.addEventListener("load", resolve, { once: true }),
    );
  }
  L("window.load fired.");

  // Find editor. The send button does not exist in the empty zero-state of the
  // new UI, so we only wait for the editor here and locate the button later.
  const editorSelector =
    'rich-textarea .ql-editor[contenteditable="true"][role="textbox"]';

  // Locate the send button on demand. It only appears once the editor has text,
  // so this is called after typing. We search broadly because Gemini moves the
  // button between containers across UI revisions.
  const findSendButton = () => {
    const candidates = [
      "div.send-button-container button[aria-label]",
      'button[aria-label="Send message" i]',
      'button[aria-label="Send" i]',
    ];
    for (const sel of candidates) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }
    // Fallback: scan buttons inside the input area for a send-like one.
    const inputArea = document.querySelector("input-area-v2") || document;
    const buttons = inputArea.querySelectorAll("button[aria-label]");
    for (const btn of buttons) {
      if (buttonState(btn).isSend) return btn;
    }
    return null;
  };

  const editor = await waitFor(() => document.querySelector(editorSelector));

  if (!editor) {
    E("Editor not found.");
    return;
  }
  L("Found editor.");

  // Inject and send
  await typeIntoEditor(editor, query);
  await delay(200);
  pressEnter(editor);

  // Confirm send by watching the editor clear first
  let sent = false;
  for (let i = 0; i < 20; i++) {
    // about 2 seconds
    if (editorCleared(editor)) {
      L("Editor cleared, message sent.");
      sent = true;
      break;
    }
    await delay(100);
  }

  // If still not clear, find the send button and click only if it looks like Send
  if (!sent) {
    const sendBtn = findSendButton();
    if (!sendBtn) {
      W("Send button not found after typing; relying on Enter.");
    } else {
      const st = buttonState(sendBtn);
      L("Post-Enter button state:", st);
      if (st.isSend && !st.disabled) {
        L("Clicking Send button.");
        sendBtn.focus();
        sendBtn.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        sendBtn.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
        );
        sendBtn.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      } else {
        L(
          "Skipping click to avoid stopping generation or clicking a disabled button.",
        );
      }
    }
  }

  L("Done.");
})();
