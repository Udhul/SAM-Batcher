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
    this.statusSection = document.getElementById("export-status-section");
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
          this._updateStatusVisibility();
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
        whitelist: ["Any Visible or Tagged", "Only Visible and Tagged"],
        maxTags: 10,
        dropdown: {
          maxItems: 20,
          classname: "tags-look",
          enabled: 0,
          closeOnSelect: false,
        },
      });
      this.maskTagify.on("add", (e) => {
        const val = e.detail.data.value;
        if (val === "Any Visible or Tagged") {
          this.maskTagify.removeTag("Only Visible and Tagged", true);
        } else if (val === "Only Visible and Tagged") {
          this.maskTagify.removeTag("Any Visible or Tagged", true);
        }
        this.updateStats();
      });
      this.maskTagify.on("remove", () => this.updateStats());
    }

    this._updateStatusVisibility();
    this.updateStats();
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

  _updateStatusVisibility() {
    if (this.statusSection) {
      const scope = this._getImageScope();
      this.statusSection.style.display = scope === "all" ? "block" : "none";
    }
  }


  gatherFilters() {
    const filters = { image_statuses: [], class_labels: [], image_hashes: [], layer_ids: [] };
    let visibilityMode = null;
    const scope = this._getImageScope();
    if (scope === "current") {
      const hash = this.stateManager.getActiveImageHash();
      if (hash) filters.image_hashes.push(hash);
    }
    if (scope === "all") {
      filters.image_statuses = this.statusTagify
        ? this.statusTagify.value.map((t) => t.value)
        : [];
    }

    const values = this._getMaskValues();
    const idxOr = values.indexOf("Any Visible or Tagged");
    if (idxOr > -1) {
      visibilityMode = "or";
      values.splice(idxOr, 1);
    }
    const idxAnd = values.indexOf("Only Visible and Tagged");
    if (idxAnd > -1) {
      visibilityMode = "and";
      values.splice(idxAnd, 1);
    }
    if (visibilityMode) {
      filters.visibility_mode = visibilityMode;
      if (visibilityMode === "and" && scope === "current") {
        filters.layer_ids = this._getVisibleLayerIds();
      }
    }
    if (values.length > 0) {
      filters.class_labels = values;
    }
    return filters;
  }

  async updateStats() {
    const projectId = this.stateManager.getActiveProjectId();
    if (!projectId) return;
    try {
      const filters = this.gatherFilters();
      const stats = await this.apiClient.getExportStats(projectId, { filters });
      this.statsBox.textContent = `Images: ${stats.num_images}, Layers: ${stats.num_layers}`;
      this._setButtonState(stats.num_images, stats.num_layers);

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
        this.maskTagify.settings.whitelist = [
          "Any Visible or Tagged",
          "Only Visible and Tagged",
          ...labels,
        ];
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
    this._updateStatusVisibility();
    this.updateStats();
  }

  hide() {
    if (this.overlay) this.overlay.style.display = "none";
  }
}

if (typeof window !== "undefined") {
  window.ExportDialog = ExportDialog;
}
