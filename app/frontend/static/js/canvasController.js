// project_root/app/frontend/static/js/canvasController.js

/**
 * @file canvasController.js
 * @description Manages all aspects of the HTML5 canvas, including rendering layers,
 * user interactions, and coordinate transformations as per canvas_specification.md.
 *
 * Responsibilities:
 * - Initialize and manage multiple canvas layers (image, prediction mask, user input).
 * - Render the source image, AI-generated masks, and user-drawn inputs.
 * - Handle user interactions on the canvas (points, boxes, lasso/polygons).
 * - Perform coordinate transformations between display and original image space.
 * - Manage opacity for each canvas layer.
 * - Expose methods to set image data and prediction data.
 * - Emit events for user interactions and canvas state changes.
 *
 * External Dependencies: 
 * - utils.js (for Utils.debounce) - Assumed to be globally available as window.Utils
 *
 * Input/Output (I/O):
 * Input:
 *   - DOM Elements (IDs): image-canvas, prediction-mask-canvas, user-input-canvas,
 *                         image-opacity, prediction-opacity, user-input-opacity,
 *                         mask-display-mode, canvas-lock, canvas-lock-message.
 *   - Methods:
 *     - `loadImageOntoCanvas(imageElement, originalWidth, originalHeight, filename)`: To load and display an image.
 *     - `setManualPredictions(predictionData)`: To display masks from interactive predictions.
 *     - `setAutomaskPredictions(predictionData)`: To display masks from automatic generation.
 *     - `clearAllCanvasInputs(clearImageAlso)`: To clear inputs and optionally the image.
 *     - `lockCanvas(message)` / `unlockCanvas()`: To show/hide a loading overlay.
 *
 * Output:
 *   - Custom DOM Events:
 *     - `canvas-imageLoaded`: Dispatched when an image is successfully loaded and drawn.
 *                           Detail: { filename: string }
 *     - `canvas-userInteraction`: Dispatched after any user input on the canvas that might trigger a prediction.
 *                                Detail: { points: Array, box: Object, maskInput: Array|null }
 *     - `canvas-inputsCleared`: Dispatched when inputs (and optionally image) are cleared.
 *                               Detail: { clearedImage: boolean, clearedInputs: boolean }
 *     - `canvas-error`: Dispatched for canvas-specific errors.
 *                       Detail: { message: string }
 *     - `canvas-opacityChanged`: Dispatched when an opacity slider changes.
 *                                Detail: { layer: string, value: number }
 *   - Methods:
 *     - `getCurrentCanvasInputs()`: Returns current points, box, and combined user mask.
 */
class CanvasManager {
    constructor() {
        this.Utils = window.Utils || { debounce: (fn, delay) => fn }; // Fallback for Utils.debounce
        this.initializeElements();
        this.initializeState();
        this.initializeCanvases();
        this.setupEventListeners();
        this.setupOpacitySliders();
        console.log("CanvasManager initialized");
    }

    initializeElements() {
        this.imageCanvas = document.getElementById('image-canvas');
        this.predictionMaskCanvas = document.getElementById('prediction-mask-canvas');
        this.userInputCanvas = document.getElementById('user-input-canvas');

        // Fallback for contexts if canvases are not yet in DOM during tests or early init
        this.imageCtx = this.imageCanvas ? this.imageCanvas.getContext('2d') : null;
        this.predictionCtx = this.predictionMaskCanvas ? this.predictionMaskCanvas.getContext('2d', { willReadFrequently: true }) : null;
        this.userCtx = this.userInputCanvas ? this.userInputCanvas.getContext('2d') : null;

        this.maskDisplayModeSelect = document.getElementById('mask-display-mode');
        if (!this.maskDisplayModeSelect) {
            this.maskDisplayModeSelect = { value: 'best', addEventListener: () => {} };
        }

        this.imageOpacitySlider = document.getElementById('image-opacity');
        this.predictionOpacitySlider = document.getElementById('prediction-opacity');
        this.userInputOpacitySlider = document.getElementById('user-input-opacity');

        this.canvasLockEl = document.getElementById('canvas-lock');
        this.canvasLockMessageEl = this.canvasLockEl ? this.canvasLockEl.querySelector('.canvas-lock-message') : null;

        // Offscreen canvases for efficient rendering
        this.offscreenPredictionCanvas = document.createElement('canvas');
        this.offscreenPredictionCtx = this.offscreenPredictionCanvas.getContext('2d', { willReadFrequently: true });
        this.offscreenUserCanvas = document.createElement('canvas');
        this.offscreenUserCtx = this.offscreenUserCanvas.getContext('2d');

        // Temporary canvas for processing individual mask pixels before scaling
        this.tempMaskPixelCanvas = document.createElement('canvas');
        this.tempMaskPixelCtx = this.tempMaskPixelCanvas.getContext('2d', { willReadFrequently: true });
    }

