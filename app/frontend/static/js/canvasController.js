// project_root/app/frontend/static/js/canvasController.js
class CanvasManager {
    constructor() {
        this.initializeElements();
        this.initializeState();
        this.initializeCanvases();
        this.setupEventListeners();
        this.setupOpacitySliders();
    }

    initializeElements() {
        this.imageCanvas = document.getElementById('image-canvas');
        this.predictionMaskCanvas = document.getElementById('prediction-mask-canvas');
        this.userInputCanvas = document.getElementById('user-input-canvas');
        
        this.imageCtx = this.imageCanvas.getContext('2d');
        this.predictionCtx = this.predictionMaskCanvas.getContext('2d', { willReadFrequently: true });
        this.userCtx = this.userInputCanvas.getContext('2d');

        this.imageUpload = document.getElementById('image-upload');
        this.imageUploadProgressEl = document.getElementById('image-upload-progress');
        this.imageUploadBarEl = document.getElementById('image-upload-bar');
        this.clearInputsBtn = document.getElementById('clear-inputs-btn');
        this.maskDisplayModeSelect = document.getElementById('mask-display-mode');
        
        // Check if mask display mode select exists, if not create a default
        if (!this.maskDisplayModeSelect) {
            console.warn('mask-display-mode element not found, creating default');
            this.maskDisplayModeSelect = { value: 'best' }; // Default fallback
        }
        
        this.imageOpacitySlider = document.getElementById('image-opacity');
        this.predictionOpacitySlider = document.getElementById('prediction-opacity');
        this.userInputOpacitySlider = document.getElementById('user-input-opacity');
        
        this.canvasLockEl = document.getElementById('canvas-lock');
        this.canvasLockMessageEl = document.querySelector('#canvas-lock .canvas-lock-message');

        this.offscreenPredictionCanvas = document.createElement('canvas');
        this.offscreenPredictionCtx = this.offscreenPredictionCanvas.getContext('2d', { willReadFrequently: true });
        this.offscreenUserCanvas = document.createElement('canvas');
        this.offscreenUserCtx = this.offscreenUserCanvas.getContext('2d');

        this.tempMaskPixelCanvas = document.createElement('canvas');
        this.tempMaskPixelCtx = this.tempMaskPixelCanvas.getContext('2d', { willReadFrequently: true });
    }

    initializeState() {
        this.currentImage = null;
        this.currentImageFilename = null;
        this.originalImageWidth = 0;
        this.originalImageHeight = 0;

        this.userPoints = [];
        this.userBox = null;
        this.userDrawnMasks = [];
        this.currentLassoPoints = [];
        this.isDrawingLasso = false;
        this.combinedUserMaskInput256 = null;

        this.manualPredictions = []; 
        this.automaskPredictions = []; 

        this.interactionState = {
            isDrawingBox: false,
            isMouseDown: false,
            startX_orig: 0,
            startY_orig: 0,
            didMove: false
        };
    }

    initializeCanvases() {
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
        this.predictionOpacitySlider.addEventListener('input', () => this.drawPredictionMasks());
        this.userInputOpacitySlider.addEventListener('input', () => this.drawUserInput());
    }

