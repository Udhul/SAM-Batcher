"""Backend business logic layer.

This module orchestrates interactions between the FastAPI layer
(`server.py`), persistent storage (`db_manager.py`) and the SAM2
inference backend (`sam_backend.py`).  Functions defined here operate
purely on Python data structures and filesystem paths.

Input/Output:
    * Inputs: plain Python values from API handlers or other backend modules.
    * Outputs: dictionaries containing status flags, data for the frontend or
      prepared for database storage.

Key Responsibilities:
    * Project lifecycle management and settings persistence.
    * Image source registration and pool management.
    * Bridging SAM model loading/inference with stored project data.
    * Preparing mask data for storage and for the client.
"""

# project_root/app/backend/project_logic.py
import os
import uuid
import json
import hashlib
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple, BinaryIO
from PIL import Image
import numpy as np

try:
    from .... import config  # For running from within app/backend
    from . import db_manager
    from .sam_backend import SAMInference  # Assuming SAMInference is accessible
    from . import mask_utils
except ImportError:
    import sys

    sys.path.append(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )  # Add project_root to path
    import config
    import app.backend.db_manager as db_manager
    from app.backend.sam_backend import SAMInference
    import app.backend.mask_utils as mask_utils


def get_project_upload_dir(project_id: str, ensure_exists: bool = False) -> str:
    """Gets the base upload directory for a project."""
    path = os.path.join(config.PROJECTS_DATA_DIR, project_id, config.UPLOADS_SUBDIR)
    if ensure_exists and not os.path.exists(path):
        os.makedirs(path, exist_ok=True)
    return path


def get_sharded_image_path(
    project_id: str,
    image_hash: str,
    original_extension: str,
    ensure_dir_exists: bool = False,
) -> str:
    """Gets the sharded path for storing an uploaded image."""
    upload_dir = get_project_upload_dir(project_id, ensure_exists=ensure_dir_exists)
    prefix = image_hash[: config.SHARD_PREFIX_LENGTH]
    shard_dir = os.path.join(upload_dir, prefix)
    if ensure_dir_exists and not os.path.exists(shard_dir):
        os.makedirs(shard_dir, exist_ok=True)
    return os.path.join(
        shard_dir, f"{image_hash}.{original_extension.lower().lstrip('.')}"
    )


def calculate_file_hash(
    file_stream: BinaryIO, algorithm: str = config.IMAGE_HASH_ALGORITHM
) -> str:
    hash_obj = hashlib.new(algorithm)
    file_stream.seek(0)  # Ensure reading from the beginning
    while chunk := file_stream.read(8192):  # Read in chunks
        hash_obj.update(chunk)
    file_stream.seek(0)  # Reset stream position for further use
    return hash_obj.hexdigest()


def get_image_dimensions_from_stream(file_stream: BinaryIO) -> Tuple[int, int]:
    file_stream.seek(0)
    img = Image.open(file_stream)
    width, height = img.size
    file_stream.seek(0)
    return width, height


def get_image_path_on_server_from_db_info(
    project_id: str, image_info_db: Dict[str, Any]
) -> Optional[str]:
    """Resolve the absolute path of an image given its DB record.

    Parameters
    ----------
    project_id : str
        Identifier of the project the image belongs to.
    image_info_db : Dict[str, Any]
        Row from the ``Images`` table as a dictionary.

    Returns
    -------
    Optional[str]
        Absolute path to the image on the server filesystem or ``None`` if it
        cannot be resolved.
    """

    if not image_info_db:
        return None

    image_path = ""
    source_id = image_info_db.get("source_id_ref")
    if source_id:
        sources = db_manager.get_image_sources(project_id)
        source = next((s for s in sources if s["source_id"] == source_id), None)
        if source:
            if source["type"] == "upload":
                image_path = image_info_db.get("path_in_source", "")
            elif source["type"] == "folder":
                image_path = os.path.join(
                    source["details"]["path"], image_info_db.get("path_in_source", "")
                )
            # Other source types (url, azure) not handled in this minimal version

    if not image_path or not os.path.exists(image_path):
        filename = image_info_db.get("original_filename")
        if filename:
            ext = os.path.splitext(filename)[1]
            potential = get_sharded_image_path(
                project_id, image_info_db["image_hash"], ext
            )
            if os.path.exists(potential):
                image_path = potential
            else:
                upload_dir = get_project_upload_dir(project_id)
                prefix = image_info_db["image_hash"][: config.SHARD_PREFIX_LENGTH]
                shard_dir = os.path.join(upload_dir, prefix)
                if os.path.exists(shard_dir):
                    for fname in os.listdir(shard_dir):
                        if fname.startswith(image_info_db["image_hash"] + "."):
                            image_path = os.path.join(shard_dir, fname)
                            break

    return image_path if image_path and os.path.exists(image_path) else None


