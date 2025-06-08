ARG BASE_IMAGE=pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

FROM ${BASE_IMAGE}

# Environment configuration via build arguments
ARG PROJECTS_DATA_DIR=/data
ARG CHECKPOINTS_DIR=/checkpoints
ARG CUDA_DEVICE=None
ARG MODEL_SIZE=base_plus
ARG PORT=5000

ENV PROJECTS_DATA_DIR=${PROJECTS_DATA_DIR} \
    CHECKPOINTS_DIR=${CHECKPOINTS_DIR} \
    CUDA_DEVICE=${CUDA_DEVICE} \
    MODEL_SIZE=${MODEL_SIZE} \
    PORT=${PORT}

# Create volume mount point for projects data folder "data"
VOLUME ["${PROJECTS_DATA_DIR}"]

# Workdir set to project root
WORKDIR /sam-batcher

# Create checkpoints directory and download models during build
RUN mkdir -p ${CHECKPOINTS_DIR}

# Download SAM 2.1 checkpoints
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt ${CHECKPOINTS_DIR}/sam2.1_hiera_tiny.pt
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt ${CHECKPOINTS_DIR}/sam2.1_hiera_small.pt
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt ${CHECKPOINTS_DIR}/sam2.1_hiera_base_plus.pt
ADD https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt ${CHECKPOINTS_DIR}/sam2.1_hiera_large.pt

# Install python requirements
COPY requirements.txt ./
# RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121 # Should be installed from the BASE_IMAGE
RUN pip install --no-cache-dir -r requirements.txt && \
    git clone https://github.com/facebookresearch/sam2.git Modules/sam2 && \
    pip install -e Modules/sam2

# Copy project files
COPY . .

CMD ["sh", "-c", "python main.py --host 0.0.0.0 --port ${PORT}"]
