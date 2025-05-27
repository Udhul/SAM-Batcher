// static/modelLoader.js
document.addEventListener('DOMContentLoaded', () => {
    const loaderSection = document.getElementById('model-loader-expandable');
    const header = loaderSection.querySelector('.expandable-header');
    const content = loaderSection.querySelector('.expandable-content');
    const modelSelect = document.getElementById('model-select');
    const loadModelBtn = document.getElementById('load-model-btn');
    const applyPostprocessingCb = document.getElementById('apply-postprocessing-cb');
    const modelStatusInline = document.getElementById('model-status-inline');
    const customModelInputs = document.getElementById('custom-model-inputs');
    const customModelPath = document.getElementById('custom-model-path');
    const customConfigPath = document.getElementById('custom-config-path');

    function toggleSection() {
        const isCollapsed = content.classList.toggle('collapsed');
        header.classList.toggle('collapsed', isCollapsed);
        content.classList.toggle('collapsed', isCollapsed);
        header.querySelector('.expand-indicator').textContent = isCollapsed ? '▼' : '▲';
    }

    header.addEventListener('click', toggleSection);

    async function fetchAvailableModels() {
        try {
            const response = await fetch('/api/get_available_models');
            const data = await response.json();
            if (data.success) {
                modelSelect.innerHTML = '';
                const customOption = document.createElement('option');
                customOption.value = 'custom';
                customOption.textContent = 'Custom Model Path';
                modelSelect.appendChild(customOption);
                const separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '──────────────';
                modelSelect.appendChild(separator);
                data.models.forEach(key => {
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = key.charAt(0).toUpperCase() + key.slice(1);
                    if (key === data.current_model) option.selected = true;
                    modelSelect.appendChild(option);
                });
                updateStatus(data.current_model ? `Current: ${data.current_model}` : 'No model loaded.', 'loaded');
                modelSelect.dispatchEvent(new Event('change'));
            }
        } catch {
            updateStatus('Error fetching models', 'error');
        }
    }

    function updateStatus(text, statusClass) {
        modelStatusInline.textContent = text;
        modelStatusInline.className = `model-status-inline ${statusClass}`;
    }

    modelSelect.addEventListener('change', () => {
        customModelInputs.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
    });

    async function loadModel() {
        const key = modelSelect.value;
        const postProcessing = applyPostprocessingCb.checked;
        let payload = { apply_postprocessing: postProcessing };
        if (key === 'custom') {
            const m = customModelPath.value.trim();
            const c = customConfigPath.value.trim();
            if (!m || !c) return updateStatus('Please enter model and config paths.', 'error');
            payload.model_path = m;
            payload.config_path = c;
        } else {
            payload.model_size_key = key;
        }
        updateStatus(`Loading ${key}...`, 'loading');
        window.canvasManager?.lockCanvas(`Loading ${key} model...`);
        try {
            const res = await fetch('/api/load_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                const loaded = data.message.match(/'([^']+)'/)?.[1] || key;
                updateStatus(`Current: ${loaded} (PostProc: ${postProcessing})`, 'loaded');
                if (window.canvasManager?.getCurrentInputs().image) {
                    window.canvasManager.setPredictedMasks([]);
                    window.canvasManager.unlockCanvas();
                }
            } else {
                updateStatus(`Failed to load: ${data.error}`, 'error');
            }
        } catch {
            updateStatus('Error loading model', 'error');
        } finally {
            window.canvasManager?.unlockCanvas();
        }
    }

    loadModelBtn.addEventListener('click', loadModel);
    applyPostprocessingCb.addEventListener('change', loadModel);

    fetchAvailableModels();
});
