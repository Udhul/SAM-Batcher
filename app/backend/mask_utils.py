# Utility functions for simple RLE encoding/decoding of binary masks
from typing import List, Dict, Any


def binary_mask_to_rle(mask: List[List[int]]) -> Dict[str, Any]:
    """Encode 2D binary mask (list of lists) to simple RLE."""
    if not mask or not mask[0]:
        return {"counts": [], "size": [0, 0]}
    height = len(mask)
    width = len(mask[0])
    counts = []
    last_val = 0
    run_len = 0
    for row in mask:
        for val in row:
            v = 1 if val else 0
            if v == last_val:
                run_len += 1
            else:
                counts.append(run_len)
                run_len = 1
                last_val = v
    counts.append(run_len)
    return {"counts": counts, "size": [height, width]}


def rle_to_binary_mask(rle: Dict[str, Any]) -> List[List[int]]:
    """Decode simple RLE back to 2D binary mask."""
    counts = rle.get("counts", [])
    height, width = rle.get("size", [0, 0])
    flat: List[int] = []
    val = 0
    for c in counts:
        flat.extend([val] * c)
        val = 1 - val
    # ensure length
    flat += [0] * (height * width - len(flat))
    mask = [flat[i * width:(i + 1) * width] for i in range(height)]
    return mask

