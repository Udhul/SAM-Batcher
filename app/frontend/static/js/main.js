// project_root/app/frontend/static/js/main.js

/**
 * @file main.js
 * @description Main frontend script. Initializes the application, instantiates all
 * frontend modules, and sets up primary event listeners to orchestrate interactions
 * between modules based on the application's workflow.
 *
 * Responsibilities:
 * - Initialize all core frontend modules (APIClient, StateManager, UIManager, CanvasManager,
 *   ModelHandler, ProjectHandler, ImagePoolHandler, Utils).
 * - Set up global event listeners for events dispatched by these modules.
 * - Coordinate actions between modules in response to these events. For example,
 *   when a project is loaded, it ensures the image pool and model display are updated.
 * - Handle initialization of truly global UI elements or application-wide setup.
 *
 * External Dependencies:
 * - All other .js modules defined in project_structure.md (APIClient, StateManager, UIManager, CanvasManager,
 *   ModelHandler, ProjectHandler, ImagePoolHandler, Utils)
 *   must be loaded before this script or their classes/objects made available.
 *
 * Input/Output (I/O):
 * Input:
 *   - Listens to custom DOM events dispatched by other modules (e.g., `project-loaded`,
 *     `model-load-success`, `active-image-set`, `canvas-userInteraction`).
 *
 * Output:
 *   - Calls methods on instantiated modules to trigger actions (e.g., telling
 *     ImagePoolHandler to load images, telling CanvasManager to display an image).
 *   - May interact with UIManager for global notifications.
 */
