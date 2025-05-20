#!/usr/bin/env python3
"""
SAM-Batcher Setup Script

This script handles:
1. Environment discovery, selection, and creation (venv or conda)
2. Installation of dependencies in the chosen environment
3. Installation of modules in editable mode
"""
import os
import sys
import subprocess
import platform
import argparse
from pathlib import Path

# Environment name
ENV_NAME = "sam-batcher-env"
IS_WINDOWS = platform.system() == "Windows"

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

def is_venv_active():
    """Check if a Python virtual environment is active"""
    return hasattr(sys, 'real_prefix') or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)

def is_conda_active():
    """Check if a conda environment is active"""
    return 'CONDA_PREFIX' in os.environ

def get_active_venv_name():
    """Get the name of the active virtual environment"""
    if not is_venv_active():
        return None
    
    venv_path = sys.prefix
    return os.path.basename(venv_path)

def get_active_conda_name():
    """Get the name of the active conda environment"""
    if not is_conda_active():
        return None
    
    return os.environ.get('CONDA_DEFAULT_ENV')

def check_venv_exists(env_name):
    """Check if a virtual environment exists"""
    env_path = Path(env_name)
    if IS_WINDOWS:
        return env_path.exists() and (env_path / "Scripts" / "activate.bat").exists()
    else:
        return env_path.exists() and (env_path / "bin" / "activate").exists()

def check_conda_exists():
    """Check if conda is installed"""
    try:
        result = subprocess.run(
            "conda --version", 
            shell=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            text=True
        )
        return result.returncode == 0
    except:
        return False

def check_conda_env_exists(env_name):
    """Check if a conda environment exists"""
    if not check_conda_exists():
        return False
    
    try:
        if IS_WINDOWS:
            cmd = f"conda env list | findstr {env_name}"
        else:
            cmd = f"conda env list | grep {env_name}"
        
        result = subprocess.run(
            cmd, 
            shell=True, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            text=True
        )
        return env_name in result.stdout
    except:
        return False

def create_venv(env_name):
    """Create a virtual environment"""
    print(f"Creating virtual environment: {env_name}")
    
    if IS_WINDOWS:
        cmd = f"python -m venv {env_name}"
    else:
        cmd = f"python3 -m venv {env_name}"
    
    return run_command(cmd)

def create_conda_env(env_name):
    """Create a conda environment"""
    print(f"Creating conda environment: {env_name}")
    cmd = f"conda create -y -n {env_name} python=3.10"
    return run_command(cmd)

def launch_in_environment(env_type, env_name):
    """
    Launch this script in the specified environment by creating
    a temporary shell script that:
    1. Activates the correct environment
    2. Runs this script with --install flag in that environment
    """
    script_path = os.path.abspath(__file__)
    
    # Create temporary script file
    temp_file = "run_setup_temp"
    if IS_WINDOWS:
        temp_file += ".bat"
        with open(temp_file, "w") as f:
            f.write("@echo off\n")
            
            if env_type == "venv":
                f.write(f"call {env_name}\\Scripts\\activate.bat\n")
            else:  # conda
                f.write(f"call conda activate {env_name}\n")
            
            f.write(f"python {script_path} --install\n")
            f.write("pause\n")
            
        try:
            subprocess.run(temp_file, shell=True, check=True)
        finally:
            os.unlink(temp_file)
    else:
        temp_file += ".sh"
        with open(temp_file, "w") as f:
            f.write("#!/bin/bash\n")
            
            if env_type == "venv":
                f.write(f"source {env_name}/bin/activate\n")
            else:  # conda
                # Find conda.sh
                conda_sh = ""
                potential_paths = [
                    os.path.expanduser("~/anaconda3/etc/profile.d/conda.sh"),
                    os.path.expanduser("~/miniconda3/etc/profile.d/conda.sh"),
                    "/opt/anaconda3/etc/profile.d/conda.sh",
                    "/opt/miniconda3/etc/profile.d/conda.sh"
                ]
                
                for path in potential_paths:
                    if os.path.exists(path):
                        conda_sh = path
                        break
                
                if conda_sh:
                    f.write(f"source {conda_sh}\n")
                f.write(f"conda activate {env_name}\n")
            
            f.write(f"python {script_path} --install\n")
            
        os.chmod(temp_file, 0o755)
        try:
            subprocess.run(f"./{temp_file}", shell=True, check=True)
        finally:
            os.unlink(temp_file)

