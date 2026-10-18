// ==UserScript==
// @name         Bilibili Playback Mode Toggle
// @namespace    http://tampermonkey.net/
// @version      1.0.1
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

  // The live player (@grant none runs in the page, so this is reachable). Its
  // in-memory value is what decides what happens when a video ends — the
  // settings-panel radio can be stale, and localStorage is only read on init.
  function getPlayer() {
    const player = window.player;
    return player && typeof player.setHandoff === "function" ? player : null;
  }

  function readHandoff() {
    const player = getPlayer();
    if (player) {
      return player.getHandoff();
    }
    // Player not mounted yet — show what it will load.
    const profile = readProfile();
    const handoff = profile.media && profile.media.handoff;
    return typeof handoff === "number" ? handoff : HANDOFF_AUTO;
  }

  function setHandoff(value) {
    const player = getPlayer();
    if (player) {
      // Updates the running player, which persists to localStorage itself.
      player.setHandoff(value);
      return;
    }
    // Player not mounted yet — persist it so the player picks it up on init.
    const profile = readProfile();
    profile.media = { ...profile.media, handoff: value };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  }

  // Paint the current state into the toolbar item. Only mutates the DOM when
  // the value actually changed (tracked via dataset) to avoid churn.
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
      setHandoff(readHandoff() === HANDOFF_STOP ? HANDOFF_AUTO : HANDOFF_STOP);
      render(item);
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
