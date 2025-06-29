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
  of committing a single final mask. The _Add Empty Layer_ button is also
  available.
- **Image Pool Filter**: Filter dropdown includes new statuses
  (`unprocessed`, `in_progress`, `ready_for_review`, `approved`, `rejected`,
  `skip`), and CSS badges reflect these states.
- **Export Logic**: `export_logic.py` accepts filter lists for image and layer
  statuses, builds dynamic COCO categories from layer labels and uses
  `pycocotools` for RLE conversion.
- **Export Dialog**: Added frontend overlay with options for image selection,
  mask filtering, export format and destination. Backend provides export stats
  and supports saving exports server-side or downloading to the client.
- **Layer Visibility**: Visibility toggles are now stored in the database and
  used as an optional export filter. Overlay exports draw only the visible
  layers when requested.
- **Database Helpers**: Added `get_image_hashes_by_statuses` and
  `get_layers_by_image_and_statuses` for more efficient export queries.
- **Image Status Handling**: Backend uses the new status values
  (`unprocessed`, `in_progress`, `ready_for_review`, `approved`, `rejected`, `skip`)
  instead of the legacy `in_progress_auto`, `in_progress_manual` and `completed`.
- **Automatic Status Updates**: Image status syncs with mask layers. Adding or
  committing layers moves an `unprocessed` image to `in_progress` (unless it is `skip`), and removing all layers reverts it to `unprocessed`. Once an image is marked `ready_for_review` or beyond, its status is not changed automatically. Interactive predictions alone do not alter the status.
- **Status Reversion**: When all mask layers are removed from an image, its status automatically
  reverts to `unprocessed`.
- **Image Pool Refresh**: Status update events now trigger the image pool to reload so changes are visible immediately.
- **Bug Fix**: Removing the final mask layer now correctly changes the image status back to `unprocessed`.
- **Status Toggles**: The annotation view now has "Ready" and "Skip" switches to update image status, dispatching refresh events. Switches are automatically updated when a new image loads and disabled when no image is active.
- **Unified Change Handler**: A new `onImageDataChange()` function synchronizes the layer view, caches and status toggles whenever image or layer data changes.
- **Inline Layer Editing**: Mask name and label fields accept Enter to save changes without deselecting the text field, and edits trigger the unified change handler.
- **Layer Persistence**: Editing a mask's name or class now sends an update to the backend so changes are saved in the project database.
- **Mask Edit Persistence**: Saving edits to a mask now updates its RLE data and status in the database so changes survive reloads.
- **Color Persistence**: Layer colors are stored in the database, including the randomly assigned color when a layer is first created, and can be updated through the layer view.
- **Auto Status Updates**: The unified handler automatically downgrades images from `Ready` to `In Progress` when layers change unless explicitly skipped.
- **Recursion Fix**: Status update events no longer cause infinite loops when UI syncs dispatch further status events.
- **Canvas Modes**: Implemented Creation and Edit display modes. Edit mode highlights selected layers while fading others. When no layer is selected, all layers display at full opacity. Layer masks use their stored colors.
- **Hatched Masks**: Creation and layer masks now render with a diagonal hatch pattern in their assigned color and include a thin outline.
- **Layer Selection Improvements**: Shift-click now supports multi-selection, normal-click deselects the single selected layer, and selections maintain order.
- **Faded Opacity Constant**: Introduced a constant to control faded layer opacity (33%).
- **Layer Ordering**: New layers are inserted at the top of the list.
- **Prediction Clearing**: Selecting layers or adding empty layers now clears creation inputs using `canvasManager.clearAllCanvasInputs`.
- **Default Mode on Load**: Loading an image now enters Edit mode if layers exist and skips legacy prediction data, preventing stray red masks from appearing.
- **Legacy Prediction Removal**: Old code paths for restoring saved prediction masks have been deleted. Existing masks always load as layers.
- **Review Mode**: Added controls to cycle through images marked `ready_for_review` with Approve/Reject/Skip actions and a history-aware **Prev** button.
- **Layer Data Schema**: Mask records now use dedicated columns (`class_labels`, `status`, `display_color`, `source_metadata`, `updated_at`).
- **Active Image State**: `main.js` now maintains a full `ActiveImageState` object including `creation` and `edit` sections. New `/api/project/<id>/image/<hash>/state` endpoints keep this state in sync with the backend.
- **Empty Layer Persistence**: Creating an empty layer now immediately saves it to the database so manual edits are not lost on refresh.
- **Initial Edit Tools**: Selecting a single layer now activates a toolbar with
  a brush tool (hold Ctrl or right-click to erase) and Save/Cancel buttons. A
  circular preview shows the brush size.
- **Advanced Edit Tools**: Lasso add/remove, grow, shrink, smooth, invert and
  undo/redo actions complete the edit toolbar.
- **Edit Toolbar Layout**: Edit tools now sit in a button-column with brush,
  size and lasso on the first row and Grow/Shrink/Smooth/Invert on the next.
  In the second toolbar column, Save and Cancel share the top row styled like
  the creation buttons with Undo/Redo icon buttons centered below.
- **Review Toolbar**: Review mode controls now appear in the canvas toolbar
  with Export and Exit buttons placed in the first column for better spacing.
- **Canvas Zoom & Pan**: Mouse wheel zooms up to 4× the image resolution and middle-drag pans for precise placement. Zoom remains centered on the cursor, pan ends on middle-button release and zoom-pan updates trigger an event for tool UI. Zoom resets when a new image loads.

## Planned Tasks (Priority Order)

1. ~~**Database and API Refactor**~~
   - ~~Migrate the `Images` and `Mask_Layers` tables to the new schema with image
    statuses (`unprocessed`, `in_progress`, `ready_for_review`, `approved`,
     `rejected`, `skip`) and per-layer fields (`class_labels`, `status`,
     `display_color`, `source_metadata`, `updated_at`).~~
   - ~~Adjust CRUD helpers and update existing endpoints to read/write the new
     schema.~~
   - ~~Introduce `/api/project/<id>/image/<hash>/state` `GET`/`PUT` endpoints for
     full `ActiveImageState` synchronization.~~
2. ~~**Frontend State Management**~~
   - ~~Implement the full `ActiveImageState` object with `creation` and `edit`
     subobjects and automatic saving/loading through the new API endpoints.~~
   - ~~Update `layerViewController` and `canvasController` to operate on this state.~~
3. ~~**Edit Mode Implementation**~~
   - ~~Add an `editModeController` with brush/eraser, lasso, and action buttons
     (grow, shrink, smooth, invert, undo/redo, save, cancel).~~
   - ~~Ensure selecting a layer activates edit mode and saving edits updates the
     layer status to `edited`.~~
4. **Review Workflow**
   - Provide UI to mark images `ready_for_review` and a streamlined review view
     for approving or rejecting images.
   - ~~Update export and filtering logic to handle the full status lifecycle.~~
5. **Incremental Enhancements**
   - ~~Persist `display_color` and label information when adding layers.~~
- ~~Add update-status dropdown in the annotation view.~~ Implemented as Ready/Skip toggle switches.
- Improve error handling and autosave of `ActiveImageState` to prevent data
    loss.
- **Tagify Layer Tags**: Layer tags are edited using the Tagify widget with
  auto-suggestions from existing project tags. Suggestions update when tags
  change and appear when focusing the tag field.

