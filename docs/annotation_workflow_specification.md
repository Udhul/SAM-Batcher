# Annotation Workflow Enhancement: Layers, Editing, and Review

## 1. Introduction

This document outlines the design and specification for a major feature enhancement to the SAM2 Interactive Segmenter. The goal is to evolve the application from a single-shot mask generation tool into a robust, multi-layer annotation platform with distinct modes for **Creation**, **Editing**, and **Review**.

This enhancement introduces a **Layer View**, providing users with fine-grained control over individual masks within an image. The new workflow is designed to be intuitive, efficient, and scalable, enabling the creation of high-quality, complex datasets. It prioritizes a smooth user experience by leveraging a reactive frontend state, minimizing blocking operations and server latency.

## 2. Conceptual Design & Workflow

The core of the new system is a three-mode workflow that guides the user through the annotation lifecycle for each image.

### 2.1. The Annotation Lifecycle

An image progresses through the following states and modes:

1.  **Unprocessed:** The initial state of any new image.
2.  **Creation Mode (Default Annotation View):** The user generates initial mask candidates using points, boxes, or AutoMask. Instead of committing final masks, they **add** desired masks to the new **Layer View**. The image status becomes `In Progress`.
3.  **Edit Mode (Annotation View):** The user selects a specific layer from the Layer View. This activates editing tools on the canvas, allowing for manual refinement of the mask. The layer's status can be updated (e.g., to `Edited`).
4.  **Mark for Review:** Once the user is satisfied with all layers for an image, they change the image's status to `Ready for Review`.
5.  **Review Mode (New, Streamlined View):** A dedicated mode for quickly cycling through images marked `Ready for Review`. The reviewer can `Approve` or `Reject` the entire set of masks for an image.
    *   `Approved` images are ready for export.
    *   `Rejected` images are sent back to the `In Progress` state for further editing.
6.  **Export:** The user can export annotations at any time, with filters for different statuses (e.g., only `Approved`).

### 2.2. Visual Workflow

```
                                        +------------------+
                                        |                  |
[Unprocessed Image] -> [Creation Mode] -> "Add to Layers" -> [In Progress Image]
     ^                  |               |                  |           |
     |                  | (Next Image)  |                  |           | (Select Layer)
     |                  v               |                  |           v
     |             [Image Pool] <-------+                  +----> [Edit Mode]
     |                                                   (Refine Mask) |
     |                                                                 |
     | (Changes needed)                                                v
     |                                              "Mark for Review" -> [Ready for Review Image]
     |                                                                 |
+----+-------------+                                                   |
|                  |                                                   v
|   [Review Mode] <----------------------------------------------------+
| (Approve/Reject) |
+--------+---------+
         |
    (Approve)
         |
         v
[Approved Image] -> [Export]
```

---

## 3. Detailed Feature Specification

### 3.1. UI Components & Changes

#### 3.1.1. The Main Annotation Layout

The `main-layout` will be updated to accommodate the new Layer View. A good approach would be a three-column layout within the `image-section`'s parent.

```
+--------------------------------------------------------------------------+
| [Image Pool Section]                                                     |
+--------------------------------------------------------------------------+
| [Canvas & Toolbar]                         | [Layer View]                |
| (Creation/Edit Mode happens here)          | (List of masks for          |
|                                            |  the current image)         |
+--------------------------------------------------------------------------+
| [Final Masks & Export Section] - (updated)                               |
+--------------------------------------------------------------------------+
```

#### 3.1.2. The Layer View

This new panel will be located to the right of the canvas. It is the primary interface for managing masks of the current image.

*   **Mockup:**

    

