// project_root/app/frontend/static/js/main.js

/**
 * @file main.js
 * @description Main frontend script. Initializes the application, orchestrates UI modules,
 * handles global events, and manages communication flow between UI components and the API client.
 *
 * Responsibilities:
 * - Initialize all frontend modules (CanvasManager, APIClient, UI handlers, etc.).
 * - Set up global event listeners for UI elements not managed by specific modules.
 * - Handle core application workflows like image uploading, triggering predictions,
 *   and automask generation by coordinating with appropriate modules.
 * - Display global status messages and notifications.
 *
 * External Dependencies:
 * - canvasController.js (expects `window.CanvasManager` to be defined)
 * - apiClient.js (expects `window.apiClient` to be defined - will be created next)
 * - Other UI handler modules (projectHandler.js, modelHandler.js, etc. - to be created)
 *
 * Input/Output (I/O):
 * Input:
 *   - DOM Elements (various UI controls).
 *   - Events from `canvasController.js` (e.g., `canvas-userInteraction`, `canvas-imageLoaded`).
 *   - Events from `apiClient.js` (e.g., `api-requestSent`, `api-responseReceived`, `api-error`).
 *
 * Output:
 *   - Calls methods on `canvasController.js` (e.g., `loadImageOntoCanvas`, `setManualPredictions`).
 *   - Calls methods on `apiClient.js` (e.g., `uploadImage`, `predictInteractive`).
 *   - Updates general UI elements (status messages, button states).
 */
