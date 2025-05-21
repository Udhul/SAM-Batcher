#!/bin/bash
# SAM-Batcher setup script with environment management

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if Python is available
if ! command_exists python3 && ! command_exists python; then
    echo "Python not found! Please install Python 3.8 or newer."
    exit 1
fi

# Check if we're in a virtual environment already
in_venv=0
if [ -n "$VIRTUAL_ENV" ]; then
    echo "Already in a virtual environment: $VIRTUAL_ENV"
    in_venv=1
fi

# Check if we're in a conda environment
in_conda=0
if [ -n "$CONDA_PREFIX" ]; then
    echo "Already in a conda environment: $CONDA_PREFIX"
    in_conda=1
fi

# Handle environment selection/creation
if [ $in_venv -eq 1 ] || [ $in_conda -eq 1 ]; then
    echo "You are already in an environment."
    read -p "Use current environment? (y/n): " use_current
    
    if [ "$use_current" = "y" ]; then
        echo "Using current environment."
    else
        # Choose which type of environment to use
        read -p "Create/select a different environment? (venv/conda): " env_type
        
        if [ "$env_type" = "venv" ]; then
            read -p "Enter path for virtual environment (or leave empty for ./venv): " venv_path
            venv_path=${venv_path:-"./venv"}
            
            if [ -d "$venv_path" ]; then
                echo "Virtual environment exists at $venv_path"
                read -p "Use existing environment? (y/n): " use_existing
                
                if [ "$use_existing" != "y" ]; then
                    echo "Creating new virtual environment at $venv_path..."
                    python3 -m venv "$venv_path" || python -m venv "$venv_path"
                fi
            else
                echo "Creating new virtual environment at $venv_path..."
                python3 -m venv "$venv_path" || python -m venv "$venv_path"
            fi
            
            # Activate the virtual environment
            source "$venv_path/bin/activate"
            echo "Activated virtual environment at $venv_path"
        elif [ "$env_type" = "conda" ]; then
            if ! command_exists conda; then
                echo "Conda not found. Please install Conda first."
                exit 1
            fi
            
            read -p "Enter conda environment name (or leave empty for sam-batcher): " conda_env
            conda_env=${conda_env:-"sam-batcher"}
            
            if conda info --envs | grep -q "$conda_env"; then
                echo "Conda environment $conda_env exists"
                read -p "Use existing environment? (y/n): " use_existing
                
                if [ "$use_existing" != "y" ]; then
                    echo "Creating new conda environment $conda_env..."
                    conda create -y -n "$conda_env" python=3.10
                fi
            else
                echo "Creating new conda environment $conda_env..."
                conda create -y -n "$conda_env" python=3.10
            fi
            
            # Activate the conda environment
            conda activate "$conda_env"
            echo "Activated conda environment $conda_env"
        else
            echo "Invalid environment type. Exiting."
            exit 1
        fi
    fi
else
    # No environment active, ask to create one
    read -p "No environment active. Create one? (venv/conda/none): " env_type
    
    if [ "$env_type" = "venv" ]; then
        read -p "Enter path for virtual environment (or leave empty for ./venv): " venv_path
        venv_path=${venv_path:-"./venv"}
        
        if [ -d "$venv_path" ]; then
            echo "Virtual environment exists at $venv_path"
            read -p "Use existing environment? (y/n): " use_existing
            
            if [ "$use_existing" != "y" ]; then
                echo "Creating new virtual environment at $venv_path..."
                python3 -m venv "$venv_path" || python -m venv "$venv_path"
            fi
        else
            echo "Creating new virtual environment at $venv_path..."
            python3 -m venv "$venv_path" || python -m venv "$venv_path"
        fi
        
        # Activate the virtual environment
        source "$venv_path/bin/activate"
        echo "Activated virtual environment at $venv_path"
    elif [ "$env_type" = "conda" ]; then
        if ! command_exists conda; then
            echo "Conda not found. Please install Conda first."
            exit 1
        fi
        
        read -p "Enter conda environment name (or leave empty for sam-batcher): " conda_env
        conda_env=${conda_env:-"sam-batcher"}
        
        if conda info --envs | grep -q "$conda_env"; then
            echo "Conda environment $conda_env exists"
            read -p "Use existing environment? (y/n): " use_existing
            
            if [ "$use_existing" != "y" ]; then
                echo "Creating new conda environment $conda_env..."
                conda create -y -n "$conda_env" python=3.10
            fi
        else
            echo "Creating new conda environment $conda_env..."
            conda create -y -n "$conda_env" python=3.10
        fi
        
        # Activate the conda environment
        conda activate "$conda_env"
        echo "Activated conda environment $conda_env"
    elif [ "$env_type" != "none" ]; then
        echo "Invalid environment type. Proceeding without an environment."
    fi
fi

# Check if git is available
if ! command_exists git; then
    echo "Git not found! Please install Git to use the setup script."
    exit 1
fi

# Run the setup.py script which will handle submodule cloning and installation
python setup.py

echo "Setup completed successfully!"
