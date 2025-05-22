// static/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const modelSelect = document.getElementById('model-select');
    const loadModelBtn = document.getElementById('load-model-btn');
    const applyPostprocessingCb = document.getElementById('apply-postprocessing-cb');
    const modelStatusEl = document.getElementById('model-status');
    const imageUpload = document.getElementById('image-upload');
    const imageUploadProgressEl = document.getElementById('image-upload-progress');
    const imageUploadBarEl = document.getElementById('image-upload-bar');
    const customModelInputs = document.getElementById('custom-model-inputs');
    const customModelPath = document.getElementById('custom-model-path');
    const customConfigPath = document.getElementById('custom-config-path');

    const clearInputsBtn = document.getElementById('clear-inputs-btn');

    const maskDisplayModeSelect = document.getElementById('mask-display-mode');
    
    const autoMaskExpandableHeader = document.querySelector('.expandable-section .expandable-header');
    const autoMaskExpandableContent = document.querySelector('.expandable-section .expandable-content');
    const autoMaskBtn = document.getElementById('auto-mask-btn');
    const cancelAutoMaskBtn = document.getElementById('cancel-auto-mask-btn');
    const autoMaskStatusEl = document.getElementById('auto-mask-status');
    const recoverAutoMaskBtn = document.getElementById('recover-auto-mask-btn');

    const amgPointsPerSideEl = document.getElementById('amg-points-per-side');
    const amgPredIouThreshEl = document.getElementById('amg-pred-iou-thresh');
    const amgStabilityScoreThreshEl = document.getElementById('amg-stability-score-thresh');

    const predictionOpacitySlider = document.getElementById('prediction-opacity');
    const userInputOpacitySlider = document.getElementById('user-input-opacity');
    const saveMasksBtn = document.getElementById('save-masks-btn');
    const statusMessageEl = document.getElementById('status-message'); // Main status
    
    const canvasLockEl = document.getElementById('canvas-lock');
    const canvasLockMessageEl = document.querySelector('#canvas-lock .canvas-lock-message');

    const imageCanvas = document.getElementById('image-canvas'); // Base image
    const predictionMaskCanvas = document.getElementById('prediction-mask-canvas'); // SAM predictions
    const userInputCanvas = document.getElementById('user-input-canvas');    // User points, boxes, drawn masks

    const imageCtx = imageCanvas.getContext('2d');
    const predictionCtx = predictionMaskCanvas.getContext('2d');
    const userCtx = userInputCanvas.getContext('2d');

    // --- State Variables ---
    let currentImage = null; // Holds the Image object for the currently loaded image
    let currentImageFilename = null; // For automask recovery key based on filename
    let originalImageWidth = 0;
    let originalImageHeight = 0;
    // displayScale is dynamic, calculated in drawImage based on container size

    let userPoints = []; 
    let userBox = null; 
    
    let userDrawnMasks = []; // Array of {points: [{x,y},...], color: 'rgba(...)', id: uniqueId}
    let currentLassoPoints = []; 
    let isDrawingLasso = false;
    let combinedUserMaskInput256 = null; // Single 256x256 mask from all userDrawnMasks

    let allPredictedMasksData = []; // Stores array of {maskBase64: string, score: float}
    // displayedPredictionMasks is dynamically generated in filterAndDrawPredictionMasks

    let autoMaskComposite = null; // Base64 string of the automask composite image
    let predictionDebounceTimer = null;
    let currentAutoMaskAbortController = null; 

    // Offscreen canvases for smoother opacity changes
    const offscreenPredictionCanvas = document.createElement('canvas');
    const offscreenPredictionCtx = offscreenPredictionCanvas.getContext('2d');
    const offscreenUserCanvas = document.createElement('canvas');
    const offscreenUserCtx = offscreenUserCanvas.getContext('2d');


    // --- Utility Functions ---
    function showStatus(message, isError = false, duration = null) {
        statusMessageEl.textContent = message;
        statusMessageEl.className = 'status-message ' + (isError ? 'error' : (message.includes("Loading") || message.includes("Running") ? 'info' : 'success'));
        if (duration !== 0) { 
            setTimeout(() => {
                if (statusMessageEl.textContent === message) { // Clear only if it's the same message
                     statusMessageEl.textContent = '';
                     statusMessageEl.className = 'status-message';
                }
            }, duration === null ? (isError ? 8000 : 4000) : duration);
        }
    }

    function resizeCanvases(width, height) {
        [imageCanvas, predictionMaskCanvas, userInputCanvas, offscreenPredictionCanvas, offscreenUserCanvas].forEach(canvas => {
            canvas.width = width;
            canvas.height = height;
        });
    }
    
    function displayToOriginalCoords(clientX, clientY) {
        if (!originalImageWidth || !originalImageHeight || userInputCanvas.width === 0 || userInputCanvas.height === 0) {
            console.warn("displayToOriginalCoords called before canvas/image fully initialized.");
            return { x: 0, y: 0 }; 
        }
        const rect = userInputCanvas.getBoundingClientRect(); // Get current size and position
        // Scale mouse coordinates from viewport to canvas element size
        const canvasX = (clientX - rect.left) * (userInputCanvas.width / rect.width);
        const canvasY = (clientY - rect.top) * (userInputCanvas.height / rect.height);
        // Scale from canvas element size to original image size
        return { 
            x: canvasX * (originalImageWidth / userInputCanvas.width), 
            y: canvasY * (originalImageHeight / userInputCanvas.height)
        };
    }

    function originalToDisplayCoords(originalX, originalY) {
         if (!originalImageWidth || !originalImageHeight || userInputCanvas.width === 0 || userInputCanvas.height === 0) {
            console.warn("originalToDisplayCoords called before canvas/image fully initialized.");
            return { x: 0, y: 0 };
        }
        // Scale from original image size to display canvas size
        return { 
            x: originalX * (userInputCanvas.width / originalImageWidth), 
            y: originalY * (userInputCanvas.height / originalImageHeight)
        };
    }
    
    function getRandomHexColor() {
        const r = Math.floor(Math.random() * 180 + 50); // Brighter, less muddy
        const g = Math.floor(Math.random() * 180 + 50);
        const b = Math.floor(Math.random() * 180 + 50);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    function lockCanvas(message = "Processing... Please Wait.") {
        canvasLockMessageEl.textContent = message;
        canvasLockEl.style.display = 'flex';
    }

    function unlockCanvas() {
        canvasLockEl.style.display = 'none';
    }


    // --- Drawing Functions ---
    function drawImage() { 
        if (!currentImage) return;
        
        const displayArea = document.querySelector('.image-display-area');
        const areaWidth = displayArea.clientWidth > 0 ? displayArea.clientWidth : 600; 
        const areaHeight = displayArea.clientHeight > 0 ? displayArea.clientHeight : 400;

        const maxWidth = areaWidth * 0.98; // Keep some padding
        const maxHeight = areaHeight * 0.98;

        const hRatio = maxWidth / originalImageWidth;
        const vRatio = maxHeight / originalImageHeight;
        const currentDisplayScale = Math.min(hRatio, vRatio, 1.0); // Don't scale up beyond original size

        const displayWidth = Math.round(originalImageWidth * currentDisplayScale);
        const displayHeight = Math.round(originalImageHeight * currentDisplayScale);

        resizeCanvases(displayWidth, displayHeight); // Resize all, including offscreen
        imageCtx.clearRect(0, 0, displayWidth, displayHeight);
        imageCtx.drawImage(currentImage, 0, 0, displayWidth, displayHeight);

        drawUserInput(); 
        filterAndDrawPredictionMasks(); 
    }

    function drawUserInput() { 
        if (!currentImage || offscreenUserCanvas.width === 0 || offscreenUserCanvas.height === 0) return;
        offscreenUserCtx.clearRect(0, 0, offscreenUserCanvas.width, offscreenUserCanvas.height);
        // Draw on offscreenUserCtx first

        const pointDisplayRadius = 5;
        const lineDisplayWidth = 2;

        userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            offscreenUserCtx.beginPath();
            const firstP_disp = originalToDisplayCoords(mask.points[0].x, mask.points[0].y);
            offscreenUserCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < mask.points.length; i++) {
                const p_disp = originalToDisplayCoords(mask.points[i].x, mask.points[i].y);
                offscreenUserCtx.lineTo(p_disp.x, p_disp.y);
            }
            offscreenUserCtx.closePath();
            offscreenUserCtx.fillStyle = mask.color || 'rgba(255, 255, 0, 0.4)'; // Slightly more alpha
            offscreenUserCtx.fill();
            offscreenUserCtx.strokeStyle = 'rgba(0,0,0,0.6)'; // Darker outline for lassos
            offscreenUserCtx.lineWidth = 1; // Thinner outline for lassos
            offscreenUserCtx.stroke();
        });
        
        if (isDrawingLasso && currentLassoPoints.length > 0) {
            offscreenUserCtx.beginPath();
            const firstP_disp = originalToDisplayCoords(currentLassoPoints[0].x, currentLassoPoints[0].y);
            offscreenUserCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < currentLassoPoints.length; i++) {
                const p_disp = originalToDisplayCoords(currentLassoPoints[i].x, currentLassoPoints[i].y);
                offscreenUserCtx.lineTo(p_disp.x, p_disp.y);
            }
            if (currentLassoPoints.length > 1) { 
                 offscreenUserCtx.lineTo(firstP_disp.x, firstP_disp.y);
            }
            offscreenUserCtx.strokeStyle = 'rgba(255, 223, 0, 0.9)'; // Brighter yellow for active lasso
            offscreenUserCtx.lineWidth = lineDisplayWidth;
            offscreenUserCtx.stroke();
        }

         userPoints.forEach(p_orig => {
            const dp = originalToDisplayCoords(p_orig.x, p_orig.y);
            offscreenUserCtx.beginPath();
            offscreenUserCtx.arc(dp.x, dp.y, pointDisplayRadius, 0, 2 * Math.PI);
            offscreenUserCtx.fillStyle = p_orig.label === 1 ? 'rgba(0,200,0,0.8)' : 'rgba(200,0,0,0.8)'; // Slightly less aggressive colors
            offscreenUserCtx.fill();
            offscreenUserCtx.strokeStyle = 'rgba(255,255,255,0.9)'; // Brighter white outline
            offscreenUserCtx.lineWidth = lineDisplayWidth * 0.75; // Thinner outline for points
            offscreenUserCtx.stroke();
        });

        if (userBox) {
            const db1 = originalToDisplayCoords(userBox.x1, userBox.y1);
            const db2 = originalToDisplayCoords(userBox.x2, userBox.y2);
            offscreenUserCtx.strokeStyle = 'rgba(0,100,255,0.8)'; // Brighter blue
            offscreenUserCtx.lineWidth = lineDisplayWidth; 
            offscreenUserCtx.strokeRect(db1.x, db1.y, db2.x - db1.x, db2.y - db1.y);
        }

        // Now copy from offscreen to visible with opacity
        userCtx.clearRect(0,0, userInputCanvas.width, userInputCanvas.height);
        userCtx.globalAlpha = parseFloat(userInputOpacitySlider.value);
        userCtx.drawImage(offscreenUserCanvas, 0, 0);
        userCtx.globalAlpha = 1.0; // Reset
    }

    function filterAndDrawPredictionMasks() {
        if (!currentImage || offscreenPredictionCanvas.width === 0 || offscreenPredictionCanvas.height === 0) return;
        offscreenPredictionCtx.clearRect(0, 0, offscreenPredictionCanvas.width, offscreenPredictionCanvas.height);
        // Draw on offscreenPredictionCtx first

        let masksToDrawBase64 = [];

        if (autoMaskComposite) {
            masksToDrawBase64.push(autoMaskComposite); // Treat automask as a single layer for now
        } else if (allPredictedMasksData.length > 0) {
            const mode = maskDisplayModeSelect.value;
            if (mode === 'best' && allPredictedMasksData[0]) { // allPredictedMasksData is sorted by score
                masksToDrawBase64.push(allPredictedMasksData[0].maskBase64);
            } else if (mode === 'all') {
                masksToDrawBase64 = allPredictedMasksData.map(m => m.maskBase64);
            }
        }
        
        if (masksToDrawBase64.length > 0) {
            // Draw all selected masks onto the offscreen canvas
            // This assumes mask_to_base64_png bakes in the color and its own alpha (0.6 * 255)
            let imagesLoaded = 0;
            masksToDrawBase64.forEach(maskBase64 => {
                const img = new Image();
                img.onload = () => {
                    offscreenPredictionCtx.drawImage(img, 0, 0, offscreenPredictionCanvas.width, offscreenPredictionCanvas.height);
                    imagesLoaded++;
                    if (imagesLoaded === masksToDrawBase64.length) {
                        // All images drawn to offscreen, now copy to visible with slider opacity
                        predictionCtx.clearRect(0,0, predictionMaskCanvas.width, predictionMaskCanvas.height);
                        predictionCtx.globalAlpha = parseFloat(predictionOpacitySlider.value);
                        predictionCtx.drawImage(offscreenPredictionCanvas, 0, 0);
                        predictionCtx.globalAlpha = 1.0; // Reset
                    }
                };
                img.onerror = () => {
                    imagesLoaded++; // Count error as loaded to not block redraw
                     if (imagesLoaded === masksToDrawBase64.length) {
                        predictionCtx.clearRect(0,0, predictionMaskCanvas.width, predictionMaskCanvas.height);
                        predictionCtx.globalAlpha = parseFloat(predictionOpacitySlider.value);
                        predictionCtx.drawImage(offscreenPredictionCanvas, 0, 0);
                        predictionCtx.globalAlpha = 1.0;
                    }
                    console.error("Error loading a prediction mask image from base64");
                };
                img.src = maskBase64;
            });
        } else {
            // No masks to draw, just clear the visible canvas
            predictionCtx.clearRect(0,0, predictionMaskCanvas.width, predictionMaskCanvas.height);
        }
    }
    maskDisplayModeSelect.addEventListener('change', filterAndDrawPredictionMasks);
    predictionOpacitySlider.addEventListener('input', filterAndDrawPredictionMasks);
    userInputOpacitySlider.addEventListener('input', drawUserInput);


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

        lockCanvas(`Loading ${modelSizeKey === 'custom' ? 'custom' : modelSizeKey} model...`);
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
                const loadedKeyMsg = data.message.match(/'([^']+)'/); // Extract model name from message
                modelStatusEl.textContent = `Current: ${loadedKeyMsg ? loadedKeyMsg[1] : (modelSizeKey === 'custom' ? 'Custom model' : modelSizeKey)} (PostProc: ${postProcessing})`; 
                if (currentImage) { 
                    showStatus("Model changed. Re-running prediction...", false, 0); // Keep status until prediction done
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
            unlockCanvas();
        }
    }

    async function uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);
        
        currentImageFilename = file.name; 

        imageUploadProgressEl.style.display = 'block';
        imageUploadBarEl.style.width = '0%';
        imageUploadBarEl.textContent = '0%';
        lockCanvas("Uploading image...");

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload_image', true);

            xhr.upload.onprogress = function(event) {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    imageUploadBarEl.style.width = percentComplete + '%';
                    imageUploadBarEl.textContent = percentComplete + '%';
                }
            };

            xhr.onload = async function() {
                unlockCanvas();
                imageUploadProgressEl.style.display = 'none'; // Hide after completion or error
                if (xhr.status === 200) {
                    const data = JSON.parse(xhr.responseText);
                    if (data.success) {
                        // Clear all inputs and predictions before loading the new image
                        clearAllInputs(false, true);  // Clear inputs & preds, keep image (which will be replaced anyway)
                        
                        currentImage = new Image();
                        currentImage.onload = () => {
                            originalImageWidth = data.width; 
                            originalImageHeight = data.height;
                            drawImage(); 
                            showStatus('Image loaded. Ready for interaction.');
                        };
                        currentImage.onerror = () => {
                            showStatus('Failed to load image data from server response.', true);
                        }
                        currentImage.src = data.image_data; // data.image_data is base64 string
                        currentImageFilename = data.filename || file.name; // Use filename from server if provided
                    } else {
                        showStatus('Failed to upload image: ' + (data.error || "Unknown server error"), true);
                    }
                } else {
                    showStatus(`Image upload failed: ${xhr.status} ${xhr.statusText || "Server error"}`, true);
                }
            };
            xhr.onerror = function() {
                unlockCanvas();
                imageUploadProgressEl.style.display = 'none';
                showStatus('Image upload error (network connection or server unavailable).', true);
            };
            xhr.send(formData);
        } catch (error) { 
            unlockCanvas();
            imageUploadProgressEl.style.display = 'none';
            showStatus('Error setting up image upload: ' + error, true);
        }
    }
    
    function triggerPrediction() {
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            if (currentImage && (userPoints.length > 0 || userBox || combinedUserMaskInput256)) {
                runPredictionInternal();
            } else if (currentImage) { 
                allPredictedMasksData = []; 
                filterAndDrawPredictionMasks(); 
            }
        }, 300); 
    }

    async function runPredictionInternal() {
        if (!currentImage) return;

        lockCanvas("Predicting..."); 
        if (autoMaskComposite) autoMaskComposite = null; 

        const payload = {
            points: userPoints.map(p => [p.x, p.y]),
            labels: userPoints.map(p => p.label),
            box: userBox ? [userBox.x1, userBox.y1, userBox.x2, userBox.y2] : null,
            mask_input: combinedUserMaskInput256, 
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
                allPredictedMasksData = []; filterAndDrawPredictionMasks(); return;
            }
            const data = await response.json();
            if (data.success) {
                allPredictedMasksData = data.masks.map((maskBase64, index) => ({
                    maskBase64: maskBase64,
                    score: data.scores[index] || 0 
                }));
                allPredictedMasksData.sort((a,b) => b.score - a.score); 
                filterAndDrawPredictionMasks();
                // showStatus for prediction success can be too noisy with live updates
            } else {
                showStatus('Prediction API error: ' + (data.error || "Unknown error"), true);
                allPredictedMasksData = [];
                filterAndDrawPredictionMasks();
            }
        } catch (error) {
            showStatus('Network error during prediction: ' + error, true);
            allPredictedMasksData = [];
            filterAndDrawPredictionMasks();
        } finally {
            unlockCanvas();
        }
    }

    async function runAutoMask() {
        if (!currentImage) {
            showStatus("Please load an image first.", true);
            return;
        }
        
        allPredictedMasksData = []; 
        userPoints = []; userBox = null; combinedUserMaskInput256 = null; userDrawnMasks = [];
        drawUserInput(); 
        filterAndDrawPredictionMasks(); 

        const startTime = Date.now();
        autoMaskStatusEl.className = 'status-message info small'; // Use info class
        autoMaskStatusEl.textContent = "Running AutoMask...";
        lockCanvas("AutoMask Running... This may take a while.");
        autoMaskBtn.disabled = true; // Disable run button
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
                autoMaskComposite = data.auto_mask_composite;
                filterAndDrawPredictionMasks(); 
                const duration = (Date.now() - startTime) / 1000;
                autoMaskStatusEl.className = 'status-message success small';
                autoMaskStatusEl.textContent = `AutoMask complete in ${duration.toFixed(1)}s. ${data.count} objects (approx).`;
                if (currentImageFilename && autoMaskComposite) {
                    try {
                        localStorage.setItem(`automask_${currentImageFilename}`, autoMaskComposite);
                        localStorage.setItem(`automask_info_${currentImageFilename}`, autoMaskStatusEl.textContent);
                    } catch (e) { console.warn("localStorage full or unavailable for automask recovery.", e); }
                }
            } else {
                autoMaskStatusEl.className = 'status-message error small';
                autoMaskStatusEl.textContent = 'AutoMask generation failed: ' + (data.error || "Unknown error");
                showStatus('AutoMask generation failed: ' + (data.error || "Unknown error"), true);
                autoMaskComposite = null;
                filterAndDrawPredictionMasks();
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
            autoMaskComposite = null;
            filterAndDrawPredictionMasks();
        } finally {
            unlockCanvas();
            autoMaskBtn.disabled = false; // Re-enable run button
            cancelAutoMaskBtn.style.display = 'none';
            currentAutoMaskAbortController = null;
        }
    }
    autoMaskBtn.addEventListener('click', runAutoMask);
    cancelAutoMaskBtn.addEventListener('click', () => {
        if (currentAutoMaskAbortController) {
            currentAutoMaskAbortController.abort();
            // Status update will happen in the runAutoMask's catch/finally
        }
    });

    recoverAutoMaskBtn.addEventListener('click', () => {
        if (!currentImageFilename) {
            showStatus("No image loaded to recover automask for.", true);
            autoMaskStatusEl.textContent = "No image loaded.";
            autoMaskStatusEl.className = 'status-message error small';
            return;
        }
        try {
            const recoveredComposite = localStorage.getItem(`automask_${currentImageFilename}`);
            const recoveredInfo = localStorage.getItem(`automask_info_${currentImageFilename}`);
            if (recoveredComposite) {
                autoMaskComposite = recoveredComposite;
                allPredictedMasksData = []; // Clear interactive predictions when showing automask
                filterAndDrawPredictionMasks();
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


    // --- Event Handlers ---
    loadModelBtn.addEventListener('click', loadModel);
    applyPostprocessingCb.addEventListener('change', loadModel); 

    imageUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            uploadImage(file);
        }
    });

    clearInputsBtn.addEventListener('click', () => clearAllInputs(false, true)); // Clear inputs & preds, not image

    autoMaskExpandableHeader.addEventListener('click', () => {
        const isHidden = autoMaskExpandableContent.style.display === 'none';
        autoMaskExpandableContent.style.display = isHidden ? 'block' : 'none';
        autoMaskExpandableHeader.textContent = isHidden ? 'Automatic Mask Generation ▼' : 'Automatic Mask Generation ▲';
    });
    
    function clearAllInputs(clearImage = false, clearPredictionsAndInputs = true) {
        // Parameter clearImage: if true, also clears the loaded image.
        // Parameter clearPredictionsAndInputs: if true, clears points, boxes, drawn masks, and SAM predictions.
        
        if (clearPredictionsAndInputs) {
            userPoints = [];
            userBox = null;
            userDrawnMasks = [];
            currentLassoPoints = [];
            isDrawingLasso = false;
            combinedUserMaskInput256 = null;
            allPredictedMasksData = [];
            autoMaskComposite = null; 
            autoMaskStatusEl.textContent = ""; 
            drawUserInput(); 
            filterAndDrawPredictionMasks(); 
        }
        
        if (clearImage) {
             currentImage = null;
             currentImageFilename = null;
             originalImageWidth = 0;
             originalImageHeight = 0;
             [imageCanvas, predictionMaskCanvas, userInputCanvas, offscreenPredictionCanvas, offscreenUserCanvas].forEach(canvas => {
                canvas.width = 300; canvas.height = 150; 
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0,0,canvas.width, canvas.height);
             });
             imageUpload.value = '';
             imageUploadProgressEl.style.display = 'none';
        }
        if (clearPredictionsAndInputs) showStatus('Inputs and predictions cleared.');
        else if (clearImage) showStatus('Image, inputs and predictions cleared.');
    }
    
    let interactionState = { 
        isDrawingBox: false,
        isMouseDown: false, 
        startX_orig: 0,
        startY_orig: 0,
        didMove: false // To distinguish click from drag
    };

    userInputCanvas.addEventListener('mousedown', (e) => { 
        if (!currentImage || canvasLockEl.style.display !== 'none') return; 
        interactionState.isMouseDown = true;
        interactionState.didMove = false; // Reset didMove on new mousedown
        const origCoords = displayToOriginalCoords(e.clientX, e.clientY);
        interactionState.startX_orig = origCoords.x;
        interactionState.startY_orig = origCoords.y;

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;

        if (isCtrl) { 
            // Lasso drawing starts on mousedown+move. Click to remove is on mouseup.
            isDrawingLasso = true; // Tentatively start lasso
            currentLassoPoints = [origCoords];
        } else if (isShift) {
            // Box drawing starts on mousedown+move. Click to remove is on mouseup.
            interactionState.isDrawingBox = true; // Tentatively start box
            userBox = null; 
        }
        e.preventDefault();
    });

    userInputCanvas.addEventListener('mousemove', (e) => { 
        if (!currentImage || !interactionState.isMouseDown || canvasLockEl.style.display !== 'none') return;
        interactionState.didMove = true; // Mouse has moved since mousedown
        
        const currentCoords_orig = displayToOriginalCoords(e.clientX, e.clientY);

        if (interactionState.isDrawingBox) { // This implies Shift is held
            userBox = { 
                x1: Math.min(interactionState.startX_orig, currentCoords_orig.x),
                y1: Math.min(interactionState.startY_orig, currentCoords_orig.y),
                x2: Math.max(interactionState.startX_orig, currentCoords_orig.x),
                y2: Math.max(interactionState.startY_orig, currentCoords_orig.y),
            };
            drawUserInput(); 
        } else if (isDrawingLasso) { // This implies Ctrl is held
            currentLassoPoints.push(currentCoords_orig);
            drawUserInput(); 
        }
    });

    userInputCanvas.addEventListener('mouseup', (e) => { 
        if (!currentImage || !interactionState.isMouseDown || canvasLockEl.style.display !== 'none') return; 
        
        const coords_orig = displayToOriginalCoords(e.clientX, e.clientY);
        const pointDisplayRadius = 5; 
        const clickThresholdOrig = (userInputCanvas.width > 0 && originalImageWidth > 0) ? 
                                   (pointDisplayRadius * (originalImageWidth / userInputCanvas.width)) : 
                                   pointDisplayRadius;

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;
        let interactionHandledOnUp = false;

        if (interactionState.isDrawingBox) { // Was drawing a box (Shift was held during drag)
            if (userBox && (userBox.x2 - userBox.x1 < clickThresholdOrig || userBox.y2 - userBox.y1 < clickThresholdOrig)) {
                userBox = null; 
            }
            interactionHandledOnUp = true;
        } else if (isDrawingLasso) { // Was drawing a lasso (Ctrl was held during drag)
            if (currentLassoPoints.length > 2) { 
                userDrawnMasks.push({ 
                    points: [...currentLassoPoints], 
                    color: `${getRandomHexColor()}99`, 
                    id: Date.now() 
                });
                prepareCombinedUserMaskInput();
            }
            interactionHandledOnUp = true;
        }
        
        // If mouse didn't move much (it's a click) and not finishing a drag operation
        if (!interactionState.didMove || (!interactionHandledOnUp && !isDrawingLasso && !interactionState.isDrawingBox) ) {
            if (isCtrl) { // Ctrl + Click (no drag) -> try remove lasso
                let removedMask = false;
                for (let i = userDrawnMasks.length - 1; i >= 0; i--) {
                    if (isPointInPolygon(coords_orig, userDrawnMasks[i].points)) {
                        userDrawnMasks.splice(i, 1);
                        removedMask = true;
                        break;
                    }
                }
                if (removedMask) prepareCombinedUserMaskInput();
                interactionHandledOnUp = true; // This was a ctrl-click action
            } else if (isShift) { // Shift + Click (no drag) -> try remove box
                if (userBox && 
                    coords_orig.x >= userBox.x1 && coords_orig.x <= userBox.x2 &&
                    coords_orig.y >= userBox.y1 && coords_orig.y <= userBox.y2) {
                    userBox = null; 
                    interactionHandledOnUp = true; // This was a shift-click action
                }
            } else { // Normal click (no modifier or modifier + click without drag) -> Point
                const label = e.button === 0 ? 1 : 0; 
                let removedPoint = false;
                for (let i = userPoints.length - 1; i >= 0; i--) {
                    const p_orig = userPoints[i];
                    const dist = Math.sqrt(Math.pow(p_orig.x - coords_orig.x, 2) + Math.pow(p_orig.y - coords_orig.y, 2));
                    if (dist < clickThresholdOrig) {
                        userPoints.splice(i, 1);
                        removedPoint = true;
                        break;
                    }
                }
                if (!removedPoint) {
                    userPoints.push({ x: coords_orig.x, y: coords_orig.y, label: label });
                }
                interactionHandledOnUp = true;
            }
        }
        
        // Reset drawing states
        isDrawingLasso = false; 
        currentLassoPoints = [];
        interactionState.isDrawingBox = false;
        interactionState.isMouseDown = false; 
        interactionState.didMove = false;

        drawUserInput();
        triggerPrediction(); 
    });

    userInputCanvas.addEventListener('mouseleave', (e) => { 
        if(interactionState.isMouseDown && canvasLockEl.style.display === 'none') { 
            const clickThresholdOrig = (userInputCanvas.width > 0 && originalImageWidth > 0) ? 
                               (10 * (originalImageWidth / userInputCanvas.width)) : 10;
            if (interactionState.isDrawingBox) {
                 if (userBox && (userBox.x2 - userBox.x1 < clickThresholdOrig || userBox.y2 - userBox.y1 < clickThresholdOrig)) {
                    userBox = null;
                }
            } else if (isDrawingLasso) {
                if (currentLassoPoints.length > 2) {
                    userDrawnMasks.push({ points: [...currentLassoPoints], color: `${getRandomHexColor()}99`, id: Date.now() });
                    prepareCombinedUserMaskInput();
                }
            }
            // Reset all drawing states as mouse left while potentially drawing
            isDrawingLasso = false; 
            currentLassoPoints = [];
            interactionState.isDrawingBox = false;
            interactionState.isMouseDown = false;
            interactionState.didMove = false;

            drawUserInput();
            triggerPrediction();
        }
    });
    userInputCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function isPointInPolygon(point, polygonPoints) {
        if (!polygonPoints || polygonPoints.length < 3) return false;
        let x = point.x, y = point.y;
        let inside = false;
        for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
            let xi = polygonPoints[i].x, yi = polygonPoints[i].y;
            let xj = polygonPoints[j].x, yj = polygonPoints[j].y;
            let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function prepareCombinedUserMaskInput() {
        if (userDrawnMasks.length === 0 || !originalImageWidth || !originalImageHeight) {
            combinedUserMaskInput256 = null;
            return;
        }

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        const MASK_DIM = 256;
        tempCanvas.width = MASK_DIM;
        tempCanvas.height = MASK_DIM;

        tempCtx.fillStyle = 'black'; 
        tempCtx.fillRect(0, 0, MASK_DIM, MASK_DIM);
        tempCtx.fillStyle = 'white'; 

        userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            tempCtx.beginPath();
            const firstP_orig = mask.points[0];
            tempCtx.moveTo(
                (firstP_orig.x / originalImageWidth) * MASK_DIM, 
                (firstP_orig.y / originalImageHeight) * MASK_DIM
            );
            for (let i = 1; i < mask.points.length; i++) {
                const p_orig = mask.points[i];
                tempCtx.lineTo(
                    (p_orig.x / originalImageWidth) * MASK_DIM, 
                    (p_orig.y / originalImageHeight) * MASK_DIM
                );
            }
            tempCtx.closePath();
            tempCtx.fill(); 
        });

        const imageData = tempCtx.getImageData(0, 0, MASK_DIM, MASK_DIM);
        const data = imageData.data;
        combinedUserMaskInput256 = []; 
        for (let r = 0; r < MASK_DIM; r++) {
            const row = [];
            for (let c = 0; c < MASK_DIM; c++) {
                const idx = (r * MASK_DIM + c) * 4;
                row.push(data[idx] > 128 ? 1.0 : 0.0); 
            }
            combinedUserMaskInput256.push(row);
        }
    }
    
    saveMasksBtn.addEventListener('click', () => {
        if (!currentImage) {
            showStatus("No image or prediction to save.", true);
            return;
        }
        const compositeCanvas = document.createElement('canvas');
        // Ensure composite canvas has valid dimensions from the displayed image canvas
        if (imageCanvas.width === 0 || imageCanvas.height === 0) {
            showStatus("Cannot save, image canvas not ready.", true);
            return;
        }
        compositeCanvas.width = imageCanvas.width;
        compositeCanvas.height = imageCanvas.height;
        const compositeCtx = compositeCanvas.getContext('2d');

        // 1. Draw base image
        compositeCtx.drawImage(imageCanvas, 0, 0);
        
        // 2. Draw predictions (from its offscreen buffer, with its slider opacity)
        // We need to re-apply opacity here as offscreen doesn't store it.
        if (offscreenPredictionCanvas.width > 0 && offscreenPredictionCanvas.height > 0) {
            compositeCtx.globalAlpha = parseFloat(predictionOpacitySlider.value);
            compositeCtx.drawImage(offscreenPredictionCanvas, 0, 0);
            compositeCtx.globalAlpha = 1.0; // Reset
        }
        
        // 3. Draw user inputs (from its offscreen buffer, with its slider opacity)
        if (offscreenUserCanvas.width > 0 && offscreenUserCanvas.height > 0) {
            compositeCtx.globalAlpha = parseFloat(userInputOpacitySlider.value);
            compositeCtx.drawImage(offscreenUserCanvas, 0, 0);
            compositeCtx.globalAlpha = 1.0; // Reset
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

    // --- Initial Setup ---
    fetchAvailableModels();
    predictionOpacitySlider.dispatchEvent(new Event('input'));
    userInputOpacitySlider.dispatchEvent(new Event('input'));
    window.addEventListener('resize', drawImage); // Redraw on window resize

    // Initialize expandable section
    autoMaskExpandableHeader.click(); // Open by default, or keep closed
    autoMaskExpandableHeader.textContent = autoMaskExpandableContent.style.display === 'none' ? 
                                           'Automatic Mask Generation ▼' : 'Automatic Mask Generation ▲';


}); // End DOMContentLoaded