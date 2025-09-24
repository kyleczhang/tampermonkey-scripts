// ==UserScript==
// @name        ChatGPT play sound when finish generating
// @namespace   http://tampermonkey.net/
// @version     2.5
// @description Plays a custom chime when ChatGPT finishes generating responses (softer G-major arpeggio)
// @match       https://chatgpt.com/*
// @icon        https://www.google.com/s2/favicons?sz=64&domain=chatgpt.com
// @grant       none
// @downloadURL https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chatgpt-play-sound-when-finish.js
// @updateURL   https://raw.githubusercontent.com/kyleczhang/tampermonkey-scripts/refs/heads/main/chatgpt-play-sound-when-finish.js
// ==/UserScript==

(function () {
    'use strict';

    // Configuration
    const CONFIG = {
        volume: 0.25,               // Master volume (0.0 - 1.0)
        enableLogging: false,       // Set true to see logs in console
        debounceDelay: 120,         // Debounce for DOM checks in ms (slightly larger for stability)

        // Softer, pleasant major arpeggio: G4, B4, D5, G5 (Hz)
        frequencies: [392.00, 493.88, 587.33, 783.99],

        // Note durations in ms (slightly longer last note to "land")
        durations: [180, 180, 180, 400],

        // Small gap between notes to avoid smear (ms)
        noteGap: 30,

        // Multiple selectors to detect "generation in progress"
        // Order matters: stop-button first (most reliable), then aria-label fallbacks, then weakest rules last.
        selectors: [
            // 1) Most stable signal: Stop button appears only while generating
            '#composer-submit-button[data-testid="stop-button"]',
            'button[data-testid="stop-button"]',

            // 2) Fallbacks via aria-label (multi-language). Keep broad but secondary.
            'button[aria-label*="Stop"]',
            'button[aria-label*="停止"]',

            // 3) Weakest signal: disabled send button (UI changes often); keep last or remove if noisy
            '[data-testid="send-button"][disabled]'
        ]
    };

    class ChatGPTSoundNotifier {
        constructor() {
            this.isGenerating = false;
            this.audioContext = null;
            this.observer = null;
            this.debounceTimer = null;
            this.lastStateChange = 0;

            this.init();
        }

        init() {
            this.initAudioContext();
            this.setupMutationObserver();
            this.setupUserGestureAudioResume(); // ensure audio resumes on first user interaction
            this.checkInitialState();
        }

        initAudioContext() {
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) {
                    this.audioContext = new AudioContext();
                    this.log('Audio context initialized successfully', 'success');
                } else {
                    throw new Error('Web Audio API not supported');
                }
            } catch (error) {
                this.log(`Failed to initialize audio context: ${error.message}`, 'error');
            }
        }

        setupUserGestureAudioResume() {
            // Some browsers require a user gesture to unlock audio. We resume once on first key/click.
            const tryResume = () => {
                if (!this.audioContext) return;
                this.audioContext.resume().catch(() => { });
                window.removeEventListener('keydown', tryResume, true);
                window.removeEventListener('click', tryResume, true);
            };
            window.addEventListener('keydown', tryResume, true);
            window.addEventListener('click', tryResume, true);
        }

        setupMutationObserver() {
            this.observer = new MutationObserver(() => {
                this.debouncedCheck();
            });

            // Start observing when DOM is ready
            if (document.body) {
                this.startObserving();
            } else {
                document.addEventListener('DOMContentLoaded', () => this.startObserving());
            }
        }

        startObserving() {
            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                // Track common attributes plus visibility-related flags to capture show/hide transitions reliably
                attributeFilter: ['data-testid', 'aria-label', 'disabled', 'hidden', 'aria-hidden', 'style', 'class']
            });
            this.log('MutationObserver started', 'info');
        }

        debouncedCheck() {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                this.checkGenerationState();
            }, CONFIG.debounceDelay);
        }

        checkGenerationState() {
            const now = Date.now();
            // Avoid rapid flapping; rely mainly on debounce but keep a small guard window
            if (now - this.lastStateChange < CONFIG.debounceDelay * 0.8) {
                return;
            }

            const isCurrentlyGenerating = this.isGenerationActive();

            if (isCurrentlyGenerating !== this.isGenerating) {
                this.lastStateChange = now;

                if (!isCurrentlyGenerating && this.isGenerating) {
                    // Generation just finished
                    this.log('Generation finished - playing notification sound', 'success');
                    this.playNotificationSound();
                } else if (isCurrentlyGenerating && !this.isGenerating) {
                    this.log('Generation started', 'info');
                }

                this.isGenerating = isCurrentlyGenerating;
            }
        }

        // Utility: robust visibility check to avoid hidden/offscreen duplicates
        isVisible(el) {
            if (!el) return false;
            // Fast path: offsetParent is null for display:none or position:fixed with no layout
            if (el.offsetParent === null && el !== document.body) {
                // Still allow certain positioned elements; fall back to computed style
                const cs = getComputedStyle(el);
                if (!cs) return false;
                if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
            }
            const cs = getComputedStyle(el);
            if (!cs) return true;
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;

            // Also ensure none of the ancestors hide it via [hidden]/aria-hidden
            let node = el;
            while (node && node !== document) {
                if (node.hasAttribute && (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true')) {
                    return false;
                }
                node = node.parentNode;
            }
            return true;
        }

        // Decide if generation is active
        isGenerationActive() {
            // 1) Strongest signal: visible stop button
            for (const selector of CONFIG.selectors) {
                const el = document.querySelector(selector);
                if (el && this.isVisible(el)) {
                    // Explicitly treat stop-related selectors as "generating"
                    if (
                        selector.includes('stop-button') ||
                        selector.includes('Stop') ||
                        selector.includes('停止')
                    ) {
                        return true;
                    }
                    // Disabled send button only counts if visible and actually disabled
                    if (selector.includes('send-button') && el.disabled) {
                        return true;
                    }
                }
            }

            // 2) Secondary/legacy signals — keep weak and non-authoritative
            // We do NOT return true here unless the node is visible.
            const streamingNodes = document.querySelectorAll('[data-message-id]');
            for (const node of streamingNodes) {
                if (!this.isVisible(node)) continue;
                // Historically there was a ".result-streaming" class; keep as a weak fallback
                if (node.querySelector('.result-streaming')) {
                    return true;
                }
            }

            return false;
        }

        checkInitialState() {
            // Check initial state after a short delay to ensure DOM is ready
            setTimeout(() => {
                this.isGenerating = this.isGenerationActive();
                if (this.isGenerating) {
                    this.log('Initial state: Generation in progress', 'info');
                }
            }, 1000);
        }

        async playNotificationSound() {
            if (!this.audioContext) {
                this.log('Audio context not available, trying to reinitialize', 'warning');
                this.initAudioContext();
                if (!this.audioContext) return;
            }

            try {
                // Resume audio context if suspended (browser autoplay policy)
                if (this.audioContext.state === 'suspended') {
                    await this.audioContext.resume();
                }

                const masterGain = this.audioContext.createGain();
                masterGain.connect(this.audioContext.destination);
                masterGain.gain.value = CONFIG.volume;

                let startTime = this.audioContext.currentTime;

                // Play each note with a tiny gap for clarity
                CONFIG.frequencies.forEach((freq, index) => {
                    const osc = this.audioContext.createOscillator();
                    osc.connect(masterGain);

                    // Sine wave for a rounder, less buzzy tone
                    osc.type = 'sine';
                    osc.frequency.value = freq;

                    const durationSec = (CONFIG.durations[index] || 150) / 1000;
                    const gapSec = (CONFIG.noteGap || 0) / 1000;

                    // Per-note scheduling
                    osc.start(startTime);
                    osc.stop(startTime + durationSec);

                    startTime += durationSec + gapSec;
                });

                this.log('Notification sound played successfully', 'success');
            } catch (error) {
                this.log(`Error playing sound: ${error.message}`, 'error');
            }
        }

        log(message, type = 'info') {
            if (!CONFIG.enableLogging && type !== 'error') return;

            const timestamp = new Date().toLocaleTimeString();
            const styles = {
                info: 'color: #2196F3; font-weight: bold;',
                success: 'color: #4CAF50; font-weight: bold;',
                warning: 'color: #FF9800; font-weight: bold;',
                error: 'color: #F44336; font-weight: bold;'
            };

            console.log(
                `%c[ChatGPT Sound Notifier - ${timestamp}] ${message}`,
                styles[type] || styles.info
            );
        }

        destroy() {
            if (this.observer) {
                this.observer.disconnect();
            }
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            if (this.audioContext) {
                try { this.audioContext.close(); } catch (e) { /* noop */ }
            }
            this.log('Sound notifier destroyed', 'info');
        }
    }

    // Initialize the notifier
    let notifier;

    function initNotifier() {
        if (notifier) {
            notifier.destroy();
        }
        notifier = new ChatGPTSoundNotifier();
    }

    // Initialize when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNotifier);
    } else {
        initNotifier();
    }

    // Reinitialize on navigation (SPA behavior)
    let lastUrl = location.href;
    new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            setTimeout(initNotifier, 1000); // Delay to ensure new page is loaded
        }
    }).observe(document, { subtree: true, childList: true });

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (notifier) {
            notifier.destroy();
        }
    });

})();
