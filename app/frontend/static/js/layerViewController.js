// project_root/app/frontend/static/js/layerViewController.js

/**
 * Simple controller for managing the Layer View panel (Stage 1 implementation).
 * Layers are rendered as list items with visibility toggle and name editing.
 */
class LayerViewController {
    constructor(containerSelector, stateManager) {
        this.containerEl = typeof containerSelector === 'string' ? document.querySelector(containerSelector) : containerSelector;
        this.stateManager = stateManager;
        this.layers = [];
        this.selectedLayerId = null;
        this.Utils = window.Utils || { dispatchCustomEvent: (n,d)=>document.dispatchEvent(new CustomEvent(n,{detail:d})) };
    }

    setLayers(layers) {
        this.layers = Array.isArray(layers) ? layers : [];
        this.render();
    }

    addLayers(newLayers) {
        if (Array.isArray(newLayers)) {
            this.layers.push(...newLayers);
            this.render();
        }
    }

    selectLayer(layerId) {
        if (this.selectedLayerId === layerId) return;
        this.selectedLayerId = layerId;
        this.Utils.dispatchCustomEvent('layer-selected', { layerId });
        this.render();
    }

    removeLayer(layerId) {
        const idx = this.layers.findIndex(l => l.layerId === layerId);
        if (idx !== -1) {
            this.layers.splice(idx, 1);
            if (this.selectedLayerId === layerId) this.selectedLayerId = null;
            this.Utils.dispatchCustomEvent('layer-deleted', { layerId });
            this.render();
        }
    }

    render() {
        if (!this.containerEl) return;
        this.containerEl.innerHTML = '';
        const listEl = document.createElement('ul');
        listEl.className = 'layer-list';

        this.layers.forEach(layer => {
            const li = document.createElement('li');
            li.className = 'layer-item';
            li.dataset.layerId = layer.layerId;
            if (layer.layerId === this.selectedLayerId) li.classList.add('selected');

            const visBtn = document.createElement('button');
            visBtn.className = 'layer-vis-toggle';
            visBtn.textContent = layer.visible ? '👁' : '🚫';
            visBtn.title = 'Toggle visibility';
            visBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                layer.visible = !layer.visible;
                visBtn.textContent = layer.visible ? '👁' : '🚫';
                this.Utils.dispatchCustomEvent('layer-visibility-changed', { layerId: layer.layerId, visible: layer.visible });
            });

            const colorSwatch = document.createElement('span');
            colorSwatch.className = 'layer-color-swatch';
            colorSwatch.style.backgroundColor = layer.displayColor || '#888';

            const nameInput = document.createElement('input');
            nameInput.className = 'layer-name-input';
            nameInput.type = 'text';
            nameInput.value = layer.name || '';
            nameInput.title = 'Layer name';
            nameInput.addEventListener('change', (e) => {
                e.stopPropagation();
                layer.name = nameInput.value;
                this.Utils.dispatchCustomEvent('layer-name-changed', { layerId: layer.layerId, name: layer.name });
            });

            const classInput = document.createElement('input');
            classInput.className = 'layer-class-input';
            classInput.type = 'text';
            classInput.placeholder = 'label';
            classInput.value = layer.classLabel || '';
            classInput.title = 'Class label';
            classInput.addEventListener('change', (e) => {
                e.stopPropagation();
                layer.classLabel = classInput.value.trim();
                this.Utils.dispatchCustomEvent('layer-class-changed', { layerId: layer.layerId, classLabel: layer.classLabel });
            });

            const statusTag = document.createElement('span');
            statusTag.className = `layer-status-tag ${layer.status || ''}`;
            statusTag.title = layer.status || '';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'layer-delete-btn';
            deleteBtn.textContent = '🗑';
            deleteBtn.title = 'Delete layer';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Delete this layer?')) {
                    this.removeLayer(layer.layerId);
                }
            });

            li.addEventListener('click', () => this.selectLayer(layer.layerId));

            li.appendChild(visBtn);
            li.appendChild(colorSwatch);
            li.appendChild(nameInput);
            li.appendChild(classInput);
            li.appendChild(statusTag);
            li.appendChild(deleteBtn);
            listEl.appendChild(li);
        });

        this.containerEl.appendChild(listEl);
    }
}

window.LayerViewController = LayerViewController;
