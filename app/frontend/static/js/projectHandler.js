// project_root/app/frontend/static/js/projectHandler.js

/**
 * @file projectHandler.js
 * @description Manages UI and logic related to project creation, loading,
 * and image source management.
 *
 * Responsibilities:
 * - Handle UI for creating new projects.
 * - Handle UI for listing and loading existing projects (from server or uploaded DB).
 * - Manage UI for adding/removing image sources (uploads, server folders, URLs, Azure).
 * - Interact with apiClient.js for all backend project/source operations.
 * - Update relevant UI sections based on backend responses.
 * - Dispatch events related to project state changes (e.g., project-loaded, sources-updated).
 *
 * External Dependencies:
 * - apiClient.js (for backend communication).
 * - utils.js (for DOM helpers).
 * - stateManager.js (to update global activeProjectId).
 *
 * Input/Output (I/O):
 * Input:
 *   - DOM Elements for project controls (e.g., #create-project-btn, #project-list,
 *     #add-source-btn, #source-type-select, source input fields).
 *   - User interactions with these elements.
 *
 * Output:
 *   - Calls to apiClient.js methods (e.g., `createProject`, `listProjects`, `addUploadSource`).
 *   - Updates UI elements (e.g., populating project list, source list).
 *   - Custom DOM Events:
 *     - `project-loaded`: Detail: { projectId: string, projectName: string, projectData: object }
 *     - `project-created`: Detail: { projectId: string, projectName: string }
 *     - `project-load-failed`: Detail: { error: string }
 *     - `sources-updated`: Detail: { sources: Array }
 *     - `active-project-changed`: Detail: { projectId: string, projectName: string } (alternative to direct stateManager update)
 */
class ProjectHandler {
    constructor(apiClient, stateManager, uiManager) {
        this.apiClient = apiClient;
        this.stateManager = stateManager;
        this.uiManager = uiManager; // For showing status messages

        this.elements = {
            // Project section elements (assuming they will be added to index.html)
            // createProjectBtn: document.getElementById('create-project-btn'),
            // projectNameInput: document.getElementById('new-project-name-input'),
            // loadProjectSelect: document.getElementById('load-project-select'), // Or a list
            // loadSelectedProjectBtn: document.getElementById('load-selected-project-btn'),
            // uploadProjectDbInput: document.getElementById('upload-project-db-input'),
            // projectManagementSection: document.getElementById('project-management-expandable'),

            // Image Source elements (assuming they will be added)
            // addSourceBtn: document.getElementById('add-image-source-btn'),
            // sourceTypeSelect: document.getElementById('image-source-type-select'),
            // folderPathInput: document.getElementById('image-source-folder-path'),
            // urlInput: document.getElementById('image-source-url'),
            // azureUriInput: document.getElementById('image-source-azure-uri'),
            // imageSourcesList: document.getElementById('image-sources-list-container'),
        };
        this._setupEventListeners();
        this._initializeProjectSectionUI(); // If section exists
        console.log("ProjectHandler initialized");
    }

    _setupEventListeners() {
        // Example:
        // if (this.elements.createProjectBtn) {
        //     this.elements.createProjectBtn.addEventListener('click', () => this.handleCreateProject());
        // }
        // if (this.elements.loadSelectedProjectBtn) {
        //     this.elements.loadSelectedProjectBtn.addEventListener('click', () => this.handleLoadSelectedProject());
        // }
        // if (this.elements.uploadProjectDbInput) {
        //      this.elements.uploadProjectDbInput.addEventListener('change', (e) => this.handleUploadProjectDb(e.target.files[0]));
        // }
        // ... more listeners for source management UI ...
    }

    _initializeProjectSectionUI() {
        // Initialize the expandable section if it exists
        if (this.elements.projectManagementSection) {
            const header = this.elements.projectManagementSection.querySelector('.expandable-header');
            if (header && this.uiManager) {
                this.uiManager.initializeExpandableSection(header, true); // Start collapsed
            }
        }
        // Fetch initial list of projects
        // this.fetchAndDisplayProjects();
    }

