# SAM2 Image Masking Web Application: <br> Conceptual Design and Technical Specification

**Version:** 1.0
**Date:** June 1, 2025

**Table of Contents:**
1.  Introduction and Goals
2.  System Architecture
    2.1. Client-Side (Frontend)
    2.2. Server-Side (Backend)
    2.3. Data Persistence
3.  Key Concepts and Terminology
4.  Detailed Workflow and Feature Breakdown
    4.1. Project Management
    4.2. Model Management
    4.3. Image Source Management
    4.4. Image Pool and Navigation
    4.5. Image Annotation Workflow
        4.5.1. Loading an Image for Annotation
        4.5.2. Automatic Mask Generation
        4.5.3. Interactive Masking (Point/Box Prompts)
        4.5.4. Mask Refinement/Editing (Client-Side)
        4.5.5. Saving/Committing Masks
    4.6. Data Export
5.  API Endpoint Specification
6.  Data Model and Persistence
    6.1. Project State Database
    6.2. Image Data Storage
7.  Error Handling and Robustness
8.  Security Considerations
9.  Future Considerations

---

## 1. Introduction and Goals

This document outlines the technical specification for a web-based application enabling users to create image segmentation masks using the SAM2 framework. The application will provide an intuitive interface for managing image datasets, selecting SAM2 models, interactively generating and refining masks, and exporting the results.

**Primary Goals:**
*   **Intuitive User Experience:** Streamline the process of image annotation.
*   **Robustness:** Ensure stable operation and graceful handling of errors.
*   **Flexibility:** Support various image sources and export formats.
*   **Efficiency:** Optimize server-side processing and client-server communication.
*   **Persistence:** Allow users to save and resume their work.

---

## 2. System Architecture

The system will employ a client-server architecture.

**2.1. Client-Side (Frontend)**
*   **Technology:** HTML, CSS, JavaScript. A modern frontend framework (e.g., React, Vue, Angular) is recommended for managing complex UI state and interactions.
*   **Responsibilities:**
    *   User interface rendering and interaction.
    *   Managing UI state (current image, selected tools, mask overlays).
    *   Sending requests to the backend API.
    *   Receiving and displaying data from the backend (image data, masks, model lists).
    *   Client-side mask drawing/editing capabilities (e.g., using HTML Canvas).
    *   Handling user inputs for prompts (points, boxes).

**2.2. Server-Side (Backend)**
*   **Technology:** Python with FastAPI.
*   **Core Components:**
    *   **API Layer:** FastAPI routes for handling client requests.
    *   **SAM2 Integration Layer:** `SAMInference` class (from `sam_backend.py`) interacting with the SAM2 library.
    *   **Business Logic Layer:** Managing projects, image pools, state, and orchestrating SAM2 operations.
    *   **Data Access Layer:** Interacting with the project state database.
*   **Responsibilities:**
    *   Serving the frontend application.
    *   Managing SAM2 model loading and inference.
    *   Handling image uploads and accessing images from various sources.
    *   Processing image data (e.g., hashing, reading dimensions).
    *   Managing project state and persistence.
    *   Generating masks based on user prompts or automatic generation requests.
    *   Preparing data for export.

**2.3. Data Persistence**
*   **Project State Database:** A file-based database (e.g., SQLite initially, potentially JSON for very simple cases, but SQLite offers better querying) or a more robust DB (e.g., PostgreSQL) if scalability is a concern. Stores metadata about projects, images, masks, and settings.
*   **Uploaded Images:** Stored in the designated project directory on the server (e.g., `<PROJECTS_DATA_DIR>/<project_id>/uploads/<image_hash_prefix>/<image_hash>.<ext>`).
*   **Temporary/Cached Data:** Server might cache image embeddings for the active image.

---

## 3. Key Concepts and Terminology

*   **Project:** A user-defined collection of image sources, associated masks, and settings. Each project has its own state database.
*   **Image Source:** A location from which images are drawn (e.g., client upload, server folder, URL, Azure Blob URI).
*   **Image Pool:** A list of unique images (identified by hash) aggregated from all active sources within a project.
*   **Active Image:** The image currently loaded by the server's `SAMInference` instance and displayed on the client for annotation.
*   **Image Hash:** A unique MD5 (or similar) hash of the original image file content, used to identify images and prevent duplicates within a project.
*   **Mask Layer:** A specific set of masks generated for an image. Can be from automask, a specific set of point/box prompts, or a user's final edited version.
*   **Project State DB:** The persistent storage for a project's metadata, image list, mask information, and settings.
*   **Credentials (for Azure Blob):** User-provided or environment-inferred credentials for accessing Azure Blob Storage. Initially, focus on default/environment credentials.

