# Roles of Server and Client

## Model Selection and Loading
- Client requests model list from server
- Server uses SAMInference().get_available_model_keys() to get the list. 
  - Server removes double instance base and base plus if existing, since they refer to the same model.
  - Server sends the result to the client
- Client populates the selection dropdown with the model list
  - Client adds an option to input the path manually
- Upon model selection and Load click in the UI, the client sends the choice to the server
  - Server then loads the model and returns a signal upon completion. Success/Fail, Status
  - For model download, the server can stream the progress to the client
  - The client can cancel model loading/download, sending an interrupt signal to the server
- The client can request currently loaded model lfrom the server at any time, for example on page refresh
- The client can switch the model any time again.
- The client can set load parameters for the model, such as post process, or other params available for model load from the backend, can be exposed top the client as options.

## Image Source
- The image source can be: 
  - One or more uploads from the client
  - A folder on the server (Path given by the client)
  - A URL for image/ images
  - A URI/ BLOB datastore reference (Support for Azure context). 
    - Credentials can be set up in the UI by the client, or via an environment variable, from the server runtime, or the server can attempt to use the default credentials which may work if the server is being run from an azure compuute instance.
- Multiple images/ image sources can be added to the pool of images.
- The client can review and manage (add/remove/edit) sources currently in the pool, and also single images from any of the sources. The server will keep a registry with 
- Images in the pool will not be loaded by the server runtime yet, but for images uploaded by the client, they will be stored on the server in a folder, "uploads", or another destination folder specified by the server.
- The user can step through the images in the pool, and create the masks for each image, interacting woth the canvas until having reached the desired masks. Then the user can step on to the next image in the pool. 
- Once an image has associated predictions with it (from canvas interactions (manual predictions) or automasks, or manual edits), then the server will flag the image as processed
- When stepping through the images in the pool, the user can click to next unprocessed image
- The user can also step back through the last edited images list, to change something.
- The user can open an overview of all images in the pool, and see which images have been processed, and which have not.
- There should be different indicators for how the image has been processed. - One for automask, one for manual predictions, one for manual mask edits, one for completed.
- The user can mark an image as completed when satisfied, and go to next (one click). If an image has not been marked completed, then there will be a marker for either in unprocessed (white), in process (yellow), completed (green)
- The server will keep a structured database of the images added to the pool, and their status, and the predictions from automask, manual predictions, and manual mask edits by the user.


### Example encoding schema. types and content should be serialized:

```python
db_dict = {
    "unique imagehash": {
        "source": "client/server/blob", # one of these 3
        "path": "specific path on the source", # if source is client (from upload), path here will be the upload image name
        "width": int,
        "height": int,
        "inputs": { # User drawing inputs on the canvas and args used to make the predictions
            "point_coords": Optional[np.ndarray], 
            "point_labels": Optional[np.ndarray], # defining if each point above is positive/negative
            "box": Optional[np.ndarray], # can be multiple boxes in the aray. Format example single: np.array([x1, y1, x2, y2]) or multiple: np.array([[b1x1, b1y1, b1x2, b1y2],[b2x1, b2y1, b2x2, b2y2]])
            "mask_input": Optional[np.ndarray],
            "multimask_output": bool ,
            "normalize_coords": bool,
            "return_logits_to_caller": bool,
            "sort_results": bool
        },
        # When no points are given the fields `point_coords` and `point_labels` are None.
        # If more than one box is supplied the predictor runs with `multimask_output=False` automatically.
        "outputs": { # Prediction outputs. Returned masks. Optional: keys inside set to None if no predictions returned yet
            "model": dict, # dict containing the model (name) used to get the prediction outputs, and the other args parsed into the model (is model built with post processing or not)
            "masks": np.ndarray,
            "scores": np.ndarray,
            "logits": np.ndarray,
            "final_masks": np.ndarray # The masks chosen by the user, with edits applied by the user (refining the mask)
        },
        "automask": ... # inputs to the automask predictor and results of automask predictions if available

    },
}

# Other metadata such as load timestamp, last prediction/edit timestamp, etc. project name, creation, last edit metadate at the project level.
```

- We don't store the image data b64 in the persistance db, since we store references that can identify the original image instead (hash/soruce/path). So the image data is kept in memory for the currently opened image by the server, and used to send back and forth between the client and the server. When moving to a new image, we update the active image hash.
- The state database can persist between sessions.
- The client can name a state db, and re-open it later.
- The client can download/upload the state db from the server
- If images/sources have become unavailable since last session etc., it will be handled gracefully by the server, showing unavailable sources or images as unavailable in the pool of images.
- The client can export predictions/edits for a single image or for the whole pool, using a format of choice:
  - Choice of which predictions/edits to export
  - Choice of format (json, csv, etc.) 
  - Choice of schema: ML image mask annotation standard formats supported.
  - Mask form: 'binary_mask', 'uncompressed_rle', or 'coco_rle'
- Latest model selection and params, export choices, ui settings will be saved as part of the project state