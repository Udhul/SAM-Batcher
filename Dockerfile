ARG BASE_IMAGE=pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

FROM ${BASE_IMAGE}

# Environment configuration via build arguments
ARG PROJECTS_DATA_DIR=/projects_data
ARG CHECKPOINTS_DIR=/checkpoints
ARG CUDA_DEVICE=0
ARG MODEL_SIZE=base_plus
ARG PORT=7860

ENV PROJECTS_DATA_DIR=${PROJECTS_DATA_DIR} \
    CHECKPOINTS_DIR=${CHECKPOINTS_DIR} \
    CUDA_DEVICE=${CUDA_DEVICE} \
    MODEL_SIZE=${MODEL_SIZE} \
    PORT=${PORT}

# Workdir set to project root
WORKDIR /sam-batcher

# Install python requirements
COPY requirements.txt ./
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu121 && \
    pip install --no-cache-dir -r requirements.txt && \
    git clone https://github.com/facebookresearch/sam2.git Modules/sam2 && \
    pip install -e Modules/sam2

# Copy project files
COPY . .

CMD ["sh", "-c", "python main.py --host 0.0.0.0 --port ${PORT} --api-only"]