def parse_environment_yml(file_path):
    """
    Parse an environment.yml file to extract pip packages for venv installation
    Returns: (python_version, conda_packages, pip_packages)
    """
    import yaml
    
    with open(file_path, 'r') as f:
        env_data = yaml.safe_load(f)
    
    # Extract python version
    python_version = None
    conda_packages = []
    pip_packages = []
    
    for dep in env_data.get('dependencies', []):
        if isinstance(dep, str) and dep.startswith('python='):
            python_version = dep.split('=')[1]
        elif isinstance(dep, str) and dep != 'pip':
            conda_packages.append(dep)
        elif isinstance(dep, dict) and 'pip' in dep:
            pip_packages.extend(dep['pip'])
    
    return python_version, conda_packages, pip_packages

def install_packages():
    """Install packages and modules in the active environment"""
    # Track problematic modules
    problematic_modules = []
    
    print("\nSAM-Batcher Package Installation")
    print("===============================")
    
    # Ask user whether to install CPU or GPU requirements
    hardware = input("\nInstall for [c]pu or [g]pu? (c/g): ").lower()
    
    # Install base requirements
    print("\nInstalling base requirements...")
    if not run_command(f"pip install -r requirements.txt"):
        print("Failed to install base requirements")
        return
    
    # Install hardware-specific requirements
    if hardware.startswith('g'):
        print("Installing GPU requirements...")
        if not run_command(f"pip install -r requirements-gpu.txt"):
            print("Failed to install GPU requirements")
            return
    else:
        print("Installing CPU requirements...")
        if not run_command(f"pip install -r requirements-cpu.txt"):
            print("Failed to install CPU requirements")
            return
    
    # Install modules in editable mode
    print("\nInstalling modules in editable mode...")
    modules_dir = Path("Modules")
    
    if not modules_dir.exists() or not modules_dir.is_dir():
        print(f"Modules directory not found at {modules_dir.absolute()}")
    else:
        for module_dir in modules_dir.iterdir():
            if module_dir.is_dir():
                setup_py = module_dir / "setup.py"
                requirements_txt = module_dir / "requirements.txt"
                
                if setup_py.exists():
                    # Try to install as an editable package
                    module_path = str(module_dir.absolute())
                    if not run_command(f"pip install -e {module_path}"):
                        problematic_modules.append(module_dir.name)
                elif requirements_txt.exists():
                    # If there's only a requirements.txt, try to install from that
                    if not run_command(f"pip install -r {requirements_txt}"):
                        problematic_modules.append(module_dir.name)
                else:
                    # No setup.py or requirements.txt found
                    problematic_modules.append(module_dir.name)
    
    print("\nSetup completed!")
    
    if problematic_modules:
        print("\nThe following modules could not be installed automatically:")
        for module in problematic_modules:
            print(f" - {module}")
        print("\nYou may need to install their requirements manually.")

