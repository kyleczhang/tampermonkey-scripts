// ==UserScript==
// @name         WA DoT PDA Booking Helper
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Automates the WA Department of Transport PDA booking flow: waits for Bitwarden to fill the login form then clicks Login; auto-clicks Verify once a 6-digit MFA code is entered; navigates Overview -> Driver's Licence -> Book PDA; and on the booking page pre-fills the date range (11/07/2026 - 30/09/2026) and ticks the "Success" site only.
// @author       kyleczhang
// @match        https://online.transport.wa.gov.au/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=transport.wa.gov.au
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/wa-dot-pda-booking.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/wa-dot-pda-booking.js
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const LOG_TAG = "[WA DoT PDA]";
  const log = (...args) => console.log(LOG_TAG, ...args);

  // Desired booking selection.
  const FROM_DATE = "11/07/2026";
  const TO_DATE = "30/09/2026";
  const SUCCESS_SITE_VALUE = "SUC"; // "Success" checkbox value in the site list.

  // --- Generic helpers -----------------------------------------------------

  // Resolve the first truthy resolver() result, driven by a MutationObserver
  // plus a poll (the poll catches elements that exist but are still settling).
  // Resolves null on timeout instead of hanging.
  function waitFor(resolver, { timeout = 60000, interval = 300 } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        observer.disconnect();
        clearInterval(poll);
        resolve(value);
      };

      const tryResolve = () => {
        let value = null;
        try {
          value = resolver();
        } catch (e) {
          value = null;
        }
        if (value) finish(value);
        return value;
      };

      const observer = new MutationObserver(tryResolve);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      const poll = setInterval(tryResolve, interval);
      if (timeout) setTimeout(() => finish(null), timeout);

      tryResolve();
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fire the events a framework (PrimeFaces / Wicket) listens for after a
  // programmatic value change so its server-side state stays in sync.
  function fireInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Wait for an element by id, then click it. PrimeFaces buttons run their
  // onclick even when hidden, so this also covers collapsed/invisible cases.
  async function clickById(id, label) {
    const el = await waitFor(() => document.getElementById(id), {
      timeout: 30000,
    });
    if (!el) {
      log(`${label} (#${id}) not found.`);
      return false;
    }
    log(`Clicking ${label}.`);
    el.click();
    return true;
  }

  // --- Step 1: Login page --------------------------------------------------
  // Wait for the password manager to fill both fields, then click Login once.

  function handleLoginPage() {
    const userId = document.getElementById("loginForm:userId");
    const password = document.getElementById("loginForm:password");
    const loginButton = document.getElementById("loginForm:loginButton");
    if (!userId || !password || !loginButton) return;

    log("Login form detected. Waiting for auto-fill...");
    waitForFillThenClick(
      () => userId.value.trim().length > 0 && password.value.length > 0,
      () => userId.value + " " + password.value,
      loginButton,
      "Login",
    );
  }

  // --- Step 2: MFA verification page ---------------------------------------
  // Once a 6-digit code is entered (manually or via one-time-code autofill),
  // click Verify.

  function handleVerificationPage() {
    const otp = document.getElementById("mfaVerificationForm:otp");
    const verifyButton = document.getElementById(
      "mfaVerificationForm:verifyButton",
    );
    if (!otp || !verifyButton) return;

    log("Verification form detected. Waiting for 6-digit code...");
    waitForFillThenClick(
      () => /^\d{6}$/.test(otp.value.trim()),
      () => otp.value.trim(),
      verifyButton,
      "Verify",
    );
  }

  // Shared submit-when-ready loop for the login and verification forms: waits
  // until `ready()` holds and the tracked value has stopped changing (so we
  // don't submit mid-fill / mid-typing), then clicks `button` exactly once.
  function waitForFillThenClick(ready, snapshotFn, button, label) {
    let clicked = false;
    let lastSnapshot = "";
    let stableCount = 0;

    const timer = setInterval(() => {
      if (clicked) {
        clearInterval(timer);
        return;
      }
      if (!ready()) {
        stableCount = 0;
        return;
      }
      const snapshot = snapshotFn();
      if (snapshot === lastSnapshot) {
        stableCount += 1;
      } else {
        stableCount = 1;
        lastSnapshot = snapshot;
      }
      if (stableCount >= 3) {
        clicked = true;
        clearInterval(timer);
        log(`Input filled and stable. Clicking ${label}.`);
        button.click();
      }
    }, 300);
  }

  // --- Step 5: Booking page ------------------------------------------------
  // Pre-fill the date range and tick only the "Success" site.

  async function setDateField(id, value) {
    const el = await waitFor(() => document.getElementById(id), {
      timeout: 15000,
    });
    if (!el) {
      log(`Date field #${id} not found.`);
      return;
    }
    el.focus();
    el.value = value;
    fireInputEvents(el);
    el.blur();
    log(`Set #${id} = ${value}`);
  }

  async function selectSuccessOnly() {
    const successBox = await waitFor(
      () =>
        document.querySelector(
          `input[name="searchBookingContainer:siteList"][value="${SUCCESS_SITE_VALUE}"]`,
        ),
      { timeout: 15000 },
    );
    if (!successBox) {
      log("Site checkbox list not found.");
      return;
    }

    const boxes = document.querySelectorAll(
      'input[name="searchBookingContainer:siteList"]',
    );
    boxes.forEach((box) => {
      const shouldBeChecked = box.value === SUCCESS_SITE_VALUE;
      if (box.checked !== shouldBeChecked) {
        box.checked = shouldBeChecked;
        fireInputEvents(box);
      }
    });
    log('Sites set to "Success" only.');
  }

  async function handleBookingPage() {
    // Wait for the booking form to mount.
    const ready = await waitFor(
      () => document.getElementById("fromDateInput"),
      {
        timeout: 30000,
      },
    );
    if (!ready) {
      log("Booking form did not appear.");
      return;
    }
    log("Booking form detected. Applying selection...");
    // Fill fromDate first — its onchange fires a Wicket AJAX post that may
    // re-render the form, so give it a moment before touching the next field.
    await setDateField("fromDateInput", FROM_DATE);
    await sleep(1200);
    await setDateField("toDateInput", TO_DATE);
    await sleep(600);
    // Tick Success last: the checkboxes have no AJAX handler, so nothing will
    // wipe them afterwards.
    await selectSuccessOnly();
    log("Selection applied. Review the values, then click Search.");
  }

  // --- Router --------------------------------------------------------------
  // These are full JSF/Wicket page loads, so the script re-runs per page and
  // we can dispatch by URL path.

  async function main() {
    const path = location.pathname;

    if (path.includes("/public/login.jsf")) {
      // Step 1: wait for Bitwarden, then Login.
      await waitFor(() => document.getElementById("loginForm:loginButton"), {
        timeout: 30000,
      });
      handleLoginPage();
    } else if (path.includes("/mfa-verification.jsf")) {
      // Step 2: wait for the 6-digit code, then Verify.
      await waitFor(() => document.getElementById("mfaVerificationForm:otp"), {
        timeout: 30000,
      });
      handleVerificationPage();
    } else if (path.includes("/overview.jsf")) {
      // Step 3: on the home page, open Driver's Licence.
      await clickById("menuForm:menubar_licence", "Driver's Licence menu item");
    } else if (path.includes("/licence.jsf")) {
      // Step 4: click Book PDA. The button lives inside an accordion that is
      // collapsed ("invisible") by default, but it is present in the DOM
      // regardless and PrimeFaces.ab fires on a programmatic click, so we can
      // click it directly without expanding the accordion first.
      await clickById("form:j_idt239:bookPDA", "Book PDA button");
    } else if (path.includes("/pdabooking")) {
      // Step 5: pre-fill the booking search.
      await handleBookingPage();
    } else {
      log("No automation for this page:", path);
    }
  }

  main();
})();
