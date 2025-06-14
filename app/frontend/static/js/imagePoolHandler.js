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
 * - When an image is activated, dispatch event with its data for canvasController.js (via main.js).
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
 *   - DOM Elements: #image-gallery-container, navigation buttons, filters.
 *   - Event: `project-loaded` or `state-changed-activeProjectId` to trigger image list load.
 *   - Event: `sources-updated` to trigger image list refresh.
 *
 * Output:
 *   - Calls to apiClient.js: `listImages`, `setActiveImage`, `updateImageStatus`.
 *   - Updates UI: Populates image gallery, updates navigation button states.
 *   - Custom DOM Events:
 *     - `active-image-set`: Detail: { imageHash, filename, width, height, imageDataBase64, existingMasks }
 *     - `image-pool-updated`: Detail: { images: Array, pagination: object }
 *     - `image-load-request`: Detail: { imageHash: string } // Alternative to direct setActiveImage
 */
class ImagePoolHandler {
    constructor(apiClient, stateManager, uiManager, Utils) {
        this.apiClient = apiClient;
        this.stateManager = stateManager;
        this.uiManager = uiManager;
        this.Utils = Utils;

        this.elements = {
            imageGalleryContainer: document.getElementById('image-gallery-container'),
            nextUnprocessedBtn: document.getElementById('next-unprocessed-image-btn'),
            prevImageBtn: document.getElementById('prev-image-btn'),
            nextImageBtn: document.getElementById('next-image-btn'),
            currentImageInfo: document.getElementById('current-image-info'),
            statusFilterSelect: document.getElementById('image-status-filter'),
            refreshPoolBtn: document.getElementById('refresh-image-pool-btn'),
            imagePoolStatusInline: document.getElementById('image-pool-status-inline'),
            // Pagination elements to be added if pagination is fully implemented
            // imagePoolPagination: document.getElementById('image-pool-pagination'),
        };

        this.currentPage = 1;
        this.perPage = 20; // Configurable, could be a UI setting
        this.currentStatusFilter = "";
        this.imageList = []; // Store the current list of images for prev/next
        this.currentImageIndex = -1; // Index in this.imageList
        this.latestImageRequestHash = null; // Track latest requested image to avoid race conditions

        this._setupEventListeners();
        this.clearImagePoolDisplay(); // Initial state

        // Listen for project changes to reload image pool
        document.addEventListener('state-changed-activeProjectId', (event) => {
            if (event.detail.newValue) {
                this.currentStatusFilter = this.elements.statusFilterSelect ? this.elements.statusFilterSelect.value : "";
                this.loadAndDisplayImagePool(1, this.currentStatusFilter);
            } else {
                this.clearImagePoolDisplay();
            }
        });
        document.addEventListener('sources-updated', () => { // Refresh pool if sources change
             if (this.stateManager.getActiveProjectId()) {
                this.loadAndDisplayImagePool(1, this.currentStatusFilter);
            }
        });
        document.addEventListener('image-status-updated', () => {
             if (this.stateManager.getActiveProjectId()) {
                this.loadAndDisplayImagePool(this.currentPage, this.currentStatusFilter);
            }
        });
    }

    _setupEventListeners() {
        if (this.elements.nextUnprocessedBtn) {
            this.elements.nextUnprocessedBtn.addEventListener('click', () => this.loadNextUnprocessedImage());
        }
        if (this.elements.prevImageBtn) {
            this.elements.prevImageBtn.addEventListener('click', () => this.navigateToImageIndex(this.currentImageIndex - 1));
        }
        if (this.elements.nextImageBtn) {
            this.elements.nextImageBtn.addEventListener('click', () => this.navigateToImageIndex(this.currentImageIndex + 1));
        }
        if (this.elements.statusFilterSelect) {
            this.elements.statusFilterSelect.addEventListener('change', (e) => {
                this.currentStatusFilter = e.target.value;
                this.loadAndDisplayImagePool(1, this.currentStatusFilter);
            });
        }
        if (this.elements.refreshPoolBtn) {
            this.elements.refreshPoolBtn.addEventListener('click', () => {
                 this.loadAndDisplayImagePool(this.currentPage, this.currentStatusFilter);
            });
        }
    }

    async loadAndDisplayImagePool(page = 1, statusFilter = null) {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) {
            this.clearImagePoolDisplay();
            return;
        }
        if (!this.elements.imageGalleryContainer) return;

        this.currentPage = page;
        this.currentStatusFilter = statusFilter === null ? (this.elements.statusFilterSelect ? this.elements.statusFilterSelect.value : "") : statusFilter;

        this.uiManager.showGlobalStatus("Loading image pool...", "loading", 0);
        if (this.elements.imagePoolStatusInline) this.elements.imagePoolStatusInline.textContent = "Loading...";