---

## 4. Detailed Workflow and Feature Breakdown

**4.1. Project Management**

*   **Create New Project:**
    *   **Client:** User clicks "New Project," provides a project name. Default unique project name provided with python-petname or haikunator, extended with "-DDMMYY"
    *   **Client Request:** `POST /api/project` (Body: `{"project_name": "my_project"}`)
    *   **Server:** Creates a new unique project ID, initializes a new project state DB (e.g., `<PROJECTS_DATA_DIR>/<project_id>.sqlite`), creates an upload directory (`<PROJECTS_DATA_DIR>/<project_id>/uploads/`).
    *   **Server Response:** `{"success": true, "project_id": "uuid", "message": "Project created"}`
    *   **Client:** Updates UI, loads the new (empty) project.
*   **Load Existing Project:**
    *   **Client:** User selects from a list of existing projects (server lists available DB files) or uploads a project state DB file.
    *   **Client Request (List):** `GET /api/projects`
    *   **Server (List):** Scans `<PROJECTS_DATA_DIR>` for valid DB files and returns them ordered by most recently used.
    *   **Server Response (List):** `{"success": true, "projects": [{"id": "uuid", "name": "my_project", "last_modified": "timestamp"}, ...]}`
    *   **Client Request (Load by ID):** `POST /api/project/load` (Body: `{"project_id": "uuid"}`)
    *   **Server (Load by ID):** Sets the active project ID, validates the DB.
    *   **Server Response (Load by ID):** `{"success": true, "project_data": {...}}` (sends key project info like name, image count)
    *   **Client Request (Upload DB):** `POST /api/project/upload_db` (Multipart form with DB file)
    *   **Server (Upload DB):** Saves the DB file, validates it, sets it as active.
    *   **Server Response (Upload DB):** `{"success": true, "project_data": {...}}`
*   **Client:** Loads project data into UI.
*   **Server:** Automatically loads the project's last used SAM model and post-processing setting, replacing any currently loaded model if different. When the model was selected via one of the predefined size keys the key is stored as well so it can be chosen again when the project is loaded.
*   **Client:** After a project is loaded it queries `/api/session` to refresh the current model and image state.
*   **Client Request (Get Active):** On page refresh the client calls `GET /api/session` to retrieve the current project, model, and image so the UI can restore the session. If no project is active, the project management overlay is shown.
*   **Save Project (Implicit):** Changes are saved to the Project State DB as they occur (e.g., after mask generation, image status update).
*   **Download Project State DB:**
    *   **Client:** User clicks "Download Project Data."
    *   **Client Request:** `GET /api/project/download_db?project_id=<uuid>`
    *   **Server:** Sends the project's SQLite DB file.
    *   **Server Response:** File download.
    *   **Client:** Initiates download.

**4.2. Model Management**

*   **Request Model List:**
    *   **Client:** On page load or model selection UI opening.
    *   **Client Request:** `GET /api/models/available`
    *   **Server:** Calls `sam_inference_instance.get_available_model_keys()`, filters list (e.g., 'base' if 'base_plus' exists).
    *   **Server Response:** `{"success": true, "models": ["tiny", "small", "base_plus", "large"], "current_model_key": "base_plus" (or null)}`
    *   **Client:** Populates dropdown, appends an option for "Custom Path" to the end of the list.
*   **Load Model:**
    *   **Client:** User selects a model key or provides custom paths for model and config, sets load parameters (e.g., `apply_postprocessing`), clicks "Load Model."
    *   **Client Request:** `POST /api/model/load` (Body: `{"model_size_key": "large", "apply_postprocessing": true}` OR `{"model_path": "/path/to/model.pt", "config_path": "/path/to/config.yaml", "apply_postprocessing": false}`)
    *   **Server:**
        *   If `model_size_key`: Initiates `sam_inference_instance.load_model(model_size_key=...)`. If model files need downloading via `get_model`, this can take time. Consider an async approach or progress streaming (see below).
        *   If `model_path`: Initiates `sam_inference_instance.load_model(model_path_override=..., config_path_override=...)`.
    *   **Server Response (Initial - if download needed):** `{"success": true, "status": "loading", "message": "Model download/load initiated."}` (Potentially with a task ID for progress polling)
    *   **Server Response (Final):** `{"success": true, "status": "loaded", "model_info": {"key": "large", "path": "...", "config_path": "...", "postprocessing": true}, "message": "Model loaded."}` OR `{"success": false, "error": "Failed to load model"}`
    *   **Client:** Updates UI with model status. Disables interaction during load.
