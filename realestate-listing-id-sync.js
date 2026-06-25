// ==UserScript==
// @name         Real Estate Listing ID Sync
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Add two header buttons next to "Collections" on realestate.com.au: one exports the visited listing IDs (localStorage "previewedIds") to the clipboard as a JSON string array, the other reads that same format back from the clipboard (with a manual-paste fallback), merges it into previewedIds, and reloads so the map's visited grey dots update.
// @author       kyleczhang
// @match        https://www.realestate.com.au/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=realestate.com.au
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/realestate-listing-id-sync.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/realestate-listing-id-sync.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const LOG_TAG = "[REA Listing ID Sync]";
  // localStorage key whose value is the JSON string array of visited listing IDs
  // (the map's grey "already previewed" dots are driven by this).
  const STORAGE_KEY = "previewedIds";
  const EXPORT_ID = "rea-listing-id-export";
  const INJECT_ID = "rea-listing-id-inject";

  // 24x24 viewBox glyphs, drawn in currentColor to match the sibling header icons.
  const ICONS = {
    // Export / copy: a box with an up arrow leaving it.
    export:
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2a.75.75 0 0 1 .53.22l3.5 3.5a.75.75 0 0 1-1.06 1.06l-2.22-2.22V14a.75.75 0 0 1-1.5 0V4.56L9.03 6.78a.75.75 0 0 1-1.06-1.06l3.5-3.5A.75.75 0 0 1 12 2ZM5 11a.75.75 0 0 1 .75.75V19c0 .69.56 1.25 1.25 1.25h10c.69 0 1.25-.56 1.25-1.25v-7.25a.75.75 0 0 1 1.5 0V19A2.75 2.75 0 0 1 17 21.75H7A2.75 2.75 0 0 1 4.25 19v-7.25A.75.75 0 0 1 5 11Z" fill="currentColor"></path>',
    // Inject / merge: a box with a down arrow entering it.
    inject:
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2a.75.75 0 0 1 .75.75v9.44l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V2.75A.75.75 0 0 1 12 2ZM5 11a.75.75 0 0 1 .75.75V19c0 .69.56 1.25 1.25 1.25h10c.69 0 1.25-.56 1.25-1.25v-7.25a.75.75 0 0 1 1.5 0V19A2.75 2.75 0 0 1 17 21.75H7A2.75 2.75 0 0 1 4.25 19v-7.25A.75.75 0 0 1 5 11Z" fill="currentColor"></path>',
  };

  // -- Toast notifications -------------------------------------------------

  function ensureToastHost() {
    let host = document.getElementById("rea-listing-id-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "rea-listing-id-toast-host";
      host.style.cssText =
        "position:fixed;top:16px;right:16px;z-index:2147483647;" +
        "display:flex;flex-direction:column;gap:8px;pointer-events:none;";
      document.body.appendChild(host);
    }
    return host;
  }

  function notify(message, kind) {
    const host = ensureToastHost();
    const toast = document.createElement("div");
    const bg = kind === "error" ? "#c0202c" : "#1f7a3d";
    toast.style.cssText =
      "pointer-events:auto;max-width:320px;padding:10px 14px;border-radius:8px;" +
      "font:13px/1.4 system-ui,-apple-system,sans-serif;color:#fff;" +
      "box-shadow:0 4px 12px rgba(0,0,0,.2);background:" +
      bg +
      ";opacity:0;transition:opacity .15s ease;";
    toast.textContent = message;
    host.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
    });
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 200);
    }, 4000);
  }

  // -- localStorage helpers ------------------------------------------------

  // Read the saved visited listing IDs; treat a missing/unusable value as [].
  function readListingIds() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn(
        LOG_TAG,
        "Could not parse localStorage",
        STORAGE_KEY,
        "- treating as empty array.",
        error,
      );
      return [];
    }
  }

  // Normalise every entry to a string so de-duplication via Set is consistent
  // (the site stores IDs as strings; a stray number would otherwise dupe).
  function toIdString(value) {
    return String(value);
  }

  // -- Clipboard helpers ---------------------------------------------------

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // Fallback for contexts where the async Clipboard API is unavailable.
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;top:-9999px;left:-9999px;";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) {
      throw new Error("document.execCommand('copy') returned false");
    }
  }

  async function readClipboard() {
    if (navigator.clipboard && navigator.clipboard.readText) {
      return await navigator.clipboard.readText();
    }
    throw new Error("navigator.clipboard.readText is unavailable");
  }

  // -- Actions -------------------------------------------------------------

  // Export: serialise the visited listing IDs and copy them to the clipboard.
  async function handleExport() {
    const listingIds = readListingIds();
    const serializedListingIds = JSON.stringify(listingIds);
    try {
      await copyToClipboard(serializedListingIds);
      console.log(
        LOG_TAG,
        "Exported visited listing IDs:",
        listingIds.length,
        "- copied to clipboard.",
      );
      notify(
        "Copied " + listingIds.length + " listing IDs to clipboard",
        "success",
      );
    } catch (error) {
      console.error(LOG_TAG, "Failed to copy listing IDs to clipboard.", error);
      notify("Copy failed - see the Console log", "error");
    }
  }

  // Parse the exported raw text into an array of listing IDs, or throw.
  function parseIncomingListingIds(rawText) {
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed)) {
      throw new Error("Parsed clipboard content is not a JSON array.");
    }
    return parsed.map(toIdString);
  }

  // Resolve the raw text to inject: clipboard first, manual paste as a fallback.
  async function resolveIncomingRawText() {
    try {
      const fromClipboard = await readClipboard();
      if (fromClipboard && fromClipboard.trim()) {
        return fromClipboard;
      }
      console.warn(
        LOG_TAG,
        "Clipboard was empty; falling back to manual paste.",
      );
    } catch (error) {
      console.warn(
        LOG_TAG,
        "Clipboard read failed; falling back to manual paste.",
        error,
      );
    }
    // Manual-paste fallback: the user pastes the exported raw text directly.
    return window.prompt(
      "Could not read the clipboard. Paste the exported content here (a JSON string array):",
      "",
    );
  }

  // Inject: read exported text, merge-dedupe into previewedIds, then reload.
  async function handleInject() {
    const rawText = await resolveIncomingRawText();
    if (rawText === null || rawText.trim() === "") {
      console.warn(LOG_TAG, "No content provided for injection; aborting.");
      notify("No content to inject - cancelled", "error");
      return;
    }

    let incomingListingIds;
    try {
      incomingListingIds = parseIncomingListingIds(rawText);
    } catch (error) {
      console.error(
        LOG_TAG,
        "Could not parse injected content as a JSON string array.",
        "Raw text:",
        rawText,
        error,
      );
      notify(
        "Content is not a valid JSON string array - inject failed",
        "error",
      );
      return;
    }

    const existingListingIds = readListingIds().map(toIdString);
    const mergedListingIds = [
      ...new Set([...existingListingIds, ...incomingListingIds]),
    ];

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedListingIds));
    } catch (error) {
      console.error(
        LOG_TAG,
        "Failed to write merged IDs to localStorage.",
        error,
      );
      notify("Failed to write to localStorage - inject not completed", "error");
      return;
    }

    console.log(
      LOG_TAG,
      "Injected listing IDs - incoming:",
      incomingListingIds.length,
      "merged total:",
      mergedListingIds.length,
      "- reloading.",
    );
    notify(
      "Merged " +
        incomingListingIds.length +
        " incoming, " +
        mergedListingIds.length +
        " total - reloading...",
      "success",
    );
    // Reload so realestate.com.au re-reads localStorage and repaints grey dots.
    setTimeout(() => location.reload(), 600);
  }

  // -- Button injection ----------------------------------------------------

  function buildButton(id, title, iconSvg, onClick) {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    // Inline styling so we don't depend on the site's volatile class names,
    // while roughly matching the size/spacing of the neighbouring icon buttons.
    // The horizontal margin leaves a non-clickable gap between buttons, matching
    // the native ones (otherwise the two hit areas would touch edge-to-edge).
    button.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;" +
      "width:36px;height:36px;padding:0;margin:0 4px;border:0;background:none;" +
      "color:inherit;cursor:pointer;border-radius:9999px;";
    button.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" ' +
      'xmlns="http://www.w3.org/2000/svg">' +
      iconSvg +
      "</svg>";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  // Find the element our buttons should sit in front of. Logged in, that's the
  // "Collections" link; logged out, the header has no Collections link and shows
  // "Sign in" / "Join" instead, so we anchor on the first of those. Both are
  // matched by stable attribute/text rather than the site's volatile classes.
  function findAnchor() {
    const collections = document.querySelector('a[aria-label="Collections"]');
    if (collections) {
      return collections;
    }
    const header = document.querySelector("header");
    if (!header) {
      return null;
    }
    for (const button of header.querySelectorAll("button")) {
      const label = (button.textContent || "").trim().toLowerCase();
      if (label.includes("sign in") || label.includes("join")) {
        return button;
      }
    }
    return null;
  }

  function ensureButtons() {
    const anchor = findAnchor();
    if (!anchor || !anchor.parentNode) {
      return;
    }
    if (
      document.getElementById(EXPORT_ID) ||
      document.getElementById(INJECT_ID)
    ) {
      return;
    }

    const exportButton = buildButton(
      EXPORT_ID,
      "Export visited listing IDs (copy to clipboard)",
      ICONS.export,
      handleExport,
    );
    const injectButton = buildButton(
      INJECT_ID,
      "Inject & merge listing IDs (read from clipboard)",
      ICONS.inject,
      handleInject,
    );

    // Order in the action area: export, inject, then the anchor (Collections
    // when logged in, or Sign in when logged out).
    anchor.parentNode.insertBefore(exportButton, anchor);
    anchor.parentNode.insertBefore(injectButton, anchor);
  }

  // A single poll inserts the buttons once the header exists and re-inserts
  // them after SPA navigation remounts the header.
  ensureButtons();
  setInterval(ensureButtons, 1000);
})();
