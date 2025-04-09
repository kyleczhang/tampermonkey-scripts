// ==UserScript==
// @name         Docker Internet Extender
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  try to take over the world!
// @author       kyleczhang
// @match        *eng.xiaojukeji.com/devmachine/detail/17875
// @icon         https://www.google.com/s2/favicons?sz=64&domain=docker.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/docker-internet-extender.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/docker-internet-extender.js
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    function onReady() {
        const mainButtonSelectorSet = new Set([
            "#content > div > div.oe-layout-main > div > div:nth-child(2) > div > div > div > div.panel-body > div:nth-child(12) > div > span.field_item_value > span > span > button"
        ]);
        const mainButtonTextSet = new Set(["开启外网"]);

        async function clickButton(selectorSet, textSet, callback) {
            let cnt = 50;
            while (true) {
                if (cnt <= 0) {
                    break;
                }

                for (const buttonSelector of selectorSet) {
                    const button = document.querySelector(buttonSelector);
                    if (button) {
                        if (textSet.has(button.innerText)) {
                            button.click();
                            if (callback) {
                                callback();
                            }
                        }
                        return;
                    }
                }

                await new Promise((r) => setTimeout(r, 200));
                cnt -= 1;
            }
        }

        function clickConfirmation() {
            const confirmSelectorSet = new Set();
            for (let i = 6; i <= 20; i++) {
                confirmSelectorSet.add(
                    `body > div:nth-child(${i}) > div > div.ant-modal-wrap > div > div.ant-modal-content > div > div > div.ant-confirm-btns > button.ant-btn.ant-btn-primary.ant-btn-lg`
                );
            }
            const confirmTextSet = new Set(["确 定", "OK"]);
            clickButton(confirmSelectorSet, confirmTextSet);
        }

        clickButton(mainButtonSelectorSet, mainButtonTextSet, clickConfirmation);
    }

    if (
        document.readyState === "complete" ||
        document.readyState === "interactive"
    ) {
        // Document is already ready to go
        onReady();
    } else {
        // Document is not ready, wait for it
        document.addEventListener("DOMContentLoaded", onReady);
    }
})();
