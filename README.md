# SAM Batcher
### UI for batch processing images, creating segmentation masks using SAM2

## Manual Installation in WSL with Conda, no Docker
```bash
git clone https://github.com/udhul/sam-batcher.
cd sam-batcher
conda env create -f environment-cpu.yml # or environment-gpu.yml
conda activate sam-batcher
git clone https://github.com/facebookresearch/sam2.git Modules/sam2
pip install -e Modules/sam2 # Takes a while to build dependencies
python main.py # Main entry point
```

## Environment Variables

The backend can be customized using a few optional environment variables:

* `PROJECTS_DATA_DIR` – absolute path where project data will be stored.
* `CHECKPOINTS_DIR` – location of downloaded SAM checkpoints.
* `CUDA_DEVICE` – index of the CUDA device to use when multiple GPUs are available.
* `MODEL_SIZE` – default SAM model key loaded when none is specified.
* `PORT` – port the backend server listens on.

These variables override the defaults defined in `config.py` and allow mapping
folders from the host when running in a container.

### Docker Usage

Build the image using standard paths:

```bash
docker build -t sam-batcher .
```

Or with optional build arguments for device and model settings:

```bash
docker build \
  --build-arg CUDA_DEVICE=3 \
  --build-arg MODEL_SIZE=base_plus \
  --build-arg PORT=5000 \
  -t sam-batcher .
```

Run the container with volume mounts for data persistence:

```bash
docker run -d --name sam-batcher-production -p 5000:5000 \
  -v /mnt/storage/sam-projects:/data \
  sam-batcher
```

The container includes pre-downloaded SAM 2.1 model checkpoints, so no additional model downloads are needed at runtime.

#### Volume Mounts

- `/data` - Project data, uploaded images, and results (automatically persisted via VOLUME)
- `/checkpoints` - SAM model checkpoints (pre-downloaded in image, can be overridden if needed)

#### Examples

```bash
# Simple run with automatic data persistence
docker run -p 5000:5000 sam-batcher

# Production run with explicit volume mount
docker run -d --name sam-batcher -p 5000:5000 \
  -v ~/sam-projects:/data \
  sam-batcher

# With custom checkpoints directory
docker run -d --name sam-batcher -p 5000:5000 \
  -v ~/sam-projects:/data \
  -v ~/custom-models:/checkpoints \
  sam-batcher

# Full runtime configuration example
docker run -d --name sam-batcher-custom -p 7000:5005 \
  -e PORT=5005 \
  -e CUDA_DEVICE=3 \
  -e MODEL_SIZE=large \
  -v /mnt/storage/sam-projects:/data \
  -v /mnt/models:/checkpoints \
  sam-batcher
```