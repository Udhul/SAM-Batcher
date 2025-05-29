// static/canvas.js
class CanvasManager {
    constructor() {
        this.initializeElements();
        this.initializeState();
        this.initializeCanvases();
        this.setupEventListeners();
        this.setupOpacitySliders();
    }

    initializeElements() {
        // Canvas elements
        this.imageCanvas = document.getElementById('image-canvas');
        this.predictionMaskCanvas = document.getElementById('prediction-mask-canvas');
        this.userInputCanvas = document.getElementById('user-input-canvas');
        
        // Canvas contexts
        this.imageCtx = this.imageCanvas.getContext('2d');
        this.predictionCtx = this.predictionMaskCanvas.getContext('2d');
        this.userCtx = this.userInputCanvas.getContext('2d');

        // Canvas toolbar elements
        this.imageUpload = document.getElementById('image-upload');
        this.imageUploadProgressEl = document.getElementById('image-upload-progress');
        this.imageUploadBarEl = document.getElementById('image-upload-bar');
        this.clearInputsBtn = document.getElementById('clear-inputs-btn');
        this.maskDisplayModeSelect = document.getElementById('mask-display-mode');
        
        // Opacity sliders
        this.imageOpacitySlider = document.getElementById('image-opacity');
        this.predictionOpacitySlider = document.getElementById('prediction-opacity');
        this.userInputOpacitySlider = document.getElementById('user-input-opacity');
        
        // Canvas lock overlay
        this.canvasLockEl = document.getElementById('canvas-lock');
        this.canvasLockMessageEl = document.querySelector('#canvas-lock .canvas-lock-message');

        // Offscreen canvases for smoother opacity changes
        this.offscreenPredictionCanvas = document.createElement('canvas');
        this.offscreenPredictionCtx = this.offscreenPredictionCanvas.getContext('2d');
        this.offscreenUserCanvas = document.createElement('canvas');
        this.offscreenUserCtx = this.offscreenUserCanvas.getContext('2d');

        // Temporary canvas for rendering individual automasks at full resolution
        this.tempAutomaskRenderCanvas = document.createElement('canvas');
        this.tempAutomaskRenderCtx = this.tempAutomaskRenderCanvas.getContext('2d');
    }

    initializeState() {
        // Image state
        this.currentImage = null;
        this.currentImageFilename = null;
        this.originalImageWidth = 0;
        this.originalImageHeight = 0;

        // User interaction state
        this.userPoints = [];
        this.userBox = null;
        this.userDrawnMasks = [];
        this.currentLassoPoints = [];
        this.isDrawingLasso = false;
        this.combinedUserMaskInput256 = null;

        // Prediction state
        this.allPredictedMasksData = []; // For manual predictions (base64 strings + scores)
        this.autoMasksRawData = null;    // For automask (list of {segmentation, color_rgba_str})

        // Interaction state
        this.interactionState = {
            isDrawingBox: false,
            isMouseDown: false,
            startX_orig: 0,
            startY_orig: 0,
            didMove: false
        };
    }

    initializeCanvases() {
        // Set initial canvas size
        this.resizeCanvases(300, 150);
    }

    setupOpacitySliders() {
        const opacitySliders = [this.imageOpacitySlider, this.predictionOpacitySlider, this.userInputOpacitySlider];
        
        opacitySliders.forEach(slider => {
            slider.min = '0';
            slider.max = '1';
            slider.step = '0.125';
        });

        this.imageOpacitySlider.value = '1.0'; 
        this.predictionOpacitySlider.value = '1.0'; 
        this.userInputOpacitySlider.value = '0.6';

        this.imageOpacitySlider.addEventListener('input', () => this.drawImage());
        this.predictionOpacitySlider.addEventListener('input', () => this.filterAndDrawPredictionMasks());
        this.userInputOpacitySlider.addEventListener('input', () => this.drawUserInput());
    }

