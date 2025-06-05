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
    
    // modelHandler.js is a script that self-initializes its DOM listeners.
    // We don't instantiate it as a class here, but we will need its functions if we were to call them.
    // For now, it primarily dispatches events that main.js listens to.

    // Instantiate ProjectHandler and ImagePoolHandler if their classes are defined
    // These might need to be adjusted if they are also self-initializing scripts like modelHandler.
    // Assuming they are classes as per the plan:
    const projectHandler = (typeof ProjectHandler === 'function') ? new ProjectHandler(apiClient, stateManager, uiManager, utils) : null;
    const imagePoolHandler = (typeof ImagePoolHandler === 'function') ? new ImagePoolHandler(apiClient, stateManager, uiManager, utils) : null;


    // --- (Optional) Make instances globally accessible for debugging ---
    window.apiClient = apiClient;
    window.stateManager = stateManager;
    window.uiManager = uiManager;
    window.canvasManager = canvasManager;
    // window.modelHandler = modelHandler; // Not an instance here
    window.projectHandler = projectHandler;
    window.imagePoolHandler = imagePoolHandler;

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
    const amgParamsElements = {
        pointsPerSideEl: document.getElementById('amg-points-per-side'),
        predIouThreshEl: document.getElementById('amg-pred-iou-thresh'),
        stabilityScoreThreshEl: document.getElementById('amg-stability-score-thresh'),
        statusEl: document.getElementById('auto-mask-status')
    };
    const saveOverlayBtn = document.getElementById('save-masks-btn');
    const commitMasksBtn = document.getElementById('commit-masks-btn');
    const exportCocoBtn = document.getElementById('export-coco-btn');


    // --- Global State Variables for main.js orchestration ---
    let predictionDebounceTimer = null;
    let currentAutoMaskAbortController = null;

    function saveCanvasState() {
        const hash = stateManager.getActiveImageHash();
        if (!hash) return;
        const state = canvasManager.exportCanvasState();
        localStorage.setItem(`canvasState_${hash}`, JSON.stringify(state));
    }

    function loadCanvasState(hash) {
        const stored = localStorage.getItem(`canvasState_${hash}`);
        if (stored) {
            try { canvasManager.applyCanvasState(JSON.parse(stored)); } catch(e) { console.error('Failed to load canvas state', e); }
        }
    }


    // --- Setup Event Listeners for Inter-Module Communication ---

    // == ProjectHandler Events ==
    document.addEventListener('project-created', (event) => {
        const { projectId, projectName, projectData } = event.detail;
        uiManager.showGlobalStatus(`Project '${utils.escapeHTML(projectName)}' created. ID: ${projectId.substring(0,6)}`, 'success');
        canvasManager.clearAllCanvasInputs(true);
        if (imagePoolHandler) imagePoolHandler.clearImagePoolDisplay();
        // Dispatch event for modelHandler to update based on new (default) project settings
        utils.dispatchCustomEvent('project-model-settings-update', {
            modelKey: projectData?.settings?.current_sam_model_key || null,
            modelPath: projectData?.settings?.current_sam_model_path || null,
            configPath: projectData?.settings?.current_sam_config_path || null,
            applyPostprocessing: projectData?.settings?.current_sam_apply_postprocessing === 'true'
        });
    });

    document.addEventListener('project-loaded', (event) => {
        const { projectId, projectName, projectData } = event.detail;
        uiManager.showGlobalStatus(`Project '${utils.escapeHTML(projectName)}' loaded.`, 'success');
        canvasManager.clearAllCanvasInputs(true);

        const settings = projectData.settings || {};
        // Dispatch event for modelHandler to update based on loaded project's settings
        utils.dispatchCustomEvent('project-model-settings-update', {
            modelKey: settings.current_sam_model_key,
            modelPath: settings.current_sam_model_path,
            configPath: settings.current_sam_config_path, // Assuming this exists in settings
            applyPostprocessing: settings.current_sam_apply_postprocessing === 'true'
        });
        if (imagePoolHandler) imagePoolHandler.loadAndDisplayImagePool();
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

        const imageElement = new Image();
        imageElement.onload = () => {
            canvasManager.loadImageOntoCanvas(imageElement, width, height, filename);
            processAndDisplayExistingMasks(existingMasks, filename, width, height); // Pass dimensions
            loadCanvasState(imageHash);
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
                    const maskDataContainer = JSON.parse(latestFinal.mask_data_rle);
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
                    const allMaskObjectsInLayer = JSON.parse(latestAuto.mask_data_rle);
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

        saveCanvasState();
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            if (canvasInputs.points.length > 0 || (canvasInputs.boxes && canvasInputs.boxes.length > 0) || canvasInputs.maskInput) {
                performInteractivePrediction(canvasInputs, activeImageHash);
            } else {
                canvasManager.setManualPredictions(null);
            }
        }, 300);
    });

    canvasManager.addEventListener('inputsCleared', () => {
        saveCanvasState();
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

        const payload = {
            points: canvasInputs.points.map(p => [p.x, p.y]),
            labels: canvasInputs.points.map(p => p.label),
            box: (canvasInputs.boxes && canvasInputs.boxes.length > 0) ?
                (canvasInputs.boxes.length === 1 ?
                    [canvasInputs.boxes[0].x1, canvasInputs.boxes[0].y1, canvasInputs.boxes[0].x2, canvasInputs.boxes[0].y2] :
                    canvasInputs.boxes.map(b => [b.x1, b.y1, b.x2, b.y2]))
                : null,
            maskInput: canvasInputs.maskInput, // This is the 256x256 mask from user-drawn polygons
            multimask_output: true
        };
        const activeProjectId = stateManager.getActiveProjectId();

        try {
            const data = await apiClient.predictInteractive(activeProjectId, imageHashForAPI, payload);
            if (data.success) {
                canvasManager.setManualPredictions({ masks_data: data.masks_data, scores: data.scores });
                saveCanvasState();
            } else {
                throw new Error(data.error || "Interactive prediction API error.");
            }
        } catch (error) {
            uiManager.showGlobalStatus(`Prediction error: ${utils.escapeHTML(error.message)}`, 'error');
            canvasManager.setManualPredictions(null);
            saveCanvasState();
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
                saveCanvasState();
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
            saveCanvasState();
        } finally {
            canvasManager.unlockCanvas();
            if (autoMaskBtn) autoMaskBtn.disabled = false;
            if (cancelAutoMaskBtn) utils.hideElement(cancelAutoMaskBtn);
            if (recoverAutoMaskBtn) recoverAutoMaskBtn.disabled = false;
            currentAutoMaskAbortController = null;
        }
    }

    async function handleRecoverAutoMask() {
        const currentCanvasState = canvasManager.getCurrentCanvasInputs();
        if (!currentCanvasState.imagePresent || !currentCanvasState.filename) {
            uiManager.showGlobalStatus("No image loaded to recover automask for.", "error");
            if (amgParamsElements.statusEl) { amgParamsElements.statusEl.textContent = "No image loaded."; amgParamsElements.statusEl.className = 'status-message error small'; }
            return;
        }
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

    if (commitMasksBtn) {
        commitMasksBtn.addEventListener('click', async () => {
            const activeProjectId = stateManager.getActiveProjectId();
            const activeImageHash = stateManager.getActiveImageHash();
            const canvasState = canvasManager.getCurrentCanvasInputs();

            if (!activeProjectId || !activeImageHash || !canvasState.imagePresent) {
                uiManager.showGlobalStatus("No active project/image or masks to commit.", "error");
                return;
            }

            // Decide which masks to commit:
            // Option 1: Commit currently displayed predictions (could be manual or auto)
            // Option 2: Allow user to select from a list (more complex UI needed)
            // For now, let's assume we commit the "best" manual prediction if available,
            // or all automasks if those are active.
            // This logic needs to be refined based on actual UI for mask selection.
            
            let masksToCommit = [];
            if (canvasManager.manualPredictions && canvasManager.manualPredictions.length > 0) {
                // Example: commit the "best" mask from manual predictions
                // For a real app, you'd likely have a way for the user to explicitly select THE final mask.
                const bestMask = canvasManager.manualPredictions[0]; // Assumes sorted by score
                if (bestMask && bestMask.segmentation) {
                     masksToCommit.push({ segmentation: bestMask.segmentation, source_layer_ids: ["manual_interactive"], name: "final_mask_0" });
                }
            } else if (canvasManager.automaskPredictions && canvasManager.automaskPredictions.length > 0) {
                // Example: commit all automasks currently displayed
                masksToCommit = canvasManager.automaskPredictions.map((mask, idx) => ({
                    segmentation: mask.segmentation,
                    source_layer_ids: ["automask_generation"],
                    name: `automask_${idx}`
                }));
            }

            if (masksToCommit.length === 0) {
                uiManager.showGlobalStatus("No masks available on canvas to commit.", "info");
                return;
            }

            const payload = {
                final_masks: masksToCommit, // These should be binary arrays as per current canvasController
                notes: `Committed on ${new Date().toLocaleString()}`
            };

            uiManager.showGlobalStatus("Committing masks...", "loading", 0);
            try {
                const data = await apiClient.commitMasks(activeProjectId, activeImageHash, payload);
                if (data.success) {
                    uiManager.showGlobalStatus(data.message || "Masks committed successfully.", "success");
                    // Optionally, update image status in the pool
                    if (imagePoolHandler) imagePoolHandler.handleUpdateImageStatus(activeImageHash, 'completed');
                } else {
                    throw new Error(data.error || "Failed to commit masks.");
                }
            } catch (error) {
                uiManager.showGlobalStatus(`Error committing masks: ${utils.escapeHTML(error.message)}`, "error");
            }
        });
    }

    if (exportCocoBtn) {
        exportCocoBtn.addEventListener('click', async () => {
            const activeProjectId = stateManager.getActiveProjectId();
            if (!activeProjectId) {
                uiManager.showGlobalStatus("No active project to export.", "error");
                return;
            }

            // For simplicity, exporting all 'completed' images with 'final_edited' masks
            // A more complex UI would allow selection of images and mask layers.
            const payload = {
                image_hashes: ["all_completed"], // Special keyword for backend
                format: "coco_rle_json",
                mask_layers_to_export: ["final_edited"],
                export_schema: "coco_instance_segmentation"
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


    // --- Application Initialization ---
    function initializeApp() {
        uiManager.showGlobalStatus("Application initializing...", 'loading', 0);

        document.querySelectorAll('.expandable-section').forEach(section => {
            const header = section.querySelector('.expandable-header');
            if (header && uiManager && typeof uiManager.initializeExpandableSection === 'function') {
                // Determine initial collapsed state. Model loader is expanded by default.
                const isInitiallyCollapsed = !(section.id === 'model-loader-expandable' || section.id === 'auto-mask-section');
                uiManager.initializeExpandableSection(header, isInitiallyCollapsed);
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
        // Image pool will be loaded when a project becomes active.

        uiManager.showGlobalStatus("Ready. Load a model, then an image or project.", 'info', 5000);
    }

    initializeApp();
});
