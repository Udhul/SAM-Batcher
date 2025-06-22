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
const FADED_MASK_OPACITY = 0.33; // opacity used for faded layers

class CanvasManager {
    constructor() {
        this.Utils = window.Utils || {
            debounce: (fn, delay) => fn,
            generateDistinctColors: (count) => Array(count || 1).fill('rgba(255,0,0,1.0)'),
            getRandomHexColor: () => '#FF0000'
        };
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

        this.maskToggleContainer = document.getElementById('mask-toggle-container');

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
        this.userBoxes = [];  // Array of {x1, y1, x2, y2} boxes
        this.currentBox = null; // Box being drawn
        this.userDrawnMasks = []; // [{points: [{x,y},...], color, id}, ...] polygons
        this.currentLassoPoints = []; // Temporary points for drawing lasso
        this.isDrawingLasso = false;
        this.combinedUserMaskInput256 = null; // 256x256 binary array for `mask_input`

        this.manualPredictions = []; // [{segmentation: [[0,1,...]], score: 0.9}, ...]
        this.automaskPredictions = []; // From AMG, same structure or raw AMG output

        this.currentPredictionMultiBox = false;
        this.selectedManualMaskIndex = 0;

        this.layers = []; // [{layerId, maskData, visible, color}]
        this.selectedLayerIds = [];
        this.mode = 'edit'; // 'creation', 'edit', 'review'

        this.editingLayerId = null;
        this.editingMask = null;
        this.editingColor = '#ff0000';

        this.interactionState = {
            isDrawingBox: false,
            isMouseDown: false,
            startX_orig: 0, // Mouse down start X in original image coordinates
            startY_orig: 0, // Mouse down start Y in original image coordinates
            didMove: false  // To distinguish click from drag
        };

        this.transform = {
            scale: 1,
            panX: 0,
            panY: 0
        };
        this.isPanning = false;
    }

    initializeCanvases() {
        // Set initial placeholder size if canvases are present
        if (this.imageCanvas) this.resizeCanvases(300, 150); // Default placeholder size
    }

