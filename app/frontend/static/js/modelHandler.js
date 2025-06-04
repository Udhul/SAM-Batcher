// project_root/app/frontend/static/js/modelHandler.js
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

    let isModelLoading = false; // Flag to prevent re-entrant calls

    function toggleSection() {
        const isCollapsed = content.classList.toggle('collapsed');
        header.classList.toggle('collapsed', isCollapsed);
        header.querySelector('.expand-indicator').textContent = isCollapsed ? '▼' : '▲';
    }

    header.addEventListener('click', toggleSection);

    async function fetchAvailableModels() {
        try {
            const response = await fetch('/api/get_available_models');
            const data = await response.json();
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
                        if (key === data.current_model) {
                            option.selected = true;
                        }
                        modelSelect.appendChild(option);
                    });
                }
                
                if (data.current_model) {
                    updateStatus(`Current: ${data.current_model.charAt(0).toUpperCase() + data.current_model.slice(1).replace(/_/g, ' ')}`, 'loaded');
                } else {
                    updateStatus('No model loaded. Please select one.', 'idle');
                }
                modelSelect.dispatchEvent(new Event('change')); // Trigger change to show/hide custom inputs
            } else {
                updateStatus('Error fetching models: ' + (data.error || 'Unknown error'), 'error');
            }
        } catch (err) {
            updateStatus('Network error fetching models.', 'error');
            console.error("Error fetching models:", err);
        }
    }

    function updateStatus(text, statusClass) { // statusClass can be 'loading', 'loaded', 'error', 'idle'
        modelStatusInline.textContent = text;
        modelStatusInline.className = `model-status-inline ${statusClass}`;
    }

    modelSelect.addEventListener('change', () => {
        customModelInputs.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
    });

    async function loadModel() {
        console.log('=== loadModel() function called ===');
        
        if (isModelLoading) {
            console.warn("Model loading already in progress.");
            return;
        }
        
        console.log('Setting isModelLoading to true');
        isModelLoading = true;
        loadModelBtn.disabled = true;

        const key = modelSelect.value;
        const postProcessing = applyPostprocessingCb.checked;
        console.log('Selected model key:', key);
        console.log('Post processing:', postProcessing);
        
        let payload = { apply_postprocessing: postProcessing };

        if (key === 'custom') {
            console.log('Custom model path selected');
            const mPath = customModelPath.value.trim();
            const cPath = customConfigPath.value.trim();
            console.log('Custom model path:', mPath);
            console.log('Custom config path:', cPath);
            
            if (!mPath || !cPath) {
                console.log('Missing custom paths, returning early');
                updateStatus('Please enter both custom model and config paths.', 'error');
                isModelLoading = false;
                loadModelBtn.disabled = false;
                return;
            }
            payload.model_path = mPath;
            payload.config_path = cPath;
        } else {
            console.log('Using predefined model key');
            payload.model_size_key = key;
        }

        console.log('Final payload:', payload);

        const modelNameToDisplay = key === 'custom' ? 'Custom Model' : (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '));
        console.log('Model name to display:', modelNameToDisplay);
        
        console.log('Updating status to loading...');
        updateStatus(`Loading ${modelNameToDisplay}...`, 'loading');
        
        console.log('Checking canvasManager methods:', window.canvasManager ? Object.getOwnPropertyNames(window.canvasManager) : 'canvasManager is null');
        
        if (window.canvasManager && typeof window.canvasManager.lockCanvas === 'function') {
            console.log('Locking canvas...');
            window.canvasManager.lockCanvas(`Loading ${modelNameToDisplay} model...`);
        } else {
            console.log('lockCanvas method not available, skipping canvas lock');
        }

        console.log('About to start fetch request...');
        
        try {
            console.log('Making fetch request to /api/load_model...');
            console.log('Request payload:', JSON.stringify(payload));
            
            const res = await fetch('/api/load_model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            console.log('Fetch completed, response received');

            if (!res.ok) {
                console.log('Response not OK:', res.status, res.statusText);
                throw new Error(`HTTP ${res.status}: ${res.statusText}`);
            }

            console.log('Parsing JSON response...');
            const data = await res.json();
            console.log('Response data:', data);
            
            if (data.success) {
                console.log('Model loaded successfully');
                const loadedModelNameMatch = data.message.match(/'([^']+)'/);
                const loadedModelDisplayName = loadedModelNameMatch ? (loadedModelNameMatch[1].charAt(0).toUpperCase() + loadedModelNameMatch[1].slice(1).replace(/_/g, ' ')) : modelNameToDisplay;
                
                updateStatus(`Current: ${loadedModelDisplayName} (PostProc: ${postProcessing})`, 'loaded');
                
                if (key !== 'custom' && loadedModelNameMatch && loadedModelNameMatch[1] !== key) {
                    for(let i=0; i<modelSelect.options.length; i++){
                        if(modelSelect.options[i].value === loadedModelNameMatch[1]){
                            modelSelect.selectedIndex = i;
                            break;
                        }
                    }
                }

                if (window.canvasManager && typeof window.canvasManager.setManualPredictions === 'function') {
                    window.canvasManager.setManualPredictions(null); 
                    window.canvasManager.setAutomaskPredictions(null);
                }
            } else {
                console.log('Model loading failed:', data.error);
                updateStatus(`Failed to load: ${data.error || 'Unknown server error'}`, 'error');
            }
        } catch (err) {
            console.error("Error in loadModel:", err);
        
            if (err.name === 'AbortError') {
                updateStatus('Model loading timed out. Try again.', 'error');
            } else if (err.message.includes('fetch')) {
                updateStatus('Network error loading model. Check server connection.', 'error');
            } else {
                updateStatus(`Error loading model: ${err.message}`, 'error');
            }
        } finally {
            console.log('In finally block, cleaning up...');
            if (window.canvasManager && typeof window.canvasManager.unlockCanvas === 'function') {
                console.log('Unlocking canvas...');
                window.canvasManager.unlockCanvas();
            } else {
                console.log('unlockCanvas method not available, skipping canvas unlock');
            }
            console.log('Setting isModelLoading to false');
            isModelLoading = false;
            console.log('Re-enabling load button');
            loadModelBtn.disabled = false;
            console.log('=== loadModel() function completed ===');
        }
    }

    loadModelBtn.addEventListener('click', () => {
        console.log('Load model button clicked!');
        loadModel();
    });
    
    // To avoid immediate re-load on checkbox change after model selection,
    // we might make this more explicit, or ensure loadModel handles it gracefully.
    // For now, keeping the original behavior which reloads on checkbox change.
    // The `isModelLoading` flag should prevent stacking calls.
    applyPostprocessingCb.addEventListener('change', loadModel);

    setTimeout(() => {
        console.log('CanvasManager object:', window.canvasManager);
        console.log('CanvasManager prototype:', window.canvasManager ? Object.getPrototypeOf(window.canvasManager) : 'null');
        console.log('CanvasManager methods:', window.canvasManager ? Object.getOwnPropertyNames(Object.getPrototypeOf(window.canvasManager)) : 'null');
    }, 1000);

    fetchAvailableModels(); // Initial fetch

    console.log('DOM elements check:');
    console.log('loadModelBtn:', loadModelBtn);
    console.log('modelSelect:', modelSelect);
    console.log('applyPostprocessingCb:', applyPostprocessingCb);
    console.log('modelSelect.value:', modelSelect.value);
});