// ==UserScript==
// @name        ChatGPT play sound when finish generating
// @namespace   http://tampermonkey.net/
// @version     2.1
// @description Plays a custom chime when ChatGPT finishes generating responses (optimized)
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
        volume: 0.2,
        enableLogging: false,
        debounceDelay: 100,
        frequencies: [659.26, 659.26, 659.26, 987.76], // E5, E5, E5, B5
        durations: [150, 150, 150, 300], // Note durations in ms
        selectors: [
            'button[data-testid="stop-button"]',
            'button[aria-label*="Stop"]',
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
            this.log('Initializing ChatGPT Sound Notifier v2.0', 'info');
            this.initAudioContext();
            this.setupMutationObserver();
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

        setupMutationObserver() {
            this.observer = new MutationObserver((mutations) => {
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
                attributeFilter: ['data-testid', 'aria-label', 'disabled']
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
            if (now - this.lastStateChange < CONFIG.debounceDelay) {
                return; // Prevent rapid state changes
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

        isGenerationActive() {
            // Try multiple selectors for better reliability
            for (const selector of CONFIG.selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    // Check for stop button or disabled send button
                    if (selector.includes('stop-button') || selector.includes('Stop')) {
                        return true;
                    }
                    if (selector.includes('send-button') && element.disabled) {
                        return true;
                    }
                }
            }

            // Additional checks for generation indicators
            const streamingElements = document.querySelectorAll('[data-message-id]');
            for (const element of streamingElements) {
                if (element.textContent.includes('...') ||
                    element.querySelector('.result-streaming')) {
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

                const gainNode = this.audioContext.createGain();
                gainNode.connect(this.audioContext.destination);
                gainNode.gain.value = CONFIG.volume;

                let startTime = this.audioContext.currentTime;

                CONFIG.frequencies.forEach((freq, index) => {
                    const oscillator = this.audioContext.createOscillator();
                    oscillator.connect(gainNode);
                    oscillator.type = 'triangle';
                    oscillator.frequency.value = freq;

                    const duration = CONFIG.durations[index] / 1000;
                    oscillator.start(startTime);
                    oscillator.stop(startTime + duration);
                    startTime += duration;
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
                this.audioContext.close();
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
