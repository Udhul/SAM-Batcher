#!/usr/bin/env python3
"""Flask API server for the SAM-Batcher application.

This module wires HTTP requests to the business logic defined in
``project_logic`` and ``db_manager``.  It maintains a single
``SAMInference`` instance used for model loading and inference.

Input/Output:
    * Inputs: JSON payloads, form data and file uploads from the frontend.
    * Outputs: JSON responses or files to be downloaded by the client.
"""

# project_root/app/backend/server.py

from flask import Flask, request, jsonify, render_template, send_from_directory, send_file, make_response
import numpy as np # Keep for type hints or direct use if any
import os
import io # For BytesIO
import uuid # For generating IDs if needed directly in server
from werkzeug.utils import secure_filename # For safe filenames
import mimetypes
from typing import Optional
from PIL import Image
from datetime import datetime

# Assuming config.py and other backend modules are in correct relative paths or sys.path is set
try:
    from .... import config # For running from within app/backend
    from .sam_backend import SAMInference, ModelNotLoadedError, ImageNotSetError # Import custom exceptions
    from . import db_manager
    from . import project_logic
    from . import export_logic
except ImportError:
    import sys
    sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..')) # Add project_root to path
    import config
    from app.backend.sam_backend import SAMInference, ModelNotLoadedError, ImageNotSetError
    import app.backend.db_manager as db_manager
    import app.backend.project_logic as project_logic
    import app.backend.export_logic as export_logic


app = Flask(__name__, template_folder='../frontend/templates', static_folder='../frontend/static')

# Global SAMInference instance (consider if this should be per-project or managed differently for scalability)
# For now, one global instance implies one active model and image across all projects.
# The spec implies the SAMInference instance is singular and its active image is managed.
sam_inference_instance: SAMInference = SAMInference()

# Active project ID for the server session.
# This is a simplification. In a multi-user or more robust setup,
# project context would be managed per request (e.g., via URL prefix or session).
ACTIVE_PROJECT_ID: Optional[str] = None


# --- Helper to get active project_id ---
def get_active_project_id() -> Optional[str]:
    # In a real app, this might come from session, JWT token, or URL path component
    global ACTIVE_PROJECT_ID
    return ACTIVE_PROJECT_ID

def set_active_project_id(project_id: str):
    global ACTIVE_PROJECT_ID
    ACTIVE_PROJECT_ID = project_id


# --- UI Routes ---
ui_enabled_flag = True # This can be set by main.py

@app.route('/')
def index():
    if not ui_enabled_flag:
        return jsonify({"message": "API server is running. UI is disabled."}), 404
    return render_template('index.html')

# Static files are served automatically by Flask if static_folder is set correctly.
# This route is redundant if static_folder='../frontend/static' works.
# @app.route('/static/<path:filename>')
# def serve_static(filename):
# if not ui_enabled_flag:
# return jsonify({"message": "Static files not served in API-only mode."}), 404
#     return send_from_directory(app.static_folder, filename)


# --- API Endpoints ---

# == Project Management ==
@app.route('/api/project', methods=['POST'])
def api_create_project():
    data = request.json or {}
    project_name = data.get('project_name')
    result = project_logic.create_new_project(project_name)
    set_active_project_id(result['project_id']) # Set as active on creation
    return jsonify({"success": True, **result})

@app.route('/api/projects', methods=['GET'])
def api_list_projects():
    projects = project_logic.list_existing_projects()
    return jsonify({"success": True, "projects": projects})

# New endpoint: get currently active project
@app.route('/api/project/active', methods=['GET'])
def api_get_active_project():
    project_id = get_active_project_id()
    if not project_id:
        return jsonify({"success": True, "project_id": None, "project_name": None})
    project_name = db_manager.get_project_name(project_id)
    return jsonify({"success": True, "project_id": project_id, "project_name": project_name})

@app.route('/api/project/load', methods=['POST'])
def api_load_project():
    data = request.json
    project_id = data.get('project_id')
    if not project_id:
        return jsonify({"success": False, "error": "project_id is required."}), 400
    
    project_data = project_logic.load_project_by_id(project_id)
    if project_data:
        set_active_project_id(project_id)
        # Attempt to load model associated with this project
        project_logic.get_current_model_for_project(project_id, sam_inference_instance)
        return jsonify({"success": True, "project_data": project_data})
    else:
        return jsonify({"success": False, "error": "Project not found."}), 404

