#!/usr/bin/env python3
"""FastAPI server for the SAM-Batcher application.

This module exposes the web API and UI routes using FastAPI. It mirrors the
previous Flask based implementation but leverages FastAPI's asynchronous
capabilities. Business logic lives in ``project_logic`` and related modules.
"""

import os
from typing import Optional, List

from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Depends
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.concurrency import run_in_threadpool

try:
    from .... import config  # when running from package
    from .sam_backend import SAMInference, ModelNotLoadedError, ImageNotSetError
    from . import db_manager, project_logic, export_logic
except Exception:  # pragma: no cover - fallback for direct execution
    import sys
    sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))
    import config
    from app.backend.sam_backend import SAMInference, ModelNotLoadedError, ImageNotSetError
    import app.backend.db_manager as db_manager
    import app.backend.project_logic as project_logic
    import app.backend.export_logic as export_logic

app = FastAPI()

APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TEMPLATES_DIR = os.path.join(APP_DIR, 'frontend', 'templates')
STATIC_DIR = os.path.join(APP_DIR, 'frontend', 'static')

app.mount('/static', StaticFiles(directory=STATIC_DIR), name='static')
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# Global SAMInference instance
_cuda_idx = int(config.CUDA_DEVICE) if getattr(config, 'CUDA_DEVICE', None) is not None else None
sam_inference_instance: SAMInference = SAMInference(cuda_device_index=_cuda_idx)

# Active project id stored in memory (single user assumption)
ACTIVE_PROJECT_ID: Optional[str] = None


def get_active_project_id() -> Optional[str]:
    return ACTIVE_PROJECT_ID


def set_active_project_id(project_id: Optional[str]):
    global ACTIVE_PROJECT_ID
    ACTIVE_PROJECT_ID = project_id


