#!/usr/bin/env python3

import os
import sys
import argparse
import urllib.request
import ssl
from typing import Optional, Union, Callable
import time

# Expose model options, mapping them to a simpler alias
MODEL_FILES = {
    'tiny': 'sam2.1_hiera_tiny.pt',
    'small': 'sam2.1_hiera_small.pt',
    'base': 'sam2.1_hiera_base_plus.pt',  # Same as base_plus
    'base_plus': 'sam2.1_hiera_base_plus.pt',
    'large': 'sam2.1_hiera_large.pt'
}

try:
    from tqdm import tqdm
    TQDM_AVAILABLE = True
except ImportError:
    TQDM_AVAILABLE = False

def download_checkpoint(
    model_size: str, 
    output_dir: Optional[str] = None,
    progress_callback: Optional[Callable[[float, int, int], None]] = None
) -> Union[bool, str]:
    """
    Download a SAM2.1 model checkpoint.
    
    Args:
        model_size: Size of the model ('tiny', 'small', 'base_plus', or 'large')
        output_dir: Directory to save the checkpoint (default: Modules/sam2/checkpoints)
        progress_callback: Optional callback function for progress updates
                          Args: (progress_percentage, downloaded_bytes, total_bytes)
    
    Returns:
        True if download successful, False if failed, or path to downloaded file if successful
    """
    # Set default output directory if not provided
    if output_dir is None:
        output_dir = os.path.join("Modules", "sam2", "checkpoints")
    
    # Create the output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Base URL for SAM 2.1 checkpoints
    base_url = "https://dl.fbaipublicfiles.com/segment_anything_2/092824"
    
    if model_size not in MODEL_FILES:
        # If real filename given directly as model_size
        if model_size in MODEL_FILES.values():
            file_name = model_size
        else:
            print(f"Error: Invalid model size '{model_size}'. Choose from: {', '.join(MODEL_FILES.keys())}")
            return False
    else:
        # Get the file name for the selected model
        file_name = MODEL_FILES[model_size]
    
    # Construct the URL and output path
    url = f"{base_url}/{file_name}"
    output_path = os.path.join(output_dir, file_name)
    
    # Create a context that doesn't verify SSL certificates
    context = ssl._create_unverified_context()
    
    try:
        # Open the URL
        with urllib.request.urlopen(url, context=context) as response:
            total_size = int(response.info().get('Content-Length', 0))
            downloaded = 0
            block_size = 8192
            
            # Setup progress tracking
            if TQDM_AVAILABLE and progress_callback is None:
                pbar = tqdm(total=total_size, unit='B', unit_scale=True, desc=f"Downloading {file_name}")
            
            # Open the output file
            with open(output_path, 'wb') as out_file:
                start_time = time.time()
                last_update_time = start_time
                
                while True:
                    buffer = response.read(block_size)
                    if not buffer:
                        break
                    
                    downloaded += len(buffer)
                    out_file.write(buffer)
                    
                    # Update progress
                    current_time = time.time()
                    if progress_callback and (current_time - last_update_time) > 0.1:  # Update every 100ms
                        progress_percentage = (downloaded / total_size * 100) if total_size > 0 else 0
                        progress_callback(progress_percentage, downloaded, total_size)
                        last_update_time = current_time
                    elif TQDM_AVAILABLE and progress_callback is None:
                        pbar.update(len(buffer))
            
            if TQDM_AVAILABLE and progress_callback is None:
                pbar.close()
            
            print(f"\nSuccessfully downloaded {file_name} to {output_path}")
            return output_path
    except Exception as e:
        print(f"Error downloading file: {e}")
        # Remove partial file if download failed
        if os.path.exists(output_path):
            try:
                os.remove(output_path)
            except:
                pass
        return False

def main():
    parser = argparse.ArgumentParser(description='Download SAM2.1 model checkpoints')
    parser.add_argument('model', choices=MODEL_FILES.keys(),
                        help='Model size to download (' + ', '.join(MODEL_FILES.keys()) + ')')
    parser.add_argument('--output-dir', default=None,
                        help='Directory to save the checkpoint (default: Modules/sam2/checkpoints)')
    
    args = parser.parse_args()
    
    result = download_checkpoint(args.model, args.output_dir)
    if not result:
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    # If run from utils project subdir, change to project root
    if os.path.basename(os.getcwd()) == "utils":
        os.chdir("..")
    main()
