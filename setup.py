#!/usr/bin/env python3
"""
SAM-Batcher Setup Script

This script handles:
1. Environment validation
2. Dependency installation (CPU or CUDA)
3. SAM2 submodule installation
"""
import os
import sys
import subprocess
import argparse
from pathlib import Path
from setuptools import setup, find_packages

def run_command(cmd, shell=True, capture_output=False):
    """Run a shell command and return the result"""
    print(f"Running: {cmd}")
    try:
        result = subprocess.run(
            cmd, 
            shell=shell, 
            check=True, 
            capture_output=capture_output, 
            text=capture_output
        )
        return result if capture_output else True
    except subprocess.CalledProcessError as e:
        print(f"Error executing: {cmd}")
        print(f"Error details: {e}")
        return False

def is_environment_valid():
    """Check if we're in a valid Python environment (venv or conda)"""
    # Check for virtual environment
    in_venv = hasattr(sys, 'real_prefix') or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)
    
    # Check for conda environment
    in_conda = 'CONDA_PREFIX' in os.environ
    
    return in_venv or in_conda

def check_pytorch_cuda_status():
    """
    Check if PyTorch is installed and if it has CUDA support
    Returns: (is_installed, has_cuda, version)
    """
    try:
        import torch
        is_installed = True
        has_cuda = torch.cuda.is_available()
        version = torch.__version__
        return is_installed, has_cuda, version
    except ImportError:
        return False, False, None

def install_dependencies():
    """Install all required dependencies"""
    if not is_environment_valid():
        print("Warning: Not running in a virtual or conda environment.")
        proceed = input("Proceed with installation anyway? (y/n): ")
        if not proceed.lower().startswith('y'):
            print("Installation aborted.")
            return False
    
    print("\nSAM-Batcher Package Installation")
    print("===============================")
    
    # Check if PyTorch is already installed and has CUDA
    torch_installed, torch_has_cuda, torch_version = check_pytorch_cuda_status()
    
    if torch_installed:
        print(f"PyTorch {torch_version} is already installed.")
        if torch_has_cuda:
            print("CUDA support is already available.")
        else:
            print("Current installation is CPU-only.")
    
    # Ask for CUDA or CPU installation if PyTorch is not installed
    install_torch = not torch_installed
    use_cuda = False
    
    if not torch_installed:
        hardware = input("\nInstall PyTorch for [c]pu or [g]pu/cuda? (c/g): ").lower()
        use_cuda = hardware.startswith('g')
    else:
        # If PyTorch is already installed with CUDA, ask if they want to keep it
        if torch_has_cuda:
            print("\nYou already have PyTorch installed with CUDA support.")
            reinstall = input("Do you want to reinstall/upgrade PyTorch? (y/n): ").lower()
            if reinstall.startswith('y'):
                install_torch = True
                hardware = input("Install for [c]pu or [g]pu/cuda? (c/g): ").lower()
                use_cuda = hardware.startswith('g')
        else:
            # PyTorch is installed but CPU-only, ask if they want CUDA version
            print("\nYou have a CPU-only version of PyTorch installed.")
            upgrade_to_cuda = input("Do you want to upgrade to a CUDA-enabled version? (y/n): ").lower()
            if upgrade_to_cuda.startswith('y'):
                install_torch = True
                use_cuda = True
    
    # Install PyTorch with appropriate version
    if install_torch:
        if use_cuda:
            print("Installing PyTorch with CUDA support...")
            torch_command = "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118"
        else:
            print("Installing PyTorch CPU version...")
            torch_command = "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu"
        
        if not run_command(torch_command):
            print("Failed to install PyTorch.")
            return False
    
    # Install other common dependencies
    common_deps = [
        "numpy",
        "pillow",
        "matplotlib",
        "opencv-python",
        "tqdm"
    ]
    
    print("Installing common dependencies...")
    if not run_command(f"pip install {' '.join(common_deps)}"):
        print("Failed to install common dependencies.")
        return False
    
    # Check SAM2 submodule
    modules_dir = Path("Modules")
    sam2_dir = modules_dir / "sam2"
    
    if not modules_dir.exists():
        print("Creating Modules directory...")
        modules_dir.mkdir(exist_ok=True)
    
    if not sam2_dir.exists():
        print("SAM2 submodule not found. Please add it with:")
        print("git submodule add https://github.com/facebookresearch/sam2.git Modules/sam2")
        print("git submodule update --init --recursive")
        return False
    
    # Install SAM2 in development mode
    print("Installing SAM2 submodule in development mode...")
    if not run_command(f"pip install -e {str(sam2_dir)}"):
        print("Failed to install SAM2 submodule.")
        return False
    
    print("\nInstallation completed successfully!")
    return True

def main():
    parser = argparse.ArgumentParser(description='SAM-Batcher Setup')
    args = parser.parse_args()
    
    # Run the dependency installation
    install_dependencies()
    
    # Setup the package itself
    setup(
        name="sam-batcher",
        version="0.1.0",
        description="Batch processing tool for SAM2",
        author="Udhul",
        packages=find_packages(),
        install_requires=[],  # Dependencies are handled separately
        python_requires=">=3.8",
    )

if __name__ == "__main__":
    main()
