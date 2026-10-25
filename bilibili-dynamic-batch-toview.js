// ==UserScript==
// @name         Bilibili Dynamic Batch Add To Watch Later
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  On the Bilibili 动态 feed (t.bilibili.com), adds buttons to every video-upload card: toggle that video in 稍后再看, or add it together with every video above it. Option/Alt + Shift + B enters a multi-select mode for picking any set of cards and adding them in one batch. Batch adds are rate-limited.
// @author       kyleczhang
// @match        https://t.bilibili.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bilibili.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-dynamic-batch-toview.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/bilibili-dynamic-batch-toview.js
// @grant        GM_xmlhttpRequest
// @connect      api.bilibili.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const LOG_TAG = "[batch-toview]";

  // Pause between two add requests in a batch. The 稍后再看 API is rate-limited, so leave some headroom.
  const ADD_INTERVAL_MS = 800;
  const REQUEST_TIMEOUT_MS = 10000;

  const TOVIEW_ADD_URL = "https://api.bilibili.com/x/v2/history/toview/add";
  const TOVIEW_DEL_URL = "https://api.bilibili.com/x/v2/history/toview/del";
  const VIEW_URL = "https://api.bilibili.com/x/web-interface/view";

  const ITEM_SELECTOR = ".bili-dyn-list__item";
  // A video card gets data-btv-bvid when its buttons are injected, which also marks it as processed.
  const VIDEO_ITEM_SELECTOR = `${ITEM_SELECTOR}[data-btv-bvid]`;
  const SELECTED_ITEM_SELECTOR = `${ITEM_SELECTOR}[data-btv-selected]`;
  // Toggled on <html> while multi-select mode is on.
  const SELECT_MODE_CLASS = "btv-select-mode";

  const ADD_LABEL = "加入稍后再看";

  // Only one batch runs at a time, whichever button started it, so the rate limit always holds.
  let batchBusy = false;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // bili_jct is set on .bilibili.com, so it is readable here, and it doubles as the csrf token.
  function getCsrf() {
    const m = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function ensureLoggedIn() {
    if (getCsrf()) return true;
    alert("未检测到登录状态(bili_jct)，请先登录 B 站。");
    return false;
  }

  // Returns the BV id if the card is a video its author uploaded (投稿了视频), otherwise null.
  //
  // How the card types differ:
  //  - Video upload (wanted): .bili-dyn-content has a direct __orig child without .reference, holding a.bili-dyn-card-video whose href looks like //www.bilibili.com/video/BVxxxx/
  //  - Repost of someone else's video: __orig carries .reference -> skipped
  //  - Live stream (直播了): uses a.bili-dyn-card-live instead of card-video -> skipped
  //  - Image/text posts and text reposts: no a.bili-dyn-card-video -> skipped
  function getOwnVideoBvid(item) {
    const content = item.querySelector(
      ".bili-dyn-item__body .bili-dyn-content",
    );
    const orig =
      content && content.querySelector(":scope > .bili-dyn-content__orig");
    if (!orig || orig.classList.contains("reference")) return null;

    const link = orig.querySelector(
      ":scope > .bili-dyn-content__orig__major a.bili-dyn-card-video",
    );
    const m =
      link && (link.getAttribute("href") || "").match(/\/video\/(BV\w+)/);
    return m ? m[1] : null;
  }

  // GM_xmlhttpRequest sends the site cookies and is not subject to CORS. Resolves with the parsed JSON.
  function gmRequest(method, url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        data: body,
        headers: body
          ? {
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
            }
          : {},
        // Without a timeout a hung request would stall a batch forever.
        timeout: REQUEST_TIMEOUT_MS,
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText));
          } catch {
            reject(new Error("Unparseable response: " + res.responseText));
          }
        },
        onerror: () => reject(new Error("Request failed")),
        ontimeout: () => reject(new Error("Request timed out")),
      });
    });
  }

  // Bilibili reports failures as HTTP 200 with a non-zero code, so turn those into rejections. Resolves with json.data.
  async function callApi(method, url, params) {
    const query = new URLSearchParams(params).toString();
    const json =
      method === "GET"
        ? await gmRequest("GET", `${url}?${query}`)
        : await gmRequest("POST", url, query);
    if (!json || json.code !== 0) {
      throw new Error("API error: " + JSON.stringify(json));
    }
    return json.data;
  }

  // The add endpoint takes a bvid directly.
  function addToView(bvid) {
    return callApi("POST", TOVIEW_ADD_URL, { bvid, csrf: getCsrf() });
  }

  // The del endpoint only takes an aid, so look it up first and cache it on the card.
  async function removeFromView(item) {
    if (!item.dataset.btvAid) {
      const data = await callApi("GET", VIEW_URL, {
        bvid: item.dataset.btvBvid,
      });
      item.dataset.btvAid = String(data.aid);
    }
    return callApi("POST", TOVIEW_DEL_URL, {
      aid: item.dataset.btvAid,
      csrf: getCsrf(),
    });
  }

  const getVideoItems = () =>
    Array.from(document.querySelectorAll(VIDEO_ITEM_SELECTOR));

  const getSelectedItems = () =>
    Array.from(document.querySelectorAll(SELECTED_ITEM_SELECTOR));

  // The same video can show up on more than one card (e.g. a 联合投稿 from several followed uploaders).
  const uniqueBvids = (items) => [
    ...new Set(items.map((item) => item.dataset.btvBvid)),
  ];

  const formatResult = (ok, fail) => `完成 ✓${ok}${fail ? ` ✗${fail}` : ""}`;

  function setSelected(item, selected) {
    item.toggleAttribute("data-btv-selected", selected);
  }

  // Flips a card's single button between "add" and "already added".
  function setSingleState(button, added) {
    button.dataset.added = added ? "1" : "";
    button.textContent = added ? "已添加" : "稍后再看";
    button.style.background = added ? "#999" : "#00aeec";
  }

  // Reflects a successful add on every card showing that video: its single button flips to Added and it leaves the selection, so only failed cards stay selected for a retry.
  function markAdded(bvid) {
    document
      .querySelectorAll(`${ITEM_SELECTOR}[data-btv-bvid="${bvid}"]`)
      .forEach((item) => {
        setSelected(item, false);
        const singleBtn = item.querySelector("[data-btv-single]");
        if (singleBtn) setSingleState(singleBtn, true);
      });
  }

  // Adds the videos one at a time with a pause in between. onProgress(current, total) fires before each request.
  async function addSequentially(bvids, onProgress) {
    batchBusy = true;
    updatePanel();

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < bvids.length; i++) {
      if (i > 0) await sleep(ADD_INTERVAL_MS);
      onProgress(i + 1, bvids.length);
      try {
        await addToView(bvids[i]);
        ok++;
        markAdded(bvids[i]);
      } catch (e) {
        fail++;
        console.error(LOG_TAG, "Add failed", bvids[i], e);
      }
      updatePanel();
    }

    batchBusy = false;
    updatePanel();
    return { ok, fail };
  }

  // ---------------------------------------------------------------------------
  // Per-card buttons
  // ---------------------------------------------------------------------------

  // Single button: adds the video to 稍后再看, or removes it if it was already added from here.
  async function handleSingleClick(button, item) {
    if (!ensureLoggedIn()) return;

    const wasAdded = button.dataset.added === "1";
    button.textContent = wasAdded ? "移除中…" : "添加中…";
    try {
      if (wasAdded) await removeFromView(item);
      else await addToView(item.dataset.btvBvid);
      setSingleState(button, !wasAdded);
    } catch (e) {
      console.error(
        LOG_TAG,
        wasAdded ? "Remove failed" : "Add failed",
        item.dataset.btvBvid,
        e,
      );
      button.textContent = "失败 ✗";
      await sleep(2000);
      setSingleState(button, wasAdded);
    }
  }

  // Batch button: adds this card's video and every video above it, top to bottom.
  async function handleAddAllAbove(button, item) {
    if (batchBusy || !ensureLoggedIn()) return;

    const items = getVideoItems();
    const bvids = uniqueBvids(items.slice(0, items.indexOf(item) + 1));
    if (
      !confirm(
        `将把上方(含当前)共 ${bvids.length} 个投稿视频添加到稍后再看，是否继续？`,
      )
    ) {
      return;
    }

    const originalText = button.textContent;
    const { ok, fail } = await addSequentially(bvids, (i, n) => {
      button.textContent = `添加中 ${i}/${n}`;
    });
    button.textContent = formatResult(ok, fail);
    setTimeout(() => {
      button.textContent = originalText;
    }, 4000);
  }

  function makeButton(text, bgColor, onClick) {
    const button = document.createElement("button");
    button.textContent = text;
    button.style.cssText = [
      "padding:4px 10px",
      "font-size:12px",
      "line-height:1.4",
      "color:#fff",
      `background:${bgColor}`,
      "border:none",
      "border-radius:6px",
      "cursor:pointer",
      "white-space:nowrap",
    ].join(";");

    button.addEventListener("click", async (e) => {
      // Keep the click from reaching the card, which would open the video.
      e.preventDefault();
      e.stopPropagation();
      if (button.dataset.busy) return;
      button.dataset.busy = "1";
      try {
        await onClick(button);
      } finally {
        delete button.dataset.busy;
      }
    });

    return button;
  }

  // Injects the buttons into every video card that does not have them yet.
  function enhance() {
    document
      .querySelectorAll(`${ITEM_SELECTOR}:not([data-btv-bvid])`)
      .forEach((item) => {
        const bvid = getOwnVideoBvid(item);
        if (!bvid) return;
        item.dataset.btvBvid = bvid;

        const singleBtn = makeButton("稍后再看", "#00aeec", (btn) =>
          handleSingleClick(btn, item),
        );
        singleBtn.dataset.btvSingle = "1";
        const batchBtn = makeButton("⬆️ 全部添加", "#fb7299", (btn) =>
          handleAddAllAbove(btn, item),
        );
        batchBtn.title = "把当前及以上的所有投稿视频加入稍后再看";

        const group = document.createElement("div");
        group.style.cssText = "display:flex;gap:8px;align-items:center";
        group.append(singleBtn, batchBtn);

        const footer = item.querySelector(".bili-dyn-item__footer");
        if (footer) {
          // The footer is a flex row, so margin-left:auto pushes the group to the far right.
          group.style.marginLeft = "auto";
          footer.appendChild(group);
        } else {
          // Fallback: hang the group under the card body.
          const main = item.querySelector(".bili-dyn-item__main") || item;
          group.style.margin = "8px 0 0";
          main.appendChild(group);
        }
      });

    // Infinite scroll may have loaded more cards, which changes the panel's total.
    updatePanel();
  }

  // ---------------------------------------------------------------------------
  // Multi-select mode
  // ---------------------------------------------------------------------------

  const CHECK_SVG =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

  // Material Icons: close / done_all / remove_done / watch_later.
  const ICON_PATHS = {
    close:
      "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    selectAll:
      "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z",
    clearAll:
      "M1.79 12l5.58 5.59L5.96 19 .37 13.41 1.79 12zm.45-7.78L12.9 14.89l-1.28 1.28L7.44 12l-1.41 1.41L11.62 19l2.69-2.69 4.89 4.89 1.41-1.41L3.65 2.81 2.24 4.22zm14.9 9.27L23.62 7 22.2 5.59l-6.48 6.48 1.42 1.42zM17.96 7l-1.41-1.41-3.65 3.66 1.41 1.41L17.96 7z",
    watchLater:
      "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z",
  };

  const STYLE = `
    html.${SELECT_MODE_CLASS} ${VIDEO_ITEM_SELECTOR} {
      position: relative;
      cursor: pointer;
      user-select: none;
    }
    /* In select mode, disable the card's own links, hover popups and buttons so every click lands on the card itself. */
    html.${SELECT_MODE_CLASS} ${VIDEO_ITEM_SELECTOR} > * {
      pointer-events: none;
    }
    html.${SELECT_MODE_CLASS} ${VIDEO_ITEM_SELECTOR}::after {
      content: "";
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 6;
      width: 24px;
      height: 24px;
      box-sizing: border-box;
      border: 2px solid #c9ccd0;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      pointer-events: none;
    }
    html.${SELECT_MODE_CLASS} ${VIDEO_ITEM_SELECTOR}:hover::after {
      border-color: #00aeec;
    }
    html.${SELECT_MODE_CLASS} ${SELECTED_ITEM_SELECTOR}::after {
      border-color: #00aeec;
      background: #00aeec url("${CHECK_SVG}") center / 16px no-repeat;
    }
    html.${SELECT_MODE_CLASS} ${SELECTED_ITEM_SELECTOR}::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 5;
      border: 2px solid #00aeec;
      border-radius: 6px;
      background: rgba(0, 174, 236, 0.08);
      pointer-events: none;
    }

    .btv-panel {
      position: fixed;
      left: 50%;
      bottom: 32px;
      z-index: 100000;
      display: none;
      align-items: center;
      gap: 4px;
      padding: 8px 10px;
      transform: translateX(-50%);
      background: #fff;
      color: #18191c;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
      font-size: 14px;
      white-space: nowrap;
    }
    html.${SELECT_MODE_CLASS} .btv-panel {
      display: flex;
    }
    .btv-panel__count {
      min-width: 88px;
      padding: 0 10px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .btv-panel__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: #18191c;
      cursor: pointer;
    }
    .btv-panel__icon:hover:not(:disabled) {
      background: #f1f2f3;
    }
    .btv-panel__icon svg,
    .btv-panel__add svg {
      width: 22px;
      height: 22px;
      fill: currentColor;
    }
    .btv-panel__add {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      margin-left: 6px;
      padding: 0 16px;
      border: none;
      border-radius: 18px;
      background: #00aeec;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
    }
    .btv-panel__add:hover:not(:disabled) {
      background: #00a1d6;
    }
    .btv-panel button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    /* Keep the add button readable while it shows its own batch's progress. */
    .btv-panel .btv-panel__add[data-busy] {
      opacity: 1;
    }
  `;

  // Built lazily on the first entry into select mode.
  let panel = null;
  let countEl = null;
  let selectAllBtn = null;
  let clearBtn = null;
  let addBtn = null;
  let closeBtn = null;
  // The last clicked card, used as the anchor for shift+click range selection.
  let anchorItem = null;

  const isSelectMode = () =>
    document.documentElement.classList.contains(SELECT_MODE_CLASS);

  function makeIcon(name) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.appendChild(path);
    return svg;
  }

  function makeIconButton(name, title, onClick) {
    const button = document.createElement("button");
    button.className = "btv-panel__icon";
    button.title = title;
    button.appendChild(makeIcon(name));
    button.addEventListener("click", onClick);
    return button;
  }

  function setAddLabel(text) {
    addBtn.replaceChildren(makeIcon("watchLater"), text);
  }

  function updatePanel() {
    if (!panel || !isSelectMode()) return;
    const total = getVideoItems().length;
    const selected = getSelectedItems().length;
    countEl.textContent = `${selected} / ${total} 已选`;
    closeBtn.disabled = batchBusy;
    selectAllBtn.disabled = batchBusy || selected === total;
    clearBtn.disabled = batchBusy || selected === 0;
    addBtn.disabled = batchBusy || selected === 0;
  }

  function buildPanel() {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);

    panel = document.createElement("div");
    panel.className = "btv-panel";

    closeBtn = makeIconButton("close", "退出多选 (Esc)", exitSelectMode);
    countEl = document.createElement("span");
    countEl.className = "btv-panel__count";
    selectAllBtn = makeIconButton("selectAll", "全选", () => {
      getVideoItems().forEach((item) => setSelected(item, true));
      updatePanel();
    });
    clearBtn = makeIconButton("clearAll", "取消全选", () => {
      getSelectedItems().forEach((item) => setSelected(item, false));
      updatePanel();
    });

    addBtn = document.createElement("button");
    addBtn.className = "btv-panel__add";
    addBtn.title = "把选中的视频加入稍后再看";
    setAddLabel(ADD_LABEL);
    addBtn.addEventListener("click", handleAddSelected);

    panel.append(closeBtn, countEl, selectAllBtn, clearBtn, addBtn);
    document.body.appendChild(panel);
  }

  function enterSelectMode() {
    if (!panel) buildPanel();
    document.documentElement.classList.add(SELECT_MODE_CLASS);
    updatePanel();
  }

  function exitSelectMode() {
    if (batchBusy) return;
    document.documentElement.classList.remove(SELECT_MODE_CLASS);
    getSelectedItems().forEach((item) => setSelected(item, false));
    anchorItem = null;
  }

  async function handleAddSelected() {
    if (batchBusy || !ensureLoggedIn()) return;

    const bvids = uniqueBvids(getSelectedItems());
    if (bvids.length === 0) return;

    addBtn.dataset.busy = "1";
    const { ok, fail } = await addSequentially(bvids, (i, n) =>
      setAddLabel(`添加中 ${i}/${n}`),
    );
    delete addBtn.dataset.busy;
    setAddLabel(formatResult(ok, fail));
    setTimeout(() => {
      if (!batchBusy) setAddLabel(ADD_LABEL);
    }, 3000);
  }

  // Captures card clicks before Bilibili's own handlers can open the video.
  //
  // A plain click toggles one card. Shift+click gives every video card between the anchor (the previously clicked card) and the clicked one the clicked card's new state, Gmail-style, so a range can be selected and deselected alike. Non-video cards in between are skipped.
  function onSelectClick(e) {
    if (!isSelectMode()) return;
    const item = e.target.closest(VIDEO_ITEM_SELECTOR);
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    if (batchBusy) return;

    const selected = !item.hasAttribute("data-btv-selected");
    const items = getVideoItems();
    // indexOf is -1 when there is no anchor yet or it has left the DOM (e.g. after switching feed tabs).
    const from = e.shiftKey ? items.indexOf(anchorItem) : -1;
    if (from === -1) {
      setSelected(item, selected);
    } else {
      const to = items.indexOf(item);
      const [start, end] = from < to ? [from, to] : [to, from];
      for (let i = start; i <= end; i++) setSelected(items[i], selected);
    }
    anchorItem = item;
    updatePanel();
  }

  function onKeyDown(e) {
    const target = e.target;
    if (
      target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
    ) {
      return;
    }

    // On macOS, Option+Shift+B types "ı", so match the physical key via e.code rather than e.key.
    if (
      e.code === "KeyB" &&
      e.altKey &&
      e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      e.preventDefault();
      // Holding the keys down would otherwise flicker the mode on and off.
      if (e.repeat) return;
      if (isSelectMode()) exitSelectMode();
      else enterSelectMode();
      return;
    }

    if (e.key === "Escape" && isSelectMode()) {
      e.preventDefault();
      exitSelectMode();
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  enhance();

  window.addEventListener("click", onSelectClick, true);
  window.addEventListener("keydown", onKeyDown, true);

  // Re-scan as the feed loads more cards (infinite scroll), coalescing bursts of mutations.
  let scheduled = false;
  new MutationObserver((mutations) => {
    if (scheduled) return;
    // Ignore the panel's own text updates. Since enhance() refreshes the panel, they would otherwise re-trigger this observer every cycle for as long as select mode is on.
    if (panel && mutations.every((m) => panel.contains(m.target))) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      enhance();
    }, 300);
  }).observe(document.body, { childList: true, subtree: true });
})();