*   **Model Load Progress (Optional - for downloads):**
    *   **Client:** If initial response indicates loading, periodically polls a progress endpoint. `GET /api/model/load_progress?task_id=<task_id>`
    *   **Server:** `get_model` in `sam_backend.py` would need to be adapted to report progress (e.g., update a shared status variable or use a more sophisticated task queue). The imported utils/get_model.py supports a progress_callback. Should be integrated with the server through the backend module.
    *   **Server Response:** `{"success": true, "task_id": "...", "progress": 0.75, "status": "downloading"}`
    *   **Client:** Updates progress bar.
*   **Cancel Model Load (Optional):**
    *   **Client:** User clicks "Cancel."
    *   **Client Request:** `POST /api/model/cancel_load` (Body: `{"task_id": "..."}`)
    *   **Server:** Attempts to interrupt the download/load process (challenging for `hf_hub_download` directly; might require wrapping it or running in a separate thread/process that can be terminated).
    *   **Server Response:** `{"success": true, "message": "Cancellation attempted."}`
*   **Get Current Model:**
    *   **Client:** On page refresh or as needed.
    *   **Client Request:** `GET /api/model/current`
    *   **Server:** Returns info about `sam_inference_instance.current_model_size_key`, `current_model_path`, etc.
    *   **Server Response:** `{"success": true, "model_info": {"key": "large", ... }}` or `{"success": true, "model_info": null}` if no model loaded.
    *   **Client:** Updates UI.

**4.3. Image Source Management**

*   **Add Image Source:**
    *   **Client:** User selects source type (Upload, Server Folder, URL, Azure Blob) and provides necessary details (files, path, URL, Azure URI + credentials alias).
    *   **Client Request:**
        *   Upload: `POST /api/project/<project_id>/sources/add_upload` (Multipart form with files)
        *   Server Folder: `POST /api/project/<project_id>/sources/add_folder` (Body: `{"path": "/server/path/to/images"}`)
        *   URL: `POST /api/project/<project_id>/sources/add_url` (Body: `{"url": "http://example.com/image.jpg or /list_of_images.txt"}`)
        *   Azure Blob: `POST /api/project/<project_id>/sources/add_azure` (Body: `{"uri": "azure://container/path/", "credentials_alias": "default_or_my_creds"}`)
    *   **Server:**
        *   Validates the source.
        *   For Upload: Saves files to `uploads/<project_id>/<image_hash_prefix>/<image_hash>.<ext>`. Calculates hash.
        *   For Folder/URL/Azure: Verifies accessibility. Lists images if source points to a collection. Calculates hashes for each image discovered.
        *   Updates the Project State DB with the new source and adds discovered images (hashes, source paths, initial status "unprocessed") to the image pool table. Avoids adding duplicate hashes.
    *   **Server Response:** `{"success": true, "source_id": "uuid", "images_added": 5, "images_skipped_duplicates": 2, "message": "Source added."}` OR `{"success": false, "error": "Invalid path/URL"}`
    *   **Client:** Updates list of sources and image pool overview.
*   **List Image Sources:**
    *   **Client:** Displaying current sources.
    *   **Client Request:** `GET /api/project/<project_id>/sources`
    *   **Server:** Reads sources from Project State DB.
    *   **Server Response:** `{"success": true, "sources": [{"id": "uuid", "type": "folder", "path": "...", "image_count": 10}, ...]}`
*   **Remove Image Source:**
    *   **Client:** User selects a source and clicks "Remove."
    *   **Client Request:** `DELETE /api/project/<project_id>/sources/<source_id>`
    *   **Server:** Removes the source from Project State DB. Optionally, remove associated images from the pool if they don't belong to other sources (or mark them as "orphaned").
    *   **Server Response:** `{"success": true, "message": "Source removed."}`
    *   **Client:** Updates UI.
*   **Edit Image Source (e.g., update path for a server folder):** Similar flow to Add/Remove.

**4.4. Image Pool and Navigation**

