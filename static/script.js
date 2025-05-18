// static/script.js

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const modelSelect = document.getElementById('model-select');
    const loadModelBtn = document.getElementById('load-model-btn');
    const modelStatusEl = document.getElementById('model-status');
    const imageUpload = document.getElementById('image-upload');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const runPredictBtn = document.getElementById('run-predict-btn');
    const autoMaskBtn = document.getElementById('auto-mask-btn');
    const predictionOpacitySlider = document.getElementById('prediction-opacity');
    const userInputOpacitySlider = document.getElementById('user-input-opacity');
    const saveMasksBtn = document.getElementById('save-masks-btn');
    const statusMessageEl = document.getElementById('status-message');
    const forceDownloadCb = document.getElementById('force-download-cb'); 
    const amgPointsPerSideEl = document.getElementById('amg-points-per-side');
    const amgPredIouThreshEl = document.getElementById('amg-pred-iou-thresh');
    const amgStabilityScoreThreshEl = document.getElementById('amg-stability-score-thresh');

    const imageCanvas = document.getElementById('image-canvas');
    const predictionMaskCanvas = document.getElementById('prediction-mask-canvas');
    const userInputCanvas = document.getElementById('user-input-canvas');

    const imageCtx = imageCanvas.getContext('2d');
    const predictionCtx = predictionMaskCanvas.getContext('2d');
    const userCtx = userInputCanvas.getContext('2d');

    // --- State Variables ---
    let currentImage = null;
    let originalImageWidth = 0;
    let originalImageHeight = 0;

    let userPoints = []; 
    let userBox = null; 
    
    let userDrawnMasks = []; 
    let currentLassoPoints = []; 
    let isDrawingLasso = false;
    let combinedUserMaskInput256 = null;

    let predictedMasks = []; 
    let autoMaskComposite = null;
    let predictionDebounceTimer = null;


    // --- Utility Functions ---
    function showStatus(message, isError = false) {
        statusMessageEl.textContent = message;
        statusMessageEl.className = 'status-message ' + (isError ? 'error' : 'success');
        setTimeout(() => {
            if (statusMessageEl.textContent === message) {
                 statusMessageEl.textContent = '';
                 statusMessageEl.className = 'status-message';
            }
        }, isError ? 8000 : 4000);
    }

    function resizeCanvases(width, height) {
        [imageCanvas, predictionMaskCanvas, userInputCanvas].forEach(canvas => {
            canvas.width = width;
            canvas.height = height;
        });
    }
    
    function displayToOriginalCoords(clientX, clientY) {
        if (!originalImageWidth || !originalImageHeight || userInputCanvas.width === 0 || userInputCanvas.height === 0) {
            return { x: clientX, y: clientY }; 
        }
        const rect = userInputCanvas.getBoundingClientRect();
        const x = (clientX - rect.left) * (userInputCanvas.width / rect.width);
        const y = (clientY - rect.top) * (userInputCanvas.height / rect.height);
        return { 
            x: x * (originalImageWidth / userInputCanvas.width), 
            y: y * (originalImageHeight / userInputCanvas.height)
        };
    }

    function originalToDisplayCoords(originalX, originalY) {
         if (!originalImageWidth || !originalImageHeight || userInputCanvas.width === 0 || userInputCanvas.height === 0) {
            return { x: originalX, y: originalY };
        }
        return { 
            x: originalX * (userInputCanvas.width / originalImageWidth), 
            y: originalY * (userInputCanvas.height / originalImageHeight)
        };
    }

    function getRandomHexColor() {
        const r = Math.floor(Math.random() * 200 + 55); 
        const g = Math.floor(Math.random() * 200 + 55);
        const b = Math.floor(Math.random() * 200 + 55);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    // --- Drawing Functions ---
    function drawImage() {
        if (!currentImage) return;
        
        const displayArea = document.querySelector('.image-display-area');
        const areaWidth = displayArea.clientWidth > 0 ? displayArea.clientWidth : 600;
        const areaHeight = displayArea.clientHeight > 0 ? displayArea.clientHeight : 400;

        const maxWidth = areaWidth * 0.98; 
        const maxHeight = areaHeight * 0.98;

        const hRatio = maxWidth / originalImageWidth;
        const vRatio = maxHeight / originalImageHeight;
        const currentDisplayScale = Math.min(hRatio, vRatio, 1.0); 

        const displayWidth = originalImageWidth * currentDisplayScale;
        const displayHeight = originalImageHeight * currentDisplayScale;

        resizeCanvases(displayWidth, displayHeight);
        imageCtx.clearRect(0, 0, displayWidth, displayHeight);
        imageCtx.drawImage(currentImage, 0, 0, displayWidth, displayHeight);

        drawUserInput();
        drawPredictionMasks();
    }

    function drawUserInput() {
        if (!currentImage || userInputCanvas.width === 0 || userInputCanvas.height === 0) return;
        userCtx.clearRect(0, 0, userInputCanvas.width, userInputCanvas.height);
        userCtx.globalAlpha = parseFloat(userInputOpacitySlider.value);

        const pointDisplayRadius = 5;
        const lineDisplayWidth = 2;

        userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            userCtx.beginPath();
            const firstP_disp = originalToDisplayCoords(mask.points[0].x, mask.points[0].y);
            userCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < mask.points.length; i++) {
                const p_disp = originalToDisplayCoords(mask.points[i].x, mask.points[i].y);
                userCtx.lineTo(p_disp.x, p_disp.y);
            }
            userCtx.closePath();
            userCtx.fillStyle = mask.color || 'rgba(255, 255, 0, 0.3)'; 
            userCtx.fill();
            userCtx.strokeStyle = 'rgba(0,0,0,0.7)';
            userCtx.lineWidth = lineDisplayWidth / 2;
            userCtx.stroke();
        });
        
        if (isDrawingLasso && currentLassoPoints.length > 0) {
            userCtx.beginPath();
            const firstP_disp = originalToDisplayCoords(currentLassoPoints[0].x, currentLassoPoints[0].y);
            userCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < currentLassoPoints.length; i++) {
                const p_disp = originalToDisplayCoords(currentLassoPoints[i].x, currentLassoPoints[i].y);
                userCtx.lineTo(p_disp.x, p_disp.y);
            }
            if (currentLassoPoints.length > 1) {
                 userCtx.lineTo(firstP_disp.x, firstP_disp.y);
            }
            userCtx.strokeStyle = 'yellow';
            userCtx.lineWidth = lineDisplayWidth;
            userCtx.stroke();
        }

         userPoints.forEach(p_orig => {
            const dp = originalToDisplayCoords(p_orig.x, p_orig.y);
            userCtx.beginPath();
            userCtx.arc(dp.x, dp.y, pointDisplayRadius, 0, 2 * Math.PI);
            userCtx.fillStyle = p_orig.label === 1 ? 'rgba(0,255,0,0.7)' : 'rgba(255,0,0,0.7)';
            userCtx.fill();
            userCtx.strokeStyle = 'white';
            userCtx.lineWidth = lineDisplayWidth;
            userCtx.stroke();
        });

        if (userBox) {
            const db1 = originalToDisplayCoords(userBox.x1, userBox.y1);
            const db2 = originalToDisplayCoords(userBox.x2, userBox.y2);
            userCtx.strokeStyle = 'rgba(0,0,255,0.7)';
            userCtx.lineWidth = lineDisplayWidth;
            userCtx.strokeRect(db1.x, db1.y, db2.x - db1.x, db2.y - db1.y);
        }
    }

    function drawPredictionMasks() {
        if (!currentImage || predictionMaskCanvas.width === 0 || predictionMaskCanvas.height === 0) return;
        predictionCtx.clearRect(0, 0, predictionMaskCanvas.width, predictionMaskCanvas.height);
        predictionCtx.globalAlpha = parseFloat(predictionOpacitySlider.value);

        const targetCanvas = predictionMaskCanvas; 

        if (autoMaskComposite) {
            const img = new Image();
            img.onload = () => {
                predictionCtx.drawImage(img, 0, 0, targetCanvas.width, targetCanvas.height);
            };
            img.src = autoMaskComposite;
        } else if (predictedMasks.length > 0) {
            predictedMasks.forEach(maskBase64 => {
                const img = new Image();
                img.onload = () => {
                    predictionCtx.drawImage(img, 0, 0, targetCanvas.width, targetCanvas.height);
                };
                img.src = maskBase64;
            });
        }
    }
    
    // --- API Calls & Prediction Logic ---
    async function fetchAvailableModels() {
        try {
            const response = await fetch('/api/get_available_models');
            const data = await response.json();
            if (data.success) {
                modelSelect.innerHTML = '';
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
            } else {
                showStatus('Failed to fetch models: ' + data.error, true);
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
        const forceDL = forceDownloadCb ? forceDownloadCb.checked : false; 

        modelStatusEl.textContent = `Loading ${modelSizeKey}${forceDL ? ' (forcing download)' : ''}...`;
        try {
            const response = await fetch('/api/load_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    model_size_key: modelSizeKey, 
                    force_download: forceDL 
                }),
            });
            const data = await response.json();
            if (data.success) {
                showStatus(data.message);
                modelStatusEl.textContent = `Current: ${modelSizeKey}`;
                if (currentImage) { 
                    showStatus("Model changed. Re-running prediction with current inputs...", false);
                    triggerPrediction(); 
                }
            } else {
                showStatus('Failed to load model: ' + data.error, true);
                modelStatusEl.textContent = "Status: Load failed.";
            }
        } catch (error) {
            showStatus('Error loading model: ' + error, true);
            modelStatusEl.textContent = "Status: Load error.";
        }
    }

    async function uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);
        showStatus('Uploading and processing image...');
        try {
            const response = await fetch('/api/upload_image', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();
            if (data.success) {
                currentImage = new Image();
                currentImage.onload = () => {
                    originalImageWidth = data.width; 
                    originalImageHeight = data.height;
                    clearAllInputs(false); 
                    drawImage(); 
                    showStatus('Image loaded. Ready for interaction.');
                };
                currentImage.onerror = () => {
                    showStatus('Failed to load image data from server response.', true);
                }
                currentImage.src = data.image_data;
            } else {
                showStatus('Failed to upload image: ' + data.error, true);
            }
        } catch (error) {
            showStatus('Error uploading image: ' + error, true);
        }
    }
    
    function triggerPrediction() {
        clearTimeout(predictionDebounceTimer);
        predictionDebounceTimer = setTimeout(() => {
            if (currentImage && (userPoints.length > 0 || userBox || combinedUserMaskInput256)) {
                runPredictionInternal();
            } else if (currentImage) { 
                predictedMasks = [];
                autoMaskComposite = null; 
                drawPredictionMasks();
            }
        }, 300); 
    }

    async function runPredictionInternal() { 
        if (!currentImage) {
            return;
        }

        showStatus("Running prediction...");
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
                predictedMasks = []; drawPredictionMasks(); return;
            }
            const data = await response.json();
            if (data.success) {
                predictedMasks = data.masks; 
                drawPredictionMasks();
                showStatus(`Prediction complete. ${data.masks ? data.masks.length : 0} mask(s) found.`);
            } else {
                showStatus('Prediction failed: ' + (data.error || "Unknown error"), true);
                predictedMasks = [];
                drawPredictionMasks();
            }
        } catch (error) {
            showStatus('Error during prediction: ' + error, true);
            predictedMasks = [];
            drawPredictionMasks();
        }
    }
    runPredictBtn.addEventListener('click', triggerPrediction); 

    async function runAutoMask() {
        if (!currentImage) {
            showStatus("Please load an image first.", true);
            return;
        }
        showStatus("Running automatic mask generation...");
        predictedMasks = []; 
        userPoints = []; userBox = null; combinedUserMaskInput256 = null; userDrawnMasks = [];
        drawUserInput(); 

        const params = {
            points_per_side: parseInt(amgPointsPerSideEl.value) || 32,
            pred_iou_thresh: parseFloat(amgPredIouThreshEl.value) || 0.88,
            stability_score_thresh: parseFloat(amgStabilityScoreThreshEl.value) || 0.95,
        };

        try {
            const response = await fetch('/api/generate_auto_masks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            const data = await response.json();
            if (data.success) {
                autoMaskComposite = data.auto_mask_composite;
                drawPredictionMasks();
                showStatus(`Automatic mask generation complete. ${data.count} objects (approx).`);
            } else {
                showStatus('Automatic mask generation failed: ' + data.error, true);
                autoMaskComposite = null;
                drawPredictionMasks();
            }
        } catch (error) {
            showStatus('Error during automatic mask generation: ' + error, true);
            autoMaskComposite = null;
            drawPredictionMasks();
        }
    }

    // --- Event Handlers ---
    loadModelBtn.addEventListener('click', loadModel);
    imageUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            uploadImage(file);
        }
    });

    predictionOpacitySlider.addEventListener('input', drawPredictionMasks);
    userInputOpacitySlider.addEventListener('input', drawUserInput);

    autoMaskBtn.addEventListener('click', runAutoMask);

    function clearAllInputs(clearImageAndPredictions = true) {
        userPoints = [];
        userBox = null;
        userDrawnMasks = [];
        currentLassoPoints = [];
        isDrawingLasso = false;
        combinedUserMaskInput256 = null;
        
        if (clearImageAndPredictions) {
             predictedMasks = [];
             autoMaskComposite = null;
             currentImage = null;
             originalImageWidth = 0;
             originalImageHeight = 0;
             [imageCanvas, predictionMaskCanvas, userInputCanvas].forEach(canvas => {
                canvas.width = 300; canvas.height = 150; 
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0,0,canvas.width, canvas.height);
             });
             imageUpload.value = '';
        } else { 
            predictedMasks = [];
            autoMaskComposite = null;
            drawPredictionMasks();
        }
        drawUserInput(); 
        if (clearImageAndPredictions) drawPredictionMasks(); else triggerPrediction(); 
        showStatus('Inputs cleared.');
    }
    clearAllBtn.addEventListener('click', () => clearAllInputs(true)); 
    
    let interactionState = { 
        isDrawingBox: false,
        isMouseDown: false, 
        startX_orig: 0,
        startY_orig: 0,
    };

    userInputCanvas.addEventListener('mousedown', (e) => {
        if (!currentImage) return;
        interactionState.isMouseDown = true;
        const origCoords = displayToOriginalCoords(e.clientX, e.clientY);
        interactionState.startX_orig = origCoords.x;
        interactionState.startY_orig = origCoords.y;

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;

        if (isCtrl) { 
            let removedMask = false;
            for (let i = userDrawnMasks.length - 1; i >= 0; i--) {
                if (isPointInPolygon(origCoords, userDrawnMasks[i].points)) {
                    userDrawnMasks.splice(i, 1);
                    removedMask = true;
                    break;
                }
            }
            if (removedMask) {
                prepareCombinedUserMaskInput();
                drawUserInput();
                triggerPrediction();
            } else { 
                isDrawingLasso = true;
                currentLassoPoints = [origCoords];
            }
        } else if (isShift) {
            interactionState.isDrawingBox = true;
            userBox = null; 
        }
        e.preventDefault();
    });

    userInputCanvas.addEventListener('mousemove', (e) => {
        if (!currentImage || !interactionState.isMouseDown) return;
        
        const currentCoords_orig = displayToOriginalCoords(e.clientX, e.clientY);

        if (interactionState.isDrawingBox) {
            userBox = { 
                x1: Math.min(interactionState.startX_orig, currentCoords_orig.x),
                y1: Math.min(interactionState.startY_orig, currentCoords_orig.y),
                x2: Math.max(interactionState.startX_orig, currentCoords_orig.x),
                y2: Math.max(interactionState.startY_orig, currentCoords_orig.y),
            };
            drawUserInput(); 
        } else if (isDrawingLasso) {
            currentLassoPoints.push(currentCoords_orig);
            drawUserInput(); 
        }
    });

    userInputCanvas.addEventListener('mouseup', (e) => {
        if (!currentImage || !interactionState.isMouseDown) return; 
        
        const coords_orig = displayToOriginalCoords(e.clientX, e.clientY);
        // Adjust click threshold based on original image size relative to a typical display size for the point radius
        const pointDisplayRadius = 5; // Radius of drawn point on canvas
        const clickThresholdOrig = pointDisplayRadius * (originalImageWidth / userInputCanvas.width);


        if (interactionState.isDrawingBox) {
            interactionState.isDrawingBox = false; 
            if (userBox && (userBox.x2 - userBox.x1 < clickThresholdOrig || userBox.y2 - userBox.y1 < clickThresholdOrig)) {
                userBox = null; 
            }
        } else if (isDrawingLasso) {
            isDrawingLasso = false; 
            if (currentLassoPoints.length > 2) { 
                userDrawnMasks.push({ 
                    points: [...currentLassoPoints], 
                    color: `${getRandomHexColor()}60`, 
                    id: Date.now() 
                });
                prepareCombinedUserMaskInput();
            }
            currentLassoPoints = [];
        } else { 
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
        }
        
        interactionState.isMouseDown = false; 
        drawUserInput();
        triggerPrediction(); 
    });

    userInputCanvas.addEventListener('mouseleave', (e) => { 
        if(interactionState.isMouseDown) { 
            if (interactionState.isDrawingBox) {
                const clickThresholdOrig = 10 * (originalImageWidth / userInputCanvas.width);
                 if (userBox && (userBox.x2 - userBox.x1 < clickThresholdOrig || userBox.y2 - userBox.y1 < clickThresholdOrig)) {
                    userBox = null;
                }
                interactionState.isDrawingBox = false;
            } else if (isDrawingLasso) {
                if (currentLassoPoints.length > 2) {
                    userDrawnMasks.push({ points: [...currentLassoPoints], color: `${getRandomHexColor()}60`, id: Date.now() });
                    prepareCombinedUserMaskInput();
                }
                currentLassoPoints = [];
                isDrawingLasso = false;
            }
            interactionState.isMouseDown = false;
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
            tempCtx.moveTo(firstP_orig.x * MASK_DIM / originalImageWidth, firstP_orig.y * MASK_DIM / originalImageHeight);
            for (let i = 1; i < mask.points.length; i++) {
                const p_orig = mask.points[i];
                tempCtx.lineTo(p_orig.x * MASK_DIM / originalImageWidth, p_orig.y * MASK_DIM / originalImageHeight);
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
        showStatus("Combined user-drawn masks prepared for input.");
    }
    
    saveMasksBtn.addEventListener('click', () => {
        if (!currentImage) {
            showStatus("No image or prediction to save.", true);
            return;
        }
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = imageCanvas.width;
        compositeCanvas.height = imageCanvas.height;
        const compositeCtx = compositeCanvas.getContext('2d');

        compositeCtx.drawImage(imageCanvas, 0, 0);
        compositeCtx.globalAlpha = parseFloat(predictionOpacitySlider.value);
        if (predictionMaskCanvas.width > 0 && predictionMaskCanvas.height > 0) { 
            compositeCtx.drawImage(predictionMaskCanvas, 0, 0);
        }
        compositeCtx.globalAlpha = parseFloat(userInputOpacitySlider.value);
         if (userInputCanvas.width > 0 && userInputCanvas.height > 0) { 
            compositeCtx.drawImage(userInputCanvas, 0, 0);
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
    window.addEventListener('resize', drawImage);
});