document.addEventListener("DOMContentLoaded", () => {
  // --- Instantiate Core Modules ---
  // Ensure Utils is available (it's an object with static methods)
  const utils = window.Utils; // Assuming utils.js defines a global Utils

  const apiClient = window.apiClient || new APIClient();
  const stateManager = new StateManager();
  const uiManager = new UIManager();
  const canvasManager = new CanvasManager();

  const canvasStateCache = {};
  let imageLayerCache = {};
  let projectTagList = [];
  let layerTagDebouncers = {};

  // modelHandler.js is a script that self-initializes its DOM listeners.
  // We don't instantiate it as a class here, but we will need its functions if we were to call them.
  // For now, it primarily dispatches events that main.js listens to.

  // Instantiate ProjectHandler and ImagePoolHandler if their classes are defined
  // These might need to be adjusted if they are also self-initializing scripts like modelHandler.
  // Assuming they are classes as per the plan:
  const projectHandler =
    typeof ProjectHandler === "function"
      ? new ProjectHandler(apiClient, stateManager, uiManager, utils)
      : null;
  const imagePoolHandler =
    typeof ImagePoolHandler === "function"
      ? new ImagePoolHandler(apiClient, stateManager, uiManager, utils)
      : null;
  const layerViewController =
    typeof LayerViewController === "function"
      ? new LayerViewController("#layer-view-container", stateManager)
      : null;
  const editModeController =
    typeof EditModeController === "function"
      ? new EditModeController(canvasManager, stateManager, apiClient, utils)
      : null;
  const exportDialog =
    typeof ExportDialog === "function"
      ? new ExportDialog(apiClient, stateManager, uiManager)
      : null;

  // --- (Optional) Make instances globally accessible for debugging ---
  window.apiClient = apiClient;
  window.stateManager = stateManager;
  window.uiManager = uiManager;
  window.canvasManager = canvasManager;
  // window.modelHandler = modelHandler; // Not an instance here
  window.projectHandler = projectHandler;
  window.imagePoolHandler = imagePoolHandler;
  window.layerViewController = layerViewController;
  window.editModeController = editModeController;
  window.exportDialog = exportDialog;

  console.log("Main.js: Core modules (api, state, ui, canvas) instantiated.");
  if (projectHandler) console.log("Main.js: ProjectHandler instantiated.");
  if (imagePoolHandler) console.log("Main.js: ImagePoolHandler instantiated.");

  // --- DOM Elements for Global Controls (managed by main.js) ---
  const imageUploadInput = document.getElementById("image-upload");
  const imageUploadProgressBar = document.getElementById("image-upload-bar");
  const imageUploadProgressContainer = document.getElementById(
    "image-upload-progress",
  );

  const clearInputsBtn = document.getElementById("clear-inputs-btn");
  const autoMaskBtn = document.getElementById("auto-mask-btn");
  const cancelAutoMaskBtn = document.getElementById("cancel-auto-mask-btn");
  const recoverAutoMaskBtn = document.getElementById("recover-auto-mask-btn");
  const openAutoMaskOverlayBtn = document.getElementById(
    "open-auto-mask-overlay",
  );
  const autoMaskOverlay = document.getElementById("auto-mask-overlay");
  const closeAutoMaskOverlayBtn = document.getElementById(
    "close-auto-mask-overlay",
  );
  const amgParamsElements = {
    pointsPerSideEl: document.getElementById("amg-points-per-side"),
    predIouThreshEl: document.getElementById("amg-pred-iou-thresh"),
    stabilityScoreThreshEl: document.getElementById(
      "amg-stability-score-thresh",
    ),
    statusEl: document.getElementById("auto-mask-status"),
  };
  const saveOverlayBtn = document.getElementById("save-canvas-png-btn");
  const commitMasksBtn = document.getElementById("commit-masks-btn");
  const openExportBtn = document.getElementById("open-export-btn");
  const addEmptyLayerBtn = document.getElementById("add-empty-layer-btn");
  const creationActions = document.getElementById("creation-actions");
  const editActions = document.getElementById("edit-actions");
  const helpTooltipContent = document.querySelector("#help-icon .tooltip-content");
  const readySwitch = document.getElementById("ready-switch");
  const skipSwitch = document.getElementById("skip-switch");
  const reviewSkipBtn = document.getElementById("review-skip-btn");
  const reviewApproveBtn = document.getElementById("review-approve-btn");
  const reviewRejectBtn = document.getElementById("review-reject-btn");
  const reviewPrevBtn = document.getElementById("review-prev-btn");
  const reviewExportBtn = document.getElementById("review-export-btn");
  const reviewExitBtn = document.getElementById("review-exit-btn");
  const toggleReviewModeBtn = document.getElementById("review-mode-btn");
  const reviewModeControls = document.getElementById("review-mode-controls");
  const reviewModeActions = document.getElementById("review-mode-actions");
  const imageStatusControls = document.getElementById("image-status-controls");

  function updateHelpTooltipForMode(mode) {
    if (!helpTooltipContent) return;
    const texts = {
      creation: `\n        <p><strong>Canvas Instructions:</strong></p>\n        <ul>\n          <li><strong>Positive Point:</strong> Left-click</li>\n          <li><strong>Negative Point:</strong> Right-click</li>\n          <li><strong>Bounding Box:</strong> Shift + Drag</li>\n          <li><strong>Lasso/Polygon:</strong> Ctrl/Cmd + Drag</li>\n          <li><strong>Remove Input:</strong> Click existing point, Shift-click box, Ctrl/Cmd-click lasso.</li>\n        </ul>`,
      edit: `\n        <p><strong>Edit Mode:</strong></p>\n        <ul>\n          <li>Brush/Eraser with mouse drag</li>\n          <li>Adjust size with slider</li>\n          <li>Save to apply or Cancel to discard</li>\n        </ul>`,
      review: `\n        <p><strong>Review Mode:</strong></p>\n        <p>Use Approve, Reject or Skip to update the image status.</p>`,
    };
    helpTooltipContent.innerHTML = texts[mode] || texts.creation;
  }

  if (openAutoMaskOverlayBtn && autoMaskOverlay) {
    openAutoMaskOverlayBtn.addEventListener("click", () =>
      utils.showElement(autoMaskOverlay, "flex"),
    );
  }
  if (closeAutoMaskOverlayBtn && autoMaskOverlay) {
    closeAutoMaskOverlayBtn.addEventListener("click", () =>
      utils.hideElement(autoMaskOverlay),
    );
  }

  // --- Global State Variables for main.js orchestration ---
  let predictionDebounceTimer = null;
  let currentAutoMaskAbortController = null;
  let activeImageState = null; // {imageHash, filename, width, height, layers, status}
  let reviewMode = false;
  let reviewHistory = [];
  let reviewHistoryIndex = -1;
  let navigatingHistory = false;
  let suppressStatusChangeEvents = false;

  function deriveStatusFromLayers() {
    if (!activeImageState) return "unprocessed";
    return activeImageState.layers && activeImageState.layers.length > 0
      ? "in_progress"
      : "unprocessed";
  }

  function updateStatusToggleUI(status, enabled = true) {
    const hasLayers =
      activeImageState &&
      activeImageState.layers &&
      activeImageState.layers.length > 0;

    if (readySwitch) {
      readySwitch.checked = status === "ready_for_review";
      readySwitch.disabled =
        !enabled || (skipSwitch && skipSwitch.checked) || !hasLayers;
    }
    if (skipSwitch) {
      skipSwitch.checked = status === "skip";
      skipSwitch.disabled = !enabled;
    }
  }

  updateStatusToggleUI("unprocessed", false);
  updateHelpTooltipForMode("creation");

  function enterReviewMode() {
    reviewMode = true;
    reviewHistory = [];
    reviewHistoryIndex = -1;
    updateHelpTooltipForMode("review");
    utils.showElement(reviewModeControls, "flex");
    utils.showElement(reviewModeActions, "flex");
    utils.hideElement(imageStatusControls);
    if (toggleReviewModeBtn) {
      toggleReviewModeBtn.textContent = "Exit Review";
      toggleReviewModeBtn.classList.add("review-active");
    }
    utils.hideElement(addEmptyLayerBtn);
    utils.hideElement(commitMasksBtn);
    utils.hideElement(openAutoMaskOverlayBtn);
    utils.hideElement(autoMaskBtn);
    utils.hideElement(recoverAutoMaskBtn);
    utils.hideElement(clearInputsBtn);
    utils.hideElement(creationActions);
    utils.hideElement(editActions);
    if (editModeController) editModeController.endEdit();
    canvasManager.setMode("review");
    if (reviewPrevBtn) reviewPrevBtn.disabled = true;
    if (imagePoolHandler)
      imagePoolHandler.loadNextImageByStatuses(["ready_for_review"]);
  }

  function exitReviewMode() {
    reviewMode = false;
    utils.hideElement(reviewModeControls);
    utils.hideElement(reviewModeActions);
    utils.showElement(imageStatusControls, "flex");
    if (toggleReviewModeBtn) {
      toggleReviewModeBtn.textContent = "Start Review";
      toggleReviewModeBtn.classList.remove("review-active");
    }
    utils.showElement(addEmptyLayerBtn);
    utils.showElement(commitMasksBtn);
    utils.showElement(openAutoMaskOverlayBtn);
    utils.showElement(autoMaskBtn);
    utils.showElement(recoverAutoMaskBtn);
    utils.showElement(clearInputsBtn);
    utils.showElement(creationActions, "flex");
    utils.hideElement(editActions);
    canvasManager.setMode("creation");
    updateHelpTooltipForMode("creation");
    reviewHistory = [];
    reviewHistoryIndex = -1;
  }

  function onImageDataChange(changeType, details = {}, skipUpdates = {}) {
    if (!activeImageState) return;
    if (!skipUpdates.cache) {
      syncLayerCache();
      saveCanvasState(activeImageState.imageHash);
    }
    if (!skipUpdates.layerView && layerViewController) {
      layerViewController.setLayers(activeImageState.layers);
    }
    if (!skipUpdates.canvasLayers) {
      canvasManager.setLayers(activeImageState.layers);
    }
    if (!skipUpdates.statusToggle) {
      const s = activeImageState.status || deriveStatusFromLayers();
      suppressStatusChangeEvents = true;
      updateStatusToggleUI(s, true);
      suppressStatusChangeEvents = false;
    }
    if (changeType === "status-changed" && !skipUpdates.statusEvent) {
      utils.dispatchCustomEvent("image-status-updated", {
        imageHash: activeImageState.imageHash,
        status: activeImageState.status,
      });
    }

    debouncedSyncState();
  }

  const debouncedSyncState = utils.debounce(async () => {
    if (!activeImageState) return;
    const projectId = stateManager.getActiveProjectId();
    if (!projectId) return;
    const payload = {
      status: activeImageState.status,
      layers: activeImageState.layers.map((l) => ({
        layerId: l.layerId,
        name: l.name,
        classLabels: Array.isArray(l.classLabels) ? l.classLabels : [],
        status: l.status,
        displayColor: l.displayColor,
        visible: l.visible,
      })),
    };
    try {
      await apiClient.updateImageState(
        projectId,
        activeImageState.imageHash,
        payload,
      );
    } catch (err) {
      console.error("State sync failed", err);
    }
  }, 1000);

  async function restoreSessionFromServer() {
    try {
      const data = await apiClient.getSessionState();
      if (!data.success) return;

      if (data.model_info) {
        stateManager.setCurrentLoadedModel(data.model_info);
        utils.dispatchCustomEvent("project-model-settings-update", {
          modelKey: data.model_info.model_size_key,
          modelPath: data.model_info.model_path,
          configPath: data.model_info.config_path,
          applyPostprocessing: data.model_info.apply_postprocessing,
        });

        window.samAvailable = data.model_info.available;
        document.dispatchEvent(
          new CustomEvent("sam-availability-updated", {
            detail: { available: window.samAvailable },
          }),
        );
        if (!data.model_info.available) {
          uiManager.showGlobalStatus(
            "Backend inference unavailable. Prediction features disabled.",
            "error",
            5000,
          );
        } else if (data.model_info.loaded) {
          utils.dispatchCustomEvent("model-load-success", {
            model_info: data.model_info,
            message: "Model ready.",
          });
        }
      }

      if (data.active_image) {
        stateManager.setActiveImage(
          data.active_image.image_hash,
          data.active_image.filename,
        );
        utils.dispatchCustomEvent("active-image-set", {
          imageHash: data.active_image.image_hash,
          filename: data.active_image.filename,
          width: data.active_image.width,
          height: data.active_image.height,
          imageDataBase64: data.active_image.image_data,
          existingMasks: data.active_image.masks,
          status: data.active_image.status,
        });
      }
      await loadProjectLabels();
    } catch (err) {
      console.error("Error restoring session state:", err);
    }
  }

  async function loadProjectLabels(rerender = true) {
    const pid = stateManager.getActiveProjectId();
    if (!pid) return;
    try {
      const data = await apiClient.getProjectLabels(pid);
      if (Array.isArray(data.labels)) {
        projectTagList = data.labels;
        stateManager.setProjectLabels(projectTagList);
        if (layerViewController) layerViewController.setProjectTags(projectTagList, rerender);
      }
    } catch (err) {
      console.error('Failed to fetch project labels', err);
    }
  }

  function saveCanvasState(hash) {
    if (!hash) return;
    canvasStateCache[hash] = canvasManager.exportState();
  }

  function restoreCanvasState(hash) {
    const state = canvasStateCache[hash];
    if (state) canvasManager.importState(state);
  }

  function syncLayerCache(hash) {
    if (!activeImageState) return;
    const key = hash || activeImageState.imageHash;
    if (!key) return;
    imageLayerCache[key] = activeImageState.layers.slice();
  }

  // --- Setup Event Listeners for Inter-Module Communication ---

  document.addEventListener("save-canvas-state", (e) => {
    saveCanvasState(e.detail.imageHash);
  });

  // == ProjectHandler Events ==
  document.addEventListener("project-created", (event) => {
    const { projectId, projectName, projectData } = event.detail;
    uiManager.showGlobalStatus(
      `Project '${utils.escapeHTML(projectName)}' created. ID: ${projectId.substring(0, 6)}`,
      "success",
    );
    canvasManager.clearAllCanvasInputs(true);
    if (imagePoolHandler) imagePoolHandler.clearImagePoolDisplay();
    activeImageState = null;
    layerViewController && layerViewController.setLayers([]);
    imageLayerCache = {};
    // Dispatch event for modelHandler to update based on new (default) project settings
    utils.dispatchCustomEvent("project-model-settings-update", {
      modelKey: projectData?.settings?.current_sam_model_key || null,
      modelPath: projectData?.settings?.current_sam_model_path || null,
      configPath: projectData?.settings?.current_sam_config_path || null,
      applyPostprocessing:
        projectData?.settings?.current_sam_apply_postprocessing === "true",
    });
    loadProjectLabels();
    updateStatusToggleUI("unprocessed", false);
  });

  document.addEventListener("project-loaded", async (event) => {
    const { projectId, projectName, projectData } = event.detail;
    uiManager.showGlobalStatus(
      `Project '${utils.escapeHTML(projectName)}' loaded.`,
      "success",
    );
    canvasManager.clearAllCanvasInputs(true);
    activeImageState = null;
    layerViewController && layerViewController.setLayers([]);
    imageLayerCache = {};

    const settings = projectData.settings || {};
    // Dispatch event for modelHandler to update based on loaded project's settings
    utils.dispatchCustomEvent("project-model-settings-update", {
      modelKey: settings.current_sam_model_key,
      modelPath: settings.current_sam_model_path,
      configPath: settings.current_sam_config_path, // Assuming this exists in settings
      applyPostprocessing: settings.current_sam_apply_postprocessing === "true",
    });
    if (imagePoolHandler) imagePoolHandler.loadAndDisplayImagePool();
    await restoreSessionFromServer();
    await loadProjectLabels();
    updateStatusToggleUI("unprocessed", false);
  });

  document.addEventListener("project-load-failed", (event) => {
    uiManager.showGlobalStatus(
      `Failed to load project: ${utils.escapeHTML(event.detail.error)}`,
      "error",
    );
    updateStatusToggleUI("unprocessed", false);
  });

  // == ModelHandler Events == (modelHandler.js dispatches these)
  document.addEventListener("model-load-initiated", (event) => {
    const { name } = event.detail; // Use 'name' from event detail for display
    uiManager.showGlobalStatus(
      `Initiating model load: ${utils.escapeHTML(name)}...`,
      "loading",
      0,
    );
    canvasManager.lockCanvas(`Loading ${utils.escapeHTML(name)} model...`);
  });

  document.addEventListener("model-load-success", (event) => {
    const { model_info, message } = event.detail;
    uiManager.showGlobalStatus(
      utils.escapeHTML(message) || `Model loaded successfully.`,
      "success",
      5000,
    );
    canvasManager.unlockCanvas();
    // Don't clear canvas inputs here if an image is already loaded.
    // Model change might mean user wants to re-predict on current inputs.
    // canvasManager.clearAllCanvasInputs(false); // Let user decide or clear on new image.
    stateManager.setCurrentLoadedModel(model_info);
  });

  document.addEventListener("model-load-error", (event) => {
    uiManager.showGlobalStatus(
      `Model load failed: ${utils.escapeHTML(event.detail.error)}`,
      "error",
    );
    canvasManager.unlockCanvas();
    stateManager.setCurrentLoadedModel(null);
  });

  // == ImagePoolHandler Events ==
  document.addEventListener("active-image-set", async (event) => {
  const {
      imageHash,
      filename,
      width,
      height,
      imageDataBase64,
      existingMasks,
      status,
    } = event.detail;
    canvasManager.clearAllCanvasInputs(true);
    canvasManager.setManualPredictions(null);
    canvasManager.setAutomaskPredictions(null);
    uiManager.showGlobalStatus(
      `Loading image '${utils.escapeHTML(filename)}' for annotation...`,
      "loading",
      0,
    );

    if (reviewMode) {
      if (navigatingHistory) {
        navigatingHistory = false;
      } else {
        if (reviewHistoryIndex < reviewHistory.length - 1) {
          reviewHistory = reviewHistory.slice(0, reviewHistoryIndex + 1);
        }
        reviewHistory.push(imageHash);
        reviewHistoryIndex = reviewHistory.length - 1;
      }
      if (reviewPrevBtn) reviewPrevBtn.disabled = reviewHistoryIndex <= 0;
    }

    syncLayerCache();
    activeImageState = {
      imageHash,
      filename,
      width,
      height,
      layers: [],
      status: status || "unprocessed",
      creation: {
        predictions: [],
        activeInputs: { points: [], boxes: [], drawnMasks: [] },
        selectedPredictionIndices: [],
      },
      edit: { activeLayerId: null, originalMaskData: null, editHistory: [] },
    };

    const projectId = stateManager.getActiveProjectId();
    let stateFromServer = null;
    if (projectId) {
      try {
        const res = await apiClient.getImageState(projectId, imageHash);
        if (res.success && res.image_state) stateFromServer = res.image_state;
      } catch (err) {
        console.error("getImageState error", err);
      }
    }

    if (stateFromServer && Array.isArray(stateFromServer.layers)) {
      activeImageState.status =
        stateFromServer.status || activeImageState.status;
      activeImageState.layers = stateFromServer.layers.map((m, idx) => {
        let parsed = m.maskDataRLE;
        if (parsed && parsed.counts && parsed.size) {
          parsed = utils.rleToBinaryMask(parsed, height, width);
        } else if (
          parsed &&
          parsed.type === "raw_list_final" &&
          Array.isArray(parsed.data)
        ) {
          parsed = parsed.data;
        }
        return {
          layerId: m.layerId,
          name: m.name || `Mask ${idx + 1}`,
          classLabels: Array.isArray(m.classLabels) ? m.classLabels : [],
          status: m.status || "prediction",
          visible: m.visible !== false,
          displayColor: m.displayColor || utils.getRandomHexColor(),
          maskData: parsed,
        };
      });
      imageLayerCache[imageHash] = activeImageState.layers.map((l) => ({
        ...l,
      }));
    } else if (imageLayerCache[imageHash]) {
      activeImageState.layers = imageLayerCache[imageHash].map((l) => ({
        ...l,
      }));
    } else if (existingMasks && existingMasks.length > 0) {
      const validMasks = existingMasks.filter(
        (m) => m.status !== "interactive_prompt",
      );
      activeImageState.layers = validMasks.map((m, idx) => {
        let parsed = m.mask_data_rle;
        if (typeof parsed === "string") {
          try {
            parsed = JSON.parse(parsed);
          } catch (e) {
            parsed = null;
          }
        }
        if (parsed && parsed.counts && parsed.size) {
          parsed = utils.rleToBinaryMask(parsed, height, width);
        } else if (
          parsed &&
          parsed.type === "raw_list_final" &&
          Array.isArray(parsed.data)
        ) {
          parsed = parsed.data;
        }
        return {
          layerId: m.layer_id || `layer_${idx}`,
          name: m.name || `Mask ${idx + 1}`,
          classLabels: Array.isArray(m.class_labels) ? m.class_labels :
            (m.class_labels ? [m.class_labels] : []),
          status: m.status || "prediction",
          visible: m.visible !== false,
          displayColor: m.display_color || utils.getRandomHexColor(),
          maskData: parsed,
        };
      });
      imageLayerCache[imageHash] = activeImageState.layers.map((l) => ({
        ...l,
      }));
    }
    if (layerViewController)
      layerViewController.setLayers(activeImageState.layers);

    const imageElement = new Image();
    imageElement.onload = () => {
      canvasManager.loadImageOntoCanvas(imageElement, width, height, filename);
      const hadState = !!canvasStateCache[imageHash];
      restoreCanvasState(imageHash);
      layerViewController && layerViewController.setSelectedLayers([]);
      if (editModeController) editModeController.endEdit();
      canvasManager.setMode("creation");
      uiManager.clearGlobalStatus();
      onImageDataChange("image-loaded", { imageHash });
    };
    imageElement.onerror = () => {
      uiManager.showGlobalStatus(
        `Error creating image element for '${utils.escapeHTML(filename)}'.`,
        "error",
      );
    };
    imageElement.src = imageDataBase64;
  });

  // == CanvasManager Events ==
  canvasManager.addEventListener("userInteraction", (event) => {
    const canvasInputs = event.detail;
    const currentModel = stateManager.getCurrentLoadedModel();
    const activeImageHash = stateManager.getActiveImageHash();

    if (!currentModel || !currentModel.loaded) {
      uiManager.showGlobalStatus(
        "Cannot predict: No model loaded.",
        "error",
        3000,
      );
      return;
    }
    if (!canvasInputs.imagePresent) return;

    clearTimeout(predictionDebounceTimer);
    predictionDebounceTimer = setTimeout(() => {
      if (
        canvasInputs.points.length > 0 ||
        (canvasInputs.boxes && canvasInputs.boxes.length > 0) ||
        canvasInputs.maskInput
      ) {
        performInteractivePrediction(canvasInputs, activeImageHash);
      } else {
        canvasManager.setManualPredictions(null);
      }
    }, 300);
  });

  canvasManager.addEventListener("opacityChanged", (event) => {
    const { layer, value } = event.detail;
    const valueDisplayId = `${layer}-opacity-value`;
    const valueDisplayElement = document.getElementById(valueDisplayId);
    if (valueDisplayElement) {
      valueDisplayElement.textContent = `${Math.round(value * 100)}%`;
    }
  });

  async function performInteractivePrediction(canvasInputs, imageHashForAPI) {
    canvasManager.lockCanvas("Predicting...");
    canvasManager.setAutomaskPredictions(null);

    const boxPayload =
      canvasInputs.boxes && canvasInputs.boxes.length > 0
        ? canvasInputs.boxes.map((b) => [b.x1, b.y1, b.x2, b.y2])
        : null;
    const multiMask = !(boxPayload && boxPayload.length > 1);
    const payload = {
      points: canvasInputs.points.map((p) => [p.x, p.y]),
      labels: canvasInputs.points.map((p) => p.label),
      box: boxPayload,
      maskInput: canvasInputs.maskInput,
      multimask_output: multiMask,
    };
    const activeProjectId = stateManager.getActiveProjectId();

    try {
      const data = await apiClient.predictInteractive(
        activeProjectId,
        imageHashForAPI,
        payload,
      );
      if (data.success) {
        canvasManager.setManualPredictions({
          masks_data: data.masks_data,
          scores: data.scores,
          num_boxes: data.num_boxes,
          multimask_output: data.multimask_output,
        });
      } else {
        throw new Error(data.error || "Interactive prediction API error.");
      }
    } catch (error) {
      uiManager.showGlobalStatus(
        `Prediction error: ${utils.escapeHTML(error.message)}`,
        "error",
      );
      canvasManager.setManualPredictions(null);
    } finally {
      canvasManager.unlockCanvas();
    }
  }

  // --- Global UI Element Listeners (Managed by main.js) ---
  if (clearInputsBtn) {
    clearInputsBtn.addEventListener("click", () => {
      canvasManager.clearAllCanvasInputs(false);
    });
  }

  if (addEmptyLayerBtn) {
    addEmptyLayerBtn.addEventListener("click", async () => {
      if (!activeImageState) return;
      const projectId = stateManager.getActiveProjectId();
      if (!projectId) return;
      const displayColor = utils.getRandomHexColor();
      const name = `Mask ${activeImageState.layers.length + 1}`;
      try {
        const res = await apiClient.createEmptyLayer(projectId, activeImageState.imageHash, {
          name,
          class_labels: [],
          display_color: displayColor,
        });
        if (res.success) {
          const newLayer = {
            layerId: res.layer_id,
            name,
            classLabels: [],
            status: "edited",
            visible: true,
            displayColor,
            maskData: null,
          };
          activeImageState.layers.unshift(newLayer);
          onImageDataChange("layer-added", { layerIds: [newLayer.layerId] });
          canvasManager.clearAllCanvasInputs(false);
          canvasManager.setMode("edit");
        }
      } catch (err) {
        console.error("Failed to create empty layer", err);
      }
    });
  }

  if (imageUploadInput) {
    imageUploadInput.addEventListener("change", handleImageFileUpload);
  }

  async function handleImageFileUpload(event) {
    const files = event.target.files;
    if (!files.length) return;

    const projectId = stateManager.getActiveProjectId();
    if (!projectId) {
      uiManager.showGlobalStatus(
        "Please create or load a project before uploading images.",
        "error",
      );
      imageUploadInput.value = ""; // Clear the input
      return;
    }

    utils.showElement(imageUploadProgressContainer);
    imageUploadProgressBar.style.width = "0%";
    imageUploadProgressBar.textContent = "0%";

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("files", files[i]);
    }

    uiManager.showGlobalStatus(
      `Uploading ${files.length} image(s)...`,
      "loading",
      0,
    );
    try {
      // Simulate progress for now as fetch doesn't support it directly for uploads easily
      // A more complex XHR solution or server-sent events would be needed for real progress.
      imageUploadProgressBar.style.width = "50%";
      imageUploadProgressBar.textContent = "50%";

      const data = await apiClient.addUploadSource(projectId, formData);

      imageUploadProgressBar.style.width = "100%";
      imageUploadProgressBar.textContent = "100%";

      if (data.success) {
        uiManager.showGlobalStatus(
          `Successfully uploaded ${data.images_added || 0} image(s). Skipped ${data.images_skipped_duplicates || 0}.`,
          "success",
        );
        if (projectHandler) projectHandler.fetchAndDisplayImageSources(); // Notify projectHandler
        if (imagePoolHandler) imagePoolHandler.loadAndDisplayImagePool(); // Refresh image pool
      } else {
        throw new Error(data.error || "Failed to upload images.");
      }
    } catch (error) {
      uiManager.showGlobalStatus(
        `Upload error: ${utils.escapeHTML(error.message)}`,
        "error",
      );
      imageUploadProgressBar.style.width = "100%";
      imageUploadProgressBar.classList.add("error"); // You'd need a CSS class for error state
      imageUploadProgressBar.textContent = "Error";
    } finally {
      imageUploadInput.value = ""; // Clear the input
      setTimeout(() => {
        utils.hideElement(imageUploadProgressContainer);
        imageUploadProgressBar.classList.remove("error");
      }, 3000);
    }
  }

  // == AutoMask Section Logic ==
  if (autoMaskBtn) autoMaskBtn.addEventListener("click", handleRunAutoMask);
  if (cancelAutoMaskBtn)
    cancelAutoMaskBtn.addEventListener("click", () => {
      if (currentAutoMaskAbortController)
        currentAutoMaskAbortController.abort();
    });
  if (recoverAutoMaskBtn)
    recoverAutoMaskBtn.addEventListener("click", handleRecoverAutoMask);

  async function handleRunAutoMask() {
    if (autoMaskOverlay) utils.hideElement(autoMaskOverlay);
    const currentCanvasState = canvasManager.getCurrentCanvasInputs();
    if (!currentCanvasState.imagePresent) {
      uiManager.showGlobalStatus(
        "Please load an image first for AutoMask.",
        "error",
      );
      return;
    }
    const currentModel = stateManager.getCurrentLoadedModel();
    if (!currentModel || !currentModel.loaded) {
      uiManager.showGlobalStatus(
        "Cannot run AutoMask: No model loaded.",
        "error",
      );
      return;
    }

    canvasManager.clearAllCanvasInputs(false);

    const startTime = Date.now();
    if (amgParamsElements.statusEl) {
      amgParamsElements.statusEl.className = "status-message info small";
      amgParamsElements.statusEl.textContent = "Running AutoMask...";
    }
    canvasManager.lockCanvas("AutoMask running...");
    if (autoMaskBtn) autoMaskBtn.disabled = true;
    if (cancelAutoMaskBtn) utils.showElement(cancelAutoMaskBtn, "inline-block");
    if (recoverAutoMaskBtn) recoverAutoMaskBtn.disabled = true;

    currentAutoMaskAbortController = new AbortController();
    const amgPayload = {
      points_per_side: amgParamsElements.pointsPerSideEl
        ? parseInt(amgParamsElements.pointsPerSideEl.value)
        : 32,
      pred_iou_thresh: amgParamsElements.predIouThreshEl
        ? parseFloat(amgParamsElements.predIouThreshEl.value)
        : 0.88,
      stability_score_thresh: amgParamsElements.stabilityScoreThreshEl
        ? parseFloat(amgParamsElements.stabilityScoreThreshEl.value)
        : 0.95,
    };
    const activeProjectId = stateManager.getActiveProjectId();
    const activeImageHash = stateManager.getActiveImageHash();

    try {
      const data = await apiClient.generateAutoMasks(
        activeProjectId,
        activeImageHash,
        amgPayload,
        currentAutoMaskAbortController.signal,
      );
      if (currentAutoMaskAbortController.signal.aborted) {
        if (amgParamsElements.statusEl)
          amgParamsElements.statusEl.textContent = "AutoMask cancelled.";
        uiManager.showGlobalStatus("AutoMask cancelled by user.", "info");
        return;
      }
      if (data.success) {
        canvasManager.setAutomaskPredictions(data);
        if (data.image_status) {
          utils.dispatchCustomEvent("image-status-updated", {
            imageHash: activeImageHash,
            status: data.image_status,
          });
        }
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const statusText = `AutoMask complete (${data.count || 0} masks) in ${duration}s.`;
        if (amgParamsElements.statusEl) {
          amgParamsElements.statusEl.className = "status-message success small";
          amgParamsElements.statusEl.textContent = statusText;
        }
        // Automask results are stored in the backend DB; no localStorage handling
      } else {
        throw new Error(data.error || "AutoMask API error.");
      }
    } catch (error) {
      if (error.name === "AbortError") {
        if (amgParamsElements.statusEl)
          amgParamsElements.statusEl.textContent = "AutoMask cancelled.";
      } else {
        if (amgParamsElements.statusEl) {
          amgParamsElements.statusEl.className = "status-message error small";
          amgParamsElements.statusEl.textContent = `Error: ${utils.escapeHTML(error.message)}`;
        }
        uiManager.showGlobalStatus(
          `AutoMask error: ${utils.escapeHTML(error.message)}`,
          "error",
        );
      }
      canvasManager.setAutomaskPredictions(null);
    } finally {
      canvasManager.unlockCanvas();
      if (autoMaskBtn) autoMaskBtn.disabled = false;
      if (cancelAutoMaskBtn) utils.hideElement(cancelAutoMaskBtn);
      if (recoverAutoMaskBtn) recoverAutoMaskBtn.disabled = false;
      currentAutoMaskAbortController = null;
    }
  }

  async function handleRecoverAutoMask() {
    if (autoMaskOverlay) utils.hideElement(autoMaskOverlay);
    const currentCanvasState = canvasManager.getCurrentCanvasInputs();
    if (!currentCanvasState.imagePresent || !currentCanvasState.filename) {
      uiManager.showGlobalStatus(
        "No image loaded to recover automask for.",
        "error",
      );
      if (amgParamsElements.statusEl) {
        amgParamsElements.statusEl.textContent = "No image loaded.";
        amgParamsElements.statusEl.className = "status-message error small";
      }
      return;
    }
    canvasManager.clearAllCanvasInputs(false);
    try {
      const activeProjectId = stateManager.getActiveProjectId();
      const activeImageHash = stateManager.getActiveImageHash();
      const res = await apiClient.getImageMasks(
        activeProjectId,
        activeImageHash,
        "prediction",
      );
      if (res.success && res.masks && res.masks.length > 0) {
        const latest = res.masks[0];
        const masksRLE = latest.mask_data_rle;
        const recoveredMasks = masksRLE.map((rleObj) => ({
          segmentation: utils.rleToBinaryMask(
            rleObj.segmentation_rle || rleObj,
            currentCanvasState.originalHeight,
            currentCanvasState.originalWidth,
          ),
        }));
        canvasManager.setAutomaskPredictions({
          masks_data: recoveredMasks,
          count: recoveredMasks.length,
        });
        const infoText =
          latest.metadata && latest.metadata.source_amg_params
            ? "Recovered previous AutoMask."
            : "Recovered masks";
        if (amgParamsElements.statusEl) {
          amgParamsElements.statusEl.textContent = infoText;
          amgParamsElements.statusEl.className = "status-message success small";
        }
        uiManager.showGlobalStatus(
          "AutoMask recovered from project DB.",
          "success",
          4000,
        );
      } else {
        uiManager.showGlobalStatus("No previous AutoMask found.", "info");
        if (amgParamsElements.statusEl) {
          amgParamsElements.statusEl.textContent =
            "No previous AutoMask found.";
          amgParamsElements.statusEl.className = "status-message info small";
        }
      }
    } catch (e) {
      uiManager.showGlobalStatus(
        `Error recovering AutoMask: ${utils.escapeHTML(e.message)}`,
        "error",
      );
      if (amgParamsElements.statusEl) {
        amgParamsElements.statusEl.textContent = "Error recovering AutoMask.";
        amgParamsElements.statusEl.className = "status-message error small";
      }
      console.error("recover automask error:", e);
    }
  }

  if (saveOverlayBtn) {
    saveOverlayBtn.addEventListener("click", () => {
      const currentInputs = canvasManager.getCurrentCanvasInputs();
      if (!currentInputs.imagePresent) {
        uiManager.showGlobalStatus("No image to save.", "error");
        return;
      }
      const displayWidth = canvasManager.imageCanvas.width;
      const displayHeight = canvasManager.imageCanvas.height;
      if (displayWidth === 0 || displayHeight === 0) {
        uiManager.showGlobalStatus(
          "Canvas not ready or no image loaded.",
          "error",
        );
        return;
      }
      const compositeCanvas = document.createElement("canvas");
      compositeCanvas.width = displayWidth;
      compositeCanvas.height = displayHeight;
      const compositeCtx = compositeCanvas.getContext("2d");

      compositeCtx.globalAlpha = canvasManager.imageOpacitySlider
        ? parseFloat(canvasManager.imageOpacitySlider.value)
        : 1.0;
      compositeCtx.drawImage(canvasManager.imageCanvas, 0, 0);
      compositeCtx.globalAlpha = canvasManager.predictionOpacitySlider
        ? parseFloat(canvasManager.predictionOpacitySlider.value)
        : 0.7;
      compositeCtx.drawImage(canvasManager.predictionMaskCanvas, 0, 0);
      compositeCtx.globalAlpha = canvasManager.userInputOpacitySlider
        ? parseFloat(canvasManager.userInputOpacitySlider.value)
        : 0.8;
      compositeCtx.drawImage(canvasManager.userInputCanvas, 0, 0);
      compositeCtx.globalAlpha = 1.0;

      const dataURL = compositeCanvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataURL;
      const filenameBase = currentInputs.filename
        ? currentInputs.filename.split(".").slice(0, -1).join(".")
        : "sam_output";
      link.download = `${utils.escapeHTML(filenameBase)}_overlay_preview.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      uiManager.showGlobalStatus("Overlay preview saved.", "success", 3000);
    });
  }

  async function handleCommitMasks() {
    if (!activeImageState) return;
    const predictions =
      canvasManager.manualPredictions &&
      canvasManager.manualPredictions.length > 0
        ? canvasManager.manualPredictions
        : canvasManager.automaskPredictions || [];

    const selected = (predictions || []).filter((p) => p.visible !== false);

    if (selected.length === 0) {
      uiManager.showGlobalStatus("No predictions selected.", "info");
      return;
    }

    const masksToCommit = selected.map((mask, idx) => ({
      segmentation: mask.segmentation || mask,
      source_layer_ids: [],
      name: `Mask ${activeImageState.layers.length + idx + 1}`,
      display_color: utils.getRandomHexColor(),
    }));

    const activeProjectId = stateManager.getActiveProjectId();
    const activeImageHash = stateManager.getActiveImageHash();
    if (!activeProjectId || !activeImageHash) {
      uiManager.showGlobalStatus("No active project or image.", "error");
      return;
    }

    uiManager.showGlobalStatus("Adding layer(s)...", "loading", 0);
    try {
      const data = await apiClient.commitMasks(
        activeProjectId,
        activeImageHash,
        { final_masks: masksToCommit, notes: "" },
      );
      if (!data.success) throw new Error(data.error || "Commit failed");
      if (data.image_status) {
        utils.dispatchCustomEvent("image-status-updated", {
          imageHash: activeImageHash,
          status: data.image_status,
        });
      }

      const ids = data.final_layer_ids || [];
      const newLayers = selected.map((mask, idx) => ({
        layerId: ids[idx] || crypto.randomUUID(),
        name: masksToCommit[idx].name,
        classLabels: [],
        status: "edited",
        visible: true,
        displayColor: masksToCommit[idx].display_color,
        maskData: mask.segmentation || mask,
      }));

      activeImageState.layers.unshift(...newLayers);
      onImageDataChange("layer-added", { layerIds: ids });
      uiManager.showGlobalStatus(
        `${newLayers.length} layer(s) added.`,
        "success",
      );
    } catch (err) {
      uiManager.showGlobalStatus(
        `Add failed: ${utils.escapeHTML(err.message)}`,
        "error",
      );
    }

    canvasManager.clearAllCanvasInputs(false);
    canvasManager.setManualPredictions(null);
    canvasManager.setAutomaskPredictions(null);
    canvasManager.setMode("creation");
  }

  if (commitMasksBtn && !commitMasksBtn.dataset.listenerAttached) {
    commitMasksBtn.dataset.listenerAttached = "true";
    commitMasksBtn.addEventListener("click", async () => {
      if (commitMasksBtn.disabled) return;
      commitMasksBtn.disabled = true;
      await handleCommitMasks();
      commitMasksBtn.disabled = false;
    });
  }

  // Export button now handled by ExportDialog

  document.addEventListener("layers-selected", (event) => {
    if (!activeImageState) return;
    const ids = Array.isArray(event.detail.layerIds)
      ? event.detail.layerIds
      : [];
    canvasManager.clearAllCanvasInputs(false);
    if (ids.length === 0) {
      canvasManager.setMode("creation");
    } else {
      canvasManager.setMode("edit", ids);
    }
    canvasManager.setLayers(activeImageState.layers);
    if (editModeController) {
      if (ids.length === 1) {
        const layer = activeImageState.layers.find((l) => l.layerId === ids[0]);
        editModeController.beginEdit(layer);
        utils.hideElement(creationActions);
        utils.showElement(editActions, "flex");
        updateHelpTooltipForMode("edit");
      } else {
        editModeController.endEdit();
        utils.showElement(creationActions, "flex");
        utils.hideElement(editActions);
        if (!reviewMode) updateHelpTooltipForMode("creation");
      }
    }
  });

  document.addEventListener("layer-deleted", async (event) => {
    if (!activeImageState) return;
    const id = event.detail.layerId;
    activeImageState.layers = activeImageState.layers.filter(
      (l) => l.layerId !== id,
    );
    canvasManager.setLayers(activeImageState.layers);
    onImageDataChange("layer-deleted", { layerId: id });
    const projectId = stateManager.getActiveProjectId();
    const imageHash = stateManager.getActiveImageHash();
    if (projectId && imageHash) {
      try {
        const res = await apiClient.deleteMaskLayer(projectId, imageHash, id);
        if (res.success && res.image_status) {
          utils.dispatchCustomEvent("image-status-updated", {
            imageHash,
            status: res.image_status,
          });
        }
      } catch (e) {
        console.error("Delete layer error", e);
        uiManager.showGlobalStatus(
          `Delete error: ${utils.escapeHTML(e.message)}`,
          "error",
        );
      }
    }
  });

  document.addEventListener("layer-name-changed", (event) => {
    if (!activeImageState) return;
    const layer = activeImageState.layers.find(
      (l) => l.layerId === event.detail.layerId,
    );
    if (layer) {
      layer.name = event.detail.name || "";
      const pid = stateManager.getActiveProjectId();
      const ih = activeImageState.imageHash;
      if (pid && ih) {
        apiClient
          .updateMaskLayer(pid, ih, layer.layerId, { name: layer.name })
          .catch((err) => {
            uiManager.showGlobalStatus(
              `Layer update failed: ${utils.escapeHTML(err.message)}`,
              "error",
            );
          });
      }
      onImageDataChange(
        "layer-modified",
        { layerId: layer.layerId },
        { skipAutoStatus: true },
      );
    }
  });

  document.addEventListener("layer-tags-changed", (event) => {
    if (!activeImageState) return;
    const layer = activeImageState.layers.find(
      (l) => l.layerId === event.detail.layerId,
    );
    if (layer) {
      layer.classLabels = Array.isArray(event.detail.classLabels)
        ? event.detail.classLabels
        : [];
      const pid = stateManager.getActiveProjectId();
      const ih = activeImageState.imageHash;
      if (pid && ih) {
        if (!layerTagDebouncers[layer.layerId]) {
          layerTagDebouncers[layer.layerId] = utils.debounce(
            (p, h, lid, payload) => {
              apiClient
                .updateMaskLayer(p, h, lid, payload)
                .catch((err) => {
                  uiManager.showGlobalStatus(
                    `Layer update failed: ${utils.escapeHTML(err.message)}`,
                    "error",
                  );
                });
            },
            400,
          );
        }
        layerTagDebouncers[layer.layerId](pid, ih, layer.layerId, {
          class_labels: layer.classLabels,
        });
      }
      const added = layer.classLabels.filter((t) => !projectTagList.includes(t));
      if (added.length > 0) {
        projectTagList = [...projectTagList, ...added];
        stateManager.setProjectLabels(projectTagList);
        if (layerViewController) layerViewController.setProjectTags(projectTagList, false);
      } else {
        const stillUsed = new Set();
        activeImageState.layers.forEach((l) => {
          (l.classLabels || []).forEach((t) => stillUsed.add(t));
        });
        const removed = projectTagList.filter((t) => !stillUsed.has(t));
        if (removed.length > 0) {
          projectTagList = projectTagList.filter((t) => stillUsed.has(t));
          stateManager.setProjectLabels(projectTagList);
          if (layerViewController) layerViewController.setProjectTags(projectTagList, false);
        }
      }
      onImageDataChange("layer-modified", { layerId: layer.layerId });
    }
  });

  document.addEventListener("tag-input-focused", async () => {
    await loadProjectLabels(false);
  });

  document.addEventListener("layer-visibility-changed", (event) => {
    if (!activeImageState) return;
    const layer = activeImageState.layers.find(
      (l) => l.layerId === event.detail.layerId,
    );
    if (layer) {
      layer.visible = event.detail.visible;
      canvasManager.setLayers(activeImageState.layers);
      const pid = stateManager.getActiveProjectId();
      const ih = activeImageState.imageHash;
      if (pid && ih) {
        apiClient
          .updateMaskLayer(pid, ih, layer.layerId, { visible: layer.visible })
          .catch(() => {});
      }
    }
  });

  document.addEventListener("layer-color-changed", (event) => {
    if (!activeImageState) return;
    const layer = activeImageState.layers.find(
      (l) => l.layerId === event.detail.layerId,
    );
    if (layer) {
      layer.displayColor = event.detail.displayColor || "#888888";
      const pid = stateManager.getActiveProjectId();
      const ih = activeImageState.imageHash;
      if (pid && ih) {
        apiClient
          .updateMaskLayer(pid, ih, layer.layerId, {
            display_color: layer.displayColor,
          })
          .catch((err) => {
            uiManager.showGlobalStatus(
              `Layer update failed: ${utils.escapeHTML(err.message)}`,
              "error",
            );
          });
      }
      onImageDataChange(
        "layer-modified",
        { layerId: layer.layerId },
        { skipAutoStatus: true },
      );
      canvasManager.setLayers(activeImageState.layers);
    }
  });

  document.addEventListener("edit-save", (event) => {
    if (!activeImageState) return;
    const layer = activeImageState.layers.find(
      (l) => l.layerId === event.detail.layerId,
    );
    if (layer && event.detail.maskData) {
      layer.maskData = event.detail.maskData;
      layer.status = "edited";
      const pid = stateManager.getActiveProjectId();
      const ih = activeImageState.imageHash;
      if (pid && ih) {
        const rle = utils.binaryMaskToRLE(layer.maskData);
        apiClient
          .updateMaskLayer(pid, ih, layer.layerId, {
            mask_data_rle: rle,
            status: "edited",
          })
          .catch((err) => {
            uiManager.showGlobalStatus(
              `Save edit failed: ${utils.escapeHTML(err.message)}`,
              "error",
            );
          });
      }
      onImageDataChange("layer-modified", { layerId: layer.layerId });
    }
    if (layerViewController) layerViewController.setSelectedLayers([]);
    canvasManager.setMode("creation");
    utils.showElement(creationActions, "flex");
    utils.hideElement(editActions);
    if (!reviewMode) updateHelpTooltipForMode("creation");
  });

  document.addEventListener("edit-cancel", () => {
    if (activeImageState) {
      canvasManager.setLayers(activeImageState.layers);
    }
    if (layerViewController) layerViewController.setSelectedLayers([]);
    canvasManager.setMode("creation");
    utils.showElement(creationActions, "flex");
    utils.hideElement(editActions);
    if (!reviewMode) updateHelpTooltipForMode("creation");
  });

  document.addEventListener("canvas-layer-selection-changed", (event) => {
    if (layerViewController) {
      layerViewController.setSelectedLayers(event.detail.layerIds || []);
    }
  });

  document.addEventListener("active-image-set", (event) => {
    if (
      activeImageState &&
      activeImageState.imageHash === event.detail.imageHash
    ) {
      activeImageState.status = event.detail.status || "unprocessed";
    }
    onImageDataChange("image-loaded", { imageHash: event.detail.imageHash });
    if (editModeController) editModeController.endEdit();
    canvasManager.setMode("creation");
  });

  document.addEventListener("active-image-cleared", () => {
    activeImageState = null;
    if (editModeController) editModeController.endEdit();
    canvasManager.setMode("creation");
    updateStatusToggleUI("unprocessed", false);
  });

  document.addEventListener("image-status-updated", (event) => {
    if (event.detail && event.detail.status) {
      if (
        activeImageState &&
        activeImageState.imageHash === event.detail.imageHash
      ) {
        activeImageState.status = event.detail.status;
        onImageDataChange(
          "status-changed",
          { status: event.detail.status },
          { statusEvent: true },
        );
      }
    }
  });

  async function sendStatusUpdate(newStatus) {
    const projectId = stateManager.getActiveProjectId();
    const imageHash = stateManager.getActiveImageHash();
    if (!projectId || !imageHash) return;
    try {
      const res = await apiClient.updateImageStatus(
        projectId,
        imageHash,
        newStatus,
      );
      if (res.success) {
        if (activeImageState && activeImageState.imageHash === imageHash) {
          activeImageState.status = newStatus;
        }
        onImageDataChange("status-changed", { status: newStatus });
      } else {
        throw new Error(res.error || "Status update failed");
      }
    } catch (err) {
      uiManager.showGlobalStatus(
        `Status update error: ${utils.escapeHTML(err.message)}`,
        "error",
      );
    }
  }

  if (readySwitch) {
    readySwitch.addEventListener("change", () => {
      if (suppressStatusChangeEvents) return;
      if (skipSwitch && skipSwitch.checked) return; // should be disabled
      const status = readySwitch.checked
        ? "ready_for_review"
        : deriveStatusFromLayers();
      sendStatusUpdate(status);
    });
  }

  if (skipSwitch) {
    skipSwitch.addEventListener("change", () => {
      if (suppressStatusChangeEvents) return;
      if (skipSwitch.checked) {
        if (readySwitch) {
          readySwitch.checked = false;
          readySwitch.disabled = true;
        }
        sendStatusUpdate("skip");
      } else {
        if (readySwitch) readySwitch.disabled = false;
        const status =
          readySwitch && readySwitch.checked
            ? "ready_for_review"
            : deriveStatusFromLayers();
        sendStatusUpdate(status);
      }
    });
  }

  if (reviewApproveBtn) {
    reviewApproveBtn.addEventListener("click", async () => {
      await sendStatusUpdate("approved");
      if (reviewMode && imagePoolHandler)
        imagePoolHandler.loadNextImageByStatuses(["ready_for_review"]);
    });
  }
  if (reviewRejectBtn) {
    reviewRejectBtn.addEventListener("click", async () => {
      await sendStatusUpdate("rejected");
      if (reviewMode && imagePoolHandler)
        imagePoolHandler.loadNextImageByStatuses(["ready_for_review"]);
    });
  }
  if (reviewSkipBtn) {
    reviewSkipBtn.addEventListener("click", async () => {
      await sendStatusUpdate("skip");
      if (reviewMode && imagePoolHandler)
        imagePoolHandler.loadNextImageByStatuses(["ready_for_review"]);
    });
  }

  if (reviewPrevBtn) {
    reviewPrevBtn.addEventListener("click", async () => {
      if (!reviewMode || reviewHistoryIndex <= 0) return;
      reviewHistoryIndex -= 1;
      navigatingHistory = true;
      const prevHash = reviewHistory[reviewHistoryIndex];
      if (imagePoolHandler) await imagePoolHandler.handleSelectImage(prevHash);
      if (reviewPrevBtn) reviewPrevBtn.disabled = reviewHistoryIndex <= 0;
    });
  }

  if (toggleReviewModeBtn) {
    toggleReviewModeBtn.addEventListener("click", () => {
      if (reviewMode) {
        exitReviewMode();
      } else {
        enterReviewMode();
      }
    });
  }

  if (reviewExitBtn) {
    reviewExitBtn.addEventListener("click", () => {
      if (reviewMode) exitReviewMode();
    });
  }

  // --- Application Initialization ---
  function initializeApp() {
    uiManager.showGlobalStatus("Application initializing...", "loading", 0);

    document.querySelectorAll(".management-section").forEach((section) => {
      const header = section.querySelector(".management-header");
      if (
        header &&
        uiManager &&
        typeof uiManager.initializeExpandableSection === "function"
      ) {
        uiManager.initializeExpandableSection(header, true);
      }
    });

    // Initial opacity setup for sliders if canvasManager handles this
    // Or, call canvasManager.setupOpacitySliders() if it's not auto-done in constructor
    // It seems canvasManager.setupOpacitySliders also dispatches initial events, which is good.

    // Initial calls to handlers to fetch their data
    // modelHandler.js fetches its own models via DOMContentLoaded.
    // projectHandler and imagePoolHandler are instantiated above; their constructors might fetch initial data.
    // If not, call them here:
    if (
      projectHandler &&
      typeof projectHandler.fetchAndDisplayProjects === "function"
    ) {
      projectHandler.fetchAndDisplayProjects();
    }
    // Restore session from server after determining active project
    if (
      projectHandler &&
      typeof projectHandler.fetchActiveProject === "function"
    ) {
      projectHandler.fetchActiveProject().then(restoreSessionFromServer);
    } else {
      restoreSessionFromServer();
    }

    // Image pool will be loaded when a project becomes active.

    uiManager.showGlobalStatus(
      "Ready. Load a model, then an image or project.",
      "info",
      5000,
    );
  }

  initializeApp();
});
