// project_root/app/frontend/static/js/utils.js

/**
 * @file utils.js
 * @description Contains common frontend utility functions.
 *
 * Responsibilities:
 * - Provide helper functions for DOM manipulation, data formatting, debouncing/throttling, etc.
 * - Offer utility for RLE decoding (placeholder for full implementation).
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
     * (Leading edge execution, subsequent calls in window are ignored until window passes)
     * @param {Function} func - The function to throttle.
     * @param {number} limit - The throttle time window in milliseconds.
     * @returns {Function} The throttled function.
     */
    throttle: (func, limit) => {
        let inThrottle = false;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /**
     * Generates a simple unique ID.
     * @param {string} prefix - Optional prefix for the ID.
     * @returns {string} A unique ID string.
     */
    generateUniqueId: (prefix = 'id_') => {
        return prefix + Math.random().toString(36).substring(2, 9);
    },

    /**
     * Generates `count` visually distinct colors in HSLA format.
     * @param {number} count - Number of colors to generate.
     * @returns {string[]} Array of HSLA color strings.
     */
    generateDistinctColors: (count) => {
        const colors = [];
        if (!count || count <= 0) return colors;
        for (let i = 0; i < count; i++) {
            const hue = (i * (360 / (count < 6 ? count * 1.6 : count * 1.1))) % 360;
            const saturation = 65 + Math.random() * 25;
            const lightness = 50 + Math.random() * 15;
            colors.push(`hsla(${hue}, ${saturation}%, ${lightness}%, 1)`);
        }
        return colors;
    },

    /**
     * Generates a random hex color string (e.g. '#A1B2C3').
     * @returns {string} Random hex color.
     */
    getRandomHexColor: () => {
        return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    },

    /**
     * Shows a DOM element.
     * @param {HTMLElement|string} elOrSelector - The element or its selector.
     * @param {string} displayStyle - The display style to apply (e.g., 'block', 'flex'). Defaults to 'block'.
     */
    showElement: (elOrSelector, displayStyle = 'block') => {
        const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
        if (el && el.style) el.style.display = displayStyle;
    },

    /**
     * Hides a DOM element.
     * @param {HTMLElement|string} elOrSelector - The element or its selector.
     */
    hideElement: (elOrSelector) => {
        const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
        if (el && el.style) el.style.display = 'none';
    },

    /**
     * Toggles a class on a DOM element.
     * @param {HTMLElement|string} elOrSelector - The element or its selector.
     * @param {string} className - The class name to toggle.
     * @param {boolean} [force] - Optional. If true, adds the class. If false, removes it.
     */
    toggleClass: (elOrSelector, className, force) => {
        const el = typeof elOrSelector === 'string' ? document.querySelector(elOrSelector) : elOrSelector;
        if (el && el.classList) el.classList.toggle(className, force);
    },

    /**
     * Formats a file size in bytes to a human-readable string.
     * @param {number} bytes - The file size in bytes.
     * @param {number} decimals - Number of decimal places. Defaults to 2.
     * @returns {string} Human-readable file size.
     */
    formatFileSize: (bytes, decimals = 2) => {
        if (bytes === null || bytes === undefined || isNaN(bytes) || bytes < 0) return 'N/A';
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    },

    /**
     * Sanitizes a string to prevent basic XSS by escaping HTML characters.
     * @param {string} str - The string to sanitize.
     * @returns {string} The sanitized string.
     */
    escapeHTML: (str) => {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&') // Must be first
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/'/g, "'"); // Or '
    },

    /**
     * Parses various label formats into an array of strings.
     * Accepts JSON arrays, comma separated strings, or arrays.
     * @param {string|string[]|null} val - Raw label data.
     * @returns {string[]} Array of cleaned label strings.
     */
    parseLabels: (val) => {
        if (!val) return [];
        if (Array.isArray(val)) {
            return val.map((v) => String(v).trim()).filter(Boolean);
        }
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed) return [];
            try {
                if (trimmed.startsWith('[')) {
                    const arr = JSON.parse(trimmed);
                    if (Array.isArray(arr)) {
                        return arr.map((v) => String(v).trim()).filter(Boolean);
                    }
                }
            } catch (e) {
                // fall back to comma separated
            }
            return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
        }
        return [];
    },

    /**
     * Dispatches a custom event.
     * @param {string} eventName - The name of the event.
     * @param {object} detail - The event detail/payload.
     * @param {EventTarget} [target=document] - The target to dispatch the event on.
     */
    dispatchCustomEvent: (eventName, detail, target = document) => {
        if (!target || typeof target.dispatchEvent !== 'function') {
            console.warn(`Cannot dispatch event '${eventName}' on invalid target:`, target);
            return;
        }
        const event = new CustomEvent(eventName, { detail });
        target.dispatchEvent(event);
    },

    /**
     * Decodes a COCO RLE (Run-Length Encoding) object into a 2D binary mask.
     * THIS IS A PLACEHOLDER and needs a full, correct COCO RLE implementation.
     * @param {object} rle - The RLE object { counts: number[], size: [height, width] }.
     * @param {number} height - Expected height of the mask.
     * @param {number} width - Expected width of the mask.
     * @returns {Array<Array<number>>|null} A 2D binary mask array (0s and 1s) or null on error.
     */
    rleToBinaryMask: (rle, height, width) => {
        if (!rle || !rle.counts || !rle.size || rle.size.length !== 2) {
            console.error("Invalid RLE object for decoding:", rle);
            return null;
        }
        if (rle.size[0] !== height || rle.size[1] !== width) {
            // This check is important but might be too strict if the RLE is for a sub-region.
            // For SAM, masks are usually full image size.
            console.warn("RLE size does not match target dimensions. RLE:", rle.size, "Target:", [height, width]);
            // Proceeding anyway, but be aware of potential issues.
        }

        const counts = rle.counts;
        const M = height * width;
        let out = new Uint8Array(M); // Using Uint8Array for efficiency
        let p = 0;
        let value = 0; // RLE typically starts with a count of 0s. If it's uncompressed RLE, first count is for 1s.
                       // Standard COCO RLE: value is 0, then 1, then 0, ...

        for (let i = 0; i < counts.length; i++) {
            const count = counts[i];
            if (p + count > M && i < counts.length -1 ) { // Check for overruns, except for the very last count
                console.error("RLE count exceeds mask dimensions. Index:", p, "Count:", count, "Max:", M);
                // Truncate this segment if it overruns significantly or return null
                for (let k=0; k < (M-p); k++) out[p+k] = value;
                p = M;
                break;
            }
            for (let j = 0; j < count; j++) {
                if (p < M) {
                    out[p++] = value;
                } else {
                    // This should ideally not happen if total counts sum to M
                    break; 
                }
            }
            value = 1 - value; // Alternate 0 and 1
        }

        if (p !== M && counts.reduce((a,b) => a+b, 0) !== M) {
            console.warn("RLE decoded length does not match mask dimensions. Decoded:", p, "Expected:", M);
            // This might indicate a malformed RLE or a different RLE scheme.
        }
        
        // Reshape 'out' (1D array) into a 2D binaryMaskArray
        const binaryMaskArray = [];
        for (let r = 0; r < height; r++) {
            // Slice and convert Uint8Array segment to a regular array
            binaryMaskArray.push(Array.from(out.slice(r * width, (r + 1) * width)));
        }
        return binaryMaskArray;
    },

    /**
     * Encodes a binary mask array into a simple COCO-style RLE object.
     * @param {Array<Array<number>>} binaryMask - 2D array of 0/1 values.
     * @returns {object} RLE object with {counts: number[], size: [height,width]}.
     */
    binaryMaskToRLE: (binaryMask) => {
        if (!binaryMask || !binaryMask.length || !binaryMask[0].length) return null;
        const height = binaryMask.length;
        const width = binaryMask[0].length;
        const counts = [];
        let count = 0;
        let current = 0; // RLE starts with count of zeros
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const val = binaryMask[y][x] ? 1 : 0;
                if (val !== current) {
                    counts.push(count);
                    count = 1;
                    current = val;
                } else {
                    count++;
                }
            }
        }
        counts.push(count);
        return { counts, size: [height, width] };
    }
};

// Make Utils globally available if not using modules.
if (typeof window !== 'undefined') {
    window.Utils = Utils;
}
// export default Utils; // For ES module system