    initializeState() {
        this.currentImage = null; // Will hold the Image object
        this.currentImageFilename = null;
        this.originalImageWidth = 0;
        this.originalImageHeight = 0;
        this.displayScale = 1.0; // Scale of original image to displayed image

        this.userPoints = []; // [{x, y, label}, ...] in original image coordinates
        this.userBox = null;  // {x1, y1, x2, y2} in original image coordinates
        this.userDrawnMasks = []; // [{points: [{x,y},...], color, id}, ...] polygons
        this.currentLassoPoints = []; // Temporary points for drawing lasso
        this.isDrawingLasso = false;
        this.combinedUserMaskInput256 = null; // 256x256 binary array for `mask_input`

        this.manualPredictions = []; // [{segmentation: [[0,1,...]], score: 0.9}, ...]
        this.automaskPredictions = []; // From AMG, same structure or raw AMG output

        this.interactionState = {
            isDrawingBox: false,
            isMouseDown: false,
            startX_orig: 0, // Mouse down start X in original image coordinates
            startY_orig: 0, // Mouse down start Y in original image coordinates
            didMove: false  // To distinguish click from drag
        };
    }

    initializeCanvases() {
        // Set initial placeholder size if canvases are present
        if (this.imageCanvas) this.resizeCanvases(300, 150); // Default placeholder size
    }

    setupOpacitySliders() {
        const sliders = [
            { el: this.imageOpacitySlider, layer: 'image', default: '1.0', action: () => this.drawImageLayer() },
            { el: this.predictionOpacitySlider, layer: 'prediction', default: '0.7', action: () => this.drawPredictionMaskLayer() },
            { el: this.userInputOpacitySlider, layer: 'userInput', default: '0.8', action: () => this.drawUserInputLayer() }
        ];

        sliders.forEach(item => {
            if (item.el) {
                item.el.min = '0';
                item.el.max = '1';
                item.el.step = '0.05';
                item.el.value = item.default;
                item.el.addEventListener('input', () => {
                    item.action();
                    this._dispatchEvent('opacityChanged', { layer: item.layer, value: parseFloat(item.el.value) });
                });
                // Dispatch initial opacity for UI consistency (e.g. value display spans)
                this._dispatchEvent('opacityChanged', { layer: item.layer, value: parseFloat(item.el.value) });
            }
        });
    }

