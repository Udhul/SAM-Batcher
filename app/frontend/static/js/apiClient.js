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
 * - Dispatch events for API request lifecycle (sent, success, error).
 *
 * External Dependencies:
 * - utils.js (for dispatchCustomEvent) - Assumed to be globally available as window.Utils
 *
 * Input/Output (I/O):
 * Input:
 *   - Parameters specific to each API call (e.g., payload for POST, query params for GET).
 *
 * Output:
 *   - Returns Promises that resolve with the JSON response from the backend or reject with an error.
 *   - Custom DOM Events:
 *     - `api-request-sent`: Detail: { endpoint: string, method: string }
 *     - `api-response-received`: Detail: { endpoint: string, data: object }
 *     - `api-error`: Detail: { endpoint: string, error: string, status: number|null }
 */
class APIClient {
    constructor(baseUrl = '/api') {
        this.baseUrl = baseUrl;
        this.Utils = window.Utils || { dispatchCustomEvent: (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail })) };
        console.log("APIClient initialized with baseUrl:", this.baseUrl);
    }

    _dispatchEvent(eventType, detail) {
        // Use the Utils method for dispatching if available, otherwise direct dispatch
        this.Utils.dispatchCustomEvent(eventType, detail);
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
                // Ensure the error thrown includes the status for better debugging
                const error = new Error(errorMsg);
                error.status = response.status;
                throw error;
            }

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                const data = await response.json();
                this._dispatchEvent('api-response-received', { endpoint, data });
                return data;
            } else if (response.status === 204) { // No Content
                 this._dispatchEvent('api-response-received', { endpoint, data: { success: true, message: "Operation successful (No Content)" } });
                return { success: true, message: "Operation successful (No Content)" };
            } else { // Handle other non-JSON responses or assume success if no error
                const textData = await response.text(); // Attempt to get text if not JSON
                 this._dispatchEvent('api-response-received', { endpoint, data: { success: true, message: "Operation successful (non-JSON response)", raw_response: textData } });
                return { success: true, message: "Operation successful (non-JSON response)", raw_response: textData };
            }

        } catch (error) {
            if (error.name !== 'AbortError') {
                this._dispatchEvent('api-error', { endpoint, error: error.message, status: error.status || null });
            }
            throw error;
        }
    }

    // --- Project Management Endpoints ---
    async createProject(projectName = null) {
        return this._request('/project', 'POST', { project_name: projectName });
    }
    async listProjects() {
        return this._request('/projects');
    }
    async getActiveProject() {
        return this._request('/project/active');
    }
    async getSessionState() {
        return this._request('/session');
    }
    async loadProject(projectId) {
        return this._request('/project/load', 'POST', { project_id: projectId });
    }
    async uploadProjectDb(dbFileFormData) {
        return this._request('/project/upload_db', 'POST', dbFileFormData, null, true);
    }
    getDownloadProjectDbUrl(projectId) { // Returns URL string for direct download via <a> tag
        return `${this.baseUrl}/project/download_db?project_id=${projectId}`;
    }
    async getProjectSettings(projectId) {
        return this._request(`/project/${projectId}/settings`);
    }
    async updateProjectSettings(projectId, settingsPayload) {
        return this._request(`/project/${projectId}/settings`, 'PUT', settingsPayload);
    }
    async renameProject(projectId, newName) {
        return this._request(`/project/${projectId}`, 'PUT', { project_name: newName });
    }
    async deleteProject(projectId) {
        return this._request(`/project/${projectId}`, 'DELETE');
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
    async addUploadSource(projectId, filesFormData) {
        return this._request(`/project/${projectId}/sources/add_upload`, 'POST', filesFormData, null, true);
    }
    async addFolderSource(projectId, folderPath) {
        return this._request(`/project/${projectId}/sources/add_folder`, 'POST', { path: folderPath });
    }
    async addUrlSource(projectId, url) {
        return this._request(`/project/${projectId}/sources/add_url`, 'POST', { url: url });
    }
    async addAzureSource(projectId, uri, credentialsAlias = null) {
        const payload = { uri: uri };
        if (credentialsAlias) payload.credentials_alias = credentialsAlias;
        return this._request(`/project/${projectId}/sources/add_azure`, 'POST', payload);
    }
    async listImageSources(projectId) {
        return this._request(`/project/${projectId}/sources`);
    }
    async removeImageSource(projectId, sourceId) {
        return this._request(`/project/${projectId}/sources/${sourceId}`, 'DELETE');
    }
    async listImagesForSource(projectId, sourceId) {
        return this._request(`/project/${projectId}/sources/${sourceId}/images`);
    }
    async setImageExempt(projectId, sourceId, imageHash, exempt=true) {
        return this._request(`/project/${projectId}/sources/${sourceId}/exempt_image`, 'POST', { image_hash: imageHash, exempt });
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
        // This endpoint returns image data, dimensions, existing masks, etc.
        return this._request(`/project/${projectId}/images/set_active`, 'POST', { image_hash: imageHash });
    }
    async updateImageStatus(projectId, imageHash, status) {
        return this._request(`/project/${projectId}/images/${imageHash}/status`, 'PUT', { status });
    }
    getImageThumbnailUrl(projectId, imageHash) { // Returns URL string
        return `${this.baseUrl}/image/thumbnail/${projectId}/${imageHash}`; // Corrected, assuming endpoint exists
    }
    async getImageData(projectId, imageHash) { // If raw image data needed separately
         return this._request(`/project/${projectId}/images/${imageHash}/data`);
    }


    // --- Annotation Endpoints ---
    async generateAutoMasks(projectId, imageHash, amgParams = {}, signal = null) {
        // Ensure projectId and imageHash are part of the URL as per spec for consistency
        const endpoint = (projectId && imageHash)
            ? `/project/${projectId}/images/${imageHash}/automask`
            : '/automask'; // Fallback if project context isn't strictly used by backend for this yet
        return this._request(endpoint, 'POST', amgParams, signal);
    }
    async predictInteractive(projectId, imageHash, payload, signal = null) {
        // payload: { points, labels, box, maskInput, multimask_output }
        const endpoint = (projectId && imageHash)
            ? `/project/${projectId}/images/${imageHash}/predict_interactive`
            : '/predict_interactive'; // Fallback
        return this._request(endpoint, 'POST', payload, signal);
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
        // payload: { format, export_schema, filters: { image_statuses, layer_statuses } }
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
                const error = new Error(errorMsg);
                error.status = response.status;
                throw error;
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
            this._dispatchEvent('api-error', { endpoint: `/project/${projectId}/export`, error: error.message, status: error.status || null });
            throw error;
        }
    }
}

// Instantiate when DOM is ready and make it globally accessible
// This is typically handled by main.js, but for direct use:
// document.addEventListener('DOMContentLoaded', () => {
//     if (!window.apiClient) {
//         window.apiClient = new APIClient();
//     }
// });