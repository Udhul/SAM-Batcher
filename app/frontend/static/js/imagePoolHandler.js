// project_root/app/frontend/static/js/imagePoolHandler.js

/**
 * @file imagePoolHandler.js
 * @description Manages UI and logic for the image pool/gallery, image navigation,
 * and setting the active image for annotation.
 *
 * Responsibilities:
 * - Display the list/gallery of images in the current project.
 * - Handle image navigation (next/previous, selecting specific image).
 * - Communicate with apiClient.js to fetch image lists and set the active image.
 * - When an image is activated, pass its data (base64, dimensions, existing masks)
 *   to canvasController.js (via an event caught by main.js).
 * - Handle UI for updating image status.
 *
 * External Dependencies:
 * - apiClient.js
 * - utils.js
 * - stateManager.js (to get activeProjectId, set activeImageHash)
 * - uiManager.js (for status messages)
 *
 * Input/Output (I/O):
 * Input:
 *   - DOM Elements: #image-gallery-container, #next-image-btn, #prev-image-btn,
 *                   #image-status-updater-btn, pagination controls.
 *   - Event: `project-loaded` (from projectHandler/main.js to trigger initial image list load).
 *   - Event: `active-project-changed` (from stateManager)
 *
 * Output:
 *   - Calls to apiClient.js: `listImages`, `setActiveImage`, `updateImageStatus`.
 *   - Updates UI: Populates image gallery, updates navigation button states.
 *   - Custom DOM Events:
 *     - `active-image-set`: Detail: { imageHash, filename, width, height, imageDataBase64, existingMasks }
 *     - `image-pool-updated`: Detail: { images: Array, pagination: object }
 */
class ImagePoolHandler {
    constructor(apiClient, stateManager, uiManager) {
        this.apiClient = apiClient;
        this.stateManager = stateManager;
        this.uiManager = uiManager;

        this.elements = {
            // imageGalleryContainer: document.getElementById('image-gallery-container'),
            // nextUnprocessedBtn: document.getElementById('next-unprocessed-image-btn'),
            // imagePoolSection: document.getElementById('image-pool-expandable'), // If it's expandable
            // Pagination elements if implemented
        };

        this.currentPage = 1;
        this.perPage = 20; // Configurable
        this.currentStatusFilter = null; // e.g., 'unprocessed'

        this._setupEventListeners();
        this._initializeImagePoolSectionUI(); // If section exists
        console.log("ImagePoolHandler initialized");

        // Listen for project changes to reload image pool
        document.addEventListener('state-changed-activeProjectId', (event) => {
            if (event.detail.newValue) { // new projectId is set
                // this.loadAndDisplayImagePool();
            } else { // project cleared
                // this.clearImagePoolDisplay();
            }
        });
    }

    _setupEventListeners() {
        // if (this.elements.nextUnprocessedBtn) {
        //     this.elements.nextUnprocessedBtn.addEventListener('click', () => this.loadNextUnprocessedImage());
        // }
        // Add listeners for gallery item clicks, pagination, filters etc.
    }

     _initializeImagePoolSectionUI() {
        if (this.elements.imagePoolSection) {
            const header = this.elements.imagePoolSection.querySelector('.expandable-header');
            if (header && this.uiManager) {
                this.uiManager.initializeExpandableSection(header, true); // Start collapsed
            }
        }
    }

    async loadAndDisplayImagePool(page = 1, statusFilter = null) {
        // const projectId = this.stateManager.getActiveProjectId();
        // if (!projectId || !this.elements.imageGalleryContainer) return;

        // this.currentPage = page;
        // this.currentStatusFilter = statusFilter;

        // this.uiManager.showGlobalStatus("Loading image pool...", "loading", 0);
        // try {
        //     const data = await this.apiClient.listImages(projectId, this.currentPage, this.perPage, this.currentStatusFilter);
        //     if (data.success) {
        //         this.elements.imageGalleryContainer.innerHTML = ''; // Clear previous
        //         if (data.images.length === 0) {
        //             this.elements.imageGalleryContainer.innerHTML = '<p>No images found for current filter.</p>';
        //         } else {
        //             data.images.forEach(img => {
        //                 const imgCard = this._createImageCard(img);
        //                 this.elements.imageGalleryContainer.appendChild(imgCard);
        //             });
        //         }
        //         // this._renderPagination(data.pagination);
        //         Utils.dispatchCustomEvent('image-pool-updated', { images: data.images, pagination: data.pagination });
        //         this.uiManager.clearGlobalStatus();
        //     } else {
        //         throw new Error(data.error || "Failed to load image pool.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error loading image pool: ${error.message}`, 'error');
        //     console.error("ImagePoolHandler: Load pool error", error);
        // }
    }

