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

def _convert_rle_to_bbox_and_area(rle: Dict, height: int, width: int) -> Tuple[List[int], int]:
    """
    Converts COCO RLE to bounding box [x,y,width,height] and area.
    This requires pycocotools.mask.toBbox and pycocotools.mask.area
    Placeholder if pycocotools is not used for RLE.
    If RLE is {'type': 'raw_list', 'data': [[...]]}, this needs custom logic.
    """
    # This is a placeholder. Actual implementation depends on your RLE format.
    # If using pycocotools RLE:
    # from pycocotools import mask as mask_utils
    # import numpy as np
    # if isinstance(rle, dict) and 'counts' in rle and 'size' in rle:
    #     # Ensure counts is bytes if it was decoded for JSON storage
    #     if isinstance(rle['counts'], str):
    #         rle_form = {'size': rle['size'], 'counts': rle['counts'].encode('utf-8')}
    #     else:
    #         rle_form = rle
    #     bbox = mask_utils.toBbox(rle_form).tolist() # [x,y,width,height]
    #     area = mask_utils.area(rle_form).item() # Use .item() to get Python scalar
    #     return bbox, area
    # else: # Fallback for placeholder RLE
    #    print(f"Warning: Bbox/Area calculation for RLE type {type(rle)} not fully implemented.")
    
    # For placeholder {'type': 'raw_list', 'data': binary_mask_2d_list}
    if isinstance(rle, dict) and rle.get('type', '').startswith('raw_list') and 'data' in rle:
        binary_mask = rle['data']
        if not binary_mask or not binary_mask[0]: return [0,0,0,0], 0
        
        rows = len(binary_mask)
        cols = len(binary_mask[0])
        min_r, min_c = rows, cols
        max_r, max_c = 0, 0
        area = 0
        has_pixels = False
        for r_idx in range(rows):
            for c_idx in range(cols):
                if binary_mask[r_idx][c_idx] == 1:
                    has_pixels = True
                    min_r = min(min_r, r_idx)
                    min_c = min(min_c, c_idx)
                    max_r = max(max_r, r_idx)
                    max_c = max(max_c, c_idx)
                    area += 1
        if not has_pixels: return [0,0,0,0], 0
        return [min_c, min_r, max_c - min_c + 1, max_r - min_r + 1], area # x,y,w,h

    return [0,0,0,0], 0 # Default if RLE format is unknown