# --- Project Management ---
def create_new_project(project_name: Optional[str] = None) -> Dict[str, Any]:
    project_id = str(uuid.uuid4())
    if not project_name:
        project_name = config.generate_default_project_name()

    db_manager.init_project_db(project_id, project_name)
    # Create project specific directories
    get_project_upload_dir(project_id, ensure_exists=True)
    # os.makedirs(os.path.join(config.PROJECTS_DATA_DIR, project_id, config.THUMBNAILS_SUBDIR), exist_ok=True) # For future

    return {
        "success": True,
        "project_id": project_id,
        "project_name": project_name,
        "message": "Project created successfully.",
    }


def list_existing_projects() -> List[Dict[str, Any]]:
    project_ids = db_manager.list_project_ids()
    projects_info = []
    for pid in project_ids:
        info = db_manager.get_project_info(pid)
        projects_info.append(
            {
                "id": pid,
                "name": info.get("project_name", "Unknown Project"),
                "last_modified": info.get(
                    "last_modified_at_content", info.get("created_at")
                ),
            }
        )

    projects_info.sort(key=lambda p: p.get("last_modified") or "", reverse=True)
    return projects_info


def rename_project(project_id: str, new_name: str) -> Dict[str, Any]:
    db_manager.set_project_name(project_id, new_name)
    return {"success": True, "project_id": project_id, "project_name": new_name}


