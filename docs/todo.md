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
* Make the project management as a an overlay on the page, which fades the background. Like a popup dialogue on page. This popup can be shown by clicking on the "Project" bar.
* The prject bar still shows text of the current project, but when we click the bar, it shows the popup overlay insead of expanding.
* If no project is loaded, the popup overlay will be shown automatically. (For example on first page load after server start, we start by showing the project Manager overlay)
* When reloading the page, we will get the active project from the server, so we don't loose the state, and can continue working with the session that we had before reloading, without having to load the project again.
* The project should also save last loaded model and postprocessing setting. When we load the project, then the model with postprocessing setting should be loaded automatically.


## Model Configuration
* Make the model selection as an overlay on the page, which fades the background. Like a popup dialogue on page. This popup can be shown by clicking on the "Load Model" button-bar (this bar will show the currently loaded model, staying in sync even on page reload.)
* Change text "Apply SAM Post-processing" To "Post-processing" And move the checkbox and text on the same line as the model dropdown and "Load Model" button (more compact). 
* Post processing checked by default
* Dont sort model size keys prior to building the list of available model keys (They are already listed in the correct order from MODEL_FILES dict).
* When updating the dropdown with the model options, ensure that the custom model path option appear last in the list, and as such that the custom model path won't be the default selection in the dropdown after the options have been initialized.

## Image Pool
* Ability to delete one image from the pool (instead of deleting the whole source (which can be a collection of images))
* Actually updating the pool when an image or source is removed (currently, it doesn't seem to update the pool correctly, the images stay in the pool (at least visually) after removal). Investigate the behavior to understand how it is handled, and implement the correct behavior.
* Some images fail to generate a thumbnail for the pool

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
* Should be able to disable status messages, or expand to see the "terminal" wit hall status messages