// ==UserScript==
// @name         Bilibili Custom Keyboard Shortcuts
// @namespace    http://tampermonkey.net/
// @version      1.1.1
// @description  Custom Bilibili video page shortcuts: n / p go to the next / previous episode by clicking the player's native 下一个 / 上一个 buttons; 1 / 2 / 3 / 4 switch the playback rate to 1x / 1.5x / 2x / 3x through the player API, with the player's own toast as feedback; j jumps to the end of the video.
// @author       kyleczhang
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bilibili.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-custom-keyboard-shortcuts.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-custom-keyboard-shortcuts.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // Bilibili's own player control buttons. Clicking these (rather than
  // re-dispatching a key event) triggers the genuine episode-switch logic with a
  // real, trusted click and doesn't depend on the player honoring synthetic keys.
  const NEXT_SELECTOR = ".bpx-player-ctrl-next";
  const PREV_SELECTOR = ".bpx-player-ctrl-prev";

  // Key -> playback rate. 3x isn't in Bilibili's 倍速 menu, but the player API
  // accepts it and the control bar shows "3.0x".
  const RATES = {
    1: 1,
    2: 1.5,
    3: 2,
    4: 3,
  };
  const TOAST_DURATION = 1500;

  // Don't hijack shortcut keys while the user is typing somewhere.
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

  // The live player (@grant none runs in the page, so this is reachable).
  // Resolved at press time for the same SPA-remount reason as above.
  function getPlayer() {
    const player = window.player;
    return player && typeof player.setPlaybackRate === "function"
      ? player
      : null;
  }

  function showToast(player, text) {
    // The toast is cosmetic — never let it break the rate change.
    try {
      player.toast.create({ text, duration: TOAST_DURATION });
    } catch {}
  }

  function getVideo() {
    return document.querySelector(".bpx-player-video-wrap video");
  }

  function seekToEnd() {
    const video = getVideo();
    if (!video || !isFinite(video.duration)) {
      return;
    }
    // Land exactly on the end so the player treats the video as finished
    // (and auto-plays the next episode if that's switched on).
    video.currentTime = video.duration;
  }

  function setRate(rate) {
    const player = getPlayer();
    if (player) {
      // Goes through the player's setting store, so the 倍速 button label and
      // menu highlight stay in sync.
      player.setPlaybackRate(rate);
      showToast(player, "倍速 " + rate + "x");
      return;
    }
    // Player API not available — fall back to the raw media element.
    const video = getVideo();
    if (video) {
      video.playbackRate = rate;
    }
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
      } else if (key === "j") {
        seekToEnd();
      } else if (RATES[key] !== undefined) {
        // e.key covers both the top-row digits and the numpad.
        setRate(RATES[key]);
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