@app.route('/api/project/upload_db', methods=['POST'])
def api_upload_project_db():
    if 'db_file' not in request.files:
        return jsonify({"success": False, "error": "No database file provided."}), 400
    file = request.files['db_file']
    if file.filename == '' or not file.filename.endswith(config.DB_EXTENSION):
        return jsonify({"success": False, "error": f"Invalid file. Must be a {config.DB_EXTENSION} file."}), 400

    # Save the uploaded DB file
    # The project_id will be derived from the filename
    project_id = file.filename[:-len(config.DB_EXTENSION)]
    # Basic sanitization for project_id from filename
    project_id = "".join(c for c in project_id if c.isalnum() or c in ['_', '-'])
    if not project_id:
         return jsonify({"success": False, "error": "Invalid project ID derived from filename."}), 400

    save_path = os.path.join(config.PROJECTS_DATA_DIR, f"{project_id}{config.DB_EXTENSION}")
    
    # Prevent overwriting existing DBs without explicit confirmation (not handled here)
    if os.path.exists(save_path):
        # Simple protection: add a suffix if it exists, or require a force flag.
        # For now, let's just disallow if it's not the active one trying to re-upload itself.
        # This logic needs refinement for robust UX.
        if get_active_project_id() != project_id:
             return jsonify({"success": False, "error": f"Project DB {project_id} already exists on server. Load it or choose a different name."}), 409


    try:
        file.save(save_path)
        # Validate and load
        project_data = project_logic.load_project_by_id(project_id)
        if project_data:
            set_active_project_id(project_id)
            project_logic.get_current_model_for_project(project_id, sam_inference_instance)
            return jsonify({"success": True, "project_data": project_data, "message": "Project DB uploaded and loaded."})
        else:
            os.remove(save_path) # Clean up invalid DB
            return jsonify({"success": False, "error": "Uploaded file is not a valid project database."}), 400
    except Exception as e:
        return jsonify({"success": False, "error": f"Error saving or loading uploaded DB: {str(e)}"}), 500


@app.route('/api/project/download_db', methods=['GET'])
def api_download_project_db():
    # Use query param for project_id to allow downloading non-active project DBs
    project_id = request.args.get('project_id')
    if not project_id:
        project_id = get_active_project_id() # Fallback to active if not specified
    
    if not project_id:
        return jsonify({"success": False, "error": "No project specified or active."}), 400

    db_path = db_manager.get_db_path(project_id)
    if not os.path.exists(db_path):
        return jsonify({"success": False, "error": "Project database not found."}), 404
    
    project_name = db_manager.get_project_name(project_id) or project_id
    download_filename = f"{secure_filename(project_name)}{config.DB_EXTENSION}"

    return send_file(db_path, as_attachment=True, download_name=download_filename)


@app.route('/api/project/<project_id>/settings', methods=['GET', 'PUT'])
def api_project_settings(project_id):
    if project_id != get_active_project_id(): # Ensure operations are on the active project
         # Or, allow reading settings of any project but only writing to active
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403

    if request.method == 'GET':
        settings = {}
        # Example: get all settings, or specific ones if requested
        # For now, let's just fetch the model related ones as an example
        settings['current_sam_model_key'] = db_manager.get_project_setting(project_id, "current_sam_model_key")
        settings['current_sam_apply_postprocessing'] = db_manager.get_project_setting(project_id, "current_sam_apply_postprocessing")
        # Add more settings as needed
        return jsonify({"success": True, "settings": settings})
    
    elif request.method == 'PUT':
        data = request.json
        for key, value in data.items():
            # Add validation for allowed keys and value types
            db_manager.set_project_setting(project_id, key, value)
        return jsonify({"success": True, "message": "Settings updated."})


# == Model Management ==
@app.route('/api/models/available', methods=['GET'])
def api_get_available_models():
    raw_keys = sam_inference_instance.get_available_model_keys()
    # Filter out 'base' if 'base_plus' exists, as per original server.py logic
    models_to_show = [key for key in raw_keys if not (key == 'base' and 'base_plus' in raw_keys)]
    current_model_info = sam_inference_instance.get_model_info()

    return jsonify({
        "success": True,
        "models": models_to_show,
        "current_model_key": current_model_info.get('model_size_key') if current_model_info.get('loaded') else None
    })

