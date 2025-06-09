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

    render() {
        if (!this.containerEl) return;
        this.containerEl.innerHTML = '';
        const listEl = document.createElement('ul');
        listEl.className = 'layer-list';

        this.layers.forEach(layer => {
            const li = document.createElement('li');
            li.className = 'layer-item';
            li.dataset.layerId = layer.layerId;

            const visBtn = document.createElement('button');
            visBtn.className = 'layer-vis-toggle';
            visBtn.textContent = layer.visible ? '👁' : '🚫';
            visBtn.addEventListener('click', () => {
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
            nameInput.addEventListener('change', () => {
                layer.name = nameInput.value;
            });

            const statusTag = document.createElement('span');
            statusTag.className = `layer-status-tag ${layer.status || ''}`;
            statusTag.textContent = layer.status || '';

            li.appendChild(visBtn);
            li.appendChild(colorSwatch);
            li.appendChild(nameInput);
            li.appendChild(statusTag);
            listEl.appendChild(li);
        });

        this.containerEl.appendChild(listEl);
    }
}

window.LayerViewController = LayerViewController;
