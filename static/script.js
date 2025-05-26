// static/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const modelSelect = document.getElementById('model-select');
    const loadModelBtn = document.getElementById('load-model-btn');
    const applyPostprocessingCb = document.getElementById('apply-postprocessing-cb');
    const modelStatusEl = document.getElementById('model-status');
    const customModelInputs = document.getElementById('custom-model-inputs');
    const customModelPath = document.getElementById('custom-model-path');
    const customConfigPath = document.getElementById('custom-config-path');

    const autoMaskExpandableHeader = document.querySelector('.expandable-section .expandable-header');
    const autoMaskExpandableContent = document.querySelector('.expandable-section .expandable-content');
    const autoMaskBtn = document.getElementById('auto-mask-btn');
    const cancelAutoMaskBtn = document.getElementById('cancel-auto-mask-btn');
    const autoMaskStatusEl = document.getElementById('auto-mask-status');
    const recoverAutoMaskBtn = document.getElementById('recover-auto-mask-btn');

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
        statusMessageEl.className = 'status-message ' + (isError ? 'error' : (message.includes("Loading") || message.includes("Running") ? 'info' : 'success'));
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

    document.addEventListener('canvas-userInteraction', (event) => {
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
    async function fetchAvailableModels() {
        try {
            const response = await fetch('/api/get_available_models');
            const data = await response.json();
            if (data.success) {
                modelSelect.innerHTML = '';
                
                // Add custom model path option at the top
                const customOption = document.createElement('option');
                customOption.value = 'custom';
                customOption.textContent = 'Custom Model Path';
                modelSelect.appendChild(customOption);
                
                // Add separator
                const separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '──────────────';
                modelSelect.appendChild(separator);
                
                // Add predefined models
                data.models.forEach(key => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
                    if (key === data.current_model) {
                        option.selected = true;
                    }
                    modelSelect.appendChild(option);
                });
                
                modelStatusEl.textContent = data.current_model ? `Current: ${data.current_model}` : "Status: No model loaded.";
                
                // Set up change handler for model select
                modelSelect.addEventListener('change', function() {
                    if (this.value === 'custom') {
                        customModelInputs.style.display = 'block';
                    } else {
                        customModelInputs.style.display = 'none';
                    }
                });
                
                // Initialize visibility based on current selection
                if (modelSelect.value === 'custom') {
                    customModelInputs.style.display = 'block';
                }
            } else {
                showStatus('Failed to fetch models: ' + (data.error || "Unknown error"), true);
            }
        } catch (error) {
            showStatus('Error fetching models: ' + error, true);
        }
    }

    async function loadModel() {
        const modelSizeKey = modelSelect.value;
        if (!modelSizeKey) {
            showStatus('Please select a model size.', true);
            return;
        }
        
        const postProcessing = applyPostprocessingCb.checked;
        let payload = {
            apply_postprocessing: postProcessing
        };
        
        // Handle custom model path
        if (modelSizeKey === 'custom') {
            const modelPath = customModelPath.value.trim();
            const configPath = customConfigPath.value.trim();
            
            if (!modelPath) {
                showStatus('Please enter a model path.', true);
                return;
            }
            
            if (!configPath) {
                showStatus('Please enter a config path.', true);
                return;
            }
            
            payload.model_path = modelPath;
            payload.config_path = configPath;
        } else {
            payload.model_size_key = modelSizeKey;
        }

        if (window.canvasManager) {
            window.canvasManager.lockCanvas(`Loading ${modelSizeKey === 'custom' ? 'custom' : modelSizeKey} model...`);
        }
        modelStatusEl.textContent = `Loading ${modelSizeKey === 'custom' ? 'custom model' : modelSizeKey}...`;
        
        try {
            const response = await fetch('/api/load_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            if (data.success) {
                showStatus(data.message);
                const loadedKeyMsg = data.message.match(/'([^']+)'/);
                modelStatusEl.textContent = `Current: ${loadedKeyMsg ? loadedKeyMsg[1] : (modelSizeKey === 'custom' ? 'Custom model' : modelSizeKey)} (PostProc: ${postProcessing})`;
                
                const currentInputs = window.canvasManager?.getCurrentInputs();
                if (currentInputs?.image) {
                    showStatus("Model changed. Re-running prediction...", false, 0);
                    triggerPrediction();
                }
            } else {
                showStatus('Failed to load model: ' + (data.error || "Unknown error"), true);
                const currentModelName = modelSelect.querySelector('option:checked') ? modelSelect.querySelector('option:checked').textContent : "No model";
                modelStatusEl.textContent = `Status: Failed to load. (Was: ${currentModelName})`;
            }
        } catch (error) {
            showStatus('Error loading model: ' + error, true);
            modelStatusEl.textContent = "Status: Load error.";
        } finally {
            if (window.canvasManager) {
                window.canvasManager.unlockCanvas();
            }
        }
    }

    function triggerPrediction() {
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            const currentInputs = window.canvasManager?.getCurrentInputs();
            if (currentInputs?.image && (currentInputs.points.length > 0 || currentInputs.box || currentInputs.maskInput)) {
                runPredictionInternal();
            } else if (currentInputs?.image) {
                window.canvasManager.setPredictedMasks([]);
            }
        }, 300);
    }

    async function runPredictionInternal() {
        const currentInputs = window.canvasManager?.getCurrentInputs();
        if (!currentInputs?.image) return;

        window.canvasManager.lockCanvas("Predicting...");
        window.canvasManager.setAutoMaskComposite(null);

        const payload = {
            points: currentInputs.points.map(p => [p.x, p.y]),
            labels: currentInputs.points.map(p => p.label),
            box: currentInputs.box ? [currentInputs.box.x1, currentInputs.box.y1, currentInputs.box.x2, currentInputs.box.y2] : null,
            mask_input: currentInputs.maskInput,
            multimask_output: true
        };

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errorText = await response.text();
                showStatus(`Prediction failed: ${response.status} ${errorText}`, true);
                window.canvasManager.setPredictedMasks([]);
                return;
            }
            const data = await response.json();
            if (data.success) {
                const allPredictedMasksData = data.masks.map((maskBase64, index) => ({
                    maskBase64: maskBase64,
                    score: data.scores[index] || 0
                }));
                allPredictedMasksData.sort((a, b) => b.score - a.score);
                window.canvasManager.setPredictedMasks(allPredictedMasksData);
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

    async function runAutoMask() {
        const currentInputs = window.canvasManager?.getCurrentInputs();
        if (!currentInputs?.image) {
            showStatus("Please load an image first.", true);
            return;
        }
        
        window.canvasManager.setPredictedMasks([]);
        window.canvasManager.clearAllInputs(false, true);

        const startTime = Date.now();
        autoMaskStatusEl.className = 'status-message info small';
        autoMaskStatusEl.textContent = "Running AutoMask...";
        window.canvasManager.lockCanvas("AutoMask Running... This may take a while.");
        autoMaskBtn.disabled = true;
        cancelAutoMaskBtn.style.display = 'inline-block';

        currentAutoMaskAbortController = new AbortController();
        const signal = currentAutoMaskAbortController.signal;

        const params = {
            points_per_side: parseInt(amgPointsPerSideEl.value) || 32,
            pred_iou_thresh: parseFloat(amgPredIouThreshEl.value) || 0.88,
            stability_score_thresh: parseFloat(amgStabilityScoreThreshEl.value) || 0.95,
        };

        try {
            const response = await fetch('/api/generate_auto_masks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
                signal: signal
            });

            if (signal.aborted) {
                autoMaskStatusEl.className = 'status-message info small';
                autoMaskStatusEl.textContent = "AutoMask cancelled by user.";
                showStatus("AutoMask cancelled.", false);
                return;
            }

            const data = await response.json();
            if (data.success) {
                window.canvasManager.setAutoMaskComposite(data.auto_mask_composite);
                const duration = (Date.now() - startTime) / 1000;
                autoMaskStatusEl.className = 'status-message success small';
                autoMaskStatusEl.textContent = `AutoMask complete in ${duration.toFixed(1)}s. ${data.count} objects (approx).`;
                
                const currentInputs = window.canvasManager.getCurrentInputs();
                if (currentInputs.filename && data.auto_mask_composite) {
                    try {
                        localStorage.setItem(`automask_${currentInputs.filename}`, data.auto_mask_composite);
                        localStorage.setItem(`automask_info_${currentInputs.filename}`, autoMaskStatusEl.textContent);
                    } catch (e) {
                        console.warn("localStorage full or unavailable for automask recovery.", e);
                    }
                }
            } else {
                autoMaskStatusEl.className = 'status-message error small';
                autoMaskStatusEl.textContent = 'AutoMask generation failed: ' + (data.error || "Unknown error");
                showStatus('AutoMask generation failed: ' + (data.error || "Unknown error"), true);
                window.canvasManager.setAutoMaskComposite(null);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                autoMaskStatusEl.className = 'status-message info small';
                autoMaskStatusEl.textContent = "AutoMask cancelled by user.";
                showStatus("AutoMask cancelled.", false);
            } else {
                autoMaskStatusEl.className = 'status-message error small';
                autoMaskStatusEl.textContent = 'Error during AutoMask: ' + error;
                showStatus('Error during automatic mask generation: ' + error, true);
            }
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
        if (currentAutoMaskAbortController) {
            currentAutoMaskAbortController.abort();
        }
    });

    recoverAutoMaskBtn.addEventListener('click', () => {
        const currentInputs = window.canvasManager?.getCurrentInputs();
        if (!currentInputs?.filename) {
            showStatus("No image loaded to recover automask for.", true);
            autoMaskStatusEl.textContent = "No image loaded.";
            autoMaskStatusEl.className = 'status-message error small';
            return;
        }
        try {
            const recoveredComposite = localStorage.getItem(`automask_${currentInputs.filename}`);
            const recoveredInfo = localStorage.getItem(`automask_info_${currentInputs.filename}`);
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

    // --- Event Handlers ---
    loadModelBtn.addEventListener('click', loadModel);
    applyPostprocessingCb.addEventListener('change', loadModel);

    autoMaskExpandableHeader.addEventListener('click', () => {
        const isHidden = autoMaskExpandableContent.style.display === 'none';
        autoMaskExpandableContent.style.display = isHidden ? 'block' : 'none';
        autoMaskExpandableHeader.textContent = isHidden ? 'Automatic Mask Generation ▼' : 'Automatic Mask Generation ▲';
    });

    // --- Initial Setup ---
    fetchAvailableModels();
    
    // Initialize expandable section
    autoMaskExpandableHeader.click();
    autoMaskExpandableHeader.textContent = autoMaskExpandableContent.style.display === 'none' ? 
                                           'Automatic Mask Generation ▼' : 'Automatic Mask Generation ▲';
});