@app.route('/api/model/load', methods=['POST'])
def api_load_sam_model():
    project_id = get_active_project_id()
    if not project_id:
        return jsonify({"success": False, "error": "No active project. Load or create a project first."}), 400

    data = request.json
    model_size_key = data.get('model_size_key')
    model_path = data.get('model_path') # model_path_override
    config_path = data.get('config_path') # config_path_override
    apply_postprocessing = data.get('apply_postprocessing', config.DEFAULT_APPLY_POSTPROCESSING)

    # TODO: Integrate progress_callback for model downloads for frontend
    # def progress_callback_for_client(progress_percentage, downloaded_bytes, total_bytes):
    #     # This would need to push data to client (e.g., via WebSockets or Server-Sent Events)
    #     print(f"Model download progress: {progress_percentage:.2f}% ({downloaded_bytes}/{total_bytes})")

    result = project_logic.load_sam_model_for_project(
        project_id, sam_inference_instance,
        model_size_key=model_size_key,
        model_path_override=model_path,
        config_path_override=config_path,
        apply_postprocessing=apply_postprocessing
        # progress_callback=progress_callback_for_client # Uncomment when async progress is implemented
    )
    
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@app.route('/api/model/current', methods=['GET'])
def api_get_current_model():
    project_id = get_active_project_id()
    if not project_id: # If no project active, return global SAM instance state
        return jsonify({"success": True, "model_info": sam_inference_instance.get_model_info()})

    model_info = project_logic.get_current_model_for_project(project_id, sam_inference_instance)
    return jsonify({"success": True, "model_info": model_info})

# Optional: /api/model/load_progress and /api/model/cancel_load if async download is implemented


