# SAM Batcher
### UI for batch processing images, creating segmentation masks using SAM2

## Environment Variables

The backend can be customized using a few optional environment variables:

* `PROJECTS_DATA_DIR` – absolute path where project data will be stored.
* `CHECKPOINTS_DIR` – location of downloaded SAM checkpoints.
* `CUDA_DEVICE` – index of the CUDA device to use when multiple GPUs are available.

These variables override the defaults defined in `config.py` and allow mapping
folders from the host when running in a container.
