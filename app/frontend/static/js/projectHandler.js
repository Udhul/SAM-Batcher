// project_root/app/frontend/static/js/projectHandler.js

/**
 * @file projectHandler.js
 * @description Manages UI and logic related to project creation, loading,
 * and image source management.
 *
 * Responsibilities:
 * - Handle UI for creating new projects.
 * - Handle UI for listing and loading existing projects (from server or uploaded DB).
 * - Manage UI for adding/removing image sources (uploads, server folders, URLs).
 * - Interact with apiClient.js for all backend project/source operations.
 * - Update relevant UI sections based on backend responses.
 * - Dispatch events related to project state changes.
 *
 * External Dependencies:
 * - apiClient.js (for backend communication).
 * - utils.js (for DOM helpers, event dispatching).
 * - stateManager.js (to update global activeProjectId).
 * - uiManager.js (for status messages and UI component init).
 *
 * Input/Output (I/O):
 * Input:
 *   - DOM Elements for project controls.
 *   - User interactions with these elements.
 *
 * Output:
 *   - Calls to apiClient.js methods.
 *   - Updates UI elements.
 *   - Custom DOM Events:
 *     - `project-created`: Detail: { projectId: string, projectName: string, projectData: object }
 *     - `project-loaded`: Detail: { projectId: string, projectName: string, projectData: object }
 *     - `project-load-failed`: Detail: { error: string }
 *     - `sources-updated`: Detail: { sources: Array }
 */
class ProjectHandler {
    constructor(apiClient, stateManager, uiManager, Utils) {
        this.apiClient = apiClient;
        this.stateManager = stateManager;
        this.uiManager = uiManager;
        this.Utils = Utils;

        this.elements = {
            createProjectBtn: document.getElementById('create-project-btn'),
            projectNameInput: document.getElementById('new-project-name'),
            loadProjectSelect: document.getElementById('load-project-select'),
            loadSelectedProjectBtn: document.getElementById('load-selected-project-btn'),
            uploadProjectDbInput: document.getElementById('upload-project-db-input'),
            downloadProjectDbBtn: document.getElementById('download-project-db-btn'),
            projectManagementBar: document.getElementById('project-management-bar'),
            projectOverlay: document.getElementById('project-management-overlay'),
            projectOverlayClose: document.getElementById('close-project-overlay'),
            activeProjectDisplay: document.getElementById('active-project-display'),

            addSourceBtn: document.getElementById('add-image-source-btn'),
            sourceTypeSelect: document.getElementById('image-source-type-select'),
            folderPathInput: document.getElementById('image-source-folder-path'),
            folderSourceGroup: document.getElementById('image-source-folder-inputs'),
            urlInput: document.getElementById('image-source-url-path'),
            urlSourceGroup: document.getElementById('image-source-url-inputs'),
            imageSourcesListContainer: document.getElementById('image-sources-list-container'),
        };
        this._setupEventListeners();
        this.fetchAndDisplayProjects(); // Initial fetch
        this.fetchActiveProject().then(() => {
            this._updateActiveProjectDisplay();
            if (!this.stateManager.getActiveProjectId()) this.showOverlay();
        });

        // Listen for state changes to update active project display
        document.addEventListener('state-changed-activeProjectId', () => this._updateActiveProjectDisplay());
        document.addEventListener('state-changed-activeProjectName', () => this._updateActiveProjectDisplay());
    }

    _setupEventListeners() {
        if (this.elements.createProjectBtn) {
            this.elements.createProjectBtn.addEventListener('click', () => this.handleCreateProject());
        }
        if (this.elements.loadSelectedProjectBtn) {
            this.elements.loadSelectedProjectBtn.addEventListener('click', () => this.handleLoadSelectedProject());
        }
        if (this.elements.uploadProjectDbInput) {
             this.elements.uploadProjectDbInput.addEventListener('change', (e) => this.handleUploadProjectDb(e.target.files[0]));
        }
        if (this.elements.downloadProjectDbBtn) {
            this.elements.downloadProjectDbBtn.addEventListener('click', () => this.handleDownloadProjectDb());
        }
        if (this.elements.addSourceBtn) {
            this.elements.addSourceBtn.addEventListener('click', () => this.handleAddImageSource());
        }
        if (this.elements.sourceTypeSelect) {
            this.elements.sourceTypeSelect.addEventListener('change', (e) => this._handleSourceTypeChange(e.target.value));
        }
        if (this.elements.projectManagementBar && this.elements.projectOverlay) {
            this.elements.projectManagementBar.addEventListener('click', () => this.showOverlay());
        }
        if (this.elements.projectOverlayClose) {
            this.elements.projectOverlayClose.addEventListener('click', () => this.hideOverlay());
        }
    }
    
