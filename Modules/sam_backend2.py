# Modules/sam_backend2.py

import os
import torch
import numpy as np
from PIL import Image
from typing import Optional, List, Tuple, Dict, Any, Union

# Attempt to import SAM2 components. Ensure 'sam2' is in PYTHONPATH or installed.
try:
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
except ImportError:
    raise ImportError("SAM2 library not found. Make sure it's installed and in your PYTHONPATH.")

# --- Import new utility functions ---
try:
    from utils.get_model import get_model, MODEL_FILES # MODEL_FILES for available keys
    from utils.get_model_config import get_config
except ImportError:
    # This fallback might be needed if running sam_backend.py directly for testing
    # and the project root isn't in PYTHONPATH. For the server, it should find `utils`.
    import sys
    # Assuming utils is one level up from Modules
    sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
    from utils.get_model import get_model, MODEL_FILES
    from utils.get_model_config import get_config
# --- End new utility imports ---


class ModelNotLoadedError(Exception):
    """Exception raised when trying to use the model before it's loaded"""
    pass

class ImageNotSetError(Exception):
    """Exception raised when trying to predict without setting an image first"""
    pass

class SAMInference:
    def __init__(self, model_size_key: Optional[str] = None, 
                 model_path_override: Optional[str] = None, 
                 config_path_override: Optional[str] = None, 
                 device: Optional[str] = None):
        """
        Initialize SAM inference backend.
        
        Args:
            model_size_key: Key from MODEL_FILES (e.g., "large", "base_plus", "small", "tiny")
            model_path_override: Direct path to model file (overrides model_size_key's checkpoint)
            config_path_override: Direct path to config file (overrides model_size_key's config)
            device: Device to run inference on (cuda, mps, cpu). If None, will be auto-detected.
        """
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1" # For Apple MPS

        self.model = None
        self.current_model_size_key = None # e.g., 'large'
        self.current_model_path = None
        self.current_config_path = None
        
        self.predictor = None
        self.predictor_args = {} 
        self.automatic_mask_generator = None
        self.automatic_mask_generator_args = {}
        
        self.device = self._get_device() if device is None else torch.device(device)
        print(f"Using device: {self.device}")

        self.image_np: Optional[np.ndarray] = None
        self.image_path: Optional[str] = None
        self.masks: Optional[np.ndarray] = None
        self.scores: Optional[np.ndarray] = None
        self.logits: Optional[np.ndarray] = None
        
        if model_size_key or model_path_override:
            self.load_model(
                model_size_key=model_size_key, 
                model_path_override=model_path_override, 
                config_path_override=config_path_override,
                force_download=False 
            )
    
    def _get_device(self) -> torch.device:
        if torch.cuda.is_available():
            device = torch.device("cuda")
            if torch.cuda.get_device_properties(0).major >= 8: # Ampere and newer
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = torch.device("mps")
            print(
                "\nSupport for MPS devices is preliminary. SAM 2 is trained with CUDA and might "
                "give numerically different outputs and sometimes degraded performance on MPS. "
            )
        else:
            device = torch.device("cpu")
        return device

    def load_model(self, model_size_key: Optional[str] = None, 
                   model_path_override: Optional[str] = None, 
                   config_path_override: Optional[str] = None, 
                   apply_postprocessing: bool = True,
                   force_download: bool = False) -> bool:
        """
        Load a SAM2 model using utils/get_model.py and utils/get_model_config.py.
        
        Args:
            model_size_key: Model size key like 'large', 'base_plus', 'small', 'tiny'.
            model_path_override: Direct path to model file.
            config_path_override: Direct path to config file.
            apply_postprocessing: Whether to apply postprocessing in build_sam2.
            force_download: Force download if using model_size_key.
            
        Returns:
            True if model loaded successfully, False otherwise.
        """
        previous_model_state = (self.model, self.current_model_size_key, self.current_model_path, self.current_config_path)
        
        resolved_model_path = None
        resolved_config_path = None

        if model_path_override:
            print(f"Using model path override: {model_path_override}")
            resolved_model_path = model_path_override
            # Try to get config from this path, or use override
            resolved_config_path = config_path_override or get_config(resolved_model_path)
            self.current_model_size_key = None # Overridden, so no specific key
        elif model_size_key:
            print(f"Attempting to load model for size: {model_size_key}")
            # The output_dir for get_model and get_config will be resolved by those functions
            # based on their internal defaults (e.g., Modules/sam2/checkpoints)
            resolved_model_path = get_model(model_size=model_size_key, force_download=force_download)
            if resolved_model_path:
                 # Try to get config from this path, or use override
                resolved_config_path = config_path_override or get_config(resolved_model_path) # or get_config(model_size_key)
            self.current_model_size_key = model_size_key
        else:
            print("Error: Either model_size_key or model_path_override must be provided.")
            return False

        if not resolved_model_path or not os.path.exists(resolved_model_path):
            print(f"Error: Model path '{resolved_model_path}' could not be resolved or does not exist.")
            # Revert
            self.model, self.current_model_size_key, self.current_model_path, self.current_config_path = previous_model_state
            return False
        if not resolved_config_path or not os.path.exists(resolved_config_path):
            print(f"Error: Config path '{resolved_config_path}' could not be resolved or does not exist.")
            # Revert
            self.model, self.current_model_size_key, self.current_model_path, self.current_config_path = previous_model_state
            return False

        try:
            print(f"Loading model from: {resolved_model_path}")
            print(f"Using config: {resolved_config_path}")
            
            if self.device.type == "cuda":
                with torch.autocast(self.device.type, dtype=torch.bfloat16):
                    new_model = build_sam2(resolved_config_path, resolved_model_path, 
                                           device=self.device, apply_postprocessing=apply_postprocessing)
            else:
                 new_model = build_sam2(resolved_config_path, resolved_model_path, 
                                       device=self.device, apply_postprocessing=apply_postprocessing)
            
            self.model = new_model
            self.current_model_path = resolved_model_path
            self.current_config_path = resolved_config_path
            
            self.create_predictor(**self.predictor_args)
            if self.automatic_mask_generator_args or self.automatic_mask_generator is not None:
                 self.create_automatic_mask_generator(**self.automatic_mask_generator_args)
            
            self.masks = None
            self.scores = None
            self.logits = None
            
            print(f"Model '{self.current_model_size_key or os.path.basename(self.current_model_path)}' loaded successfully.")
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            # import traceback
            # traceback.print_exc()
            self.model, self.current_model_size_key, self.current_model_path, self.current_config_path = previous_model_state
            if self.model:
                self.create_predictor(**self.predictor_args)
                if self.automatic_mask_generator_args or self.automatic_mask_generator is not None:
                    self.create_automatic_mask_generator(**self.automatic_mask_generator_args)
            return False

    def create_predictor(self, mask_threshold: float = 0.0, **kwargs) -> bool:
        if self.model is None:
            print("Cannot create predictor: Model not loaded.")
            return False
        try:
            self.predictor_args = {'mask_threshold': mask_threshold, **kwargs}
            self.predictor = SAM2ImagePredictor(self.model, **self.predictor_args)
            if self.image_np is not None:
                self.predictor.set_image(self.image_np)
            print("Predictor created/updated.")
            return True
        except Exception as e:
            print(f"Error creating predictor: {e}")
            return False
    
    def create_automatic_mask_generator(self, **kwargs) -> bool:
        if self.model is None:
            print("Cannot create automatic mask generator: Model not loaded.")
            return False
        try:
            self.automatic_mask_generator_args = kwargs
            self.automatic_mask_generator = SAM2AutomaticMaskGenerator(self.model, **kwargs)
            print("Automatic mask generator created/updated.")
            return True
        except Exception as e:
            print(f"Error creating automatic mask generator: {e}")
            return False
    
    def set_image(self, image_data: Union[str, np.ndarray, Image.Image]) -> bool:
        if self.predictor is None:
            if not self.model:
                print("Cannot set image: Model not loaded.")
                return False
            if not self.create_predictor():
                print("Cannot set image: Failed to create predictor.")
                return False
            
        try:
            if isinstance(image_data, str):
                if not os.path.exists(image_data):
                    print(f"Image path does not exist: {image_data}")
                    return False
                self.image_path = image_data
                pil_image = Image.open(image_data).convert("RGB")
                self.image_np = np.array(pil_image)
            elif isinstance(image_data, Image.Image):
                self.image_np = np.array(image_data.convert("RGB"))
                self.image_path = None
            elif isinstance(image_data, np.ndarray):
                self.image_np = image_data
                self.image_path = None
            else:
                print("Invalid image data type. Must be path, PIL Image, or numpy array.")
                return False

            if self.device.type == "cuda":
                with torch.autocast(self.device.type, dtype=torch.bfloat16):
                    self.predictor.set_image(self.image_np)
            else:
                self.predictor.set_image(self.image_np)
            
            self.masks = None
            self.scores = None
            self.logits = None
            print(f"Image set successfully. Shape: {self.image_np.shape}")
            return True
        except Exception as e:
            print(f"Error setting image: {e}")
            self.image_np = None
            self.image_path = None
            return False
    
    def predict(self, 
                point_coords: Optional[np.ndarray] = None, 
                point_labels: Optional[np.ndarray] = None, 
                box: Optional[np.ndarray] = None, 
                mask_input: Optional[np.ndarray] = None,
                multimask_output: bool = True, 
                normalize_coords: bool = True,
                return_logits_to_caller: bool = True,
                sort_results: bool = True
               ) -> Optional[Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]]:
        """
        Predict masks using SAM2ImagePredictor.
        
        Args:
            point_coords: Point coordinates as numpy array. Can be single point [x, y] or multiple points [[x1, y1], [x2, y2], ...]
            point_labels: Point labels (1 for foreground, 0 for background)
            box: Bounding box(es) in xyxy format. Can be:
                - Single box: [x1, y1, x2, y2]
                - Multiple boxes: [[x1, y1, x2, y2], [x1, y1, x2, y2], ...]
            mask_input: Previous mask prediction to refine
            multimask_output: Whether to return multiple masks
            normalize_coords: Whether to normalize coordinates
            return_logits_to_caller: Whether to return logits
            sort_results: Whether to sort results by score
            
        Returns:
            Tuple of (masks, scores, logits) or None if prediction fails
        """
        if self.predictor is None:
            raise ModelNotLoadedError("Model not loaded. Call load_model() first.")
        if self.image_np is None:
            raise ImageNotSetError("Image not set. Call set_image() first.")
        
        try:
            if point_coords is not None: 
                point_coords = np.asarray(point_coords)
            if point_labels is not None: 
                point_labels = np.asarray(point_labels)
            if box is not None: 
                box = np.asarray(box)
                # Handle both single box and multiple boxes
                if box.ndim == 1:
                    # Single box: [x1, y1, x2, y2] -> [[x1, y1, x2, y2]]
                    box = box[None, :]
                elif box.ndim == 2 and box.shape[1] == 4:
                    # Multiple boxes: already in correct format [[x1, y1, x2, y2], ...]
                    pass
                else:
                    raise ValueError(f"Invalid box format. Expected shape (4,) or (N, 4), got {box.shape}")
            if mask_input is not None: 
                mask_input = np.asarray(mask_input)
            
            if self.device.type == "cuda":
                with torch.autocast(self.device.type, dtype=torch.bfloat16):
                    masks, scores, logits = self.predictor.predict(
                        point_coords=point_coords, point_labels=point_labels,
                        box=box, mask_input=mask_input,
                        multimask_output=multimask_output, normalize_coords=normalize_coords 
                    )
            else:
                 masks, scores, logits = self.predictor.predict(
                    point_coords=point_coords, point_labels=point_labels,
                    box=box, mask_input=mask_input,
                    multimask_output=multimask_output, normalize_coords=normalize_coords
                )
            
            if sort_results and scores is not None and len(scores) > 0:
                if scores.ndim == 1:
                    sorted_ind = np.argsort(scores)[::-1]
                    masks = masks[sorted_ind]
                    scores = scores[sorted_ind]
                    logits = logits[sorted_ind] if logits is not None else None

            self.masks = masks
            self.scores = scores
            self.logits = logits
            
            return (masks, scores, logits) if return_logits_to_caller else (masks, scores, None)
        except Exception as e:
            print(f"Error during prediction: {e}")
            return None
    
    def generate_auto_masks(self, image_data: Optional[Union[str, np.ndarray, Image.Image]] = None, 
                       **kwargs) -> Optional[List[Dict[str, Any]]]:
        if self.model is None:
            raise ModelNotLoadedError("Model not loaded. Call load_model() first.")
        
        target_image_np: Optional[np.ndarray] = None
        if image_data is not None:
            if isinstance(image_data, str):
                if not os.path.exists(image_data): return None
                target_image_np = np.array(Image.open(image_data).convert("RGB"))
            elif isinstance(image_data, Image.Image):
                target_image_np = np.array(image_data.convert("RGB"))
            elif isinstance(image_data, np.ndarray):
                target_image_np = image_data
        else:
            target_image_np = self.image_np

        if target_image_np is None:
            raise ImageNotSetError("Image not set/provided. Call set_image() or provide image_data.")

        if self.automatic_mask_generator is None or \
           (kwargs and kwargs != self.automatic_mask_generator_args):
            if not self.create_automatic_mask_generator(**kwargs):
                print("Failed to create/update automatic mask generator.")
                return None
        
        try:
            if self.device.type == "cuda":
                with torch.autocast(self.device.type, dtype=torch.bfloat16):
                    generated_masks = self.automatic_mask_generator.generate(target_image_np)
            else:
                generated_masks = self.automatic_mask_generator.generate(target_image_np)
            return generated_masks
        except Exception as e:
            print(f"Error generating masks: {e}")
            return None
    
    def get_recent_results(self) -> Dict[str, Any]:
        return {"masks": self.masks, "scores": self.scores, "logits": self.logits}

    def get_image_dimensions(self) -> Optional[Tuple[int, int]]:
        if self.image_np is not None:
            return (self.image_np.shape[1], self.image_np.shape[0]) # W, H
        return None

    def get_available_model_keys(self) -> List[str]:
        """
        Returns the model-size keys that can be passed back to `load_model()`
        """
        try:
            model_sizes = list(MODEL_FILES.keys())

            # hide the alias "base" if both "base" and "base_plus" exist
            if "base" in model_sizes and "base_plus" in model_sizes:
                model_sizes.remove("base")
            return model_sizes
        except Exception as e:
            print(f"Error getting available model keys: {e}")
            return []  # Return empty list instead of None to prevent UI errors

    def cleanup(self) -> None:
        self.model = None
        self.predictor = None
        self.automatic_mask_generator = None
        self.image_np = None
        self.masks = None
        self.scores = None
        self.logits = None
        
        if self.device.type == "cuda":
            torch.cuda.empty_cache()
        print("SAMInference resources cleaned up.")