@app.get('/', response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main UI unless the server is in API-only mode."""
    if not getattr(request.app.state, 'serve_ui', True):
        raise HTTPException(status_code=404, detail='UI disabled')
    return templates.TemplateResponse('index.html', {'request': request})


# === Project Management ===
@app.post('/api/project')
async def api_create_project(payload: dict):
    project_name = payload.get('project_name')
    result = await run_in_threadpool(project_logic.create_new_project, project_name)
    set_active_project_id(result['project_id'])
    return result


@app.get('/api/projects')
async def api_list_projects():
    projects = await run_in_threadpool(project_logic.list_existing_projects)
    return {'success': True, 'projects': projects}


@app.put('/api/project/{project_id}')
async def api_rename_project(project_id: str, payload: dict):
    new_name = payload.get('project_name')
    if not new_name:
        raise HTTPException(status_code=400, detail='project_name is required')
    result = await run_in_threadpool(project_logic.rename_project, project_id, new_name)
    return result


@app.delete('/api/project/{project_id}')
async def api_delete_project(project_id: str):
    if project_id == get_active_project_id():
        set_active_project_id(None)
    result = await run_in_threadpool(project_logic.delete_project, project_id)
    return result


@app.get('/api/project/active')
async def api_get_active_project():
    project_id = get_active_project_id()
    if not project_id:
        return {'success': True, 'project_id': None, 'project_name': None}
    project_name = await run_in_threadpool(db_manager.get_project_name, project_id)
    return {'success': True, 'project_id': project_id, 'project_name': project_name}


@app.get('/api/session')
async def api_get_session_state():
    project_id = get_active_project_id()
    project_name = await run_in_threadpool(db_manager.get_project_name, project_id) if project_id else None
    model_info = sam_inference_instance.get_model_info()

    active_image = None
    if project_id and sam_inference_instance.image_hash:
        img_info = await run_in_threadpool(db_manager.get_image_by_hash, project_id, sam_inference_instance.image_hash)
        if img_info:
            active_image = {
                'image_hash': sam_inference_instance.image_hash,
                'filename': img_info.get('original_filename'),
                'width': img_info.get('width'),
                'height': img_info.get('height'),
                'status': img_info.get('status'),
                'image_data': sam_inference_instance.get_image_as_base64(),
                'masks': await run_in_threadpool(db_manager.get_mask_layers_for_image, project_id, sam_inference_instance.image_hash)
            }
    return {
        'success': True,
        'project_id': project_id,
        'project_name': project_name,
        'model_info': model_info,
        'active_image': active_image
    }


@app.post('/api/project/load')
async def api_load_project(payload: dict):
    project_id = payload.get('project_id')
    if not project_id:
        raise HTTPException(status_code=400, detail='project_id is required')
    project_data = await run_in_threadpool(project_logic.load_project_by_id, project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail='Project not found')
    set_active_project_id(project_id)
    await run_in_threadpool(project_logic.get_current_model_for_project, project_id, sam_inference_instance)
    return {'success': True, 'project_data': project_data}


# === Model Management ===
@app.get('/api/models/available')
async def api_get_available_models():
    raw_keys = sam_inference_instance.get_available_model_keys()
    models_to_show = [k for k in raw_keys if not (k == 'base' and 'base_plus' in raw_keys)]
    current_model_info = sam_inference_instance.get_model_info()
    return {
        'success': True,
        'models': models_to_show,
        'current_model_key': current_model_info.get('model_size_key') if current_model_info.get('loaded') else None
    }


@app.post('/api/model/load')
async def api_load_model(payload: dict):
    project_id = get_active_project_id()
    if not project_id:
        raise HTTPException(status_code=400, detail='No active project')
    result = await run_in_threadpool(
        project_logic.load_sam_model_for_project,
        project_id,
        sam_inference_instance,
        payload.get('model_size_key'),
        payload.get('model_path'),
        payload.get('config_path'),
        payload.get('apply_postprocessing', config.DEFAULT_APPLY_POSTPROCESSING)
    )
    if not result['success']:
        raise HTTPException(status_code=500, detail='Failed to load model')
    return result


@app.get('/api/model/current')
async def api_get_current_model():
    project_id = get_active_project_id()
    if not project_id:
        return {'success': True, 'model_info': sam_inference_instance.get_model_info()}
    model_info = await run_in_threadpool(project_logic.get_current_model_for_project, project_id, sam_inference_instance)
    return {'success': True, 'model_info': model_info}


# === Image Handling ===
@app.post('/api/project/{project_id}/images/{image_hash}/predict_interactive')
async def api_predict_interactive(project_id: str, image_hash: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(status_code=403, detail='Operation only allowed on the active project')
    prompts = {
        'points': payload.get('points'),
        'labels': payload.get('labels'),
        'box': payload.get('box'),
        'mask_input': payload.get('maskInput')
    }
    predict_params = {'multimask_output': payload.get('multimask_output', True)}
    try:
        result = await run_in_threadpool(
            project_logic.process_interactive_predict_request,
            project_id,
            image_hash,
            sam_inference_instance,
            prompts,
            predict_params
        )
        return result
    except (ModelNotLoadedError, ImageNotSetError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post('/api/project/{project_id}/export')
async def api_export_data(project_id: str, payload: dict):
    if project_id != get_active_project_id():
        raise HTTPException(status_code=403, detail='Operation only allowed on the active project')
    file_like_object = await run_in_threadpool(
        export_logic.prepare_export_data,
        project_id,
        payload.get('filters', {}),
        payload.get('format', config.DEFAULT_EXPORT_FORMAT),
        payload.get('export_schema', 'coco_instance_segmentation')
    )
    if not file_like_object:
        raise HTTPException(status_code=500, detail='Failed to generate export data')
    filename = f"export.dat"
    return FileResponse(file_like_object, media_type='application/octet-stream', filename=filename)


def run_server(serve_ui=True, host=config.SERVER_HOST, port=config.SERVER_PORT, debug=True):
    app.state.serve_ui = serve_ui
    if not os.path.exists(config.PROJECTS_DATA_DIR):
        os.makedirs(config.PROJECTS_DATA_DIR)
    import uvicorn
    uvicorn.run(app, host=host, port=port, reload=debug)


if __name__ == '__main__':
    if not db_manager.list_project_ids():
        dummy = project_logic.create_new_project('Test Project')
        set_active_project_id(dummy['project_id'])
    else:
        pid = db_manager.list_project_ids()[0]
        set_active_project_id(pid)
    run_server(serve_ui=True, debug=True)