def setup():
    """
    Main setup function that handles environment setup and launches
    the installation in the chosen environment
    """
    # Parse arguments - check if we're in install mode
    parser = argparse.ArgumentParser(description='SAM-Batcher Setup')
    parser.add_argument('--install', action='store_true', help='Run package installation')
    args = parser.parse_args()
    
    # If --install is passed, skip environment setup and go straight to installation
    if args.is_install:
        install_packages()
        return
    
    print("SAM-Batcher Environment Setup")
    print("=============================")
    
    # Check for active environments
    active_venv_name = get_active_venv_name()
    active_conda_name = get_active_conda_name()
    
    if active_venv_name:
        print(f"Currently in virtual environment: {active_venv_name}")
        
        if active_venv_name == ENV_NAME or os.path.basename(sys.prefix) == ENV_NAME:
            print(f"The dedicated SAM-Batcher virtual environment is already active.")
            install_packages()
            return
        else:
            use_current = input("Do you want to use this virtual environment instead of creating/activating the dedicated one? (y/n): ")
            if use_current.lower().startswith('y'):
                install_packages()
                return
    
    elif active_conda_name:
        print(f"Currently in conda environment: {active_conda_name}")
        
        if active_conda_name == ENV_NAME:
            print(f"The dedicated SAM-Batcher conda environment is already active.")
            install_packages()
            return
        else:
            use_current = input("Do you want to use this conda environment instead of creating/activating the dedicated one? (y/n): ")
            if use_current.lower().startswith('y'):
                install_packages()
                return
    
    # Check for existing environments
    venv_exists = check_venv_exists(ENV_NAME)
    conda_exists = check_conda_env_exists(ENV_NAME)
    
    env_type = None
    
    if venv_exists and conda_exists:
        # Both environments exist
        print(f"Both conda and virtual environments named {ENV_NAME} exist.")
        env_choice = input("Which one would you like to use? [c]onda or [v]env: ")
        
        if env_choice.lower().startswith('c'):
            env_type = "conda"
        elif env_choice.lower().startswith('v'):
            env_type = "venv"
        else:
            print("Invalid choice. Exiting.")
            return
    
    elif venv_exists:
        # Only venv exists
        print(f"Found existing virtual environment: {ENV_NAME}")
        venv_choice = input("Do you want to use it [u] or create a new conda environment [c]? (u/c): ")
        
        if venv_choice.lower().startswith('u'):
            env_type = "venv"
        elif venv_choice.lower().startswith('c'):
            if not check_conda_exists():
                print("Conda not found. Please install Anaconda or Miniconda first.")
                return
            
            if create_conda_env(ENV_NAME):
                env_type = "conda"
            else:
                print("Failed to create conda environment. Please install manually.")
                return
        else:
            print("Invalid choice. Exiting.")
            return
    
    elif conda_exists:
        # Only conda exists
        print(f"Found existing conda environment: {ENV_NAME}")
        conda_choice = input("Do you want to use it [u] or create a new venv [c]? (u/c): ")
        
        if conda_choice.lower().startswith('u'):
            env_type = "conda"
        elif conda_choice.lower().startswith('c'):
            if create_venv(ENV_NAME):
                env_type = "venv"
            else:
                print("Failed to create virtual environment. Please install manually.")
                return
        else:
            print("Invalid choice. Exiting.")
            return
    
    else:
        # Neither exists
        print("No existing environments found.")
        create_choice = input("Would you like to create a [v]env or [c]onda environment? (v/c): ")
        
        if create_choice.lower().startswith('v'):
            if create_venv(ENV_NAME):
                env_type = "venv"
            else:
                print("Failed to create virtual environment. Please install manually.")
                return
        elif create_choice.lower().startswith('c'):
            if not check_conda_exists():
                print("Conda not found. Please install Anaconda or Miniconda first.")
                return
            
            if create_conda_env(ENV_NAME):
                env_type = "conda"
            else:
                print("Failed to create conda environment. Please install manually.")
                return
        else:
            print("Invalid choice. Exiting.")
            return
    
    # Launch the installation in the selected environment
    launch_in_environment(env_type, ENV_NAME)

if __name__ == "__main__":
    # Fix for args namespace issue
    parser = argparse.ArgumentParser(description='SAM-Batcher Setup')
    parser.add_argument('--install', action='store_true', help='Run package installation')
    args = parser.parse_args()
    
    if args.install:
        install_packages()
    else:
        setup()