    setupEventListeners() {
        this.imageUpload.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                this.uploadImage(file);
            }
        });
        this.clearInputsBtn.addEventListener('click', () => {
            this.clearAllInputs(false, true); 
        });
        this.maskDisplayModeSelect.addEventListener('change', () => {
            this.filterAndDrawPredictionMasks();
        });
        this.setupCanvasInteractions();
        window.addEventListener('resize', () => this.drawImage());
    }

    setupCanvasInteractions() {
        this.userInputCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.userInputCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.userInputCanvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.userInputCanvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));
        this.userInputCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    resizeCanvases(width, height) {
        [this.imageCanvas, this.predictionMaskCanvas, this.userInputCanvas, 
         this.offscreenPredictionCanvas, this.offscreenUserCanvas].forEach(canvas => {
            canvas.width = width;
            canvas.height = height;
        });
    }

    displayToOriginalCoords(clientX, clientY) {
        if (!this.originalImageWidth || !this.originalImageHeight || 
            this.userInputCanvas.width === 0 || this.userInputCanvas.height === 0) {
            return { x: 0, y: 0 };
        }
        const rect = this.userInputCanvas.getBoundingClientRect();
        const canvasX = (clientX - rect.left) * (this.userInputCanvas.width / rect.width);
        const canvasY = (clientY - rect.top) * (this.userInputCanvas.height / rect.height);
        return {
            x: canvasX * (this.originalImageWidth / this.userInputCanvas.width),
            y: canvasY * (this.originalImageHeight / this.userInputCanvas.height)
        };
    }

    originalToDisplayCoords(originalX, originalY) {
        if (!this.originalImageWidth || !this.originalImageHeight || 
            this.userInputCanvas.width === 0 || this.userInputCanvas.height === 0) {
            return { x: 0, y: 0 };
        }
        return {
            x: originalX * (this.userInputCanvas.width / this.originalImageWidth),
            y: originalY * (this.userInputCanvas.height / this.originalImageHeight)
        };
    }

    getRandomHexColor() {
        const r = Math.floor(Math.random() * 180 + 50);
        const g = Math.floor(Math.random() * 180 + 50);
        const b = Math.floor(Math.random() * 180 + 50);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    lockCanvas(message = "Processing... Please Wait.") {
        this.canvasLockMessageEl.textContent = message;
        this.canvasLockEl.style.display = 'flex';
    }

    unlockCanvas() {
        this.canvasLockEl.style.display = 'none';
    }

    drawImage() {
        if (!this.currentImage) return;

        const displayArea = document.querySelector('.image-display-area');
        const areaWidth = displayArea.clientWidth > 0 ? displayArea.clientWidth : 600;
        const areaHeight = displayArea.clientHeight > 0 ? displayArea.clientHeight : 400;

        const maxWidth = areaWidth * 0.98;
        const maxHeight = areaHeight * 0.98;

        const hRatio = maxWidth / this.originalImageWidth;
        const vRatio = maxHeight / this.originalImageHeight;
        const currentDisplayScale = Math.min(hRatio, vRatio, 1.0);

        const displayWidth = Math.round(this.originalImageWidth * currentDisplayScale);
        const displayHeight = Math.round(this.originalImageHeight * currentDisplayScale);

        this.resizeCanvases(displayWidth, displayHeight);
        this.imageCtx.clearRect(0, 0, displayWidth, displayHeight);
        
        this.imageCtx.globalAlpha = parseFloat(this.imageOpacitySlider.value);
        this.imageCtx.drawImage(this.currentImage, 0, 0, displayWidth, displayHeight);
        this.imageCtx.globalAlpha = 1.0;

        this.drawUserInput();
        this.filterAndDrawPredictionMasks(); // This is async but drawImage doesn't need to wait for it
    }

    drawUserInput() {
        if (!this.currentImage || this.offscreenUserCanvas.width === 0 || this.offscreenUserCanvas.height === 0) return;
        
        this.offscreenUserCtx.clearRect(0, 0, this.offscreenUserCanvas.width, this.offscreenUserCanvas.height);

        const pointDisplayRadius = 2;
        const lineDisplayWidth = 1;

        this.userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            this.offscreenUserCtx.beginPath();
            const firstP_disp = this.originalToDisplayCoords(mask.points[0].x, mask.points[0].y);
            this.offscreenUserCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < mask.points.length; i++) {
                const p_disp = this.originalToDisplayCoords(mask.points[i].x, mask.points[i].y);
                this.offscreenUserCtx.lineTo(p_disp.x, p_disp.y);
            }
            this.offscreenUserCtx.closePath();
            this.offscreenUserCtx.fillStyle = mask.color || 'rgba(255, 255, 0, 0.4)';
            this.offscreenUserCtx.fill();
            this.offscreenUserCtx.strokeStyle = 'rgba(0,0,0,0.6)';
            this.offscreenUserCtx.lineWidth = 1;
            this.offscreenUserCtx.stroke();
        });

        if (this.isDrawingLasso && this.currentLassoPoints.length > 0) {
            this.offscreenUserCtx.beginPath();
            const firstP_disp = this.originalToDisplayCoords(this.currentLassoPoints[0].x, this.currentLassoPoints[0].y);
            this.offscreenUserCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < this.currentLassoPoints.length; i++) {
                const p_disp = this.originalToDisplayCoords(this.currentLassoPoints[i].x, this.currentLassoPoints[i].y);
                this.offscreenUserCtx.lineTo(p_disp.x, p_disp.y);
            }
            if (this.currentLassoPoints.length > 1) {
                this.offscreenUserCtx.lineTo(firstP_disp.x, firstP_disp.y);
            }
            this.offscreenUserCtx.strokeStyle = 'rgba(255, 223, 0, 0.9)';
            this.offscreenUserCtx.lineWidth = lineDisplayWidth;
            this.offscreenUserCtx.stroke();
        }

        this.userPoints.forEach(p_orig => {
            const dp = this.originalToDisplayCoords(p_orig.x, p_orig.y);
            this.offscreenUserCtx.beginPath();
            this.offscreenUserCtx.arc(dp.x, dp.y, pointDisplayRadius, 0, 2 * Math.PI);
            this.offscreenUserCtx.fillStyle = p_orig.label === 1 ? 'rgba(0,200,0,0.8)' : 'rgba(200,0,0,0.8)';
            this.offscreenUserCtx.fill();
            this.offscreenUserCtx.strokeStyle = 'rgba(255,255,255,0.9)';
            this.offscreenUserCtx.lineWidth = lineDisplayWidth * 0.75;
            this.offscreenUserCtx.stroke();
        });

        if (this.userBox) {
            const db1 = this.originalToDisplayCoords(this.userBox.x1, this.userBox.y1);
            const db2 = this.originalToDisplayCoords(this.userBox.x2, this.userBox.y2);
            this.offscreenUserCtx.strokeStyle = 'rgba(0,100,255,0.8)';
            this.offscreenUserCtx.lineWidth = lineDisplayWidth;
            this.offscreenUserCtx.strokeRect(db1.x, db1.y, db2.x - db1.x, db2.y - db1.y);
        }

        this.userCtx.clearRect(0, 0, this.userInputCanvas.width, this.userInputCanvas.height);
        this.userCtx.globalAlpha = parseFloat(this.userInputOpacitySlider.value);
        this.userCtx.drawImage(this.offscreenUserCanvas, 0, 0);
        this.userCtx.globalAlpha = 1.0;
    }

    async filterAndDrawPredictionMasks() { // Make it async
        if (!this.currentImage || this.offscreenPredictionCanvas.width === 0 || this.offscreenPredictionCanvas.height === 0) {
            this.predictionCtx.clearRect(0, 0, this.predictionMaskCanvas.width, this.predictionMaskCanvas.height);
            this.offscreenPredictionCtx.clearRect(0, 0, this.offscreenPredictionCanvas.width, this.offscreenPredictionCanvas.height);
            return;
        }
        
        this.offscreenPredictionCtx.clearRect(0, 0, this.offscreenPredictionCanvas.width, this.offscreenPredictionCanvas.height);

        if (this.autoMasksRawData && this.autoMasksRawData.length > 0) {
            // Render raw automasks (synchronous drawing to offscreen canvas for this part)
            this.tempAutomaskRenderCanvas.width = this.originalImageWidth;
            this.tempAutomaskRenderCanvas.height = this.originalImageHeight;

            this.autoMasksRawData.forEach(maskDef => {
                const { segmentation, color_rgba_str } = maskDef;
                if (!segmentation || segmentation.length === 0 || segmentation[0].length === 0) return;

                const maskHeight = segmentation.length;    
                const maskWidth = segmentation[0].length; 

                const imageData = this.tempAutomaskRenderCtx.createImageData(maskWidth, maskHeight);
                const pixelData = imageData.data;

                const colorParts = color_rgba_str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                if (!colorParts) {
                    console.error("Could not parse color string for automask:", color_rgba_str);
                    return; 
                }
                const r = parseInt(colorParts[1]);
                const g = parseInt(colorParts[2]);
                const b = parseInt(colorParts[3]);
                const a = colorParts[4] ? Math.round(parseFloat(colorParts[4]) * 255) : 255;

                for (let y = 0; y < maskHeight; y++) {
                    for (let x = 0; x < maskWidth; x++) {
                        if (segmentation[y][x]) { 
                            const index = (y * maskWidth + x) * 4;
                            pixelData[index] = r;
                            pixelData[index + 1] = g;
                            pixelData[index + 2] = b;
                            pixelData[index + 3] = a;
                        }
                    }
                }
                this.tempAutomaskRenderCtx.putImageData(imageData, 0, 0);
                this.offscreenPredictionCtx.drawImage(this.tempAutomaskRenderCanvas, 0, 0, 
                                                      this.offscreenPredictionCanvas.width, 
                                                      this.offscreenPredictionCanvas.height);
            });
        } else if (this.allPredictedMasksData && this.allPredictedMasksData.length > 0) {
            // Render manual predictions (base64 images)
            let masksToDrawBase64 = [];
            const mode = this.maskDisplayModeSelect.value;

            if (mode === 'best' && this.allPredictedMasksData[0]) {
                masksToDrawBase64.push(this.allPredictedMasksData[0].maskBase64);
            } else if (mode === 'all') {
                masksToDrawBase64 = this.allPredictedMasksData.map(m => m.maskBase64);
            }

            if (masksToDrawBase64.length > 0) {
                const imageLoadPromises = masksToDrawBase64.map(maskBase64 => {
                    return new Promise((resolve, reject) => {
                        const img = new Image();
                        img.onload = () => {
                            this.offscreenPredictionCtx.drawImage(img, 0, 0, this.offscreenPredictionCanvas.width, this.offscreenPredictionCanvas.height);
                            resolve();
                        };
                        img.onerror = (err) => {
                            console.error("Error loading a prediction mask image from base64:", maskBase64.substring(0,100) + "..."); // Log part of string
                            // Resolve even on error to not block other images, but log it.
                            // The canvas will just miss this one mask.
                            resolve(); 
                        };
                        img.src = maskBase64;
                    });
                });

                try {
                    await Promise.all(imageLoadPromises); // Wait for all images to be loaded and drawn
                } catch (error) {
                    // This catch might not be strictly necessary if individual promises resolve on error
                    console.error("Error processing one or more manual prediction masks:", error);
                }
            }
        }
        // Else: No masks to draw, offscreenPredictionCtx is already clear.

        // After all masks (either automask or manual) are drawn to offscreenPredictionCtx,
        // or if there were no masks, draw it to the visible prediction canvas with opacity.
        this.predictionCtx.clearRect(0, 0, this.predictionMaskCanvas.width, this.predictionMaskCanvas.height);
        this.predictionCtx.globalAlpha = parseFloat(this.predictionOpacitySlider.value);
        this.predictionCtx.drawImage(this.offscreenPredictionCanvas, 0, 0);
        this.predictionCtx.globalAlpha = 1.0;
    }

    async uploadImage(file) {
        const formData = new FormData();
        formData.append('image', file);
        
        this.currentImageFilename = file.name;

        this.imageUploadProgressEl.style.display = 'block';
        this.imageUploadBarEl.style.width = '0%';
        this.imageUploadBarEl.textContent = '0%';
        this.lockCanvas("Uploading image...");

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload_image', true);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    this.imageUploadBarEl.style.width = percentComplete + '%';
                    this.imageUploadBarEl.textContent = percentComplete + '%';
                }
            };

            xhr.onload = async () => {
                this.unlockCanvas();
                this.imageUploadProgressEl.style.display = 'none';
                if (xhr.status === 200) {
                    const data = JSON.parse(xhr.responseText);
                    if (data.success) {
                        this.clearAllInputs(false, true); 
                        
                        this.currentImage = new Image();
                        this.currentImage.onload = () => {
                            this.originalImageWidth = data.width;
                            this.originalImageHeight = data.height;
                            this.drawImage(); 
                            this.dispatchEvent('imageLoaded', { filename: this.currentImageFilename });
                        };
                        this.currentImage.onerror = () => {
                            this.dispatchEvent('error', { message: 'Failed to load image data from server response.' });
                        }
                        this.currentImage.src = data.image_data;
                        this.currentImageFilename = data.filename || file.name;
                    } else {
                        this.dispatchEvent('error', { message: 'Failed to upload image: ' + (data.error || "Unknown server error") });
                    }
                } else {
                    this.dispatchEvent('error', { message: `Image upload failed: ${xhr.status} ${xhr.statusText || "Server error"}` });
                }
            };
            xhr.onerror = () => {
                this.unlockCanvas();
                this.imageUploadProgressEl.style.display = 'none';
                this.dispatchEvent('error', { message: 'Image upload error (network connection or server unavailable).' });
            };
            xhr.send(formData);
        } catch (error) {
            this.unlockCanvas();
            this.imageUploadProgressEl.style.display = 'none';
            this.dispatchEvent('error', { message: 'Error setting up image upload: ' + error });
        }
    }

    handleMouseDown(e) {
        if (!this.currentImage || this.canvasLockEl.style.display !== 'none') return;
        
        this.interactionState.isMouseDown = true;
        this.interactionState.didMove = false;
        const origCoords = this.displayToOriginalCoords(e.clientX, e.clientY);
        this.interactionState.startX_orig = origCoords.x;
        this.interactionState.startY_orig = origCoords.y;

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;

        if (isCtrl) {
            this.isDrawingLasso = true;
            this.currentLassoPoints = [origCoords];
        } else if (isShift) {
            this.interactionState.isDrawingBox = true;
            this.userBox = null;
        }
        e.preventDefault();
    }

    handleMouseMove(e) {
        if (!this.currentImage || !this.interactionState.isMouseDown || this.canvasLockEl.style.display !== 'none') return;
        
        this.interactionState.didMove = true;
        const currentCoords_orig = this.displayToOriginalCoords(e.clientX, e.clientY);

        if (this.interactionState.isDrawingBox) {
            this.userBox = {
                x1: Math.min(this.interactionState.startX_orig, currentCoords_orig.x),
                y1: Math.min(this.interactionState.startY_orig, currentCoords_orig.y),
                x2: Math.max(this.interactionState.startX_orig, currentCoords_orig.x),
                y2: Math.max(this.interactionState.startY_orig, currentCoords_orig.y),
            };
            this.drawUserInput();
        } else if (this.isDrawingLasso) {
            this.currentLassoPoints.push(currentCoords_orig);
            this.drawUserInput();
        }
    }

    handleMouseUp(e) {
        if (!this.currentImage || !this.interactionState.isMouseDown || this.canvasLockEl.style.display !== 'none') return;

        const coords_orig = this.displayToOriginalCoords(e.clientX, e.clientY);
        const pointDisplayRadius = 5;
        const clickThresholdOrig = (this.userInputCanvas.width > 0 && this.originalImageWidth > 0) ?
                                   (pointDisplayRadius * (this.originalImageWidth / this.userInputCanvas.width)) :
                                   pointDisplayRadius;

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;
        let interactionHandledOnUp = false;

        if (this.interactionState.isDrawingBox) {
            if (this.userBox && (this.userBox.x2 - this.userBox.x1 < clickThresholdOrig || this.userBox.y2 - this.userBox.y1 < clickThresholdOrig)) {
                this.userBox = null;
            }
            interactionHandledOnUp = true;
        } else if (this.isDrawingLasso) {
            if (this.currentLassoPoints.length > 2) {
                this.userDrawnMasks.push({
                    points: [...this.currentLassoPoints],
                    color: `${this.getRandomHexColor()}99`,
                    id: Date.now()
                });
                this.prepareCombinedUserMaskInput();
            }
            interactionHandledOnUp = true;
        }

        if (!this.interactionState.didMove || (!interactionHandledOnUp && !this.isDrawingLasso && !this.interactionState.isDrawingBox)) {
            if (isCtrl) {
                let removedMask = false;
                for (let i = this.userDrawnMasks.length - 1; i >= 0; i--) {
                    if (this.isPointInPolygon(coords_orig, this.userDrawnMasks[i].points)) {
                        this.userDrawnMasks.splice(i, 1);
                        removedMask = true;
                        break;
                    }
                }
                if (removedMask) this.prepareCombinedUserMaskInput();
                interactionHandledOnUp = true;
            } else if (isShift) {
                if (this.userBox &&
                    coords_orig.x >= this.userBox.x1 && coords_orig.x <= this.userBox.x2 &&
                    coords_orig.y >= this.userBox.y1 && coords_orig.y <= this.userBox.y2) {
                    this.userBox = null;
                    interactionHandledOnUp = true;
                }
            } else {
                const label = e.button === 0 ? 1 : 0;
                let removedPoint = false;
                for (let i = this.userPoints.length - 1; i >= 0; i--) {
                    const p_orig = this.userPoints[i];
                    const dist = Math.sqrt(Math.pow(p_orig.x - coords_orig.x, 2) + Math.pow(p_orig.y - coords_orig.y, 2));
                    if (dist < clickThresholdOrig) {
                        this.userPoints.splice(i, 1);
                        removedPoint = true;
                        break;
                    }
                }
                if (!removedPoint) {
                    this.userPoints.push({ x: coords_orig.x, y: coords_orig.y, label: label });
                }
                interactionHandledOnUp = true;
            }
        }

        this.isDrawingLasso = false;
        this.currentLassoPoints = [];
        this.interactionState.isDrawingBox = false;
        this.interactionState.isMouseDown = false;
        this.interactionState.didMove = false;

        this.drawUserInput();
        this.dispatchEvent('userInteraction', { 
            points: this.userPoints, 
            box: this.userBox, 
            maskInput: this.combinedUserMaskInput256 
        });
    }

    handleMouseLeave(e) {
        if (this.interactionState.isMouseDown && this.canvasLockEl.style.display === 'none') {
            const clickThresholdOrig = (this.userInputCanvas.width > 0 && this.originalImageWidth > 0) ?
                                       (10 * (this.originalImageWidth / this.userInputCanvas.width)) : 10;
            if (this.interactionState.isDrawingBox) {
                if (this.userBox && (this.userBox.x2 - this.userBox.x1 < clickThresholdOrig || this.userBox.y2 - this.userBox.y1 < clickThresholdOrig)) {
                    this.userBox = null;
                }
            } else if (this.isDrawingLasso) {
                if (this.currentLassoPoints.length > 2) {
                    this.userDrawnMasks.push({ 
                        points: [...this.currentLassoPoints], 
                        color: `${this.getRandomHexColor()}99`, 
                        id: Date.now() 
                    });
                    this.prepareCombinedUserMaskInput();
                }
            }
            
            this.isDrawingLasso = false;
            this.currentLassoPoints = [];
            this.interactionState.isDrawingBox = false;
            this.interactionState.isMouseDown = false;
            this.interactionState.didMove = false;

            this.drawUserInput();
            this.dispatchEvent('userInteraction', { 
                points: this.userPoints, 
                box: this.userBox, 
                maskInput: this.combinedUserMaskInput256 
            });
        }
    }

    isPointInPolygon(point, polygonPoints) {
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

    prepareCombinedUserMaskInput() {
        if (this.userDrawnMasks.length === 0 || !this.originalImageWidth || !this.originalImageHeight) {
            this.combinedUserMaskInput256 = null;
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

        this.userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            tempCtx.beginPath();
            const firstP_orig = mask.points[0];
            tempCtx.moveTo(
                (firstP_orig.x / this.originalImageWidth) * MASK_DIM,
                (firstP_orig.y / this.originalImageHeight) * MASK_DIM
            );
            for (let i = 1; i < mask.points.length; i++) {
                const p_orig = mask.points[i];
                tempCtx.lineTo(
                    (p_orig.x / this.originalImageWidth) * MASK_DIM,
                    (p_orig.y / this.originalImageHeight) * MASK_DIM
                );
            }
            tempCtx.closePath();
            tempCtx.fill();
        });

        const imageData = tempCtx.getImageData(0, 0, MASK_DIM, MASK_DIM);
        const data = imageData.data;
        this.combinedUserMaskInput256 = [];
        for (let r = 0; r < MASK_DIM; r++) {
            const row = [];
            for (let c = 0; c < MASK_DIM; c++) {
                const idx = (r * MASK_DIM + c) * 4;
                row.push(data[idx] > 128 ? 1.0 : 0.0);
            }
            this.combinedUserMaskInput256.push(row);
        }
    }

    clearAllInputs(clearImage = false, clearPredictionsAndInputs = true) {
        if (clearPredictionsAndInputs) {
            this.userPoints = [];
            this.userBox = null;
            this.userDrawnMasks = [];
            this.currentLassoPoints = [];
            this.isDrawingLasso = false;
            this.combinedUserMaskInput256 = null;
            
            this.allPredictedMasksData = []; 
            this.autoMasksRawData = null;    

            this.drawUserInput(); 
            this.filterAndDrawPredictionMasks(); 
        }

        if (clearImage) {
            this.currentImage = null;
            this.currentImageFilename = null;
            this.originalImageWidth = 0;
            this.originalImageHeight = 0;
            [this.imageCanvas, this.predictionMaskCanvas, this.userInputCanvas, 
             this.offscreenPredictionCanvas, this.offscreenUserCanvas, 
             this.tempAutomaskRenderCanvas].forEach(canvas => {
                canvas.width = 300;
                canvas.height = 150;
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            });
            this.imageUpload.value = '';
            this.imageUploadProgressEl.style.display = 'none';
        }

        this.dispatchEvent('inputsCleared', { 
            clearedImage: clearImage, 
            clearedInputs: clearPredictionsAndInputs 
        });
    }

    setPredictedMasks(masksData) { 
        this.allPredictedMasksData = masksData;
        this.autoMasksRawData = null; 
        this.filterAndDrawPredictionMasks(); // This is async
    }

    setAutoMasksData(masksDataArray) { 
        this.autoMasksRawData = masksDataArray;
        this.allPredictedMasksData = []; 
        this.filterAndDrawPredictionMasks(); // This is async
    }

    getCurrentInputs() {
        return {
            points: this.userPoints,
            box: this.userBox,
            maskInput: this.combinedUserMaskInput256,
            image: this.currentImage,
            filename: this.currentImageFilename
        };
    }

    dispatchEvent(eventType, data) {
        const event = new CustomEvent(`canvas-${eventType}`, { detail: data });
        document.dispatchEvent(event);
    }

    addEventListener(eventType, callback) {
        document.addEventListener(`canvas-${eventType}`, callback);
    }
}

// Initialize canvas manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.canvasManager = new CanvasManager();
});