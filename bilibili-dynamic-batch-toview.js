// ==UserScript==
// @name         Bilibili Dynamic Batch Add To Watch Later
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  在 B 站动态页(t.bilibili.com)的每个"投稿了视频"卡片上加一个按钮，点击后把该卡片及其以上的所有投稿视频一键加入稍后再看（带速率控制）。
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

  // 每次添加之间的间隔(毫秒)。B 站对该接口有频控，留出余量避免被限流。
  const ADD_INTERVAL_MS = 800;

  const TOVIEW_ADD_URL = "https://api.bilibili.com/x/v2/history/toview/add";
  const TOVIEW_DEL_URL = "https://api.bilibili.com/x/v2/history/toview/del";
  const VIEW_URL = "https://api.bilibili.com/x/web-interface/view";

  // 标记位：避免对同一卡片重复插入按钮。
  const BTN_FLAG = "data-batch-toview-injected";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 从 cookie 中读取 bili_jct，作为 csrf token。该 cookie 设置在 .bilibili.com
  // 上，因此在 t.bilibili.com 也能读到。
  function getCsrf() {
    const m = document.cookie.match(/(?:^|;\s*)bili_jct=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  // 判断一个动态卡片是否是"自己投稿的视频"，是则返回该视频的 BV 号，否则返回 null。
  //
  // 关键区分点：
  //  - 投稿视频(目标): .bili-dyn-content 下有非 .reference 的 __orig，其中含
  //    a.bili-dyn-card-video，href 形如 //www.bilibili.com/video/BVxxxx/
  //  - 视频转载/转发动态: __orig 带 .reference 类(转载他人内容) -> 排除
  //  - 直播了: 用的是 a.bili-dyn-card-live 而非 card-video -> 排除
  //  - 图文/转发文字: 没有 a.bili-dyn-card-video -> 排除
  function getOwnVideoBvid(item) {
    const content = item.querySelector(
      ".bili-dyn-item__body .bili-dyn-content",
    );
    if (!content) return null;

    // 只看 content 的直接子级 __orig，并且不能是转载(reference)。
    const orig = content.querySelector(":scope > .bili-dyn-content__orig");
    if (!orig || orig.classList.contains("reference")) return null;

    const link = orig.querySelector(
      ":scope > .bili-dyn-content__orig__major a.bili-dyn-card-video",
    );
    if (!link) return null;

    const href = link.getAttribute("href") || "";
    const m = href.match(/\/video\/(BV[0-9A-Za-z]+)/);
    return m ? m[1] : null;
  }

  // 用 GM_xmlhttpRequest 发一次带 cookie 的请求(避免跨域)，返回解析后的 JSON。
  function gmRequest(method, url, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: body
          ? {
              "Content-Type":
                "application/x-www-form-urlencoded; charset=UTF-8",
            }
          : {},
        data: body,
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(new Error("解析响应失败: " + res.responseText));
          }
        },
        onerror: () => reject(new Error("请求失败")),
        ontimeout: () => reject(new Error("请求超时")),
      });
    });
  }

  function toviewPost(url, paramKey, paramValue) {
    const csrf = getCsrf();
    const body =
      `${paramKey}=${encodeURIComponent(paramValue)}` +
      `&csrf=${encodeURIComponent(csrf)}`;
    return gmRequest("POST", url, body);
  }

  // 批量添加用 bvid(接口同时支持 aid/bvid，省去 BV->AV 转换)。
  function addToView(bvid) {
    return toviewPost(TOVIEW_ADD_URL, "bvid", bvid);
  }

  // 单个按钮的加/删用 aid(与接口 payload 截图一致)。
  function addToViewByAid(aid) {
    return toviewPost(TOVIEW_ADD_URL, "aid", aid);
  }

  function delFromViewByAid(aid) {
    return toviewPost(TOVIEW_DEL_URL, "aid", aid);
  }

  // 解析 bvid 对应的 aid(del 接口需要 aid)。结果缓存在卡片元素上，避免重复请求。
  async function resolveAid(item, bvid) {
    if (item.dataset.aid) return item.dataset.aid;
    const json = await gmRequest(
      "GET",
      `${VIEW_URL}?bvid=${encodeURIComponent(bvid)}`,
    );
    if (json && json.code === 0 && json.data && json.data.aid) {
      item.dataset.aid = String(json.data.aid);
      return item.dataset.aid;
    }
    throw new Error("获取 aid 失败: " + JSON.stringify(json));
  }

  // 收集"当前卡片及其以上"的所有投稿视频 BV 号(按页面从上到下顺序，去重)。
  function collectBvidsUpToAndIncluding(item) {
    const all = Array.from(document.querySelectorAll(".bili-dyn-list__item"));
    const idx = all.indexOf(item);
    if (idx === -1) return [];

    const bvids = [];
    const seen = new Set();
    for (let i = 0; i <= idx; i++) {
      const bvid = getOwnVideoBvid(all[i]);
      if (bvid && !seen.has(bvid)) {
        seen.add(bvid);
        bvids.push(bvid);
      }
    }
    return bvids;
  }

  async function handleClick(button, item) {
    const csrf = getCsrf();
    if (!csrf) {
      alert("未检测到登录状态(bili_jct)，请先登录 B 站。");
      return;
    }

    const bvids = collectBvidsUpToAndIncluding(item);
    if (bvids.length === 0) {
      alert("未找到可添加的投稿视频。");
      return;
    }

    if (
      !window.confirm(
        `将把上方(含当前)共 ${bvids.length} 个投稿视频添加到稍后再看，是否继续？`,
      )
    ) {
      return;
    }

    const originalText = button.textContent;
    button.dataset.busy = "1";

    let ok = 0;
    let fail = 0;
    for (let i = 0; i < bvids.length; i++) {
      button.textContent = `添加中 ${i + 1}/${bvids.length}`;
      try {
        const res = await addToView(bvids[i]);
        if (res && res.code === 0) {
          ok++;
        } else {
          fail++;
          console.warn("[batch-toview] 添加失败", bvids[i], res);
        }
      } catch (e) {
        fail++;
        console.error("[batch-toview] 添加出错", bvids[i], e);
      }
      if (i < bvids.length - 1) {
        await sleep(ADD_INTERVAL_MS);
      }
    }

    button.textContent = `完成 ✓${ok}${fail ? ` ✗${fail}` : ""}`;
    delete button.dataset.busy;
    setTimeout(() => {
      button.textContent = originalText;
    }, 4000);
  }

  // 按是否已加入稍后再看，切换单个按钮的文案与配色。
  function setSingleState(button, added) {
    button.dataset.added = added ? "1" : "";
    button.textContent = added ? "已添加" : "稍后再看";
    button.style.background = added ? "#999" : "#00aeec";
  }

  // 单个按钮：未添加则加入稍后再看，已添加则移除(再次点击)。
  async function handleSingleClick(button, item) {
    const csrf = getCsrf();
    if (!csrf) {
      alert("未检测到登录状态(bili_jct)，请先登录 B 站。");
      return;
    }

    const bvid = getOwnVideoBvid(item);
    if (!bvid) {
      alert("未找到该视频。");
      return;
    }

    const wasAdded = button.dataset.added === "1";
    button.dataset.busy = "1";
    button.textContent = wasAdded ? "移除中…" : "添加中…";

    try {
      // del 接口需要 aid；add 也用 aid，保持一致并与 payload 截图相符。
      const aid = await resolveAid(item, bvid);
      const res = wasAdded
        ? await delFromViewByAid(aid)
        : await addToViewByAid(aid);
      if (res && res.code === 0) {
        setSingleState(button, !wasAdded);
      } else {
        console.warn("[batch-toview] 操作失败", bvid, res);
        button.textContent = "失败 ✗";
        setTimeout(() => setSingleState(button, wasAdded), 2000);
      }
    } catch (e) {
      console.error("[batch-toview] 操作出错", bvid, e);
      button.textContent = "失败 ✗";
      setTimeout(() => setSingleState(button, wasAdded), 2000);
    }

    delete button.dataset.busy;
  }

  function makeButton(text, bgColor, title, onClick) {
    const button = document.createElement("button");
    button.textContent = text;
    button.title = title;
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

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (button.dataset.busy) return;
      onClick(button);
    });

    return button;
  }

  // 给所有尚未处理过的投稿视频卡片插入按钮。
  function enhance() {
    const items = document.querySelectorAll(".bili-dyn-list__item");
    items.forEach((item) => {
      if (item.hasAttribute(BTN_FLAG)) return;
      const bvid = getOwnVideoBvid(item);
      if (!bvid) return;

      item.setAttribute(BTN_FLAG, "1");

      const singleBtn = makeButton("稍后再看", "#00aeec", "", (btn) =>
        handleSingleClick(btn, item),
      );
      const batchBtn = makeButton(
        "⬆️ 全部添加",
        "#fb7299",
        "把当前及以上的所有投稿视频加入稍后再看",
        (btn) => handleClick(btn, item),
      );

      // 把两个按钮放进一个容器，单个在左、批量在右。
      const group = document.createElement("div");
      group.style.cssText = "display:flex;gap:8px;align-items:center";
      group.appendChild(singleBtn);
      group.appendChild(batchBtn);

      const footer = item.querySelector(".bili-dyn-item__footer");
      if (footer) {
        // footer 是 flex 行，margin-left:auto 会把按钮组推到最右侧。
        group.style.marginLeft = "auto";
        footer.appendChild(group);
      } else {
        // 兜底：直接挂到卡片主体下方。
        const main = item.querySelector(".bili-dyn-item__main") || item;
        group.style.margin = "8px 0 0";
        main.appendChild(group);
      }
    });
  }

  // 初次扫描 + 监听动态列表变化(无限滚动加载更多卡片)。
  function init() {
    enhance();

    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      // 合并短时间内的多次变更，降低开销。
      setTimeout(() => {
        scheduled = false;
        enhance();
      }, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