*   **View Image Pool Overview:**
    *   **Client:** User navigates to an overview/gallery widget.
    *   **Client Request:** `GET /api/project/<project_id>/images?page=1&per_page=50&status_filter=unprocessed`
    *   **Server:** Queries Project State DB for images, paginates results. For each image, includes hash, thumbnail path (if pre-generated or a way to request it), status, original filename.
    *   **Server Response:** `{"success": true, "images": [{"hash": "...", "thumbnail_url": "/api/image/thumbnail/...", "status": "in_progress", "filename": "..."}, ...], "pagination": {"total": 100, "page": 1, "per_page": 50}}`
    *   **Client:** Displays gallery with status indicators.
*   **Navigate Images (Next/Previous):**
    *   **Client:** User clicks "Next Unprocessed," "Previous Edited," or selects from gallery.
    *   **Client Request (Next Unprocessed):** `GET /api/project/<project_id>/images/next_unprocessed?current_image_hash=<optional_current_hash>`
    *   **Client Request (Navigate to specific):** `POST /api/project/<project_id>/images/set_active` (Body: `{"image_hash": "selected_hash"}`)
    *   **Server:**
        *   Determines the target image hash based on request and Project State DB.
        *   Updates the server's internal "active image hash."
        *   Calls `sam_inference_instance.set_image()` with the actual image data (fetched from source).
        *   If `set_image` is successful, fetches image data (as base64) and associated mask data for the client.
    *   **Server Response:**
        `{"success": true, "image_hash": "...", "filename": "...", "width": ..., "height": ..., "image_data": "data:image/jpeg;base64,...", "masks": { ... current mask data ... }, "status": "..."}`
        OR `{"success": false, "error": "Image not found or inaccessible"}` (if source is down)
        OR `{"success": true, "message": "No more unprocessed images"}`
    *   **Client:** Loads new image onto canvas, displays existing masks, updates UI.
*   **Mark Image Status:**
    *   **Client:** User clicks "Mark as Completed." (Or implicitly "In Progress" when an edit is made).
    *   **Client Request:** `PUT /api/project/<project_id>/images/<image_hash>/status` (Body: `{"status": "completed"}`)
    *   **Server:** Updates image status in Project State DB.
    *   **Server Response:** `{"success": true, "message": "Status updated."}`
    *   **Client:** Updates UI indicator.

**4.5. Image Annotation Workflow**

**4.5.1. Loading an Image for Annotation**
*   (Covered by Image Pool Navigation - `POST /api/project/<project_id>/images/set_active`)
*   Server loads the image into `sam_inference_instance` using `set_image()`. The actual image data is fetched from its source (upload dir, server path, URL, Azure).
*   Server sends image data (base64 encoded) and any existing persisted masks for this image to the client.

**4.5.2. Automatic Mask Generation**
*   **Client:** User clicks "Generate Auto Masks." Client can provide AMG parameters if UI allows.
*   **Client Request:** `POST /api/project/<project_id>/images/<image_hash>/automask` (Body: `{"points_per_side": 32, "pred_iou_thresh": 0.8, ... AMG params ...}`)
*   **Server:**
    *   Ensures correct image is active in `sam_inference_instance`.
    *   Calls `sam_inference_instance.generate_auto_masks(**params)`.
    *   Receives list of mask annotations.
    *   Persists these masks as a new "automask" layer in the Project State DB for the current `image_hash`. Includes AMG params used.
    *   Converts masks to a client-friendly format (e.g., list of binary mask arrays or RLEs).
*   **Server Response:** `{"success": true, "masks_data": [{"segmentation": [[0,1,...],...], "area": ..., "bbox": ..., ...}, ...], "layer_id": "automask_uuid"}`
*   **Client:** Displays new masks overlaid on the image. Allows user to select/deselect, or potentially merge/edit.

**4.5.3. Interactive Masking (Point/Box Prompts)**
*   **Client:** User draws points (with positive/negative labels) or boxes on the canvas.
*   **Client:** On interaction end (any change in canvas drawing layer: e.g. mouse up after drawing box, points, or input mask, or removing any of the drawing elements, or clearing inputs).
*   **Client Request:** `POST /api/project/<project_id>/images/<image_hash>/predict_interactive` (Body: `{"points": [[x,y], ...] | null, "labels": [1,0,...] | null, "box": [x1,y1,x2,y2] or [[b1x1, b1y1, b1x2, b1y2],[b2x1, b2y1, b2x2, b2y2]], "multimask_output": true, ...}`)
    *   When no points are present the fields `points` and `labels` are `null`. If multiple boxes are supplied the client forces `multimask_output` to `false` so that each box yields a single mask.