    // --- Project Lifecycle Methods ---
    async handleCreateProject() {
        const projectName = this.elements.projectNameInput ? this.elements.projectNameInput.value.trim() : null;
        this.uiManager.showGlobalStatus('Creating project...', 'loading', 0);
        try {
            const data = await this.apiClient.createProject(projectName); // API Call
            if (data.success) {
                this.stateManager.setActiveProject(data.project_id, data.project_name);
                this.uiManager.showGlobalStatus(`Project '${data.project_name}' created and loaded.`, 'success');
                Utils.dispatchCustomEvent('project-created', { projectId: data.project_id, projectName: data.project_name });
                Utils.dispatchCustomEvent('project-loaded', { projectId: data.project_id, projectName: data.project_name, projectData: data });
                // await this.fetchAndDisplayProjects(); // Refresh project list
                // await this.fetchAndDisplayImageSources(); // Clear/load sources for new project
            } else {
                throw new Error(data.error || "Failed to create project.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error creating project: ${error.message}`, 'error');
            Utils.dispatchCustomEvent('project-load-failed', { error: error.message });
            console.error("ProjectHandler: Create project error", error);
        }
    }

    async fetchAndDisplayProjects() {
        // if (!this.elements.loadProjectSelect) return;
        // try {
        //     const data = await this.apiClient.listProjects(); // API Call
        //     if (data.success) {
        //         this.elements.loadProjectSelect.innerHTML = '<option value="">Select a project to load...</option>';
        //         data.projects.forEach(p => {
        //             const option = document.createElement('option');
        //             option.value = p.id;
        //             option.textContent = `${p.name} (ID: ${p.id.substring(0,6)}... Last Modified: ${new Date(p.last_modified).toLocaleDateString()})`;
        //             this.elements.loadProjectSelect.appendChild(option);
        //         });
        //     } else {
        //         this.uiManager.showGlobalStatus(`Error fetching projects: ${data.error}`, 'error');
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Network error fetching projects: ${error.message}`, 'error');
        // }
    }

    async handleLoadSelectedProject() {
        // const projectId = this.elements.loadProjectSelect.value;
        // if (!projectId) {
        //     this.uiManager.showGlobalStatus("Please select a project to load.", 'info');
        //     return;
        // }
        // this.uiManager.showGlobalStatus(`Loading project ${projectId.substring(0,6)}...`, 'loading', 0);
        // try {
        //     const data = await this.apiClient.loadProject(projectId); // API Call
        //     if (data.success) {
        //         this.stateManager.setActiveProject(data.project_data.project_id, data.project_data.project_name);
        //         this.uiManager.showGlobalStatus(`Project '${data.project_data.project_name}' loaded.`, 'success');
        //         Utils.dispatchCustomEvent('project-loaded', {
        //             projectId: data.project_data.project_id,
        //             projectName: data.project_data.project_name,
        //             projectData: data.project_data
        //         });
        //         // await this.fetchAndDisplayImageSources();
        //     } else {
        //         throw new Error(data.error || "Failed to load project.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error loading project: ${error.message}`, 'error');
        //     Utils.dispatchCustomEvent('project-load-failed', { error: error.message });
        //     console.error("ProjectHandler: Load project error", error);
        // }
    }

    async handleUploadProjectDb(file) {
        // if (!file) return;
        // this.uiManager.showGlobalStatus(`Uploading project DB '${file.name}'...`, 'loading', 0);
        // const formData = new FormData();
        // formData.append('db_file', file);
        // try {
        //     const data = await this.apiClient.uploadProjectDb(formData); // API Call
        //     if (data.success) {
        //         this.stateManager.setActiveProject(data.project_data.project_id, data.project_data.project_name);
        //         this.uiManager.showGlobalStatus(`Project DB '${data.project_data.project_name}' uploaded and loaded.`, 'success');
        //         Utils.dispatchCustomEvent('project-loaded', {
        //             projectId: data.project_data.project_id,
        //             projectName: data.project_data.project_name,
        //             projectData: data.project_data
        //         });
        //         // await this.fetchAndDisplayProjects(); // Refresh list
        //         // await this.fetchAndDisplayImageSources();
        //     } else {
        //         throw new Error(data.error || "Failed to upload project DB.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error uploading project DB: ${error.message}`, 'error');
        //     console.error("ProjectHandler: Upload DB error", error);
        // }
    }


    // --- Image Source Management Methods ---
    async handleAddImageSource() {
        // const projectId = this.stateManager.getActiveProjectId();
        // if (!projectId) {
        //     this.uiManager.showGlobalStatus("No active project. Create or load a project first.", "error");
        //     return;
        // }
        // const sourceType = this.elements.sourceTypeSelect.value;
        // let responseData;
        // try {
        //     this.uiManager.showGlobalStatus(`Adding image source (${sourceType})...`, 'loading', 0);
        //     if (sourceType === 'upload') {
        //         // This would typically be handled by a separate file input in imagePoolHandler or similar
        //         // For now, assume files are already selected via some mechanism.
        //         // const files = ... get files from an input element ...
        //         // const formData = new FormData();
        //         // files.forEach(file => formData.append('files', file));
        //         // responseData = await this.apiClient.addUploadSource(projectId, formData);
        //         this.uiManager.showGlobalStatus("Upload source via 'Load Image' button in canvas toolbar.", "info");
        //         return;
        //     } else if (sourceType === 'folder') {
        //         // const folderPath = this.elements.folderPathInput.value.trim();
        //         // if (!folderPath) throw new Error("Folder path is required.");
        //         // responseData = await this.apiClient.addFolderSource(projectId, folderPath);
        //     } // Add URL, Azure cases
        //
        //     if (responseData && responseData.success !== false) { // Check for explicit false
        //         this.uiManager.showGlobalStatus(`Image source added. Added: ${responseData.images_added || 0}, Skipped: ${responseData.images_skipped_duplicates || 0}.`, 'success');
        //         // await this.fetchAndDisplayImageSources();
        //     } else {
        //         throw new Error(responseData.error || "Failed to add image source.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error adding source: ${error.message}`, 'error');
        // }
    }

    async fetchAndDisplayImageSources() {
        // const projectId = this.stateManager.getActiveProjectId();
        // if (!projectId || !this.elements.imageSourcesList) return;
        // try {
        //     const data = await this.apiClient.listImageSources(projectId); // API Call
        //     if (data.success) {
        //         this.elements.imageSourcesList.innerHTML = ''; // Clear list
        //         if (data.sources.length === 0) {
        //             this.elements.imageSourcesList.innerHTML = '<p>No image sources added yet.</p>';
        //         } else {
        //             const ul = document.createElement('ul');
        //             data.sources.forEach(source => {
        //                 const li = document.createElement('li');
        //                 li.textContent = `Type: ${source.type}, Details: ${JSON.stringify(source.details)}, Images: ${source.image_count}`;
        //                 // Add remove button
        //                 const removeBtn = document.createElement('button');
        //                 removeBtn.textContent = 'Remove';
        //                 removeBtn.onclick = () => this.handleRemoveImageSource(source.source_id);
        //                 li.appendChild(removeBtn);
        //                 ul.appendChild(li);
        //             });
        //             this.elements.imageSourcesList.appendChild(ul);
        //         }
        //         Utils.dispatchCustomEvent('sources-updated', { sources: data.sources });
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error fetching image sources: ${error.message}`, 'error');
        // }
    }

    async handleRemoveImageSource(sourceId) {
        // const projectId = this.stateManager.getActiveProjectId();
        // if (!projectId) return;
        // if (!confirm(`Are you sure you want to remove source ${sourceId}? Associated images might be orphaned.`)) return;
        // try {
        //     this.uiManager.showGlobalStatus(`Removing source ${sourceId}...`, 'loading', 0);
        //     const data = await this.apiClient.removeImageSource(projectId, sourceId); // API Call
        //     if (data.success) {
        //         this.uiManager.showGlobalStatus("Image source removed.", 'success');
        //         // await this.fetchAndDisplayImageSources();
        //     } else {
        //         throw new Error(data.error || "Failed to remove source.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error removing source: ${error.message}`, 'error');
        // }
    }
}

// Instantiate when DOM is ready, typically done by main.js
// document.addEventListener('DOMContentLoaded', () => {
//     if (window.apiClient && window.stateManager && window.uiManager && !window.projectHandler) {
//         window.projectHandler = new ProjectHandler(window.apiClient, window.stateManager, window.uiManager);
//     }
// });