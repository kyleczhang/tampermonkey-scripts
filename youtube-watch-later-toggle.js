// ==UserScript==
// @name         YouTube Watch Later Toggle
// @namespace    http://tampermonkey.net/
// @version      1.2.1
// @description  Show whether the current YouTube video is in Watch Later with a button next to the video actions, and toggle it by clicking the button or pressing Shift+W. Also hides YouTube's Download button from the actions row.
// @author       kyleczhang
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/youtube-watch-later-toggle.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/youtube-watch-later-toggle.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const LOG = "[YouTube Watch Later]";
  const WL = "WL"; // the Watch Later playlist id
  const BUTTON_ID = "wl-shortcut-btn";

  // Single source of truth. `inWatchLater` is true / false, or null while unknown;
  // `loading` is true while the initial status read is in flight.
  const state = { videoId: null, inWatchLater: null, loading: false };

  // ---------- generic helpers ----------

  const getVideoId = () =>
    location.pathname === "/watch"
      ? new URLSearchParams(location.search).get("v")
      : null;

  const isDarkTheme = () =>
    document.documentElement.hasAttribute("dark") ||
    matchMedia("(prefers-color-scheme: dark)").matches;

  const isEditable = (el) =>
    el?.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName);

  const setAttr = (el, name, value) =>
    value == null ? el.removeAttribute(name) : el.setAttribute(name, value);

  // Resolve the first truthy resolver() result via a MutationObserver, or null on timeout.
  const waitFor = (resolver, timeout = 10000) =>
    new Promise((resolve) => {
      const found = resolver();
      if (found) return resolve(found);

      const observer = new MutationObserver(() => {
        const result = resolver();
        if (!result) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(result);
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });

  // ---------- YouTube InnerTube API ----------

  const getCookie = (name) =>
    document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"))?.[1];

  const sha1Hex = async (input) => {
    const digest = await crypto.subtle.digest(
      "SHA-1",
      new TextEncoder().encode(input),
    );
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  };

  // The SAPISIDHASH header YouTube uses to authenticate same-origin API calls.
  const authHeader = async () => {
    const sapisid =
      getCookie("SAPISID") ??
      getCookie("__Secure-3PAPISID") ??
      getCookie("__Secure-1PAPISID");
    if (!sapisid) return null;
    const origin = "https://www.youtube.com";
    const time = Math.floor(Date.now() / 1000);
    return `SAPISIDHASH ${time}_${await sha1Hex(`${time} ${sapisid} ${origin}`)}`;
  };

  // POST to an InnerTube endpoint using the page's own API key + context and cookie auth.
  const callInnerTube = async (path, body) => {
    const apiKey = window.ytcfg?.get?.("INNERTUBE_API_KEY");
    const context = window.ytcfg?.get?.("INNERTUBE_CONTEXT");
    if (!apiKey || !context) return null;

    const auth = await authHeader();
    const response = await fetch(
      `https://www.youtube.com/youtubei/v1/${path}?key=${apiKey}&prettyPrint=false`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Origin": "https://www.youtube.com",
          "X-Goog-AuthUser": String(window.ytcfg?.get?.("SESSION_INDEX") ?? 0),
          ...(auth && { Authorization: auth }),
        },
        body: JSON.stringify({ ...body, context }),
      },
    );
    if (!response.ok) {
      console.warn(LOG, "InnerTube", path, "HTTP", response.status);
      return null;
    }
    return response.json();
  };

  // Recursively collect every value stored under `key`, wherever YouTube nests it.
  const deepCollect = (node, key, out = []) => {
    if (node && typeof node === "object") {
      if (key in node) out.push(node[key]);
      Object.values(node).forEach((value) => deepCollect(value, key, out));
    }
    return out;
  };

  // ---------- Watch Later operations ----------

  // True / false for WL membership, or null when it can't be determined.
  const readWatchLaterStatus = async (videoId) => {
    try {
      const data = await callInnerTube("playlist/get_add_to_playlist", {
        videoIds: [videoId],
        excludeWatchLater: false,
      });
      if (!data) return null;
      const wl = deepCollect(data, "playlistAddToOptionRenderer").find(
        (opt) => opt.playlistId === WL,
      );
      return wl ? wl.containsSelectedVideos === "ALL" : false;
    } catch (error) {
      console.warn(LOG, "Failed to read Watch Later status", error);
      return null;
    }
  };

  // Add or remove the video through YouTube's own service request, so it runs the
  // edit with its native auth and shows the bottom-left toast.
  const dispatchWatchLater = (videoId, add) => {
    const app = document.querySelector("ytd-app");
    if (!app) return;
    const action = add
      ? { action: "ACTION_ADD_VIDEO", addedVideoId: videoId }
      : { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: videoId };
    app.dispatchEvent(
      new CustomEvent("yt-action", {
        detail: {
          actionName: "yt-service-request",
          returnValue: [],
          optionalAction: false,
          args: [
            {},
            {
              commandMetadata: {
                webCommandMetadata: {
                  sendPost: true,
                  apiUrl: "/youtubei/v1/browse/edit_playlist",
                },
              },
              playlistEditEndpoint: { playlistId: WL, actions: [action] },
            },
          ],
        },
      }),
    );
  };

  // The edit is deterministic and reliably succeeds (YouTube's toast confirms it),
  // while reading the status back lags on adds, so just reflect the target at once.
  const toggle = () => {
    const videoId = getVideoId();
    if (!videoId) return;
    state.inWatchLater = state.inWatchLater !== true;
    dispatchWatchLater(videoId, state.inWatchLater);
    render();
  };

  // ---------- button UI ----------

  const SVG_NS = "http://www.w3.org/2000/svg";

  // SVG path data for the clock (not added) and check (added) icons.
  const ICON = {
    clock:
      "M14.97 16.95 10 13.87V7h2v5.76l4.03 2.49-1.06 1.7zM22 12c0 5.51-4.49 10-10 10S2 17.51 2 12 6.49 2 12 2s10 4.49 10 10zm-2 0c0-4.41-3.59-8-8-8s-8 3.59-8 8 3.59 8 8 8 8-3.59 8-8z",
    check: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  };

  // Build an icon node from path data (innerHTML is blocked by YouTube's CSP).
  const makeIcon = (pathData) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "currentColor");
    svg.style.display = "block";
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    return svg;
  };

  // A rotating spinner, animated via the Web Animations API (no <style> injection).
  const makeSpinner = () => {
    const spinner = document.createElement("span");
    Object.assign(spinner.style, {
      width: "14px",
      height: "14px",
      boxSizing: "border-box",
      border: "2px solid currentColor",
      borderTopColor: "transparent",
      borderRadius: "50%",
    });
    spinner.animate(
      [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
      { duration: 700, iterations: Infinity },
    );
    return spinner;
  };

  const getButton = () => document.getElementById(BUTTON_ID);

  // Describe how the button should look for the current state.
  const describeButton = () => {
    const neutral = isDarkTheme()
      ? { bg: "rgba(255, 255, 255, 0.1)", fg: "#f1f1f1" }
      : { bg: "rgba(0, 0, 0, 0.05)", fg: "#0f0f0f" };

    if (state.loading)
      return {
        icon: makeSpinner(),
        text: "Watch Later",
        ...neutral,
        busy: true,
        title: "Checking Watch Later status…",
      };
    if (state.inWatchLater)
      return {
        icon: makeIcon(ICON.check),
        text: "In Watch Later",
        bg: "rgba(62, 166, 255, 0.2)",
        fg: "#3ea6ff",
        pressed: true,
        title: "Remove from Watch Later (Shift+W)",
      };
    return {
      icon: makeIcon(ICON.clock),
      text: "Watch Later",
      ...neutral,
      pressed: false,
      title: "Add to Watch Later (Shift+W)",
    };
  };

  const render = () => {
    const button = getButton();
    if (!button) return;
    const view = describeButton();

    button.querySelector(".wl-icon").replaceChildren(view.icon);
    button.querySelector(".wl-text").textContent = view.text;
    Object.assign(button.style, {
      background: view.bg,
      color: view.fg,
      opacity: view.busy ? "0.6" : "1",
      cursor: view.busy ? "default" : "pointer",
    });
    button.title = view.title;
    setAttr(button, "aria-busy", view.busy ? "true" : null);
    setAttr(button, "aria-pressed", view.busy ? null : String(view.pressed));
  };

  const createButton = () => {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
      height: "36px",
      // Fixed width sized for the longest label, so toggling never changes the
      // layout (a width change would make YouTube's menu renderer reflow/flash).
      minWidth: "150px",
      padding: "0 14px",
      marginRight: "8px",
      border: "none",
      borderRadius: "18px",
      cursor: "pointer",
      font: '500 14px/36px "Roboto", "Arial", sans-serif',
      whiteSpace: "nowrap",
    });

    const icon = document.createElement("span");
    icon.className = "wl-icon";
    Object.assign(icon.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "20px",
      height: "20px",
    });

    const text = document.createElement("span");
    text.className = "wl-text";

    button.append(icon, text);
    button.addEventListener("click", toggle);
    return button;
  };

  // Insert the button before the Like button, inline with the native actions. Its
  // width is fixed (see createButton) so toggling never reflows the menu renderer.
  const ensureButton = async () => {
    if (getButton()) return;
    const row = await waitFor(() =>
      document.querySelector("ytd-watch-metadata #top-level-buttons-computed"),
    );
    if (!row || getButton()) return;
    row.insertBefore(createButton(), row.firstChild);
    render();
  };

  // ---------- hide the native Download button ----------

  // Collapse YouTube's "Download" action (the Premium-only offline-save button)
  // out of the actions row to keep it uncluttered. A global stylesheet is used
  // instead of touching the DOM, so it keeps applying as YouTube re-renders the
  // row. Caveats: the selector matches by aria-label, which is UI-language
  // specific ("Download" in English); and because Download is a flexible item,
  // removing it lets YouTube's overflow logic pull another button in from the ⋯
  // menu to fill the freed space.
  const hideDownloadButton = () => {
    const style = document.createElement("style");
    style.textContent = `
      ytd-watch-metadata #flexible-item-buttons button[aria-label="Download"] {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).append(style);
  };

  // ---------- lifecycle ----------

  const onKeydown = (event) => {
    if (
      event.code === "KeyW" &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.repeat &&
      !isEditable(event.target) &&
      getVideoId()
    ) {
      event.preventDefault();
      toggle();
    }
  };

  // Runs on load and on every SPA navigation: ensure the button exists and, for a
  // newly opened video, read and show its real Watch Later status.
  const onPage = async () => {
    const videoId = getVideoId();
    if (!videoId) return;
    ensureButton();
    if (videoId === state.videoId) return render();

    state.videoId = videoId;
    state.inWatchLater = null;
    state.loading = true;
    render();

    const status = await readWatchLaterStatus(videoId);
    if (state.videoId === videoId) {
      state.inWatchLater = status;
      state.loading = false;
      render();
    }
  };

  document.addEventListener("keydown", onKeydown);
  document.addEventListener("yt-navigate-finish", onPage);
  hideDownloadButton();
  onPage();
})();