def delete_project(project_id: str) -> Dict[str, Any]:
    try:
        db_manager.delete_project_data(project_id)
        return {"success": True, "message": "Project deleted."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def load_project_by_id(project_id: str) -> Optional[Dict[str, Any]]:
    if not os.path.exists(db_manager.get_db_path(project_id)):
        return None
    conn = db_manager.get_db_connection(project_id)
    conn.close()
    info = db_manager.get_project_info(project_id)
    # Could add more data like image count, etc.
    image_list, pagination = db_manager.get_images_from_pool(
        project_id, per_page=0
    )  # Get total count
    return {
        "project_id": project_id,
        "project_name": info.get("project_name"),
        "created_at": info.get("created_at"),
        "last_modified": info.get("last_modified_at_content"),
        "image_count": pagination["total"],
        # Add other relevant summary data
    }


# --- Model Management (Wrappers around SAMInference, potentially with DB persistence of current model) ---
def load_sam_model_for_project(
    project_id: str,
    sam_inference: SAMInference,
    model_size_key: Optional[str] = None,
    model_path_override: Optional[str] = None,
    config_path_override: Optional[str] = None,
    apply_postprocessing: bool = True,
    progress_callback=None,
) -> Dict[str, Any]:
    if not sam_inference.sam_available:
        return {"success": False, "error": "SAM backend unavailable"}

    success = sam_inference.load_model(
        model_size_key=model_size_key,
        model_path_override=model_path_override,
        config_path_override=config_path_override,
        apply_postprocessing=apply_postprocessing,
        progress_callback=progress_callback,
    )
    if success:
        # Persist current model settings to project DB
        db_manager.set_project_setting(
            project_id, "current_sam_model_key", sam_inference.current_model_size_key
        )
        db_manager.set_project_setting(
            project_id, "current_sam_model_path", sam_inference.current_model_path
        )
        db_manager.set_project_setting(
            project_id, "current_sam_config_path", sam_inference.current_config_path
        )
        db_manager.set_project_setting(
            project_id,
            "current_sam_apply_postprocessing",
            str(sam_inference.apply_postprocessing),
        )
        return {"success": True, "model_info": sam_inference.get_model_info()}
    else:
        return {"success": False, "error": "Failed to load SAM model."}


def get_current_model_for_project(
    project_id: str, sam_inference: SAMInference
) -> Dict[str, Any]:
    """Ensure the SAM model associated with a project is loaded and return info."""
    if not sam_inference.sam_available:
        return sam_inference.get_model_info()

    model_key = db_manager.get_project_setting(project_id, "current_sam_model_key")
    model_path = db_manager.get_project_setting(project_id, "current_sam_model_path")
    config_path = db_manager.get_project_setting(project_id, "current_sam_config_path")
    apply_postprocessing_str = db_manager.get_project_setting(
        project_id, "current_sam_apply_postprocessing"
    )
    apply_postprocessing = (
        apply_postprocessing_str.lower() == "true" if apply_postprocessing_str else True
    )

    current_info = sam_inference.get_model_info()
    need_reload = False
    if not current_info.get("loaded"):
        need_reload = True
    else:
        if model_path:
            need_reload |= current_info.get("model_path") != model_path
        elif model_key:
            need_reload |= current_info.get("model_size_key") != model_key
        if current_info.get("apply_postprocessing") != apply_postprocessing:
            need_reload = True

    if need_reload and (model_path or model_key):
        print(f"Loading model for project {project_id} from stored settings...")
        if model_key:
            sam_inference.load_model(
                model_size_key=model_key,
                config_path_override=config_path,
                apply_postprocessing=apply_postprocessing,
            )
        else:
            sam_inference.load_model(
                model_path_override=model_path,
                config_path_override=config_path,
                apply_postprocessing=apply_postprocessing,
            )

    return sam_inference.get_model_info()


# --- Image Source & Pool Management ---
def add_image_source_upload(
    project_id: str, files: List[BinaryIO], filenames: List[str]
) -> Dict[str, Any]:
    source_id = (
        f"upload_{uuid.uuid4().hex[:8]}"  # Generic source ID for this batch of uploads
    )
    source_details = {
        "type": "batch_upload",
        "timestamp": datetime.utcnow().isoformat(),
    }
    db_manager.add_image_source(project_id, source_id, "upload", source_details, None)

    added_count = 0
    skipped_duplicates = 0
    errors = []

    for i, file_stream in enumerate(files):
        original_filename = filenames[i]
        try:
            image_hash = calculate_file_hash(file_stream)
            width, height = get_image_dimensions_from_stream(file_stream)
            original_extension = os.path.splitext(original_filename)[1]

            # Save the file
            saved_path_in_source = get_sharded_image_path(
                project_id, image_hash, original_extension, ensure_dir_exists=True
            )
            file_stream.seek(0)
            with open(saved_path_in_source, "wb") as f_out:
                f_out.write(file_stream.read())

            if db_manager.add_image_to_pool(
                project_id,
                image_hash,
                original_filename,
                source_id,
                saved_path_in_source,
                width,
                height,
            ):
                added_count += 1
            else:
                skipped_duplicates += 1
        except Exception as e:
            errors.append(f"Error processing {original_filename}: {str(e)}")
            print(f"Error processing {original_filename}: {e}")

    return {
        "source_id": source_id,
        "images_added": added_count,
        "images_skipped_duplicates": skipped_duplicates,
        "errors": errors,
    }


def add_image_source_folder(project_id: str, folder_path: str) -> Dict[str, Any]:
    if not os.path.isdir(folder_path):
        return {
            "success": False,
            "error": f"Server folder path not found or not a directory: {folder_path}",
        }

    source_id = f"folder_{uuid.uuid4().hex[:8]}"
    source_details = {"path": folder_path}
    db_manager.add_image_source(project_id, source_id, "folder", source_details, None)

    added_count = 0
    skipped_duplicates = 0
    errors = []
    valid_extensions = (".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp")

    for root, _, files in os.walk(folder_path):
        for filename in files:
            if filename.lower().endswith(valid_extensions):
                original_filepath = os.path.join(root, filename)
                path_in_source = os.path.relpath(
                    original_filepath, folder_path
                )  # Relative path within the source
                try:
                    with open(original_filepath, "rb") as f_stream:
                        image_hash = calculate_file_hash(f_stream)
                        width, height = get_image_dimensions_from_stream(f_stream)

                    if db_manager.add_image_to_pool(
                        project_id,
                        image_hash,
                        filename,
                        source_id,
                        path_in_source,
                        width,
                        height,
                    ):  # Store original full path as path_in_source for server folder
                        added_count += 1
                    else:
                        skipped_duplicates += 1
                except Exception as e:
                    errors.append(f"Error processing {filename}: {str(e)}")

    return {
        "source_id": source_id,
        "images_added": added_count,
        "images_skipped_duplicates": skipped_duplicates,
        "errors": errors,
        "success": True,
    }


# TODO: Implement add_image_source_url and add_image_source_azure as per spec
# These would involve fetching images, hashing, and adding to pool.


def ensure_minimum_image_status(
    project_id: str, image_hash: str, min_status: str
) -> str:
    """Ensure the image's status is at least ``min_status`` in the workflow order.
    Returns the resulting status."""
    order = [
        "unprocessed",
        "in_progress",
        "ready_for_review",
        "approved",
        "rejected",
        "skip",
    ]
    info = db_manager.get_image_by_hash(project_id, image_hash)
    current = info.get("status") if info else None
    try:
        if current is None or order.index(min_status) > order.index(current):
            db_manager.update_image_status(project_id, image_hash, min_status)
            current = min_status
    except ValueError:
        db_manager.update_image_status(project_id, image_hash, min_status)
        current = min_status
    return current or min_status


def sync_image_status_with_layers(project_id: str, image_hash: str) -> str:
    """Update image status based on existing mask layers.

    - If the image has no mask layers, status becomes ``unprocessed`` (unless ``skip``).
    - If there is at least one layer and the current status is ``unprocessed``, it
      becomes ``in_progress``.
    The status ``skip`` is never changed automatically."""

    info = db_manager.get_image_by_hash(project_id, image_hash)
    if not info:
        return "unprocessed"

    current = info.get("status", "unprocessed")
    if current == "skip":
        return current

    layer_count = db_manager.count_mask_layers_for_image(project_id, image_hash)
    if layer_count == 0:
        if current != "unprocessed":
            db_manager.update_image_status(project_id, image_hash, "unprocessed")
            current = "unprocessed"
    else:
        # Automatically move from "unprocessed" to "in_progress" when layers exist.
        # Other states are left untouched so manual status changes persist.
        if current == "unprocessed":
            db_manager.update_image_status(project_id, image_hash, "in_progress")
            current = "in_progress"

    return current


def set_active_image_for_project(
    project_id: str, image_hash: str, sam_inference: SAMInference
) -> Dict[str, Any]:
    image_info_db = db_manager.get_image_by_hash(project_id, image_hash)
    if not image_info_db:
        return {"success": False, "error": "Image not found in project."}

    # Determine the actual path to the image file
    image_path_on_server = ""
    source = None
    if image_info_db.get("source_id_ref"):
        sources = db_manager.get_image_sources(project_id)
        source = next(
            (s for s in sources if s["source_id"] == image_info_db["source_id_ref"]),
            None,
        )

    if source:
        if source["type"] == "upload":
            # path_in_source for uploads is the server path relative to project data dir
            image_path_on_server = image_info_db["path_in_source"]
        elif source["type"] == "folder":
            # path_in_source for folder is relative to the source folder path
            image_path_on_server = os.path.join(
                source["details"]["path"], image_info_db["path_in_source"]
            )
        # Add URL, Azure logic here if needed

    if not image_path_on_server or not os.path.exists(image_path_on_server):
        # Fallback for older data or if path_in_source was not stored correctly for uploads
        if image_info_db.get(
            "original_filename"
        ):  # Try to reconstruct from hash and original_filename extension
            ext = os.path.splitext(image_info_db["original_filename"])[1]
            potential_path = get_sharded_image_path(project_id, image_hash, ext)
            if os.path.exists(potential_path):
                image_path_on_server = potential_path
            else:  # Try to find any file with this hash (extension might have changed)
                upload_dir = get_project_upload_dir(project_id)
                prefix = image_hash[: config.SHARD_PREFIX_LENGTH]
                shard_dir = os.path.join(upload_dir, prefix)
                if os.path.exists(shard_dir):
                    for fname in os.listdir(shard_dir):
                        if fname.startswith(image_hash + "."):
                            image_path_on_server = os.path.join(shard_dir, fname)
                            break
        if not image_path_on_server or not os.path.exists(image_path_on_server):
            return {
                "success": False,
                "error": f"Image file not found on server: {image_path_on_server}",
            }

    try:
        # Load image into SAM backend
        if not sam_inference.set_image(image_path_on_server):
            return {"success": False, "error": "Failed to set image in SAM backend."}

        # Get image data for client
        base64_image_data = sam_inference.get_image_as_base64()
        if not base64_image_data:
            return {"success": False, "error": "Failed to get base64 image data."}

        # Get existing masks for this image
        existing_masks_db = db_manager.get_mask_layers_for_image(project_id, image_hash)

        return {
            "success": True,
            "image_hash": image_hash,
            "filename": image_info_db.get("original_filename"),
            "width": image_info_db.get("width"),
            "height": image_info_db.get("height"),
            "image_data": base64_image_data,
            "masks": existing_masks_db,  # Send all layers, client can filter/display
            "status": image_info_db.get("status"),
        }
    except Exception as e:
        return {"success": False, "error": f"Error setting active image: {str(e)}"}


# --- Annotation ---
def process_automask_request(
    project_id: str, image_hash: str, sam_inference: SAMInference, amg_params: Dict
) -> Dict[str, Any]:
    if not sam_inference.sam_available:
        return {"success": False, "error": "SAM backend unavailable"}
    if not sam_inference.model:
        return {"success": False, "error": "Model not loaded."}
    if sam_inference.image_hash != image_hash:  # Ensure correct image is active
        result = set_active_image_for_project(project_id, image_hash, sam_inference)
        if not result["success"]:
            return result  # Propagate error from set_active_image

    auto_masks_anns = sam_inference.generate_auto_masks(**amg_params)
    if auto_masks_anns is None:
        return {"success": False, "error": "Automask generation failed in backend."}

    layer_id = f"automask_{uuid.uuid4().hex}"
    # For simplicity, store all generated masks as one layer.
    # Client will receive list of individual mask data from this one layer.
    # `mask_data_rle` here could be a list of RLEs if the AMG output provides that directly,
    # or if `sam_inference` prepares it. For now, assume `auto_masks_anns` is the list.
    # The spec for Mask_Layers table expects `mask_data_rle` to be a single RLE or its JSON.
    # This needs careful handling. Let's assume each annotation from AMG is a separate "conceptual" mask
    # but they are part of one "automask generation event" (layer).
    # For client display, each annotation (mask segmentation) is distinct.
    # How to store in DB?
    # Option 1: One Mask_Layers entry, `mask_data_rle` is a JSON list of all RLEs from this AMG run.
    # Option 2: Multiple Mask_Layers entries, one for each annotation. (More complex layer_id)
    # Let's go with Option 1 for `mask_data_rle` in DB, and client parses this list.
    # Or, `sam_inference.prepare_masks_for_export` could be used if AMG output is compatible.
    # The `auto_masks_anns` is a list of dicts, each with 'segmentation' (np.array).

    processed_mask_data_for_db = []
    processed_mask_data_for_client = []

    for ann in auto_masks_anns:
        # ann['segmentation'] is a binary numpy array
        mask_np = ann["segmentation"]
        mask_list_of_lists = mask_np.astype(np.uint8).tolist()  # For client JSON

        # Encode mask for storage using simple RLE
        rle_for_db = mask_utils.binary_mask_to_rle(mask_list_of_lists)

        db_entry_metadata = {
            "area": int(ann.get("area", 0)),
            "bbox": [int(c) for c in ann.get("bbox", [0, 0, 0, 0])],  # XYWH
            "predicted_iou": float(ann.get("predicted_iou", 0.0)),
            "stability_score": float(ann.get("stability_score", 0.0)),
            # 'point_coords': ann.get('point_coords').tolist() if ann.get('point_coords') is not None else None,
            # 'crop_box': [int(c) for c in ann.get('crop_box')] if ann.get('crop_box') is not None else None
        }
        processed_mask_data_for_db.append(
            {
                "segmentation_rle": rle_for_db,  # This should be actual RLE
                "metadata": db_entry_metadata,
            }
        )
        processed_mask_data_for_client.append(
            {  # This is what client's canvas system expects per mask
                "segmentation": mask_list_of_lists,  # This is the binary 2D array
                **db_entry_metadata,
            }
        )

    # Storing a list of masks within one layer's mask_data_rle
    db_manager.save_mask_layer(
        project_id,
        layer_id,
        image_hash,
        "prediction",
        processed_mask_data_for_db,
        source_metadata={
            "type": "automask",
            "model": sam_inference.get_model_info(),
            "amg_params": amg_params,
        },
    )
    new_status = sync_image_status_with_layers(project_id, image_hash)

    return {
        "success": True,
        "masks_data": processed_mask_data_for_client,
        "layer_id": layer_id,
        "image_status": new_status,
    }


def process_interactive_predict_request(
    project_id: str,
    image_hash: str,
    sam_inference: SAMInference,
    prompts: Dict,
    predict_params: Dict,
) -> Dict[str, Any]:
    if not sam_inference.sam_available:
        return {"success": False, "error": "SAM backend unavailable"}
    if not sam_inference.model:
        return {"success": False, "error": "Model not loaded."}
    if sam_inference.image_hash != image_hash:
        result = set_active_image_for_project(project_id, image_hash, sam_inference)
        if not result["success"]:
            return result

    boxes_input = prompts.get("box")
    if boxes_input is not None:
        box_arr = np.asarray(boxes_input)
        num_boxes = box_arr.shape[0] if box_arr.ndim == 2 else 1
    else:
        num_boxes = 0

    multimask_flag = predict_params.get("multimask_output", True)
    if num_boxes > 1:
        multimask_flag = False

    prediction_results = sam_inference.predict(
        point_coords=prompts.get("points"),
        point_labels=prompts.get("labels"),
        box=boxes_input,
        mask_input=prompts.get("mask_input"),  # This should be low-res (e.g. 256x256)
        multimask_output=multimask_flag,
        # return_logits is handled by sam_inference, client doesn't specify
    )

    if not prediction_results:
        return {"success": False, "error": "Interactive prediction failed in backend."}

    masks_np, scores_np, logits_np = (
        prediction_results  # logits_np might be used for next mask_input
    )

    layer_id = f"interactive_{uuid.uuid4().hex}"

    # Prepare masks for the client (binary arrays). Interactive predictions are
    # ephemeral and should not be saved directly to the DB.
    # We still convert masks to simple RLE in case the caller needs it.
    db_mask_list = []  # List of RLEs for potential future use
    client_mask_list = []  # List of binary arrays for client

    flat_scores = []
    if masks_np is not None:
        flat_masks = masks_np.reshape(-1, masks_np.shape[-2], masks_np.shape[-1])
        flat_scores = (
            scores_np.reshape(-1)
            if scores_np is not None
            else [None] * flat_masks.shape[0]
        )
        for i in range(flat_masks.shape[0]):
            mask_arr = flat_masks[i]
            binary_mask_list = mask_arr.astype(np.uint8).tolist()
            client_mask_list.append(binary_mask_list)

            rle_for_db_entry = mask_utils.binary_mask_to_rle(binary_mask_list)

            db_mask_list.append(
                {
                    "segmentation_rle": rle_for_db_entry,
                    "score": (
                        float(flat_scores[i]) if flat_scores[i] is not None else None
                    ),
                }
            )

    # Interactive predictions do not change the persisted image status. Status
    # will update only when mask layers are saved.

    # Client expects 'masks_data' as list of 2D binary arrays, and 'scores'
    return {
        "success": True,
        "masks_data": client_mask_list,
        "scores": (
            flat_scores.tolist()
            if isinstance(flat_scores, np.ndarray)
            else list(flat_scores)
        ),
        "layer_id": layer_id,
        "num_boxes": num_boxes,
        "multimask_output": multimask_flag,
    }


def commit_final_masks(
    project_id: str, image_hash: str, final_masks_data: List[Dict], notes: Optional[str]
) -> Dict[str, Any]:
    # `final_masks_data` is a list from client: [{"segmentation": [[0,1,...]], "source_layer_ids": [...], "name": "obj1"}, ...]
    # Each "segmentation" is a binary mask array from client edits.

    layer_id_base = f"final_edited_{uuid.uuid4().hex}"
    committed_layer_ids = []

    for i, mask_entry in enumerate(final_masks_data):
        binary_mask_array = mask_entry.get("segmentation")
        if not binary_mask_array:
            continue  # Skip if no segmentation data

        # Encode binary mask for storage
        rle_for_db = mask_utils.binary_mask_to_rle(binary_mask_array)

        current_layer_id = f"{layer_id_base}_{i}"
        db_manager.save_mask_layer(
            project_id,
            current_layer_id,
            image_hash,
            "edited",
            rle_for_db,
            name=mask_entry.get("name"),
            display_color=mask_entry.get("display_color"),
            source_metadata={
                "type": "edit_commit",
                "source_layer_ids": mask_entry.get("source_layer_ids"),
                "client_edit_time": datetime.utcnow().isoformat(),
            },
        )
        committed_layer_ids.append(current_layer_id)

    if notes:
        img_info = db_manager.get_image_by_hash(project_id, image_hash)
        existing_notes = img_info.get("notes", "")
        new_notes = (
            f"{existing_notes}\n[{datetime.utcnow().isoformat()}] {notes}".strip()
        )
        # db_manager.update_image_notes(project_id, image_hash, new_notes) # Add this to db_manager

    # Synchronize status with layers after saving masks.
    new_status = sync_image_status_with_layers(project_id, image_hash)
    return {
        "success": True,
        "message": "Masks committed.",
        "final_layer_ids": committed_layer_ids,
        "image_status": new_status,
    }


def delete_mask_layer_and_update_status(
    project_id: str, image_hash: str, layer_id: str
) -> Dict[str, Any]:
    """Delete a mask layer and update image status if no layers remain."""
    db_manager.delete_mask_layer(project_id, layer_id)
    new_status = sync_image_status_with_layers(project_id, image_hash)
    return {"success": True, "message": "Layer deleted.", "image_status": new_status}


def update_mask_layer_basic(
    project_id: str,
    image_hash: str,
    layer_id: str,
    name: Optional[str] = None,
    class_label: Optional[str] = None,
    display_color: Optional[str] = None,
    visible: Optional[bool] = None,
    mask_data_rle: Optional[Any] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    """Update editable attributes of a layer and return success."""
    db_manager.update_mask_layer_basic(
        project_id,
        layer_id,
        name=name,
        class_label=class_label,
        display_color=display_color,
        visible=visible,
        mask_data_rle=mask_data_rle,
        status=status,
    )
    return {"success": True, "message": "Layer updated."}


def get_image_state(project_id: str, image_hash: str) -> Dict[str, Any]:
    """Return the current state for an image including all layers."""
    image_info = db_manager.get_image_by_hash(project_id, image_hash)
    if not image_info:
        return {"success": False, "error": "Image not found"}

    layers_db = db_manager.get_mask_layers_for_image(project_id, image_hash)
    layers = []
    for m in layers_db:
        meta = m.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except json.JSONDecodeError:
                meta = {}
        source_meta = m.get("source_metadata") or {}
        if not source_meta:
            tmp = {}
            if m.get("model_details"):
                tmp["model_details"] = m["model_details"]
            if m.get("prompt_details"):
                tmp["prompt_details"] = m["prompt_details"]
            source_meta = tmp or None
        mask_rle = m.get("mask_data_rle")
        if isinstance(mask_rle, str):
            try:
                mask_rle = json.loads(mask_rle)
            except json.JSONDecodeError:
                pass
        layers.append(
            {
                "layerId": m["layer_id"],
                "name": m.get("name"),
                "classLabel": m.get("class_label") or meta.get("class_label"),
                "status": m.get("status") or m.get("layer_type"),
                "visible": bool(m.get("visible", True)),
                "displayColor": m.get("display_color") or meta.get("display_color"),
                "maskDataRLE": mask_rle,
                "sourceMetadata": source_meta,
                "updatedAt": m.get("updated_at") or m.get("created_at"),
            }
        )

    return {
        "success": True,
        "image_state": {
            "imageHash": image_info["image_hash"],
            "filename": image_info.get("original_filename"),
            "originalWidth": image_info.get("width"),
            "originalHeight": image_info.get("height"),
            "status": image_info.get("status"),
            "layers": layers,
        },
    }


def update_image_state(
    project_id: str, image_hash: str, state: Dict[str, Any]
) -> Dict[str, Any]:
    """Persist image state updates (status and layer attributes)."""
    if "status" in state and state["status"]:
        db_manager.update_image_status(project_id, image_hash, state["status"])

    for layer in state.get("layers", []):
        lid = layer.get("layerId")
        if not lid:
            continue
        name = layer.get("name")
        class_label = layer.get("classLabel")
        display_color = layer.get("displayColor")
        visible = layer.get("visible")
        if any(v is not None for v in (name, class_label, display_color, visible)):
            db_manager.update_mask_layer_basic(
                project_id,
                lid,
                name=name,
                class_label=class_label,
                display_color=display_color,
                visible=visible,
            )
        if layer.get("status"):
            db_manager.update_mask_layer_status(project_id, lid, layer["status"])

    new_status = sync_image_status_with_layers(project_id, image_hash)
    return {"success": True, "image_status": new_status}
