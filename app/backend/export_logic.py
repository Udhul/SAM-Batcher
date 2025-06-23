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
from PIL import Image, ImageColor

try:
    from .... import config  # For running from within app/backend
    from . import db_manager
    from . import project_logic
except ImportError:
    import sys

    sys.path.append(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )  # Add project_root to path
    import config
    import app.backend.db_manager as db_manager
    import app.backend.project_logic as project_logic

# For RLE to Binary conversion if needed during export
# from pycocotools import mask as mask_utils
# import numpy as np


def _prepare_coco_structure(project_info: Dict) -> Dict:
    return {
        "info": {
            "description": f"Annotations from SAM2 Web UI Project: {project_info.get('project_name', 'N/A')}",
            "version": "1.0",
            "year": datetime.utcnow().year,
            "date_created": datetime.utcnow().isoformat(),
        },
        "licenses": [
            {
                "name": "CC BY 4.0",
                "id": 1,
                "url": "http://creativecommons.org/licenses/by/4.0/",
            }
        ],  # Example license
        "images": [],
        "annotations": [],
        "categories": [
            {"id": 1, "name": "object", "supercategory": "object"}
        ],  # Default category
    }


def _convert_rle_to_bbox_and_area(rle: Dict) -> Tuple[List[int], int]:
    """Converts a COCO RLE object to a bounding box and area using pycocotools."""
    from pycocotools import mask as mask_utils

    if not rle or "counts" not in rle or "size" not in rle:
        return [0, 0, 0, 0], 0

    # Handle different representations for the RLE counts
    if isinstance(rle["counts"], list):
        # Uncompressed RLE list -> compress using pycocotools
        height, width = rle["size"]
        rle = mask_utils.frPyObjects(rle, height, width)
    elif isinstance(rle["counts"], str):
        # Stored as UTF-8 string
        rle = {"size": rle["size"], "counts": rle["counts"].encode("utf-8")}

    bbox = mask_utils.toBbox(rle).tolist()
    area = mask_utils.area(rle).item()
    return bbox, area


def _export_db_as_json(project_id: str) -> BytesIO:
    """Return a JSON dump of the entire project database."""
    tables = [
        "Project_Info",
        "Image_Sources",
        "Source_Image_Exemptions",
        "Images",
        "Mask_Layers",
        "Project_Settings",
    ]
    conn = db_manager.get_db_connection(project_id)
    cursor = conn.cursor()
    db_json: Dict[str, List[Dict[str, Any]]] = {}
    for table in tables:
        cursor.execute(f"SELECT * FROM {table}")
        rows = [dict(row) for row in cursor.fetchall()]
        db_json[table] = rows
    conn.close()
    return BytesIO(json.dumps(db_json, indent=2).encode("utf-8"))


def _generate_overlay_zip(
    project_id: str, image_hashes: List[str], layers: List[Dict[str, Any]]
) -> BytesIO:
    """Create a ZIP file of images overlaid with their masks."""
    zip_buffer = BytesIO()
    with zipfile.ZipFile(zip_buffer, "w") as zf:
        for img_hash in image_hashes:
            img_info = db_manager.get_image_by_hash(project_id, img_hash)
            if not img_info:
                continue
            ext = os.path.splitext(img_info.get("original_filename") or "img.jpg")[1]
            img_path = project_logic.get_sharded_image_path(project_id, img_hash, ext)
            if not os.path.exists(img_path):
                continue
            img = Image.open(img_path).convert("RGBA")
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            for layer in [l for l in layers if l["image_hash_ref"] == img_hash]:
                rle = layer["mask_data_rle"]
                from pycocotools import mask as mask_utils

                mask = mask_utils.decode(rle)
                mask_img = Image.fromarray(mask.astype("uint8") * 255, mode="L")
                color = layer.get("display_color") or "#ff0000"
                try:
                    rgba = ImageColor.getcolor(color, "RGBA")
                except ValueError:
                    rgba = (255, 0, 0, 128)
                color_img = Image.new("RGBA", img.size, rgba)
                overlay.paste(color_img, (0, 0), mask_img)
            combined = Image.alpha_composite(img, overlay).convert("RGB")
            out_buffer = BytesIO()
            combined.save(out_buffer, format="PNG")
            zf.writestr(f"{img_hash}.png", out_buffer.getvalue())
    zip_buffer.seek(0)
    return zip_buffer


