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
    this.currentCb = document.getElementById("export-current-image-cb");
    this.statusSection = document.getElementById("export-status-options");
    this.statusCb = document.getElementById("export-by-status-cb");
    this.statusChecks = Array.from(
      document.querySelectorAll(".export-status-checkbox")
    );
    this.maskRadios = document.getElementsByName("export-mask-scope");
    this.labelSection = document.getElementById("export-label-options");
    this.labelsContainer = document.getElementById("export-labels-container");
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
    if (this.statusCb) {
      this.statusCb.addEventListener("change", () => {
        this.statusSection.style.display = this.statusCb.checked ? "block" : "none";
        this.updateStats();
      });
    }
    if (this.maskRadios) {
      this.maskRadios.forEach((r) =>
        r.addEventListener("change", () => {
          this.labelSection.style.display = r.value === "labels" ? "block" : "none";
          this.updateStats();
        })
      );
    }
    if (this.exportBtn) {
      this.exportBtn.addEventListener("click", () => this.performExport());
    }

    this.loadLabels();
    this.updateStats();
  }

  async loadLabels() {
    const projectId = this.stateManager.getActiveProjectId();
    if (!projectId) return;
    try {
      const data = await this.apiClient.getProjectLabels(projectId);
      this.labelsContainer.innerHTML = "";
      data.labels.forEach((label) => {
        const id = `label-${label}`;
        const div = document.createElement("div");
        div.innerHTML = `<label><input type='checkbox' value='${label}' class='export-label-checkbox' id='${id}'> ${label}</label>`;
        this.labelsContainer.appendChild(div);
      });
    } catch (e) {
      console.error("label load", e);
    }
  }

  gatherFilters() {
    const filters = { image_statuses: [], layer_statuses: [], image_hashes: [] };
    if (this.currentCb.checked) {
      const hash = this.stateManager.getActiveImageHash();
      if (hash) filters.image_hashes.push(hash);
    }
    if (this.statusCb.checked) {
      this.statusChecks.forEach((cb) => {
        if (cb.checked) filters.image_statuses.push(cb.value);
      });
    }
    const maskScope = Array.from(this.maskRadios).find((r) => r.checked)?.value;
    if (maskScope === "all" || maskScope === "visible") {
      // no additional filter
    } else if (maskScope === "labels") {
      const labelCbs = this.labelsContainer.querySelectorAll(
        ".export-label-checkbox"
      );
      labelCbs.forEach((cb) => {
        if (cb.checked) filters.layer_statuses.push(cb.value);
      });
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
