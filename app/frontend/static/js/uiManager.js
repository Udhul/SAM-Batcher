// project_root/app/frontend/static/js/uiManager.js

/**
 * @file uiManager.js
 * @description Manages general UI elements and interactions not specific to other handlers
 * (e.g., modals, global notifications, theme toggles, layout adjustments).
 *
 * Responsibilities:
 * - Control visibility and content of global notification/status message areas.
 * - Manage modals (show/hide, set content).
 * - Handle theme switching if implemented.
 * - Provide utility functions for common DOM manipulations related to general UI.
 * - Manage expand/collapse state for generic expandable sections.
 *
 * External Dependencies:
 * - utils.js (for DOM helpers, event dispatching).
 *
 * Input/Output (I/O):
 * Input:
 *   - Methods: `showGlobalStatus(message, type, duration)`, `showModal(title, content)`, `hideModal()`.
 *   - Events from other modules indicating a need for UI update (e.g., `show-notification`).
 *
 * Output:
 *   - Modifies DOM for status messages, modals.
 *   - Dispatches events related to UI changes (e.g., `theme-changed`).
 */
class UIManager {
    constructor() {
        this.elements = {
            statusConsole: document.getElementById('status-console'),
            statusLog: document.getElementById('status-log'),
            statusToggle: document.getElementById('status-toggle'),
        };
        this.consoleState = 1; // 0: collapsed, 1: latest line, 2: expanded
        this._setupEventListeners();
        console.log("UIManager initialized");
    }

    _setupEventListeners() {
        if (this.elements.statusToggle) {
            this.elements.statusToggle.addEventListener('click', () => this._cycleConsoleState());
        }
        // Example: Close modal on close button click
        // if (this.elements.modalCloseBtn) {
        //     this.elements.modalCloseBtn.addEventListener('click', () => this.hideModal());
        // }
        // Example: Close modal on overlay click
        // if (this.elements.modalOverlay) {
        //     this.elements.modalOverlay.addEventListener('click', (e) => {
        //         if (e.target === this.elements.modalOverlay) this.hideModal();
        //     });
        // }

        // Generic handler for expandable sections (can be called by main.js for specific sections)
        // This provides a reusable way to manage them if not handled by specific component JS.
        // document.querySelectorAll('.expandable-header').forEach(header => {
        //     header.addEventListener('click', () => {
        //         const content = header.nextElementSibling;
        //         const indicator = header.querySelector('.expand-indicator');
        //         if (content && content.classList.contains('expandable-content')) {
        //             const isCollapsed = content.classList.toggle('collapsed');
        //             header.classList.toggle('collapsed', isCollapsed);
        //             if(indicator) indicator.textContent = isCollapsed ? '▼' : '▲';
        //         }
        //     });
        //     // Initialize state based on class
        //     const content = header.nextElementSibling;
        //     const indicator = header.querySelector('.expand-indicator');
        //     if (content && indicator) {
        //          const isCollapsed = content.classList.contains('collapsed');
        //          indicator.textContent = isCollapsed ? '▼' : '▲';
        //     }
        // });
    }

    _cycleConsoleState() {
        this.consoleState = (this.consoleState + 1) % 3;
        const c = this.elements.statusConsole;
        const t = this.elements.statusToggle;
        if (!c || !t) return;
        c.classList.remove('collapsed', 'latest-line', 'expanded');
        if (this.consoleState === 0) {
            c.classList.add('collapsed');
            t.textContent = '▼';
        } else if (this.consoleState === 1) {
            c.classList.add('latest-line');
            t.textContent = '◄';
        } else {
            c.classList.add('expanded');
            t.textContent = '▲';
        }
    }

    /**
     * Shows a global status message.
     * @param {string} message - The message text.
     * @param {'success'|'error'|'info'|'loading'} type - The type of message for styling.
     * @param {number|null} duration - Duration in ms. Null for default, 0 for persistent.
     */
    showGlobalStatus(message, type = 'info', duration = null) {
        // duration parameter kept for backward compatibility but ignored
        this.addStatusMessage(message, type);
    }

    clearGlobalStatus() {
        // No-op with new console based system
    }

    addStatusMessage(message, type = 'info') {
        if (!this.elements.statusLog) return;
        const ts = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `status-entry ${type}`;
        entry.textContent = `[${ts}] ${message}`;
        this.elements.statusLog.appendChild(entry);
        if (this.elements.statusConsole) {
            this.elements.statusConsole.scrollTop = this.elements.statusConsole.scrollHeight;
        }
    }


    // --- Modal Management (Example) ---
    // showModal(title, htmlContent) {
    //     if (this.elements.modalOverlay && this.elements.modalTitle && this.elements.modalContent) {
    //         this.elements.modalTitle.textContent = title;
    //         this.elements.modalContent.innerHTML = htmlContent; // Use innerHTML if content includes HTML
    //         Utils.showElement(this.elements.modalOverlay, 'flex'); // Assuming overlay uses flex for centering
    //     }
    // }
    // hideModal() {
    //     if (this.elements.modalOverlay) {
    //         Utils.hideElement(this.elements.modalOverlay);
    //     }
    // }

    // --- Expandable Section Helper (if main.js doesn't handle it per component) ---
    /**
     * Initializes an expandable section.
     * @param {HTMLElement} headerElement - The header element of the expandable section.
     * @param {boolean} initiallyCollapsed - Whether the section should start collapsed.
     */
    initializeExpandableSection(headerElement, initiallyCollapsed = false) {
        if (!headerElement) return;
        const contentElement = headerElement.nextElementSibling;
        const indicatorElement = headerElement.querySelector('.expand-indicator');

        if (!contentElement || !contentElement.classList.contains('expandable-content') || !indicatorElement) {
            // console.warn("UIManager: Invalid structure for expandable section.", headerElement);
            return;
        }

        const updateIndicator = (isCollapsed) => {
            indicatorElement.textContent = isCollapsed ? '▼' : '▲';
        };

        const toggle = () => {
            const isCollapsed = contentElement.classList.toggle('collapsed');
            headerElement.classList.toggle('collapsed', isCollapsed);
            updateIndicator(isCollapsed);
        };

        headerElement.addEventListener('click', toggle);

        // Set initial state
        contentElement.classList.toggle('collapsed', initiallyCollapsed);
        headerElement.classList.toggle('collapsed', initiallyCollapsed);
        updateIndicator(initiallyCollapsed);
    }
}

// Instantiate when DOM is ready, typically done by main.js
// document.addEventListener('DOMContentLoaded', () => {
//     if (!window.uiManager) {
//         window.uiManager = new UIManager();
//     }
// });