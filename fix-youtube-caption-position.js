// ==UserScript==
// @name         fix youtube caption position
// @namespace    http://tampermonkey.net/
// @version      2.8.1
// @description  Fix youtube caption's position. You can change the position by change the variable of cMarginBottom, cBottom or cLeft.
// @author       kyleczhang
// @match        *://*.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=captions.ai
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/fix-youtube-caption-position.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/fix-youtube-caption-position.js
// @grant        none
// ==/UserScript==

(function () {
    "use strict";
    console.log("fix youtube caption position begin executing");

    if (
        window.trustedTypes &&
        window.trustedTypes.createPolicy &&
        !window.trustedTypes.defaultPolicy
    ) {
        window.trustedTypes.createPolicy("default", {
            createHTML: (string) => string
            // Optional, only needed for script (url) tags
            //,createScriptURL: string => string
            //,createScript: string => string,
        });
    }

    let captionContainerID = "#ytp-caption-window-container";
    const intervalID = setInterval(checkContainer, 500);

    function checkContainer() {
        if (document.querySelector(captionContainerID) !== null) {
            console.log("container loaded");
            clearInterval(intervalID);
            console.log("interval cleared.");
            fixCaption();
        }
    }

    function fixCaption() {
        // const captionStyle = "touch-action: none; text-align: left; overflow: hidden; left: 1.2%; width: 420px; height: 38px; margin-bottom:1px;";
        const cMarginBottom = "margin-bottom: 1px !important;";
        const cBottom = "bottom: 0.01% !important;";
        const cLeft = "left: 45% !important;";
        const captionSelector =
            ".ytp-caption-window-container .caption-window.ytp-caption-window-bottom";
        let newCssCaption;
        // `
        //   #target {
        //       margin-bottom: 1px !important;
        //       bottom: 1% !important;
        //   }
        // `;
        let styleTag;
        const captionContainer = document.querySelector(captionContainerID);
        const configContainer = { childList: true };
        // const configCaptionStyle = { attributeFilter: ["style"] };

        function nodeAdded(mutationList) {
            for (const mutation of mutationList) {
                console.log(mutation);
                if (mutation.type === "childList") {
                    if (mutation.addedNodes.length === 1) {
                        // console.log("caption appear~");
                        // let caption = document.querySelector(captionSelector);
                        let caption = captionContainer.firstElementChild;
                        console.log(caption);
                        // console.log(caption.getAttribute('style'));
                        // caption.setAttribute('style', captionStyle);
                        // console.log(caption.getAttribute('id'));
                        // console.log("attribute after setted");
                        // console.log(caption.getAttribute('style'));
                        // observerCaptionStyle.observe(caption, configCaptionStyle);
                        // captionClass = caption.getAttribute('class');
                        styleTag = document.createElement("style");
                        newCssCaption =
                            captionSelector +
                            "{" +
                            cMarginBottom +
                            cBottom +
                            cLeft +
                            "}";
                        styleTag.innerHTML = newCssCaption;
                        document.head.appendChild(styleTag);
                        console.log(styleTag);
                        observerNodeAdded.disconnect();
                    }
                    if (mutation.removedNodes.length === 1) {
                        // observerCaptionStyle.disconnect();
                        // styleTag.parentNode.removeChild(theScript);
                    }
                }
            }
        }

        // function captionStyleChanged(mutationList) {
        //     for (const mutation of mutationList) {
        //         // console.log(mutation);
        //         // let caption = document.querySelector(".ytp-larger-tap-buttons .caption-window.ytp-caption-window-bottom");
        //         // console.log(caption.getAttribute('style'));
        //         // caption.setAttribute('style', captionStyle);
        //         // console.log(caption.getAttribute('id'));
        //         // console.log("attribute after setted");
        //         // console.log(caption.getAttribute('style'));
        //     }
        // }

        // const observerCaptionStyle = new MutationObserver(captionStyleChanged);
        const observerNodeAdded = new MutationObserver(nodeAdded);
        observerNodeAdded.observe(captionContainer, configContainer);
        console.log("fix youtube caption position run successfully.");
        alert("The caption position has been fixed.");
    }
})();
