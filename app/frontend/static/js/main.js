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
    const utils = window.Utils || Utils; // Assuming utils.js defines a global Utils or exports it

    const apiClient = new APIClient();
    const stateManager = new StateManager();
    const uiManager = new UIManager(); // UIManager might use Utils
    const canvasManager = new CanvasManager(); // CanvasManager might use Utils
    const modelHandler = new ModelHandler(apiClient, stateManager, uiManager);
    const projectHandler = new ProjectHandler(apiClient, stateManager, uiManager);
    const imagePoolHandler = new ImagePoolHandler(apiClient, stateManager, uiManager);

    // --- (Optional) Make instances globally accessible for debugging ---
    // window.apiClient = apiClient;
    // window.stateManager = stateManager;
    // window.uiManager = uiManager;
    // window.canvasManager = canvasManager;
    // window.modelHandler = modelHandler;
    // window.projectHandler = projectHandler;
    // window.imagePoolHandler = imagePoolHandler;

    console.log("All frontend modules instantiated by main.js.");

    // --- DOM Elements for Global Controls (if any, managed by main.js) ---
    const clearInputsBtn = document.getElementById('clear-inputs-btn');
    // Automask elements are still here as their handler isn't defined yet.
    // Ideally, an AutoMaskHandler would manage these.
    const autoMaskBtn = document.getElementById('auto-mask-btn');
    const cancelAutoMaskBtn = document.getElementById('cancel-auto-mask-btn');
    const recoverAutoMaskBtn = document.getElementById('recover-auto-mask-btn');
    const amgParamsElements = {
        pointsPerSideEl: document.getElementById('amg-points-per-side'),
        predIouThreshEl: document.getElementById('amg-pred-iou-thresh'),
        stabilityScoreThreshEl: document.getElementById('amg-stability-score-thresh'),
        statusEl: document.getElementById('auto-mask-status')
    };
    const saveOverlayBtn = document.getElementById('save-masks-btn');


    // --- Global State Variables for main.js orchestration ---
    let predictionDebounceTimer = null;
    let currentAutoMaskAbortController = null;


    // --- Setup Event Listeners for Inter-Module Communication ---

    // == ProjectHandler Events ==
    document.addEventListener('project-created', (event) => {
        const { projectId, projectName } = event.detail;
        uiManager.showGlobalStatus(`Project '${utils.escapeHTML(projectName)}' created.`, 'success');
        // stateManager.setActiveProject(projectId, projectName); // ProjectHandler should already do this
        canvasManager.clearAllCanvasInputs(true); // Clear everything for new project
        imagePoolHandler.clearImagePoolDisplay();
        modelHandler.fetchAvailableModels(); // Or set to default, ensuring model state is fresh for new project
        // Any other actions needed when a new project becomes active
    });

    document.addEventListener('project-loaded', (event) => {
        const { projectId, projectName, projectData } = event.detail;
        // stateManager.setActiveProject(projectId, projectName); // ProjectHandler should already do this
        uiManager.showGlobalStatus(`Project '${utils.escapeHTML(projectName)}' loaded.`, 'success');
        canvasManager.clearAllCanvasInputs(true); // Clear previous project's canvas state

        const settings = projectData.settings || {}; // Assuming projectData from backend includes 'settings'
        modelHandler.setCurrentModelDisplay( // Tell ModelHandler to update based on loaded project's settings
            settings.current_sam_model_key,
            settings.current_sam_model_path,
            settings.current_sam_apply_postprocessing === 'true' // Ensure boolean
        );
        imagePoolHandler.loadAndDisplayImagePool(); // Tell ImagePoolHandler to load images for this project
    });

    document.addEventListener('project-load-failed', (event) => {
        uiManager.showGlobalStatus(`Failed to load project: ${event.detail.error}`, 'error');
    });


    // == ModelHandler Events ==
    document.addEventListener('model-load-initiated', (event) => {
        const { key } = event.detail;
        const modelNameToDisplay = key === 'custom' ? 'Custom Model' : (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '));
        uiManager.showGlobalStatus(`Initiating model load: ${modelNameToDisplay}...`, 'loading', 0);
        canvasManager.lockCanvas(`Loading ${modelNameToDisplay} model...`);
    });

    document.addEventListener('model-load-success', (event) => {
        const { model_info, message } = event.detail;
        uiManager.showGlobalStatus(message || `Model loaded successfully.`, 'success', 5000);
        canvasManager.unlockCanvas();
        canvasManager.clearAllCanvasInputs(false); // New model: clear existing points/masks, but keep image if any
        stateManager.setCurrentLoadedModel(model_info);
    });

    document.addEventListener('model-load-error', (event) => {
        uiManager.showGlobalStatus(`Model load failed: ${event.detail.error}`, 'error');
        canvasManager.unlockCanvas();
        stateManager.setCurrentLoadedModel(null);
    });

    // == ImagePoolHandler Events ==
    document.addEventListener('active-image-set', (event) => {
        const { imageHash, filename, width, height, imageDataBase64, existingMasks } = event.detail;
        // stateManager.setActiveImage(imageHash, filename); // ImagePoolHandler should manage this part of state.
        uiManager.showGlobalStatus(`Loading image '${utils.escapeHTML(filename)}' for annotation...`, 'loading', 0);

        const imageElement = new Image();
        imageElement.onload = () => {
            canvasManager.loadImageOntoCanvas(imageElement, width, height, filename);
            // Process and display existing masks from the loaded image's data
            processAndDisplayExistingMasks(existingMasks, filename);
            uiManager.clearGlobalStatus();
        };
        imageElement.onerror = () => {
            uiManager.showGlobalStatus(`Error creating image element for '${utils.escapeHTML(filename)}'.`, 'error');
        };
        imageElement.src = imageDataBase64;
    });

    function processAndDisplayExistingMasks(existingMasks, filename) {
        if (existingMasks && existingMasks.length > 0) {
            const finalMasks = existingMasks.filter(m => m.layer_type === 'final_edited');
            const autoMaskLayers = existingMasks.filter(m => m.layer_type === 'automask');

            let loadedMaskMessage = null;

            if (finalMasks.length > 0) {
                const latestFinal = finalMasks.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
                try {
                    const maskDataContainer = JSON.parse(latestFinal.mask_data_rle);
                    // Assuming mask_data_rle for final_edited contains a single mask object that might be
                    // our placeholder {"type":"raw_list_final","data": binary_array} OR an actual RLE dict
                    let binaryMaskArray = null;
                    if (maskDataContainer && maskDataContainer.type === 'raw_list_final' && maskDataContainer.data) {
                        binaryMaskArray = maskDataContainer.data;
                    } else if (maskDataContainer && maskDataContainer.counts && maskDataContainer.size) { // Is COCO RLE
                        // TODO: Implement RLE to Binary conversion here using a utility
                        // binaryMaskArray = Utils.rleToBinaryMask(maskDataContainer, width, height);
                        console.warn("RLE to Binary conversion for final_edited masks not yet implemented in main.js.");
                    }

                    if (binaryMaskArray) {
                        canvasManager.setManualPredictions({ masks_data: [binaryMaskArray], scores: [latestFinal.metadata?.score || 1.0] });
                        loadedMaskMessage = `Loaded final edited mask for '${utils.escapeHTML(filename)}'.`;
                    }
                } catch (e) { console.error("Error parsing final_edited mask data:", e); }
            } else if (autoMaskLayers.length > 0 && !loadedMaskMessage) { // Only load automask if no final_edited was loaded
                const latestAuto = autoMaskLayers.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
                try {
                    const allMaskObjectsInLayer = JSON.parse(latestAuto.mask_data_rle); // This is a list of {segmentation_rle, metadata}
                    const binaryMasksForCanvas = allMaskObjectsInLayer.map(item => {
                        let rleData = item.segmentation_rle;
                        if (rleData && rleData.type === 'raw_list' && rleData.data) {
                            return rleData.data; // It's already a binary 2D array
                        } else if (rleData && rleData.counts && rleData.size) { // Is COCO RLE
                            // TODO: Implement RLE to Binary conversion here
                            console.warn("RLE to Binary conversion for automask items not yet implemented in main.js.");
                            return null;
                        }
                        return null;
                    }).filter(Boolean);

                    if (binaryMasksForCanvas.length > 0) {
                        canvasManager.setAutomaskPredictions({ masks_data: binaryMasksForCanvas, count: binaryMasksForCanvas.length });
                        loadedMaskMessage = `Loaded previous automask results for '${utils.escapeHTML(filename)}'.`;
                    }
                } catch (e) { console.error("Error parsing automask layer data:", e); }
            }
            if(loadedMaskMessage) uiManager.showGlobalStatus(loadedMaskMessage, 'info', 4000);
        }
    }


    // == CanvasManager Events ==
    canvasManager.addEventListener('userInteraction', (event) => {
        // This event detail contains { points, box, maskInput, imagePresent, filename }
        const canvasInputs = event.detail;
        const currentModel = stateManager.getCurrentLoadedModel();
        const activeImageHash = stateManager.getActiveImageHash(); // Needed if API uses it

        if (!currentModel || !currentModel.loaded) {
            uiManager.showGlobalStatus("Cannot predict: No model loaded.", "error", 3000);
            return;
        }
        if (!canvasInputs.imagePresent) return; // No image, nothing to predict on

        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            if (canvasInputs.points.length > 0 || canvasInputs.box || canvasInputs.maskInput) {
                performInteractivePrediction(canvasInputs, activeImageHash);
            } else {
                canvasManager.setManualPredictions(null); // No inputs, clear predictions
            }
        }, 300); // Debounce for 300ms
    });

    async function performInteractivePrediction(canvasInputs, imageHashForAPI) {
        canvasManager.lockCanvas("Predicting...");
        canvasManager.setAutomaskPredictions(null); // Clear automask if doing interactive

        const payload = {
            points: canvasInputs.points.map(p => [p.x, p.y]),
            labels: canvasInputs.points.map(p => p.label),
            box: canvasInputs.box ? [canvasInputs.box.x1, canvasInputs.box.y1, canvasInputs.box.x2, canvasInputs.box.y2] : null,
            maskInput: canvasInputs.maskInput,
            multimask_output: true
        };
        const activeProjectId = stateManager.getActiveProjectId(); // May be null

        try {
            // Current server /api/predict doesn't use project_id or image_hash
            const data = await apiClient.predictInteractive(activeProjectId, imageHashForAPI, payload);
            if (data.success) {
                canvasManager.setManualPredictions({ masks_data: data.masks_data, scores: data.scores });
            } else {
                throw new Error(data.error || "Interactive prediction API error.");
            }
        } catch (error) {
            uiManager.showGlobalStatus(`Prediction error: ${error.message}`, 'error');
            canvasManager.setManualPredictions(null);
        } finally {
            canvasManager.unlockCanvas();
        }
    }

    // --- Global UI Element Listeners (Managed by main.js) ---
    if (clearInputsBtn) {
        clearInputsBtn.addEventListener('click', () => {
            canvasManager.clearAllCanvasInputs(false); // Clear inputs/predictions, not the image
        });
    }

    // == AutoMask Section Logic (To be moved to an AutoMaskHandler eventually) ==
    if (autoMaskBtn) autoMaskBtn.addEventListener('click', handleRunAutoMask);
    if (cancelAutoMaskBtn) cancelAutoMaskBtn.addEventListener('click', () => {
        if (currentAutoMaskAbortController) currentAutoMaskAbortController.abort();
    });
    if (recoverAutoMaskBtn) recoverAutoMaskBtn.addEventListener('click', handleRecoverAutoMask);

    async function handleRunAutoMask() {
        const currentCanvasState = canvasManager.getCurrentCanvasInputs();
        if (!currentCanvasState.imagePresent) {
            uiManager.showGlobalStatus("Please load an image first for AutoMask.", "error"); return;
        }
        const currentModel = stateManager.getCurrentLoadedModel();
        if (!currentModel || !currentModel.loaded) {
            uiManager.showGlobalStatus("Cannot run AutoMask: No model loaded.", "error"); return;
        }

        canvasManager.clearAllCanvasInputs(false); // Clear user inputs/manual predictions

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
        const activeProjectId = stateManager.getActiveProjectId(); // Might be null
        const activeImageHash = stateManager.getActiveImageHash(); // Might be null

        try {
            // Current server /api/generate_auto_masks doesn't use project_id or image_hash
            const data = await apiClient.generateAutoMasks(activeProjectId, activeImageHash, amgPayload, currentAutoMaskAbortController.signal);

            if (currentAutoMaskAbortController.signal.aborted) {
                if (amgParamsElements.statusEl) amgParamsElements.statusEl.textContent = "AutoMask cancelled.";
                uiManager.showGlobalStatus("AutoMask cancelled by user.", "info");
                return;
            }
            if (data.success) {
                canvasManager.setAutomaskPredictions(data); // data expected as { masks_data: [...], count: ... }
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                const statusText = `AutoMask complete (${data.count || 0} masks) in ${duration}s.`;
                if (amgParamsElements.statusEl) {
                    amgParamsElements.statusEl.className = 'status-message success small';
                    amgParamsElements.statusEl.textContent = statusText;
                }
                if (currentCanvasState.filename) {
                    try {
                        const storableData = data.masks_data.map(m => ({ segmentation: m.segmentation, area: m.area }));
                        localStorage.setItem(`automask_data_${currentCanvasState.filename}`, JSON.stringify(storableData));
                        localStorage.setItem(`automask_info_${currentCanvasState.filename}`, statusText);
                    } catch (e) {
                        console.warn("localStorage error on automask save:", e);
                        uiManager.showGlobalStatus("Could not save automask to localStorage (data too large).", "error", 8000);
                    }
                }
            } else {
                throw new Error(data.error || "AutoMask API error.");
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                if (amgParamsElements.statusEl) amgParamsElements.statusEl.textContent = "AutoMask cancelled.";
                uiManager.showGlobalStatus("AutoMask cancelled by user.", "info");
            } else {
                if (amgParamsElements.statusEl) {
                    amgParamsElements.statusEl.className = 'status-message error small';
                    amgParamsElements.statusEl.textContent = `Error: ${error.message}`;
                }
                uiManager.showGlobalStatus(`AutoMask error: ${error.message}`, 'error');
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

    function handleRecoverAutoMask() {
        const currentCanvasState = canvasManager.getCurrentCanvasInputs();
        if (!currentCanvasState.imagePresent || !currentCanvasState.filename) {
            uiManager.showGlobalStatus("No image loaded to recover automask for.", "error");
            if (amgParamsElements.statusEl) { amgParamsElements.statusEl.textContent = "No image loaded."; amgParamsElements.statusEl.className = 'status-message error small'; }
            return;
        }
        try {
            const recoveredDataString = localStorage.getItem(`automask_data_${currentCanvasState.filename}`);
            const recoveredInfo = localStorage.getItem(`automask_info_${currentCanvasState.filename}`);
            if (recoveredDataString) {
                const recoveredMasks = JSON.parse(recoveredDataString); // Array of {segmentation, area}
                canvasManager.setAutomaskPredictions({ masks_data: recoveredMasks, count: recoveredMasks.length });
                if (amgParamsElements.statusEl) {
                    amgParamsElements.statusEl.textContent = "Recovered: " + (recoveredInfo || "Previously generated AutoMask.");
                    amgParamsElements.statusEl.className = 'status-message success small';
                }
                uiManager.showGlobalStatus("AutoMask recovered from local storage.", 'success', 4000);
            } else {
                uiManager.showGlobalStatus("No previous AutoMask found in local storage for this image.", "info");
                 if (amgParamsElements.statusEl) { amgParamsElements.statusEl.textContent = "No previous AutoMask found."; amgParamsElements.statusEl.className = 'status-message info small'; }
            }
        } catch (e) {
            uiManager.showGlobalStatus("Error recovering AutoMask. Storage might be corrupted/disabled.", 'error');
            if (amgParamsElements.statusEl) { amgParamsElements.statusEl.textContent = "Error recovering AutoMask."; amgParamsElements.statusEl.className = 'status-message error small'; }
            console.error("localStorage error on automask recovery:", e);
        }
    }

    if (saveOverlayBtn) {
        saveOverlayBtn.addEventListener('click', () => {
            // This remains a CanvasManager direct interaction as it's purely visual.
            // More complex export logic would be in an ExportHandler.
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

            compositeCtx.globalAlpha = parseFloat(canvasManager.imageOpacitySlider.value);
            compositeCtx.drawImage(canvasManager.imageCanvas, 0, 0);
            compositeCtx.globalAlpha = parseFloat(canvasManager.predictionOpacitySlider.value);
            compositeCtx.drawImage(canvasManager.predictionMaskCanvas, 0, 0);
            compositeCtx.globalAlpha = parseFloat(canvasManager.userInputOpacitySlider.value);
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

    // --- Application Initialization ---
    function initializeApp() {
        uiManager.showGlobalStatus("Application initializing...", 'loading', 0);

        // Initialize expandable sections using UIManager
        document.querySelectorAll('.expandable-section').forEach(section => {
            const header = section.querySelector('.expandable-header');
            if (header) {
                const startCollapsed = section.id === 'project-management-expandable' ||
                                       section.id === 'image-pool-expandable';
                uiManager.initializeExpandableSection(header, startCollapsed);
            }
        });

        // Sync initial opacity display values
        const initialImageOpacity = canvasManager.imageOpacitySlider ? parseFloat(canvasManager.imageOpacitySlider.value) : 1.0;
        const initialPredictionOpacity = canvasManager.predictionOpacitySlider ? parseFloat(canvasManager.predictionOpacitySlider.value) : 0.7;
        const initialUserInputOpacity = canvasManager.userInputOpacitySlider ? parseFloat(canvasManager.userInputOpacitySlider.value) : 0.8;

        canvasManager.dispatchEvent('opacityChanged', { layer: 'image', value: initialImageOpacity });
        canvasManager.dispatchEvent('opacityChanged', { layer: 'prediction', value: initialPredictionOpacity });
        canvasManager.dispatchEvent('opacityChanged', { layer: 'userInput', value: initialUserInputOpacity });


        // Initial calls to handlers to fetch their data, or this can be done within their constructors
        modelHandler.fetchAvailableModels(); // ModelHandler fetches its own list
        // projectHandler.fetchAndDisplayProjects(); // ProjectHandler would fetch its list

        // For now, show a generic ready message. Project/Image Pool loading will update this.
        uiManager.showGlobalStatus("Ready. Load a model, then an image or project.", 'info', 5000);
    }

    initializeApp();
});