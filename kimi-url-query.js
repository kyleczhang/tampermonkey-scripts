// ==UserScript==
// @name         Kimi URL Query
// @namespace    http://tampermonkey.net/
// @version      1.2.7
// @description  Submit Kimi prompts via a URL query parameter
// @author       kyleczhang
// @match        https://www.kimi.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=kimi.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/kimi-url-query.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/kimi-url-query.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(async () => {
  "use strict";

  const LOG_PREFIX = "[Kimi URL Query]";

  // Get the query parameter from URL
  const query = new URLSearchParams(window.location.search).get("q");
  console.log(LOG_PREFIX, "Query from URL:", query);
  if (!query) return;

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  // Wait for necessary elements to load with a timeout
  const maxWaitTime = 5000;
  const startTime = Date.now();
  let chatInput;

  // Poll for the chat input element
  while (!chatInput && Date.now() - startTime < maxWaitTime) {
    chatInput = document.querySelector(".chat-input-editor");
    console.log(LOG_PREFIX, chatInput);
    if (!chatInput) {
      await delay(100);
    }
  }

  if (!chatInput) {
    console.error(
      LOG_PREFIX,
      "Could not find chat input element within the timeout period",
    );
    return;
  }

  // Focus and populate the input
  chatInput.focus();
  chatInput.value = query;
  chatInput.dispatchEvent(
    new InputEvent("input", { data: query, bubbles: true }),
  );

  // Submit query after a brief delay
  await delay(500);
  chatInput.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }),
  );
})();
