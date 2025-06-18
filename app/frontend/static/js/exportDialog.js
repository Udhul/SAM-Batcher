/**
 * Module handling the export dialog UI and interactions.
 * Provides configuration options and invokes API calls
 * to generate exports with the selected filters.
 */

class ExportDialog {
  constructor(apiClient, stateManager, uiManager) {
    this.apiClient = apiClient;
    this.stateManager = stateManager;
    this.uiManager = uiManager;

    this.overlay = document.getElementById("export-overlay");
    this.closeBtn = document.getElementById("close-export-overlay");
    this.openBtn = document.getElementById("export-coco-btn");
    this.imageScopeRadios = document.getElementsByName("export-image-scope");
    this.statusInput = document.getElementById("export-status-input");
    this.maskInput = document.getElementById("export-mask-input");
    this.formatSelect = document.getElementById("export-format-select");
    this.destinationSelect = document.getElementById("export-destination-select");
    this.statsBox = document.getElementById("export-stats-box");
    this.exportBtn = document.getElementById("perform-export-btn");

    if (this.openBtn) {
      this.openBtn.addEventListener("click", () => this.show());
    }
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", () => this.hide());
    }
    if (this.imageScopeRadios) {
      Array.from(this.imageScopeRadios).forEach((r) =>
        r.addEventListener("change", () => {
          this._toggleStatusInput();
          this.updateStats();
        })
      );
    }
    if (this.exportBtn) {
      this.exportBtn.addEventListener("click", () => this.performExport());
    }

    const statusOptions = [
      "unprocessed",
      "in_progress",
      "ready_for_review",
      "approved",
      "rejected",
    ];
    if (this.statusInput) {
      this.statusTagify = new Tagify(this.statusInput, {
        whitelist: statusOptions,
        maxTags: 5,
        dropdown: {
          maxItems: 20,
          classname: "tags-look",
          enabled: 0,
          closeOnSelect: false,
        },
      });
      this.statusTagify.addTags(["approved"]);
      this.statusTagify.on("add", () => this.updateStats());
      this.statusTagify.on("remove", () => this.updateStats());
    }

    if (this.maskInput) {
      this.maskTagify = new Tagify(this.maskInput, {
        whitelist: ["All Layers", "Visible Layers"],
        maxTags: 10,
        dropdown: {
          maxItems: 20,
          classname: "tags-look",
          enabled: 0,
          closeOnSelect: false,
        },
      });
      this.maskTagify.addTags(["All Layers"]);
      this.maskTagify.on("add", () => this.updateStats());
      this.maskTagify.on("remove", () => this.updateStats());
    }

    this.updateStats();
    this._toggleStatusInput();
  }

  _getImageScope() {
    const r = Array.from(this.imageScopeRadios).find((x) => x.checked);
    return r ? r.value : "all";
  }

  _getMaskValues() {
    return this.maskTagify ? this.maskTagify.value.map((t) => t.value) : [];
  }

  _getVisibleLayerIds() {
    if (window.layerViewController && Array.isArray(window.layerViewController.layers)) {
      return window.layerViewController.layers
        .filter((l) => l.visible)
        .map((l) => l.layerId);
    }
    return [];
  }

  _toggleStatusInput() {
    const scope = this._getImageScope();
    if (!this.statusInput) return;
    const wrapper = this.statusInput.parentElement;
    if (wrapper) {
      wrapper.style.display = scope === "current" ? "none" : "block";
    }
  }

  gatherFilters() {
    const filters = { image_statuses: [], class_labels: [], image_hashes: [], layer_ids: [] };
    let visibleOnly = null;
    const scope = this._getImageScope();
    if (scope === "current") {
      const hash = this.stateManager.getActiveImageHash();
      if (hash) filters.image_hashes.push(hash);
    } else {
      filters.image_statuses = this.statusTagify
        ? this.statusTagify.value.map((t) => t.value)
        : [];
    }

    const values = this._getMaskValues();
    if (values.length === 0) {
      // no layers selected -> indicate empty set
      return { ...filters, empty: true };
    }
    if (!values.includes("All Layers")) {
      if (values.includes("Visible Layers")) {
        if (scope === "current") {
          filters.layer_ids = this._getVisibleLayerIds();
        } else {
          visibleOnly = true;
        }
      }
      const labels = values.filter((v) => v !== "All Layers" && v !== "Visible Layers");
      if (labels.length > 0) filters.class_labels = labels;
    }
    if (visibleOnly !== null) {
      filters.visible_only = visibleOnly;
    }
    return filters;
  }

  async updateStats() {
    const projectId = this.stateManager.getActiveProjectId();
    if (!projectId) return;
    try {
      const filters = this.gatherFilters();
      if (filters.empty) {
        this.statsBox.textContent = `Images: 0, Layers: 0`;
        this._setButtonState(0, 0);
      } else {
        const stats = await this.apiClient.getExportStats(projectId, { filters });
        this.statsBox.textContent = `Images: ${stats.num_images}, Layers: ${stats.num_layers}`;
        this._setButtonState(stats.num_images, stats.num_layers);
      }

      // Fetch label suggestions using only image scope filters
      const baseFilters = {
        image_statuses: filters.image_statuses,
        image_hashes: filters.image_hashes,
      };
      const labelStats = await this.apiClient.getExportStats(projectId, {
        filters: baseFilters,
      });
      if (labelStats.label_counts) {
        const labels = Object.keys(labelStats.label_counts).sort();
        this.maskTagify.settings.whitelist = ["All Layers", "Visible Layers", ...labels];
        if (this.maskTagify.dropdown) {
          this.maskTagify.dropdown.refilter();
        }
      }
    } catch (e) {
      this.statsBox.textContent = "Stats unavailable";
      this._setButtonState(0, 0);
    }
  }

  _setButtonState(numImages, numLayers) {
    if (!this.exportBtn) return;
    this.exportBtn.classList.remove("with-layers", "no-layers");
    if (numImages === 0) {
      this.exportBtn.disabled = true;
    } else {
      this.exportBtn.disabled = false;
      if (numLayers === 0) {
        this.exportBtn.classList.add("no-layers");
      } else {
        this.exportBtn.classList.add("with-layers");
      }
    }
  }

  async performExport() {
    const projectId = this.stateManager.getActiveProjectId();
    if (!projectId) return;
    const payload = {
      format: this.formatSelect.value,
      export_schema: "coco_instance_segmentation",
      destination: this.destinationSelect.value,
      filters: this.gatherFilters(),
    };
    try {
      await this.apiClient.requestExport(projectId, payload);
      this.uiManager.showGlobalStatus("Export started", "success");
    } catch (e) {
      this.uiManager.showGlobalStatus(`Export error: ${e.message}`, "error");
    }
  }

  show() {
    if (this.overlay) this.overlay.style.display = "flex";
    this._toggleStatusInput();
    this.updateStats();
  }

  hide() {
    if (this.overlay) this.overlay.style.display = "none";
  }
}

if (typeof window !== "undefined") {
  window.ExportDialog = ExportDialog;
}
