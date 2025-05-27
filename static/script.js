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
                window.canvasManager.setPredictedMasks([]);
            }
        }, 300);
    }

    async function runPredictionInternal() {
        const inputs = window.canvasManager?.getCurrentInputs();
        if (!inputs?.image) return;

        window.canvasManager.lockCanvas("Predicting...");
        window.canvasManager.setAutoMaskComposite(null);

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
                const err = await res.text();
                showStatus(`Prediction failed: ${res.status} ${err}`, true);
                window.canvasManager.setPredictedMasks([]);
                return;
            }
            const data = await res.json();
            if (data.success) {
                const masks = data.masks.map((m, i) => ({ maskBase64: m, score: data.scores[i] || 0 }));
                masks.sort((a, b) => b.score - a.score);
                window.canvasManager.setPredictedMasks(masks);
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

        window.canvasManager.setPredictedMasks([]);
        window.canvasManager.clearAllInputs(false, true);

        const start = Date.now();
        autoMaskStatusEl.className = 'status-message info small';
        autoMaskStatusEl.textContent = "Running AutoMask...";
        window.canvasManager.lockCanvas("AutoMask running...");
        autoMaskBtn.disabled = true;
        cancelAutoMaskBtn.style.display = 'inline-block';

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
                window.canvasManager.setAutoMaskComposite(data.auto_mask_composite);
                const duration = ((Date.now() - start) / 1000).toFixed(1);
                autoMaskStatusEl.className = 'status-message success small';
                autoMaskStatusEl.textContent = `AutoMask complete in ${duration}s.`;
            try {
                localStorage.setItem(`automask_${inputs.filename}`, data.auto_mask_composite);
                localStorage.setItem(`automask_info_${inputs.filename}`, autoMaskStatusEl.textContent);
            } catch (e) {
                console.warn("localStorage unavailable for automask recovery.", e);
            }
            } else {
                autoMaskStatusEl.className = 'status-message error small';
                autoMaskStatusEl.textContent = 'AutoMask failed: ' + (data.error || "Unknown");
                showStatus('AutoMask failed: ' + (data.error || "Unknown"), true);
                window.canvasManager.setAutoMaskComposite(null);
            }
        } catch (e) {
            const msg = e.name === 'AbortError'
                ? "AutoMask cancelled."
                : 'Error during AutoMask: ' + e;
            autoMaskStatusEl.className = 'status-message error small';
            autoMaskStatusEl.textContent = msg;
            showStatus(msg, true);
            window.canvasManager.setAutoMaskComposite(null);
        } finally {
            window.canvasManager.unlockCanvas();
            autoMaskBtn.disabled = false;
            cancelAutoMaskBtn.style.display = 'none';
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
        if (!inputs?.filename) {
            showStatus("No image loaded to recover automask for.", true);
            autoMaskStatusEl.textContent = "No image loaded.";
            autoMaskStatusEl.className = 'status-message error small';
            return;
        }
        try {
            const recoveredComposite = localStorage.getItem(`automask_${inputs.filename}`);
            const recoveredInfo = localStorage.getItem(`automask_info_${inputs.filename}`);
            if (recoveredComposite) {
                window.canvasManager.setAutoMaskComposite(recoveredComposite);
                window.canvasManager.setPredictedMasks([]);
                autoMaskStatusEl.textContent = "Recovered: " + (recoveredInfo || "Previously generated AutoMask.");
                autoMaskStatusEl.className = 'status-message success small';
                showStatus("AutoMask recovered.", false);
            } else {
                showStatus("No previous AutoMask found for this image.", true);
                autoMaskStatusEl.textContent = "No previous AutoMask found for this image.";
                autoMaskStatusEl.className = 'status-message info small';
            }
        } catch (e) {
            showStatus("Could not recover AutoMask from local storage. Storage might be full or disabled.", true);
            autoMaskStatusEl.textContent = "Error recovering AutoMask.";
            autoMaskStatusEl.className = 'status-message error small';
            console.warn("localStorage error on automask recovery.", e);
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
        const imageCanvas = window.canvasManager.imageCanvas;

        if (imageCanvas.width === 0 || imageCanvas.height === 0) {
            showStatus("Cannot save, image canvas not ready.", true);
            return;
        }

        compositeCanvas.width = imageCanvas.width;
        compositeCanvas.height = imageCanvas.height;
        const compositeCtx = compositeCanvas.getContext('2d');

        // Draw base image
        compositeCtx.drawImage(imageCanvas, 0, 0);

        // Draw predictions
        const offscreenPredictionCanvas = window.canvasManager.offscreenPredictionCanvas;
        if (offscreenPredictionCanvas.width > 0 && offscreenPredictionCanvas.height > 0) {
            compositeCtx.globalAlpha = parseFloat(window.canvasManager.predictionOpacitySlider.value);
            compositeCtx.drawImage(offscreenPredictionCanvas, 0, 0);
            compositeCtx.globalAlpha = 1.0;
        }

        // Draw user inputs
        const offscreenUserCanvas = window.canvasManager.offscreenUserCanvas;
        if (offscreenUserCanvas.width > 0 && offscreenUserCanvas.height > 0) {
            compositeCtx.globalAlpha = parseFloat(window.canvasManager.userInputOpacitySlider.value);
            compositeCtx.drawImage(offscreenUserCanvas, 0, 0);
            compositeCtx.globalAlpha = 1.0;
        }

        const dataURL = compositeCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataURL;
        link.download = 'sam_prediction_overlay.png';
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
    autoMaskExpandableContent.style.display = 'block';
    autoMaskExpandableHeader.textContent = 'Automatic Mask Generation ▲';
});