        try {
            const data = await this.apiClient.listImages(projectId, this.currentPage, this.perPage, this.currentStatusFilter);
            if (data.success) {
                this.imageList = data.images || [];
                this.elements.imageGalleryContainer.innerHTML = ''; // Clear previous
                
                if (this.imageList.length === 0) {
                    this.elements.imageGalleryContainer.innerHTML = `<p>No images found for '${this.Utils.escapeHTML(this.currentStatusFilter || "All")}' filter.</p>`;
                     if (this.elements.imagePoolStatusInline) this.elements.imagePoolStatusInline.textContent = "No images.";
                } else {
                    this.imageList.forEach(img => {
                        const imgCard = this._createImageCard(img);
                        this.elements.imageGalleryContainer.appendChild(imgCard);
                    });
                     if (this.elements.imagePoolStatusInline) this.elements.imagePoolStatusInline.textContent = `${this.imageList.length} images shown.`;
                }
                // this._renderPagination(data.pagination); // TODO: Implement pagination UI
                this.Utils.dispatchCustomEvent('image-pool-updated', { images: this.imageList, pagination: data.pagination });
                this.uiManager.clearGlobalStatus();
                this._updateNavigationButtons();
                // Update current image index if current active image is in the new list
                const activeHash = this.stateManager.getActiveImageHash();
                if (activeHash) {
                    this.currentImageIndex = this.imageList.findIndex(img => img.image_hash === activeHash);
                } else {
                    this.currentImageIndex = -1;
                }
                this._updateCurrentImageDisplay();

            } else {
                throw new Error(data.error || "Failed to load image pool.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error loading image pool: ${error.message}`, 'error');
            if (this.elements.imagePoolStatusInline) this.elements.imagePoolStatusInline.textContent = "Error.";
            console.error("ImagePoolHandler: Load pool error", error);
        }
    }

    _createImageCard(imgData) {
        const card = document.createElement('div');
        card.className = 'image-card';
        card.dataset.imageHash = imgData.image_hash;
        if (imgData.image_hash === this.stateManager.getActiveImageHash()) {
            card.classList.add('active');
        }

        const thumb = document.createElement('img');
        thumb.src = this.apiClient.getImageThumbnailUrl(this.stateManager.getActiveProjectId(), imgData.image_hash);
        thumb.alt = this.Utils.escapeHTML(imgData.original_filename) || 'Image Thumbnail';
        thumb.onerror = () => {
            if (thumb.src.indexOf('placeholder_thumb.png') === -1) {
                thumb.src = '/assets/placeholder_thumb.png';
            }
        };

        const name = document.createElement('p');
        name.className = 'image-card-name';
        const displayName = this.Utils.escapeHTML(imgData.original_filename) || `Hash: ${imgData.image_hash.substring(0,10)}...`;
        name.textContent = displayName.length > 30 ? displayName.substring(0,27) + "..." : displayName;
        name.title = displayName;

        const status = document.createElement('span');
        status.className = `image-status-badge ${imgData.status || 'unknown'}`;
        status.textContent = (imgData.status || 'unknown').replace(/_/g, ' ');
        status.title = `Status: ${status.textContent}`;

        const delBtn = document.createElement('button');
        delBtn.className = 'delete-image-btn';
        delBtn.textContent = '×';
        delBtn.title = 'Remove image from pool';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            this.handleDeleteImage(imgData.image_hash);
        };

        card.appendChild(delBtn);
        card.appendChild(thumb);
        card.appendChild(name);
        card.appendChild(status);

        card.addEventListener('click', () => this.handleSelectImage(imgData.image_hash));
        return card;
    }
    
    _highlightSelectedImageCard(imageHash) {
        this.elements.imageGalleryContainer.querySelectorAll('.image-card').forEach(card => {
            card.classList.toggle('active', card.dataset.imageHash === imageHash);
        });
    }

