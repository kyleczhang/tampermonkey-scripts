// ==UserScript==
// @name         YouTube Custom Keyboard Shortcuts
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Custom YouTube shortcuts: [ / ] adjust speed by 0.25, \ toggles between 1.0x and the last non-1.0x speed, ' and ; seek forward/backward, - and = fast-forward 1 / 10 minutes. Triggers YouTube's native feedback animations by simulating its native shortcuts.
// @author       kyleczhang
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/youtube-custom-keyboard-shortcuts.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/youtube-custom-keyboard-shortcuts.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const SPEED_STEP = 0.25;
  const DEFAULT_TOGGLE_RATE = 2.0;
  const KEY_DELAY_MS = 60; // delay between a silent set and the simulated native key

  // The last non-1.0x speed remembered for the `\` toggle.
  let savedRate = null;

  // ---- Element helpers -------------------------------------------------

  function getVideo() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector("video")
    );
  }

  function getPlayer() {
    // The YouTube player exposes getPlaybackRate / setPlaybackRate.
    return (
      document.getElementById("movie_player") ||
      document.querySelector(".html5-video-player")
    );
  }

  function getRate() {
    const player = getPlayer();
    if (player && typeof player.getPlaybackRate === "function") {
      return player.getPlaybackRate();
    }
    const video = getVideo();
    return video ? video.playbackRate : 1.0;
  }

  // Silently change the speed without triggering YouTube's animation.
  // Prefer the player API so YouTube's internal speed state stays in sync,
  // which lets a following native-shortcut step increment correctly.
  function setRateSilently(rate) {
    const player = getPlayer();
    if (player && typeof player.setPlaybackRate === "function") {
      player.setPlaybackRate(rate);
      return;
    }
    const video = getVideo();
    if (video) {
      video.playbackRate = rate;
    }
  }

  // ---- Native shortcut simulation --------------------------------------

  // Simulate one of YouTube's native keyboard shortcuts so the player runs
  // its real handler and shows the native feedback animation.
  function simulateNativeKey({ key, code, keyCode, shiftKey = false }) {
    const target = getVideo() || document;
    const init = {
      key,
      code,
      keyCode,
      which: keyCode,
      shiftKey,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // Shift + ,  ->  decrease speed by 0.25 (native)
  function simulateSpeedDown() {
    simulateNativeKey({
      key: "<",
      code: "Comma",
      keyCode: 188,
      shiftKey: true,
    });
  }

  // Shift + .  ->  increase speed by 0.25 (native)
  function simulateSpeedUp() {
    simulateNativeKey({
      key: ">",
      code: "Period",
      keyCode: 190,
      shiftKey: true,
    });
  }

  // ArrowRight -> seek forward (native)
  function simulateSeekForward() {
    simulateNativeKey({ key: "ArrowRight", code: "ArrowRight", keyCode: 39 });
  }

  // ArrowLeft -> seek backward (native)
  function simulateSeekBackward() {
    simulateNativeKey({ key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 });
  }

  // Seek forward/backward by an arbitrary number of seconds. There is no
  // native shortcut for large jumps, so adjust currentTime directly.
  function seekBySeconds(seconds) {
    const video = getVideo();
    if (!video) {
      return;
    }
    const duration = Number.isFinite(video.duration)
      ? video.duration
      : Infinity;
    const target = Math.min(Math.max(video.currentTime + seconds, 0), duration);
    const player = getPlayer();
    if (player && typeof player.seekTo === "function") {
      player.seekTo(target, true);
    } else {
      video.currentTime = target;
    }
  }

  // ---- Speed change to an arbitrary target (hybrid approach) -----------

  // Change speed to `target`. If the gap is a single 0.25 step, simulate one
  // native shortcut (single animation). If the gap is larger, silently jump
  // to the adjacent step first, then simulate exactly one native shortcut so
  // only a single native animation is shown.
  function changeRateTo(target) {
    const current = getRate();
    const diff = Math.round((target - current) / SPEED_STEP);

    if (diff === 0) {
      return; // already at target, do nothing
    }

    const stepUp = diff > 0;

    if (Math.abs(diff) === 1) {
      // Only one step away: just simulate the native shortcut directly.
      if (stepUp) {
        simulateSpeedUp();
      } else {
        simulateSpeedDown();
      }
      return;
    }

    // More than one step away: silently set to the adjacent step, then
    // simulate a single native shortcut for the final step.
    const adjacent = stepUp ? target - SPEED_STEP : target + SPEED_STEP;
    setRateSilently(adjacent);
    setTimeout(() => {
      if (stepUp) {
        simulateSpeedUp();
      } else {
        simulateSpeedDown();
      }
    }, KEY_DELAY_MS);
  }

  // `\` toggle between 1.0x and the last non-1.0x speed.
  function toggleRate() {
    const current = getRate();

    if (Math.abs(current - 1.0) > 0.001) {
      // Currently not 1.0x: remember it and switch to 1.0x.
      savedRate = current;
      changeRateTo(1.0);
    } else {
      // Currently 1.0x: restore the saved speed, or fall back to 2.0x.
      const target = savedRate != null ? savedRate : DEFAULT_TOGGLE_RATE;
      changeRateTo(target);
    }
  }

  // ---- Input-focus guard -----------------------------------------------

  function isTypingTarget(el) {
    if (!el) {
      return false;
    }
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      return true;
    }
    if (el.isContentEditable) {
      return true;
    }
    return false;
  }

  // ---- Keyboard handling -----------------------------------------------

  document.addEventListener(
    "keydown",
    function (event) {
      // Ignore when modifier keys are held so we don't clash with other shortcuts.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      // Don't interfere while the user is typing.
      if (
        isTypingTarget(event.target) ||
        isTypingTarget(document.activeElement)
      ) {
        return;
      }

      switch (event.key) {
        case "[":
          event.preventDefault();
          simulateSpeedDown();
          break;
        case "]":
          event.preventDefault();
          simulateSpeedUp();
          break;
        case "\\":
          event.preventDefault();
          toggleRate();
          break;
        case "'":
          event.preventDefault();
          simulateSeekForward();
          break;
        case ";":
          event.preventDefault();
          simulateSeekBackward();
          break;
        case "-":
          event.preventDefault();
          seekBySeconds(60); // fast-forward 1 minute
          break;
        case "=":
          event.preventDefault();
          seekBySeconds(600); // fast-forward 10 minutes
          break;
        default:
          break;
      }
    },
    true,
  );
})();
