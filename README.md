# SAM Batcher
### UI for batch processing images, creating segmentation masks using SAM2

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
  --build-arg PORT=5005 \
  -t sam-batcher .
```

Run the container with volume mounts for data persistence:

```bash
docker run -d --name sam-batcher-production -p 5005:5005 \
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
docker run -p 5005:5005 sam-batcher

# Production run with explicit volume mount
docker run -d --name sam-batcher -p 5005:5005 \
  -v ~/sam-projects:/data \
  sam-batcher

# With custom checkpoints directory
docker run -d --name sam-batcher -p 5005:5005 \
  -v ~/sam-projects:/data \
  -v ~/custom-models:/checkpoints \
  sam-batcher
```