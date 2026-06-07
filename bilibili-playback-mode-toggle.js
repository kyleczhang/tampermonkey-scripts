// ==UserScript==
// @name         Bilibili Playback Mode Toggle
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Add a toolbar icon on Bilibili video pages that shows and toggles the playback mode (自动切集 / 播完暂停), backed by the bpx_player_profile "media.handoff" setting (0 = auto next, 2 = stop when finished).
// @author       kyleczhang
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bilibili.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-playback-mode-toggle.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-playback-mode-toggle.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // The whole player settings panel is persisted under this single localStorage key.
  const PROFILE_KEY = "bpx_player_profile";
  // media.handoff is the "播放方式" switch: 0 = 自动切集 (auto play next), 2 = 播完暂停 (stop).
  const HANDOFF_AUTO = 0;
  const HANDOFF_STOP = 2;
  const ITEM_ID = "bili-playmode-toggle";

  // 24x24 viewBox icons, sized to 28px to match the sibling toolbar icons.
  const ICONS = {
    // 自动切集: skip-to-next glyph.
    auto: '<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"></path>',
    // 播完暂停: pause glyph.
    stop: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor"></path>',
  };

  function readProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  // The player's own radio control. Driving it (rather than just writing
  // localStorage) is what makes a toggle take effect on the *currently running*
  // player without a page reload — the player only reads localStorage on init.
  function findHandoffRadios() {
    return document.querySelectorAll(
      ".bpx-player-ctrl-setting-handoff input.bui-radio-input",
    );
  }

  function readHandoffFromUI() {
    for (const radio of findHandoffRadios()) {
      if (radio.checked) {
        const value = Number(radio.value);
        if (!Number.isNaN(value)) {
          return value;
        }
      }
    }
    return null;
  }

  function readHandoff() {
    // Prefer the live player UI; fall back to the persisted profile.
    const fromUI = readHandoffFromUI();
    if (fromUI !== null) {
      return fromUI;
    }
    const profile = readProfile();
    const handoff = profile.media && profile.media.handoff;
    return typeof handoff === "number" ? handoff : HANDOFF_AUTO;
  }

  function writeHandoffToStorage(value) {
    const profile = readProfile();
    if (!profile.media || typeof profile.media !== "object") {
      profile.media = {};
    }
    profile.media.handoff = value;
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  function setHandoff(value) {
    // Click the matching native radio so the player updates its in-memory state
    // (and persists to localStorage itself). This is what makes it work live.
    for (const radio of findHandoffRadios()) {
      if (Number(radio.value) === value) {
        radio.click();
        return;
      }
    }
    // Settings panel not mounted yet — at least persist it for the next load.
    writeHandoffToStorage(value);
  }

  // Paint the current state into an existing toolbar item. Only mutates the DOM
  // when the stored value actually changed (tracked via dataset) to avoid churn.
  function render(item) {
    const handoff = readHandoff();
    if (item.dataset.handoff === String(handoff)) {
      return;
    }
    item.dataset.handoff = String(handoff);
    const isStop = handoff === HANDOFF_STOP;
    const label = isStop ? "播完暂停" : "自动切集";
    item.title = "播放方式：" + label + "（点击切换）";
    item.innerHTML =
      '<svg width="28" height="28" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="video-toolbar-item-icon">' +
      (isStop ? ICONS.stop : ICONS.auto) +
      "</svg>" +
      '<span class="video-toolbar-item-text">' +
      label +
      "</span>";
  }

  function buildButton() {
    const wrap = document.createElement("div");
    wrap.className = "toolbar-left-item-wrap";

    const item = document.createElement("div");
    item.id = ITEM_ID;
    // Reuse Bilibili's own item classes so hover/spacing styles apply for free.
    item.className = "video-toolbar-left-item";
    item.style.cursor = "pointer";
    item.addEventListener("click", () => {
      const next = readHandoff() === HANDOFF_STOP ? HANDOFF_AUTO : HANDOFF_STOP;
      setHandoff(next);
      // Repaint after the player has processed the radio click.
      setTimeout(() => render(item), 0);
    });

    wrap.appendChild(item);
    render(item);
    return wrap;
  }

  function ensureButton() {
    const container =
      document.querySelector(".video-toolbar-left-main") ||
      document.querySelector(".video-toolbar-left");
    if (!container) {
      return;
    }

    const existing = document.getElementById(ITEM_ID);
    if (existing) {
      // Already present — just keep the label synced with the live state
      // (the user may have changed it from Bilibili's own settings panel).
      render(existing);
      return;
    }

    container.appendChild(buildButton());
  }

  // A single poll covers everything: it inserts the button once the toolbar
  // exists, re-inserts it after SPA navigation remounts the toolbar, and keeps
  // the label in sync. (A MutationObserver would fire on nearly every frame of a
  // video page for no added benefit here.)
  ensureButton();
  setInterval(ensureButton, 1000);
})();
