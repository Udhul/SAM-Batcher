# TODO

## Canvas
### Active todos
* Loading an image in progress after server restart or page reload does not restore its canvas state. It only works when within the same page session. Fix this
### Finished
* Make opacity slider at 100% really mean 100%. currently, masks in the prediction layer, when set at 100% will not cover the image fully in the layer below. So correct the opacity interpretation, so it is fully controlled by the slider, and that it is not influenced by other values, giving the color an initial opacity before the slider adjustment.
* Move "Load Image" button to the Image Sources element,
* Make clear input button, sliders, mask select dropdown, and the info instructions icon all appear on the same line in the canvas toolbar, making a more compact design  (remove "Display Mode:" text before the dropdown) 
* When loading an image from the image pool that already is in progress/completed. then we should reload the canvas data associated with the image. Meaning that we need to load the user inputs and prediction results on to the canvas again, if they were part of the saved state associated with that image. If the saved outputs were automask results, then we load that when loading the image. Basically, when going back and forth between images in the pool, we should reload both the image and the working state of the canvas (inputs and outputs (and later when implemented, custom user masks))
* Regarding prediction inputs (points, negative points, boxes, and lasso masks): We need to be able to draw more that one box as prediction input on the canvas (just like we can draw more than one lasso mask input). Currently, if there's already a box and we try to draw one more on the canvas, the first one gets deleted. 
   * Bounding box(es) in xyxy format. Can be:
     - Single box: np.ndarray([x1, y1, x2, y2])
     - Multiple boxes: np.ndarray([[x1, y1, x2, y2], [x1, y1, x2, y2], ...])
* "Drawings" slider change does not update the corresponding text in the canvas toolbar. Fix it.
* When running prediction with only box(es) as inputs, we don't currently get any results back. This was working in a previous implementation, so we should be able to use the predictor with only a box or boxes as input, as well as the combination of box/boxes, points, masks. Fix running the predictor and getting the results even if only box(es) are provided as inputs.


## Project Management
### Active todos
### Finished
* Implemented project management as a modal overlay triggered by the "Project" bar.
* Overlay opens automatically when no project is active and closes after loading or creating a project.
* The client now calls the server for full session state on page reload using `/api/session`, restoring the project, model and active image automatically. After loading a project the session state is refreshed as well so the model is ready without an extra click.
* Restoring session state also dispatches a `model-load-success` event so the canvas recognizes the loaded model without manual intervention.
* The selected model key (if any) is stored with the project so the same dropdown option is chosen again when the project is reloaded. Custom paths are only used when no key was selected.
* Move image source management to image pool widget, in the form of a button that opens source management in a modal overlay.


## Model Configuration
### Active todos
### Finished
* Make the model selection as an overlay on the page, which fades the background. Like a popup dialogue on page. This popup can be shown by clicking on the "Load Model" button-bar (this bar will show the currently loaded model, staying in sync even on page reload.)
* Post processing checked by default
* Dont sort model size keys prior to building the list of available model keys (They are already listed in the correct order from MODEL_FILES dict).
* When updating the dropdown with the model options, ensure that one of the models, not the custom model path option, is selected by default.

## Image Pool
### Active todos
### Finished
* Add button to manage sources, which will open a modal overlay, with an intuitive ui to manage sources.
  * All source input forms are on display. For the source adders with input fields, when clicking add, the source will be added to the list of sources, and that input field cleared, ready for next input.
  * A wide, scrollable list of sources is shown, with a delete button next to each source.
  * Information about the source type, the source path, and the number of images in the source is shown for each source
  * Expandable list (collapsed by default) of images is shown for each sources, with a checkbox next to each image, allowing to excempt an image from the source by unchecking it. Excempting an image will also remove it from the image pool. And images deleted from the image pool will similarly uncheck an image from the source (they should modify the same underlying data entry).
* Ability to delete one image from the pool (instead of deleting the whole source (which can be a collection of images)). This will add the image to the list of excempted images for a source, for sources where images are requested on demand, such that a deleted image is not just loaded again next time the project is loaded.
* Actually updating the pool when an image or source is removed (currently, it doesn't seem to update the pool correctly, the images stay in the pool (at least visually) after removal). Investigate the behavior to understand how it is handled, and implement the correct behavior.
* Some images fail to generate a thumbnail for the pool. fixed with fallback to a default thumbnail.

## Status Messages
* Should appear on the bottom of the visible page, fading in and out. (lightweight)
* Should show the status of the current operation (loading, saving, processing, etc.)
* Should show the progress of the current operation (if applicable)
* Should show the error message of the current operation (if applicable)
* Should show the success message of the current operation (if applicable)
* Should fade in and out, so it doesn't obstruct the user's view.
* Should be dismissible by the user.
* Should be persistent until the operation is completed (or failed).
* Should be updated in real-time as the operation progresses.
* Should be removed when the operation is completed (or failed).
* Should be shown in the center-bottom of the visible page, so it doesn't obstruct the user's view.
* Should be shown with a half-transparent background color, so it doesn't obstruct the user's view.
* Should be shown with a small font size that it does not take too much space.
* Should be able to disable status messages, or expand to see the "terminal" with all status messages