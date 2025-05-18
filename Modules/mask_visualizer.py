# utils/mask_visualizer.py
"""Helpers for sam image and mask visualization and compositing"""

import numpy as np
from PIL import Image
import io
import base64
import matplotlib.pyplot as plt # For colormap
from typing import Optional, Tuple, List, Dict, Any

def mask_to_base64_png(mask: np.ndarray, color: Optional[Tuple[int,int,int]] = None) -> str:
    """
    Converts a boolean mask (HxW) to a base64 encoded PNG string.
    Optionally applies a color.
    """
    if mask.ndim != 2:
        raise ValueError("Mask must be 2D (HxW)")
    if mask.dtype != bool and mask.dtype != np.uint8: # Allow uint8 if 0s and 1s or 0s and 255s
        mask = mask.astype(bool)

    if color:
        # Apply color: create an RGBA image
        h, w = mask.shape
        img_array = np.zeros((h, w, 4), dtype=np.uint8)
        img_array[mask, 0] = color[0]  # R
        img_array[mask, 1] = color[1]  # G
        img_array[mask, 2] = color[2]  # B
        img_array[mask, 3] = 153        # Alpha (0.6 * 255)
        pil_image = Image.fromarray(img_array, 'RGBA')
    else:
        # Grayscale mask (0 for False, 255 for True)
        mask_uint8 = (mask.astype(np.uint8) * 255)
        pil_image = Image.fromarray(mask_uint8, 'L')

    buffered = io.BytesIO()
    pil_image.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{img_str}"

def get_random_color():
    return tuple(np.random.randint(0, 256, 3))

def generate_mask_overlay_colors(num_masks: int) -> List[Tuple[int, int, int]]:
    """Generates a list of distinct colors for mask overlays."""
    colors = []
    # Use a colormap to get distinct colors
    cmap = plt.get_cmap('viridis', num_masks) # 'viridis', 'tab20', 'hsv' are good options
    for i in range(num_masks):
        rgb_float = cmap(i)[:3] # Get RGB, ignore alpha
        rgb_int = tuple(int(c * 255) for c in rgb_float)
        colors.append(rgb_int)
    return colors

# Example of how show_anns from notebook could be adapted for server-side rendering
# This is more complex than simple mask_to_base64_png and might not be needed if client handles compositing
def composite_masks_on_image_to_base64(
    base_image_np: np.ndarray, 
    anns: List[Dict[str, Any]],
    default_opacity: float = 0.5
    ) -> str:
    """
    Overlays masks from 'anns' (SAMAutomaticMaskGenerator format) onto the base image.
    Returns a base64 encoded PNG string of the composite image.
    """
    if not anns:
        pil_image = Image.fromarray(base_image_np.astype(np.uint8), 'RGB')
    else:
        # Ensure base image is RGBA for compositing
        if base_image_np.shape[2] == 3:
            # Add alpha channel if it's RGB
            base_image_rgba = np.concatenate(
                [base_image_np, np.full((base_image_np.shape[0], base_image_np.shape[1], 1), 255, dtype=np.uint8)],
                axis=2
            )
        else:
            base_image_rgba = base_image_np.copy()

        composite_img_pil = Image.fromarray(base_image_rgba.astype(np.uint8), 'RGBA')

        sorted_anns = sorted(anns, key=(lambda x: x['area']), reverse=True)
        
        # Generate distinct colors for each mask
        # colors = [get_random_color() for _ in range(len(sorted_anns))]
        colors_for_anns = generate_mask_overlay_colors(len(sorted_anns))

        for i, ann in enumerate(sorted_anns):
            mask_data = ann['segmentation'] # HxW boolean array
            color = colors_for_anns[i]
            
            # Create an RGBA image for this mask
            h, w = mask_data.shape
            mask_rgba_np = np.zeros((h, w, 4), dtype=np.uint8)
            mask_rgba_np[mask_data, 0] = color[0]
            mask_rgba_np[mask_data, 1] = color[1]
            mask_rgba_np[mask_data, 2] = color[2]
            mask_rgba_np[mask_data, 3] = int(default_opacity * 255) # Alpha for this mask
            
            mask_pil = Image.fromarray(mask_rgba_np, 'RGBA')
            composite_img_pil = Image.alpha_composite(composite_img_pil, mask_pil)

        pil_image = composite_img_pil.convert('RGB') # Final image as RGB

    buffered = io.BytesIO()
    pil_image.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{img_str}"