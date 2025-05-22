// ==UserScript==
// @name         YouTube Watch Later Shortcut
// @namespace    http://tampermonkey.net/
// @version      1.1.2
// @description  Add and remove current YouTube video to and from the Youtube Watch Later list using a keyboard shortcut.
// @author       kyleczhang
// @match        https://www.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/youtube-watch-later-shortcut.js
// @updateURL    https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/youtube-watch-later-shortcut.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Function to execute YouTube commands (add or remove from Watch Later)
    function executeYouTubeCommand(action) {
        const videoId = new URL(window.location.href).searchParams.get("v");
        const appElement = document.querySelector("ytd-app");

        // Check if video ID and YouTube app element are found
        if (!videoId || !appElement) {
            return;
        }

        const params = {
            clickTrackingParams: "",
            commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: "/youtubei/v1/browse/edit_playlist" } },
            playlistEditEndpoint: {
                playlistId: "WL",
                actions: []
            }
        };

        if (action === "add") {
            params.playlistEditEndpoint.actions.push({ addedVideoId: videoId, action: "ACTION_ADD_VIDEO" });
        } else if (action === "remove") {
            params.playlistEditEndpoint.actions.push({ action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: videoId });
        }

        const event = new window.CustomEvent('yt-action', {
            detail: {
                actionName: 'yt-service-request',
                returnValue: [],
                args: [{ data: {} }, params],
                optionalAction: false,
            }
        });

        // Dispatch the event to execute the action
        appElement.dispatchEvent(event);
    }

    // Function to add keyboard shortcuts for adding/removing videos
    function addKeyboardShortcuts() {
        document.addEventListener('keydown', function (event) {
            if (event.code === 'KeyR' && event.altKey && event.shiftKey) {
                executeYouTubeCommand("add");
            } else if (event.code === 'KeyF' && event.altKey && event.shiftKey) {
                executeYouTubeCommand("remove");
            }
        });
    }

    // Initialize the script by adding keyboard shortcuts
    addKeyboardShortcuts();
})();
