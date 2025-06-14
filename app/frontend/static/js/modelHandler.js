// project_root/app/frontend/static/js/modelHandler.js
document.addEventListener('DOMContentLoaded', () => {
    const managementBar = document.getElementById('model-management-bar');
    const modelOverlay = document.getElementById('model-management-overlay');
    const closeOverlayBtn = document.getElementById('close-model-overlay');
    const modelSelect = document.getElementById('model-select');
    const loadModelBtn = document.getElementById('load-model-btn');
    const applyPostprocessingCb = document.getElementById('apply-postprocessing-cb');
    const modelStatusInline = document.getElementById('model-status-inline');
    const backendStatusEl = document.getElementById('model-backend-status');
    const customModelInputs = document.getElementById('custom-model-inputs');
    const customModelPathInput = document.getElementById('custom-model-path'); // Renamed for clarity
    const customConfigPathInput = document.getElementById('custom-config-path'); // Renamed for clarity

    let isModelLoading = false; // Flag to prevent re-entrant calls

    // Ensure Utils is available
    const Utils = window.Utils || { dispatchCustomEvent: (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail })) };

    function showOverlay() {
        if (modelOverlay) {
            Utils.showElement(modelOverlay, 'flex');
            if (backendStatusEl) {
                if (window.samAvailable === false) {
                    backendStatusEl.textContent = 'Backend inference unavailable on the server. Model loading is disabled.';
                    backendStatusEl.style.display = 'block';
                    loadModelBtn.disabled = true;
                } else {
                    backendStatusEl.textContent = '';
                    backendStatusEl.style.display = 'none';
                    loadModelBtn.disabled = false;
                }
            }
        }
    }

    function hideOverlay() {
        if (modelOverlay) Utils.hideElement(modelOverlay);
    }

    if (managementBar) managementBar.addEventListener('click', showOverlay);
    if (closeOverlayBtn) closeOverlayBtn.addEventListener('click', hideOverlay);

    async function fetchAvailableModels() {
        updateStatus('Fetching models...', 'loading');
        try {
            let data;
            if (window.apiClient && typeof window.apiClient.getAvailableModels === 'function') {
                data = await window.apiClient.getAvailableModels();
            } else {
                console.warn('apiClient.getAvailableModels not found, using direct fetch for /api/models/available.');
                const response = await fetch('/api/models/available'); // Standardized endpoint
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                data = await response.json();
            }

            if (typeof data.sam_available !== 'undefined') {
                window.samAvailable = data.sam_available;
            }

            if (backendStatusEl) {
                if (window.samAvailable === false) {
                    backendStatusEl.textContent = 'Backend inference unavailable on the server. Model loading is disabled.';
                    backendStatusEl.style.display = 'block';
                    loadModelBtn.disabled = true;
                } else {
                    backendStatusEl.textContent = '';
                    backendStatusEl.style.display = 'none';
                    loadModelBtn.disabled = false;
                }
            }

            if (data.success) {
                modelSelect.innerHTML = ''; // Clear previous options
                const customOption = document.createElement('option');
                customOption.value = 'custom';
                customOption.textContent = 'Custom Model Path';
                modelSelect.appendChild(customOption);

                const separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '──────────────';
                modelSelect.appendChild(separator);

                if (data.models && Array.isArray(data.models)) {
                    data.models.forEach(key => {
                        const option = document.createElement('option');
                        option.value = key;
                        option.textContent = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '); // Prettify name
                        if (key === data.current_model_key) { // Assuming backend sends current_model_key
                            option.selected = true;
                        }
                        modelSelect.appendChild(option);
                    });
                }
                
                if (data.current_model_key) { // Use current_model_key from response
                    const currentModelNamePretty = data.current_model_key.charAt(0).toUpperCase() + data.current_model_key.slice(1).replace(/_/g, ' ');
                    updateStatus(`Current: ${currentModelNamePretty}`, 'loaded');
                } else {
                    updateStatus('No model loaded. Please select one.', 'idle');
                }
                modelSelect.dispatchEvent(new Event('change')); // Trigger change to show/hide custom inputs
            } else {
                updateStatus('Error fetching models: ' + (data.error || 'Unknown error'), 'error');
                 Utils.dispatchCustomEvent('model-load-error', { error: data.error || 'Failed to fetch models' });
            }
        } catch (err) {
            updateStatus('Network error fetching models.', 'error');
            Utils.dispatchCustomEvent('model-load-error', { error: `Network error: ${err.message}` });
            console.error("Error fetching models:", err);
        }
    }

    function updateStatus(text, statusClass) { // statusClass can be 'loading', 'loaded', 'error', 'idle'
        modelStatusInline.textContent = text;
        modelStatusInline.className = `status-inline ${statusClass}`;
    }

    modelSelect.addEventListener('change', () => {
        customModelInputs.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
    });

    async function loadModel() {
        if (isModelLoading) {
            console.warn("Model loading already in progress.");
            return;
        }
        
        isModelLoading = true;
        loadModelBtn.disabled = true;

        const key = modelSelect.value;
        const postProcessing = applyPostprocessingCb.checked;
        let payload = { apply_postprocessing: postProcessing };
        let modelNameToDisplay = '';

        if (key === 'custom') {
            const mPath = customModelPathInput.value.trim();
            const cPath = customConfigPathInput.value.trim();
            modelNameToDisplay = 'Custom Model';
            
            if (!mPath || !cPath) {
                updateStatus('Please enter both custom model and config paths.', 'error');
                Utils.dispatchCustomEvent('model-load-error', { error: 'Missing custom model/config paths.' });
                isModelLoading = false;
                loadModelBtn.disabled = false;
                return;
            }
            payload.model_path = mPath;
            payload.config_path = cPath;
        } else {
            payload.model_size_key = key;
            modelNameToDisplay = modelSelect.options[modelSelect.selectedIndex]?.textContent || key;
        }

        updateStatus(`Loading ${modelNameToDisplay}...`, 'loading');
        Utils.dispatchCustomEvent('model-load-initiated', { key: key, name: modelNameToDisplay });
        
        try {
            let data;
            if (window.apiClient && typeof window.apiClient.loadModel === 'function') {
                data = await window.apiClient.loadModel(payload);
            } else {
                console.warn('apiClient.loadModel not found, using direct fetch for /api/model/load.');
                const res = await fetch('/api/model/load', { // Standardized endpoint
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    let errorMsg = `HTTP ${res.status}: ${res.statusText}`;
                    try { const errorData = await res.json(); errorMsg = errorData.error || errorData.message || errorMsg; } catch (e) { /* ignore */ }
                    throw new Error(errorMsg);
                }
                data = await res.json();
            }
            
            if (data.success) {
                const loadedModelInfo = data.model_info || { 
                    key: data.current_model_key || key, // current_model_key is from spec, might be just 'key'
                    path: payload.model_path, 
                    config_path: payload.config_path, 
                    postprocessing: postProcessing, 
                    loaded: true 
                };
                const loadedModelDisplayName = loadedModelInfo.key ? (loadedModelInfo.key.charAt(0).toUpperCase() + loadedModelInfo.key.slice(1).replace(/_/g, ' ')) : modelNameToDisplay;

                updateStatus(`Current: ${loadedModelDisplayName} (PostProc: ${postProcessing})`, 'loaded');
                Utils.dispatchCustomEvent('model-load-success', { model_info: loadedModelInfo, message: data.message || "Model loaded successfully." });

                // If the backend loaded a different model than selected (e.g. 'base_plus' when 'base' was asked), update dropdown
                if (loadedModelInfo.key && loadedModelInfo.key !== key) {
                    for(let i=0; i<modelSelect.options.length; i++){
                        if(modelSelect.options[i].value === loadedModelInfo.key){
                            modelSelect.selectedIndex = i;
                            modelSelect.dispatchEvent(new Event('change'));
                            break;
                        }
                    }
                }
                
                // Clear any previous predictions from canvas if model changes
                if (window.canvasManager && typeof window.canvasManager.setManualPredictions === 'function') {
                    window.canvasManager.setManualPredictions(null); 
                    window.canvasManager.setAutomaskPredictions(null);
                }

                // Close overlay after successful model load
                hideOverlay();

            } else {
                updateStatus(`Failed to load: ${data.error || 'Unknown server error'}`, 'error');
                Utils.dispatchCustomEvent('model-load-error', { error: data.error || 'Unknown server error' });
            }
        } catch (err) {
            console.error("Error in loadModel:", err);
            let errorMessage = err.message;
            if (err.name === 'AbortError') {
                errorMessage = 'Model loading timed out. Try again.';
            } else if (err.message.includes('fetch') || err.message.startsWith('HTTP')) { // Catches direct fetch and apiClient errors
                errorMessage = `Network error loading model: ${err.message}. Check server connection.`;
            }
            updateStatus(errorMessage, 'error');
            Utils.dispatchCustomEvent('model-load-error', { error: errorMessage });
        } finally {
            isModelLoading = false;
            loadModelBtn.disabled = false;
        }
    }

    loadModelBtn.addEventListener('click', loadModel);
    applyPostprocessingCb.addEventListener('change', () => {
        // Only reload if a model is already considered loaded or selected
        if (modelStatusInline.classList.contains('loaded') || modelSelect.value) {
            loadModel();
        }
    });

    // Listen for project settings update to reflect model state
    document.addEventListener('project-model-settings-update', (event) => {
        const { modelKey, modelPath, configPath, applyPostprocessing } = event.detail;

        let modelFoundInList = false;
        if (modelKey) {
            for (let i = 0; i < modelSelect.options.length; i++) {
                if (modelSelect.options[i].value === modelKey) {
                    modelSelect.selectedIndex = i;
                    modelFoundInList = true;
                    break;
                }
            }
        }

        if (!modelFoundInList && modelPath) { // If key not found in dropdown but path is provided
            modelSelect.value = 'custom';
        } else if (!modelKey && !modelPath) { // No specific model info from project
            // Potentially select the first available model or show "Please select"
             if (modelSelect.options.length > 2) { // Beyond "Custom" and "Separator"
                let defaultIdx = 2; // First actual model
                // Try to find a default like 'base_plus' or 'hiera_b_plus'
                const preferredDefaults = ['base_plus', 'base', 'tiny'];
                for (const prefKey of preferredDefaults) {
                    for(let i=0; i<modelSelect.options.length; i++){
                        if(modelSelect.options[i].value === prefKey){
                            defaultIdx = i;
                            break;
                        }
                    }
                    if(modelSelect.options[defaultIdx]?.value === prefKey) break;
                }
                modelSelect.selectedIndex = defaultIdx;
            } else {
                 modelSelect.selectedIndex = 0; // "Custom" or empty
            }
        }
        
        customModelPathInput.value = modelPath || '';
        customConfigPathInput.value = configPath || ''; // Assuming configPath is passed
        applyPostprocessingCb.checked = !!applyPostprocessing; // Ensure boolean

        modelSelect.dispatchEvent(new Event('change')); // Update UI for custom paths

        const currentSelectedText = modelSelect.options[modelSelect.selectedIndex]?.textContent || 'N/A';
        const modelDisplayNameForStatus = modelSelect.value === 'custom' ? 'Custom Model' : currentSelectedText;
        
        if (modelKey || modelPath) { // If there was some model info from project
            updateStatus(`Current: ${modelDisplayNameForStatus} (PostProc: ${applyPostprocessingCb.checked})`, 'loaded');
        } else {
             updateStatus('No model loaded from project. Please select one.', 'idle');
        }
    });

    fetchAvailableModels(); // Initial fetch
});