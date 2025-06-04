// project_root/app/frontend/static/js/stateManager.js

/**
 * @file stateManager.js
 * @description Manages global client-side application state.
 * Provides a centralized way to get and set shared state variables and notifies
 * listeners of state changes.
 *
 * Responsibilities:
 * - Hold global state (e.g., activeProjectId, activeImageHash, currentLoadedModelInfo).
 * - Provide getter and setter methods for state properties.
 * - Dispatch events when state properties change.
 *
 * External Dependencies: None.
 *
 * Input/Output (I/O):
 * Input:
 *   - `setState(key, value)`: To update a state property.
 *   - `getState(key)`: To retrieve a state property.
 *
 * Output:
 *   - Custom DOM Events: Dispatches `state-changed-<key>` when a property changes.
 *     Detail: { key: string, oldValue: any, newValue: any, state: object }
 */
class StateManager {
    constructor() {
        this.state = {
            activeProjectId: null,
            activeProjectName: null, // For display
            activeImageHash: null,
            activeImageFilename: null, // For display
            currentLoadedModelInfo: null, // { key, path, config_path, postprocessing }
            uiPreferences: {
                theme: 'light', // Example preference
            },
            // Add other global states as needed
        };
        console.log("StateManager initialized with initial state:", this.state);
    }

    _dispatchEvent(eventType, detail) {
        const event = new CustomEvent(eventType, { detail });
        document.dispatchEvent(event);
    }

    getState(key) {
        if (key) {
            return this.state[key];
        }
        return { ...this.state }; // Return a copy of the whole state if no key
    }

    setState(key, value) {
        if (typeof key === 'object') { // Allow setting multiple keys at once
            const changes = {};
            for (const k in key) {
                if (this.state.hasOwnProperty(k) && this.state[k] !== key[k]) {
                    changes[k] = { oldValue: this.state[k], newValue: key[k] };
                    this.state[k] = key[k];
                } else if (!this.state.hasOwnProperty(k)) { // New key
                     changes[k] = { oldValue: undefined, newValue: key[k] };
                     this.state[k] = key[k];
                }
            }
            if (Object.keys(changes).length > 0) {
                this._dispatchEvent('state-changed-bulk', { changes, state: { ...this.state } });
                for (const k in changes) {
                     this._dispatchEvent(`state-changed-${k}`, { key: k, ...changes[k], state: { ...this.state } });
                }
            }
        } else if (this.state.hasOwnProperty(key)) {
            if (this.state[key] !== value) {
                const oldValue = this.state[key];
                this.state[key] = value;
                this._dispatchEvent(`state-changed-${key}`, { key, oldValue, newValue: value, state: { ...this.state } });
            }
        } else {
            // Allow adding new keys to state if necessary, though explicit definition is preferred
            const oldValue = undefined;
            this.state[key] = value;
            this._dispatchEvent(`state-changed-${key}`, { key, oldValue, newValue: value, state: { ...this.state } });
            // console.warn(`StateManager: Setting new undefined state key '${key}'. Consider defining it in initial state.`);
        }
    }

    // --- Specific convenience setters/getters ---
    setActiveProject(projectId, projectName) {
        this.setState({ activeProjectId: projectId, activeProjectName: projectName });
    }
    getActiveProjectId() { return this.getState('activeProjectId'); }
    getActiveProjectName() { return this.getState('activeProjectName'); }

    setActiveImage(imageHash, imageFilename) {
        this.setState({ activeImageHash: imageHash, activeImageFilename: imageFilename });
    }
    getActiveImageHash() { return this.getState('activeImageHash'); }
    getActiveImageFilename() { return this.getState('activeImageFilename'); }


    setCurrentLoadedModel(modelInfo) { // modelInfo: { key, path, config_path, postprocessing, loaded: true }
        this.setState('currentLoadedModelInfo', modelInfo);
    }
    getCurrentLoadedModel() { return this.getState('currentLoadedModelInfo'); }

    // Example for UI preferences
    setTheme(theme) {
        const prefs = { ...this.state.uiPreferences, theme };
        this.setState('uiPreferences', prefs);
    }
    getTheme() { return this.state.uiPreferences.theme; }
}

// Instantiate when DOM is ready, typically done by main.js
// document.addEventListener('DOMContentLoaded', () => {
//     if (!window.stateManager) {
//         window.stateManager = new StateManager();
//     }
// });