*   **Server:**
    *   Ensures correct image is active.
    *   Calls `sam_inference_instance.predict(...)` with provided prompts and parameters.
    *   Receives masks, scores, logits.
    *   Persists these masks as a new "predictions" layer in the Project State DB, including prompts used.
    *   Converts masks for client.
*   **Server Response:** `{"success": true, "masks_data": [...raw mask arrays...], "scores": [...], "layer_id": "interactive_uuid", "multimask_output": bool, "num_boxes": int}` (Logits typically not sent to client unless needed for advanced features). The `multimask_output` and `num_boxes` values represent the final predictor settings after any server-side adjustments (e.g., multiple boxes force `multimask_output=false`).
*   **Client:** Displays the returned masks. When `multimask_output` is true (points or a single box) a radio selector allows choosing between the three score-ranked masks (High, Medium, Low). When multiple boxes are used all masks are shown automatically and the selector is hidden.

**4.5.4. Mask Refinement/Editing (Client-Side)**
*   **Client:** User selects a mask (from automask or interactive prediction) and uses drawing tools (brush, eraser) on the canvas to modify it.
    *   This is primarily a client-side operation. The client keeps track of the "active mask layer" being edited.
    *   The client should maintain an undo/redo stack for these edits.
*   No direct server interaction for each brush stroke.

**4.5.5. Saving/Committing Masks**
*   **Client:** User is satisfied with a set of masks (could be one final merged/edited mask, or a selection of automasks/interactive masks). Clicks "Save Masks" or "Commit Final Mask."
    *   The UI maintains a "Saved Masks" panel showing previously committed masks. Each saved mask remembers the prompts that produced it and can be toggled, renamed or deleted.
*   **Client Request:** `POST /api/project/<project_id>/images/<image_hash>/commit_masks` (Body: `{"final_masks": [ { "segmentation": [[0,1,...],...], "source_layer_ids": ["uuid1", "uuid2"], "name": "object_1" }, ... ], "notes": "user notes" }`)
    *   `final_masks`: An array of mask objects. Each `segmentation` is the binary mask array after client-side edits.
*   **Server:**
    *   Receives the committed mask data.
    *   Converts binary masks to a storage-efficient format (e.g., COCO RLE).
    *   Persists this as a "final_edited" layer or updates an existing "final" layer in the Project State DB for the `image_hash`.
    *   After saving the masks, the server synchronizes the image status with
        existing mask layers. If there is at least one layer, the status becomes
        `in_progress` (unless already `skip`); if all layers are removed later it
        reverts to `unprocessed`.
*   **Server Response:** `{"success": true, "message": "Masks committed.", "final_layer_id": "final_edit_uuid"}`
*   **Client:** Updates UI, possibly locks the committed masks from further easy editing or shows them distinctly.

**4.6. Data Export**
*   **Client:** User selects images (single, all processed, all in project) and export parameters (format, mask type: e.g., only "final_edited" layers, or all raw predictions).
*   **Client Request:** `POST /api/project/<project_id>/export` (Body: `{"image_hashes": ["hash1", "all_completed"], "format": "coco_rle_json", "mask_layers_to_export": ["final_edited", "automask"], "export_schema": "coco_instance_segmentation"}`)
*   **Server:**
    *   Retrieves specified images and their selected mask layers from the Project State DB.
    *   Transforms mask data (e.g., from internal RLE to binary if needed, then to chosen export format).
    *   Formats the data according to the chosen schema (e.g., COCO JSON structure).
    *   Generates a downloadable file (e.g., a ZIP containing JSON files or individual mask images, or one JSON indexing all images (with key: hash or nested source/path/name, and masks as values for each image)).
*   **Server Response:** `{"success": true, "download_url": "/api/project/<project_id>/export/download/<export_task_id>"}` (if async) OR direct file download.
    *   For large exports, an asynchronous task with polling for completion is better.
*   **Client:** Initiates download or polls `download_url`.

---

## 5. API Endpoint Specification (Summary - details derived from workflow)

