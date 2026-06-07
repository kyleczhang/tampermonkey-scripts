// ==UserScript==
// @name         Bilibili Episode Switch Shortcut
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Press n / p on Bilibili video pages to go to the next / previous episode by clicking the player's native 下一个 / 上一个 control buttons.
// @author       kyleczhang
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bilibili.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-episode-switch-shortcut.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-episode-switch-shortcut.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // Bilibili's own player control buttons. Clicking these (rather than
  // re-dispatching a key event) triggers the genuine episode-switch logic with a
  // real, trusted click and doesn't depend on the player honoring synthetic keys.
  const NEXT_SELECTOR = ".bpx-player-ctrl-next";
  const PREV_SELECTOR = ".bpx-player-ctrl-prev";

  // Don't hijack n / p while the user is typing somewhere.
  function isTyping(el) {
    if (!el) {
      return false;
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      return true;
    }
    return (
      el.isContentEditable === true ||
      !!el.closest('[contenteditable=""], [contenteditable="true"]')
    );
  }

  function clickControl(selector) {
    // Resolve the button at press time: Bilibili is an SPA that remounts the
    // player on navigation, so a cached reference would go stale.
    const btn = document.querySelector(selector);
    if (!btn) {
      // No prev/next on a standalone video — nothing to do.
      return;
    }
    btn.click();
  }

  document.addEventListener(
    "keydown",
    (e) => {
      // Leave modifier combos to the browser / OS.
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
        return;
      }
      if (isTyping(e.target)) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === "n") {
        clickControl(NEXT_SELECTOR);
      } else if (key === "p") {
        clickControl(PREV_SELECTOR);
      } else {
        return;
      }

      // We handled it — keep the key from reaching any other handler.
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
})();