document.addEventListener('DOMContentLoaded', () => {
    // --- Module Instances ---
    // Assumes canvasController.js has already defined CanvasManager globally or can be imported as a module
    const canvasManager = new CanvasManager(); // Instantiate here
    window.canvasManager = canvasManager; // Make it globally accessible if needed by other scripts directly for now

    // apiClient will be instantiated once created
    // const apiClient = new APIClient();
    // window.apiClient = apiClient;

    // --- DOM Elements (Global or not handled by specific modules yet) ---
    const imageUploadInput = document.getElementById('image-upload'); // For triggering canvasManager
    const imageUploadProgressEl = document.getElementById('image-upload-progress');
    const imageUploadBarEl = document.getElementById('image-upload-bar');

    const autoMaskExpandableHeader = document.querySelector('.auto-mask-section .expandable-header');
    const autoMaskExpandableContent = document.querySelector('.auto-mask-section .expandable-content');
    const autoMaskBtn = document.getElementById('auto-mask-btn');
    const cancelAutoMaskBtn = document.getElementById('cancel-auto-mask-btn');
    const recoverAutoMaskBtn = document.getElementById('recover-auto-mask-btn');
    const autoMaskStatusEl = document.getElementById('auto-mask-status');
    const clearInputsBtn = document.getElementById('clear-inputs-btn');


    const amgPointsPerSideEl = document.getElementById('amg-points-per-side');
    const amgPredIouThreshEl = document.getElementById('amg-pred-iou-thresh');
    const amgStabilityScoreThreshEl = document.getElementById('amg-stability-score-thresh');

    const saveMasksBtn = document.getElementById('save-masks-btn'); // Will be moved to a results/export handler
    const statusMessageEl = document.getElementById('status-message'); // Global status

    // Opacity display value elements
    const imageOpacityValueEl = document.getElementById('image-opacity-value');
    const predictionOpacityValueEl = document.getElementById('prediction-opacity-value');
    const userInputOpacityValueEl = document.getElementById('user-input-opacity-value');


    // --- State Variables ---
    let predictionDebounceTimer = null;
    let currentAutoMaskAbortController = null; // For cancelling automask fetch

    // --- Utility Functions (Main specific) ---
    function showStatus(message, isError = false, duration = null) {
        if (!statusMessageEl) return;
        statusMessageEl.textContent = message;
        statusMessageEl.className = 'status-message ' +
            (isError ? 'error' : (message.includes("Loading") || message.includes("Running")) ? 'info' : 'success');

        // Auto-clear message after duration unless duration is 0 (persistent)
        if (duration !== 0) {
            setTimeout(() => {
                if (statusMessageEl.textContent === message) { // Clear only if message hasn't changed
                    statusMessageEl.textContent = '';
                    statusMessageEl.className = 'status-message';
                }
            }, duration === null ? (isError ? 8000 : 4000) : duration);
        }
    }

    // --- Event Listeners for CanvasManager Events ---
    canvasManager.addEventListener('imageLoaded', (event) => {
        showStatus(`Image '${event.detail.filename}' loaded. Ready for interaction.`);
        if(autoMaskStatusEl) autoMaskStatusEl.textContent = "AutoMask parameters ready.";
        if(autoMaskStatusEl) autoMaskStatusEl.className = 'status-message info small';
        // Potentially enable/disable UI elements based on image loaded state
    });

    canvasManager.addEventListener('error', (event) => {
        showStatus(event.detail.message, true);
    });

    canvasManager.addEventListener('userInteraction', (event) => {
        // event.detail contains { points, box, maskInput, imagePresent, filename }
        triggerInteractivePrediction(event.detail);
    });

    canvasManager.addEventListener('inputsCleared', (event) => {
        // event.detail contains { clearedImage, clearedInputs }
        if (event.detail.clearedInputs && !event.detail.clearedImage) {
            showStatus('Inputs and predictions cleared.');
        } else if (event.detail.clearedImage) {
            showStatus('Image, inputs, and predictions cleared.');
            if(autoMaskStatusEl) autoMaskStatusEl.textContent = "AutoMask parameters.";
            if(autoMaskStatusEl) autoMaskStatusEl.className = 'status-message info small';
        }
    });

    canvasManager.addEventListener('opacityChanged', (event) => {
        // event.detail contains { layer: string, value: number }
        const { layer, value } = event.detail;
        const percentage = Math.round(value * 100);
        if (layer === 'image' && imageOpacityValueEl) imageOpacityValueEl.textContent = `${percentage}%`;
        if (layer === 'prediction' && predictionOpacityValueEl) predictionOpacityValueEl.textContent = `${percentage}%`;
        if (layer === 'userInput' && userInputOpacityValueEl) userInputOpacityValueEl.textContent = `${percentage}%`;
    });


    // --- Event Listeners for UI Elements (Main responsibility) ---
    if (imageUploadInput) {
        imageUploadInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                handleImageUpload(file); // Call new handler function
            }
        });
    }

    if (clearInputsBtn) {
        clearInputsBtn.addEventListener('click', () => {
            canvasManager.clearAllCanvasInputs(false); // Clear inputs and predictions, not image
        });
    }


    if (autoMaskExpandableHeader) {
        autoMaskExpandableHeader.addEventListener('click', () => {
            const isCurrentlyCollapsed = autoMaskExpandableContent.style.display === 'none' || autoMaskExpandableContent.classList.contains('collapsed');
            if (isCurrentlyCollapsed) {
                autoMaskExpandableContent.style.display = 'block';
                autoMaskExpandableContent.classList.remove('collapsed');
                autoMaskExpandableHeader.innerHTML = 'Automatic Mask Generation <span class="expand-indicator">▲</span>';
            } else {
                autoMaskExpandableContent.style.display = 'none';
                autoMaskExpandableContent.classList.add('collapsed');
                autoMaskExpandableHeader.innerHTML = 'Automatic Mask Generation <span class="expand-indicator">▼</span>';
            }
        });
        // Initialize open
        autoMaskExpandableContent.style.display = 'block';
        autoMaskExpandableHeader.innerHTML = 'Automatic Mask Generation <span class="expand-indicator">▲</span>';
        if (autoMaskStatusEl) {
             autoMaskStatusEl.textContent = "AutoMask parameters.";
             autoMaskStatusEl.className = 'status-message info small';
        }

    }

    if (autoMaskBtn) autoMaskBtn.addEventListener('click', runAutoMaskGeneration);
    if (cancelAutoMaskBtn) {
        cancelAutoMaskBtn.addEventListener('click', () => {
            if (currentAutoMaskAbortController) {
                currentAutoMaskAbortController.abort();
            }
        });
    }
    if (recoverAutoMaskBtn) recoverAutoMaskBtn.addEventListener('click', recoverAutoMaskFromStorage);


    // --- Core Logic Functions ---
    async function handleImageUpload(file) {
        // This function will use apiClient.uploadImage once it's available
        // For now, it simulates the structure and calls canvasManager directly after "upload"
        showStatus(`Uploading ${file.name}...`, false, 0); // Persistent loading message
        if (imageUploadProgressEl) imageUploadProgressEl.style.display = 'block';
        if (imageUploadBarEl) {
            imageUploadBarEl.style.width = '0%';
            imageUploadBarEl.textContent = '0%';
        }
        canvasManager.lockCanvas("Uploading image...");

        // --- SIMULATED API CLIENT CALL ---
        // Replace this with actual: const response = await apiClient.uploadImage(file, progressCallback);
        const formData = new FormData();
        formData.append('image', file);

        try {
            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && imageUploadBarEl) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    imageUploadBarEl.style.width = percentComplete + '%';
                    imageUploadBarEl.textContent = percentComplete + '%';
                }
            };
            xhr.onload = async () => {
                canvasManager.unlockCanvas();
                if(imageUploadProgressEl) imageUploadProgressEl.style.display = 'none';
                if (xhr.status === 200) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.success) {
                            const imageElement = new Image();
                            imageElement.onload = () => {
                                canvasManager.clearAllCanvasInputs(true); // Clear everything including old image
                                canvasManager.loadImageOntoCanvas(imageElement, data.width, data.height, data.filename || file.name);
                            };
                            imageElement.onerror = () => {
                                showStatus('Failed to load image data from server response.', true);
                                canvasManager.dispatchEvent('error', { message: 'Failed to load image data from server response.'});
                            };
                            imageElement.src = data.image_data;
                        } else {
                            showStatus('Failed to upload image: ' + (data.error || "Unknown server error"), true);
                        }
                    } catch (parseError) {
                        showStatus('Invalid response from server during image upload.', true);
                         console.error('Upload JSON parse error:', parseError, xhr.responseText.substring(0,200));
                    }
                } else {
                    showStatus(`Image upload failed: ${xhr.status} ${xhr.statusText || "Server error"}`, true);
                }
            };
            xhr.onerror = () => {
                canvasManager.unlockCanvas();
                 if(imageUploadProgressEl) imageUploadProgressEl.style.display = 'none';
                showStatus('Image upload error (network or server unavailable).', true);
            };
            xhr.open('POST', '/api/upload_image', true); // Hardcoded API endpoint for now
            xhr.send(formData);
        } catch (error) {
            canvasManager.unlockCanvas();
            if(imageUploadProgressEl) imageUploadProgressEl.style.display = 'none';
            showStatus('Error setting up image upload: ' + error.message, true);
        }
        // --- END SIMULATED API CLIENT CALL ---
    }


    function triggerInteractivePrediction(canvasInputs) {
        // canvasInputs = { points, box, maskInput, imagePresent, filename }
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            if (canvasInputs.imagePresent &&
                (canvasInputs.points.length > 0 || canvasInputs.box || canvasInputs.maskInput)) {
                runInteractivePrediction(canvasInputs);
            } else if (canvasInputs.imagePresent) {
                // No inputs, clear previous manual predictions
                canvasManager.setManualPredictions(null);
            }
        }, 300); // Debounce for 300ms
    }

    async function runInteractivePrediction(canvasInputs) {
        // This function will use apiClient.predictInteractive once available
        if (!canvasInputs.imagePresent) return;

        canvasManager.lockCanvas("Predicting...");
        canvasManager.setAutomaskPredictions(null); // Clear automasks when doing interactive

        const payload = {
            points: canvasInputs.points.map(p => [p.x, p.y]),
            labels: canvasInputs.points.map(p => p.label),
            box: canvasInputs.box ? [canvasInputs.box.x1, canvasInputs.box.y1, canvasInputs.box.x2, canvasInputs.box.y2] : null,
            maskInput: canvasInputs.maskInput, // This is the 256x256 array from canvasController
            multimask_output: true // Default for interactive SAM
        };

        // --- SIMULATED API CLIENT CALL ---
        // Replace with: const response = await apiClient.predictInteractive(payload);
        try {
            const res = await fetch('/api/predict', { // Hardcoded API endpoint for now
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                let errorMsg = `Prediction failed: ${res.status}`;
                try { const errData = await res.json(); errorMsg += ` - ${errData.error || 'Server error'}`; } catch (e) { /* ignore */ }
                showStatus(errorMsg, true);
                canvasManager.setManualPredictions(null); // Clear predictions on error
                return;
            }

            const data = await res.json();
            if (data && data.success) {
                // canvasManager expects { masks_data: [2D_arrays], scores: [numbers] }
                canvasManager.setManualPredictions({
                    masks_data: data.masks_data,
                    scores: data.scores
                });
            } else {
                showStatus('Prediction API error: ' + (data ? data.error : "Unknown error"), true);
                canvasManager.setManualPredictions(null);
            }
        } catch (error) {
            showStatus('Network error during prediction: ' + error.message, true);
            canvasManager.setManualPredictions(null);
        } finally {
            canvasManager.unlockCanvas();
        }
        // --- END SIMULATED API CLIENT CALL ---
    }

    async function runAutoMaskGeneration() {
        const currentCanvasState = canvasManager.getCurrentCanvasInputs();
        if (!currentCanvasState.imagePresent) {
            showStatus("Please load an image first for AutoMask.", true);
            return;
        }

        canvasManager.clearAllCanvasInputs(false); // Clear existing user inputs and predictions

        const startTime = Date.now();
        if (autoMaskStatusEl) {
            autoMaskStatusEl.className = 'status-message info small';
            autoMaskStatusEl.textContent = "Running AutoMask...";
        }
        canvasManager.lockCanvas("AutoMask running...");
        if (autoMaskBtn) autoMaskBtn.disabled = true;
        if (cancelAutoMaskBtn) cancelAutoMaskBtn.style.display = 'inline-block';
        if (recoverAutoMaskBtn) recoverAutoMaskBtn.disabled = true;

        currentAutoMaskAbortController = new AbortController();
        const signal = currentAutoMaskAbortController.signal;

        const params = { // Get params from UI or use defaults
            points_per_side: amgPointsPerSideEl ? parseInt(amgPointsPerSideEl.value) || 32 : 32,
            pred_iou_thresh: amgPredIouThreshEl ? parseFloat(amgPredIouThreshEl.value) || 0.88 : 0.88,
            stability_score_thresh: amgStabilityScoreThreshEl ? parseFloat(amgStabilityScoreThreshEl.value) || 0.95 : 0.95,
            // Add other AMG params from spec if UI controls are added
        };

        // --- SIMULATED API CLIENT CALL ---
        // Replace with: const response = await apiClient.generateAutoMasks(params, signal);
        try {
            const res = await fetch('/api/generate_auto_masks', { // Hardcoded for now
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal
            });

            if (signal.aborted) { // Check if fetch was aborted
                if (autoMaskStatusEl) autoMaskStatusEl.textContent = "AutoMask cancelled.";
                showStatus("AutoMask cancelled by user.");
                return; // Exit early
            }

            if (!res.ok) {
                let errorMsg = `AutoMask generation failed: ${res.status}`;
                try { const errData = await res.json(); errorMsg += ` - ${errData.error || 'Server error'}`; } catch (e) { /* ignore */ }
                if (autoMaskStatusEl) { autoMaskStatusEl.className = 'status-message error small'; autoMaskStatusEl.textContent = errorMsg; }
                showStatus(errorMsg, true);
                canvasManager.setAutomaskPredictions(null); // Clear on error
                return;
            }

            const data = await res.json(); // Expects { success: bool, masks_data: [{segmentation, area, ...}], count: num }
            if (data && data.success) {
                canvasManager.setAutomaskPredictions(data); // Pass the whole data object
                const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                const statusText = `AutoMask complete (${data.count || 0} masks) in ${duration}s.`;
                if (autoMaskStatusEl) { autoMaskStatusEl.className = 'status-message success small'; autoMaskStatusEl.textContent = statusText; }
                try {
                    // Compress for localStorage: store only segmentation and area
                    const storableData = data.masks_data.map(m => ({segmentation: m.segmentation, area: m.area }));
                    localStorage.setItem(`automask_data_${currentCanvasState.filename}`, JSON.stringify(storableData));
                    localStorage.setItem(`automask_info_${currentCanvasState.filename}`, statusText);
                } catch (e) {
                    console.warn("localStorage error on automask save (data might be too large).", e);
                     showStatus("Could not save automask to local storage (data too large). Consider reducing points_per_side.", true, 8000);
                }
            } else {
                const errorDetail = data ? data.error : "Unknown server error.";
                if (autoMaskStatusEl) { autoMaskStatusEl.className = 'status-message error small'; autoMaskStatusEl.textContent = 'AutoMask API error: ' + errorDetail; }
                showStatus('AutoMask API error: ' + errorDetail, true);
                canvasManager.setAutomaskPredictions(null);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                if (autoMaskStatusEl) autoMaskStatusEl.textContent = "AutoMask cancelled.";
                showStatus("AutoMask cancelled by user.");
            } else {
                if (autoMaskStatusEl) { autoMaskStatusEl.className = 'status-message error small'; autoMaskStatusEl.textContent = `Network error: ${error.message}`; }
                showStatus(`Network error during AutoMask: ${error.message}`, true);
                canvasManager.setAutomaskPredictions(null);
            }
        } finally {
            canvasManager.unlockCanvas();
            if (autoMaskBtn) autoMaskBtn.disabled = false;
            if (cancelAutoMaskBtn) cancelAutoMaskBtn.style.display = 'none';
            if (recoverAutoMaskBtn) recoverAutoMaskBtn.disabled = false;
            currentAutoMaskAbortController = null;
        }
        // --- END SIMULATED API CLIENT CALL ---
    }

    function recoverAutoMaskFromStorage() {
        const currentCanvasState = canvasManager.getCurrentCanvasInputs();
        if (!currentCanvasState.imagePresent || !currentCanvasState.filename) {
            showStatus("No image loaded to recover automask for.", true);
            if (autoMaskStatusEl) { autoMaskStatusEl.textContent = "No image loaded."; autoMaskStatusEl.className = 'status-message error small'; }
            return;
        }
        try {
            const recoveredDataString = localStorage.getItem(`automask_data_${currentCanvasState.filename}`);
            const recoveredInfo = localStorage.getItem(`automask_info_${currentCanvasState.filename}`);

            if (recoveredDataString) {
                const recoveredMasks = JSON.parse(recoveredDataString); // This is array of {segmentation, area}
                // Reconstruct the expected structure for setAutomaskPredictions
                canvasManager.setAutomaskPredictions({ masks_data: recoveredMasks, count: recoveredMasks.length });
                if (autoMaskStatusEl) { autoMaskStatusEl.textContent = "Recovered: " + (recoveredInfo || "Previously generated AutoMask."); autoMaskStatusEl.className = 'status-message success small'; }
                showStatus("AutoMask recovered from local storage.", false);
            } else {
                showStatus("No previous AutoMask found in local storage for this image.", true);
                 if (autoMaskStatusEl) { autoMaskStatusEl.textContent = "No previous AutoMask found."; autoMaskStatusEl.className = 'status-message info small'; }
            }
        } catch (e) {
            showStatus("Error recovering AutoMask. Storage might be full, disabled, or data corrupted.", true);
            if (autoMaskStatusEl) { autoMaskStatusEl.textContent = "Error recovering AutoMask."; autoMaskStatusEl.className = 'status-message error small';}
            console.error("localStorage error on automask recovery.", e);
        }
    }


    if (saveMasksBtn) { // This is a temporary save function, real save/commit goes to backend
        saveMasksBtn.addEventListener('click', () => {
            const currentInputs = canvasManager.getCurrentCanvasInputs();
            if (!currentInputs.imagePresent) {
                showStatus("No image or prediction to save.", true);
                return;
            }
            // This saves a composite of visible canvases, not structured mask data.
            // For proper mask saving, you'd get structured mask data from canvasManager
            // (e.g., from selected masks in automaskPredictions or manualPredictions)
            // and send it to an API endpoint (e.g., /api/.../commit_masks).

            const displayWidth = canvasManager.imageCanvas.width;
            const displayHeight = canvasManager.imageCanvas.height;

            if (displayWidth === 0 || displayHeight === 0 || (displayWidth === 300 && displayHeight === 150 && !canvasManager.currentImage) ) {
                 showStatus("Cannot save, image canvas not ready or no image loaded.", true);
                return;
            }

            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = displayWidth;
            compositeCanvas.height = displayHeight;
            const compositeCtx = compositeCanvas.getContext('2d');

            // Draw image layer
            compositeCtx.globalAlpha = parseFloat(canvasManager.imageOpacitySlider.value);
            compositeCtx.drawImage(canvasManager.imageCanvas, 0, 0);

            // Draw prediction layer
            compositeCtx.globalAlpha = parseFloat(canvasManager.predictionOpacitySlider.value);
            compositeCtx.drawImage(canvasManager.predictionMaskCanvas, 0, 0);
            
            // Draw user input layer
            compositeCtx.globalAlpha = parseFloat(canvasManager.userInputOpacitySlider.value);
            compositeCtx.drawImage(canvasManager.userInputCanvas, 0, 0);
            
            compositeCtx.globalAlpha = 1.0; // Reset alpha


            const dataURL = compositeCanvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.href = dataURL;
            const filenameBase = currentInputs.filename ? currentInputs.filename.split('.').slice(0, -1).join('.') : 'sam_output';
            link.download = `${filenameBase}_overlay_preview.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showStatus("Image with overlays (preview) saved.");
        });
    }


    // --- Initial UI Setup ---
    function initializeUI() {
        // Set initial opacity display values based on slider defaults
        canvasManager.dispatchEvent('opacityChanged', { layer: 'image', value: parseFloat(canvasManager.imageOpacitySlider.value) });
        canvasManager.dispatchEvent('opacityChanged', { layer: 'prediction', value: parseFloat(canvasManager.predictionOpacitySlider.value) });
        canvasManager.dispatchEvent('opacityChanged', { layer: 'userInput', value: parseFloat(canvasManager.userInputOpacitySlider.value) });
        
        // Hide cancel automask button initially
        if(cancelAutoMaskBtn) cancelAutoMaskBtn.style.display = 'none';

        showStatus("Application initialized. Please load a model and an image.", false, 5000);
    }

    initializeUI(); // Call initialization
});