def prepare_export_data(project_id: str, image_hashes: List[str],
                        mask_layers_to_export: List[str],
                        export_format: str, export_schema: str) -> Optional[BytesIO]:

    project_info_db = db_manager.get_project_info(project_id)
    
    if export_format == "coco_rle_json" and export_schema == "coco_instance_segmentation":
        coco_output = _prepare_coco_structure(project_info_db)
        annotation_id_counter = 1

        images_to_process_hashes = []
        if "all_completed" in image_hashes:
            completed_images, _ = db_manager.get_images_from_pool(project_id, status_filter="completed", per_page=10000) # Get all
            images_to_process_hashes.extend([img['image_hash'] for img in completed_images])
        elif "all_in_project" in image_hashes: # Not explicitly in spec but good addition
            all_images, _ = db_manager.get_images_from_pool(project_id, per_page=10000) # Get all
            images_to_process_hashes.extend([img['image_hash'] for img in all_images])
        else:
            images_to_process_hashes.extend(image_hashes)
        
        images_to_process_hashes = list(set(images_to_process_hashes)) # Unique hashes

        for img_idx, img_hash in enumerate(images_to_process_hashes):
            db_image_info = db_manager.get_image_by_hash(project_id, img_hash)
            if not db_image_info:
                print(f"Warning: Image hash {img_hash} not found for export.")
                continue

            coco_output["images"].append({
                "id": img_idx + 1, # COCO image ID
                "width": db_image_info['width'],
                "height": db_image_info['height'],
                "file_name": db_image_info['original_filename'] or f"{img_hash}.jpg", # Placeholder if no original filename
                "license": 1, # Default license
                "original_hash": img_hash
            })

            for layer_type_filter in mask_layers_to_export:
                mask_layers = db_manager.get_mask_layers_for_image(project_id, img_hash, layer_type=layer_type_filter)
                for layer in mask_layers:
                    # The current DB structure for mask_data_rle in 'automask' or 'interactive_prompt'
                    # stores a JSON string which is a list of RLEs.
                    # For 'final_edited', it's a single RLE.
                    
                    rle_data_from_db_str = layer.get('mask_data_rle')
                    try:
                        # Try to parse if it's a JSON string (list of masks or single mask)
                        rle_items_parsed = json.loads(rle_data_from_db_str)
                    except (json.JSONDecodeError, TypeError):
                        # If it's not a JSON string, or already a dict/list (shouldn't happen if always stored as string)
                        # Or if it's a direct RLE string (not our current plan)
                        # For now, assume it's a direct RLE dict if parsing fails (fallback)
                        if isinstance(rle_data_from_db_str, dict):
                             rle_items_parsed = [rle_data_from_db_str] # Treat as a single mask item
                        else:
                            print(f"Warning: Could not parse RLE data for layer {layer['layer_id']}. Skipping.")
                            continue
                    
                    # Ensure rle_items_parsed is a list
                    if isinstance(rle_items_parsed, dict): # If it was a single RLE object
                        rle_items_parsed = [rle_items_parsed]


                    for rle_entry in rle_items_parsed:
                        # rle_entry could be the RLE itself, or a dict containing RLE and metadata
                        # e.g. {"segmentation_rle": actual_rle, "score": 0.9, "metadata": {...}} from project_logic
                        actual_rle_data = None
                        if isinstance(rle_entry, dict) and "segmentation_rle" in rle_entry:
                            actual_rle_data = rle_entry["segmentation_rle"]
                        elif isinstance(rle_entry, dict) and ("counts" in rle_entry and "size" in rle_entry): # Direct RLE dict
                            actual_rle_data = rle_entry
                        elif isinstance(rle_entry, dict) and rle_entry.get('type', '').startswith('raw_list'): # Our placeholder
                             actual_rle_data = rle_entry
                        else:
                            print(f"Warning: Unrecognized RLE entry format in layer {layer['layer_id']}. Skipping an RLE item.")
                            continue
                        
                        # Convert our placeholder 'raw_list' RLE to COCO RLE format (counts as string)
                        # THIS IS WHERE PROPER RLE CONVERSION IS CRITICAL
                        if isinstance(actual_rle_data, dict) and actual_rle_data.get('type', '').startswith('raw_list'):
                            # Placeholder: Convert raw_list (binary mask) to COCO RLE
                            # This would involve using pycocotools.mask.encode
                            # For now, we'll use the raw_list as is for bbox calculation and skip COCO RLE for it
                            coco_segmentation_rle = {"size": [db_image_info['height'], db_image_info['width']], "counts": "PLACEHOLDER_RLE_STRING_FROM_RAW_LIST"}
                            print("Warning: Exporting placeholder RLE for raw_list mask type. Real RLE conversion needed.")
                        elif isinstance(actual_rle_data, dict) and 'counts' in actual_rle_data and 'size' in actual_rle_data: # It's a COCO RLE dict
                            # Ensure counts is string for JSON
                            if isinstance(actual_rle_data['counts'], list): # If it's list of ints from pycocotools
                                actual_rle_data['counts'] = "".join(map(str, actual_rle_data['counts'])) # Not standard, just example
                            elif isinstance(actual_rle_data['counts'], bytes):
                                actual_rle_data['counts'] = actual_rle_data['counts'].decode('utf-8')
                            coco_segmentation_rle = actual_rle_data
                        else:
                            print(f"Warning: RLE data {actual_rle_data} in layer {layer['layer_id']} is not in expected COCO RLE dict format. Skipping.")
                            continue


                        bbox, area = _convert_rle_to_bbox_and_area(actual_rle_data, db_image_info['height'], db_image_info['width'])

                        coco_output["annotations"].append({
                            "id": annotation_id_counter,
                            "image_id": img_idx + 1,
                            "category_id": 1, # Default category
                            "segmentation": coco_segmentation_rle, # This must be COCO RLE format
                            "area": area,
                            "bbox": bbox, # [x,y,width,height]
                            "iscrowd": 0,
                            # Optional: include scores or other metadata from `layer` or `rle_entry`
                            "score": rle_entry.get("score", layer.get("metadata", {}).get("score")) if isinstance(rle_entry, dict) else None,
                            "layer_id_source": layer.get("layer_id")
                        })
                        annotation_id_counter += 1
        
        json_bytes = json.dumps(coco_output, indent=2).encode('utf-8')
        file_like_object = BytesIO(json_bytes)
        return file_like_object
    
    # Add other export formats (e.g., individual mask images in a ZIP)
    # elif export_format == "zip_binary_masks":
    # ...

    else:
        print(f"Unsupported export format '{export_format}' or schema '{export_schema}'.")
        return None