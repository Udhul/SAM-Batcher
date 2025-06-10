"""Data export helpers for SAM-Batcher projects.

Functions here transform stored mask data into user requested formats such as
COCO-style JSON or ZIP archives of binary masks.  The module does not touch the
web layer directly and returns file-like objects to ``server.py`` for delivery.
"""

# project_root/app/backend/export_logic.py
import json
import os
import zipfile
from io import BytesIO
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

try:
    from .... import config # For running from within app/backend
    from . import db_manager
except ImportError:
    import sys
    sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..')) # Add project_root to path
    import config
    import app.backend.db_manager as db_manager

# For RLE to Binary conversion if needed during export
# from pycocotools import mask as mask_utils
# import numpy as np

def _prepare_coco_structure(project_info: Dict) -> Dict:
    return {
        "info": {
            "description": f"Annotations from SAM2 Web UI Project: {project_info.get('project_name', 'N/A')}",
            "version": "1.0",
            "year": datetime.utcnow().year,
            "date_created": datetime.utcnow().isoformat()
        },
        "licenses": [{"name": "CC BY 4.0", "id": 1, "url": "http://creativecommons.org/licenses/by/4.0/"}], # Example license
        "images": [],
        "annotations": [],
        "categories": [{"id": 1, "name": "object", "supercategory": "object"}] # Default category
    }

def _convert_rle_to_bbox_and_area(rle: Dict) -> Tuple[List[int], int]:
    """Converts a COCO RLE object to a bounding box and area using pycocotools."""
    from pycocotools import mask as mask_utils

    if not rle or 'counts' not in rle or 'size' not in rle:
        return [0, 0, 0, 0], 0

    if isinstance(rle['counts'], str):
        rle = {'size': rle['size'], 'counts': rle['counts'].encode('utf-8')}

    bbox = mask_utils.toBbox(rle).tolist()
    area = mask_utils.area(rle).item()
    return bbox, area

def prepare_export_data(project_id: str, filters: Dict[str, List[str]],
                        export_format: str, export_schema: str) -> Optional[BytesIO]:

    project_info_db = db_manager.get_project_info(project_id)

    if export_format == "coco_rle_json" and export_schema == "coco_instance_segmentation":
        coco_output = _prepare_coco_structure(project_info_db)

        image_statuses = filters.get("image_statuses", []) if filters else []
        layer_statuses = filters.get("layer_statuses", []) if filters else []

        image_hashes = db_manager.get_image_hashes_by_statuses(project_id, image_statuses) if image_statuses else []
        if not image_hashes:
            return BytesIO(json.dumps(coco_output).encode("utf-8"))

        all_layers = db_manager.get_layers_by_image_and_statuses(project_id, image_hashes, layer_statuses)

        unique_labels = sorted({layer.get("class_label") for layer in all_layers if layer.get("class_label")})
        category_map = {label: idx + 1 for idx, label in enumerate(unique_labels)}
        coco_output["categories"] = [
            {"id": cid, "name": label, "supercategory": label.split("_")[0]} for label, cid in category_map.items()
        ]

        image_id_map = {}
        for idx, img_hash in enumerate(image_hashes):
            info = db_manager.get_image_by_hash(project_id, img_hash)
            if not info:
                continue
            coco_output["images"].append({
                "id": idx + 1,
                "width": info["width"],
                "height": info["height"],
                "file_name": info.get("original_filename") or f"{img_hash}.jpg",
                "license": 1
            })
            image_id_map[img_hash] = idx + 1

        annotation_id = 1
        for layer in all_layers:
            img_id = image_id_map.get(layer["image_hash_ref"])
            category_id = category_map.get(layer.get("class_label"))
            if not img_id or not category_id:
                continue
            rle_obj = layer["mask_data_rle"]
            bbox, area = _convert_rle_to_bbox_and_area(rle_obj)
            coco_output["annotations"].append({
                "id": annotation_id,
                "image_id": img_id,
                "category_id": category_id,
                "segmentation": rle_obj,
                "area": area,
                "bbox": bbox,
                "iscrowd": 0
            })
            annotation_id += 1

        return BytesIO(json.dumps(coco_output, indent=2).encode("utf-8"))

    else:
        print(f"Unsupported export format '{export_format}' or schema '{export_schema}'.")
        return None