*   **Components of a Layer Item:**
    *   **Visibility Toggle (Eye Icon):** Show/hide the mask on the canvas. Allows overlaying multiple masks for context.
    *   **Color Swatch:** A non-editable swatch showing the mask's color for easy identification.
    *   **Layer Name:** A user-editable text field. Should default to something like `Mask {n}` or `{Label} {n}`. Must be unique per image.
    *   **Label/Class:** A dropdown or text input for assigning a classification label (e.g., "connector", "cable"). This will be crucial for COCO export.
    *   **Status Indicator:** A colored dot or tag representing the layer's status:
        *   `Prediction` (Blue): Raw mask from SAM2.
        *   `Edited` (Yellow): Manually modified by the user.
        *   `Approved` (Green): Confirmed during review (if per-layer review is added later).
        *   `Rejected` (Red): Marked as incorrect during review.
    *   **Controls:**
        *   **Select for Edit:** Clicking anywhere on the layer item (except controls) selects it, putting the canvas into **Edit Mode** for this layer. The selected layer should be highlighted.
        *   **Delete Button (Trash Icon):** Permanently removes the layer. Requires confirmation.

#### 3.1.3. Canvas & Toolbar Changes

The canvas interaction will be modal, determined by whether a layer is selected for editing.

**A. Creation Mode (No layer selected):**
*   This is the default mode.
*   The UI remains largely the same as the current implementation.
*   **Key Change:** The `Commit Current Masks` button is renamed to `Add to Layers`.
    *   **Functionality:** When clicked, all *visible* masks from the current prediction set (`manualPredictions` or `automaskPredictions`) are converted into new layers in the Layer View.
    *   After adding, all canvas inputs (points, boxes) and current predictions are cleared, returning the user to a clean slate to create the next mask.

