// project_root/app/frontend/static/js/utils.js

/**
 * @file utils.js
 * @description Contains common frontend utility functions.
 *
 * Responsibilities:
 * - Provide helper functions for DOM manipulation, data formatting, debouncing/throttling, etc.
 *
 * External Dependencies: None.
 */
const Utils = {
    /**
     * Debounces a function, ensuring it's only called after a certain delay
     * since the last time it was invoked.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - The debounce delay in milliseconds.
     * @returns {Function} The debounced function.
     */
    debounce: (func, delay) => {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                func.apply(this, args);
            }, delay);
        };
    },

    /**
     * Throttles a function, ensuring it's called at most once within a specified time window.
     * @param {Function} func - The function to throttle.
     * @param {number} limit - The throttle time window in milliseconds.
     * @returns {Function} The throttled function.
     */
    throttle: (func, limit) => {
        let inThrottle;
        let lastFunc;
        let lastRan;
        return function(...args) {
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                lastRan = Date.now();
                inThrottle = true;
                setTimeout(() => {
                    inThrottle = false;
                    if (lastFunc) {
                        lastFunc.apply(context, args); // Run the last stored call
                        lastRan = Date.now();
                        lastFunc = null; // Clear it
                    }
                }, limit);
            } else {
                // Store the latest call to run after throttle period
                lastFunc = func;
            }
        };
    },

    /**
     * Generates a simple unique ID.
     * @param {string} prefix - Optional prefix for the ID.
     * @returns {string} A unique ID string.
     */
    generateUniqueId: (prefix = 'id_') => {
        return prefix + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Shows a DOM element.
     * @param {HTMLElement|string} elOrSelector - The element or its selector.
     * @param {string} displayStyle - The display style to apply (e.g., 'block', 'flex'). Defaults to 'block'.
     */
    showElement: (elOrSelector, displayStyle = 'block') => {
        const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
        if (el) el.style.display = displayStyle;
    },

    /**
     * Hides a DOM element.
     * @param {HTMLElement|string} elOrSelector - The element or its selector.
     */
    hideElement: (elOrSelector) => {
        const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
        if (el) el.style.display = 'none';
    },

    /**
     * Toggles a class on a DOM element.
     * @param {HTMLElement|string} elOrSelector - The element or its selector.
     * @param {string} className - The class name to toggle.
     * @param {boolean} [force] - Optional. If true, adds the class. If false, removes it.
     */
    toggleClass: (elOrSelector, className, force) => {
        const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
        if (el) el.classList.toggle(className, force);
    },

    /**
     * Formats a file size in bytes to a human-readable string.
     * @param {number} bytes - The file size in bytes.
     * @param {number} decimals - Number of decimal places. Defaults to 2.
     * @returns {string} Human-readable file size.
     */
    formatFileSize: (bytes, decimals = 2) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    /**
     * Sanitizes a string to prevent basic XSS by escaping HTML characters.
     * More robust sanitization should be done server-side or with a dedicated library.
     * @param {string} str - The string to sanitize.
     * @returns {string} The sanitized string.
     */
    escapeHTML: (str) => {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/'/g, "'");
    },

    /**
     * Dispatches a custom event.
     * @param {string} eventName - The name of the event.
     * @param {object} detail - The event detail/payload.
     * @param {EventTarget} [target=document] - The target to dispatch the event on.
     */
    dispatchCustomEvent: (eventName, detail, target = document) => {
        const event = new CustomEvent(eventName, { detail });
        target.dispatchEvent(event);
    }
};

// Make Utils globally available if not using modules, or export if using ES modules
// window.Utils = Utils; // For direct script includes
// export default Utils; // For ES module system