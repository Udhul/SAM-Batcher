# Modules/sam_inference_backend.py

import os
import torch
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

from utils.get_model import get_model, get_config

# checkpoint = get_model("tiny")
# model_cfg = get_config("tiny")
# predictor = SAM2ImagePredictor(build_sam2(model_cfg, checkpoint))

# with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
#     predictor.set_image(<your_image>)
#     masks, _, _ = predictor.predict(<input_prompts>)

def is_local_src(model_src):
    file_name, file_extension = os.path.splitext(model_src)
    if file_extension == ".pt":
        return True
    return False

def is_hf_src(model_src):
    return not(is_local_src(model_src))

class SAMInference:
    def __init__(self, model_src="checkpoints/sam2.1_hiera_large.pt", config_src="configs/sam2.1/sam2.1_hiera_l.yaml"):
        self.model_src = model_src
        self.config_src = config_src
        self.predictor = None
        self.image_path = None
        self.points = None
        self.masks = None

    def _load_model(self, model_src:str, config_src:str = ""):
        if not self.model_src: # if self.model_src == None or self.model_src == "" or self.model_src == False
            return False

        try:
            if is_hf_src(model_src):
                self.predictor = SAM2ImagePredictor.from_pretrained(self.model_src)
            else:
                self.predictor = SAM2ImagePredictor(build_sam2(self.config_src, self.model_src))
            return True
        except:
            return False

    def set_model(self, model_src:str, config_src:str = ""):
        if model_src == self.model_src or not model_src:
            return False

        # # Store current values
        # old_model_src = self.model_src
        # old_config_src = self.config_src

        # # Update values with the ones given
        # self.model_src = model_src
        # self.config_src = config_src
        
        # Try loading the model with the given model (and config if not hf src)
        if not self._load_model(model_src, config_src):
            #  self.model_src = old_model_src
            #  self.config_src = old_config_src
             return False
        
        self.points = None
        self.masks = None
        return True

    def set_image(self, new_path:str):
        self.image_path = new_path
        self.points = None
        self.masks = None