# == Image Source & Pool Management ==
@app.route('/api/project/<project_id>/sources/add_upload', methods=['POST'])
def api_add_source_upload(project_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    if not request.files:
        return jsonify({"success": False, "error": "No files provided for upload."}), 400

    files = request.files.getlist('files') # Assuming 'files' is the field name for multiple files
    if not files: # Fallback for single 'image' field as in original server.py
        single_file = request.files.get('image')
        if single_file:
            files = [single_file]
        else:
             return jsonify({"success": False, "error": "No files found in 'files' or 'image' field."}), 400
    
    file_streams = [f.stream for f in files]
    filenames = [secure_filename(f.filename) for f in files]

    result = project_logic.add_image_source_upload(project_id, file_streams, filenames)
    return jsonify({"success": True, **result})


@app.route('/api/project/<project_id>/sources/add_folder', methods=['POST'])
def api_add_source_folder(project_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    data = request.json
    path = data.get('path')
    if not path:
        return jsonify({"success": False, "error": "Server folder path is required."}), 400
    
    # Security: Validate path to prevent access outside allowed directories.
    # This is a placeholder; real validation is crucial.
    # E.g., ensure path is within a pre-configured base media directory.
    # For now, we assume the path is trusted or validated by an admin.
    # if not path.startswith("/mnt/allowed_image_data/"):
    #     return jsonify({"success": False, "error": "Access to this path is restricted."}), 403

    result = project_logic.add_image_source_folder(project_id, path)
    return jsonify(result)

# TODO: Endpoints for add_url, add_azure

@app.route('/api/project/<project_id>/sources', methods=['GET'])
def api_list_image_sources(project_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    sources = db_manager.get_image_sources(project_id)
    return jsonify({"success": True, "sources": sources})

@app.route('/api/project/<project_id>/sources/<source_id>', methods=['DELETE'])
def api_remove_image_source(project_id, source_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    db_manager.remove_image_source(project_id, source_id)
    return jsonify({"success": True, "message": "Image source removed."})


@app.route('/api/project/<project_id>/images', methods=['GET'])
def api_list_images_from_pool(project_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    status_filter = request.args.get('status_filter', None, type=str)

    images, pagination = db_manager.get_images_from_pool(project_id, page, per_page, status_filter)
    
    # Augment with thumbnail URLs (placeholder - needs thumbnail generation logic)
    for img in images:
        img['thumbnail_url'] = f"/api/image/thumbnail/{project_id}/{img['image_hash']}" # Define this route later

    return jsonify({"success": True, "images": images, "pagination": pagination})

@app.route('/api/image/thumbnail/<project_id>/<image_hash>', methods=['GET'])
def api_get_image_thumbnail(project_id, image_hash):
    # This is a placeholder for actual thumbnail generation and serving.
    # For now, it could return the full image resized by the browser, or a 404.
    # A real implementation would:
    # 1. Check if thumbnail exists in `projects_data/<project_id>/thumbnails/...`
    # 2. If not, generate it from the original image, save it.
    # 3. Serve the thumbnail file.
    
    # Minimal version: try to serve original if no thumbnail logic
    image_info = db_manager.get_image_by_hash(project_id, image_hash)
    if not image_info or not image_info.get('path_in_source'):
        return jsonify({"success": False, "error": "Image for thumbnail not found."}), 404

    # Resolve the absolute file path for this image using project logic helper
    img_path = project_logic.get_image_path_on_server_from_db_info(project_id, image_info)
    if not img_path or not os.path.exists(img_path):
         return jsonify({"success": False, "error": "Original image file not found for thumbnail."}), 404
    
    try:
        # Simple: send the original image, client can resize. Not efficient.
        # return send_file(img_path)
        
        # Better: generate a small thumbnail on the fly (can be slow for many requests)
        pil_img = Image.open(img_path)
        pil_img.thumbnail((128, 128)) # Resize to max 128x128
        img_io = io.BytesIO()
        pil_img.save(img_io, 'JPEG', quality=70)
        img_io.seek(0)
        return send_file(img_io, mimetype='image/jpeg')

    except Exception as e:
        app.logger.error(f"Thumbnail generation error for {image_hash}: {e}")
        return jsonify({"success": False, "error": "Thumbnail generation failed."}), 500


@app.route('/api/project/<project_id>/images/next_unprocessed', methods=['GET'])
def api_get_next_unprocessed(project_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    current_hash = request.args.get('current_image_hash')
    next_image_info = db_manager.get_next_unprocessed_image(project_id, current_hash)
    if next_image_info:
        # To provide full data, we'd call set_active_image logic here
        return jsonify({"success": True, "image_hash": next_image_info['image_hash'], "filename": next_image_info.get('original_filename')})
        # Or even better, return the full set_active_image response:
        # return jsonify(project_logic.set_active_image_for_project(project_id, next_image_info['image_hash'], sam_inference_instance))
    else:
        return jsonify({"success": True, "message": "No more unprocessed images."}) # No image_hash if none found


@app.route('/api/project/<project_id>/images/set_active', methods=['POST'])
def api_set_active_image(project_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    data = request.json
    image_hash = data.get('image_hash')
    if not image_hash:
        return jsonify({"success": False, "error": "image_hash is required."}), 400
    
    result = project_logic.set_active_image_for_project(project_id, image_hash, sam_inference_instance)
    return jsonify(result)

@app.route('/api/project/<project_id>/images/<image_hash>/status', methods=['PUT'])
def api_update_image_status(project_id, image_hash):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    data = request.json
    status = data.get('status')
    if not status: # Add validation for allowed status values
        return jsonify({"success": False, "error": "New status is required."}), 400
    
    db_manager.update_image_status(project_id, image_hash, status)
    return jsonify({"success": True, "message": "Image status updated."})


# == Annotation ==
@app.route('/api/project/<project_id>/images/<image_hash>/automask', methods=['POST'])
def api_generate_automask(project_id, image_hash):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    
    amg_params = request.json or {}
    try:
        result = project_logic.process_automask_request(project_id, image_hash, sam_inference_instance, amg_params)
        return jsonify(result)
    except (ModelNotLoadedError, ImageNotSetError) as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        app.logger.error(f"Automask error: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Server error during automask: {str(e)}"}), 500

@app.route('/api/project/<project_id>/images/<image_hash>/predict_interactive', methods=['POST'])
def api_predict_interactive(project_id, image_hash):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403

    data = request.json
    prompts = {
        "points": data.get('points'), # Expected as [[x,y], ...]
        "labels": data.get('labels'), # Expected as [1,0,...]
        "box": data.get('box'),       # Expected as [x1,y1,x2,y2] or [[b1x1,...],[b2x1,...]]
        "mask_input": data.get('maskInput') # Expected as 256x256 binary array
    }
    # Convert to numpy arrays within project_logic or sam_backend
    
    # Extract other predict params if any (e.g., multimask_output from client)
    predict_params = {
        "multimask_output": data.get('multimask_output', True)
    }

    try:
        result = project_logic.process_interactive_predict_request(project_id, image_hash, sam_inference_instance, prompts, predict_params)
        # The result['masks_data'] from project_logic should be list of 2D binary arrays
        # The result['scores'] is a list of floats
        return jsonify(result)
    except (ModelNotLoadedError, ImageNotSetError) as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        app.logger.error(f"Interactive predict error: {e}", exc_info=True)
        return jsonify({"success": False, "error": f"Server error during interactive prediction: {str(e)}"}), 500


@app.route('/api/project/<project_id>/images/<image_hash>/commit_masks', methods=['POST'])
def api_commit_masks(project_id, image_hash):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    
    data = request.json
    final_masks = data.get('final_masks') # List of {"segmentation": [[0,1..]], "source_layer_ids": [], "name": ""}
    notes = data.get('notes')

    if not final_masks or not isinstance(final_masks, list):
        return jsonify({"success": False, "error": "final_masks data is missing or invalid."}), 400

    result = project_logic.commit_final_masks(project_id, image_hash, final_masks, notes)
    return jsonify(result)

@app.route('/api/project/<project_id>/images/<image_hash>/masks', methods=['GET'])
def api_get_image_masks(project_id, image_hash):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403
    
    layer_type_filter = request.args.get('layer_type') # e.g., "final_edited"
    mask_layers = db_manager.get_mask_layers_for_image(project_id, image_hash, layer_type_filter)
    # The mask_data_rle in DB might be a JSON string of a list of RLEs (for automask/interactive)
    # or a JSON string of a single RLE (for final_edited). Client needs to handle parsing.
    # Or, server could pre-parse `mask_data_rle` from JSON string to actual list/dict before sending.
    # db_manager.get_mask_layers_for_image already does JSON parsing for some fields.
    return jsonify({"success": True, "masks": mask_layers})


# == Export ==
@app.route('/api/project/<project_id>/export', methods=['POST'])
def api_export_data(project_id):
    if project_id != get_active_project_id():
        return jsonify({"success": False, "error": "Operation only allowed on the active project."}), 403

    data = request.json
    image_hashes_input = data.get('image_hashes', []) # Can be list of hashes, or ["all_completed", "all_in_project"]
    export_format = data.get('format', config.DEFAULT_EXPORT_FORMAT)
    mask_layers_to_export = data.get('mask_layers_to_export', config.DEFAULT_MASK_LAYERS_TO_EXPORT)
    export_schema = data.get('export_schema', "coco_instance_segmentation") # Default or from client

    # For large exports, this should be async.
    # For now, synchronous:
    file_like_object = export_logic.prepare_export_data(
        project_id, image_hashes_input, mask_layers_to_export, export_format, export_schema
    )

    if file_like_object:
        project_name = db_manager.get_project_name(project_id) or project_id
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        
        if export_format == "coco_rle_json":
            filename = f"{secure_filename(project_name)}_coco_export_{timestamp}.json"
            mimetype = 'application/json'
        elif export_format == "zip_binary_masks": # Example for a different format
            filename = f"{secure_filename(project_name)}_binary_masks_{timestamp}.zip"
            mimetype = 'application/zip'
        else:
            filename = f"{secure_filename(project_name)}_export_{timestamp}.dat" # Generic
            mimetype = 'application/octet-stream'
        
        response = make_response(send_file(file_like_object, as_attachment=True, download_name=filename, mimetype=mimetype))
        # Ensure BytesIO is closed after sending
        @response.call_on_close
        def close_stream():
            file_like_object.close()
        return response
    else:
        return jsonify({"success": False, "error": "Failed to generate export data or unsupported format."}), 500

# Placeholder for direct download if async export creates a file
# @app.route('/api/project/<project_id>/export/download/<export_task_id>', methods=['GET'])
# def api_download_export(project_id, export_task_id):
#     # ... logic to find and serve the file for export_task_id ...
#     pass


# --- main.py will call this ---
def run_server(serve_ui=True, host='0.0.0.0', port=5000, debug=True):
    global ui_enabled_flag
    ui_enabled_flag = serve_ui
    
    # Initialize projects_data directory from config
    if not os.path.exists(config.PROJECTS_DATA_DIR):
        os.makedirs(config.PROJECTS_DATA_DIR)
        print(f"Created projects data directory: {config.PROJECTS_DATA_DIR}")
    
    if serve_ui:
        print(f"Starting SAM2 server with API and Web UI on http://{host}:{port}")
    else:
        print(f"Starting SAM2 server with API only on http://{host}:{port}. Web UI routes will be disabled.")
    
    app.run(host=host, port=port, debug=debug)

if __name__ == '__main__':
    # This is for direct execution (testing). `main.py` would be the typical entry point.
    # For testing, let's enable UI and run in debug mode.
    # Create a dummy project if none exist to test loading
    if not db_manager.list_project_ids():
        print("No projects found. Creating a dummy project for testing...")
        dummy_project = project_logic.create_new_project("My Test Project")
        set_active_project_id(dummy_project['project_id'])
        print(f"Dummy project '{dummy_project['project_name']}' (ID: {dummy_project['project_id']}) created and set active.")
    else:
        # Load the first available project as active for testing
        first_project_id = db_manager.list_project_ids()[0]
        set_active_project_id(first_project_id)
        project_name = db_manager.get_project_name(first_project_id)
        print(f"Set active project to '{project_name}' (ID: {first_project_id}) for testing.")


    run_server(serve_ui=True, debug=True)