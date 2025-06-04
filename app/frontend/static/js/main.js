// project_root/app/frontend/static/js/main.js
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

    const imageOpacityValueEl = document.getElementById('image-opacity-value');
    const predictionOpacityValueEl = document.getElementById('prediction-opacity-value');
    const userInputOpacityValueEl = document.getElementById('user-input-opacity-value');

    let predictionDebounceTimer = null;
    let currentAutoMaskAbortController = null;

    function showStatus(message, isError = false, duration = null) {
        statusMessageEl.textContent = message;
        statusMessageEl.className = 'status-message ' +
            (isError ? 'error' : (message.includes("Loading") || message.includes("Running")) ? 'info' : 'success');
        if (duration !== 0) {
            setTimeout(() => {
                if (statusMessageEl.textContent === message) {
                    statusMessageEl.textContent = '';
                    statusMessageEl.className = 'status-message';
                }
            }, duration === null ? (isError ? 8000 : 4000) : duration);
        }
    }

    document.addEventListener('canvas-imageLoaded', (event) => {
        showStatus('Image loaded. Ready for interaction.');
        autoMaskStatusEl.textContent = "AutoMask parameters.";
        autoMaskStatusEl.className = 'status-message info small';
    });
    document.addEventListener('canvas-error', (event) => showStatus(event.detail.message, true));
    document.addEventListener('canvas-userInteraction', () => triggerPrediction());
    document.addEventListener('canvas-inputsCleared', (event) => {
        if (event.detail.clearedInputs) showStatus('Inputs and predictions cleared.');
        if (event.detail.clearedImage) {
            showStatus('Image, inputs and predictions cleared.');
            autoMaskStatusEl.textContent = "AutoMask parameters.";
            autoMaskStatusEl.className = 'status-message info small';
        }
    });

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

    setTimeout(() => {
        if (window.canvasManager) {
            window.canvasManager.imageOpacitySlider.addEventListener('input', updateOpacityDisplay);
            window.canvasManager.predictionOpacitySlider.addEventListener('input', updateOpacityDisplay);
            window.canvasManager.userInputOpacitySlider.addEventListener('input', updateOpacityDisplay);
            updateOpacityDisplay();
        }
    }, 100);

    function triggerPrediction() {
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            const inputs = window.canvasManager?.getCurrentInputs();
            if (inputs?.image && (inputs.points.length > 0 || inputs.box || inputs.maskInput)) {
                runPredictionInternal();
            } else if (inputs?.image) {
                window.canvasManager.setManualPredictions(null); 
            }
        }, 300);
    }

    async function runPredictionInternal() {
        const inputs = window.canvasManager?.getCurrentInputs();
        if (!inputs?.image) return;

        window.canvasManager.lockCanvas("Predicting...");
        window.canvasManager.setAutomaskPredictions(null); 

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
                let errorMsg = `Prediction failed: ${res.status}`;
                try {
                    const errData = await res.json();
                    errorMsg += ` - ${errData.error || 'Server error'}`;
                } catch (e) { /* response was not json */ }
                showStatus(errorMsg, true);
                window.canvasManager.setManualPredictions(null);
                return;
            }

            const data = await res.json();
            if (data && data.success) {
                // Pass the raw mask data and scores directly as received from server
                window.canvasManager.setManualPredictions({
                    masks_data: data.masks_data, // This is the list of 2D arrays
                    scores: data.scores
                });
            } else {
                showStatus('Prediction API error: ' + (data ? data.error : "Unknown error or malformed response"), true);
                window.canvasManager.setManualPredictions(null);
            }
        } catch (error) {
            showStatus('Network error during prediction: ' + error.message, true);
            window.canvasManager.setManualPredictions(null);
        } finally {
            window.canvasManager.unlockCanvas();
        }
    }

    async function runAutoMask() {
        const inputs = window.canvasManager?.getCurrentInputs();
        if (!inputs?.image) {
            showStatus("Please load an image first.", true);
            return;
        }

        window.canvasManager.clearAllInputs(false, true); 

        const start = Date.now();
        autoMaskStatusEl.className = 'status-message info small';
        autoMaskStatusEl.textContent = "Running AutoMask...";
        window.canvasManager.lockCanvas("AutoMask running...");
        autoMaskBtn.disabled = true;
        cancelAutoMaskBtn.style.display = 'inline-block';
        recoverAutoMaskBtn.disabled = true;

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
            
            if (!res.ok) {
                let errorMsg = `AutoMask generation failed: ${res.status}`;
                try {
                    const errData = await res.json();
                    errorMsg += ` - ${errData.error || 'Server error'}`;
                } catch (e) { /* response was not json */ }
                showStatus(errorMsg, true);
                autoMaskStatusEl.className = 'status-message error small';
                autoMaskStatusEl.textContent = errorMsg;
                window.canvasManager.setAutomaskPredictions(null);
                return;
            }

            const data = await res.json(); 
            if (data && data.success) { 
                // data is { masks_data: [{segmentation, area, ...}], count: ... }
                // Pass the whole data object to setAutomaskPredictions
                window.canvasManager.setAutomaskPredictions(data); 
                const duration = ((Date.now() - start) / 1000).toFixed(1);
                const statusText = `AutoMask complete (${data.count || 0} masks) in ${duration}s.`;
                autoMaskStatusEl.className = 'status-message success small';
                autoMaskStatusEl.textContent = statusText;
                try {
                    // Compress the data before saving
                    const compressedData = data.masks_data.map(mask => ({
                        segmentation: mask.segmentation, // Keep only the essential segmentation data
                        area: mask.area
                    }));
                    localStorage.setItem(`automask_data_${inputs.filename}`, JSON.stringify(compressedData));
                    localStorage.setItem(`automask_info_${inputs.filename}`, statusText);
                } catch (e) {
                    console.warn("localStorage error on automask save.", e);
                    // Try to save just the first few masks if the full dataset is too large
                    try {
                        const limitedData = data.masks_data.slice(0, 10).map(mask => ({
                            segmentation: mask.segmentation,
                            area: mask.area
                        }));
                        localStorage.setItem(`automask_data_${inputs.filename}`, JSON.stringify(limitedData));
                        localStorage.setItem(`automask_info_${inputs.filename}`, statusText + " (limited to 10 masks)");
                    } catch (e2) {
                        showStatus("Could not save automask to local storage (data too large).", true, 5000);
                    }
                }
            } else {
                const errorDetail = data ? data.error : "Unknown server error or malformed response.";
                autoMaskStatusEl.className = 'status-message error small';
                autoMaskStatusEl.textContent = 'AutoMask failed: ' + errorDetail;
                showStatus('AutoMask failed: ' + errorDetail, true);
                window.canvasManager.setAutomaskPredictions(null);
            }
        } catch (e) {
            const msg = e.name === 'AbortError' ? "AutoMask cancelled." : `Error during AutoMask: ${e.message}`;
            autoMaskStatusEl.className = 'status-message error small';
            autoMaskStatusEl.textContent = msg;
            showStatus(msg, true);
            window.canvasManager.setAutomaskPredictions(null);
        } finally {
            window.canvasManager.unlockCanvas();
            autoMaskBtn.disabled = false;
            cancelAutoMaskBtn.style.display = 'none';
            recoverAutoMaskBtn.disabled = false;
            currentAutoMaskAbortController = null;
        }
    }

    autoMaskBtn.addEventListener('click', runAutoMask);
    cancelAutoMaskBtn.addEventListener('click', () => {
        if (currentAutoMaskAbortController) currentAutoMaskAbortController.abort();
    });

    recoverAutoMaskBtn.addEventListener('click', () => {
        const inputs = window.canvasManager?.getCurrentInputs();
        if (!inputs?.image || !inputs?.filename) {
            showStatus("No image loaded to recover automask for.", true);
            autoMaskStatusEl.textContent = "No image loaded.";
            autoMaskStatusEl.className = 'status-message error small';
            return;
        }
        try {
            const recoveredMasksDataString = localStorage.getItem(`automask_data_${inputs.filename}`);
            const recoveredInfo = localStorage.getItem(`automask_info_${inputs.filename}`);

            if (recoveredMasksDataString) {
                const recoveredMasks = JSON.parse(recoveredMasksDataString);
                window.canvasManager.setAutomaskPredictions({ masks_data: recoveredMasks, count: recoveredMasks.length }); 
                
                autoMaskStatusEl.textContent = "Recovered: " + (recoveredInfo || "Previously generated AutoMask.");
                autoMaskStatusEl.className = 'status-message success small';
                showStatus("AutoMask recovered.", false);
            } else {
                showStatus("No previous AutoMask found for this image.", true);
                autoMaskStatusEl.textContent = "No previous AutoMask found for this image.";
                autoMaskStatusEl.className = 'status-message info small';
            }
        } catch (e) {
            showStatus("Could not recover AutoMask. Storage might be full, disabled, or data corrupted.", true);
            autoMaskStatusEl.textContent = "Error recovering AutoMask.";
            autoMaskStatusEl.className = 'status-message error small';
            console.error("localStorage error on automask recovery.", e);
        }
    });

    saveMasksBtn.addEventListener('click', () => {
        const currentInputs = window.canvasManager?.getCurrentInputs();
        if (!currentInputs?.image) {
            showStatus("No image or prediction to save.", true);
            return;
        }
        const compositeCanvas = document.createElement('canvas');
        const imageCanvas = window.canvasManager.imageCanvas; 
        if (imageCanvas.width === 0 || imageCanvas.height === 0 || (imageCanvas.width === 300 && imageCanvas.height === 150 && !window.canvasManager.currentImage) ) {
            showStatus("Cannot save, image canvas not ready or no image loaded.", true);
            return;
        }
        compositeCanvas.width = imageCanvas.width; 
        compositeCanvas.height = imageCanvas.height;
        const compositeCtx = compositeCanvas.getContext('2d');
        compositeCtx.drawImage(imageCanvas, 0, 0);
        const predictionCanvas = window.canvasManager.predictionMaskCanvas;
        if (predictionCanvas.width > 0 && predictionCanvas.height > 0) {
            compositeCtx.drawImage(predictionCanvas, 0, 0);
        }
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

    autoMaskExpandableHeader.addEventListener('click', () => {
        const collapsed = autoMaskExpandableContent.style.display === 'none';
        autoMaskExpandableContent.style.display = collapsed ? 'block' : 'none';
        autoMaskExpandableHeader.textContent = `Automatic Mask Generation ${collapsed ? '▲' : '▼'}`;
    });

    autoMaskExpandableContent.style.display = 'block';
    autoMaskExpandableHeader.textContent = 'Automatic Mask Generation ▲';
    autoMaskStatusEl.textContent = "AutoMask parameters.";
    autoMaskStatusEl.className = 'status-message info small';
});