**Project Management:**
*   `POST /api/project` (Create)
*   `GET /api/projects` (List)
*   `GET /api/project/active` (Get active project)
*   `GET /api/session` (Current project, model, and image)
*   `POST /api/project/load` (Load by ID)
*   `POST /api/project/upload_db` (Upload DB file to load)
*   `GET /api/project/download_db?project_id=<uuid>` (Download DB file)
*   `GET /api/project/<project_id>/settings` (Get project settings)
*   `PUT /api/project/<project_id>/settings` (Update project settings)

**Model Management:**
*   `GET /api/models/available`
*   `POST /api/model/load`
*   `GET /api/model/current`
*   `GET /api/model/load_progress?task_id=<uuid>` (Optional)
*   `POST /api/model/cancel_load` (Optional)

**Image Source & Pool Management:**
*   `POST /api/project/<project_id>/sources/add_upload`
*   `POST /api/project/<project_id>/sources/add_folder`
*   `POST /api/project/<project_id>/sources/add_url`
*   `POST /api/project/<project_id>/sources/add_azure`
*   `GET /api/project/<project_id>/sources` (List sources)
*   `DELETE /api/project/<project_id>/sources/<source_id>` (Remove source)
*   `GET /api/project/<project_id>/images` (List/gallery images from pool, with pagination/filters)
*   `GET /api/project/<project_id>/images/next_unprocessed?current_image_hash=<optional_hash>`
*   `POST /api/project/<project_id>/images/set_active` (Set current image for annotation)
*   `PUT /api/project/<project_id>/images/<image_hash>/status` (Update image status)
*   `GET /api/project/<project_id>/images/<image_hash>/data` (Fetch raw image data if not sent with set_active) - *Potentially combined with set_active*
*   `GET /api/image/thumbnail/<project_id>/<image_hash>` (For gallery view - server generates on demand or pre-generates)

**Annotation:**
*   `POST /api/project/<project_id>/images/<image_hash>/automask`
*   `POST /api/project/<project_id>/images/<image_hash>/predict_interactive`
*   `POST /api/project/<project_id>/images/<image_hash>/commit_masks`
*   `GET /api/project/<project_id>/images/<image_hash>/masks` (Get all mask layers for an image)
*   `DELETE /api/project/<project_id>/images/<image_hash>/layers/<layer_id>` (Delete a specific mask layer)

**Export:**
*   `POST /api/project/<project_id>/export`
*   `GET /api/project/<project_id>/export/download/<export_task_id>` (If async export)

---

## 6. Data Model and Persistence

**6.1. Project State Database (e.g., SQLite)**

*   **`Projects` Table (if managing multiple project DBs from one server instance, less relevant if each project is its own DB file):**
    *   `project_id` (TEXT, PK)
    *   `project_name` (TEXT)
    *   `db_file_path` (TEXT)
    *   `created_at` (TIMESTAMP)
    *   `last_modified_at` (TIMESTAMP)

