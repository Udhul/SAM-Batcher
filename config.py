# project_root/config.py
import os
import datetime

# TODO: Override relevant defaults through env vars, for example for settingn project dir and checkpoints dir on mnt (destination relative to root possible) instead
# TODO: Correctly add default cuda device for running from docker container

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__))) # Project root

# Directory to store all project-related data (databases, uploads)
PROJECTS_DATA_DIR = os.path.join(BASE_DIR, "projects_data")

# Directory to store all SAM checkpoints
CHECKPOINTS_DIR = os.path.join(BASE_DIR, "Modules/sam2/checkpoints")

# Default SAM model settings (can be overridden by user)
DEFAULT_SAM_MODEL_KEY = "tiny"
DEFAULT_APPLY_POSTPROCESSING = True

# Image hashing algorithm
IMAGE_HASH_ALGORITHM = "md5"

# Default export parameters
DEFAULT_EXPORT_FORMAT = "coco_rle_json"
DEFAULT_MASK_LAYERS_TO_EXPORT = ["final_edited"]

# Ensure projects_data directory exists
if not os.path.exists(PROJECTS_DATA_DIR):
    os.makedirs(PROJECTS_DATA_DIR)

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