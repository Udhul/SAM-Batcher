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
            projectsListContainer: document.getElementById('projects-list-container'),
            uploadProjectDbInput: document.getElementById('upload-project-db-input'),
            downloadProjectDbBtn: document.getElementById('download-project-db-btn'),
            projectManagementBar: document.getElementById('project-management-bar'),
            projectOverlay: document.getElementById('project-management-overlay'),
            projectOverlayClose: document.getElementById('close-project-overlay'),
            activeProjectDisplay: document.getElementById('active-project-display'),

            manageSourcesBtn: document.getElementById('manage-sources-btn'),
            sourceOverlay: document.getElementById('source-management-overlay'),
            sourceOverlayClose: document.getElementById('close-source-overlay'),
            folderAddBtn: document.getElementById('add-folder-source-btn'),
            urlAddBtn: document.getElementById('add-url-source-btn'),
            azureAddBtn: document.getElementById('add-azure-source-btn'),
            folderPathInput: document.getElementById('image-source-folder-path'),
            urlInput: document.getElementById('image-source-url-path'),
            azureUriInput: document.getElementById('image-source-azure-uri'),
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
        if (this.elements.uploadProjectDbInput) {
             this.elements.uploadProjectDbInput.addEventListener('change', (e) => this.handleUploadProjectDb(e.target.files[0]));
        }
        if (this.elements.downloadProjectDbBtn) {
            this.elements.downloadProjectDbBtn.addEventListener('click', () => this.handleDownloadProjectDb());
        }
        if (this.elements.manageSourcesBtn) {
            this.elements.manageSourcesBtn.addEventListener('click', () => this.showSourcesOverlay());
        }
        if (this.elements.sourceOverlayClose) {
            this.elements.sourceOverlayClose.addEventListener('click', () => this.hideSourcesOverlay());
        }
        if (this.elements.folderAddBtn) {
            this.elements.folderAddBtn.addEventListener('click', () => this.handleAddImageSource('folder'));
        }
        if (this.elements.urlAddBtn) {
            this.elements.urlAddBtn.addEventListener('click', () => this.handleAddImageSource('url'));
        }
        if (this.elements.azureAddBtn) {
            this.elements.azureAddBtn.addEventListener('click', () => this.handleAddImageSource('azure'));
        }
        if (this.elements.projectManagementBar && this.elements.projectOverlay) {
            this.elements.projectManagementBar.addEventListener('click', () => this.showOverlay());
        }
        if (this.elements.projectOverlayClose) {
            this.elements.projectOverlayClose.addEventListener('click', () => this.hideOverlay());
        }
        if (this.elements.projectsListContainer) {
            this.elements.projectsListContainer.addEventListener('click', (e) => {
                const li = e.target.closest('li[data-project-id]');
                if (!li) return;
                const pid = li.dataset.projectId;
                const pname = li.dataset.projectName;
                if (e.target.classList.contains('rename-project-btn')) {
                    e.stopPropagation();
                    this.handleRenameProject(pid, pname);
                } else if (e.target.classList.contains('delete-project-btn')) {
                    e.stopPropagation();
                    this.handleDeleteProject(pid, pname);
                } else {
                    this.handleLoadProject(pid);
                }
            });
        }
    }
    
    _updateActiveProjectDisplay() {
        const projectId = this.stateManager.getActiveProjectId();
        const projectName = this.stateManager.getActiveProjectName();
        if (this.elements.activeProjectDisplay) {
            if (projectId && projectName) {
                this.elements.activeProjectDisplay.textContent = `Active: ${this.Utils.escapeHTML(projectName)} (${projectId.substring(0,6)}...)`;
                this.elements.activeProjectDisplay.className = 'status-inline loaded';
                this.elements.downloadProjectDbBtn.disabled = false;
            } else {
                this.elements.activeProjectDisplay.textContent = 'No active project';
                this.elements.activeProjectDisplay.className = 'status-inline error';
                this.elements.downloadProjectDbBtn.disabled = true;
            }
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

    showSourcesOverlay() {
        if (this.elements.sourceOverlay) {
            this.fetchAndDisplayImageSources();
            this.Utils.showElement(this.elements.sourceOverlay, 'flex');
        }
    }

    hideSourcesOverlay() {
        if (this.elements.sourceOverlay) {
            this.Utils.hideElement(this.elements.sourceOverlay);
        }
    }

    _checkAndShowModelOverlay() {
        // Check if model is already loaded by looking at the model status
        const modelStatusInline = document.getElementById('model-status-inline');
        const isModelLoaded = modelStatusInline && modelStatusInline.classList.contains('loaded');
        
        if (!isModelLoaded) {
            // Show model overlay
            const modelOverlay = document.getElementById('model-management-overlay');
            if (modelOverlay && this.Utils.showElement) {
                this.Utils.showElement(modelOverlay, 'flex');
            }
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
                
                // Check if a model is already loaded, if not, show model overlay
                this._checkAndShowModelOverlay();
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
        if (!this.elements.projectsListContainer) return;
        this.elements.projectsListContainer.innerHTML = '<p><em>Loading projects...</em></p>';
        try {
            const data = await this.apiClient.listProjects();
            if (data.success) {
                if (data.projects && data.projects.length > 0) {
                    data.projects.sort((a,b) => new Date(b.last_modified) - new Date(a.last_modified));
                    const ul = document.createElement('ul');
                    ul.className = 'projects-list';
                    data.projects.forEach(p => {
                        const li = document.createElement('li');
                        li.dataset.projectId = p.id;
                        li.dataset.projectName = p.name;
                        const label = document.createElement('span');
                        label.textContent = `${this.Utils.escapeHTML(p.name)} (${p.id.substring(0,6)}...)`;
                        const actions = document.createElement('span');
                        actions.className = 'project-actions';
                        const renameBtn = document.createElement('button');
                        renameBtn.className = 'rename-project-btn';
                        renameBtn.textContent = 'Rename';
                        const delBtn = document.createElement('button');
                        delBtn.className = 'delete-project-btn';
                        delBtn.textContent = 'Delete';
                        actions.appendChild(renameBtn);
                        actions.appendChild(delBtn);
                        li.appendChild(label);
                        li.appendChild(actions);
                        ul.appendChild(li);
                    });
                    this.elements.projectsListContainer.innerHTML = '';
                    this.elements.projectsListContainer.appendChild(ul);
                } else {
                    this.elements.projectsListContainer.innerHTML = '<p><em>No projects found.</em></p>';
                }
            } else {
                this.elements.projectsListContainer.innerHTML = '<p><em>Error loading projects.</em></p>';
                this.uiManager.showGlobalStatus(`Error fetching projects: ${data.error}`, 'error');
            }
        } catch (error) {
            this.elements.projectsListContainer.innerHTML = '<p><em>Network error loading projects.</em></p>';
            this.uiManager.showGlobalStatus(`Network error fetching projects: ${error.message}`, 'error');
        }
    }

    async handleLoadProject(projectId) {
        if (!projectId) return;
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
                await this.fetchAndDisplayProjects();
                this.hideOverlay();
                
                // Check if a model is already loaded, if not, show model overlay
                this._checkAndShowModelOverlay();
            } else {
                throw new Error(data.error || "Failed to load project.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error loading project: ${error.message}`, 'error');
            this.Utils.dispatchCustomEvent('project-load-failed', { error: error.message });
            console.error("ProjectHandler: Load project error", error);
        }
    }

    async handleRenameProject(projectId, currentName) {
        const newName = prompt('Enter new project name:', currentName || '');
        if (!newName || newName.trim() === '' || newName === currentName) return;
        this.uiManager.showGlobalStatus('Renaming project...', 'loading', 0);
        try {
            const data = await this.apiClient.renameProject(projectId, newName.trim());
            if (data.success) {
                if (this.stateManager.getActiveProjectId() === projectId) {
                    this.stateManager.setActiveProject(projectId, newName.trim());
                }
                await this.fetchAndDisplayProjects();
                this.uiManager.showGlobalStatus('Project renamed.', 'success');
            } else {
                throw new Error(data.error || 'Failed to rename project');
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error renaming project: ${error.message}`, 'error');
        }
    }

    async handleDeleteProject(projectId, name) {
        let msg = `Are you sure you want to delete project '${name}'?`;
        if (this.stateManager.getActiveProjectId() === projectId) {
            msg = `Delete active project '${name}'? It will be unloaded.`;
        }
        if (!confirm(msg)) return;
        this.uiManager.showGlobalStatus('Deleting project...', 'loading', 0);
        try {
            const data = await this.apiClient.deleteProject(projectId);
            if (data.success) {
                if (this.stateManager.getActiveProjectId() === projectId) {
                    this.stateManager.setActiveProject(null, null);
                    await this.fetchAndDisplayImageSources();
                }
                await this.fetchAndDisplayProjects();
                this.uiManager.showGlobalStatus('Project deleted.', 'success');
            } else {
                throw new Error(data.error || 'Failed to delete project');
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error deleting project: ${error.message}`, 'error');
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

                // Check if a model is already loaded, if not, show model overlay
                this._checkAndShowModelOverlay();
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

    async handleAddImageSource(type = null) {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) {
            this.uiManager.showGlobalStatus("No active project. Create or load a project first.", "error");
            return;
        }
        const sourceType = type || (this.elements.sourceTypeSelect ? this.elements.sourceTypeSelect.value : null);
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
            } else if (sourceType === 'azure') {
                const uri = this.elements.azureUriInput.value.trim();
                if(!uri) throw new Error("Azure URI is required.");
                responseData = await this.apiClient.addAzureSource(projectId, uri);
                this.elements.azureUriInput.value = '';
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
                this.elements.imageSourcesListContainer.innerHTML = '';
                if (data.sources.length === 0) {
                    this.elements.imageSourcesListContainer.innerHTML = '<p><em>No image sources added yet for this project.</em></p>';
                } else {
                    for (const source of data.sources) {
                        const detailsEl = document.createElement('details');
                        const summary = document.createElement('summary');
                        const headerSpan = document.createElement('span');
                        let info = this.Utils.escapeHTML(source.details.path || source.details.url || source.source_id);
                        if (info.length > 50) info = info.substring(0,47) + '...';
                        headerSpan.textContent = `${source.type}: ${info} (Images: ${source.image_count || 0})`;
                        const removeBtn = document.createElement('button');
                        removeBtn.textContent = 'Remove';
                        removeBtn.className = 'remove-source-btn';
                        removeBtn.onclick = (e) => { e.stopPropagation(); this.handleRemoveImageSource(source.source_id); };
                        summary.appendChild(headerSpan);
                        summary.appendChild(removeBtn);
                        detailsEl.appendChild(summary);

                        const imgList = document.createElement('ul');
                        imgList.className = 'source-images';
                        try {
                            const imgData = await this.apiClient.listImagesForSource(projectId, source.source_id);
                            if (imgData.success && Array.isArray(imgData.images)) {
                                imgData.images.forEach(img => {
                                    const li = document.createElement('li');
                                    const cb = document.createElement('input');
                                    cb.type = 'checkbox';
                                    cb.checked = !img.exempted;
                                    cb.onchange = (e) => this.handleToggleSourceImage(source.source_id, img.image_hash, e.target.checked);
                                    const label = document.createElement('span');
                                    const name = this.Utils.escapeHTML(img.original_filename || img.image_hash);
                                    label.textContent = name.length > 40 ? name.substring(0,37) + '...' : name;
                                    li.appendChild(cb);
                                    li.appendChild(label);
                                    imgList.appendChild(li);
                                });
                            } else {
                                imgList.innerHTML = '<li><em>Error loading images</em></li>';
                            }
                        } catch (err) {
                            imgList.innerHTML = '<li><em>Error loading images</em></li>';
                        }
                        detailsEl.appendChild(imgList);
                        this.elements.imageSourcesListContainer.appendChild(detailsEl);
                    }
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

    async handleToggleSourceImage(sourceId, imageHash, include) {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) return;
        try {
            await this.apiClient.setImageExempt(projectId, sourceId, imageHash, !include);
            this.Utils.dispatchCustomEvent('sources-updated', {});
        } catch (err) {
            this.uiManager.showGlobalStatus(`Error updating image: ${err.message}`, 'error');
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