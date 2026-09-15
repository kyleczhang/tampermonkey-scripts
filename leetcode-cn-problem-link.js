// ==UserScript==
// @name         LeetCode CN Problem Link
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Add a globe button to the right of the Ask Leet icon on a leetcode.com problem page that opens the same problem on leetcode.cn in a new tab.
// @author       kyleczhang
// @match        https://leetcode.com/problems/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=leetcode.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/leetcode-cn-problem-link.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/leetcode-cn-problem-link.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const LOG_TAG = "[LeetCode CN Link]";
  const BUTTON_ID = "leetcode-cn-problem-link";
  const CN_ORIGIN = "https://leetcode.cn";

  // 16x16 outline globe (circle + equator + meridian), stroked in currentColor
  // so it picks up the same grey / dark-mode colour as the sibling icons.
  const GLOBE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" ' +
    'width="1em" height="1em" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" ' +
    'class="h-4 w-4">' +
    '<circle cx="8" cy="8" r="6.25"></circle>' +
    '<path d="M1.75 8h12.5"></path>' +
    '<path d="M8 1.75c1.85 1.7 2.9 3.85 2.9 6.25S9.85 12.55 8 14.25' +
    'C6.15 12.55 5.1 10.4 5.1 8S6.15 3.45 8 1.75z"></path>' +
    "</svg>";

  // leetcode.com and leetcode.cn use the same English problem slug, so the
  // whole mapping is origin + slug. The tab under the problem is kept when
  // leetcode.cn has the same one; anything else (including /editorial/, which
  // is /solutions/ over there) falls back to the description tab.
  const TAB_MAP = {
    description: "description",
    solutions: "solutions",
    submissions: "submissions",
    editorial: "solutions",
  };

  // -- URL helpers ---------------------------------------------------------

  // ["two-sum", "description"] for /problems/two-sum/description/, or null when
  // the current page isn't a problem page.
  function parseProblemPath() {
    const match = location.pathname.match(/^\/problems\/([^/]+)(?:\/([^/]+))?/);
    if (!match) {
      return null;
    }
    return { slug: match[1], tab: match[2] || "" };
  }

  function buildCnUrl() {
    const problem = parseProblemPath();
    if (!problem) {
      return null;
    }
    const tab = TAB_MAP[problem.tab] || "description";
    return CN_ORIGIN + "/problems/" + problem.slug + "/" + tab + "/";
  }

  // -- Button injection ----------------------------------------------------

  // The Ask Leet icon's wrapper: our button becomes its next sibling so it sits
  // at the far right of the #ide-top-btns row. `.ai-agent-guide` is the stable
  // hook LeetCode puts on that wrapper; the aria-label is the fallback.
  function findAnchor() {
    const topBar = document.getElementById("ide-top-btns");
    if (!topBar) {
      return null;
    }
    const guide = topBar.querySelector(".ai-agent-guide");
    if (guide) {
      return guide;
    }
    const askLeet = topBar.querySelector('[aria-label="Ask Leet"]');
    // Walk up from the clickable div to the rounded pill wrapper (grandparent),
    // which is the element the Note / Ask Leet pills are siblings at.
    return askLeet ? askLeet.parentElement?.parentElement || null : null;
  }

  // Mirrors the markup of the Ask Leet pill so the size, padding, rounding,
  // background and hover state come from LeetCode's own classes.
  function buildButton(href) {
    const wrapper = document.createElement("div");
    wrapper.id = BUTTON_ID;
    wrapper.className =
      "relative flex rounded bg-fill-tertiary dark:bg-fill-tertiary ml-1.5 overflow-visible";

    const hover = document.createElement("div");
    hover.className =
      "group flex flex-none items-center justify-center hover:bg-fill-quaternary dark:hover:bg-fill-quaternary rounded";

    // An <a> rather than a div so hover shows the target and cmd/middle-click
    // behave the way the user expects from a link.
    const link = document.createElement("a");
    link.className =
      "relative flex cursor-pointer p-2 text-gray-60 dark:text-gray-60";
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = "Open this problem on LeetCode.cn";
    link.setAttribute("aria-label", "Open on LeetCode.cn");

    // Same 16x16 footprint as the neighbouring icons; the tooltip carries the
    // "which site" detail so the glyph itself can stay understated.
    const icon = document.createElement("span");
    icon.className = "flex h-4 w-4 items-center justify-center";
    icon.innerHTML = GLOBE_SVG;

    link.appendChild(icon);
    hover.appendChild(link);
    wrapper.appendChild(hover);
    return wrapper;
  }

  function ensureButton() {
    const href = buildCnUrl();
    const existing = document.getElementById(BUTTON_ID);

    if (!href) {
      existing?.remove();
      return;
    }

    // Already mounted: just keep the target in sync with SPA navigation to
    // another problem (or another tab of this one).
    if (existing) {
      const link = existing.querySelector("a");
      if (link && link.href !== href) {
        link.href = href;
      }
      return;
    }

    const anchor = findAnchor();
    if (!anchor || !anchor.parentNode) {
      return;
    }

    anchor.parentNode.insertBefore(buildButton(href), anchor.nextSibling);
    console.log(LOG_TAG, "Button added -", href);
  }

  // A single poll mounts the button once the toolbar exists, re-mounts it when
  // SPA navigation remounts the toolbar, and refreshes the link target.
  ensureButton();
  setInterval(ensureButton, 1000);
})();
