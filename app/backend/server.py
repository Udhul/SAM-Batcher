#!/usr/bin/env python3
"""FastAPI server for the SAM-Batcher application.

This module exposes the web API and UI routes using FastAPI. It mirrors the
previous Flask based implementation but leverages FastAPI's asynchronous
capabilities. Business logic lives in ``project_logic`` and related modules.
"""

import os
import io
from datetime import datetime
from typing import Optional, List

from werkzeug.utils import secure_filename
from PIL import Image

from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Depends
from fastapi.responses import (
    JSONResponse,
    HTMLResponse,
    FileResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.concurrency import run_in_threadpool

try:
    from .... import config  # when running from package
    from .sam_backend import SAMInference, ModelNotLoadedError, ImageNotSetError
    from . import db_manager, project_logic, export_logic
except Exception:  # pragma: no cover - fallback for direct execution
    import sys

    sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
    import config
    from app.backend.sam_backend import (
        SAMInference,
        ModelNotLoadedError,
        ImageNotSetError,
    )
    import app.backend.db_manager as db_manager
    import app.backend.project_logic as project_logic
    import app.backend.export_logic as export_logic

app = FastAPI()

APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEMPLATES_DIR = os.path.join(APP_DIR, "frontend", "templates")
STATIC_DIR = os.path.join(APP_DIR, "frontend", "static")
ASSETS_DIR = os.path.join(APP_DIR, "frontend", "assets")

# Serve assets from a dedicated '/assets' path to avoid clashes with '/static'
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Global SAMInference instance
_cuda_idx = (
    int(config.CUDA_DEVICE)
    if getattr(config, "CUDA_DEVICE", None) is not None
    else None
)
sam_inference_instance: SAMInference = SAMInference(cuda_device_index=_cuda_idx)

# Active project id stored in memory (single user assumption)
ACTIVE_PROJECT_ID: Optional[str] = None


def get_active_project_id() -> Optional[str]:
    return ACTIVE_PROJECT_ID


def set_active_project_id(project_id: Optional[str]):
    global ACTIVE_PROJECT_ID
    ACTIVE_PROJECT_ID = project_id


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main UI unless the server is in API-only mode."""
    if not getattr(request.app.state, "serve_ui", True):
        raise HTTPException(status_code=404, detail="UI disabled")
    return templates.TemplateResponse("index.html", {"request": request})


# === Project Management ===
@app.post("/api/project")
async def api_create_project(payload: dict):
    project_name = payload.get("project_name")
    result = await run_in_threadpool(project_logic.create_new_project, project_name)
    set_active_project_id(result["project_id"])
    return {"success": True, **result}


@app.get("/api/projects")
async def api_list_projects():
    projects = await run_in_threadpool(project_logic.list_existing_projects)
    return {"success": True, "projects": projects}


@app.put("/api/project/{project_id}")
async def api_rename_project(project_id: str, payload: dict):
    new_name = payload.get("project_name")
    if not new_name:
        raise HTTPException(status_code=400, detail="project_name is required")
    result = await run_in_threadpool(project_logic.rename_project, project_id, new_name)
    return result


@app.delete("/api/project/{project_id}")
async def api_delete_project(project_id: str):
    if project_id == get_active_project_id():
        set_active_project_id(None)
    result = await run_in_threadpool(project_logic.delete_project, project_id)
    return result


@app.get("/api/project/active")
async def api_get_active_project():
    project_id = get_active_project_id()
    if not project_id:
        return {"success": True, "project_id": None, "project_name": None}
    project_name = await run_in_threadpool(db_manager.get_project_name, project_id)
    return {"success": True, "project_id": project_id, "project_name": project_name}


@app.get("/api/session")
async def api_get_session_state():
    project_id = get_active_project_id()
    project_name = (
        await run_in_threadpool(db_manager.get_project_name, project_id)
        if project_id
        else None
    )
    model_info = sam_inference_instance.get_model_info()

    active_image = None
    if project_id and sam_inference_instance.image_hash:
        img_info = await run_in_threadpool(
            db_manager.get_image_by_hash, project_id, sam_inference_instance.image_hash
        )
        if img_info:
            active_image = {
                "image_hash": sam_inference_instance.image_hash,
                "filename": img_info.get("original_filename"),
                "width": img_info.get("width"),
                "height": img_info.get("height"),
                "status": img_info.get("status"),
                "image_data": sam_inference_instance.get_image_as_base64(),
                "masks": await run_in_threadpool(
                    db_manager.get_mask_layers_for_image,
                    project_id,
                    sam_inference_instance.image_hash,
                ),
            }
    return {
        "success": True,
        "project_id": project_id,
        "project_name": project_name,
        "model_info": model_info,
        "active_image": active_image,
    }


@app.post("/api/project/load")
async def api_load_project(payload: dict):
    project_id = payload.get("project_id")
    if not project_id:
        raise HTTPException(status_code=400, detail="project_id is required")
    project_data = await run_in_threadpool(project_logic.load_project_by_id, project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="Project not found")
    set_active_project_id(project_id)
    await run_in_threadpool(
        project_logic.get_current_model_for_project, project_id, sam_inference_instance
    )
    return {"success": True, "project_data": project_data}


@app.post("/api/project/upload_db")
async def api_upload_project_db(db_file: UploadFile = File(...)):
    if not db_file.filename or not db_file.filename.endswith(config.DB_EXTENSION):
        raise HTTPException(
            status_code=400, detail=f"Invalid file. Must end with {config.DB_EXTENSION}"
        )
    project_id = os.path.splitext(db_file.filename)[0]
    project_id = "".join(c for c in project_id if c.isalnum() or c in ["_", "-"])
    if not project_id:
        raise HTTPException(
            status_code=400, detail="Invalid project ID derived from filename"
        )
    save_path = os.path.join(
        config.PROJECTS_DATA_DIR, f"{project_id}{config.DB_EXTENSION}"
    )
    if os.path.exists(save_path) and get_active_project_id() != project_id:
        raise HTTPException(
            status_code=409,
            detail=f"Project DB {project_id} already exists on server. Load it or choose a different name.",
        )
    try:
        contents = await db_file.read()
        with open(save_path, "wb") as f_out:
            f_out.write(contents)
        project_data = await run_in_threadpool(
            project_logic.load_project_by_id, project_id
        )
        if not project_data:
            os.remove(save_path)
            raise HTTPException(
                status_code=400, detail="Uploaded file is not a valid project database"
            )
        set_active_project_id(project_id)
        await run_in_threadpool(
            project_logic.get_current_model_for_project,
            project_id,
            sam_inference_instance,
        )
        return {
            "success": True,
            "project_data": project_data,
            "message": "Project DB uploaded and loaded.",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error saving or loading uploaded DB: {e}"
        )


@app.get("/api/project/download_db")
async def api_download_project_db(project_id: Optional[str] = None):
    if not project_id:
        project_id = get_active_project_id()
    if not project_id:
        raise HTTPException(status_code=400, detail="No project specified or active")
    db_path = db_manager.get_db_path(project_id)
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Project database not found")
    project_name = (
        await run_in_threadpool(db_manager.get_project_name, project_id) or project_id
    )
    filename = f"{secure_filename(project_name)}{config.DB_EXTENSION}"
    return FileResponse(
        db_path, media_type="application/octet-stream", filename=filename
    )


@app.api_route("/api/project/{project_id}/settings", methods=["GET", "PUT"])
async def api_project_settings(project_id: str, request: Request):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    if request.method == "GET":
        settings = {
            "current_sam_model_key": await run_in_threadpool(
                db_manager.get_project_setting, project_id, "current_sam_model_key"
            ),
            "current_sam_apply_postprocessing": await run_in_threadpool(
                db_manager.get_project_setting,
                project_id,
                "current_sam_apply_postprocessing",
            ),
        }
        return {"success": True, "settings": settings}
    else:
        data = await request.json()
        for key, value in data.items():
            await run_in_threadpool(
                db_manager.set_project_setting, project_id, key, value
            )
        return {"success": True, "message": "Settings updated."}


# === Image Source & Pool Management ===


@app.post("/api/project/{project_id}/sources/add_upload")
async def api_add_source_upload(project_id: str, files: List[UploadFile] = File(...)):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    if not files:
        raise HTTPException(status_code=400, detail="No files provided for upload")
    file_streams = [f.file for f in files]
    filenames = [secure_filename(f.filename) for f in files]
    result = await run_in_threadpool(
        project_logic.add_image_source_upload, project_id, file_streams, filenames
    )
    return {"success": True, **result}


@app.post("/api/project/{project_id}/sources/add_folder")
async def api_add_source_folder(project_id: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    path = payload.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="Server folder path is required")
    result = await run_in_threadpool(
        project_logic.add_image_source_folder, project_id, path
    )
    return result


@app.get("/api/project/{project_id}/sources")
async def api_list_image_sources(project_id: str):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    sources = await run_in_threadpool(db_manager.get_image_sources, project_id)
    return {"success": True, "sources": sources}


@app.delete("/api/project/{project_id}/sources/{source_id}")
async def api_remove_image_source(project_id: str, source_id: str):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    await run_in_threadpool(db_manager.remove_image_source, project_id, source_id)
    return {"success": True, "message": "Image source removed."}


@app.get("/api/project/{project_id}/sources/{source_id}/images")
async def api_list_source_images(project_id: str, source_id: str):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    images = await run_in_threadpool(
        db_manager.get_images_for_source, project_id, source_id
    )
    for img in images:
        img["thumbnail_url"] = f"/api/image/thumbnail/{project_id}/{img['image_hash']}"
    return {"success": True, "images": images}


@app.post("/api/project/{project_id}/sources/{source_id}/exempt_image")
async def api_exempt_source_image(project_id: str, source_id: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    image_hash = payload.get("image_hash")
    if not image_hash:
        raise HTTPException(status_code=400, detail="image_hash is required")
    exempt = bool(payload.get("exempt", True))
    if source_id in (None, "", "null", "None"):
        source_id = await run_in_threadpool(
            db_manager.get_source_id_for_image, project_id, image_hash
        )
    if not source_id:
        raise HTTPException(status_code=400, detail="Source not found for image")
    await run_in_threadpool(
        db_manager.set_image_exemption, project_id, source_id, image_hash, exempt
    )
    return {"success": True}


@app.get("/api/project/{project_id}/images")
async def api_list_images_from_pool(
    project_id: str,
    page: int = 1,
    per_page: int = 50,
    status_filter: Optional[str] = None,
):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    images, pagination = await run_in_threadpool(
        db_manager.get_images_from_pool, project_id, page, per_page, status_filter
    )
    for img in images:
        img["thumbnail_url"] = f"/api/image/thumbnail/{project_id}/{img['image_hash']}"
    return {"success": True, "images": images, "pagination": pagination}


@app.get("/api/image/thumbnail/{project_id}/{image_hash}")
async def api_get_image_thumbnail(project_id: str, image_hash: str):
    image_info = await run_in_threadpool(
        db_manager.get_image_by_hash, project_id, image_hash
    )
    if not image_info or not image_info.get("path_in_source"):
        raise HTTPException(status_code=404, detail="Image for thumbnail not found")
    img_path = await run_in_threadpool(
        project_logic.get_image_path_on_server_from_db_info, project_id, image_info
    )
    if not img_path or not os.path.exists(img_path):
        raise HTTPException(
            status_code=404, detail="Original image file not found for thumbnail"
        )
    try:
        pil_img = Image.open(img_path)
        pil_img.thumbnail((128, 128))
        if pil_img.mode not in ("RGB", "L"):
            pil_img = pil_img.convert("RGB")
        img_io = io.BytesIO()
        pil_img.save(img_io, "JPEG", quality=70)
        img_io.seek(0)
        return StreamingResponse(img_io, media_type="image/jpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Thumbnail generation failed: {e}")


@app.get("/api/project/{project_id}/images/next_unprocessed")
async def api_get_next_unprocessed(
    project_id: str, current_image_hash: Optional[str] = None
):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    next_image_info = await run_in_threadpool(
        db_manager.get_next_unprocessed_image, project_id, current_image_hash
    )
    if next_image_info:
        return {
            "success": True,
            "image_hash": next_image_info["image_hash"],
            "filename": next_image_info.get("original_filename"),
        }
    return {"success": True, "message": "No more unprocessed images"}


@app.get("/api/project/{project_id}/images/next_by_status")
async def api_get_next_by_status(
    project_id: str, statuses: str, current_image_hash: Optional[str] = None
):
    """Get the next image whose status is in the provided comma-separated list."""
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    status_list = [s.strip() for s in statuses.split(",") if s.strip()]
    next_image_info = await run_in_threadpool(
        db_manager.get_next_image_by_statuses,
        project_id,
        status_list,
        current_image_hash,
    )
    if next_image_info:
        return {
            "success": True,
            "image_hash": next_image_info["image_hash"],
            "filename": next_image_info.get("original_filename"),
        }
    return {"success": True, "message": "No matching images"}


@app.post("/api/project/{project_id}/images/set_active")
async def api_set_active_image(project_id: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    image_hash = payload.get("image_hash")
    if not image_hash:
        raise HTTPException(status_code=400, detail="image_hash is required")
    result = await run_in_threadpool(
        project_logic.set_active_image_for_project,
        project_id,
        image_hash,
        sam_inference_instance,
    )
    return result


@app.put("/api/project/{project_id}/images/{image_hash}/status")
async def api_update_image_status(project_id: str, image_hash: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    status = payload.get("status")
    if not status:
        raise HTTPException(status_code=400, detail="New status is required")
    await run_in_threadpool(
        db_manager.update_image_status, project_id, image_hash, status
    )
    return {"success": True, "message": "Image status updated."}


# === Model Management ===
@app.get("/api/models/available")
async def api_get_available_models():
    raw_keys = sam_inference_instance.get_available_model_keys()
    models_to_show = [
        k for k in raw_keys if not (k == "base" and "base_plus" in raw_keys)
    ]
    current_model_info = sam_inference_instance.get_model_info()
    return {
        "success": True,
        "models": models_to_show,
        "current_model_key": (
            current_model_info.get("model_size_key")
            if current_model_info.get("loaded")
            else None
        ),
        "sam_available": sam_inference_instance.sam_available,
    }


@app.post("/api/model/load")
async def api_load_model(payload: dict):
    project_id = get_active_project_id()
    if not project_id:
        raise HTTPException(status_code=400, detail="No active project")
    if not sam_inference_instance.sam_available:
        return {"success": False, "error": "SAM backend unavailable"}
    result = await run_in_threadpool(
        project_logic.load_sam_model_for_project,
        project_id,
        sam_inference_instance,
        payload.get("model_size_key"),
        payload.get("model_path"),
        payload.get("config_path"),
        payload.get("apply_postprocessing", config.DEFAULT_APPLY_POSTPROCESSING),
    )
    if not result["success"]:
        raise HTTPException(
            status_code=400, detail=result.get("error", "Failed to load model")
        )
    return result


@app.get("/api/model/current")
async def api_get_current_model():
    project_id = get_active_project_id()
    if not project_id:
        return {"success": True, "model_info": sam_inference_instance.get_model_info()}
    model_info = await run_in_threadpool(
        project_logic.get_current_model_for_project, project_id, sam_inference_instance
    )
    return {"success": True, "model_info": model_info}


# === Image Handling ===
@app.post("/api/project/{project_id}/images/{image_hash}/predict_interactive")
async def api_predict_interactive(project_id: str, image_hash: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    if not sam_inference_instance.sam_available:
        return {"success": False, "error": "SAM backend unavailable"}
    prompts = {
        "points": payload.get("points"),
        "labels": payload.get("labels"),
        "box": payload.get("box"),
        "mask_input": payload.get("maskInput"),
    }
    predict_params = {"multimask_output": payload.get("multimask_output", True)}
    try:
        result = await run_in_threadpool(
            project_logic.process_interactive_predict_request,
            project_id,
            image_hash,
            sam_inference_instance,
            prompts,
            predict_params,
        )
        return result
    except (ModelNotLoadedError, ImageNotSetError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/project/{project_id}/images/{image_hash}/automask")
async def api_generate_automask(project_id: str, image_hash: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    if not sam_inference_instance.sam_available:
        return {"success": False, "error": "SAM backend unavailable"}
    amg_params = payload or {}
    try:
        result = await run_in_threadpool(
            project_logic.process_automask_request,
            project_id,
            image_hash,
            sam_inference_instance,
            amg_params,
        )
        return result
    except (ModelNotLoadedError, ImageNotSetError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/project/{project_id}/images/{image_hash}/commit_masks")
async def api_commit_masks(project_id: str, image_hash: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    final_masks = payload.get("final_masks")
    notes = payload.get("notes")
    if not final_masks or not isinstance(final_masks, list):
        raise HTTPException(
            status_code=400, detail="final_masks data is missing or invalid"
        )
    result = await run_in_threadpool(
        project_logic.commit_final_masks, project_id, image_hash, final_masks, notes
    )
    return result


@app.get("/api/project/{project_id}/images/{image_hash}/masks")
async def api_get_image_masks(
    project_id: str, image_hash: str, status: Optional[str] = None
):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    mask_layers = await run_in_threadpool(
        db_manager.get_mask_layers_for_image, project_id, image_hash, status
    )
    return {"success": True, "masks": mask_layers}


@app.delete("/api/project/{project_id}/images/{image_hash}/layers/{layer_id}")
async def api_delete_mask_layer(project_id: str, image_hash: str, layer_id: str):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    result = await run_in_threadpool(
        project_logic.delete_mask_layer_and_update_status,
        project_id,
        image_hash,
        layer_id,
    )
    return result


@app.put("/api/project/{project_id}/images/{image_hash}/layers/{layer_id}")
async def api_update_mask_layer(
    project_id: str, image_hash: str, layer_id: str, payload: dict
):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    name = payload.get("name")
    class_label = payload.get("class_label")
    display_color = payload.get("display_color")
    visible = payload.get("visible")
    mask_data_rle = payload.get("mask_data_rle")
    status = payload.get("status")
    result = await run_in_threadpool(
        project_logic.update_mask_layer_basic,
        project_id,
        image_hash,
        layer_id,
        name,
        class_label,
        display_color,
        visible,
        mask_data_rle,
        status,
    )
    return result


@app.get("/api/project/{project_id}/image/{image_hash}/state")
async def api_get_image_state(project_id: str, image_hash: str):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    result = await run_in_threadpool(
        project_logic.get_image_state, project_id, image_hash
    )
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Not found"))
    return result


@app.put("/api/project/{project_id}/image/{image_hash}/state")
async def api_update_image_state(project_id: str, image_hash: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    result = await run_in_threadpool(
        project_logic.update_image_state, project_id, image_hash, payload
    )
    return result


@app.post("/api/project/{project_id}/export")
async def api_export_data(project_id: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    file_like, filename = await run_in_threadpool(
        export_logic.prepare_export_data,
        project_id,
        payload.get("filters", {}),
        payload.get("format", config.DEFAULT_EXPORT_FORMAT),
        payload.get("export_schema", "coco_instance_segmentation"),
    )
    if not file_like:
        raise HTTPException(status_code=500, detail="Failed to generate export data")
    file_like.seek(0)
    dest = payload.get("destination", "client")
    if dest == "server":
        save_path = await run_in_threadpool(
            export_logic.save_export_to_server, project_id, file_like, filename
        )
        return {"success": True, "path": save_path}
    return StreamingResponse(
        file_like,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.post("/api/project/{project_id}/export_stats")
async def api_export_stats(project_id: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    stats = await run_in_threadpool(
        export_logic.calculate_export_stats, project_id, payload.get("filters", {})
    )
    return stats


@app.get("/api/project/{project_id}/labels")
async def api_get_labels(project_id: str):
    if project_id != get_active_project_id():
        raise HTTPException(
            status_code=403, detail="Operation only allowed on the active project"
        )
    labels = await run_in_threadpool(db_manager.get_all_class_labels, project_id)
    return {"labels": labels}


def run_server(
    serve_ui=True, host=config.SERVER_HOST, port=config.SERVER_PORT, debug=True
):
    app.state.serve_ui = serve_ui
    if not os.path.exists(config.PROJECTS_DATA_DIR):
        os.makedirs(config.PROJECTS_DATA_DIR)
    import uvicorn

    uvicorn.run(app, host=host, port=port, reload=debug)


if __name__ == "__main__":
    if not db_manager.list_project_ids():
        dummy = project_logic.create_new_project("Test Project")
        set_active_project_id(dummy["project_id"])
    else:
        pid = db_manager.list_project_ids()[0]
        set_active_project_id(pid)
    run_server(serve_ui=True, debug=True)
