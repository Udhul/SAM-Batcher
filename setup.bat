@echo off
REM SAM-Batcher setup script with environment management for Windows

REM Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python not found! Please install Python 3.8 or newer.
    exit /b 1
)

REM Check if we're in a virtual environment already
set in_venv=0
if defined VIRTUAL_ENV (
    echo Already in a virtual environment: %VIRTUAL_ENV%
    set in_venv=1
)

REM Check if we're in a conda environment
set in_conda=0
if defined CONDA_PREFIX (
    echo Already in a conda environment: %CONDA_PREFIX%
    set in_conda=1
)

REM Handle environment selection/creation
if %in_venv% equ 1 (
    echo You are already in a virtual environment.
    set /p use_current="Use current environment? (y/n): "
    
    if /i "%use_current%" equ "y" (
        echo Using current environment.
        goto setup
    )
) else if %in_conda% equ 1 (
    echo You are already in a conda environment.
    set /p use_current="Use current environment? (y/n): "
    
    if /i "%use_current%" equ "y" (
        echo Using current environment.
        goto setup
    )
)

REM Choose which type of environment to use
set /p env_type="Create/select environment? (venv/conda/none): "

if /i "%env_type%" equ "venv" (
    set /p venv_path="Enter path for virtual environment (or leave empty for .\venv): "
    if "%venv_path%" equ "" set venv_path=.\venv
    
    if exist "%venv_path%" (
        echo Virtual environment exists at %venv_path%
        set /p use_existing="Use existing environment? (y/n): "
        
        if /i "%use_existing%" neq "y" (
            echo Creating new virtual environment at %venv_path%...
            python -m venv "%venv_path%"
        )
    ) else (
        echo Creating new virtual environment at %venv_path%...
        python -m venv "%venv_path%"
    )
    
    REM Activate the virtual environment
    call "%venv_path%\Scripts\activate.bat"
    echo Activated virtual environment at %venv_path%
    
    REM Verify activation
    if not defined VIRTUAL_ENV (
        echo Failed to activate virtual environment.
        echo Please manually activate it with:
        echo   call "%venv_path%\Scripts\activate.bat"
        echo Then run:
        echo   python setup.py
        exit /b 1
    )
    
) else if /i "%env_type%" equ "conda" (
    conda --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo Conda not found. Please install Conda first.
        exit /b 1
    )
    
    set /p conda_env="Enter conda environment name (or leave empty for sam-batcher): "
    if "%conda_env%" equ "" set conda_env=sam-batcher
    
    conda env list | findstr "%conda_env%" >nul
    if %errorlevel% equ 0 (
        echo Conda environment %conda_env% exists
        set /p use_existing="Use existing environment? (y/n): "
        
        if /i "%use_existing%" neq "y" (
            echo Creating new conda environment %conda_env%...
            conda create -y -n "%conda_env%" python=3.10
        )
    ) else (
        echo Creating new conda environment %conda_env%...
        conda create -y -n "%conda_env%" python=3.10
    )
    
    REM Try to activate the conda environment
    echo Attempting to activate conda environment %conda_env%...
    call conda activate "%conda_env%"
    
    REM Verify activation
    if not defined CONDA_PREFIX (
        echo Failed to activate conda environment.
        echo Please manually activate it with:
        echo   conda activate %conda_env%
        echo Then run:
        echo   python setup.py
        exit /b 1
    )
    
    echo Activated conda environment %conda_env%
    
) else if /i "%env_type%" neq "none" (
    echo Invalid environment type. Proceeding without an environment.
)

:setup
REM Check if git is available
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Git not found! Please install Git to use the setup script.
    exit /b 1
)

REM Run the setup.py script which will handle submodule cloning and installation
python setup.py

echo Setup completed successfully!
pause