    _updateActiveProjectDisplay() {
        const projectId = this.stateManager.getActiveProjectId();
        const projectName = this.stateManager.getActiveProjectName();
        if (this.elements.activeProjectDisplay) {
            if (projectId && projectName) {
                this.elements.activeProjectDisplay.textContent = `Active: ${this.Utils.escapeHTML(projectName)} (${projectId.substring(0,6)}...)`;
                this.elements.activeProjectDisplay.classList.remove('error');
                this.elements.downloadProjectDbBtn.disabled = false;
            } else {
                this.elements.activeProjectDisplay.textContent = 'No active project';
                this.elements.activeProjectDisplay.classList.add('error'); // Or some other style
                this.elements.downloadProjectDbBtn.disabled = true;
            }
        }
    }

    _handleSourceTypeChange(type) {
        this.Utils.hideElement(this.elements.folderSourceGroup);
        this.Utils.hideElement(this.elements.urlSourceGroup);
        if (type === 'folder') {
            this.Utils.showElement(this.elements.folderSourceGroup, 'block');
        } else if (type === 'url') {
            this.Utils.showElement(this.elements.urlSourceGroup, 'block');
        }
    }

    showOverlay() {
        if (this.elements.projectOverlay) {
            this.Utils.showElement(this.elements.projectOverlay, 'flex');
        }
    }

    hideOverlay() {
        if (this.elements.projectOverlay) {
            this.Utils.hideElement(this.elements.projectOverlay);
        }
    }

