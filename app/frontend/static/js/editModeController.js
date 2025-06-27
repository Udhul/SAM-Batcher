/**
 * project_root/app/frontend/static/js/editModeController.js
 *
 * Provides a minimal edit mode toolbar with a brush tool.
 * Handles user input events on the canvas to modify the active mask
 * via CanvasManager. Saves or cancels edits using dispatched events.
 */
class EditModeController {
    constructor(canvasManager, stateManager, apiClient, utils) {
        this.canvasManager = canvasManager;
        this.stateManager = stateManager;
        this.apiClient = apiClient;
        this.utils = utils;
        this.activeLayer = null;
        this.brushSize = 10;
        this.isDrawing = false;
        this.currentTool = 'brush'; // 'brush' or 'lasso'
        this.lassoPoints = [];
        this.lassoAdd = true;
        this.initElements();
        this.attachListeners();
    }

    initElements() {
        this.toolsContainer = document.getElementById('edit-tools');
        this.actionsContainer = document.getElementById('edit-actions');
        this.brushBtn = document.getElementById('edit-brush-btn');
        this.lassoBtn = document.getElementById('edit-lasso-btn');
        this.brushSizeInput = document.getElementById('edit-brush-size');
        this.growBtn = document.getElementById('edit-grow-btn');
        this.shrinkBtn = document.getElementById('edit-shrink-btn');
        this.smoothBtn = document.getElementById('edit-smooth-btn');
        this.invertBtn = document.getElementById('edit-invert-btn');
        this.undoBtn = document.getElementById('edit-undo-btn');
        this.redoBtn = document.getElementById('edit-redo-btn');
        this.discardBtn = document.getElementById('edit-discard-btn');
        this.previewEl = document.getElementById('brush-preview');
    }