def calculate_export_stats(
    project_id: str, filters: Dict[str, List[str]]
) -> Dict[str, Any]:
    """Calculate statistics for the given export filters."""
    image_statuses = filters.get("image_statuses", []) if filters else []
    layer_statuses = filters.get("layer_statuses", []) if filters else []
    class_labels = filters.get("class_labels", []) if filters else []
    image_hashes = filters.get("image_hashes", []) if filters else []
    layer_ids = filters.get("layer_ids", []) if filters else []
    visibility_mode = filters.get("visibility_mode") if filters else None

    if layer_ids:
        all_layers = db_manager.get_layers_by_ids(project_id, layer_ids)
        image_hashes.extend(
            [
                l["image_hash_ref"]
                for l in all_layers
                if l["image_hash_ref"] not in image_hashes
            ]
        )
    else:
        if image_statuses:
            image_hashes.extend(
                [
                    h
                    for h in db_manager.get_image_hashes_by_statuses(
                        project_id, image_statuses
                    )
                    if h not in image_hashes
                ]
            )
        visible_filter = True if visibility_mode == "and" else None
        all_layers = db_manager.get_layers_by_image_and_statuses(
            project_id, image_hashes, layer_statuses, visible_filter
        )

    filtered_layers: List[Dict[str, Any]] = []
    for layer in all_layers:
        include = True
        if visibility_mode == "and":
            include = layer.get("visible", True)
            if class_labels:
                layer_tags = layer.get("class_label") or []
                if isinstance(layer_tags, str):
                    try:
                        layer_tags = json.loads(layer_tags)
                    except json.JSONDecodeError:
                        layer_tags = [layer_tags]
                include = include and any(t in class_labels for t in layer_tags)
        elif visibility_mode == "or":
            include = layer.get("visible", True)
            if class_labels:
                layer_tags = layer.get("class_label") or []
                if isinstance(layer_tags, str):
                    try:
                        layer_tags = json.loads(layer_tags)
                    except json.JSONDecodeError:
                        layer_tags = [layer_tags]
                if any(t in class_labels for t in layer_tags):
                    include = True
        else:  # none
            if class_labels:
                layer_tags = layer.get("class_label") or []
                if isinstance(layer_tags, str):
                    try:
                        layer_tags = json.loads(layer_tags)
                    except json.JSONDecodeError:
                        layer_tags = [layer_tags]
                include = any(t in class_labels for t in layer_tags)
        if include:
            filtered_layers.append(layer)

    all_layers = filtered_layers

    label_counts: Dict[str, int] = {}
    for layer in all_layers:
        labels = layer.get("class_label") or []
        if isinstance(labels, str):
            try:
                labels = json.loads(labels)
            except json.JSONDecodeError:
                labels = [labels]
        for label in labels:
            label_counts[label] = label_counts.get(label, 0) + 1

    filtered_hashes = {layer["image_hash_ref"] for layer in all_layers}
    return {
        "num_images": len(filtered_hashes),
        "num_layers": len(all_layers),
        "label_counts": label_counts,
    }


