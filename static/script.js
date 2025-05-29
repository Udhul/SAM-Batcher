// static/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const autoMaskExpandableHeader = document.querySelector('.auto-mask-section .expandable-header');
    const autoMaskExpandableContent = document.querySelector('.auto-mask-section .expandable-content');
    const autoMaskBtn = document.getElementById('auto-mask-btn');
    const cancelAutoMaskBtn = document.getElementById('cancel-auto-mask-btn');
    const recoverAutoMaskBtn = document.getElementById('recover-auto-mask-btn');
    const autoMaskStatusEl = document.getElementById('auto-mask-status');

    const amgPointsPerSideEl = document.getElementById('amg-points-per-side');
    const amgPredIouThreshEl = document.getElementById('amg-pred-iou-thresh');
    const amgStabilityScoreThreshEl = document.getElementById('amg-stability-score-thresh');

    const saveMasksBtn = document.getElementById('save-masks-btn');
    const statusMessageEl = document.getElementById('status-message');

    // Opacity value display elements
    const imageOpacityValueEl = document.getElementById('image-opacity-value');
    const predictionOpacityValueEl = document.getElementById('prediction-opacity-value');
    const userInputOpacityValueEl = document.getElementById('user-input-opacity-value');

    // --- State Variables ---
    let predictionDebounceTimer = null;
    let currentAutoMaskAbortController = null;

    // --- Utility Functions ---
    function showStatus(message, isError = false, duration = null) {
        statusMessageEl.textContent = message;
        statusMessageEl.className = 'status-message ' +
            (isError
                ? 'error'
                : (message.includes("Loading") || message.includes("Running")) ? 'info' : 'success');
        if (duration !== 0) {
            setTimeout(() => {
                if (statusMessageEl.textContent === message) {
                    statusMessageEl.textContent = '';
                    statusMessageEl.className = 'status-message';
                }
            }, duration === null ? (isError ? 8000 : 4000) : duration);
        }
    }

    // --- Canvas Event Handlers ---
    document.addEventListener('canvas-imageLoaded', (event) => {
        showStatus('Image loaded. Ready for interaction.');
        // Clear any previous automask status related to a different image
        autoMaskStatusEl.textContent = "AutoMask parameters.";
        autoMaskStatusEl.className = 'status-message info small';
    });

    document.addEventListener('canvas-error', (event) => {
        showStatus(event.detail.message, true);
    });
    document.addEventListener('canvas-userInteraction', () => {
        triggerPrediction();
    });

    document.addEventListener('canvas-inputsCleared', (event) => {
        if (event.detail.clearedInputs) {
            showStatus('Inputs and predictions cleared.');
        }
        if (event.detail.clearedImage) {
            showStatus('Image, inputs and predictions cleared.');
             // Clear automask status if image is cleared
            autoMaskStatusEl.textContent = "AutoMask parameters.";
            autoMaskStatusEl.className = 'status-message info small';
        }
    });

    // --- Opacity Value Display Updates ---
    function updateOpacityDisplay() {
        if (window.canvasManager) {
            const imageOpacity = Math.round(window.canvasManager.imageOpacitySlider.value * 100);
            const predictionOpacity = Math.round(window.canvasManager.predictionOpacitySlider.value * 100);
            const userInputOpacity = Math.round(window.canvasManager.userInputOpacitySlider.value * 100);
            
            if (imageOpacityValueEl) imageOpacityValueEl.textContent = `${imageOpacity}%`;
            if (predictionOpacityValueEl) predictionOpacityValueEl.textContent = `${predictionOpacity}%`;
            if (userInputOpacityValueEl) userInputOpacityValueEl.textContent = `${userInputOpacity}%`;
        }
    }

    // Set up opacity display updates
    setTimeout(() => {
        if (window.canvasManager) {
            window.canvasManager.imageOpacitySlider.addEventListener('input', updateOpacityDisplay);
            window.canvasManager.predictionOpacitySlider.addEventListener('input', updateOpacityDisplay);
            window.canvasManager.userInputOpacitySlider.addEventListener('input', updateOpacityDisplay);
            updateOpacityDisplay(); // Initial update
        }
    }, 100);

    // --- API Calls & Prediction Logic ---
    function triggerPrediction() {
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            const inputs = window.canvasManager?.getCurrentInputs();
            if (inputs?.image && (inputs.points.length > 0 || inputs.box || inputs.maskInput)) {
                runPredictionInternal();
            } else if (inputs?.image) {
                // No inputs, clear previous manual predictions
                window.canvasManager.setPredictedMasks([]); 
                // Do not clear automasks here, user might want to interact on top of them or clear them explicitly
            }
        }, 300);
    }

    async function runPredictionInternal() {
        const inputs = window.canvasManager?.getCurrentInputs();
        if (!inputs?.image) return;

        window.canvasManager.lockCanvas("Predicting...");
        // Clear any previous automask results when making a manual prediction
        window.canvasManager.setAutoMasksData(null); 

        const payload = {
            points: inputs.points.map(p => [p.x, p.y]),
            labels: inputs.points.map(p => p.label),
            box: inputs.box ? [inputs.box.x1, inputs.box.y1, inputs.box.x2, inputs.box.y2] : null,
            mask_input: inputs.maskInput,
            multimask_output: true
        };

        try {
            const res = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: res.statusText }));
                showStatus(`Prediction failed: ${res.status} ${errData.error || 'Server error'}`, true);
                window.canvasManager.setPredictedMasks([]);
                return;
            }
            const data = await res.json();
            if (data.success) {
                const masks = data.masks.map((m, i) => ({ maskBase64: m, score: data.scores[i] || 0 }));
                masks.sort((a, b) => b.score - a.score);
                window.canvasManager.setPredictedMasks(masks); // This now also clears automasks
            } else {
                showStatus('Prediction API error: ' + (data.error || "Unknown error"), true);
                window.canvasManager.setPredictedMasks([]);
            }
        } catch (error) {
            showStatus('Network error during prediction: ' + error, true);
            window.canvasManager.setPredictedMasks([]);
        } finally {
            window.canvasManager.unlockCanvas();
        }
    }

    // --- AutoMask Logic ---
    async function runAutoMask() {
        const inputs = window.canvasManager?.getCurrentInputs();
        if (!inputs?.image) {
            showStatus("Please load an image first.", true);
            return;
        }

        // Clear previous manual predictions and user inputs, but not the image
        window.canvasManager.clearAllInputs(false, true); 
        // setAutoMasksData(null) will be called by clearAllInputs via canvasManager.autoMasksRawData = null

        const start = Date.now();
        autoMaskStatusEl.className = 'status-message info small';
        autoMaskStatusEl.textContent = "Running AutoMask...";
        window.canvasManager.lockCanvas("AutoMask running...");
        autoMaskBtn.disabled = true;
        cancelAutoMaskBtn.style.display = 'inline-block';
        recoverAutoMaskBtn.disabled = true; // Disable recover while running

        currentAutoMaskAbortController = new AbortController();
        const signal = currentAutoMaskAbortController.signal;

        const params = {
            points_per_side: parseInt(amgPointsPerSideEl.value) || 32,
            pred_iou_thresh: parseFloat(amgPredIouThreshEl.value) || 0.88,
            stability_score_thresh: parseFloat(amgStabilityScoreThreshEl.value) || 0.95
        };

        try {
            const res = await fetch('/api/generate_auto_masks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal
            });

            if (signal.aborted) {
                autoMaskStatusEl.textContent = "AutoMask cancelled.";
                showStatus("AutoMask cancelled.");
                return;
            }
            
            const data = await res.json();
            if (data.success) {
                window.canvasManager.setAutoMasksData(data.masks_data); // Use new method with raw data
                const duration = ((Date.now() - start) / 1000).toFixed(1);
                const statusText = `AutoMask complete (${data.count} masks) in ${duration}s.`;
                autoMaskStatusEl.className = 'status-message success small';
                autoMaskStatusEl.textContent = statusText;
                try {
                    // Store raw masks_data and the status text
                    localStorage.setItem(`automask_raw_${inputs.filename}`, JSON.stringify(data.masks_data));
                    localStorage.setItem(`automask_info_${inputs.filename}`, statusText);
                } catch (e) {
                    console.warn("localStorage unavailable for automask recovery.", e);
                    showStatus("Could not save automask to local storage. It might be full or disabled.", true);
                }
            } else {
                autoMaskStatusEl.className = 'status-message error small';
                autoMaskStatusEl.textContent = 'AutoMask failed: ' + (data.error || "Unknown");
                showStatus('AutoMask failed: ' + (data.error || "Unknown"), true);
                window.canvasManager.setAutoMasksData(null);
            }
        } catch (e) {
            const msg = e.name === 'AbortError'
                ? "AutoMask cancelled."
                : 'Error during AutoMask: ' + e;
            autoMaskStatusEl.className = 'status-message error small';
            autoMaskStatusEl.textContent = msg;
            showStatus(msg, true);
            window.canvasManager.setAutoMasksData(null);
        } finally {
            window.canvasManager.unlockCanvas();
            autoMaskBtn.disabled = false;
            cancelAutoMaskBtn.style.display = 'none';
            recoverAutoMaskBtn.disabled = false;
            currentAutoMaskAbortController = null;
        }
    }

    // --- AutoMask Event Handlers ---
    autoMaskBtn.addEventListener('click', runAutoMask);
    
    cancelAutoMaskBtn.addEventListener('click', () => {
        if (currentAutoMaskAbortController) currentAutoMaskAbortController.abort();
    });

    recoverAutoMaskBtn.addEventListener('click', () => {
        const inputs = window.canvasManager?.getCurrentInputs();
        if (!inputs?.image || !inputs?.filename) { // Ensure image is loaded
            showStatus("No image loaded to recover automask for.", true);
            autoMaskStatusEl.textContent = "No image loaded.";
            autoMaskStatusEl.className = 'status-message error small';
            return;
        }
        try {
            const recoveredRawMasksString = localStorage.getItem(`automask_raw_${inputs.filename}`);
            const recoveredInfo = localStorage.getItem(`automask_info_${inputs.filename}`);

            if (recoveredRawMasksString) {
                const recoveredMasksData = JSON.parse(recoveredRawMasksString);
                window.canvasManager.setAutoMasksData(recoveredMasksData); 
                // setAutoMasksData in canvas.js now also clears manual predictions (allPredictedMasksData)
                
                autoMaskStatusEl.textContent = "Recovered: " + (recoveredInfo || "Previously generated AutoMask.");
                autoMaskStatusEl.className = 'status-message success small';
                showStatus("AutoMask recovered.", false);
            } else {
                showStatus("No previous AutoMask found for this image.", true);
                autoMaskStatusEl.textContent = "No previous AutoMask found for this image.";
                autoMaskStatusEl.className = 'status-message info small';
            }
        } catch (e) {
            showStatus("Could not recover AutoMask from local storage. Storage might be full, disabled, or data corrupted.", true);
            autoMaskStatusEl.textContent = "Error recovering AutoMask.";
            autoMaskStatusEl.className = 'status-message error small';
            console.error("localStorage error on automask recovery.", e);
        }
    });

    // --- Save Masks ---
    saveMasksBtn.addEventListener('click', () => {
        const currentInputs = window.canvasManager?.getCurrentInputs();
        if (!currentInputs?.image) {
            showStatus("No image or prediction to save.", true);
            return;
        }

        const compositeCanvas = document.createElement('canvas');
        const imageCanvas = window.canvasManager.imageCanvas; // Visible image canvas

        if (imageCanvas.width === 0 || imageCanvas.height === 0 || imageCanvas.width === 300 && imageCanvas.height === 150 && !window.canvasManager.currentImage) {
             // Check for placeholder size if no image actually loaded
            showStatus("Cannot save, image canvas not ready or no image loaded.", true);
            return;
        }
        
        compositeCanvas.width = imageCanvas.width; // Use display dimensions for saved image
        compositeCanvas.height = imageCanvas.height;
        const compositeCtx = compositeCanvas.getContext('2d');

        // Draw base image (respecting its current opacity setting on the main canvas)
        // To get the image with its UI-set opacity, draw the imageCanvas itself.
        compositeCtx.drawImage(imageCanvas, 0, 0);


        // Draw predictions (respecting their current opacity)
        // The predictionMaskCanvas already has masks drawn with their individual alpha
        // AND the global prediction layer opacity applied.
        const predictionCanvas = window.canvasManager.predictionMaskCanvas;
        if (predictionCanvas.width > 0 && predictionCanvas.height > 0) {
            compositeCtx.drawImage(predictionCanvas, 0, 0);
        }


        // Draw user inputs (respecting their current opacity)
        // The userInputCanvas already has inputs drawn with global user input layer opacity.
        const userInputLayerCanvas = window.canvasManager.userInputCanvas;
        if (userInputLayerCanvas.width > 0 && userInputLayerCanvas.height > 0) {
            compositeCtx.drawImage(userInputLayerCanvas, 0, 0);
        }
        
        const dataURL = compositeCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        const filenameBase = currentInputs.filename ? currentInputs.filename.split('.').slice(0, -1).join('.') : 'sam_output';
        link.download = `${filenameBase}_overlay.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showStatus("Image with overlays saved.");
    });

    // --- Expand/Collapse AutoMask ---
    autoMaskExpandableHeader.addEventListener('click', () => {
        const collapsed = autoMaskExpandableContent.style.display === 'none';
        if (collapsed) {
            autoMaskExpandableContent.style.display = 'block';
            autoMaskExpandableHeader.textContent = 'Automatic Mask Generation ▲';
        } else {
            autoMaskExpandableContent.style.display = 'none';
            autoMaskExpandableHeader.textContent = 'Automatic Mask Generation ▼';
        }
    });

    // --- Initial State ---
    autoMaskExpandableContent.style.display = 'block'; // Or 'none' if default collapsed
    autoMaskExpandableHeader.textContent = 'Automatic Mask Generation ▲'; // Match display
    autoMaskStatusEl.textContent = "AutoMask parameters."; // Initial message
    autoMaskStatusEl.className = 'status-message info small';

});