    setupOpacitySliders() {
        const sliders = [
            { el: this.imageOpacitySlider, layer: 'image', default: '1.0', action: () => this.drawImageLayer() },
            { el: this.predictionOpacitySlider, layer: 'prediction', default: '0.7', action: () => this.drawPredictionMaskLayer() },
            { el: this.userInputOpacitySlider, layer: 'user-input', default: '0.8', action: () => this.drawUserInputLayer() }
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
            this.userInputCanvas.addEventListener('wheel', (e) => this._handleWheel(e), { passive: false });
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

    applyCanvasTransform() {
        const t = `translate(${this.transform.panX}px, ${this.transform.panY}px) scale(${this.transform.scale})`;
        [this.imageCanvas, this.predictionMaskCanvas, this.userInputCanvas].forEach(c => {
            if (c) {
                c.style.transformOrigin = 'top left';
                c.style.transform = t;
            }
        });
        this._dispatchEvent('zoom-pan-changed', { scale: this.transform.scale, panX: this.transform.panX, panY: this.transform.panY });
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

    getZoomedDisplayScale() {
        return this.displayScale * this.transform.scale;
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
        this.transform = { scale: 1, panX: 0, panY: 0 };
        this.applyCanvasTransform();
        this.drawImageLayer(); // This will resize canvases and draw the new image
        this._dispatchEvent('imageLoaded', { filename: this.currentImageFilename, width: this.originalImageWidth, height: this.originalImageHeight });
    }

    setManualPredictions(predictionData) {
        this.manualPredictions = [];
        this.currentPredictionMultiBox = false;
        if (predictionData && predictionData.masks_data) {
            const unwrap = arr => { let r = arr; while (Array.isArray(r) && r.length === 1) r = r[0]; return r; };
            let maskList = unwrap(predictionData.masks_data);
            if (!Array.isArray(maskList[0]) || (Array.isArray(maskList[0]) && !Array.isArray(maskList[0][0]))) {
                maskList = [maskList];
            } else {
                maskList = maskList.map(m => unwrap(m));
            }

            let scoreList = [];
            if (predictionData.scores) {
                scoreList = unwrap(predictionData.scores);
                if (!Array.isArray(scoreList)) scoreList = [scoreList];
                while (Array.isArray(scoreList[0])) scoreList = scoreList.flat();
            }

            let preds = maskList.map((seg, index) => ({
                segmentation: seg,
                score: scoreList[index] !== undefined ? scoreList[index] : (scoreList[0] || 0)
            }));

            const multiBox = predictionData && !predictionData.multimask_output && predictionData.num_boxes > 1;
            this.currentPredictionMultiBox = multiBox;
            if (!multiBox) {
                preds.sort((a, b) => b.score - a.score);
            }

            const defaultColor = 'rgba(255,0,0,1.0)';

            if (multiBox) {
                this.manualPredictions = preds.map((p) => ({ ...p, visible: true, color: defaultColor }));
                this.selectedManualMaskIndex = 0;
            } else {
                if (this.selectedManualMaskIndex >= preds.length) this.selectedManualMaskIndex = 0;
                this.manualPredictions = preds.map((p, i) => ({ ...p, visible: i === this.selectedManualMaskIndex, color: defaultColor }));
            }

            this.renderMaskToggleControls();
        }
        this.automaskPredictions = []; // Clear automasks when manual predictions come in
        this.setMode('creation');
    }

    setAutomaskPredictions(predictionData) { // predictionData is { masks_data: [{segmentation, area, ...}], count: ... }
        if (predictionData && predictionData.masks_data) {
            const colors = this.Utils.generateDistinctColors(predictionData.masks_data.length);
            this.automaskPredictions = predictionData.masks_data.map((m, i) => ({ ...m, visible: true, color: colors[i] }));
        } else {
            this.automaskPredictions = [];
        }
        this.manualPredictions = []; // Clear manual predictions
        this.currentPredictionMultiBox = false;
        this.selectedManualMaskIndex = 0;
        this.renderMaskToggleControls();
        this.setMode('creation');
    }

    clearAllCanvasInputs(clearImageAlso = false) {
        this.userPoints = [];
        this.userBoxes = [];
        this.currentBox = null;
        this.userDrawnMasks = [];
        this.currentLassoPoints = [];
        this.isDrawingLasso = false;
        this.combinedUserMaskInput256 = null;

        this.manualPredictions = [];
        this.automaskPredictions = [];
        this.currentPredictionMultiBox = false;
        this.selectedManualMaskIndex = 0;

        this.renderMaskToggleControls();

        this.drawUserInputLayer();
        this.drawPredictionMaskLayer();

        let eventDetail = { clearedImage: false, clearedInputs: true };

        if (clearImageAlso) {
            this.currentImage = null;
            this.currentImageFilename = null;
            this.originalImageWidth = 0;
            this.originalImageHeight = 0;
            this.displayScale = 1.0;
            this.transform = { scale: 1, panX: 0, panY: 0 };
            this.applyCanvasTransform();
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
            boxes: this.userBoxes,       // Array of boxes in original coords
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
        let areaWidth = displayArea.clientWidth;
        let areaHeight = displayArea.clientHeight;

        if (areaWidth === 0 || areaHeight === 0) {
            const rect = displayArea.getBoundingClientRect();
            if (areaWidth === 0) {
                areaWidth = rect.width || this.originalImageWidth;
            }
            if (areaHeight === 0) {
                areaHeight = rect.height || (areaWidth * (this.originalImageHeight / this.originalImageWidth));
            }
        }

        if (areaWidth === 0) areaWidth = this.originalImageWidth;
        if (areaHeight === 0) areaHeight = areaWidth * (this.originalImageHeight / this.originalImageWidth);

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
        this._clampPan();
        this.applyCanvasTransform();
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

        // Draw boxes
        [...this.userBoxes, this.currentBox].forEach(box => {
            if (!box) return;
            const db1 = this._originalToDisplayCoords(box.x1, box.y1);
            const db2 = this._originalToDisplayCoords(box.x2, box.y2);
            this.offscreenUserCtx.strokeStyle = 'rgba(30, 144, 255, 0.85)'; // DodgerBlue
            this.offscreenUserCtx.lineWidth = lineDisplayWidth;
            this.offscreenUserCtx.strokeRect(db1.x, db1.y, db2.x - db1.x, db2.y - db1.y);
            // Add white outline for contrast
            this.offscreenUserCtx.strokeStyle = 'rgba(255,255,255,0.8)';
            this.offscreenUserCtx.lineWidth = Math.max(1, lineDisplayWidth * 0.4);
            this.offscreenUserCtx.strokeRect(db1.x, db1.y, db2.x - db1.x, db2.y - db1.y);
        });

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

        const visibleLayers = (this.layers || []).filter(l => l.visible);
        if (visibleLayers.length > 0) {
            visibleLayers.forEach(l => {
                let op = 1.0;
                if (this.mode === 'creation') {
                    op = FADED_MASK_OPACITY;
                } else if (this.mode === 'edit' && this.selectedLayerIds.length > 0) {
                    op = this.selectedLayerIds.includes(l.layerId) ? 1.0 : FADED_MASK_OPACITY;
                }
                const mask = (this.editingLayerId && l.layerId === this.editingLayerId && this.editingMask)
                    ? this.editingMask
                    : l.maskData;
                const color = (this.editingLayerId && l.layerId === this.editingLayerId)
                    ? this.editingColor
                    : l.color;
                if (mask) this._drawBinaryMask(mask, color, op);
            });
        }

        let activePredictions = [];
        if (this.automaskPredictions && this.automaskPredictions.length > 0) {
            activePredictions = this.automaskPredictions.filter(m => m.visible);
        } else if (this.manualPredictions && this.manualPredictions.length > 0) {
            activePredictions = this.manualPredictions.filter(m => m.visible);
        }

        if (activePredictions.length > 0) {
            // Ensure tempMaskPixelCanvas is sized to the original image dimensions
            if (this.tempMaskPixelCanvas.width !== this.originalImageWidth || this.tempMaskPixelCanvas.height !== this.originalImageHeight) {
                this.tempMaskPixelCanvas.width = this.originalImageWidth;
                this.tempMaskPixelCanvas.height = this.originalImageHeight;
            }

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
                const colorStr = predictionItem.color || this.Utils.generateDistinctColors(1)[0];
                const [r, g, b, a_int] = this._parseRgbaFromString(colorStr);

                let pixelCount = 0;
                for (let y = 0; y < maskHeight; y++) {
                    for (let x = 0; x < maskWidth; x++) {
                        if (segmentation[y][x]) {
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
        if (e.button === 1) {
            this._startPan(e);
            e.preventDefault();
            return;
        }
        if (this.mode !== 'creation') return;
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
            this.currentBox = null;
        }
        e.preventDefault();
    }

    _handleMouseMove(e) {
        if (this.isPanning) {
            this._movePan(e);
            return;
        }
        if (!this.currentImage || this.mode !== 'creation' || !this.interactionState.isMouseDown || (this.canvasLockEl && this.canvasLockEl.style.display !== 'none')) return;
        this.interactionState.didMove = true;
        const currentCoords_orig = this._displayToOriginalCoords(e.clientX, e.clientY);

        if (this.interactionState.isDrawingBox) {
            this.currentBox = {
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
        if (e.button === 1 && this.isPanning) {
            this._endPan();
            return;
        }
        if (!this.currentImage || this.mode !== 'creation' || !this.interactionState.isMouseDown || (this.canvasLockEl && this.canvasLockEl.style.display !== 'none')) return;
        const coords_orig = this._displayToOriginalCoords(e.clientX, e.clientY);
        const pointDisplayRadius = Math.max(3, 6 * this.displayScale); // Visual radius on canvas
        const clickThresholdOrig = pointDisplayRadius / this.displayScale * 1.5; // Make click threshold slightly larger than visual radius

        const isShift = e.shiftKey;
        const isCtrl = e.ctrlKey || e.metaKey;
        let interactionHandledOnUp = false; // Flag to check if specific tool action (box/lasso finish) was taken

        if (this.interactionState.isDrawingBox) {
            if (this.currentBox && (this.currentBox.x2 - this.currentBox.x1 < clickThresholdOrig || this.currentBox.y2 - this.currentBox.y1 < clickThresholdOrig)) {
                this.currentBox = null; // Discard tiny box (likely a shift-click)
            } else if (this.currentBox) {
                this.userBoxes.push({ ...this.currentBox });
                this.currentBox = null;
            }
            interactionHandledOnUp = true;
        } else if (this.isDrawingLasso) {
            if (this.currentLassoPoints.length > 2) { // Need at least 3 points for a polygon
                this.userDrawnMasks.push({
                    points: [...this.currentLassoPoints],
                    color: `${this.Utils.getRandomHexColor()}7A`, // 40-50% alpha
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
                for (let i = this.userBoxes.length - 1; i >= 0; i--) {
                    const b = this.userBoxes[i];
                    if (coords_orig.x >= b.x1 && coords_orig.x <= b.x2 && coords_orig.y >= b.y1 && coords_orig.y <= b.y2) {
                        this.userBoxes.splice(i, 1);
                        break;
                    }
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
        this.currentBox = null;
        this.interactionState.isMouseDown = false;
        this.interactionState.didMove = false;

        this.drawUserInputLayer();
        this._dispatchEvent('userInteraction', this.getCurrentCanvasInputs());
    }

    _handleMouseLeave(e) {
        if (this.isPanning) {
            this._endPan();
        } else if (this.interactionState.isMouseDown && (this.canvasLockEl && this.canvasLockEl.style.display === 'none')) {
            this._handleMouseUp(e);
        }
    }

    _handleWheel(e) {
        if (!this.currentImage) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 1.1 : 0.9;
        const prevScale = this.transform.scale;
        const maxScale = 4 / this.displayScale;
        let newScale = prevScale * delta;
        if (newScale < 1) newScale = 1;
        if (newScale > maxScale) newScale = maxScale;
        const rect = this.userInputCanvas.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        const prevTotal = this.displayScale * prevScale;
        const contentX = (offsetX - this.transform.panX) / prevTotal;
        const contentY = (offsetY - this.transform.panY) / prevTotal;
        const newTotal = this.displayScale * newScale;
        this.transform.panX = offsetX - contentX * newTotal;
        this.transform.panY = offsetY - contentY * newTotal;
        this.transform.scale = newScale;
        this._clampPan();
        this.applyCanvasTransform();
    }

    _clampPan() {
        const scaledW = this.imageCanvas.width * this.transform.scale;
        const scaledH = this.imageCanvas.height * this.transform.scale;
        const maxPanX = 0;
        const maxPanY = 0;
        const minPanX = Math.min(0, this.imageCanvas.width - scaledW);
        const minPanY = Math.min(0, this.imageCanvas.height - scaledH);
        this.transform.panX = Math.min(maxPanX, Math.max(minPanX, this.transform.panX));
        this.transform.panY = Math.min(maxPanY, Math.max(minPanY, this.transform.panY));
    }

    _startPan(e) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        this.startPanX = this.transform.panX;
        this.startPanY = this.transform.panY;
    }

    _movePan(e) {
        if (!this.isPanning) return;
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        this.transform.panX = this.startPanX + dx;
        this.transform.panY = this.startPanY + dy;
        this._clampPan();
        this.applyCanvasTransform();
    }

    _endPan() {
        this.isPanning = false;
    }


    // --- Utility Methods ---

    _parseRgbaFromString(colorStr) { // Handles HSL(A) or RGB(A)
        if (typeof colorStr !== 'string') return [255,0,0,178]; // Fallback if not string

        if (colorStr.startsWith('hsl')) { // Convert HSL(A) to RGB(A)
            const match = colorStr.match(/hsla?\(([\d.]+),\s*([\d.]+)%?,\s*([\d.]+)%?(?:,\s*([\d.]+))?\)/);
            if (!match) return [255,0,0,178];
            let [h, s, l, a] = match.slice(1).map(parseFloat);
            if (isNaN(a)) a = 1;
            s /= 100; l /= 100;
            const k = n => (n + h / 30) % 12;
            const calc_a_val = s * Math.min(l, 1 - l); // Renamed calc_a to avoid conflict
            const f = n => l - calc_a_val * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
            return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4)), Math.round(a * 255)];
        } else if (colorStr.startsWith('#')) {
            const hex = colorStr.replace('#','');
            const bigint = parseInt(hex.length === 3 ? hex.split('').map(c=>c+c).join('') : hex, 16);
            const r = (bigint >> 16) & 255;
            const g = (bigint >> 8) & 255;
            const b = bigint & 255;
            return [r, g, b, 255];
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

    _drawBinaryMask(maskData, colorStr, opacity = 1.0) {
        if (!maskData || !maskData.length || !maskData[0].length) return;
        const maskHeight = maskData.length;
        const maskWidth = maskData[0].length;

        if (this.tempMaskPixelCanvas.width !== maskWidth || this.tempMaskPixelCanvas.height !== maskHeight) {
            this.tempMaskPixelCanvas.width = maskWidth;
            this.tempMaskPixelCanvas.height = maskHeight;
        }

        this.tempMaskPixelCtx.clearRect(0, 0, maskWidth, maskHeight);
        const imageData = this.tempMaskPixelCtx.createImageData(maskWidth, maskHeight);
        const pixelData = imageData.data;
        const [r, g, b, a_int] = this._parseRgbaFromString(colorStr);
        const finalAlpha = Math.round(Math.min(1, Math.max(0, opacity)) * a_int);

        for (let y = 0; y < maskHeight; y++) {
            for (let x = 0; x < maskWidth; x++) {
                if (maskData[y][x]) {
                    const idx = (y * maskWidth + x) * 4;
                    pixelData[idx] = r;
                    pixelData[idx + 1] = g;
                    pixelData[idx + 2] = b;
                    pixelData[idx + 3] = finalAlpha;
                }
            }
        }

        this.tempMaskPixelCtx.putImageData(imageData, 0, 0);
        this.offscreenPredictionCtx.drawImage(this.tempMaskPixelCanvas, 0, 0,
            this.offscreenPredictionCanvas.width, this.offscreenPredictionCanvas.height);
    }

    _dispatchEvent(eventType, data) {
        // console.log(`Canvas dispatching: canvas-${eventType}`, data);
        const event = new CustomEvent(`canvas-${eventType}`, { detail: data });
        document.dispatchEvent(event);
    }

    renderMaskToggleControls() {
        if (!this.maskToggleContainer) return;
        this.maskToggleContainer.innerHTML = '';

        if (this.automaskPredictions && this.automaskPredictions.length > 0) {
            this.maskToggleContainer.style.display = 'flex';
            this.automaskPredictions.forEach((pred, idx) => {
                const label = document.createElement('label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = pred.visible !== false;
                cb.addEventListener('change', () => {
                    pred.visible = cb.checked;
                    this.drawPredictionMaskLayer();
                });
                label.appendChild(cb);
                label.appendChild(document.createTextNode(`M${idx + 1}`));
                this.maskToggleContainer.appendChild(label);
            });
            return;
        }

        if (!this.manualPredictions || this.manualPredictions.length === 0) {
            this.maskToggleContainer.style.display = 'none';
            return;
        }

        this.maskToggleContainer.style.display = 'flex';
        if (this.currentPredictionMultiBox) {
            this.manualPredictions.forEach((pred, idx) => {
                const label = document.createElement('label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = pred.visible !== false;
                cb.addEventListener('change', () => {
                    pred.visible = cb.checked;
                    this.drawPredictionMaskLayer();
                });
                label.appendChild(cb);
                label.appendChild(document.createTextNode(`M${idx + 1}`));
                this.maskToggleContainer.appendChild(label);
            });
        } else {
            const labels = ['High', 'Medium', 'Low'];
            this.manualPredictions.forEach((pred, idx) => {
                const label = document.createElement('label');
                const rb = document.createElement('input');
                rb.type = 'radio';
                rb.name = 'mask-select';
                rb.value = idx;
                rb.checked = pred.visible !== false;
                rb.addEventListener('change', () => {
                    if (rb.checked) {
                        this.selectedManualMaskIndex = idx;
                        this.manualPredictions.forEach((p, i) => { p.visible = i === idx; });
                        this.drawPredictionMaskLayer();
                    }
                });
                label.appendChild(rb);
                label.appendChild(document.createTextNode(labels[idx] || `M${idx + 1}`));
                this.maskToggleContainer.appendChild(label);
            });
        }
    }

    // Public method to allow external modules to listen to canvas events
    addEventListener(eventType, callback) {
        document.addEventListener(`canvas-${eventType}`, callback);
    }

    setLayers(layers) {
        this.layers = Array.isArray(layers) ? layers.map(l => ({
            layerId: l.layerId,
            maskData: l.maskData,
            visible: l.visible !== false,
            color: l.displayColor || l.color || this.Utils.getRandomHexColor()
        })) : [];
        this.drawPredictionMaskLayer();
    }

    setMode(mode, selectedLayerIds = []) {
        this.mode = mode || 'edit';
        if (this.mode === 'creation') {
            if (this.selectedLayerIds.length !== 0) {
                this.selectedLayerIds = [];
                this._dispatchEvent('layer-selection-changed', { layerIds: [] });
            }
        } else {
            const newList = Array.isArray(selectedLayerIds) ? [...selectedLayerIds] : [];
            const changed = JSON.stringify(newList) !== JSON.stringify(this.selectedLayerIds);
            this.selectedLayerIds = newList;
            if (changed) this._dispatchEvent('layer-selection-changed', { layerIds: [...this.selectedLayerIds] });
            this.clearAllCanvasInputs(false);
        }
        if (this.mode === 'edit' || this.mode === 'review') {
            this.manualPredictions = [];
            this.automaskPredictions = [];
            this.currentPredictionMultiBox = false;
            this.selectedManualMaskIndex = 0;
            this.renderMaskToggleControls();
        }
        this.drawPredictionMaskLayer();
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

    exportState() {
        return {
            points: JSON.parse(JSON.stringify(this.userPoints)),
            boxes: JSON.parse(JSON.stringify(this.userBoxes)),
            drawnMasks: JSON.parse(JSON.stringify(this.userDrawnMasks)),
            maskInput: this.combinedUserMaskInput256 ? JSON.parse(JSON.stringify(this.combinedUserMaskInput256)) : null,
            manualPredictions: JSON.parse(JSON.stringify(this.manualPredictions)),
            automaskPredictions: JSON.parse(JSON.stringify(this.automaskPredictions)),
            selectedManualMaskIndex: this.selectedManualMaskIndex,
            currentPredictionMultiBox: this.currentPredictionMultiBox,
            layers: JSON.parse(JSON.stringify(this.layers)),
            selectedLayerIds: JSON.parse(JSON.stringify(this.selectedLayerIds)),
            mode: this.mode
        };
    }

    importState(state) {
        if (!state) return;
        this.userPoints = state.points || [];
        this.userBoxes = state.boxes || [];
        this.currentBox = null;
        this.userDrawnMasks = state.drawnMasks || [];
        this.combinedUserMaskInput256 = state.maskInput || null;
        this.manualPredictions = state.manualPredictions || [];
        this.automaskPredictions = state.automaskPredictions || [];
        this.selectedManualMaskIndex = state.selectedManualMaskIndex || 0;
        this.currentPredictionMultiBox = state.currentPredictionMultiBox || false;
        this.layers = state.layers || [];
        this.selectedLayerIds = state.selectedLayerIds || [];
        this.mode = state.mode || 'edit';
        if (this.userDrawnMasks.length > 0) this._prepareCombinedUserMaskInput();
        this.drawUserInputLayer();
        this.drawPredictionMaskLayer();
    }

    startMaskEdit(layerId, maskData, color) {
        this.editingLayerId = layerId;
        this.editingColor = color || '#ff0000';
        if (Array.isArray(maskData) && Array.isArray(maskData[0])) {
            this.editingMask = maskData.map(r => Array.from(r));
        } else if (maskData && maskData.counts && maskData.size) {
            const converted = this.Utils.rleToBinaryMask(
                maskData,
                this.originalImageHeight,
                this.originalImageWidth
            );
            this.editingMask = converted || this._createEmptyMask();
        } else {
            this.editingMask = this._createEmptyMask();
        }
        this.drawPredictionMaskLayer();
    }

    applyBrush(x, y, radius, add = true) {
        if (!this.editingMask) return;
        const h = this.editingMask.length;
        const w = this.editingMask[0].length;
        const cx = Math.round(x);
        const cy = Math.round(y);
        for (let j = -radius; j <= radius; j++) {
            for (let i = -radius; i <= radius; i++) {
                if (i*i + j*j <= radius*radius) {
                    const nx = cx + i;
                    const ny = cy + j;
                    if (nx >=0 && ny >=0 && nx < w && ny < h) {
                        this.editingMask[ny][nx] = add ? 1 : 0;
                    }
                }
            }
        }
        this.drawPredictionMaskLayer();
    }

    getEditedMask() {
        return this.editingMask ? this.editingMask.map(r => [...r]) : null;
    }

    finishMaskEdit() {
        this.editingLayerId = null;
        this.editingMask = null;
        this.drawPredictionMaskLayer();
    }

    _createEmptyMask() {
        const h = this.originalImageHeight;
        const w = this.originalImageWidth;
        const mask = [];
        for (let y = 0; y < h; y++) {
            mask[y] = new Array(w).fill(0);
        }
        return mask;
    }
}

// Instantiation handled by main.js