    setupEventListeners() {
        this.imageUpload.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) this.uploadImage(file);
        });
        this.clearInputsBtn.addEventListener('click', () => this.clearAllInputs(false, true));
        this.maskDisplayModeSelect.addEventListener('change', () => this.drawPredictionMasks());
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
            this.userInputCanvas.width === 0 || this.userInputCanvas.height === 0) return { x: 0, y: 0 };
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
            this.userInputCanvas.width === 0 || this.userInputCanvas.height === 0) return { x: 0, y: 0 };
        return {
            x: originalX * (this.userInputCanvas.width / this.originalImageWidth),
            y: originalY * (this.userInputCanvas.height / this.originalImageHeight)
        };
    }

    _generateDistinctColors(count) {
        const colors = [];
        for (let i = 0; i < count; i++) {
            const hue = (i * (360 / (count < 5 ? count * 1.8 : count * 1.1))) % 360; 
            const saturation = 70 + Math.random() * 20; 
            const lightness = 55 + Math.random() * 10; 
            
            // Convert HSL to RGB
            const h = hue / 360;
            const s = saturation / 100;
            const l = lightness / 100;
            
            let r, g, b;
            if (s === 0) {
                r = g = b = l; // achromatic
            } else {
                const hue2rgb = (p, q, t) => {
                    if (t < 0) t += 1;
                    if (t > 1) t -= 1;
                    if (t < 1/6) return p + (q - p) * 6 * t;
                    if (t < 1/2) return q;
                    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                    return p;
                };
                
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1/3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1/3);
            }
            
            // Convert to 0-255 range and create rgba string
            const red = Math.round(r * 255);
            const green = Math.round(g * 255);
            const blue = Math.round(b * 255);
            colors.push(`rgba(${red}, ${green}, ${blue}, 0.7)`); // 70% opacity
        }
        return colors;
    }
    
    _parseRgbaFromString(rgbaStr) {
        console.log('Parsing color string:', rgbaStr);
        const match = rgbaStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) {
            console.warn('Failed to parse color string:', rgbaStr);
            return [255, 0, 0, 255]; // Return red as fallback instead of transparent
        }
        const result = [
            parseInt(match[1]),
            parseInt(match[2]),
            parseInt(match[3]),
            match[4] !== undefined ? Math.round(parseFloat(match[4]) * 255) : 255 
        ];
        console.log('Parsed color result:', result);
        return result;
    }


    drawImage() {
        if (!this.currentImage) return;
        const displayArea = document.querySelector('.image-display-area');
        const areaWidth = displayArea.clientWidth || 600;
        const areaHeight = displayArea.clientHeight || 400;
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
        this.drawPredictionMasks();
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
    
    drawPredictionMasks() {
        console.log('=== drawPredictionMasks() called ===');
        console.log('Current image exists:', !!this.currentImage);
        console.log('Canvas dimensions:', this.offscreenPredictionCanvas.width, 'x', this.offscreenPredictionCanvas.height);
        console.log('Manual predictions count:', this.manualPredictions.length);
        console.log('Automask predictions count:', this.automaskPredictions.length);
        
        if (!this.currentImage || this.offscreenPredictionCanvas.width === 0 || this.offscreenPredictionCanvas.height === 0) {
            console.log('Early return: no image or zero canvas dimensions');
            this.predictionCtx.clearRect(0, 0, this.predictionMaskCanvas.width, this.predictionMaskCanvas.height);
            this.offscreenPredictionCtx.clearRect(0, 0, this.offscreenPredictionCanvas.width, this.offscreenPredictionCanvas.height);
            return;
        }
        
        this.offscreenPredictionCtx.clearRect(0, 0, this.offscreenPredictionCanvas.width, this.offscreenPredictionCanvas.height);

        let activePredictions = []; 
        
        if (this.automaskPredictions && this.automaskPredictions.length > 0) {
            console.log('Using automask predictions');
            activePredictions = this.automaskPredictions;
        } else if (this.manualPredictions && this.manualPredictions.length > 0) {
            console.log('Using manual predictions');
            const mode = this.maskDisplayModeSelect ? this.maskDisplayModeSelect.value : 'best';
            console.log('Mask display mode:', mode);
            if (mode === 'best' && this.manualPredictions[0]) {
                activePredictions.push(this.manualPredictions[0]);
            } else if (mode === 'all') {
                activePredictions = this.manualPredictions;
            } else {
                // Default to best if mode is unknown
                activePredictions.push(this.manualPredictions[0]);
            }
        }

        console.log('Active predictions count:', activePredictions.length);
        console.log('Active predictions sample:', activePredictions[0]);

        if (activePredictions.length > 0) {
            if (this.tempMaskPixelCanvas.width !== this.originalImageWidth || this.tempMaskPixelCanvas.height !== this.originalImageHeight) {
                console.log('Resizing temp canvas to:', this.originalImageWidth, 'x', this.originalImageHeight);
                this.tempMaskPixelCanvas.width = this.originalImageWidth;
                this.tempMaskPixelCanvas.height = this.originalImageHeight;
            }
            
            const generatedColors = this._generateDistinctColors(activePredictions.length);
            console.log('Generated colors:', generatedColors);

            activePredictions.forEach((predictionItem, index) => {
                console.log(`Processing prediction ${index}:`, predictionItem);
                const segmentation = predictionItem.segmentation; // segmentation is the 2D array
                if (!segmentation || segmentation.length === 0 || segmentation[0].length === 0) {
                    console.log(`Skipping prediction ${index}: no segmentation data`);
                    return;
                }

                const maskHeight = segmentation.length;    
                const maskWidth = segmentation[0].length; 
                console.log(`Mask ${index} dimensions: ${maskWidth}x${maskHeight}`);
                console.log(`Original image dimensions: ${this.originalImageWidth}x${this.originalImageHeight}`);

                if (maskHeight !== this.originalImageHeight || maskWidth !== this.originalImageWidth) {
                    console.warn("Mask dimensions do not match original image dimensions. Skipping a mask.");
                    return;
                }
                
                this.tempMaskPixelCtx.clearRect(0,0, maskWidth, maskHeight); 
                const imageData = this.tempMaskPixelCtx.createImageData(maskWidth, maskHeight);
                const pixelData = imageData.data;
                const colorStr = generatedColors[index % generatedColors.length];
                const [r, g, b, a_int] = this._parseRgbaFromString(colorStr); // a_int is 0-255
                console.log(`Using color for mask ${index}: rgba(${r},${g},${b},${a_int})`);

                let pixelCount = 0;
                for (let y = 0; y < maskHeight; y++) {
                    for (let x = 0; x < maskWidth; x++) {
                        if (segmentation[y][x] === 1 || segmentation[y][x] === true) { 
                            const pixelIndex = (y * maskWidth + x) * 4;
                            pixelData[pixelIndex] = r;
                            pixelData[pixelIndex + 1] = g;
                            pixelData[pixelIndex + 2] = b;
                            pixelData[pixelIndex + 3] = a_int; 
                            pixelCount++;
                        }
                    }
                }
                console.log(`Mask ${index} filled ${pixelCount} pixels`);
                
                if (pixelCount > 0) {
                    this.tempMaskPixelCtx.putImageData(imageData, 0, 0);
                    
                    this.offscreenPredictionCtx.drawImage(this.tempMaskPixelCanvas, 0, 0, 
                                                          this.offscreenPredictionCanvas.width, 
                                                          this.offscreenPredictionCanvas.height);
                    console.log(`Drew mask ${index} to offscreen canvas`);
                } else {
                    console.log(`Mask ${index} had no pixels to draw`);
                }
            });
        }

        this.predictionCtx.clearRect(0, 0, this.predictionMaskCanvas.width, this.predictionMaskCanvas.height);
        const opacity = parseFloat(this.predictionOpacitySlider.value);
        this.predictionCtx.globalAlpha = opacity;
        console.log('Prediction opacity:', opacity);
        this.predictionCtx.drawImage(this.offscreenPredictionCanvas, 0, 0);
        this.predictionCtx.globalAlpha = 1.0;
        console.log('=== drawPredictionMasks() completed ===');
    }

    async uploadImage(file) {
        console.log('=== uploadImage() called ===');
        console.log('File:', file);
        console.log('File name:', file.name);
        console.log('File size:', file.size);
        console.log('File type:', file.type);

        const formData = new FormData();
        formData.append('image', file);
        this.currentImageFilename = file.name;
        
        console.log('FormData created, showing canvas progress...');
        this.imageUploadProgressEl.style.display = 'block';
        this.imageUploadBarEl.style.width = '0%';
        this.imageUploadBarEl.textContent = '0%';
        this.lockCanvas("Uploading image...");

        try {
            console.log('Creating XMLHttpRequest...');
            const xhr = new XMLHttpRequest();
            
            xhr.upload.onprogress = (event) => {
                console.log('Upload progress event:', event);
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    console.log(`Upload progress: ${percentComplete}% (${event.loaded}/${event.total})`);
                    this.imageUploadBarEl.style.width = percentComplete + '%';
                    this.imageUploadBarEl.textContent = percentComplete + '%';
                } else {
                    console.log('Upload progress event not computable');
                }
            };

            xhr.upload.onloadstart = () => {
                console.log('Upload started');
            };

            xhr.upload.onload = () => {
                console.log('Upload completed');
            };

            xhr.upload.onerror = () => {
                console.log('Upload error');
            };

            xhr.onloadstart = () => {
                console.log('Request started');
            };

            xhr.onload = async () => {
                console.log('XMLHttpRequest onload triggered');
                console.log('Response status:', xhr.status);
                console.log('Response text length:', xhr.responseText ? xhr.responseText.length : 'null');
                
                this.unlockCanvas();
                this.imageUploadProgressEl.style.display = 'none';
                
                if (xhr.status === 200) {
                    console.log('Response status 200, parsing JSON...');
                    try {
                        const data = JSON.parse(xhr.responseText);
                        console.log('Parsed response data:', data);
                        
                        if (data.success) {
                            console.log('Upload successful, clearing inputs...');
                            this.clearAllInputs(true, true); 
                            
                            console.log('Creating new Image object...');
                            this.currentImage = new Image();
                            
                            this.currentImage.onload = () => {
                                console.log('Image onload triggered');
                                this.originalImageWidth = data.width;
                                this.originalImageHeight = data.height;
                                console.log('Image dimensions:', data.width, 'x', data.height);
                                this.drawImage(); 
                                this.dispatchEvent('imageLoaded', { filename: this.currentImageFilename });
                            };
                            
                            this.currentImage.onerror = (err) => {
                                console.error('Image loading error:', err);
                                this.dispatchEvent('error', { message: 'Failed to load image data from server response.' });
                            }
                            
                            console.log('Setting image src...');
                            this.currentImage.src = data.image_data; 
                            this.currentImageFilename = data.filename || file.name;
                        } else {
                            console.log('Upload failed:', data.error);
                            this.dispatchEvent('error', { message: 'Failed to upload image: ' + (data.error || "Unknown server error") });
                        }
                    } catch (parseError) {
                        console.error('JSON parse error:', parseError);
                        console.log('Raw response text:', xhr.responseText.substring(0, 500));
                        this.dispatchEvent('error', { message: 'Invalid response from server' });
                    }
                } else {
                    console.log('HTTP error status:', xhr.status, xhr.statusText);
                    this.dispatchEvent('error', { message: `Image upload failed: ${xhr.status} ${xhr.statusText || "Server error"}` });
                }
            };
            
            xhr.onerror = () => {
                console.log('XMLHttpRequest onerror triggered');
                this.unlockCanvas();
                this.imageUploadProgressEl.style.display = 'none';
                this.dispatchEvent('error', { message: 'Image upload error (network connection or server unavailable).' });
            };

            xhr.ontimeout = () => {
                console.log('XMLHttpRequest timeout');
                this.unlockCanvas();
                this.imageUploadProgressEl.style.display = 'none';
                this.dispatchEvent('error', { message: 'Image upload timeout.' });
            };

            console.log('Opening POST request to /api/upload_image...');
            xhr.open('POST', '/api/upload_image', true);
            xhr.timeout = 60000; // 60 second timeout
            
            console.log('Sending FormData...');
            xhr.send(formData);
            
        } catch (error) {
            console.error('Error in uploadImage:', error);
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
            } else if (isShift) {
                if (this.userBox &&
                    coords_orig.x >= this.userBox.x1 && coords_orig.x <= this.userBox.x2 &&
                    coords_orig.y >= this.userBox.y1 && coords_orig.y <= this.userBox.y2) {
                    this.userBox = null;
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
        tempCanvas.width = MASK_DIM; tempCanvas.height = MASK_DIM;
        tempCtx.fillStyle = 'black'; tempCtx.fillRect(0, 0, MASK_DIM, MASK_DIM);
        tempCtx.fillStyle = 'white';
        this.userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            tempCtx.beginPath();
            const firstP_orig = mask.points[0];
            tempCtx.moveTo((firstP_orig.x / this.originalImageWidth) * MASK_DIM, (firstP_orig.y / this.originalImageHeight) * MASK_DIM);
            for (let i = 1; i < mask.points.length; i++) {
                const p_orig = mask.points[i];
                tempCtx.lineTo((p_orig.x / this.originalImageWidth) * MASK_DIM, (p_orig.y / this.originalImageHeight) * MASK_DIM);
            }
            tempCtx.closePath(); tempCtx.fill();
        });
        const imageData = tempCtx.getImageData(0, 0, MASK_DIM, MASK_DIM);
        const data = imageData.data; this.combinedUserMaskInput256 = [];
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
            
            this.manualPredictions = []; 
            this.automaskPredictions = [];    

            this.drawUserInput(); 
            this.drawPredictionMasks(); 
        }

        if (clearImage) {
            this.currentImage = null;
            this.currentImageFilename = null;
            this.originalImageWidth = 0;
            this.originalImageHeight = 0;
            [this.imageCanvas, this.predictionMaskCanvas, this.userInputCanvas, 
             this.offscreenPredictionCanvas, this.offscreenUserCanvas, 
             this.tempMaskPixelCanvas].forEach(canvas => { 
                canvas.width = 300; canvas.height = 150;
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

    setManualPredictions(data) { 
        console.log('=== setManualPredictions() called ===');
        console.log('Input data:', data);
        
        this.manualPredictions = [];
        if (data && data.masks_data && data.scores && data.masks_data.length === data.scores.length) {
            console.log('Processing manual predictions with scores');
            this.manualPredictions = data.masks_data.map((seg, index) => ({
                segmentation: seg,
                score: data.scores[index]
            }));
            this.manualPredictions.sort((a, b) => b.score - a.score);
            console.log('Sorted manual predictions:', this.manualPredictions.length);
        } else if (data && data.masks_data) { 
            console.log('Processing manual predictions without scores');
             this.manualPredictions = data.masks_data.map(seg => ({
                segmentation: seg,
                score: 0 
            }));
            console.log('Manual predictions without scores:', this.manualPredictions.length);
        } else {
            console.log('No valid manual prediction data');
        }
        
        this.automaskPredictions = []; 
        console.log('Cleared automask predictions');
        console.log('Final manual predictions:', this.manualPredictions);
        this.drawPredictionMasks();
    }

    setAutomaskPredictions(data) { 
        console.log('=== setAutomaskPredictions() called ===');
        console.log('Input data:', data);
        
        this.automaskPredictions = (data && data.masks_data) ? data.masks_data : [];
        this.manualPredictions = []; 
        console.log('Set automask predictions count:', this.automaskPredictions.length);
        console.log('Cleared manual predictions');
        console.log('Sample automask prediction:', this.automaskPredictions[0]);
        this.drawPredictionMasks();
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

    lockCanvas(message) {
        if (this.canvasLockEl && this.canvasLockMessageEl) {
            this.canvasLockEl.style.display = 'block';
            this.canvasLockMessageEl.textContent = message || 'Processing...';
        } else {
            console.warn('Canvas lock elements not found');
        }
    }

    unlockCanvas() {
        if (this.canvasLockEl) {
            this.canvasLockEl.style.display = 'none';
        } else {
            console.warn('Canvas lock element not found');
        }
    }

    getRandomHexColor() {
        return '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.canvasManager = new CanvasManager();
});