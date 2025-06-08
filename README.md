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

Build the CUDA-enabled image using optional build arguments to preconfigure
paths and device settings:

```bash
docker build \
  --build-arg PROJECTS_DATA_DIR=/data/projects \
  --build-arg CHECKPOINTS_DIR=/data/checkpoints \
  --build-arg CUDA_DEVICE=0 \
  --build-arg MODEL_SIZE=base_plus \
  --build-arg PORT=7860 \
  -t sam-batcher .
```

Run the container:

```bash
docker run -p 7860:7860 sam-batcher
```