    attachListeners() {
        if (this.brushSizeInput) this.brushSizeInput.addEventListener('input', () => {
            this.brushSize = parseInt(this.brushSizeInput.value, 10) || 1;
            this.updatePreviewSize();
        });
        if (this.brushBtn) this.brushBtn.addEventListener('click', () => this.selectTool('brush'));
        if (this.lassoBtn) this.lassoBtn.addEventListener('click', () => this.selectTool('lasso'));
        if (this.growBtn) this.growBtn.addEventListener('click', () => this.actionGrow());
        if (this.shrinkBtn) this.shrinkBtn.addEventListener('click', () => this.actionShrink());
        if (this.smoothBtn) this.smoothBtn.addEventListener('click', () => this.actionSmooth());
        if (this.invertBtn) this.invertBtn.addEventListener('click', () => this.actionInvert());
        if (this.undoBtn) this.undoBtn.addEventListener('click', () => this.actionUndo());
        if (this.redoBtn) this.redoBtn.addEventListener('click', () => this.actionRedo());
        if (this.discardBtn) this.discardBtn.addEventListener('click', () => this.discard());
        const canvas = this.canvasManager.userInputCanvas;
        if (canvas) {
            canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
            canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
            canvas.addEventListener('mouseup', () => this.onMouseUp());
            canvas.addEventListener('mouseleave', () => this.onMouseUp());
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        this.canvasManager.addEventListener('zoom-pan-changed', () => this.updatePreviewSize());
        document.addEventListener('canvas-brushSizeScroll', (e) => {
            this.adjustBrushSize(e.detail.delta);
        });
    }

    updatePreviewSize() {
        if (!this.previewEl) return;
        const r = this.brushSize * this.canvasManager.getZoomedDisplayScale() * 2;
        this.previewEl.style.width = `${r}px`;
        this.previewEl.style.height = `${r}px`;
    }

    adjustBrushSize(delta) {
        this.brushSize += delta;
        if (this.brushSize < 1) this.brushSize = 1;
        const max = this.brushSizeInput ? parseInt(this.brushSizeInput.max, 10) : 50;
        if (this.brushSize > max) this.brushSize = max;
        if (this.brushSizeInput) this.brushSizeInput.value = this.brushSize;
        this.updatePreviewSize();
    }

    beginEdit(layer) {
        if (!layer) return;
        this.activeLayer = layer;
        this.canvasManager.startMaskEdit(layer.layerId, layer.maskData, layer.displayColor);
        this.showControls(true);
        this.selectTool('brush');
        this.updatePreviewSize();
    }

    endEdit() {
        this.activeLayer = null;
        this.showControls(false);
        this.canvasManager.finishMaskEdit();
        if (this.previewEl) this.previewEl.style.display = 'none';
        this.canvasManager.clearLassoPreview();
    }

    showControls(show) {
        if (this.toolsContainer) this.toolsContainer.style.display = show ? 'flex' : 'none';
        if (this.actionsContainer) this.actionsContainer.style.display = show ? 'flex' : 'none';
        if (this.previewEl) this.previewEl.style.display = show ? 'block' : 'none';
    }

    onMouseDown(e) {
        if (!this.activeLayer) return;
        this.isDrawing = true;
        if (this.currentTool === 'brush' && this.previewEl) {
            this.previewEl.style.position = 'fixed';
            this.previewEl.style.left = `${e.clientX}px`;
            this.previewEl.style.top = `${e.clientY}px`;
            this.previewEl.style.pointerEvents = 'none';
        }
        if (this.currentTool === 'brush') {
            this.applyBrush(e);
        } else if (this.currentTool === 'lasso') {
            this.lassoPoints = [this.canvasManager._displayToOriginalCoords(e.clientX, e.clientY)];
            const rightHeld = e.buttons === 2 || e.button === 2;
            this.lassoAdd = !(rightHeld || e.ctrlKey);
            this.canvasManager.drawLassoPreview(this.lassoPoints);
        }
        e.preventDefault();
    }


    onMouseMove(e) {
        if (!this.activeLayer) return;
        if (this.currentTool === 'brush' && this.previewEl) {
            this.previewEl.style.position = 'fixed';
            this.previewEl.style.left = `${e.clientX}px`;
            this.previewEl.style.top = `${e.clientY}px`;
            this.previewEl.style.pointerEvents = 'none';
        }
        if (!this.isDrawing) return;
        if (this.currentTool === 'brush') {
            this.applyBrush(e);
        } else if (this.currentTool === 'lasso') {
            this.lassoPoints.push(this.canvasManager._displayToOriginalCoords(e.clientX, e.clientY));
            this.canvasManager.drawLassoPreview(this.lassoPoints);
        }
        e.preventDefault();
    }

    onMouseUp() {
        if (this.currentTool === 'lasso' && this.isDrawing && this.lassoPoints.length > 2) {
            this.canvasManager.applyLasso(this.lassoPoints, this.lassoAdd);
            this.canvasManager.commitHistoryStep();
            this.canvasManager.clearLassoPreview();
            this.lassoPoints = [];
        } else if (this.currentTool === 'brush' && this.isDrawing) {
            this.canvasManager.commitHistoryStep();
        }
        this.isDrawing = false;
    }

    applyBrush(e) {
        const coords = this.canvasManager._displayToOriginalCoords(e.clientX, e.clientY);
        const rightHeld = e.buttons === 2 || e.button === 2;
        const add = !(rightHeld || e.ctrlKey);
        this.canvasManager.applyBrush(coords.x, coords.y, this.brushSize, add);
    }

    selectTool(tool) {
        this.currentTool = tool;
        if (this.brushBtn) this.brushBtn.classList.toggle('active', tool === 'brush');
        if (this.lassoBtn) this.lassoBtn.classList.toggle('active', tool === 'lasso');
        if (this.previewEl) this.previewEl.style.display = tool === 'brush' && this.activeLayer ? 'block' : 'none';
        this.canvasManager.clearLassoPreview();
    }

    actionGrow() {
        this.canvasManager.growEditingMask();
        this.canvasManager.commitHistoryStep();
    }

    actionShrink() {
        this.canvasManager.shrinkEditingMask();
        this.canvasManager.commitHistoryStep();
    }

    actionSmooth() {
        this.canvasManager.smoothEditingMask();
        this.canvasManager.commitHistoryStep();
    }

    actionInvert() {
        this.canvasManager.invertEditingMask();
        this.canvasManager.commitHistoryStep();
    }

    actionUndo() {
        this.canvasManager.undoEdit();
    }

    actionRedo() {
        this.canvasManager.redoEdit();
    }

    discard() {
        this.utils.dispatchCustomEvent('edit-discard', {});
        this.endEdit();
    }
}

window.EditModeController = EditModeController;
