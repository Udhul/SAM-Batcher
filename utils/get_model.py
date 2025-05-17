#!/usr/bin/env python3

import os
import argparse
import sys
from typing import Optional, Callable

try:
    # Try to import from utils package
    from utils.check_local_model import check_local_model
    from utils.download_model import download_checkpoint, MODEL_FILES
    from utils.get_model_config import get_config # Make get_config available
except ImportError:
    # If that fails, try to import from local files
    from check_local_model import check_local_model
    from download_model import download_checkpoint, MODEL_FILES
    from get_model_config import get_config # Make get_config available

def get_model(
    model_size: str,
    output_dir: Optional[str] = None,
    expanded_search: bool = True,
    force_download: bool = False,
    progress_callback: Optional[Callable[[float, int, int], None]] = None
) -> Optional[str]:
    """
    Get a SAM2.1 model, either by finding it locally or downloading it.
    
    Args:
        model_size: Size of the model ('tiny', 'small', 'base', 'base_plus', or 'large')
        output_dir: Directory to save/search for the checkpoint (default: Modules/sam2/checkpoints)
        expanded_search: Whether to perform an expanded search across the repository
        force_download: Whether to force download even if the model exists locally
        progress_callback: Optional callback function for download progress updates
                           Args: (progress_percentage, downloaded_bytes, total_bytes)
    
    Returns:
        Path to the model if found or successfully downloaded, None otherwise
    """
    # If model_size is "base", treat it as "base_plus"
    if isinstance(model_size, str) and model_size.lower() == "base":
        model_size = "base_plus"
    
    # Default output directory
    if output_dir is None:
        output_dir = os.path.join("Modules", "sam2", "checkpoints")
    
    # First, check if the model exists locally (unless force_download is True)
    model_path = None
    if not force_download:
        model_path = check_local_model(
            model_size=model_size,
            search_dir=output_dir,
            expanded_search=expanded_search
        )
    
    # If the model was found locally
    if model_path and not force_download:
        print(f"Using existing model at: {model_path}")
        return model_path
    
    # If the model wasn't found locally or force_download is True, download it
    print(f"Downloading {model_size} model...")
    download_result = download_checkpoint(
        model_size=model_size,
        output_dir=output_dir,
        progress_callback=progress_callback
    )
    
    # If download was successful, return the path to the downloaded file
    if download_result:
        # If download_result is a string (path), return it
        if isinstance(download_result, str):
            return download_result
        
        # If download_result is True, we need to construct the path
        elif download_result is True:
            # Determine the filename based on model_size
            if model_size in MODEL_FILES:
                filename = MODEL_FILES[model_size]
            else:
                # If model_size was a direct filename
                filename = model_size
            
            return os.path.join(output_dir, filename)
    
    # If download failed, return None
    return None


def main():
    parser = argparse.ArgumentParser(description='Get SAM2.1 model from local storage or download')
    parser.add_argument('model', choices=list(MODEL_FILES.keys()),
                        help='Model size to get')
    parser.add_argument('--output-dir', default=None,
                        help='Directory to save/search for the checkpoint (default: Modules/sam2/checkpoints)')
    parser.add_argument('--no-expanded-search', action='store_true',
                        help='Disable expanded search across the repository')
    parser.add_argument('--force-download', action='store_true',
                        help='Force download even if the model exists locally')
    
    args = parser.parse_args()
    
    model_path = get_model(
        model_size=args.model,
        output_dir=args.output_dir,
        expanded_search=not args.no_expanded_search,
        force_download=args.force_download
    )
    
    if model_path:
        # print(f"Model path: {model_path}")
        sys.exit(0)
    else:
        print(f"Failed to get model '{args.model}'")
        sys.exit(1)


if __name__ == "__main__":
    # If run from utils project subdir, change to project root
    if os.path.basename(os.getcwd()) == "utils":
        os.chdir("..")
    main()