def save_export_to_server(project_id: str, file_like: BytesIO, filename: str) -> str:
    """Save export data to an exports directory on the server and return the path."""
    export_dir = os.path.join(config.PROJECTS_DATA_DIR, project_id, "exports")
    os.makedirs(export_dir, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(export_dir, f"{timestamp}_{filename}")
    with open(path, "wb") as f:
        f.write(file_like.getvalue())
    return path


def prepare_export_data(
    project_id: str,
    filters: Dict[str, List[str]],
    export_format: str,
    export_schema: str,
) -> Tuple[Optional[BytesIO], str]:

    project_info_db = db_manager.get_project_info(project_id)

    if (
        export_format == "coco_rle_json"
        and export_schema == "coco_instance_segmentation"
    ):
        coco_output = _prepare_coco_structure(project_info_db)

        image_statuses = filters.get("image_statuses", []) if filters else []
        layer_statuses = filters.get("layer_statuses", []) if filters else []
        class_labels = filters.get("class_labels", []) if filters else []
        image_hashes = filters.get("image_hashes", []) if filters else []
        layer_ids = filters.get("layer_ids", []) if filters else []
        visibility_mode = filters.get("visibility_mode") if filters else None

        if layer_ids:
            all_layers = db_manager.get_layers_by_ids(project_id, layer_ids)
            if visibility_mode == "and":
                all_layers = [l for l in all_layers if l.get("visible", True)]
            image_hashes.extend(
                [
                    l["image_hash_ref"]
                    for l in all_layers
                    if l["image_hash_ref"] not in image_hashes
                ]
            )
        else:
            if image_statuses:
                image_hashes.extend(
                    [
                        h
                        for h in db_manager.get_image_hashes_by_statuses(
                            project_id, image_statuses
                        )
                        if h not in image_hashes
                    ]
                )
            visible_filter = True if visibility_mode == "and" else None
            all_layers = db_manager.get_layers_by_image_and_statuses(
                project_id, image_hashes, layer_statuses, visible_filter
            )

        filtered_layers: List[Dict[str, Any]] = []
        for layer in all_layers:
            include = True
            layer_tags = layer.get("class_label") or []
            if isinstance(layer_tags, str):
                try:
                    layer_tags = json.loads(layer_tags)
                except json.JSONDecodeError:
                    layer_tags = [layer_tags]
            if visibility_mode == "and":
                include = layer.get("visible", True)
                if class_labels:
                    include = include and any(t in class_labels for t in layer_tags)
            elif visibility_mode == "or":
                include = layer.get("visible", True)
                if class_labels and any(t in class_labels for t in layer_tags):
                    include = True
            else:
                if class_labels:
                    include = any(t in class_labels for t in layer_tags)
            if include:
                filtered_layers.append(layer)

        all_layers = filtered_layers

        if not image_hashes:
            return (
                BytesIO(json.dumps(coco_output).encode("utf-8")),
                f"{project_id}_coco.json",
            )

        image_hashes = sorted({layer["image_hash_ref"] for layer in all_layers})
        if not image_hashes:
            return (
                BytesIO(json.dumps(coco_output).encode("utf-8")),
                f"{project_id}_coco.json",
            )

        tag_set: Set[str] = set()
        for layer in all_layers:
            tags = layer.get("class_label") or []
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except json.JSONDecodeError:
                    tags = [tags]
            tag_set.update(tags)
        unique_labels = sorted(tag_set)
        category_map: Dict[Optional[str], int] = {}
        categories: List[Dict[str, Any]] = []
        if unique_labels:
            for idx, label in enumerate(unique_labels):
                category_map[label] = idx + 1
                categories.append(
                    {"id": idx + 1, "name": label, "supercategory": label.split("_")[0]}
                )
            default_cat_id = len(unique_labels) + 1
            categories.append(
                {"id": default_cat_id, "name": "unlabeled", "supercategory": "none"}
            )
            category_map[None] = default_cat_id
        else:
            categories.append({"id": 1, "name": "unlabeled", "supercategory": "none"})
            category_map[None] = 1
        coco_output["categories"] = categories

        image_id_map = {}
        for idx, img_hash in enumerate(image_hashes):
            info = db_manager.get_image_by_hash(project_id, img_hash)
            if not info:
                continue
            coco_output["images"].append(
                {
                    "id": idx + 1,
                    "width": info["width"],
                    "height": info["height"],
                    "file_name": info.get("original_filename") or f"{img_hash}.jpg",
                    "license": 1,
                }
            )
            image_id_map[img_hash] = idx + 1

        annotation_id = 1
        default_cat = category_map.get(None)
        for layer in all_layers:
            img_id = image_id_map.get(layer["image_hash_ref"])
            if not img_id:
                continue
            layer_tags = layer.get("class_label") or []
            if isinstance(layer_tags, str):
                try:
                    layer_tags = json.loads(layer_tags)
                except json.JSONDecodeError:
                    layer_tags = [layer_tags]
            rle_obj = layer["mask_data_rle"]
            bbox, area = _convert_rle_to_bbox_and_area(rle_obj)
            for tag in layer_tags or [None]:
                category_id = category_map.get(tag, default_cat)
                if category_id is None:
                    continue
                coco_output["annotations"].append(
                    {
                        "id": annotation_id,
                        "image_id": img_id,
                        "category_id": category_id,
                        "segmentation": rle_obj,
                        "area": area,
                        "bbox": bbox,
                        "iscrowd": 0,
                    }
                )
                annotation_id += 1

        return (
            BytesIO(json.dumps(coco_output, indent=2).encode("utf-8")),
            f"{project_id}_coco.json",
        )

    elif export_format == "overlay_images_zip":
        if not image_hashes:
            return BytesIO(), f"{project_id}_overlays.zip"
        zip_file = _generate_overlay_zip(project_id, image_hashes, all_layers)
        return zip_file, f"{project_id}_overlays.zip"
    elif export_format == "project_db_json":
        return _export_db_as_json(project_id), f"{project_id}_db.json"
    else:
        print(
            f"Unsupported export format '{export_format}' or schema '{export_schema}'."
        )
        return None, ""