    _scrollSelectedImageIntoView(imageHash) {
        const card = this.elements.imageGalleryContainer.querySelector(`.image-card[data-image-hash="${imageHash}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }
    
    _updateNavigationButtons() {
        this.elements.prevImageBtn.disabled = this.currentImageIndex <= 0 || this.imageList.length === 0;
        this.elements.nextImageBtn.disabled = this.currentImageIndex >= this.imageList.length - 1 || this.imageList.length === 0;
    }

    _updateCurrentImageDisplay() {
        const activeImageFilename = this.stateManager.getActiveImageFilename();
        if (activeImageFilename) {
             const displayFilename = activeImageFilename.length > 25 ? activeImageFilename.substring(0,22) + "..." : activeImageFilename;
            this.elements.currentImageInfo.textContent = `Current: ${this.Utils.escapeHTML(displayFilename)}`;
            this.elements.currentImageInfo.title = activeImageFilename;
        } else {
            this.elements.currentImageInfo.textContent = "No image loaded";
            this.elements.currentImageInfo.title = "";
        }
        this._updateNavigationButtons();
    }

    navigateToImageIndex(index) {
        if (index >= 0 && index < this.imageList.length) {
            this.handleSelectImage(this.imageList[index].image_hash);
        }
    }

    async handleSelectImage(imageHash) {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) return;

        this.Utils.dispatchCustomEvent('save-canvas-state', { imageHash: this.stateManager.getActiveImageHash() });

        this.latestImageRequestHash = imageHash;
        const requestedHash = imageHash;

        this.uiManager.showGlobalStatus(`Loading image '${imageHash.substring(0,10)}...'`, 'loading', 0);
        try {
            const data = await this.apiClient.setActiveImage(projectId, imageHash);
            if (this.latestImageRequestHash !== requestedHash) {
                // A newer request has been made, ignore this response
                return;
            }
            if (data.success) {
                this.stateManager.setActiveImage(data.image_hash, data.filename); // filename from server
                this.Utils.dispatchCustomEvent('active-image-set', {
                    imageHash: data.image_hash,
                    filename: data.filename,
                    width: data.width,
                    height: data.height,
                    imageDataBase64: data.image_data, // Base64 string
                    existingMasks: data.masks // Array of mask layer objects from DB
                });
                this.uiManager.clearGlobalStatus();
                this.currentImageIndex = this.imageList.findIndex(img => img.image_hash === data.image_hash);
                this._highlightSelectedImageCard(data.image_hash);
                this._scrollSelectedImageIntoView(data.image_hash);
                this._updateCurrentImageDisplay();
            } else {
                throw new Error(data.error || "Failed to set active image.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error loading image: ${error.message}`, 'error');
            console.error("ImagePoolHandler: Select image error", error);
            this.stateManager.setActiveImage(null, null); // Clear active image on error
            this._updateCurrentImageDisplay();
        } finally {
            if (this.latestImageRequestHash === requestedHash) {
                this.latestImageRequestHash = null;
            }
        }
    }

    async loadNextUnprocessedImage() {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) return;
        
        this.uiManager.showGlobalStatus("Fetching next unprocessed image...", "loading", 0);
        const currentHash = this.stateManager.getActiveImageHash();
        try {
            const data = await this.apiClient.getNextUnprocessedImage(projectId, currentHash);
            if (data.success && data.image_hash) {
                await this.handleSelectImage(data.image_hash);
            } else if (data.success && data.message) { // "No more unprocessed images"
                this.uiManager.showGlobalStatus(data.message, 'info');
            } else {
                 throw new Error(data.error || "Failed to get next unprocessed image.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error: ${error.message}`, 'error');
        }
    }

    async handleUpdateImageStatus(imageHash, newStatus) { // Called from main.js or other modules
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) return;
        this.uiManager.showGlobalStatus(`Updating status for ${imageHash.substring(0,6)}...`, 'loading', 0);
        try {
            const data = await this.apiClient.updateImageStatus(projectId, imageHash, newStatus);
            if (data.success) {
                this.uiManager.showGlobalStatus(`Image ${imageHash.substring(0,6)} status updated to ${newStatus}.`, 'success', 3000);
                // Refresh image pool or update specific card
                this.loadAndDisplayImagePool(this.currentPage, this.currentStatusFilter);
            } else {
                throw new Error(data.error || "Failed to update status.");
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error updating status: ${error.message}`, 'error');
        }
    }

    async handleDeleteImage(imageHash) {
        const projectId = this.stateManager.getActiveProjectId();
        if (!projectId) return;
        this.uiManager.showGlobalStatus('Removing image...', 'loading', 0);
        try {
            const data = await this.apiClient.setImageExempt(projectId, null, imageHash, true);
            if (data.success) {
                this.uiManager.showGlobalStatus('Image excluded.', 'success', 2000);
                this.loadAndDisplayImagePool(this.currentPage, this.currentStatusFilter);
                this.Utils.dispatchCustomEvent('sources-updated', {});
            } else {
                throw new Error(data.error || 'Failed to remove image');
            }
        } catch (error) {
            this.uiManager.showGlobalStatus(`Error removing image: ${error.message}`, 'error');
        }
    }

    clearImagePoolDisplay() {
        if (this.elements.imageGalleryContainer) {
            this.elements.imageGalleryContainer.innerHTML = '<p><em>Load a project to see images.</em></p>';
        }
        if (this.elements.imagePoolStatusInline) this.elements.imagePoolStatusInline.textContent = "";
        this.imageList = [];
        this.currentImageIndex = -1;
        this.stateManager.setActiveImage(null, null);
        this._updateCurrentImageDisplay();
        // Clear pagination too if implemented
    }
}

// Instantiate when DOM is ready, typically done by main.js
// Example:
// document.addEventListener('DOMContentLoaded', () => {
//     if (window.apiClient && window.stateManager && window.uiManager && window.Utils && !window.imagePoolHandler) {
//         window.imagePoolHandler = new ImagePoolHandler(window.apiClient, window.stateManager, window.uiManager, window.Utils);
//     }
// });