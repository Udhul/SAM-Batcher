# Annotation Workflow Implementation Progress

This document tracks the progress of implementing the features described in
`docs/annotation_workflow_specification.md`.
It will be updated as new sprints add functionality.

## Completed Features
- **Main Layout**: The canvas and Layer View display side by side within the
  `image-section`, matching the specification.
- **Layer View Panel**: Initial controller supports layer listing with
  visibility toggle, color swatch, editable name and class label fields, status
  tag display, selection highlighting and deletion.
- **Add to Layers Workflow**: Predictions can be added to the Layer View instead
  of committing a single final mask. The *Add Empty Layer* button is also
  available.
- **Image Pool Filter**: Filter dropdown includes new statuses
  (`unprocessed`, `in_progress`, `ready_for_review`, `approved`, `rejected`,
  `skip`), and CSS badges reflect these states.
- **Export Logic**: `export_logic.py` accepts filter lists for image and layer
  statuses, builds dynamic COCO categories from layer labels and uses
  `pycocotools` for RLE conversion.
- **Database Helpers**: Added `get_image_hashes_by_statuses` and
  `get_layers_by_image_and_statuses` for more efficient export queries.
- **Image Status Handling**: Backend uses the new status values
  (`unprocessed`, `in_progress`, `ready_for_review`, `approved`, `rejected`, `skip`)
  instead of the legacy `in_progress_auto`, `in_progress_manual` and `completed`.
- **Automatic Status Updates**: Image status now syncs with mask layers. Adding or
  committing layers moves the image to `in_progress` (unless it is `skip`),
  and removing all layers reverts it to `unprocessed`. Interactive predictions
  alone no longer change the status.
- **Status Reversion**: When all mask layers are removed from an image, its status automatically
  reverts to `unprocessed`.
- **Image Pool Refresh**: Status update events now trigger the image pool to reload so changes are visible immediately.

## Partially Implemented / In Progress
- **Active Image State**: `main.js` keeps a basic `activeImageState` with loaded
  layers, but it lacks the complete structure (creation/edit objects) and direct
  synchronization with the backend as described.
- **Layer Data Schema**: Layers are stored with the old `layer_type` field and do
  not yet include `class_label`, `status` (prediction/edited/approved),
  `display_color`, or `source_metadata` columns.
- **Edit Mode Tools**: Selecting a layer only displays its mask; brush/eraser,
  lasso, and other edit tools have not been implemented.
- **Review Mode Interface**: No dedicated review workflow exists yet.

## Planned Tasks (Priority Order)
1. **Database and API Refactor**
   - Migrate the `Images` and `Mask_Layers` tables to the new schema with image
     statuses (`unprocessed`, `in_progress`, `ready_for_review`, `approved`,
     `rejected`, `skip`) and per-layer fields (`class_label`, `status`,
     `display_color`, `source_metadata`, `updated_at`).
   - Adjust CRUD helpers and update existing endpoints to read/write the new
     schema.
   - Introduce `/api/project/<id>/image/<hash>/state` `GET`/`PUT` endpoints for
     full `ActiveImageState` synchronization.
2. **Frontend State Management**
   - Implement the full `ActiveImageState` object with `creation` and `edit`
     subobjects and automatic saving/loading through the new API endpoints.
   - Update `layerViewController` and `canvasController` to operate on this state.
3. **Edit Mode Implementation**
   - Add an `editModeController` with brush/eraser, lasso, and action buttons
     (grow, shrink, smooth, invert, undo/redo, save, cancel).
   - Ensure selecting a layer activates edit mode and saving edits updates the
     layer status to `edited`.
4. **Review Workflow**
   - Provide UI to mark images `ready_for_review` and a streamlined review view
     for approving or rejecting images.
   - Update export and filtering logic to handle the full status lifecycle.
5. **Incremental Enhancements**
   - Persist `display_color` and label information when adding layers.
   - Add update-status dropdown in the annotation view.
   - Improve error handling and autosave of `ActiveImageState` to prevent data
     loss.

The above order follows the staged rollout suggested in the specification:
getting the schema and state management in place will make subsequent editing and
review features easier to build while keeping the application functional.
