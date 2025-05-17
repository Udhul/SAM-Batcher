#!/usr/bin/env python3

import os
import glob
import fnmatch
import argparse
import sys
from typing import Optional, List, Union

# Valid model file extensions
VALID_EXTENSIONS = [".pt", ".pth", ".ckpt", ".safetensors", ".bin", ".model"]

def check_local_model(
    model_size: str,
    search_dir: Optional[str] = None,
    expanded_search: bool = False,
) -> Optional[str]:
    """
    Check if a SAM2.1 model is available locally.
    
    Args:
        model_size: Size of the model ('tiny', 'small', 'base_plus', or 'large')
        search_dir: Directory to search for the model (if None, uses default location)
        expanded_search: Whether to perform an expanded search across the repository
        
    Returns:
        Path to the model if found, None otherwise
    """

    # If model_size is "base", treat it as "base_plus"
    if isinstance(model_size, str) and model_size.lower() == "base":
        model_size = "base_plus"
    
    # Define base patterns for each model size
    base_patterns = {
        'tiny': ['*tiny*'],
        'small': ['*small*'],
        'base_plus': ['*base_plus*', '*base+*'],
        'large': ['*large*'],
    }
    
    # Build model patterns by combining base patterns with valid extensions
    model_patterns = {}
    for size, patterns in base_patterns.items():
        model_patterns[size] = []
        for pattern in patterns:
            for ext in VALID_EXTENSIONS:
                model_patterns[size].append(f"{pattern}{ext}")
    
    # Define patterns to exclude when searching for a specific model
    exclude_patterns = {
        'tiny': ['*small*', '*base*', '*large*'],
        'small': ['*tiny*', '*base*', '*large*'],
        'base_plus': ['*tiny*', '*small*', '*large*'],
        'large': ['*tiny*', '*small*', '*base*'],
    }
    
    if model_size not in model_patterns:
        raise ValueError(f"Invalid model size: {model_size}. Expected one of: tiny, small, base_plus, large")
    
    # Default search directory is relative to the current working directory (project root)
    default_dir = os.path.join("Modules", "sam2", "checkpoints")
    
    # If a search directory is provided as a file path, get its directory
    if search_dir and os.path.isfile(search_dir):
        search_dir = os.path.dirname(search_dir)
    
    # Use provided search directory or default
    search_dirs = [search_dir] if search_dir else [default_dir]
    
    # Function to check if a filename matches our target model
    def is_model_match(filename: str, patterns: List[str], exclude: List[str]) -> bool:
        # Check if file has a valid extension
        if not any(filename.lower().endswith(ext.lower()) for ext in VALID_EXTENSIONS):
            return False
            
        # Check if the filename matches any of our patterns
        if not any(fnmatch.fnmatch(os.path.basename(filename).lower(), pattern.lower()) for pattern in patterns):
            return False
        
        # Check if the filename matches any of the exclude patterns
        if any(fnmatch.fnmatch(os.path.basename(filename).lower(), pattern.lower()) for pattern in exclude):
            return False
            
        return True
    
    # Search in the specified directories
    for search_dir in search_dirs:
        if not os.path.exists(search_dir):
            continue
            
        # Look for exact match first - this is the most reliable
        exact_names = [
            f"sam2.1_hiera_{model_size.replace('_', '_')}.pt",
            f"sam2_hiera_{model_size.replace('_', '_')}.pt"
        ]
        
        # For base_plus, also check for variants
        if model_size == 'base_plus':
            exact_names.extend(["sam2.1_hiera_base_plus.pt", "sam2_hiera_base_plus.pt"])
        
        for exact_name in exact_names:
            potential_path = os.path.join(search_dir, exact_name)
            if os.path.exists(potential_path):
                return potential_path
        
        # If no exact match, try pattern matching in the specified directory
        for root, _, files in os.walk(search_dir):
            for file in files:
                file_path = os.path.join(root, file)
                if is_model_match(file_path, model_patterns[model_size], exclude_patterns[model_size]):
                    return file_path
    
    # If we still haven't found it and expanded_search is enabled, search the repository
    if expanded_search:
        excludes = ["venv", ".venv", "env", ".env", ".git", "__pycache__", "node_modules", 
                   "build", "dist", "downloads"]
        
        # Get all model files in the repository
        matches = []
        for root, dirs, files in os.walk(os.getcwd()):
            # Skip directories containing any of the exclude strings
            dirs[:] = [d for d in dirs if not any(exclude in os.path.join(root, d) for exclude in excludes)]
            
            for file in files:
                file_path = os.path.join(root, file)
                if is_model_match(file_path, model_patterns[model_size], exclude_patterns[model_size]):
                    matches.append(file_path)
        
        # If we found any matches, return the first one
        if matches:
            return matches[0]
    
    # If we haven't found anything, return None
    return None


def main():
    parser = argparse.ArgumentParser(description='Check for locally available SAM2.1 model checkpoints')
    parser.add_argument('model', choices=['tiny', 'small', 'base_plus', 'large'], 
                        help='Model size to look for (tiny, small, base, base_plus, or large)')
    parser.add_argument('--search-dir', default=None,
                        help='Directory to search for the model (default: Modules/sam2/checkpoints)')
    parser.add_argument('--expanded-search', action='store_true',
                        help='Perform an expanded search across the repository')
    
    args = parser.parse_args()
    
    model_path = check_local_model(
        args.model, 
        args.search_dir, 
        args.expanded_search, 
    )
    
    if model_path:
        print(f"Model found at: {model_path}")
    else:
        print(f"Model '{args.model}' not found.")
        exit(1)


if __name__ == "__main__":
    # If run from utils project subdir, change to project root
    if os.path.basename(os.getcwd()) == "utils":
        os.chdir("..")
    main()