*   **`Project_Info` Table (within each project's DB):**
    *   `key` (TEXT, PK, e.g., "project_name", "version", "created_at", "last_modified_at_content")
    *   `value` (TEXT)

*   **`Image_Sources` Table:**
    *   `source_id` (TEXT, PK)
    *   `type` (TEXT, e.g., "upload", "folder", "url", "azure_blob")
    *   `details` (TEXT, JSON storing path, URL, URI)
    *   `credentials_alias` (TEXT, nullable)
    *   `added_at` (TIMESTAMP)

*   **`Images` Table:**
    *   `image_hash` (TEXT, PK) - MD5 of original image file.
    *   `original_filename` (TEXT, nullable)
    *   `source_id_ref` (TEXT, FK to `Image_Sources.source_id`)
    *   `path_in_source` (TEXT) - Relative path or identifier within the source. For uploads, this is the server path.
    *   `width` (INTEGER)
    *   `height` (INTEGER)
    *   `status` (TEXT, e.g., "unprocessed", "in_progress", "ready_for_review", "approved", "rejected", "skip")
    *   `added_to_pool_at` (TIMESTAMP)
    *   `last_processed_at` (TIMESTAMP, nullable)
    *   `notes` (TEXT, nullable)

*   **`Mask_Layers` Table:**
    *   `layer_id` (TEXT, PK)
    *   `image_hash_ref` (TEXT, FK to `Images.image_hash`)
    *   `layer_type` (TEXT, e.g., "automask", "interactive_prompt", "final_edited")
    *   `created_at` (TIMESTAMP)
    *   `model_details` (TEXT, JSON: `{"name": "sam2_hiera_b+", "params": {"apply_postprocessing": true}}`)
    *   `prompt_details` (TEXT, JSON, nullable: `{"points": ..., "labels": ..., "box": ..., "amg_params": ...}` etc.)
    *   `mask_data_rle` (TEXT or BLOB) - COCO RLE compressed string.
    *   `metadata` (TEXT, JSON, nullable: `{"scores": [...], "iou_preds": ..., "area": ..., "bbox": ...}`)
    *   `is_selected_for_final` (BOOLEAN, default FALSE) - if this layer contributes to a "final_mask" representation.

*   **`Project_Settings` Table:**
    *   `setting_key` (TEXT, PK, e.g., "current_sam_model", "export_format_default", "ui_theme")
    *   `setting_value` (TEXT, JSON if complex)

**Serialization of `np.ndarray`:** For `prompt_details` and `mask_data_rle`:
*   `point_coords`, `box`, `prompts` (positive/negative point): Store as nested lists in JSON. `np.array(...).tolist()`.
*   `mask_input`: RLE low resolution (as logits) masks from user input.
*   `masks`, `logits`: Convert masks to COCO RLE format (string). Logits are generally not persisted unless a specific use case demands it (they are large).
*   `scores`: Store as a list in JSON.

**6.2. Image Data Storage**
*   Original uploaded images: `project_data/<project_id>/uploads/<first_2_chars_of_hash>/<image_hash>.<original_extension>`
    *   This provides some level of directory sharding.
*   The server loads the image into memory (`sam_inference_instance.image_np`) only when it's the `Active Image`.
*   Thumbnails: Could be generated on-demand and cached, or pre-generated when images are added to the pool and stored similarly to original images in a `project_data/<project_id>/thumbnails/` subdirectory.

---

## 7. Error Handling and Robustness

*   **Client-Side:**
    *   Display user-friendly error messages from server responses.
    *   Timeout for API requests.
    *   Input validation for forms (paths, URLs).
    *   Retry mechanisms for transient network errors (optional).
*   **Server-Side:**
    *   Validate all incoming data (paths, parameters, JSON structure).
    *   Use `try-except` blocks for SAM2 calls, file operations, DB operations.
    *   Log errors comprehensively.
    *   Return appropriate HTTP status codes (400 for bad request, 401/403 for auth, 404 for not found, 500 for server error).
    *   Gracefully handle unavailable image sources (mark images as inaccessible in UI).
    *   Database transactions for operations that modify multiple tables to ensure atomicity.
*   **Synchronization:**
    *   The primary source of truth for persisted data is the server's Project State DB.
    *   The client reflects this state. Optimistic updates in UI can be used, with rollback on server error.
    *   No multi-user simultaneous editing is assumed in this spec. If it were, a locking mechanism or CRDT approach would be needed.

---

## 8. Security Considerations

*   **Input Sanitization:**
    *   Server-side paths: Ensure paths provided by users (for server folders) are validated and restricted to prevent directory traversal attacks (e.g., resolve to absolute path and check if it's within an allowed base directory).
    *   URLs: Validate URL format.
*   **File Uploads:**
    *   Validate file types and extensions.
    *   Store uploaded files outside the web server's document root if possible, or with restrictive permissions.
*   **Credentials (Azure):**
    *   Initially rely on server-side environment variables or default Azure identity.
    *   If user-provided credentials are to be stored, they MUST be encrypted at rest and handled securely (e.g., using a secrets manager). This spec defers complex credential management.


---

## 9. Future Considerations

*   **Multi-user Collaboration:** Locking mechanisms, real-time updates (WebSockets).
*   **Advanced Credential Management:** Integration with Azure Key Vault or similar.
*   **Version Control for Masks:** Allowing users to revert to previous versions of masks.
*   **Batch Processing:** Applying automask or simple prompts to multiple images.
*   **Plugin System:** For custom export formats or import sources.
*   **Machine Learning Model Fine-tuning Interface:** (Highly advanced) Using annotated data to fine-tune SAM or other models.
*   **Internationalization (i18n) and Localization (l10n).**
*   **Accessibility (a11y) improvements.**
*   **Security:**
    *   **Cross-Site Scripting (XSS):** Ensure proper escaping of any user-provided data rendered in HTML. Modern frontend frameworks often handle this by default.
    *   **Cross-Site Request Forgery (CSRF):** Implement CSRF protection if using session-based authentication (e.g., Starlette's session middleware or similar). For token-based APIs, this is less of a concern if tokens are sent in headers.