    setupEventListeners() {
        if (this.userInputCanvas) {
            this.userInputCanvas.addEventListener('mousedown', (e) => this._handleMouseDown(e));
            this.userInputCanvas.addEventListener('mousemove', (e) => this._handleMouseMove(e));
            this.userInputCanvas.addEventListener('mouseup', (e) => this._handleMouseUp(e));
            this.userInputCanvas.addEventListener('mouseleave', (e) => this._handleMouseLeave(e));
            this.userInputCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        if (this.maskDisplayModeSelect) {
            this.maskDisplayModeSelect.addEventListener('change', () => this.drawPredictionMaskLayer());
        }
        
        // Debounce resize for performance
        this.debouncedResizeHandler = this.Utils.debounce(() => this._handleWindowResize(), 250);
        window.addEventListener('resize', this.debouncedResizeHandler);
    }

    _handleWindowResize() {
        // Debounce resize event if necessary
        if (this.currentImage && this.imageCanvas && this.imageCanvas.parentElement) {
            // Recalculate scale based on new parent dimensions and redraw
            this.drawImageLayer();
        }
    }

    resizeCanvases(width, height) {
        const canvases = [
            this.imageCanvas, this.predictionMaskCanvas, this.userInputCanvas,
            this.offscreenPredictionCanvas, this.offscreenUserCanvas
        ];
        canvases.forEach(canvas => {
            if (canvas) {
                canvas.width = width;
                canvas.height = height;
            }
        });
        // tempMaskPixelCanvas is sized based on original image, not display canvas size
        // It will be resized in drawPredictionMaskLayer if needed.
    }

    // --- Coordinate Transformation ---
    _displayToOriginalCoords(clientX, clientY) {
        if (!this.originalImageWidth || !this.originalImageHeight || !this.userInputCanvas ||
            this.userInputCanvas.width === 0 || this.userInputCanvas.height === 0) return { x: 0, y: 0 };

        const rect = this.userInputCanvas.getBoundingClientRect();
        // Normalize click coordinates to be relative to the canvas element
        const canvasX = (clientX - rect.left) * (this.userInputCanvas.width / rect.width);
        const canvasY = (clientY - rect.top) * (this.userInputCanvas.height / rect.height);

        // Scale canvas coordinates to original image coordinates
        return {
            x: canvasX / this.displayScale,
            y: canvasY / this.displayScale
        };
    }

    _originalToDisplayCoords(originalX, originalY) {
        if (!this.originalImageWidth || !this.originalImageHeight || !this.userInputCanvas ||
            this.userInputCanvas.width === 0 || this.userInputCanvas.height === 0) return { x: 0, y: 0 };
        return {
            x: originalX * this.displayScale,
            y: originalY * this.displayScale
        };
    }


    // --- Public Methods for External Control ---
    loadImageOntoCanvas(imageElement, originalWidth, originalHeight, filename) {
        if (!imageElement || !originalWidth || !originalHeight) {
            this._dispatchEvent('error', { message: 'Invalid image data provided to canvas.' });
            return;
        }
        this.currentImage = imageElement;
        this.originalImageWidth = originalWidth;
        this.originalImageHeight = originalHeight;
        this.currentImageFilename = filename;

        this.clearAllCanvasInputs(false); // Clear previous inputs/masks, but not the image itself
        this.drawImageLayer(); // This will resize canvases and draw the new image
        this._dispatchEvent('imageLoaded', { filename: this.currentImageFilename, width: this.originalImageWidth, height: this.originalImageHeight });
    }

    setManualPredictions(predictionData) {
        this.manualPredictions = [];
        if (predictionData && predictionData.masks_data && predictionData.scores &&
            predictionData.masks_data.length === predictionData.scores.length) {
            this.manualPredictions = predictionData.masks_data.map((seg, index) => ({
                segmentation: seg, // Expects 2D binary array
                score: predictionData.scores[index]
            })).sort((a, b) => b.score - a.score); // Sort by score descending
        } else if (predictionData && predictionData.masks_data) { // Scores optional
             this.manualPredictions = predictionData.masks_data.map(seg => ({
                segmentation: seg, score: 0 // Default score
            }));
        }
        this.automaskPredictions = []; // Clear automasks when manual predictions come in
        this.drawPredictionMaskLayer();
    }

    setAutomaskPredictions(predictionData) { // predictionData is { masks_data: [{segmentation, area, ...}], count: ... }
        this.automaskPredictions = (predictionData && predictionData.masks_data) ? predictionData.masks_data : [];
        this.manualPredictions = []; // Clear manual predictions
        this.drawPredictionMaskLayer();
    }

    clearAllCanvasInputs(clearImageAlso = false) {
        this.userPoints = [];
        this.userBox = null;
        this.userDrawnMasks = [];
        this.currentLassoPoints = [];
        this.isDrawingLasso = false;
        this.combinedUserMaskInput256 = null;

        this.manualPredictions = [];
        this.automaskPredictions = [];

        this.drawUserInputLayer();
        this.drawPredictionMaskLayer();

        let eventDetail = { clearedImage: false, clearedInputs: true };

        if (clearImageAlso) {
            this.currentImage = null;
            this.currentImageFilename = null;
            this.originalImageWidth = 0;
            this.originalImageHeight = 0;
            this.displayScale = 1.0;
            // Reset canvases to placeholder size and clear them
            this.resizeCanvases(300, 150); // Placeholder size
             [this.imageCtx, this.predictionCtx, this.userCtx,
             this.offscreenPredictionCtx, this.offscreenUserCtx,
             this.tempMaskPixelCtx].forEach(ctx => {
                if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            });
            eventDetail.clearedImage = true;
        }
        this._dispatchEvent('inputsCleared', eventDetail);
    }

    getCurrentCanvasInputs() {
        return {
            points: this.userPoints, // Array of {x, y, label} in original coords
            box: this.userBox,       // {x1, y1, x2, y2} in original coords or null
            maskInput: this.combinedUserMaskInput256, // 256x256 array or null
            imagePresent: !!this.currentImage,
            filename: this.currentImageFilename,
            originalWidth: this.originalImageWidth,
            originalHeight: this.originalImageHeight
        };
    }

    drawImageLayer() {
        if (!this.currentImage || !this.imageCtx || !this.imageCanvas.parentElement) return;

        const displayArea = this.imageCanvas.parentElement;
        const areaWidth = displayArea.clientWidth;
        const areaHeight = displayArea.clientHeight;

        // Calculate scale to fit image within parent while maintaining aspect ratio
        const hRatio = areaWidth / this.originalImageWidth;
        const vRatio = areaHeight / this.originalImageHeight;
        this.displayScale = Math.min(hRatio, vRatio, 1.0); // Don't scale up beyond 100% unless image is smaller than area

        const displayWidth = Math.round(this.originalImageWidth * this.displayScale);
        const displayHeight = Math.round(this.originalImageHeight * this.displayScale);

        if (this.imageCanvas.width !== displayWidth || this.imageCanvas.height !== displayHeight) {
            this.resizeCanvases(displayWidth, displayHeight);
        }

        this.imageCtx.clearRect(0, 0, displayWidth, displayHeight);
        this.imageCtx.globalAlpha = this.imageOpacitySlider ? parseFloat(this.imageOpacitySlider.value) : 1.0;
        this.imageCtx.drawImage(this.currentImage, 0, 0, displayWidth, displayHeight);
        this.imageCtx.globalAlpha = 1.0;

        // Redraw other layers as their display depends on image size/scale
        this.drawUserInputLayer();
        this.drawPredictionMaskLayer();
    }

    drawUserInputLayer() {
        if (!this.currentImage || !this.userCtx || !this.offscreenUserCtx ||
            this.offscreenUserCanvas.width === 0 || this.offscreenUserCanvas.height === 0) {
            if(this.userCtx) this.userCtx.clearRect(0, 0, this.userCtx.canvas.width, this.userCtx.canvas.height);
            return;
        }

        this.offscreenUserCtx.clearRect(0, 0, this.offscreenUserCanvas.width, this.offscreenUserCanvas.height);

        const pointDisplayRadius = Math.max(2, 5 * this.displayScale); // Scale point radius slightly
        const lineDisplayWidth = Math.max(1, 2 * this.displayScale); // Scale line width

        // Draw drawn polygons (lassos)
        this.userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            this.offscreenUserCtx.beginPath();
            const firstP_disp = this._originalToDisplayCoords(mask.points[0].x, mask.points[0].y);
            this.offscreenUserCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < mask.points.length; i++) {
                const p_disp = this._originalToDisplayCoords(mask.points[i].x, mask.points[i].y);
                this.offscreenUserCtx.lineTo(p_disp.x, p_disp.y);
            }
            this.offscreenUserCtx.closePath();
            this.offscreenUserCtx.fillStyle = mask.color || 'rgba(255, 255, 0, 0.35)';
            this.offscreenUserCtx.fill();
            this.offscreenUserCtx.strokeStyle = 'rgba(255,255,255,0.8)';
            this.offscreenUserCtx.lineWidth = Math.max(1, 1.5 * this.displayScale);
            this.offscreenUserCtx.stroke();
        });

        // Draw current lasso drawing in progress
        if (this.isDrawingLasso && this.currentLassoPoints.length > 0) {
            this.offscreenUserCtx.beginPath();
            const firstP_disp = this._originalToDisplayCoords(this.currentLassoPoints[0].x, this.currentLassoPoints[0].y);
            this.offscreenUserCtx.moveTo(firstP_disp.x, firstP_disp.y);
            for (let i = 1; i < this.currentLassoPoints.length; i++) {
                const p_disp = this._originalToDisplayCoords(this.currentLassoPoints[i].x, this.currentLassoPoints[i].y);
                this.offscreenUserCtx.lineTo(p_disp.x, p_disp.y);
            }
            this.offscreenUserCtx.strokeStyle = 'rgba(255, 223, 0, 0.95)';
            this.offscreenUserCtx.lineWidth = lineDisplayWidth;
            this.offscreenUserCtx.stroke();
        }

        // Draw points
        this.userPoints.forEach(p_orig => {
            const dp = this._originalToDisplayCoords(p_orig.x, p_orig.y);
            this.offscreenUserCtx.beginPath();
            this.offscreenUserCtx.arc(dp.x, dp.y, pointDisplayRadius, 0, 2 * Math.PI);
            this.offscreenUserCtx.fillStyle = p_orig.label === 1 ? 'rgba(50, 205, 50, 0.8)' : 'rgba(255, 69, 0, 0.8)'; // LimeGreen/OrangeRed
            this.offscreenUserCtx.fill();
            this.offscreenUserCtx.strokeStyle = 'rgba(255,255,255,0.95)';
            this.offscreenUserCtx.lineWidth = Math.max(1, lineDisplayWidth * 0.4);
            this.offscreenUserCtx.stroke();
        });

        // Draw box
        if (this.userBox) {
            const db1 = this._originalToDisplayCoords(this.userBox.x1, this.userBox.y1);
            const db2 = this._originalToDisplayCoords(this.userBox.x2, this.userBox.y2);
            this.offscreenUserCtx.strokeStyle = 'rgba(30, 144, 255, 0.85)'; // DodgerBlue
            this.offscreenUserCtx.lineWidth = lineDisplayWidth;
            this.offscreenUserCtx.strokeRect(db1.x, db1.y, db2.x - db1.x, db2.y - db1.y);
            // Add white outline for contrast
            this.offscreenUserCtx.strokeStyle = 'rgba(255,255,255,0.8)';
            this.offscreenUserCtx.lineWidth = Math.max(1, lineDisplayWidth * 0.4);
            this.offscreenUserCtx.strokeRect(db1.x, db1.y, db2.x - db1.x, db2.y - db1.y);
        }

        // Composite to visible canvas
        this.userCtx.clearRect(0, 0, this.userInputCanvas.width, this.userInputCanvas.height);
        this.userCtx.globalAlpha = this.userInputOpacitySlider ? parseFloat(this.userInputOpacitySlider.value) : 0.8;
        this.userCtx.drawImage(this.offscreenUserCanvas, 0, 0);
        this.userCtx.globalAlpha = 1.0;
    }

    drawPredictionMaskLayer() {
        if (!this.currentImage || !this.predictionCtx || !this.offscreenPredictionCtx ||
            this.offscreenPredictionCanvas.width === 0 || this.offscreenPredictionCanvas.height === 0) {
            if(this.predictionCtx) this.predictionCtx.clearRect(0, 0, this.predictionCtx.canvas.width, this.predictionCtx.canvas.height);
            return;
        }

        this.offscreenPredictionCtx.clearRect(0, 0, this.offscreenPredictionCanvas.width, this.offscreenPredictionCanvas.height);

        let activePredictions = [];
        // Determine which set of predictions to use (automask or manual)
        if (this.automaskPredictions && this.automaskPredictions.length > 0) {
            activePredictions = this.automaskPredictions;
        } else if (this.manualPredictions && this.manualPredictions.length > 0) {
            const mode = this.maskDisplayModeSelect ? this.maskDisplayModeSelect.value : 'best';
            if (mode === 'best' && this.manualPredictions[0]) { // Assumes manualPredictions are sorted by score
                activePredictions.push(this.manualPredictions[0]);
            } else if (mode === 'all') {
                activePredictions = this.manualPredictions;
            } else { // Default or unknown mode
                if(this.manualPredictions[0]) activePredictions.push(this.manualPredictions[0]);
            }
        }

        if (activePredictions.length > 0) {
            // Ensure tempMaskPixelCanvas is sized to the original image dimensions
            if (this.tempMaskPixelCanvas.width !== this.originalImageWidth || this.tempMaskPixelCanvas.height !== this.originalImageHeight) {
                this.tempMaskPixelCanvas.width = this.originalImageWidth;
                this.tempMaskPixelCanvas.height = this.originalImageHeight;
            }

            const generatedColors = this._generateDistinctColors(activePredictions.length);

            activePredictions.forEach((predictionItem, index) => {
                // predictionItem is {segmentation: [[0,1,...]], score: 0.9, ...} or from AMG: {segmentation, area, bbox, ...}
                const segmentation = predictionItem.segmentation;
                if (!segmentation || segmentation.length === 0 || !segmentation[0] || segmentation[0].length === 0) return; // Skip if no valid segmentation

                const maskHeight = segmentation.length;
                const maskWidth = segmentation[0].length;

                if (maskHeight !== this.originalImageHeight || maskWidth !== this.originalImageWidth) {
                    console.warn("Mask dimensions mismatch. Mask:", maskWidth+"x"+maskHeight, "Img:", this.originalImageWidth+"x"+this.originalImageHeight);
                    return;
                }

                this.tempMaskPixelCtx.clearRect(0, 0, maskWidth, maskHeight);
                const imageData = this.tempMaskPixelCtx.createImageData(maskWidth, maskHeight);
                const pixelData = imageData.data;
                const colorStr = generatedColors[index % generatedColors.length];
                const [r, g, b, a_int] = this._parseRgbaFromString(colorStr);

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

                if (pixelCount > 0) {
                    this.tempMaskPixelCtx.putImageData(imageData, 0, 0);
                    // Draw the processed mask (at original resolution) onto the offscreen canvas,
                    // scaling it down to the display size.
                    this.offscreenPredictionCtx.drawImage(this.tempMaskPixelCanvas, 0, 0,
                                                          this.offscreenPredictionCanvas.width,
                                                          this.offscreenPredictionCanvas.height);
                }
            });
        }

        // Composite to visible prediction canvas
        this.predictionCtx.clearRect(0, 0, this.predictionMaskCanvas.width, this.predictionMaskCanvas.height);
        const opacity = this.predictionOpacitySlider ? parseFloat(this.predictionOpacitySlider.value) : 0.7;
        this.predictionCtx.globalAlpha = opacity;
        this.predictionCtx.drawImage(this.offscreenPredictionCanvas, 0, 0);
        this.predictionCtx.globalAlpha = 1.0;
    }

    // --- User Interaction Handlers ---
    _handleMouseDown(e) {
        if (!this.currentImage || (this.canvasLockEl && this.canvasLockEl.style.display !== 'none')) return;
        this.interactionState.isMouseDown = true;
        this.interactionState.didMove = false;
        const origCoords = this._displayToOriginalCoords(e.clientX, e.clientY);
        this.interactionState.startX_orig = origCoords.x;
        this.interactionState.startY_orig = origCoords.y;

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey; // Meta for Mac Cmd key

        if (isCtrl) { // Lasso tool
            this.isDrawingLasso = true;
            this.currentLassoPoints = [origCoords];
        } else if (isShift) { // Box tool
            this.interactionState.isDrawingBox = true;
            this.userBox = null; // Clear previous box or start new one
        }
        e.preventDefault();
    }

    _handleMouseMove(e) {
        if (!this.currentImage || !this.interactionState.isMouseDown || (this.canvasLockEl && this.canvasLockEl.style.display !== 'none')) return;
        this.interactionState.didMove = true;
        const currentCoords_orig = this._displayToOriginalCoords(e.clientX, e.clientY);

        if (this.interactionState.isDrawingBox) {
            this.userBox = {
                x1: Math.min(this.interactionState.startX_orig, currentCoords_orig.x),
                y1: Math.min(this.interactionState.startY_orig, currentCoords_orig.y),
                x2: Math.max(this.interactionState.startX_orig, currentCoords_orig.x),
                y2: Math.max(this.interactionState.startY_orig, currentCoords_orig.y),
            };
            this.drawUserInputLayer();
        } else if (this.isDrawingLasso) {
            this.currentLassoPoints.push(currentCoords_orig);
            this.drawUserInputLayer(); // Redraw user input layer to show lasso path
        }
    }

    _handleMouseUp(e) {
        if (!this.currentImage || !this.interactionState.isMouseDown || (this.canvasLockEl && this.canvasLockEl.style.display !== 'none')) return;
        const coords_orig = this._displayToOriginalCoords(e.clientX, e.clientY);
        const pointDisplayRadius = Math.max(3, 6 * this.displayScale); // Visual radius on canvas
        const clickThresholdOrig = pointDisplayRadius / this.displayScale * 1.5; // Make click threshold slightly larger than visual radius

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;
        let interactionHandledOnUp = false; // Flag to check if specific tool action (box/lasso finish) was taken

        if (this.interactionState.isDrawingBox) {
            if (this.userBox && (this.userBox.x2 - this.userBox.x1 < clickThresholdOrig || this.userBox.y2 - this.userBox.y1 < clickThresholdOrig)) {
                this.userBox = null; // Discard tiny box (likely a shift-click)
            }
            interactionHandledOnUp = true;
        } else if (this.isDrawingLasso) {
            if (this.currentLassoPoints.length > 2) { // Need at least 3 points for a polygon
                this.userDrawnMasks.push({
                    points: [...this.currentLassoPoints],
                    color: `${this._getRandomHexColor()}7A`, // 40-50% alpha
                    id: Date.now()
                });
                this._prepareCombinedUserMaskInput(); // Update the 256x256 mask_input
            }
            interactionHandledOnUp = true;
        }

        // Handle clicks (if no drag or if tool action didn't consume the click)
        if (!this.interactionState.didMove || (!interactionHandledOnUp && !this.isDrawingLasso && !this.interactionState.isDrawingBox)) {
            if (isCtrl) { // Ctrl-click to remove lasso/polygon
                let removedMask = false;
                for (let i = this.userDrawnMasks.length - 1; i >= 0; i--) {
                    if (this._isPointInPolygon(coords_orig, this.userDrawnMasks[i].points)) {
                        this.userDrawnMasks.splice(i, 1);
                        removedMask = true;
                        break;
                    }
                }
                if (removedMask) this._prepareCombinedUserMaskInput();
            } else if (isShift) { // Shift-click (without drag) to remove box under cursor
                if (this.userBox &&
                    coords_orig.x >= this.userBox.x1 && coords_orig.x <= this.userBox.x2 &&
                    coords_orig.y >= this.userBox.y1 && coords_orig.y <= this.userBox.y2) {
                    this.userBox = null;
                }
            } else { // Normal click for points
                const label = e.button === 0 ? 1 : 0; // Left click = positive (1), Right click = negative (0)
                let removedPoint = false;
                // Check if clicking on an existing point to remove it
                for (let i = this.userPoints.length - 1; i >= 0; i--) {
                    const p_orig = this.userPoints[i];
                    const dist = Math.sqrt(Math.pow(p_orig.x - coords_orig.x, 2) + Math.pow(p_orig.y - coords_orig.y, 2));
                    if (dist < clickThresholdOrig) {
                        this.userPoints.splice(i, 1);
                        removedPoint = true;
                        break;
                    }
                }
                if (!removedPoint) { // If not removing, add new point
                    this.userPoints.push({ x: coords_orig.x, y: coords_orig.y, label: label });
                }
            }
        }

        // Reset drawing states
        this.isDrawingLasso = false;
        this.currentLassoPoints = [];
        this.interactionState.isDrawingBox = false;
        this.interactionState.isMouseDown = false;
        this.interactionState.didMove = false;

        this.drawUserInputLayer();
        this._dispatchEvent('userInteraction', this.getCurrentCanvasInputs());
    }

    _handleMouseLeave(e) {
        if (this.interactionState.isMouseDown && (this.canvasLockEl && this.canvasLockEl.style.display === 'none')) {
            this._handleMouseUp(e);
        }
    }


    // --- Utility Methods ---
    _generateDistinctColors(count) {
        const colors = [];
        if (count === 0) return colors;
        for (let i = 0; i < count; i++) {
            const hue = (i * (360 / (count < 6 ? count * 1.6 : count * 1.1))) % 360; // Adjusted factor for better spread with few items
            const saturation = 65 + Math.random() * 25;
            const lightness = 50 + Math.random() * 15;
            colors.push(`hsla(${hue}, ${saturation}%, ${lightness}%, 0.65)`); // Slightly less alpha
        }
        return colors;
    }

    _parseRgbaFromString(colorStr) { // Handles HSL(A) or RGB(A)
        if (typeof colorStr !== 'string') return [255,0,0,178]; // Fallback if not string

        if (colorStr.startsWith('hsl')) { // Convert HSL(A) to RGB(A)
            const match = colorStr.match(/hsla?\((\d+),\s*([\d.]+)%?,\s*([\d.]+)%?(?:,\s*([\d.]+))?\)/);
            if (!match) return [255,0,0,178];
            let [h, s, l, a] = match.slice(1).map(parseFloat);
            if (isNaN(a)) a = 1;
            s /= 100; l /= 100;
            const k = n => (n + h / 30) % 12;
            const calc_a_val = s * Math.min(l, 1 - l); // Renamed calc_a to avoid conflict
            const f = n => l - calc_a_val * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
            return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4)), Math.round(a * 255)];
        } else if (colorStr.startsWith('rgb')) {
            const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (!match) return [255, 0, 0, 178];
            return [
                parseInt(match[1]), parseInt(match[2]), parseInt(match[3]),
                match[4] !== undefined ? Math.round(parseFloat(match[4]) * 255) : 255
            ];
        }
        return [255, 0, 0, 178]; // Fallback red if format unknown
    }

    _isPointInPolygon(point, polygonPoints) {
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

    _prepareCombinedUserMaskInput() {
        // Creates a 256x256 binary mask from `this.userDrawnMasks`
        if (this.userDrawnMasks.length === 0 || !this.originalImageWidth || !this.originalImageHeight) {
            this.combinedUserMaskInput256 = null;
            return;
        }

        const MASK_DIM = 256;
        // Use an offscreen canvas for this operation if not already using one
        const tempMaskCanvas = document.createElement('canvas');
        const tempMaskCtx = tempMaskCanvas.getContext('2d');
        tempMaskCanvas.width = MASK_DIM;
        tempMaskCanvas.height = MASK_DIM;

        // Fill with black (0)
        tempMaskCtx.fillStyle = 'black';
        tempMaskCtx.fillRect(0, 0, MASK_DIM, MASK_DIM);

        // Draw each user polygon in white (1)
        tempMaskCtx.fillStyle = 'white';
        this.userDrawnMasks.forEach(mask => {
            if (mask.points.length < 3) return;
            tempMaskCtx.beginPath();
            const firstP_orig = mask.points[0];
            // Scale points from original image coordinates to 256x256 mask coordinates
            tempMaskCtx.moveTo(
                (firstP_orig.x / this.originalImageWidth) * MASK_DIM,
                (firstP_orig.y / this.originalImageHeight) * MASK_DIM
            );
            for (let i = 1; i < mask.points.length; i++) {
                const p_orig = mask.points[i];
                tempMaskCtx.lineTo(
                    (p_orig.x / this.originalImageWidth) * MASK_DIM,
                    (p_orig.y / this.originalImageHeight) * MASK_DIM
                );
            }
            tempMaskCtx.closePath();
            tempMaskCtx.fill();
        });

        // Read pixel data and convert to binary array
        const imageData = tempMaskCtx.getImageData(0, 0, MASK_DIM, MASK_DIM);
        const data = imageData.data;
        this.combinedUserMaskInput256 = [];
        for (let r = 0; r < MASK_DIM; r++) {
            const row = [];
            for (let c = 0; c < MASK_DIM; c++) {
                const idx = (r * MASK_DIM + c) * 4;
                // Check R channel; if > 128, it's white (1), else black (0)
                row.push(data[idx] > 128 ? 1.0 : 0.0);
            }
            this.combinedUserMaskInput256.push(row);
        }
    }

    _getRandomHexColor() {
        return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    }

    _dispatchEvent(eventType, data) {
        // console.log(`Canvas dispatching: canvas-${eventType}`, data);
        const event = new CustomEvent(`canvas-${eventType}`, { detail: data });
        document.dispatchEvent(event);
    }

    // Public method to allow external modules to listen to canvas events
    addEventListener(eventType, callback) {
        document.addEventListener(`canvas-${eventType}`, callback);
    }

    lockCanvas(message = 'Processing...') {
        if (this.canvasLockEl) {
            this.canvasLockEl.style.display = 'flex'; // Use flex for centering
            if (this.canvasLockMessageEl) this.canvasLockMessageEl.textContent = message;
        }
    }

    unlockCanvas() {
        if (this.canvasLockEl) {
            this.canvasLockEl.style.display = 'none';
        }
    }
}

// Instantiation handled by main.js