    _createImageCard(imgData) {
        // const card = document.createElement('div');
        // card.className = 'image-card'; // Style this class
        // card.dataset.imageHash = imgData.image_hash;

        // const thumb = document.createElement('img');
        // thumb.src = this.apiClient.getImageThumbnailUrl(this.stateManager.getActiveProjectId(), imgData.image_hash);
        // thumb.alt = imgData.original_filename || 'Image';
        // thumb.onerror = () => { thumb.src = 'path/to/default/thumbnail.png'; }; // Fallback

        // const name = document.createElement('p');
        // name.textContent = Utils.escapeHTML(imgData.original_filename) || `Hash: ${imgData.image_hash.substring(0,10)}...`;
        // name.title = name.textContent; // Full name on hover

        // const status = document.createElement('span');
        // status.className = `image-status ${imgData.status}`; // Style based on status
        // status.textContent = imgData.status;

        // card.appendChild(thumb);
        // card.appendChild(name);
        // card.appendChild(status);

        // card.addEventListener('click', () => this.handleSelectImage(imgData.image_hash));
        // return card;
        return document.createElement('div'); // Placeholder
    }

    async handleSelectImage(imageHash) {
        // const projectId = this.stateManager.getActiveProjectId();
        // if (!projectId) return;

        // this.uiManager.showGlobalStatus(`Loading image '${imageHash.substring(0,10)}...'`, 'loading', 0);
        // try {
        //     const data = await this.apiClient.setActiveImage(projectId, imageHash); // API Call
        //     if (data.success) {
        //         this.stateManager.setActiveImage(data.image_hash, data.filename);
        //         Utils.dispatchCustomEvent('active-image-set', {
        //             imageHash: data.image_hash,
        //             filename: data.filename,
        //             width: data.width,
        //             height: data.height,
        //             imageDataBase64: data.image_data, // Base64 string
        //             existingMasks: data.masks // Array of mask layer objects from DB
        //         });
        //         this.uiManager.clearGlobalStatus();
        //         // Highlight selected image in gallery
        //         // this._highlightSelectedImageCard(imageHash);
        //     } else {
        //         throw new Error(data.error || "Failed to set active image.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error loading image: ${error.message}`, 'error');
        //     console.error("ImagePoolHandler: Select image error", error);
        // }
    }

    async loadNextUnprocessedImage() {
        // const projectId = this.stateManager.getActiveProjectId();
        // if (!projectId) return;
        // const currentHash = this.stateManager.getActiveImageHash();
        // try {
        //     const data = await this.apiClient.getNextUnprocessedImage(projectId, currentHash);
        //     if (data.success && data.image_hash) {
        //         await this.handleSelectImage(data.image_hash);
        //     } else if (data.success && data.message) { // "No more unprocessed images"
        //         this.uiManager.showGlobalStatus(data.message, 'info');
        //     } else {
        //          throw new Error(data.error || "Failed to get next unprocessed image.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error: ${error.message}`, 'error');
        // }
    }

    async handleUpdateImageStatus(imageHash, newStatus) {
        // const projectId = this.stateManager.getActiveProjectId();
        // if (!projectId) return;
        // try {
        //     const data = await this.apiClient.updateImageStatus(projectId, imageHash, newStatus);
        //     if (data.success) {
        //         this.uiManager.showGlobalStatus(`Image ${imageHash.substring(0,6)} status updated to ${newStatus}.`, 'success', 3000);
        //         // Refresh image pool or update specific card
        //         // this.loadAndDisplayImagePool(this.currentPage, this.currentStatusFilter);
        //     } else {
        //         throw new Error(data.error || "Failed to update status.");
        //     }
        // } catch (error) {
        //     this.uiManager.showGlobalStatus(`Error updating status: ${error.message}`, 'error');
        // }
    }

    clearImagePoolDisplay() {
        // if (this.elements.imageGalleryContainer) {
        //     this.elements.imageGalleryContainer.innerHTML = '<p>Load or create a project to see images.</p>';
        // }
        // Clear pagination too
    }
}

// Instantiate when DOM is ready, typically done by main.js
// document.addEventListener('DOMContentLoaded', () => {
//     if (window.apiClient && window.stateManager && window.uiManager && !window.imagePoolHandler) {
//         window.imagePoolHandler = new ImagePoolHandler(window.apiClient, window.stateManager, window.uiManager);
//     }
// });