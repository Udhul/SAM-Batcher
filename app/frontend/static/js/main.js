// project_root/app/frontend/static/js/main.js

/**
 * @file main.js
 * @description Main frontend script. Initializes the application, instantiates all
 * frontend modules, and sets up primary event listeners to orchestrate interactions
 * between modules based on the application's workflow.
 *
 * Responsibilities:
 * - Initialize all core frontend modules (APIClient, StateManager, UIManager, CanvasManager,
 *   ModelHandler, ProjectHandler, ImagePoolHandler, Utils).
 * - Set up global event listeners for events dispatched by these modules.
 * - Coordinate actions between modules in response to these events. For example,
 *   when a project is loaded, it ensures the image pool and model display are updated.
 * - Handle initialization of truly global UI elements or application-wide setup.
 *
 * External Dependencies:
 * - All other .js modules defined in project_structure.md (APIClient, StateManager, UIManager, CanvasManager,
 *   ModelHandler, ProjectHandler, ImagePoolHandler, Utils)
 *   must be loaded before this script or their classes/objects made available.
 *
 * Input/Output (I/O):
 * Input:
 *   - Listens to custom DOM events dispatched by other modules (e.g., `project-loaded`,
 *     `model-load-success`, `active-image-set`, `canvas-userInteraction`).
 *
 * Output:
 *   - Calls methods on instantiated modules to trigger actions (e.g., telling
 *     ImagePoolHandler to load images, telling CanvasManager to display an image).
 *   - May interact with UIManager for global notifications.
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- Instantiate Core Modules ---
    // Ensure Utils is available (it's an object with static methods)
    const utils = window.Utils; // Assuming utils.js defines a global Utils

    const apiClient = new APIClient();
    const stateManager = new StateManager();
    const uiManager = new UIManager();
    const canvasManager = new CanvasManager();

    const canvasStateCache = {};
    let imageLayerCache = {};
    
    // modelHandler.js is a script that self-initializes its DOM listeners.
    // We don't instantiate it as a class here, but we will need its functions if we were to call them.
    // For now, it primarily dispatches events that main.js listens to.

    // Instantiate ProjectHandler and ImagePoolHandler if their classes are defined
    // These might need to be adjusted if they are also self-initializing scripts like modelHandler.
    // Assuming they are classes as per the plan:
    const projectHandler = (typeof ProjectHandler === 'function') ? new ProjectHandler(apiClient, stateManager, uiManager, utils) : null;
    const imagePoolHandler = (typeof ImagePoolHandler === 'function') ? new ImagePoolHandler(apiClient, stateManager, uiManager, utils) : null;
    const layerViewController = (typeof LayerViewController === 'function') ? new LayerViewController('#layer-view-container', stateManager) : null;


    // --- (Optional) Make instances globally accessible for debugging ---
    window.apiClient = apiClient;
    window.stateManager = stateManager;
    window.uiManager = uiManager;
    window.canvasManager = canvasManager;
    // window.modelHandler = modelHandler; // Not an instance here
    window.projectHandler = projectHandler;
    window.imagePoolHandler = imagePoolHandler;
    window.layerViewController = layerViewController;

    console.log("Main.js: Core modules (api, state, ui, canvas) instantiated.");
    if (projectHandler) console.log("Main.js: ProjectHandler instantiated.");
    if (imagePoolHandler) console.log("Main.js: ImagePoolHandler instantiated.");


    // --- DOM Elements for Global Controls (managed by main.js) ---
    const imageUploadInput = document.getElementById('image-upload');
    const imageUploadProgressBar = document.getElementById('image-upload-bar');
    const imageUploadProgressContainer = document.getElementById('image-upload-progress');

    const clearInputsBtn = document.getElementById('clear-inputs-btn');
    const autoMaskBtn = document.getElementById('auto-mask-btn');
    const cancelAutoMaskBtn = document.getElementById('cancel-auto-mask-btn');
    const recoverAutoMaskBtn = document.getElementById('recover-auto-mask-btn');
    const openAutoMaskOverlayBtn = document.getElementById('open-auto-mask-overlay');
    const autoMaskOverlay = document.getElementById('auto-mask-overlay');
    const closeAutoMaskOverlayBtn = document.getElementById('close-auto-mask-overlay');
    const amgParamsElements = {
        pointsPerSideEl: document.getElementById('amg-points-per-side'),
        predIouThreshEl: document.getElementById('amg-pred-iou-thresh'),
        stabilityScoreThreshEl: document.getElementById('amg-stability-score-thresh'),
        statusEl: document.getElementById('auto-mask-status')
    };
    const saveOverlayBtn = document.getElementById('save-masks-btn');
    const commitMasksBtn = document.getElementById('commit-masks-btn');
    const exportCocoBtn = document.getElementById('export-coco-btn');
    const addEmptyLayerBtn = document.getElementById('add-empty-layer-btn');

    if (openAutoMaskOverlayBtn && autoMaskOverlay) {
        openAutoMaskOverlayBtn.addEventListener('click', () => utils.showElement(autoMaskOverlay, 'flex'));
    }
    if (closeAutoMaskOverlayBtn && autoMaskOverlay) {
        closeAutoMaskOverlayBtn.addEventListener('click', () => utils.hideElement(autoMaskOverlay));
    }


    // --- Global State Variables for main.js orchestration ---
    let predictionDebounceTimer = null;
    let currentAutoMaskAbortController = null;
    let activeImageState = null; // {imageHash, filename, layers: []}

    async function restoreSessionFromServer() {
        try {
            const data = await apiClient.getSessionState();
            if (!data.success) return;

            if (data.model_info) {
                stateManager.setCurrentLoadedModel(data.model_info);
                utils.dispatchCustomEvent('project-model-settings-update', {
                    modelKey: data.model_info.model_size_key,
                    modelPath: data.model_info.model_path,
                    configPath: data.model_info.config_path,
                    applyPostprocessing: data.model_info.apply_postprocessing
                });

                window.samAvailable = data.model_info.available;
                document.dispatchEvent(new CustomEvent('sam-availability-updated', { detail: { available: window.samAvailable } }));
                if (!data.model_info.available) {
                    uiManager.showGlobalStatus('Backend inference unavailable. Prediction features disabled.', 'error', 5000);
                } else if (data.model_info.loaded) {
                    utils.dispatchCustomEvent('model-load-success', {
                        model_info: data.model_info,
                        message: 'Model ready.'
                    });
                }
            }

            if (data.active_image) {
                stateManager.setActiveImage(data.active_image.image_hash, data.active_image.filename);
                utils.dispatchCustomEvent('active-image-set', {
                    imageHash: data.active_image.image_hash,
                    filename: data.active_image.filename,
                    width: data.active_image.width,
                    height: data.active_image.height,
                    imageDataBase64: data.active_image.image_data,
                    existingMasks: data.active_image.masks
                });
            }
        } catch (err) {
            console.error('Error restoring session state:', err);
        }
    }

    function saveCanvasState(hash) {
        if (!hash) return;
        canvasStateCache[hash] = canvasManager.exportState();
    }

    function restoreCanvasState(hash) {
        const state = canvasStateCache[hash];
        if (state) canvasManager.importState(state);
    }

    function syncLayerCache(hash) {
        if (!activeImageState) return;
        const key = hash || activeImageState.imageHash;
        if (!key) return;
        imageLayerCache[key] = activeImageState.layers.slice();
    }


    // --- Setup Event Listeners for Inter-Module Communication ---

    document.addEventListener('save-canvas-state', (e) => {
        saveCanvasState(e.detail.imageHash);
    });

    // == ProjectHandler Events ==
    document.addEventListener('project-created', (event) => {
        const { projectId, projectName, projectData } = event.detail;
        uiManager.showGlobalStatus(`Project '${utils.escapeHTML(projectName)}' created. ID: ${projectId.substring(0,6)}`, 'success');
        canvasManager.clearAllCanvasInputs(true);
        if (imagePoolHandler) imagePoolHandler.clearImagePoolDisplay();
        activeImageState = null;
        layerViewController && layerViewController.setLayers([]);
        imageLayerCache = {};
        // Dispatch event for modelHandler to update based on new (default) project settings
        utils.dispatchCustomEvent('project-model-settings-update', {
            modelKey: projectData?.settings?.current_sam_model_key || null,
            modelPath: projectData?.settings?.current_sam_model_path || null,
            configPath: projectData?.settings?.current_sam_config_path || null,
            applyPostprocessing: projectData?.settings?.current_sam_apply_postprocessing === 'true'
        });
    });

    document.addEventListener('project-loaded', async (event) => {
        const { projectId, projectName, projectData } = event.detail;
        uiManager.showGlobalStatus(`Project '${utils.escapeHTML(projectName)}' loaded.`, 'success');
        canvasManager.clearAllCanvasInputs(true);
        activeImageState = null;
        layerViewController && layerViewController.setLayers([]);
        imageLayerCache = {};

        const settings = projectData.settings || {};
        // Dispatch event for modelHandler to update based on loaded project's settings
        utils.dispatchCustomEvent('project-model-settings-update', {
            modelKey: settings.current_sam_model_key,
            modelPath: settings.current_sam_model_path,
            configPath: settings.current_sam_config_path, // Assuming this exists in settings
            applyPostprocessing: settings.current_sam_apply_postprocessing === 'true'
        });
        if (imagePoolHandler) imagePoolHandler.loadAndDisplayImagePool();
        await restoreSessionFromServer();
    });

    document.addEventListener('project-load-failed', (event) => {
        uiManager.showGlobalStatus(`Failed to load project: ${utils.escapeHTML(event.detail.error)}`, 'error');
    });


    // == ModelHandler Events == (modelHandler.js dispatches these)
    document.addEventListener('model-load-initiated', (event) => {
        const { name } = event.detail; // Use 'name' from event detail for display
        uiManager.showGlobalStatus(`Initiating model load: ${utils.escapeHTML(name)}...`, 'loading', 0);
        canvasManager.lockCanvas(`Loading ${utils.escapeHTML(name)} model...`);
    });

    document.addEventListener('model-load-success', (event) => {
        const { model_info, message } = event.detail;
        uiManager.showGlobalStatus(utils.escapeHTML(message) || `Model loaded successfully.`, 'success', 5000);
        canvasManager.unlockCanvas();
        // Don't clear canvas inputs here if an image is already loaded. 
        // Model change might mean user wants to re-predict on current inputs.
        // canvasManager.clearAllCanvasInputs(false); // Let user decide or clear on new image.
        stateManager.setCurrentLoadedModel(model_info);
    });

    document.addEventListener('model-load-error', (event) => {
        uiManager.showGlobalStatus(`Model load failed: ${utils.escapeHTML(event.detail.error)}`, 'error');
        canvasManager.unlockCanvas();
        stateManager.setCurrentLoadedModel(null);
    });

    // == ImagePoolHandler Events ==
    document.addEventListener('active-image-set', (event) => {
        const { imageHash, filename, width, height, imageDataBase64, existingMasks } = event.detail;
        uiManager.showGlobalStatus(`Loading image '${utils.escapeHTML(filename)}' for annotation...`, 'loading', 0);

        syncLayerCache();
        activeImageState = { imageHash, filename, width, height, layers: [] };
        if (imageLayerCache[imageHash]) {
            activeImageState.layers = imageLayerCache[imageHash].map(l => ({ ...l }));
        } else if (existingMasks && existingMasks.length > 0) {
            const validMasks = existingMasks.filter(m => m.layer_type !== 'interactive_prompt');
            activeImageState.layers = validMasks.map((m, idx) => {
                let parsed = m.mask_data_rle;
                if (typeof parsed === 'string') {
                    try { parsed = JSON.parse(parsed); } catch (e) { parsed = null; }
                }
                if (parsed && parsed.counts && parsed.size) {
                    parsed = utils.rleToBinaryMask(parsed, height, width);
                } else if (parsed && parsed.type === 'raw_list_final' && Array.isArray(parsed.data)) {
                    parsed = parsed.data;
                }
                return {
                    layerId: m.layer_id || `layer_${idx}`,
                    name: m.name || `Mask ${idx + 1}`,
                    classLabel: m.class_label || '',
                    status: m.layer_type || 'prediction',
                    visible: true,
                    displayColor: utils.getRandomHexColor(),
                    maskData: parsed
                };
            });
            imageLayerCache[imageHash] = activeImageState.layers.map(l => ({ ...l }));
        }
        if (layerViewController) layerViewController.setLayers(activeImageState.layers);

        const imageElement = new Image();
        imageElement.onload = () => {
            canvasManager.loadImageOntoCanvas(imageElement, width, height, filename);
            restoreCanvasState(imageHash);
            processAndDisplayExistingMasks(existingMasks, filename, width, height); // Pass dimensions
            uiManager.clearGlobalStatus();
        };
        imageElement.onerror = () => {
            uiManager.showGlobalStatus(`Error creating image element for '${utils.escapeHTML(filename)}'.`, 'error');
        };
        imageElement.src = imageDataBase64;
    });

    function processAndDisplayExistingMasks(existingMasks, filename, imgWidth, imgHeight) {
        if (existingMasks && existingMasks.length > 0) {

            const finalMasks = existingMasks.filter(m => m.layer_type === 'final_edited');
            const autoMaskLayers = existingMasks.filter(m => m.layer_type === 'automask');
            let loadedMaskMessage = null;

            if (finalMasks.length > 0) {
                const latestFinal = finalMasks.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
                try {
                    let maskDataContainer = latestFinal.mask_data_rle;
                    if (typeof maskDataContainer === 'string') {
                        maskDataContainer = JSON.parse(maskDataContainer);
                    }
                    let binaryMaskArray = null;
                    if (maskDataContainer && maskDataContainer.type === 'raw_list_final' && maskDataContainer.data) {
                        binaryMaskArray = maskDataContainer.data;
                    } else if (maskDataContainer && maskDataContainer.counts && maskDataContainer.size) {
                        binaryMaskArray = utils.rleToBinaryMask(maskDataContainer, imgHeight, imgWidth); // Use passed dimensions
                        if (!binaryMaskArray) console.warn("RLE to Binary conversion for final_edited mask failed.");
                    }

                    if (binaryMaskArray) {
                        canvasManager.setManualPredictions({ masks_data: [binaryMaskArray], scores: [latestFinal.metadata?.score || 1.0] });
                        loadedMaskMessage = `Loaded final edited mask for '${utils.escapeHTML(filename)}'.`;
                    }
                } catch (e) { console.error("Error parsing final_edited mask data:", e); }
            } else if (autoMaskLayers.length > 0 && !loadedMaskMessage) {
                const latestAuto = autoMaskLayers.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
                try {
                    let allMaskObjectsInLayer = latestAuto.mask_data_rle;
                    if (typeof allMaskObjectsInLayer === 'string') {
                        allMaskObjectsInLayer = JSON.parse(allMaskObjectsInLayer);
                    }
                    const binaryMasksForCanvas = allMaskObjectsInLayer.map(item => {
                        let rleData = item.segmentation_rle || item; // Backend might send RLE directly or nested
                        if (rleData && rleData.type === 'raw_list' && rleData.data) { // Already binary
                            return rleData.data;
                        } else if (rleData && rleData.counts && rleData.size) { // COCO RLE
                            const mask = utils.rleToBinaryMask(rleData, imgHeight, imgWidth); // Use passed dimensions
                            if (!mask) console.warn("RLE to Binary for automask item failed.");
                            return mask;
                        }
                        return null;
                    }).filter(Boolean);

                    if (binaryMasksForCanvas.length > 0) {
                        canvasManager.setAutomaskPredictions({ masks_data: binaryMasksForCanvas, count: binaryMasksForCanvas.length });
                        loadedMaskMessage = `Loaded previous automask results for '${utils.escapeHTML(filename)}'.`;
                    }
                } catch (e) { console.error("Error parsing automask layer data:", e); }
            }
            if (layerViewController) layerViewController.setLayers(activeImageState.layers);
            if(loadedMaskMessage) uiManager.showGlobalStatus(loadedMaskMessage, 'info', 4000);
        }
    }


    // == CanvasManager Events ==
    canvasManager.addEventListener('userInteraction', (event) => {
        const canvasInputs = event.detail;
        const currentModel = stateManager.getCurrentLoadedModel();
        const activeImageHash = stateManager.getActiveImageHash();

        if (!currentModel || !currentModel.loaded) {
            uiManager.showGlobalStatus("Cannot predict: No model loaded.", "error", 3000);
            return;
        }
        if (!canvasInputs.imagePresent) return;

        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            if (canvasInputs.points.length > 0 || (canvasInputs.boxes && canvasInputs.boxes.length > 0) || canvasInputs.maskInput) {
                performInteractivePrediction(canvasInputs, activeImageHash);
            } else {
                canvasManager.setManualPredictions(null);
            }
        }, 300);
    });

    canvasManager.addEventListener('opacityChanged', (event) => {
        const { layer, value } = event.detail;
        const valueDisplayId = `${layer}-opacity-value`;
        const valueDisplayElement = document.getElementById(valueDisplayId);
        if (valueDisplayElement) {
            valueDisplayElement.textContent = `${Math.round(value * 100)}%`;
        }
    });


    async function performInteractivePrediction(canvasInputs, imageHashForAPI) {
        canvasManager.lockCanvas("Predicting...");
        canvasManager.setAutomaskPredictions(null);

        const boxPayload = (canvasInputs.boxes && canvasInputs.boxes.length > 0) ?
            canvasInputs.boxes.map(b => [b.x1, b.y1, b.x2, b.y2]) : null;
        const multiMask = !(boxPayload && boxPayload.length > 1);
        const payload = {
            points: canvasInputs.points.map(p => [p.x, p.y]),
            labels: canvasInputs.points.map(p => p.label),
            box: boxPayload,
            maskInput: canvasInputs.maskInput,
            multimask_output: multiMask
        };
        const activeProjectId = stateManager.getActiveProjectId();

        try {
            const data = await apiClient.predictInteractive(activeProjectId, imageHashForAPI, payload);
            if (data.success) {
                canvasManager.setManualPredictions({
                    masks_data: data.masks_data,
                    scores: data.scores,
                    num_boxes: data.num_boxes,
                    multimask_output: data.multimask_output
                });
            } else {
                throw new Error(data.error || "Interactive prediction API error.");
            }
        } catch (error) {
            uiManager.showGlobalStatus(`Prediction error: ${utils.escapeHTML(error.message)}`, 'error');
            canvasManager.setManualPredictions(null);
        } finally {
            canvasManager.unlockCanvas();
        }
    }

    // --- Global UI Element Listeners (Managed by main.js) ---
    if (clearInputsBtn) {
        clearInputsBtn.addEventListener('click', () => {
            canvasManager.clearAllCanvasInputs(false);
        });
    }

        if (addEmptyLayerBtn) {
        addEmptyLayerBtn.addEventListener('click', () => {
            if (!activeImageState) return;
            const newLayer = {
                layerId: crypto.randomUUID(),
                name: `Mask ${activeImageState.layers.length + 1}`,
                classLabel: '',
                status: 'edited',
                visible: true,
                displayColor: utils.getRandomHexColor(),
                maskData: null
            };
            activeImageState.layers.push(newLayer);
            if (layerViewController) layerViewController.addLayers([newLayer]);
            syncLayerCache();
        });
    }

    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', handleImageFileUpload);
    }

    async function handleImageFileUpload(event) {
        const files = event.target.files;
        if (!files.length) return;

        const projectId = stateManager.getActiveProjectId();
        if (!projectId) {
            uiManager.showGlobalStatus("Please create or load a project before uploading images.", "error");
            imageUploadInput.value = ''; // Clear the input
            return;
        }

        utils.showElement(imageUploadProgressContainer);
        imageUploadProgressBar.style.width = '0%';
        imageUploadProgressBar.textContent = '0%';

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }
        
        uiManager.showGlobalStatus(`Uploading ${files.length} image(s)...`, 'loading', 0);
        try {
            // Simulate progress for now as fetch doesn't support it directly for uploads easily
            // A more complex XHR solution or server-sent events would be needed for real progress.
            imageUploadProgressBar.style.width = '50%';
            imageUploadProgressBar.textContent = '50%';

            const data = await apiClient.addUploadSource(projectId, formData);
            
            imageUploadProgressBar.style.width = '100%';
            imageUploadProgressBar.textContent = '100%';

            if (data.success) {
                uiManager.showGlobalStatus(`Successfully uploaded ${data.images_added || 0} image(s). Skipped ${data.images_skipped_duplicates || 0}.`, 'success');
                if (projectHandler) projectHandler.fetchAndDisplayImageSources(); // Notify projectHandler
                if (imagePoolHandler) imagePoolHandler.loadAndDisplayImagePool(); // Refresh image pool
            } else {
                throw new Error(data.error || "Failed to upload images.");
            }
        } catch (error) {
            uiManager.showGlobalStatus(`Upload error: ${utils.escapeHTML(error.message)}`, 'error');
            imageUploadProgressBar.style.width = '100%';
            imageUploadProgressBar.classList.add('error'); // You'd need a CSS class for error state
            imageUploadProgressBar.textContent = 'Error';
        } finally {
            imageUploadInput.value = ''; // Clear the input
            setTimeout(() => {
                utils.hideElement(imageUploadProgressContainer);
                imageUploadProgressBar.classList.remove('error');
            }, 3000);
        }
    }


    // == AutoMask Section Logic ==
    if (autoMaskBtn) autoMaskBtn.addEventListener('click', handleRunAutoMask);
    if (cancelAutoMaskBtn) cancelAutoMaskBtn.addEventListener('click', () => {
        if (currentAutoMaskAbortController) currentAutoMaskAbortController.abort();
    });
    if (recoverAutoMaskBtn) recoverAutoMaskBtn.addEventListener('click', handleRecoverAutoMask);

    async function handleRunAutoMask() {
        if (autoMaskOverlay) utils.hideElement(autoMaskOverlay);
        const currentCanvasState = canvasManager.getCurrentCanvasInputs();
        if (!currentCanvasState.imagePresent) {
            uiManager.showGlobalStatus("Please load an image first for AutoMask.", "error"); return;
        }
        const currentModel = stateManager.getCurrentLoadedModel();
        if (!currentModel || !currentModel.loaded) {
            uiManager.showGlobalStatus("Cannot run AutoMask: No model loaded.", "error"); return;
        }

        canvasManager.clearAllCanvasInputs(false);

        const startTime = Date.now();
        if (amgParamsElements.statusEl) {
            amgParamsElements.statusEl.className = 'status-message info small';
            amgParamsElements.statusEl.textContent = "Running AutoMask...";
        }
        canvasManager.lockCanvas("AutoMask running...");
        if (autoMaskBtn) autoMaskBtn.disabled = true;
        if (cancelAutoMaskBtn) utils.showElement(cancelAutoMaskBtn, 'inline-block');
        if (recoverAutoMaskBtn) recoverAutoMaskBtn.disabled = true;

        currentAutoMaskAbortController = new AbortController();
        const amgPayload = {
            points_per_side: amgParamsElements.pointsPerSideEl ? parseInt(amgParamsElements.pointsPerSideEl.value) : 32,
            pred_iou_thresh: amgParamsElements.predIouThreshEl ? parseFloat(amgParamsElements.predIouThreshEl.value) : 0.88,
            stability_score_thresh: amgParamsElements.stabilityScoreThreshEl ? parseFloat(amgParamsElements.stabilityScoreThreshEl.value) : 0.95,
        };
        const activeProjectId = stateManager.getActiveProjectId();
        const activeImageHash = stateManager.getActiveImageHash();

        try {
            const data = await apiClient.generateAutoMasks(activeProjectId, activeImageHash, amgPayload, currentAutoMaskAbortController.signal);
            if (currentAutoMaskAbortController.signal.aborted) {
                if (amgParamsElements.statusEl) amgParamsElements.statusEl.textContent = "AutoMask cancelled.";
                uiManager.showGlobalStatus("AutoMask cancelled by user.", "info");
                return;
            }
            if (data.success) {
                canvasManager.setAutomaskPredictions(data);
                if (data.image_status) {
                    utils.dispatchCustomEvent('image-status-updated', { imageHash: activeImageHash, status: data.image_status });
                }
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                const statusText = `AutoMask complete (${data.count || 0} masks) in ${duration}s.`;
                if (amgParamsElements.statusEl) {
                    amgParamsElements.statusEl.className = 'status-message success small';
                    amgParamsElements.statusEl.textContent = statusText;
                }
                // Automask results are stored in the backend DB; no localStorage handling
            } else {
                throw new Error(data.error || "AutoMask API error.");
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                if (amgParamsElements.statusEl) amgParamsElements.statusEl.textContent = "AutoMask cancelled.";
            } else {
                if (amgParamsElements.statusEl) {
                    amgParamsElements.statusEl.className = 'status-message error small';
                    amgParamsElements.statusEl.textContent = `Error: ${utils.escapeHTML(error.message)}`;
                }
                uiManager.showGlobalStatus(`AutoMask error: ${utils.escapeHTML(error.message)}`, 'error');
            }
            canvasManager.setAutomaskPredictions(null);
        } finally {
            canvasManager.unlockCanvas();
            if (autoMaskBtn) autoMaskBtn.disabled = false;
            if (cancelAutoMaskBtn) utils.hideElement(cancelAutoMaskBtn);
            if (recoverAutoMaskBtn) recoverAutoMaskBtn.disabled = false;
            currentAutoMaskAbortController = null;
        }
    }

    async function handleRecoverAutoMask() {
        if (autoMaskOverlay) utils.hideElement(autoMaskOverlay);
        const currentCanvasState = canvasManager.getCurrentCanvasInputs();
        if (!currentCanvasState.imagePresent || !currentCanvasState.filename) {
            uiManager.showGlobalStatus("No image loaded to recover automask for.", "error");
            if (amgParamsElements.statusEl) { amgParamsElements.statusEl.textContent = "No image loaded."; amgParamsElements.statusEl.className = 'status-message error small'; }
            return;
        }
        canvasManager.clearAllCanvasInputs(false);
        try {
            const activeProjectId = stateManager.getActiveProjectId();
            const activeImageHash = stateManager.getActiveImageHash();
            const res = await apiClient.getImageMasks(activeProjectId, activeImageHash, 'automask');
            if (res.success && res.masks && res.masks.length > 0) {
                const latest = res.masks[0];
                const masksRLE = latest.mask_data_rle;
                const recoveredMasks = masksRLE.map(rleObj => ({ segmentation: utils.rleToBinaryMask(rleObj.segmentation_rle || rleObj, currentCanvasState.originalHeight, currentCanvasState.originalWidth) }));
                canvasManager.setAutomaskPredictions({ masks_data: recoveredMasks, count: recoveredMasks.length });
                const infoText = latest.metadata && latest.metadata.source_amg_params ? 'Recovered previous AutoMask.' : 'Recovered masks';
                if (amgParamsElements.statusEl) {
                    amgParamsElements.statusEl.textContent = infoText;
                    amgParamsElements.statusEl.className = 'status-message success small';
                }
                uiManager.showGlobalStatus('AutoMask recovered from project DB.', 'success', 4000);
            } else {
                uiManager.showGlobalStatus('No previous AutoMask found.', 'info');
                if (amgParamsElements.statusEl) { amgParamsElements.statusEl.textContent = 'No previous AutoMask found.'; amgParamsElements.statusEl.className = 'status-message info small'; }
            }
        } catch (e) {
            uiManager.showGlobalStatus(`Error recovering AutoMask: ${utils.escapeHTML(e.message)}`, 'error');
            if (amgParamsElements.statusEl) { amgParamsElements.statusEl.textContent = 'Error recovering AutoMask.'; amgParamsElements.statusEl.className = 'status-message error small'; }
            console.error('recover automask error:', e);
        }
    }

    if (saveOverlayBtn) {
        saveOverlayBtn.addEventListener('click', () => {
            const currentInputs = canvasManager.getCurrentCanvasInputs();
             if (!currentInputs.imagePresent) {
                uiManager.showGlobalStatus("No image to save.", "error"); return;
            }
            const displayWidth = canvasManager.imageCanvas.width;
            const displayHeight = canvasManager.imageCanvas.height;
            if (displayWidth === 0 || displayHeight === 0 ) {
                 uiManager.showGlobalStatus("Canvas not ready or no image loaded.", "error"); return;
            }
            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = displayWidth; compositeCanvas.height = displayHeight;
            const compositeCtx = compositeCanvas.getContext('2d');

            compositeCtx.globalAlpha = canvasManager.imageOpacitySlider ? parseFloat(canvasManager.imageOpacitySlider.value) : 1.0;
            compositeCtx.drawImage(canvasManager.imageCanvas, 0, 0);
            compositeCtx.globalAlpha = canvasManager.predictionOpacitySlider ? parseFloat(canvasManager.predictionOpacitySlider.value) : 0.7;
            compositeCtx.drawImage(canvasManager.predictionMaskCanvas, 0, 0);
            compositeCtx.globalAlpha = canvasManager.userInputOpacitySlider ? parseFloat(canvasManager.userInputOpacitySlider.value) : 0.8;
            compositeCtx.drawImage(canvasManager.userInputCanvas, 0, 0);
            compositeCtx.globalAlpha = 1.0;

            const dataURL = compositeCanvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataURL;
            const filenameBase = currentInputs.filename ? currentInputs.filename.split('.').slice(0, -1).join('.') : 'sam_output';
            link.download = `${utils.escapeHTML(filenameBase)}_overlay_preview.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            uiManager.showGlobalStatus("Overlay preview saved.", 'success', 3000);
        });
    }

    async function handleCommitMasks() {
        if (!activeImageState) return;
        const predictions = canvasManager.manualPredictions && canvasManager.manualPredictions.length > 0
            ? canvasManager.manualPredictions
            : (canvasManager.automaskPredictions || []);

        const selected = (predictions || []).filter(p => p.visible !== false);

        if (selected.length === 0) {
            uiManager.showGlobalStatus('No predictions selected.', 'info');
            return;
        }

        const masksToCommit = selected.map((mask, idx) => ({
            segmentation: mask.segmentation || mask,
            source_layer_ids: [],
            name: `Mask ${activeImageState.layers.length + idx + 1}`
        }));

        const activeProjectId = stateManager.getActiveProjectId();
        const activeImageHash = stateManager.getActiveImageHash();
        if (!activeProjectId || !activeImageHash) {
            uiManager.showGlobalStatus('No active project or image.', 'error');
            return;
        }

        uiManager.showGlobalStatus('Adding layer(s)...', 'loading', 0);
        try {
            const data = await apiClient.commitMasks(activeProjectId, activeImageHash, { final_masks: masksToCommit, notes: '' });
            if (!data.success) throw new Error(data.error || 'Commit failed');
            if (data.image_status) {
                utils.dispatchCustomEvent('image-status-updated', { imageHash: activeImageHash, status: data.image_status });
            }

            const ids = data.final_layer_ids || [];
            const newLayers = selected.map((mask, idx) => ({
                layerId: ids[idx] || crypto.randomUUID(),
                name: masksToCommit[idx].name,
                classLabel: '',
                status: 'edited',
                visible: true,
                displayColor: utils.getRandomHexColor(),
                maskData: mask.segmentation || mask
            }));

            activeImageState.layers.push(...newLayers);
            if (layerViewController) layerViewController.addLayers(newLayers);
            syncLayerCache();
            uiManager.showGlobalStatus(`${newLayers.length} layer(s) added.`, 'success');
        } catch (err) {
            uiManager.showGlobalStatus(`Add failed: ${utils.escapeHTML(err.message)}`, 'error');
        }

        canvasManager.clearAllCanvasInputs(false);
        canvasManager.setManualPredictions(null);
        canvasManager.setAutomaskPredictions(null);
    }

    if (commitMasksBtn && !commitMasksBtn.dataset.listenerAttached) {
        commitMasksBtn.dataset.listenerAttached = 'true';
        commitMasksBtn.addEventListener('click', async () => {
            if (commitMasksBtn.disabled) return;
            commitMasksBtn.disabled = true;
            await handleCommitMasks();
            commitMasksBtn.disabled = false;
        });
    }

    if (exportCocoBtn) {
        exportCocoBtn.addEventListener('click', async () => {
            const activeProjectId = stateManager.getActiveProjectId();
            if (!activeProjectId) {
                uiManager.showGlobalStatus("No active project to export.", "error");
                return;
            }

            const payload = {
                format: "coco_rle_json",
                export_schema: "coco_instance_segmentation",
                filters: {
                    image_statuses: ["approved"],
                    layer_statuses: ["edited", "approved"]
                }
            };
            
            uiManager.showGlobalStatus("Preparing COCO export...", "loading", 0);
            try {
                const data = await apiClient.requestExport(activeProjectId, payload);
                if (data.success) {
                    uiManager.showGlobalStatus(data.message || "COCO export initiated.", "success");
                } else {
                     throw new Error(data.error || "Failed to initiate COCO export.");
                }
            } catch (error) {
                uiManager.showGlobalStatus(`Export error: ${utils.escapeHTML(error.message)}`, "error");
            }
        });
    }

    document.addEventListener('layer-selected', (event) => {
        if (!activeImageState) return;
        const layer = activeImageState.layers.find(l => l.layerId === event.detail.layerId);
        if (layer && layer.maskData) {
            canvasManager.setManualPredictions({ masks_data: [layer.maskData], scores: [1.0] });
        }
    });

    document.addEventListener('layer-deleted', async (event) => {
        if (!activeImageState) return;
        const id = event.detail.layerId;
        activeImageState.layers = activeImageState.layers.filter(l => l.layerId !== id);
        canvasManager.setManualPredictions(null);
        syncLayerCache();
        const projectId = stateManager.getActiveProjectId();
        const imageHash = stateManager.getActiveImageHash();
        if (projectId && imageHash) {
            try {
                const res = await apiClient.deleteMaskLayer(projectId, imageHash, id);
                if (res.success && res.image_status) {
                    utils.dispatchCustomEvent('image-status-updated', { imageHash, status: res.image_status });
                }
            } catch (e) {
                console.error('Delete layer error', e);
                uiManager.showGlobalStatus(`Delete error: ${utils.escapeHTML(e.message)}`, 'error');
            }
        }
    });

    
    // --- Application Initialization ---
    function initializeApp() {
        uiManager.showGlobalStatus("Application initializing...", 'loading', 0);

        document.querySelectorAll('.management-section').forEach(section => {
            const header = section.querySelector('.management-header');
            if (header && uiManager && typeof uiManager.initializeExpandableSection === 'function') {
                uiManager.initializeExpandableSection(header, true);
            }
        });
        
        // Initial opacity setup for sliders if canvasManager handles this
        // Or, call canvasManager.setupOpacitySliders() if it's not auto-done in constructor
        // It seems canvasManager.setupOpacitySliders also dispatches initial events, which is good.

        // Initial calls to handlers to fetch their data
        // modelHandler.js fetches its own models via DOMContentLoaded.
        // projectHandler and imagePoolHandler are instantiated above; their constructors might fetch initial data.
        // If not, call them here:
        if (projectHandler && typeof projectHandler.fetchAndDisplayProjects === 'function') {
            projectHandler.fetchAndDisplayProjects();
        }
        // Restore session from server after determining active project
        if (projectHandler && typeof projectHandler.fetchActiveProject === 'function') {
            projectHandler.fetchActiveProject().then(restoreSessionFromServer);
        } else {
            restoreSessionFromServer();
        }

        // Image pool will be loaded when a project becomes active.

        uiManager.showGlobalStatus("Ready. Load a model, then an image or project.", 'info', 5000);
    }

    initializeApp();
});