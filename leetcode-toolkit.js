// ==UserScript==
// @name         LeetCode Toolkit
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  Quality-of-life tools for leetcode.com problem pages: a button that opens the same problem on leetcode.cn, plus Ctrl+` / Cmd+B to fold and unfold the testcase and description panels.
// @author       kyleczhang
// @match        https://leetcode.com/problems/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=leetcode.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/leetcode-toolkit.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/leetcode-toolkit.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const LOG_TAG = "[LeetCode Toolkit]";

  function log(...args) {
    console.log(LOG_TAG, ...args);
  }

  // ==========================================================================
  // Feature: LeetCode.cn link
  //
  // Adds a globe button at the right end of the problem page's top button row
  // that opens the same problem on leetcode.cn in a new tab.
  // ==========================================================================

  const cnProblemLink = (function () {
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
      const match = location.pathname.match(
        /^\/problems\/([^/]+)(?:\/([^/]+))?/,
      );
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
      log("CN link button added -", href);
    }

    return {
      name: "cn problem link",
      init() {
        // A single poll mounts the button once the toolbar exists, re-mounts it
        // when SPA navigation remounts the toolbar, and refreshes the target.
        ensureButton();
        setInterval(ensureButton, 1000);
      },
    };
  })();

  // ==========================================================================
  // Feature: panel fold shortcuts
  //
  // Ctrl+` folds the testcase panel down to its tab bar, Cmd+B does the same
  // for the description panel, and either key folds it back open.
  // ==========================================================================

  const panelFoldShortcuts = (function () {
    // The problem page's dynamic layout is a FlexLayout, and every panel's tab
    // bar carries a toolbar with a `button.fold`. That one button toggles both
    // ways — folding leaves its class untouched and only flips the chevron — so
    // there is nothing to detect about the current state. There is one per panel
    // though, so it has to be looked up *inside* the panel we mean rather than
    // globally; a panel is identified by the ids LeetCode puts on its tabs, and
    // the first id that is actually on the page wins.
    const PANEL_SELECTOR = ".flexlayout__tabset";
    const FOLD_BUTTON_SELECTOR = "button.fold";

    // `code` is the layout-independent form; `key` is the fallback for keyboard
    // layouts that put the character on a different physical key. Modifiers are
    // matched exactly, so Ctrl+Shift+` and Cmd+Shift+B stay out of this.
    const BINDINGS = [
      {
        panel: "testcase",
        accel: { ctrl: true, code: "Backquote", key: "`" },
        tabIds: ["testcase_tab", "result_tab"],
      },
      {
        panel: "description",
        accel: { meta: true, code: "KeyB", key: "b" },
        tabIds: [
          "description_tab",
          "editorial_tab",
          "solutions_tab",
          "submissions_tab",
        ],
      },
    ];

    function matchesAccel(event, accel) {
      return (
        event.ctrlKey === !!accel.ctrl &&
        event.metaKey === !!accel.meta &&
        event.altKey === !!accel.alt &&
        event.shiftKey === !!accel.shift &&
        (event.code === accel.code || event.key.toLowerCase() === accel.key)
      );
    }

    function findFoldButton(tabIds) {
      for (const tabId of tabIds) {
        const button = document
          .getElementById(tabId)
          ?.closest(PANEL_SELECTOR)
          ?.querySelector(FOLD_BUTTON_SELECTOR);
        if (button) {
          return button;
        }
      }
      return null;
    }

    function onKeyDown(event) {
      if (event.repeat) {
        return;
      }

      const binding = BINDINGS.find((candidate) =>
        matchesAccel(event, candidate.accel),
      );
      if (!binding) {
        return;
      }

      const button = findFoldButton(binding.tabIds);
      if (!button) {
        // That panel isn't on this page (old layout, a view without it, ...):
        // leave the key alone rather than swallowing it.
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      button.click();
      log("Panel toggled -", binding.panel);
    }

    return {
      name: "panel fold shortcuts",
      init() {
        // Capture phase, so the shortcuts still work while focus sits in the
        // Monaco editor, which handles most key events itself and stops them.
        window.addEventListener("keydown", onKeyDown, true);
      },
    };
  })();

  // ==========================================================================
  // Bootstrap
  // ==========================================================================

  const FEATURES = [cnProblemLink, panelFoldShortcuts];

  for (const feature of FEATURES) {
    feature.init();
  }

  log("Ready -", FEATURES.map((feature) => feature.name).join(", "));
})();