    async handleCreateProject() {
        const projectName = this.elements.projectNameInput ? this.elements.projectNameInput.value.trim() : null;
        this.uiManager.showGlobalStatus('Creating project...', 'loading', 0);
        try {
            const data = await this.apiClient.createProject(projectName);
            if (data.success) {
                this.stateManager.setActiveProject(data.project_id, data.project_name || `Project ${data.project_id.substring(0,6)}`);
                this.uiManager.showGlobalStatus(`Project '${this.Utils.escapeHTML(data.project_name)}' created and loaded.`, 'success');
                this.Utils.dispatchCustomEvent('project-created', { projectId: data.project_id, projectName: data.project_name, projectData: data });
                this.Utils.dispatchCustomEvent('project-loaded', { projectId: data.project_id, projectName: data.project_name, projectData: data }); // Dispatch loaded too
                await this.fetchAndDisplayProjects(); // Refresh project list
                this.elements.projectNameInput.value = ''; // Clear input
                await this.fetchAndDisplayImageSources(); // Clear/load sources for new project
                this.hideOverlay();
            } else {
                throw new Error(data.error || "Failed to create project.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error creating project: ${error.message}`, 'error');
            this.Utils.dispatchCustomEvent('project-load-failed', { error: error.message });
            console.error("ProjectHandler: Create project error", error);
        }
    }

    async fetchActiveProject() {
        try {
            const data = await this.apiClient.getActiveProject();
            if (data.success && data.project_id) {
                this.stateManager.setActiveProject(data.project_id, data.project_name);
                await this.fetchAndDisplayImageSources();
            }
        } catch (error) {
            console.error('ProjectHandler: fetchActiveProject error', error);
        }
    }

    async fetchAndDisplayProjects() {
        if (!this.elements.loadProjectSelect) return;
        this.elements.loadProjectSelect.innerHTML = '<option value="">Fetching...</option>';
        try {
            const data = await this.apiClient.listProjects();
            if (data.success) {
                this.elements.loadProjectSelect.innerHTML = '<option value="">Select a project to load...</option>';
                if (data.projects && data.projects.length > 0) {
                    data.projects.forEach(p => {
                        const option = document.createElement('option');
                        option.value = p.id;
                        option.textContent = `${this.Utils.escapeHTML(p.name)} (ID: ${p.id.substring(0,6)}... Last Modified: ${new Date(p.last_modified).toLocaleDateString()})`;
                        this.elements.loadProjectSelect.appendChild(option);
                    });
                } else {
                     this.elements.loadProjectSelect.innerHTML = '<option value="">No projects found.</option>';
                }
            } else {
                this.elements.loadProjectSelect.innerHTML = '<option value="">Error fetching projects.</option>';
                this.uiManager.showGlobalStatus(`Error fetching projects: ${data.error}`, 'error');
            }
        } catch (error) {
            this.elements.loadProjectSelect.innerHTML = '<option value="">Network error.</option>';
            this.uiManager.showGlobalStatus(`Network error fetching projects: ${error.message}`, 'error');
        }
    }

    async handleLoadSelectedProject() {
        const projectId = this.elements.loadProjectSelect.value;
        if (!projectId) {
            this.uiManager.showGlobalStatus("Please select a project to load.", 'info');
            return;
        }
        this.uiManager.showGlobalStatus(`Loading project ${projectId.substring(0,6)}...`, 'loading', 0);
        try {
            const data = await this.apiClient.loadProject(projectId);
            if (data.success && data.project_data) {
                this.stateManager.setActiveProject(data.project_data.project_id, data.project_data.project_name);
                this.uiManager.showGlobalStatus(`Project '${this.Utils.escapeHTML(data.project_data.project_name)}' loaded.`, 'success');
                this.Utils.dispatchCustomEvent('project-loaded', {
                    projectId: data.project_data.project_id,
                    projectName: data.project_data.project_name,
                    projectData: data.project_data
                });
                await this.fetchAndDisplayImageSources();
                this.hideOverlay();
            } else {
                throw new Error(data.error || "Failed to load project.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error loading project: ${error.message}`, 'error');
            this.Utils.dispatchCustomEvent('project-load-failed', { error: error.message });
            console.error("ProjectHandler: Load project error", error);
        }
    }

    async handleUploadProjectDb(file) {
        if (!file) return;
        this.uiManager.showGlobalStatus(`Uploading project DB '${this.Utils.escapeHTML(file.name)}'...`, 'loading', 0);
        const formData = new FormData();
        formData.append('db_file', file);
        try {
            const data = await this.apiClient.uploadProjectDb(formData);
            if (data.success && data.project_data) {
                this.stateManager.setActiveProject(data.project_data.project_id, data.project_data.project_name);
                this.uiManager.showGlobalStatus(`Project DB '${this.Utils.escapeHTML(data.project_data.project_name)}' uploaded and loaded.`, 'success');
                this.Utils.dispatchCustomEvent('project-loaded', {
                    projectId: data.project_data.project_id,
                    projectName: data.project_data.project_name,
                    projectData: data.project_data
                });
                await this.fetchAndDisplayProjects(); // Refresh list
                await this.fetchAndDisplayImageSources();
                this.hideOverlay();
            } else {
                throw new Error(data.error || "Failed to upload project DB.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error uploading project DB: ${error.message}`, 'error');
            console.error("ProjectHandler: Upload DB error", error);
        } finally {
            this.elements.uploadProjectDbInput.value = ''; // Reset file input
        }
    }

    handleDownloadProjectDb() {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) {
            this.uiManager.showGlobalStatus("No active project to download.", "error");
            return;
        }
        const downloadUrl = this.apiClient.getDownloadProjectDbUrl(projectId);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `${projectId}.sqlite`; // Or derive name from project
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        this.uiManager.showGlobalStatus("Project DB download initiated.", "success");
    }

    async handleAddImageSource() {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) {
            this.uiManager.showGlobalStatus("No active project. Create or load a project first.", "error");
            return;
        }
        const sourceType = this.elements.sourceTypeSelect.value;
        let responseData;
        try {
            this.uiManager.showGlobalStatus(`Adding image source (${sourceType})...`, 'loading', 0);
            if (sourceType === 'upload') {
                this.uiManager.showGlobalStatus("Upload images directly using the 'Load Image' button in the canvas toolbar for the current project.", "info", 5000);
                return; // Uploads handled differently, often directly to active project/image
            } else if (sourceType === 'folder') {
                const folderPath = this.elements.folderPathInput.value.trim();
                if (!folderPath) throw new Error("Folder path is required.");
                responseData = await this.apiClient.addFolderSource(projectId, folderPath);
                this.elements.folderPathInput.value = '';
            } else if (sourceType === 'url') {
                const urlPath = this.elements.urlInput.value.trim();
                if(!urlPath) throw new Error("URL is required.");
                responseData = await this.apiClient.addUrlSource(projectId, urlPath);
                this.elements.urlInput.value = '';
            } // Add Azure cases if implemented

            if (responseData && responseData.success !== false) {
                this.uiManager.showGlobalStatus(`Image source added. Added: ${responseData.images_added || 0}, Skipped: ${responseData.images_skipped_duplicates || 0}.`, 'success');
                await this.fetchAndDisplayImageSources();
                 this.Utils.dispatchCustomEvent('sources-updated', { sources: responseData.sources_list || [] }); // Assuming backend sends updated list
            } else {
                throw new Error(responseData.error || "Failed to add image source.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error adding source: ${error.message}`, 'error');
        }
    }

    async fetchAndDisplayImageSources() {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId || !this.elements.imageSourcesListContainer) return;

        this.elements.imageSourcesListContainer.innerHTML = '<p><em>Loading sources...</em></p>';
        try {
            const data = await this.apiClient.listImageSources(projectId);
            if (data.success) {
                this.elements.imageSourcesListContainer.innerHTML = ''; // Clear list
                if (data.sources.length === 0) {
                    this.elements.imageSourcesListContainer.innerHTML = '<p><em>No image sources added yet for this project.</em></p>';
                } else {
                    const ul = document.createElement('ul');
                    ul.className = 'image-sources-list';
                    data.sources.forEach(source => {
                        const li = document.createElement('li');
                        let detailsDisplay = this.Utils.escapeHTML(source.details.path || source.details.url || source.id);
                        if (detailsDisplay.length > 50) detailsDisplay = detailsDisplay.substring(0, 47) + "...";
                        
                        li.innerHTML = `<span>Type: ${this.Utils.escapeHTML(source.type)}, Details: ${detailsDisplay}, Images: ${source.image_count || 0}</span>`;
                        
                        const removeBtn = document.createElement('button');
                        removeBtn.textContent = 'Remove';
                        removeBtn.className = 'remove-source-btn';
                        removeBtn.title = `Remove source ${source.source_id}`;
                        removeBtn.onclick = (e) => {
                            e.stopPropagation(); // Prevent li click if any
                            this.handleRemoveImageSource(source.source_id);
                        };
                        li.appendChild(removeBtn);
                        ul.appendChild(li);
                    });
                    this.elements.imageSourcesListContainer.appendChild(ul);
                }
                this.Utils.dispatchCustomEvent('sources-updated', { sources: data.sources });
            } else {
                 this.elements.imageSourcesListContainer.innerHTML = '<p><em>Error loading sources.</em></p>';
            }
        } catch (error) {
            this.elements.imageSourcesListContainer.innerHTML = '<p><em>Network error loading sources.</em></p>';
            this.uiManager.showGlobalStatus(`Error fetching image sources: ${error.message}`, 'error');
        }
    }

    async handleRemoveImageSource(sourceId) {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) return;
        if (!confirm(`Are you sure you want to remove source ${sourceId}? Associated images might be orphaned if not part of other sources.`)) return;
        
        this.uiManager.showGlobalStatus(`Removing source ${sourceId}...`, 'loading', 0);
        try {
            const data = await this.apiClient.removeImageSource(projectId, sourceId);
            if (data.success) {
                this.uiManager.showGlobalStatus("Image source removed.", 'success');
                await this.fetchAndDisplayImageSources();
                this.Utils.dispatchCustomEvent('sources-updated', { sources: data.sources_list || [] });
            } else {
                throw new Error(data.error || "Failed to remove source.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error removing source: ${error.message}`, 'error');
        }
    }
}

// Instantiate when DOM is ready, typically done by main.js
// Example:
// document.addEventListener('DOMContentLoaded', () => {
//     if (window.apiClient && window.stateManager && window.uiManager && window.Utils && !window.projectHandler) {
//         window.projectHandler = new ProjectHandler(window.apiClient, window.stateManager, window.uiManager, window.Utils);
//     }
// });