**B. Edit Mode (A layer is selected):**
*   **Activation:** The user clicks a layer in the Layer View.
*   **Canvas Display:** Only the selected mask layer is shown on the canvas (or it's highlighted more prominently than other visible layers). Other layers can be toggled for semi-transparent visibility for context.
*   **Toolbar Update:**
    *   The `Clear Inputs` and `AutoMask` buttons are disabled or hidden.
    *   A new **Edit Toolbar** appears, either overlaying the canvas or replacing a section of the main canvas toolbar.
    *   **Edit Tools:**
        *   **Brush:** Add to the mask.
        *   **Eraser:** Remove from the mask.
        *   **Lasso Select:** Add a free-form area to the mask.
        *   **Lasso Deselect:** Remove a free-form area from the mask.
        *   **Grow/Shrink:** Morphological operations to expand or contract the mask by a few pixels.
        *   *(Optional)* **Polygon Tool:** More precise editing than lasso.
    *   **Toolbar Actions:** A `Save Edit` and `Cancel` button should appear. `Save Edit` finalizes the changes to the mask data and sets the layer status to `Edited`.

#### 3.1.4. Image Status & Pool

*   **New Image Statuses:** The possible status enums for an image needs to be of the following types:
    *   `unprocessed` (No added layers, no review)
    *   `in_progress` (has at least one layer, but not marked for review)
    *   `ready_for_review`
    *   `approved`
    *   `rejected` (sent back for edits)
    *   `skip` (user explicitly marks to ignore)
*   The **Image Pool** (`#image-gallery-container`) and its filter (`#image-status-filter`) must be updated to reflect and filter by these new statuses. The `image-status-badge` CSS should be updated with new colors for these states.
*   An `Update Status` dropdown should be added in the main annotation view, perhaps near the image name or in the "Final Masks & Export" section, to allow the user to manually change the image status (e.g., to `Ready for Review`).

### 3.2. Data Model & State Management (Refactored)

This section details the necessary updates to the application's state management and backend database schema to support the new annotation workflow. The design leverages the existing patterns in `stateManager.js` and evolves the schema from `db_manager.py`.

#### 3.2.1. Frontend State Management

The application's state will be managed at two levels:

1.  **Global State (`StateManager`):** The existing `stateManager.js` is well-suited for its purpose and will continue to manage global, non-image-specific context like `activeProjectId`, `activeImageHash`, and `currentLoadedModelInfo`. Its role as an event dispatcher for global changes remains critical.

2.  **Active Image State (`ActiveImageState`):** To manage the complexity of the annotation view for a single image, we will introduce a new, comprehensive in-memory object. This object will be the **single source of truth** for the currently loaded image, its layers, and all ephemeral creation/editing data. It will be loaded when an image is selected and cleared or saved when navigating away.

**Proposed `ActiveImageState` Object Structure:**

This object will be managed by the main application controller and passed to the relevant modules (`canvasController`, `layerViewController`, `editModeController`).

```javascript
// Example structure for the state of the currently loaded image.
// This object is created when an image is loaded for annotation.
const ActiveImageState = {
    // === Image-level Data (from 'Images' table) ===
    imageHash: "hash-of-W53010017_g.jpg",
    filename: "W53010017_g.jpg",
    originalWidth: 1920,
    originalHeight: 1080,
    status: "in_progress", // 'unprocessed', 'in_progress', 'ready_for_review', 'approved', 'rejected', 'skip'

    // === Layer Data (from 'mask_layers' table) ===
    layers: [
        {
            layerId: "uuid-1a2b-3c4d",         // PK from DB
            name: "Top Connector",             // User-editable name
            classLabel: "connector",           // User-defined class/category
            status: "prediction",              // 'prediction', 'edited', 'approved', 'rejected'
            visible: true,                     // UI toggle state
            displayColor: "hsla(120, 80%, 50%, 0.7)", // Color swatch in UI
            maskDataRLE: { /* COCO RLE object for a SINGLE mask */ },
            sourceMetadata: { // How the mask was created (from DB)
                type: "interactive_prompt", // 'automask' or 'interactive_prompt'
                model: { name: "sam2_hiera_b+", postprocessing: true },
                prompt: { points: [/*...*/], boxes: [/*...*/] }
            },
            updatedAt: "2023-10-27T10:00:00Z"
        },
        // ... more layer objects
    ],

    // === Ephemeral UI State (Not persisted directly, used for live interaction) ===
    creation: {
        // Data from a fresh SAM2 prediction, before being added to layers
        predictions: [/* SAM2 output masks from API response */],
        // The user inputs that generated the above predictions
        activeInputs: { points: [], boxes: [], drawnMasks: [] },
        // Tracks which of the multiple predictions are selected in the UI
        selectedPredictionIndices: [0]
    },
    edit: {
        // State for when a layer is being actively edited
        activeLayerId: null, // "uuid-1a2b-3c4d" or null
        // A copy of the original mask data to allow for cancellation
        originalMaskData: null,
        // History for undo/redo operations during an edit session
        editHistory: [],
    }
};
```

#### 3.2.2. Backend Database Schema (Refactored)

The existing schema in `db_manager.py` is a strong starting point. The following changes will adapt it to the new workflow, focusing on clarity, normalization, and extensibility.

**`Images` Table**

The `status` column will be repurposed to track the new, richer workflow states.

| Column | Type | Description |
| :--- | :--- | :--- |
| `image_hash` | TEXT | PRIMARY KEY. No change. |
| ... | | Other columns as-is. |
| **`status`** | TEXT | **Updated Usage.** Tracks the image's overall annotation progress. Allowed values: `'unprocessed'`, `'in_progress'`, `'ready_for_review'`, `'approved'`, `'rejected'`, `'skip'`. |
| ... | | Other columns as-is. |

**`Mask_Layers` Table (Refactored)**

This table will be significantly refactored to represent a single, unique mask layer per row. This is a crucial change from the old model where one row could implicitly represent multiple masks.

| Column | Type | Description |
| :--- | :--- | :--- |
| `layer_id` | TEXT | PRIMARY KEY (UUID). No change. |
| `image_hash_ref` | TEXT | FK to `Images`. No change. |
| `name` | TEXT | The user-editable name for the layer (e.g., "Left Connector"). |
| **`class_label`** | TEXT | **New.** The classification label for the mask (e.g., "cable", "port"). |
| **`status`** | TEXT | **New.** Replaces the ambiguous `layer_type`. Tracks the layer's state: `'prediction'`, `'edited'`, `'approved'`, `'rejected'`. |
| `mask_data_rle` | TEXT | **Updated Usage.** Stores the COCO RLE data (as a JSON string) for a **single mask**. |
| **`source_metadata`** | TEXT | **New/Consolidated.** JSON object storing how the mask was generated. Combines old `model_details` and `prompt_details` for better traceability. Ex: `{"type": "automask", "params": {...}}` or `{"type": "interactive", "prompt": {...}}`. |
| **`display_color`** | TEXT | **New.** Stores the UI display color (e.g., "hsla(...)") to ensure consistency across sessions. |
| `created_at` | TEXT | No change. |
| `updated_at` | TEXT | **New.** Timestamp for the last modification to the layer. |

**Obsolete Columns from old `Mask_Layers` table:**
*   `layer_type`: Replaced by the more descriptive `status` column.
*   `model_details`, `prompt_details`: Consolidated into the new `source_metadata` JSON column.
*   `metadata`: This generic field can be absorbed into `source_metadata` or kept for other layer-specific properties if needed. For clarity, we'll start by moving its contents (like `scores`) into `source_metadata`.
*   `is_selected_for_final`: Replaced by the layer and image `status` system.

#### 3.2.3. Data Synchronization Strategy

The synergy between the `ActiveImageState` object and the backend API is key to a smooth user experience.

1.  **Load:**
    *   When a user selects an image from the pool, the frontend sends a request to a new endpoint: `GET /api/project/{id}/image/{hash}/state`.
    *   The backend retrieves the image's row from the `Images` table and all associated rows from the refactored `mask_layers` table.
    *   It assembles and returns a JSON object matching the `ActiveImageState` structure (without the ephemeral `creation` and `edit` parts).
    *   The frontend populates its local `ActiveImageState` with this data.

2.  **Interact:**
    *   All user actions in the annotation view (adding a point, toggling visibility, renaming a layer) modify the local `ActiveImageState` object *first*.
    *   The UI components (Canvas, Layer View) are rendered reactively based on this local state, ensuring instant feedback.

3.  **Save:**
    *   Changes are persisted to the backend via a `PUT /api/project/{id}/image/{hash}/state` endpoint. This endpoint receives the relevant parts of the `ActiveImageState` object.
    *   **Adding Layers:** When the user clicks "Add to Layers", the frontend takes the `predictions` from `ActiveImageState.creation`, formats them into new layer objects, and sends them to the backend. The backend is responsible for unpacking this and creating **multiple new rows** in the `mask_layers` table, one for each added mask.
    *   **Updating Layers:** Changing a layer's name, label, or saving an edit sends the updated layer object to the backend, which performs an `UPDATE` on the corresponding row in `mask_layers`.
    *   **Deleting a Layer:** This triggers a `DELETE` request for the specific `layer_id`.
    *   **Changing Image Status:** This updates the `status` field in the `Images` table.
    *   Saving should be debounced for frequent actions (like renaming) and triggered automatically on key state changes or when navigating away from the image to prevent data loss.

### 3.3. Export Functionality (Refactored)

This section refactors the export specification to align with the new layer-based data model and provide robust, standard-compliant output for computer vision tasks. It provides clear guidance for updating `export_logic.py` and its interaction with the frontend.

#### 3.3.1. Core Principles

The export functionality will be guided by three core principles:

1.  **Dynamic Category Generation:** The COCO `categories` list will not be hardcoded. It will be dynamically generated based on the unique `class_label` values assigned to the layers being exported. This is essential for training multi-class models.
2.  **Flexible Filtering:** Users must be able to filter what they export based on the annotation workflow status. The primary filters will be the `status` of an **image** (e.g., `approved`) and the `status` of its **layers** (e.g., `edited`, `approved`).
3.  **Correct COCO Schema Mapping:** Each exported `Mask_Layer` row from the database will map directly to a single entry in the COCO `annotations` array, ensuring a clean 1-to-1 correspondence.

#### 3.3.2. The Export Process: A Step-by-Step Guide

The following details the end-to-end process, from the user's click to the final file download.

##### **Step 1: Frontend Request & API Payload**

The frontend (`main.js`) needs to be updated. Instead of sending `mask_layers_to_export` with old `layer_type` values, it will send a payload that reflects the new filtering needs.

*   The "Export COCO JSON" button will trigger a request with a new payload structure.
*   The `apiClient.requestExport` method will be called with this new payload.

**Example New API Payload (`/api/project/{id}/export`):**

```json
{
  "format": "coco_rle_json",
  "schema": "coco_instance_segmentation",
  "filters": {
    "image_statuses": ["approved"], // e.g., only export 'approved' images
    "layer_statuses": ["edited", "approved"] // e.g., only include layers that are 'edited' or 'approved'
  }
}
```

*   `image_statuses`: An array of strings specifying which images to include based on their top-level status. Keywords like `"all"` could also be supported.
*   `layer_statuses`: An array of strings specifying which layers within those images to include.

##### **Step 2: Backend Image & Layer Selection (`export_logic.py`)**

The `prepare_export_data` function in `export_logic.py` must be refactored to use these new filters.

1.  **Query for Images:** First, query the `Images` table to get a list of all `image_hash` values that match one of the `image_statuses` in the filter.
    ```python
    # In db_manager.py, a new function would be useful:
    # get_image_hashes_by_statuses(project_id, statuses: List[str]) -> List[str]
    ```
2.  **Query for Layers:** For the collected image hashes, query the `Mask_Layers` table to get all layers that match one of the `layer_statuses` in the filter. This can be done in a single efficient query.
    ```python
    # In db_manager.py:
    # get_layers_by_image_and_statuses(project_id, image_hashes: List[str], layer_statuses: List[str]) -> List[Dict]
    ```

##### **Step 3: Dynamic Category Mapping (`export_logic.py`)**

This is a critical new step. Before creating the annotation entries, the logic must build the category map.

1.  From the list of all layers retrieved in Step 2, extract all unique `class_label` values.
2.  Create the `categories` list for the COCO JSON file. Each entry will have a unique `id` and `name`.
3.  Create an in-memory dictionary `category_map = {"label_name": category_id, ...}` for fast lookups when building the annotations.

**Example Implementation Snippet:**
```python
# In export_logic.py
def prepare_export_data(...):
    # ... after fetching layers from DB ...
    all_layers = db_manager.get_layers_by_image_and_statuses(...)
    
    # --- Step 3: Dynamic Category Mapping ---
    unique_labels = sorted(list(set(layer['class_label'] for layer in all_layers if layer['class_label'])))
    category_map = {label: i + 1 for i, label in enumerate(unique_labels)}
    
    coco_output = _prepare_coco_structure(...) # Initial structure
    coco_output['categories'] = [
        {"id": cat_id, "name": label, "supercategory": label.split('_')[0]} # Example supercategory logic
        for label, cat_id in category_map.items()
    ]
    # ... continue to Step 4 ...
```

##### **Step 4: Building COCO `images` and `annotations` (`export_logic.py`)**

With the category map in place, the logic can now populate the rest of the COCO file.

1.  Iterate through the selected images to create the `images` array in the COCO JSON. Store a mapping of `image_hash` to the new COCO `image_id`.
2.  Iterate through the selected `all_layers` list. For each layer:
    a. **Get `category_id`:** Use the `category_map` to find the `category_id` from the layer's `class_label`. If the label doesn't exist in the map (e.g., it was null), skip this layer or assign a default.
    b. **Parse RLE:** The `mask_data_rle` column now contains a JSON string of a single COCO RLE object. Parse it with `json.loads()`.
    c. **Calculate Bbox & Area:** Use a reliable library (see 3.3.3) to calculate the `bbox` (`[x, y, width, height]`) and `area` from the parsed RLE object.
    d. **Assemble Annotation:** Create the final annotation dictionary and append it to `coco_output['annotations']`.

**Example Annotation Assembly:**
```python
# Continuing in export_logic.py
annotation_id_counter = 1
for layer in all_layers:
    image_id = image_hash_to_coco_id_map[layer['image_hash_ref']]
    category_id = category_map.get(layer['class_label'])

    if not category_id:
        continue # Skip layers with no valid category

    rle_obj = json.loads(layer['mask_data_rle'])
    bbox, area = _convert_rle_to_bbox_and_area(rle_obj) # Use a proper library here

    annotation = {
        "id": annotation_id_counter,
        "image_id": image_id,
        "category_id": category_id,
        "segmentation": rle_obj, # The direct RLE object
        "area": area,
        "bbox": bbox,
        "iscrowd": 0,
        "attributes": { # Custom attributes can be added here
            "layer_name": layer['name'],
            "layer_status": layer['status'],
            "source_metadata": json.loads(layer['source_metadata']) if layer.get('source_metadata') else None
        }
    }
    coco_output['annotations'].append(annotation)
    annotation_id_counter += 1
```

#### 3.3.3. Recommended Library for RLE Handling

The placeholder `_convert_rle_to_bbox_and_area` function is insufficient and error-prone. To ensure compatibility with the COCO standard and accurate calculations, it is **highly recommended** to integrate `pycocotools` into the export logic (already part of installed project dependencies.)


*   **Usage:**
    ```python
    from pycocotools import mask as mask_utils

    def _convert_rle_to_bbox_and_area(rle: Dict) -> Tuple[List[int], int]:
        """Converts a COCO RLE object to a bounding box and area."""
        if not rle or 'counts' not in rle or 'size' not in rle:
            return [0, 0, 0, 0], 0
        
        # pycocotools functions can be sensitive to the type of 'counts'
        # Ensure it's bytes if it was stored as a decoded string in JSON
        if isinstance(rle['counts'], str):
            rle['counts'] = rle['counts'].encode('utf-8')
            
        bbox = mask_utils.toBbox(rle).tolist()
        area = mask_utils.area(rle).item()
        return bbox, area
    ```

#### 3.3.4. Summary of Required Code Refactoring

*   **`main.js`:** Update the `exportCocoBtn` event listener to construct and send the new API payload with `filters` for `image_statuses` and `layer_statuses`.
*   **`server.py`:** Update the `/api/project/{id}/export` endpoint to parse the new payload structure and pass the filters to `export_logic.prepare_export_data`.
*   **`export_logic.py`:** This file requires the most significant changes:
    1.  Update the `prepare_export_data` function signature to accept the new `filters` dictionary.
    2.  Remove the old loop over `layer_type_filter`.
    3.  Implement the new two-pass logic: first pass to build the dynamic `categories` list, second pass to build the `annotations`.
    4.  Update all database queries to use the new filter parameters (`image_statuses`, `layer_statuses`).
    5.  Replace the placeholder RLE handling with a robust implementation using `pycocotools`.
    6.  Simplify RLE parsing logic, as each `mask_data_rle` field now corresponds to a single mask.
*   **`db_manager.py`:** Add new helper functions for querying images and layers by their respective status lists to support the export logic efficiently.

---

## 4. Implementation Guidance & Best Practices

1.  **Modularize:** Do not bloat `canvasController.js`. Create new modules:
    *   `layerViewController.js`: Manages the Layer View panel, its state, and events.
    *   `editModeController.js`: Manages the edit toolbar and canvas interactions specific to editing a mask. It would be activated by `canvasController`.
    *   `stateManager.js` will become even more critical for managing the `currentImageState`.

2.  **Performance:**
    *   **Canvas:** When editing a mask, use an offscreen canvas. Draw the original mask onto it, perform all edits (brush, eraser) on this offscreen canvas, and only when "Save Edit" is clicked, re-encode the result to RLE and update the `ImageState`. This prevents costly re-rendering of all layers on every mouse move.
    *   **Data:** Use efficient data formats (RLE for masks) and only send deltas (changed data) to the backend if possible, although sending the full state object is simpler to implement and acceptable for a single image.

3.  **Incremental Rollout:** Implement the features in stages.
    *   **Stage 1: Creation & Layer View:** Implement the "Add to Layers" button, the Layer View panel (display only), and the underlying data model changes. Get the core loop of creating and accumulating masks working.
    *   **Stage 2: Edit Mode:** Implement the selection of a layer and the full suite of editing tools.
    *   **Stage 3: Review Mode & Statuses:** Implement the image status system and the dedicated review interface.

4.  **Fault Tolerance:** The frontend state should be the source of truth. If a backend save fails, the UI should not break. Notify the user with a small, non-blocking toast message and allow them to retry saving. Periodically saving the `ImageState` to the browser's `localStorage` can prevent data loss on accidental page reloads.