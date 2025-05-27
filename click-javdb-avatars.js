// ==UserScript==
// @name         Open Actor Pages in Background
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Locate actor links containing avatar figures and open their pages in background tabs at 1-second intervals via Option+Shift+O
// @match        *://*.javdb.com/users/collection_actors*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=javdb.com
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/click-javdb-avatars.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/click-javdb-avatars.js
// @grant        GM_openInTab
// ==/UserScript==

(function () {
    'use strict';

    /**
     * Retrieves all <a> elements whose href starts with "/actors/" and contains an <img class="avatar">.
     * @returns {HTMLAnchorElement[]} Array of anchor elements.
     */
    function getActorLinks() {
        const links = [];
        document.querySelectorAll('a[href^="/actors/"]').forEach(a => {
            if (a.querySelector('figure.image img.avatar[src]')) {
                links.push(a);
            }
        });
        return links;
    }

    /**
     * Opens each link href in a new background tab at the specified interval.
     * @param {HTMLAnchorElement[]} links - Array of anchor elements to open.
     * @param {number} interval - Interval in milliseconds between openings.
     */
    function openLinksInBackground(links, interval = 1000) {
        let index = 0;
        function openNext() {
            if (index >= links.length) return;
            const url = links[index++].href;
            GM_openInTab(url, { active: false, insert: true });
            setTimeout(openNext, interval);
        }
        openNext();
    }

    /**
     * Main function: find actor links and open pages in background tabs.
     */
    function triggerOpenActorPages() {
        const links = getActorLinks();
        if (!links.length) {
            console.log('No actor links found.');
            return;
        }
        openLinksInBackground(links);
    }

    // Hotkey listener: Option+Shift+O (Alt+Shift+O)
    document.addEventListener('keydown', function (event) {
        if (event.code === 'KeyO' && event.altKey && event.shiftKey) {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            triggerOpenActorPages();
        }
    }, true);
})();
