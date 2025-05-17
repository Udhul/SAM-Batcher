# Modules/sam_backend.py

import os
import torch
import numpy as np
from typing import Optional, List, Tuple, Dict, Any, Union

from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator

# Import helper functions
from utils.get_model import get_model, get_config

class ModelNotLoadedError(Exception):
    """Exception raised when trying to use the model before it's loaded"""
    pass

class ImageNotSetError(Exception):
    """Exception raised when trying to predict without setting an image first"""
    pass

class SAMInference:
    def __init__(self, model_size: Optional[str] = None, model_path: Optional[str] = None, 
                 config_path: Optional[str] = None, device: str = None):
        """
        Initialize SAM inference backend.
        
        Args:
            model_size: Size of the model (tiny, small, base, large)
            model_path: Direct path to model file (overrides model_size)
            config_path: Direct path to config file (if None, will be auto-detected)
            device: Device to run inference on (cuda, mps, cpu). If None, will be auto-detected.
        """
        self.model = None
        self.model_path = model_path
        self.config_path = config_path
        self.predictor = None
        self.predictor_args = {}  # Store args used to create predictor
        self.automatic_mask_generator = None
        self.automatic_mask_generator_args = {}  # Store args used to create mask generator
        self.device = self._get_device() if device is None else device
        
        # Storage for current state
        self.image = None
        self.image_path = None
        self.masks = None
        self.scores = None
        self.logits = None
        
        # Try to load model if specified during initialization
        if model_size or model_path:
            self.load_model(model_size, model_path, config_path)
    
    def _get_device(self) -> str:
        """Determine the best available device for computation"""
        if torch.cuda.is_available():
            device = "cuda"
            # Enable optimizations for CUDA
            torch.autocast("cuda", dtype=torch.bfloat16).__enter__()
            if torch.cuda.get_device_properties(0).major >= 8:
                torch.backends.cuda.matmul.allow_tf32 = True
                torch.backends.cudnn.allow_tf32 = True
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        return device
    
    def load_model(self, model_size: Optional[str] = None, model_path: Optional[str] = None, 
                  config_path: Optional[str] = None, apply_postprocessing: bool = True) -> bool:
        """
        Load a SAM2 model.
        
        Args:
            model_size: Size of the model (tiny, small, base, large)
            model_path: Direct path to model file (overrides model_size)
            config_path: Direct path to config file
            apply_postprocessing: Whether to apply postprocessing to masks
            
        Returns:
            True if model loaded successfully, False otherwise
        """
        # Store the current model state in case loading fails
        previous_model = self.model
        previous_model_path = self.model_path
        previous_config_path = self.config_path
        
        try:
            # Determine model path
            if model_path:
                self.model_path = model_path
            elif model_size:
                self.model_path = get_model(model_size)
            else:
                return False
            
            # Determine config path
            if config_path:
                self.config_path = config_path
            else:
                # Auto-detect config from model path or size
                self.config_path = get_config(model_size or self.model_path)
            
            if not self.model_path or not self.config_path:
                # Revert to previous state
                self.model_path = previous_model_path
                self.config_path = previous_config_path
                return False
            
            # Build the model
            new_model = build_sam2(self.config_path, self.model_path, device=self.device, apply_postprocessing=apply_postprocessing)
            
            # If we got here, loading succeeded - update the model
            self.model = new_model
            
            # Rebuild predictor with new model
            if self.predictor_args:
                self.create_predictor(**self.predictor_args)
            else:
                self.predictor = SAM2ImagePredictor(self.model)
            
            # Rebuild mask generator if it was previously created
            if self.automatic_mask_generator_args:
                self.create_automatic_mask_generator(**self.automatic_mask_generator_args)
            
            # Reset current prediction state
            self.masks = None
            self.scores = None
            self.logits = None
            
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            # Revert to previous state if there was one
            if previous_model is not None:
                self.model = previous_model
                self.model_path = previous_model_path
                self.config_path = previous_config_path
                # Keep predictor and automatic_mask_generator as they are since we're reverting
            return False

    def create_predictor(self, mask_threshold: float = 0, max_hole_area: float = 0, 
                        max_sprinkle_area: float = 0, **kwargs) -> bool:
        """
        Create/update image predictor with custom parameters.
        
        Args:
            mask_threshold: Threshold for converting mask logits to binary masks
            max_hole_area: Maximum area for hole filling in low-res masks
            max_sprinkle_area: Maximum area for removing small sprinkles in low-res masks
            **kwargs: Additional arguments for SAM2ImagePredictor
            
        Returns:
            True if predictor created successfully, False otherwise
        """
        if self.model is None:
            return False
        
        try:
            # Store the arguments for future rebuilds
            self.predictor_args = {
                'mask_threshold': mask_threshold,
                'max_hole_area': max_hole_area,
                'max_sprinkle_area': max_sprinkle_area,
                **kwargs
            }
            
            # Create the predictor
            self.predictor = SAM2ImagePredictor(
                self.model,
                mask_threshold=mask_threshold,
                max_hole_area=max_hole_area,
                max_sprinkle_area=max_sprinkle_area,
                **kwargs
            )
            
            # Reset current state if image was set
            if self.image is not None:
                self.predictor.set_image(self.image)
            
            return True
        except Exception as e:
            print(f"Error creating predictor: {e}")
            return False
    
    def create_automatic_mask_generator(self, **kwargs) -> bool:
        """
        Create an automatic mask generator with optional parameters.
        
        Args:
            **kwargs: Parameters for SAM2AutomaticMaskGenerator
                - points_per_side: Number of points to sample along each side of the image
                - points_per_batch: Number of points to process in each batch
                - pred_iou_thresh: Threshold for predicted mask quality
                - stability_score_thresh: Threshold for mask stability score
                - stability_score_offset: Offset for mask stability score
                - crop_n_layers: Number of layers to use for crop
                - box_nms_thresh: Threshold for box NMS
                - crop_n_points_downscale_factor: Factor to downsample points for crops
                - min_mask_region_area: Minimum area for a mask region
                - use_m2m: Whether to use mask-to-mask refinement
        
        Returns:
            True if mask generator created successfully, False otherwise
        """
        if self.model is None:
            return False
        
        try:
            # Store the arguments for future rebuilds
            self.automatic_mask_generator_args = kwargs
            
            # Create the mask generator
            self.automatic_mask_generator = SAM2AutomaticMaskGenerator(self.model, **kwargs)
            return True
        except Exception as e:
            print(f"Error creating mask generator: {e}")
            return False
    
    def set_image(self, image: Union[str, np.ndarray]) -> bool:
        """
        Set the image for prediction.
        
        Args:
            image: Image path or numpy array
            
        Returns:
            True if image set successfully, False otherwise
        """
        if self.predictor is None:
            return False
            
        try:
            # Handle both file paths and numpy arrays
            if isinstance(image, str):
                self.image_path = image
                
                # Check if file exists
                if not os.path.exists(image):
                    return False
                
                # Load image if it's a file path - let SAM2ImagePredictor handle this
                self.predictor.set_image(image)
                self.image = self.predictor._orig_img  # Store the image
            else:
                # Assume it's already a numpy array
                self.image = image
                self.image_path = None
                self.predictor.set_image(image)
            
            # Reset prediction results
            self.masks = None
            self.scores = None
            self.logits = None
            
            return True
        except Exception as e:
            print(f"Error setting image: {e}")
            self.image = None
            return False
    
    def predict(self, point_coords=None, point_labels=None, box=None, 
                multimask_output=True, return_logits=True, sort_results=True) -> Tuple:
        """
        Run SAM2 prediction with the current image and provided prompts.
        
        Args:
            point_coords: Numpy array of point coordinates
            point_labels: Numpy array of point labels (1 for foreground, 0 for background)
            box: Bounding box in XYXY format
            multimask_output: Whether to return multiple mask predictions
            return_logits: Whether to return logits
            sort_results: Whether to sort results by score
            
        Returns:
            Tuple of (masks, scores, logits) if return_logits=True else (masks, scores)
        
        Raises:
            ModelNotLoadedError: If model is not loaded
            ImageNotSetError: If image is not set
        """
        if self.predictor is None:
            raise ModelNotLoadedError("Model not loaded. Call load_model() first.")
        
        if self.image is None:
            raise ImageNotSetError("Image not set. Call set_image() first.")
        
        try:
            masks, scores, logits = self.predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=multimask_output,
            )
            
            # Sort results by score if requested
            if sort_results and scores is not None and len(scores) > 0:
                sorted_ind = np.argsort(scores)[::-1]
                masks = masks[sorted_ind]
                scores = scores[sorted_ind]
                logits = logits[sorted_ind] if logits is not None else None
            
            # Store results as attributes
            self.masks = masks
            self.scores = scores
            self.logits = logits
            
            return (masks, scores, logits) if return_logits else (masks, scores)
        except Exception as e:
            print(f"Error during prediction: {e}")
            raise
    
    def generate_masks(self, image=None, **kwargs) -> List[Dict[str, Any]]:
        """
        Generate masks automatically without prompts.
        
        Args:
            image: Image to generate masks for (if None, uses current image)
            **kwargs: Parameters for SAM2AutomaticMaskGenerator if not created yet
            
        Returns:
            List of mask dictionaries with keys:
                - segmentation: Binary mask
                - area: Area of the mask
                - bbox: Bounding box in XYWH format
                - predicted_iou: Predicted IoU score
                - stability_score: Stability score
                - crop_box: Box used for cropping
            
        Raises:
            ModelNotLoadedError: If model is not loaded
        """
        if self.model is None:
            raise ModelNotLoadedError("Model not loaded. Call load_model() first.")
        
        # Create mask generator if not exists or if new kwargs are provided
        if self.automatic_mask_generator is None or (kwargs and kwargs != self.automatic_mask_generator_args):
            if not self.create_automatic_mask_generator(**(kwargs or {})):
                return []
        
        # Use provided image or current image
        target_image = image if image is not None else self.image
        
        if target_image is None:
            raise ImageNotSetError("Image not set. Call set_image() first or provide an image.")
        
        try:
            masks = self.automatic_mask_generator.generate(target_image)
            return masks
        except Exception as e:
            print(f"Error generating masks: {e}")
            return []
    
    def get_recent_results(self) -> Dict[str, Any]:
        """
        Get the most recent prediction results.
        
        Returns:
            Dictionary with masks, scores, and logits
        """
        return {
            "masks": self.masks,
            "scores": self.scores,
            "logits": self.logits
        }
    
    def cleanup(self) -> None:
        """Release resources and clean up"""
        self.model = None
        self.predictor = None
        self.automatic_mask_generator = None
        self.image = None
        self.masks = None
        self.scores = None
        self.logits = None
        
        # Try to free CUDA memory
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
