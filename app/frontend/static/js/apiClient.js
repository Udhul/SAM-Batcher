// project_root/app/frontend/static/js/apiClient.js

/**
 * @file apiClient.js
 * @description Centralized module for handling all HTTP requests to the backend API.
 * Abstracts fetch calls, JSON parsing, and basic error handling.
 *
 * Responsibilities:
 * - Provide methods for each API endpoint defined in specification.md.
 * - Handle request/response formatting (e.g., setting headers, parsing JSON).
 * - Perform basic error handling for network issues or non-OK HTTP statuses.
 * - (Optional) Dispatch events for API request lifecycle (sent, success, error).
 *
 * External Dependencies: None.
 *
 * Input/Output (I/O):
 * Input:
 *   - Parameters specific to each API call (e.g., payload for POST, query params for GET).
 *
 * Output:
 *   - Returns Promises that resolve with the JSON response from the backend or reject with an error.
 *   - (Optional) Custom DOM Events:
 *     - `api-request-sent`: Detail: { endpoint: string, method: string }
 *     - `api-response-received`: Detail: { endpoint: string, data: object }
 *     - `api-error`: Detail: { endpoint: string, error: string, status: number|null }
 */
class APIClient {
    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl;
        console.log("APIClient initialized with baseUrl:", this.baseUrl);
    }

    _dispatchEvent(eventType, detail) {
        const event = new CustomEvent(eventType, { detail });
        document.dispatchEvent(event);
    }

    async _request(endpoint, method = 'GET', body = null, signal = null, isFormData = false) {
        const url = `${this.baseUrl}${endpoint}`;
        const options = {
            method,
            signal, // For AbortController
        };

        if (isFormData && body) { // FormData handles its own Content-Type
            options.body = body;
        } else if (body) {
            options.headers = { 'Content-Type': 'application/json' };
            options.body = JSON.stringify(body);
        }

        this._dispatchEvent('api-request-sent', { endpoint, method });

        try {
            const response = await fetch(url, options);

            if (!response.ok) {
                let errorMsg = `API Error: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorData.message || errorMsg;
                } catch (e) { /* Response might not be JSON */ }
                this._dispatchEvent('api-error', { endpoint, error: errorMsg, status: response.status });
                throw new Error(errorMsg); // Throw to be caught by calling function
            }

            // Handle cases where response might be empty (e.g., 204 No Content)
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                const data = await response.json();
                this._dispatchEvent('api-response-received', { endpoint, data });
                return data; // Usually { success: true, ... } or { success: false, error: ... }
            } else {
                // Handle non-JSON responses if necessary, or assume success if no error was thrown
                this._dispatchEvent('api-response-received', { endpoint, data: { success: true, message: "Operation successful (no content)" } });
                return { success: true, message: "Operation successful (no content)" };
            }

        } catch (error) {
            // Network errors or errors thrown from !response.ok
            if (error.name !== 'AbortError') { // Don't dispatch api-error for explicit aborts
                this._dispatchEvent('api-error', { endpoint, error: error.message, status: null });
            }
            throw error; // Re-throw for the calling function to handle UI updates
        }
    }

    // --- Project Management Endpoints ---
    async createProject(projectName = null) {
        return this._request('/project', 'POST', { project_name: projectName });
    }
    async listProjects() {
        return this._request('/projects');
    }
    async loadProject(projectId) {
        return this._request('/project/load', 'POST', { project_id: projectId });
    }
    async uploadProjectDb(dbFileFormData) { // dbFileFormData is a FormData object
        return this._request('/project/upload_db', 'POST', dbFileFormData, null, true);
    }
    async downloadProjectDbUrl(projectId) { // Returns URL string for direct download
        return `${this.baseUrl}/project/download_db?project_id=${projectId}`;
    }
    async getProjectSettings(projectId) {
        return this._request(`/project/${projectId}/settings`);
    }
    async updateProjectSettings(projectId, settingsPayload) {
        return this._request(`/project/${projectId}/settings`, 'PUT', settingsPayload);
    }

    // --- Model Management Endpoints ---
    async getAvailableModels() {
        return this._request('/models/available');
    }
    async loadModel(payload) { // payload: { model_size_key?, model_path?, config_path?, apply_postprocessing }
        return this._request('/model/load', 'POST', payload);
    }
    async getCurrentModel() {
        return this._request('/model/current');
    }
    // async getModelLoadProgress(taskId) { ... } // For async model download
    // async cancelModelLoad(taskId) { ... }

    // --- Image Source & Pool Management Endpoints ---
    async addUploadSource(projectId, filesFormData) { // filesFormData is a FormData object
        return this._request(`/project/${projectId}/sources/add_upload`, 'POST', filesFormData, null, true);
    }
    async addFolderSource(projectId, folderPath) {
        return this._request(`/project/${projectId}/sources/add_folder`, 'POST', { path: folderPath });
    }
    // async addUrlSource(projectId, url) { ... }
    // async addAzureSource(projectId, uri, credentialsAlias) { ... }
    async listImageSources(projectId) {
        return this._request(`/project/${projectId}/sources`);
    }
    async removeImageSource(projectId, sourceId) {
        return this._request(`/project/${projectId}/sources/${sourceId}`, 'DELETE');
    }
    async listImages(projectId, page = 1, perPage = 50, statusFilter = null) {
        let query = `?page=${page}&per_page=${perPage}`;
        if (statusFilter) query += `&status_filter=${statusFilter}`;
        return this._request(`/project/${projectId}/images${query}`);
    }
    async getNextUnprocessedImage(projectId, currentImageHash = null) {
        let query = '';
        if (currentImageHash) query = `?current_image_hash=${currentImageHash}`;
        return this._request(`/project/${projectId}/images/next_unprocessed${query}`);
    }
    async setActiveImage(projectId, imageHash) {
        return this._request(`/project/${projectId}/images/set_active`, 'POST', { image_hash: imageHash });
    }
    async updateImageStatus(projectId, imageHash, status) {
        return this._request(`/project/${projectId}/images/${imageHash}/status`, 'PUT', { status });
    }
    async getImageThumbnailUrl(projectId, imageHash) { // Returns URL string
        return `${this.baseUrl}/image/thumbnail/${projectId}/${imageHash}`;
    }


    // --- Annotation Endpoints ---
    async generateAutoMasks(projectId, imageHash, amgParams = {}, signal = null) {
        return this._request(`/project/${projectId}/images/${imageHash}/automask`, 'POST', amgParams, signal);
    }
    async predictInteractive(projectId, imageHash, payload, signal = null) {
        // payload: { points, labels, box, maskInput, multimask_output }
        return this._request(`/project/${projectId}/images/${imageHash}/predict_interactive`, 'POST', payload, signal);
    }
    async commitMasks(projectId, imageHash, payload) {
        // payload: { final_masks: [...], notes: "..." }
        return this._request(`/project/${projectId}/images/${imageHash}/commit_masks`, 'POST', payload);
    }
    async getImageMasks(projectId, imageHash, layerType = null) {
        let query = '';
        if (layerType) query = `?layer_type=${layerType}`;
        return this._request(`/project/${projectId}/images/${imageHash}/masks${query}`);
    }

    // --- Export Endpoints ---
    async requestExport(projectId, payload) {
        // payload: { image_hashes, format, mask_layers_to_export, export_schema }
        // This endpoint on the server might return a direct file or a download URL for async.
        // The current server.py directly returns the file.
        // This client method needs to handle a file download response.
        const url = `${this.baseUrl}/project/${projectId}/export`;
        this._dispatchEvent('api-request-sent', { endpoint: `/project/${projectId}/export`, method: 'POST' });
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                let errorMsg = `Export Error: ${response.status} ${response.statusText}`;
                try { const errorData = await response.json(); errorMsg = errorData.error || errorData.message || errorMsg; } catch (e) {}
                this._dispatchEvent('api-error', { endpoint: `/project/${projectId}/export`, error: errorMsg, status: response.status });
                throw new Error(errorMsg);
            }

            // Trigger file download
            const blob = await response.blob();
            const contentDisposition = response.headers.get('content-disposition');
            let filename = "export.dat"; // Default filename
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="?(.+?)"?(;|$)/);
                if (filenameMatch && filenameMatch[1]) {
                    filename = filenameMatch[1];
                }
            }
            
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(downloadUrl);
            
            this._dispatchEvent('api-response-received', { endpoint: `/project/${projectId}/export`, data: { success: true, message: `Export '${filename}' initiated.` } });
            return { success: true, message: `Export '${filename}' initiated.` };

        } catch (error) {
            this._dispatchEvent('api-error', { endpoint: `/project/${projectId}/export`, error: error.message, status: null });
            throw error;
        }
    }
}

// Instantiate when DOM is ready, typically done by main.js
// document.addEventListener('DOMContentLoaded', () => {
//     if (!window.apiClient) {
//         window.apiClient = new APIClient();
//     }
// });