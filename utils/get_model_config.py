#!/usr/bin/env python3
# utils/get_model_config.py

import os
import re
from typing import Optional, Union
from pathlib import Path

def get_config(model: str, return_str: bool = True, return_abs_path: bool = False) -> Optional[Union[str, Path]]:
    """
    Get the path to the config file for a SAM2.1 model.
    
    Args:
        model: Model size ('tiny', 'small', 'base_plus', 'large'), short code ('t', 's', 'b+', 'l'),
               model filename, or full path to model file
        return_str: If True, return the config file as a string.
        return_abs_path: If True, return the absolute path to the config file.
    
    Returns:
        Path to the config file, or None if not found
    """
    # Base config directory
    config_dir = os.path.join("configs", "sam2.1")
    if return_abs_path:
        config_dir = Path(config_dir).resolve()
    
    # Map of model sizes/codes to config filenames
    config_map = {
        # Full names
        'tiny': 'sam2.1_hiera_t.yaml',
        'small': 'sam2.1_hiera_s.yaml',
        'base_plus': 'sam2.1_hiera_b+.yaml',
        'base': 'sam2.1_hiera_b+.yaml',  # 'base' maps to 'base_plus'
        'large': 'sam2.1_hiera_l.yaml',
        
        # Short codes
        't': 'sam2.1_hiera_t.yaml',
        's': 'sam2.1_hiera_s.yaml',
        'b+': 'sam2.1_hiera_b+.yaml',
        'b': 'sam2.1_hiera_b+.yaml',  # 'b' maps to 'b+'
        'l': 'sam2.1_hiera_l.yaml',
    }
    
    # Check if the input is a direct model size or code
    if model in config_map:
        config_file = config_map[model]
        # return os.path.abspath(os.path.join(config_dir, config_file))
        config_path = config_dir / Path(config_file)
        return config_path.as_posix() if return_str else config_path
    
    # Extract model size from filename or path if given
    model_basename = os.path.basename(model).lower()
    
    # Try to identify model size from filename patterns
    if 'tiny' in model_basename or '_t.' in model_basename:
        config_file = 'sam2.1_hiera_t.yaml'
    elif 'small' in model_basename or '_s.' in model_basename:
        config_file = 'sam2.1_hiera_s.yaml'
    elif 'base_plus' in model_basename or 'base+' in model_basename or '_b+.' in model_basename:
        config_file = 'sam2.1_hiera_b+.yaml'
    elif 'large' in model_basename or '_l.' in model_basename:
        config_file = 'sam2.1_hiera_l.yaml'
    else:
        # If no match found, use regex to extract size info
        match = re.search(r'(tiny|small|base_?plus|large|_t\.|_s\.|_b\+\.|_l\.)', model_basename)
        if match:
            size_info = match.group(1).lower()
            if 'tiny' in size_info or '_t.' in size_info:
                config_file = 'sam2.1_hiera_t.yaml'
            elif 'small' in size_info or '_s.' in size_info:
                config_file = 'sam2.1_hiera_s.yaml'
            elif any(x in size_info for x in ['base_plus', 'base+', '_b+.']):
                config_file = 'sam2.1_hiera_b+.yaml'
            elif 'large' in size_info or '_l.' in size_info:
                config_file = 'sam2.1_hiera_l.yaml'
            else:
                return None
        else:
            return None
    
    # return os.path.abspath(os.path.join(config_dir, config_file))
    config_path = config_dir / Path(config_file)
    return config_path.as_posix() if return_str else config_path

# Test:
if __name__ == "__main__":
    test_inputs = [
        'tiny', 't', 'small', 's', 'base_plus', 'base', 'b+', 'large', 'l',
        'sam2.1_hiera_tiny.pt', 'sam2.1_hiera_small.pt', 
        'sam2.1_hiera_base_plus.pt', 'sam2.1_hiera_large.pt',
        'Modules/sam/checkpoints/sam2.1_hiera_tiny.pt', 'C:\\path\\to\\sam2.1_hiera_small.pt',
    ]
    
    for input_str in test_inputs:
        config_path = get_config(input_str)
        print(f"Input: {input_str} → Config: {config_path} - type: {type(config_path)} - exists: {config_path.exists()}")
