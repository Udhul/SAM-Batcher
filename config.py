# project_root/config.py
import os
import datetime

"""Configuration for SAM-Batcher.

This module exposes a number of constants that can be overridden through
environment variables so that container users can map data and model
directories from the host.

Supported environment variables:
``PROJECTS_DATA_DIR``
    Absolute path for project data storage.
``CHECKPOINTS_DIR``
    Absolute path to SAM checkpoints.
``CUDA_DEVICE``
    Default CUDA device index used when instantiating :class:`SAMInference`.
``MODEL_SIZE``
    Default SAM model size key used if no model is selected in the UI.
``PORT``
    Default server port when running ``main.py``.
"""

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__)))  # Project root

# Directory to store all project-related data (databases, uploads)
PROJECTS_DATA_DIR = os.getenv(
    "PROJECTS_DATA_DIR",
    os.path.join(BASE_DIR, "data"),
)
PROJECTS_DATA_DIR = os.path.abspath(PROJECTS_DATA_DIR)

# Directory to store all SAM checkpoints
CHECKPOINTS_DIR = os.getenv(
    "CHECKPOINTS_DIR",
    os.path.join(BASE_DIR, "checkpoints"),
)
CHECKPOINTS_DIR = os.path.abspath(CHECKPOINTS_DIR)

# CUDA device index (None means auto-detect)
CUDA_DEVICE = os.getenv("CUDA_DEVICE")

# Default SAM model settings (can be overridden by user)
DEFAULT_SAM_MODEL_KEY = os.getenv("MODEL_SIZE", "base_plus")
DEFAULT_APPLY_POSTPROCESSING = True

# Image hashing algorithm
IMAGE_HASH_ALGORITHM = "md5"

# Default export parameters
DEFAULT_EXPORT_FORMAT = "coco_rle_json"
DEFAULT_MASK_LAYERS_TO_EXPORT = ["final_edited"]

# Server parameters
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("PORT", "5000"))

# Ensure data directory exists
if not os.path.exists(PROJECTS_DATA_DIR):
    os.makedirs(PROJECTS_DATA_DIR)

# Ensure checkpoints directory exists
if not os.path.exists(CHECKPOINTS_DIR):
    os.makedirs(CHECKPOINTS_DIR, exist_ok=True)

# Database file extension
DB_EXTENSION = ".sqlite"

# Uploads subdirectory within a project
UPLOADS_SUBDIR = "uploads"
THUMBNAILS_SUBDIR = "thumbnails" # For future use

# Maximum length for prefix in sharded directories (e.g., first 2 chars of hash)
SHARD_PREFIX_LENGTH = 2

# Petname/Haikunator for project names
# TODO: May move to utils
try:
    import haikunator
    HAIKUNATOR = haikunator.Haikunator()
except ImportError:
    HAIKUNATOR = None
    print("Haikunator library not found. Default project names will be simpler.")

def generate_default_project_name():
    date_str = datetime.datetime.now().strftime("%d%m%y")
    if HAIKUNATOR:
        # haiku_words = HAIKUNATOR.haikunate(token_length=0).split("-")
        # return f"{haiku_words[0].capitalize()}-{haiku_words[1].capitalize()}-{date_str}"
        return f"{HAIKUNATOR.haikunate(token_length=0)}-{date_str}"
    else:
        import uuid
        return f"project-{uuid.uuid4().hex[:6]}-{date_str}"
