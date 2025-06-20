/**
 * project_root/app/frontend/static/js/editModeController.js
 *
 * Provides a minimal edit mode toolbar with brush and eraser tools.
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
        this.mode = 'brush';
        this.brushSize = 10;
        this.isDrawing = false;
        this.initElements();
        this.attachListeners();
    }

    initElements() {
        this.toolsContainer = document.getElementById('edit-tools');
        this.actionsContainer = document.getElementById('edit-actions');
        this.brushBtn = document.getElementById('edit-brush-btn');
        this.eraserBtn = document.getElementById('edit-eraser-btn');
        this.brushSizeInput = document.getElementById('edit-brush-size');
        this.saveBtn = document.getElementById('edit-save-btn');
        this.cancelBtn = document.getElementById('edit-cancel-btn');
    }

    attachListeners() {
        if (this.brushBtn) this.brushBtn.addEventListener('click', () => this.setMode('brush'));
        if (this.eraserBtn) this.eraserBtn.addEventListener('click', () => this.setMode('eraser'));
        if (this.brushSizeInput) this.brushSizeInput.addEventListener('input', () => {
            this.brushSize = parseInt(this.brushSizeInput.value, 10) || 1;
        });
        if (this.saveBtn) this.saveBtn.addEventListener('click', () => this.save());
        if (this.cancelBtn) this.cancelBtn.addEventListener('click', () => this.cancel());
        const canvas = this.canvasManager.userInputCanvas;
        if (canvas) {
            canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
            canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
            canvas.addEventListener('mouseup', () => this.onMouseUp());
            canvas.addEventListener('mouseleave', () => this.onMouseUp());
        }
    }

    setMode(mode) {
        this.mode = mode;
        if (this.brushBtn) this.brushBtn.classList.toggle('active', mode === 'brush');
        if (this.eraserBtn) this.eraserBtn.classList.toggle('active', mode === 'eraser');
    }

    beginEdit(layer) {
        if (!layer) return;
        this.activeLayer = layer;
        this.canvasManager.startMaskEdit(layer.layerId, layer.maskData, layer.displayColor);
        this.showControls(true);
        this.setMode('brush');
    }

    endEdit() {
        this.activeLayer = null;
        this.showControls(false);
        this.canvasManager.finishMaskEdit();
    }

    showControls(show) {
        if (this.toolsContainer) this.toolsContainer.style.display = show ? 'flex' : 'none';
        if (this.actionsContainer) this.actionsContainer.style.display = show ? 'flex' : 'none';
    }

    onMouseDown(e) {
        if (!this.activeLayer) return;
        this.isDrawing = true;
        this.applyBrush(e);
        e.preventDefault();
    }

    onMouseMove(e) {
        if (!this.isDrawing) return;
        this.applyBrush(e);
        e.preventDefault();
    }

    onMouseUp() {
        this.isDrawing = false;
    }

    applyBrush(e) {
        const coords = this.canvasManager._displayToOriginalCoords(e.clientX, e.clientY);
        const add = this.mode === 'brush';
        this.canvasManager.applyBrush(coords.x, coords.y, this.brushSize, add);
    }

    save() {
        if (!this.activeLayer) return;
        const edited = this.canvasManager.getEditedMask();
        this.utils.dispatchCustomEvent('edit-save', { layerId: this.activeLayer.layerId, maskData: edited });
        this.endEdit();
    }

    cancel() {
        this.utils.dispatchCustomEvent('edit-cancel', {});
        this.endEdit();
    }
}

window.EditModeController = EditModeController;
