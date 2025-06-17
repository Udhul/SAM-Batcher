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
    this.labelSection = document.getElementById("export-label-options");
    this.labelInput = document.getElementById("export-label-input");
    this.maskRadios = document.getElementsByName("export-mask-scope");
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
    if (this.maskRadios) {
      this.maskRadios.forEach((r) =>
        r.addEventListener("change", () => {
          this.labelSection.style.display = r.value === "labels" ? "block" : "none";
          this.updateStats();
        })
      );
    }
    if (this.imageScopeRadios) {
      Array.from(this.imageScopeRadios).forEach((r) =>
        r.addEventListener("change", () => this.updateStats())
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

    this.labelTagify = new Tagify(this.labelInput, {
      whitelist: [],
      maxTags: 10,
      dropdown: {
        maxItems: 20,
        classname: "tags-look",
        enabled: 0,
        closeOnSelect: false,
      },
    });
    this.labelTagify.on("add", () => this.updateStats());
    this.labelTagify.on("remove", () => this.updateStats());

    this.updateStats();
  }

  _getImageScope() {
    const r = Array.from(this.imageScopeRadios).find((x) => x.checked);
    return r ? r.value : "all";
  }

  _getMaskScope() {
    const r = Array.from(this.maskRadios).find((x) => x.checked);
    return r ? r.value : "visible";
  }

  gatherFilters() {
    const filters = { image_statuses: [], layer_statuses: [], class_labels: [], image_hashes: [] };
    const scope = this._getImageScope();
    if (scope === "current") {
      const hash = this.stateManager.getActiveImageHash();
      if (hash) filters.image_hashes.push(hash);
    }
    filters.image_statuses = this.statusTagify.value.map((t) => t.value);

    const maskScope = this._getMaskScope();
    if (maskScope === "labels") {
      filters.class_labels = this.labelTagify.value.map((t) => t.value);
    }
    return filters;
  }

  async updateStats() {
    const projectId = this.stateManager.getActiveProjectId();
    if (!projectId) return;
    try {
      const stats = await this.apiClient.getExportStats(projectId, {
        filters: this.gatherFilters(),
      });
      this.statsBox.textContent = `Images: ${stats.num_images}, Layers: ${stats.num_layers}`;
      if (stats.label_counts) {
        const labels = Object.keys(stats.label_counts);
        this.labelTagify.settings.whitelist = labels;
      }
    } catch (e) {
      this.statsBox.textContent = "Stats unavailable";
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
      this.hide();
    } catch (e) {
      this.uiManager.showGlobalStatus(`Export error: ${e.message}`, "error");
    }
  }

  show() {
    if (this.overlay) this.overlay.style.display = "flex";
    this.updateStats();
  }

  hide() {
    if (this.overlay) this.overlay.style.display = "none";
  }
}

if (typeof window !== "undefined") {
  window.ExportDialog = ExportDialog;
}
