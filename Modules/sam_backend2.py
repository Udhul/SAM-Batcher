# Modules/sam_backend2.py

import os
import torch
import numpy as np
from PIL import Image
from typing import Optional, List, Tuple, Dict, Any, Union, Callable
import hashlib
import base64
from io import BytesIO

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
    # This fallback might be needed if running sam_backend2.py directly for testing
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

class InferenceObjectNotAvailableError(Exception):
    """Exception raised when trying to use predictor/automask generator that's not loaded"""
    pass

class SAMInference:
    def __init__(self, model_size_key: Optional[str] = None, 
                 model_path_override: Optional[str] = None, 
                 config_path_override: Optional[str] = None, 
                 device: Optional[str] = None,
                 exclusive_mode: bool = False):
        """
        Initialize SAM inference backend with support for both interactive prediction and automatic mask generation.
        
        Args:
            model_size_key: Key from MODEL_FILES (e.g., "large", "base_plus", "small", "tiny")
            model_path_override: Direct path to model file (overrides model_size_key's checkpoint)
            config_path_override: Direct path to config file (overrides model_size_key's config)
            device: Device to run inference on (cuda, mps, cpu). If None, will be auto-detected.
            exclusive_mode: If True, only one of predictor or automask generator can be loaded at a time.
                           When one is created, the other is automatically unloaded to save memory.
                           If False, both can coexist simultaneously.
        """
        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1" # For Apple MPS

        # Model state
        self.model = None
        self.current_model_size_key = None # e.g., 'large'
        self.current_model_path = None
        self.current_config_path = None
        self.apply_postprocessing = True
        
        # Inference objects and their configurations
        self.predictor = None
        self.predictor_args = {} 
        self.automatic_mask_generator = None
        self.automatic_mask_generator_args = {}
        
        # Mode control
        self.exclusive_mode = exclusive_mode
        self.active_inference_type = None  # 'predictor' or 'automask' or None
        
        # Device management
        self.device = self._get_device() if device is None else torch.device(device)
        print(f"Using device: {self.device}")

        # Image state
        self.image_np: Optional[np.ndarray] = None
        self.image_path: Optional[str] = None
        self.image_hash: Optional[str] = None
        
        # Results state
        self.masks: Optional[np.ndarray] = None
        self.scores: Optional[np.ndarray] = None
        self.logits: Optional[np.ndarray] = None
        
        # Initialize model if provided
        if model_size_key or model_path_override:
            self.load_model(
                model_size_key=model_size_key, 
                model_path_override=model_path_override, 
                config_path_override=config_path_override,
                force_download=False 
            )
    
    def _get_device(self) -> torch.device:
        """Auto-detect the best available device for inference."""
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
                   force_download: bool = False,
                   progress_callback: Optional[Callable[[float, int, int], None]] = None) -> bool:
        """
        Load a SAM2 model using utils/get_model.py and utils/get_model_config.py.
        When a new model is loaded, any existing image will be automatically reloaded onto the new model.
        
        Args:
            model_size_key: Model size key like 'large', 'base_plus', 'small', 'tiny'.
            model_path_override: Direct path to model file.
            config_path_override: Direct path to config file.
            apply_postprocessing: Whether to apply postprocessing in build_sam2.
            force_download: Force download if using model_size_key.
            progress_callback: Optional callback for download progress tracking.
                            Called with (progress_percentage, downloaded_bytes, total_bytes).
                            Suitable for frontend progress display integration.
            
        Returns:
            True if model loaded successfully, False otherwise.
        """
        # Store previous state for rollback
        previous_model_state = (
            self.model, self.current_model_size_key, self.current_model_path, 
            self.current_config_path, self.apply_postprocessing
        )
        previous_image = (self.image_np, self.image_path, self.image_hash)
        
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
            # Create a wrapper progress callback that adds model loading context
            wrapped_progress_callback = None
            if progress_callback:
                def wrapped_progress_callback(progress_percentage: float, downloaded_bytes: int, total_bytes: int):
                    """
                    Wrapper for progress callback that ensures compatibility with frontend integration.
                    Provides download progress with model context.
                    
                    Args:
                        progress_percentage: Download progress as percentage (0.0-100.0)
                        downloaded_bytes: Number of bytes downloaded so far
                        total_bytes: Total bytes to download
                    """
                    try:
                        # Call the original callback with the exact signature expected by frontend
                        progress_callback(progress_percentage, downloaded_bytes, total_bytes)
                    except Exception as e:
                        # Don't let progress callback errors interrupt model loading
                        print(f"Progress callback error: {e}")
            
            # Pass progress callback through to get_model
            resolved_model_path = get_model(
                model_size=model_size_key, 
                force_download=force_download,
                progress_callback=wrapped_progress_callback
            )
            
            if resolved_model_path:
                # Try to get config from this path, or use override
                resolved_config_path = config_path_override or get_config(resolved_model_path)
            self.current_model_size_key = model_size_key
        else:
            print("Error: Either model_size_key or model_path_override must be provided.")
            return False

        if not resolved_model_path or not os.path.exists(resolved_model_path):
            print(f"Error: Model path '{resolved_model_path}' could not be resolved or does not exist.")
            return False
        if not resolved_config_path or not os.path.exists(resolved_config_path):
            print(f"Error: Config path '{resolved_config_path}' could not be resolved or does not exist.")
            return False

        try:
            print(f"Loading model from: {resolved_model_path}")
            print(f"Using config: {resolved_config_path}")
            
            # Notify progress callback that model building is starting (if callback provided)
            if progress_callback:
                try:
                    # Signal that download is complete and model building is starting
                    progress_callback(100.0, 0, 0)  # 100% download, now building model
                except Exception as e:
                    print(f"Progress callback error during model building notification: {e}")
            
            # Build the model
            if self.device.type == "cuda":
                # TODO: Control precision cast from class attr. depeneding on device
                with torch.autocast(self.device.type, dtype=torch.bfloat16):
                    new_model = build_sam2(resolved_config_path, resolved_model_path, 
                                           device=self.device, apply_postprocessing=apply_postprocessing)
            else:
                new_model = build_sam2(resolved_config_path, resolved_model_path, 
                                       device=self.device, apply_postprocessing=apply_postprocessing)
            
            # Update model state
            self.model = new_model
            self.current_model_path = resolved_model_path
            self.current_config_path = resolved_config_path
            self.apply_postprocessing = apply_postprocessing
            
            # Recreate inference objects if they were previously configured
            predictor_existed = self.predictor is not None
            automask_existed = self.automatic_mask_generator is not None
            
            # Clear existing inference objects
            self.predictor = None
            self.automatic_mask_generator = None
            self.active_inference_type = None
            
            # Recreate them with stored configurations
            if predictor_existed:
                self.create_predictor(**self.predictor_args)
            if automask_existed:
                self.create_automatic_mask_generator(**self.automatic_mask_generator_args)
            
            # Clear previous results
            self.masks = None
            self.scores = None
            self.logits = None
            
            # Reload image if one was previously set
            if previous_image[0] is not None:
                print("Reloading image onto new model...")
                if previous_image[1]:  # If we have the original path
                    self.set_image(previous_image[1])
                else:  # If we only have the numpy array
                    self.set_image(previous_image[0])
            
            print(f"Model '{self.current_model_size_key or os.path.basename(self.current_model_path)}' loaded successfully.")
            return True
            
        except Exception as e:
            print(f"Error loading model: {e}")
            # Rollback to previous state
            (self.model, self.current_model_size_key, self.current_model_path, 
             self.current_config_path, self.apply_postprocessing) = previous_model_state
            (self.image_np, self.image_path, self.image_hash) = previous_image
            
            # Recreate inference objects if model exists
            if self.model:
                if self.predictor_args:
                    self.create_predictor(**self.predictor_args)
                if self.automatic_mask_generator_args:
                    self.create_automatic_mask_generator(**self.automatic_mask_generator_args)
            return False

    def create_predictor(self, mask_threshold: float = 0.0, 
                        max_hole_area: float = 0.0, 
                        max_sprinkle_area: float = 0.0, 
                        **kwargs) -> bool:
        """
        Create or update the SAM2ImagePredictor for interactive mask prediction.
        
        Args:
            mask_threshold: The threshold to use when converting mask logits to binary masks. 
                          Masks are thresholded at 0 by default.
            max_hole_area: If max_hole_area > 0, fill small holes in up to the maximum area 
                          of max_hole_area in low_res_masks.
            max_sprinkle_area: If max_sprinkle_area > 0, remove small sprinkles up to the 
                             maximum area of max_sprinkle_area in low_res_masks.
            **kwargs: Additional arguments passed to SAM2ImagePredictor constructor.
            
        Returns:
            True if predictor created successfully, False otherwise.
        """
        if self.model is None:
            print("Cannot create predictor: Model not loaded.")
            return False
            
        # Handle exclusive mode
        if self.exclusive_mode and self.automatic_mask_generator is not None:
            print("Exclusive mode: Unloading automatic mask generator to create predictor.")
            self._unload_automatic_mask_generator()
            
        try:
            self.predictor_args = {
                'mask_threshold': mask_threshold, 
                'max_hole_area': max_hole_area,
                'max_sprinkle_area': max_sprinkle_area,
                **kwargs
            }
            self.predictor = SAM2ImagePredictor(self.model, **self.predictor_args)
            self.active_inference_type = 'predictor'
            
            # Set image if one is loaded
            if self.image_np is not None:
                self.predictor.set_image(self.image_np)
                
            print("Predictor created/updated.")
            return True
        except Exception as e:
            print(f"Error creating predictor: {e}")
            return False
    
    def create_automatic_mask_generator(self, 
                                      points_per_side: Optional[int] = 32,
                                      points_per_batch: int = 64,
                                      pred_iou_thresh: float = 0.8,
                                      stability_score_thresh: float = 0.95,
                                      stability_score_offset: float = 1.0,
                                      mask_threshold: float = 0.0,
                                      box_nms_thresh: float = 0.7,
                                      crop_n_layers: int = 0,
                                      crop_nms_thresh: float = 0.7,
                                      crop_overlap_ratio: float = 512 / 1500,
                                      crop_n_points_downscale_factor: int = 1,
                                      point_grids: Optional[List[np.ndarray]] = None,
                                      min_mask_region_area: int = 0,
                                      output_mode: str = "binary_mask",
                                      use_m2m: bool = False,
                                      multimask_output: bool = True,
                                      **kwargs) -> bool:
        """
        Create or update the SAM2AutomaticMaskGenerator for automatic mask generation.
        
        Args:
            points_per_side: The number of points to be sampled along one side of the image. 
                           The total number of points is points_per_side**2. If None, 'point_grids' 
                           must provide explicit point sampling.
            points_per_batch: Sets the number of points run simultaneously by the model. 
                            Higher numbers may be faster but use more GPU memory.
            pred_iou_thresh: A filtering threshold in [0,1], using the model's predicted mask quality.
            stability_score_thresh: A filtering threshold in [0,1], using the stability of the mask 
                                  under changes to the cutoff used to binarize the model's mask predictions.
            stability_score_offset: The amount to shift the cutoff when calculated the stability score.
            mask_threshold: Threshold for binarizing the mask logits.
            box_nms_thresh: The box IoU cutoff used by non-maximal suppression to filter duplicate masks.
            crop_n_layers: If >0, mask prediction will be run again on crops of the image. 
                         Sets the number of layers to run, where each layer has 2**i_layer number of image crops.
            crop_nms_thresh: The box IoU cutoff used by non-maximal suppression to filter 
                           duplicate masks between different crops.
            crop_overlap_ratio: Sets the degree to which crops overlap. In the first crop layer, 
                              crops will overlap by this fraction of the image length.
            crop_n_points_downscale_factor: The number of points-per-side sampled in layer n is 
                                          scaled down by crop_n_points_downscale_factor**n.
            point_grids: A list over explicit grids of points used for sampling, normalized to [0,1]. 
                       The nth grid in the list is used in the nth crop layer. Exclusive with points_per_side.
            min_mask_region_area: If >0, postprocessing will be applied to remove disconnected regions 
                                and holes in masks with area smaller than min_mask_region_area.
            output_mode: The form masks are returned in. Can be 'binary_mask', 'uncompressed_rle', or 'coco_rle'.
            use_m2m: Whether to add a one step refinement using previous mask predictions.
            multimask_output: Whether to output multimask at each point of the grid.
            **kwargs: Additional arguments passed to SAM2AutomaticMaskGenerator constructor.
            
        Returns:
            True if automatic mask generator created successfully, False otherwise.
        """
        if self.model is None:
            print("Cannot create automatic mask generator: Model not loaded.")
            return False
            
        # Handle exclusive mode
        if self.exclusive_mode and self.predictor is not None:
            print("Exclusive mode: Unloading predictor to create automatic mask generator.")
            self._unload_predictor()
            
        try:
            self.automatic_mask_generator_args = {
                'points_per_side': points_per_side,
                'points_per_batch': points_per_batch,
                'pred_iou_thresh': pred_iou_thresh,
                'stability_score_thresh': stability_score_thresh,
                'stability_score_offset': stability_score_offset,
                'mask_threshold': mask_threshold,
                'box_nms_thresh': box_nms_thresh,
                'crop_n_layers': crop_n_layers,
                'crop_nms_thresh': crop_nms_thresh,
                'crop_overlap_ratio': crop_overlap_ratio,
                'crop_n_points_downscale_factor': crop_n_points_downscale_factor,
                'point_grids': point_grids,
                'min_mask_region_area': min_mask_region_area,
                'output_mode': output_mode,
                'use_m2m': use_m2m,
                'multimask_output': multimask_output,
                **kwargs
            }
            self.automatic_mask_generator = SAM2AutomaticMaskGenerator(self.model, **self.automatic_mask_generator_args)
            self.active_inference_type = 'automask'
            
            print("Automatic mask generator created/updated.")
            return True
        except Exception as e:
            print(f"Error creating automatic mask generator: {e}")
            return False

    def _unload_predictor(self) -> None:
        """Unload the predictor to free memory."""
        if self.predictor is not None:
            self.predictor = None
            if self.device.type == "cuda":
                torch.cuda.empty_cache()
            print("Predictor unloaded.")

    def _unload_automatic_mask_generator(self) -> None:
        """Unload the automatic mask generator to free memory."""
        if self.automatic_mask_generator is not None:
            self.automatic_mask_generator = None
            if self.device.type == "cuda":
                torch.cuda.empty_cache()
            print("Automatic mask generator unloaded.")

    def set_exclusive_mode(self, exclusive: bool) -> None:
        """
        Set the exclusive mode for inference objects.
        
        Args:
            exclusive: If True, only one inference object can be loaded at a time.
        """
        self.exclusive_mode = exclusive
        print(f"Exclusive mode set to: {exclusive}")

    def get_inference_status(self) -> Dict[str, Any]:
        """
        Get the current status of inference objects.
        
        Returns:
            Dictionary containing status of predictor and automask generator.
        """
        return {
            "exclusive_mode": self.exclusive_mode,
            "active_inference_type": self.active_inference_type,
            "predictor_loaded": self.predictor is not None,
            "automask_loaded": self.automatic_mask_generator is not None,
            "predictor_args": self.predictor_args.copy() if self.predictor_args else {},
            "automask_args": self.automatic_mask_generator_args.copy() if self.automatic_mask_generator_args else {}
        }
    
    def _calculate_image_hash(self, image_data: Union[str, np.ndarray, Image.Image]) -> str:
        """Calculate MD5 hash of image data for identification."""
        if isinstance(image_data, str):
            # File path - hash the file content
            with open(image_data, 'rb') as f:
                return hashlib.md5(f.read()).hexdigest()
        elif isinstance(image_data, Image.Image):
            # PIL Image - convert to bytes and hash
            buffer = BytesIO()
            image_data.save(buffer, format='PNG')
            return hashlib.md5(buffer.getvalue()).hexdigest()
        elif isinstance(image_data, np.ndarray):
            # NumPy array - hash the array data
            return hashlib.md5(image_data.tobytes()).hexdigest()
        else:
            raise ValueError("Unsupported image data type for hashing")

    def set_image(self, image_data: Union[str, np.ndarray, Image.Image]) -> bool:
        """
        Set the current image for inference. The image will be loaded onto whichever
        inference object (predictor or automask generator) is currently active.
        
        Args:
            image_data: Image data as file path (str), PIL Image, or numpy array in RGB format.
                       For numpy arrays, expected format is HWC with values in [0, 255].
                       
        Returns:
            True if image was set successfully, False otherwise.
        """
        try:
            # Process image data
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

            # Calculate image hash for identification
            self.image_hash = self._calculate_image_hash(image_data)

            # Set image on predictor if it exists
            # TODO: Control precision cast from class attr. depeneding on device
            if self.predictor is not None:
                if self.device.type == "cuda":
                    with torch.autocast(self.device.type, dtype=torch.bfloat16):
                        self.predictor.set_image(self.image_np)
                else:
                    self.predictor.set_image(self.image_np)
            
            # Clear previous results since we have a new image
            self.masks = None
            self.scores = None
            self.logits = None
            
            print(f"Image set successfully. Shape: {self.image_np.shape}, Hash: {self.image_hash[:8]}...")
            return True
        except Exception as e:
            print(f"Error setting image: {e}")
            self.image_np = None
            self.image_path = None
            self.image_hash = None
            return False

    def get_image_as_base64(self) -> Optional[str]:
        """
        Get the current image as a base64-encoded string for sending to client.
        
        Returns:
            Base64-encoded image string with data URL prefix, or None if no image is set.
        """
        if self.image_np is None:
            return None
            
        try:
            # Convert numpy array to PIL Image
            pil_image = Image.fromarray(self.image_np)
            
            # Convert to base64
            buffer = BytesIO()
            pil_image.save(buffer, format='JPEG', quality=95)
            img_base64 = base64.b64encode(buffer.getvalue()).decode()
            
            return f"data:image/jpeg;base64,{img_base64}"
        except Exception as e:
            print(f"Error converting image to base64: {e}")
            return None

    def predict(self, 
                point_coords: Optional[np.ndarray] = None, 
                point_labels: Optional[np.ndarray] = None, 
                box: Optional[np.ndarray] = None, 
                mask_input: Optional[np.ndarray] = None,
                multimask_output: bool = True, 
                normalize_coords: bool = True,
                return_logits: bool = True) -> Optional[Tuple[np.ndarray, np.ndarray, Optional[np.ndarray]]]:
        """
        Predict masks using SAM2ImagePredictor with interactive prompts.
        
        Args:
            point_coords: Point coordinates as numpy array. Can be single point [x, y] or 
                         multiple points [[x1, y1], [x2, y2], ...]. Coordinates should be in 
                         image pixel coordinates if normalize_coords=True.
            point_labels: Point labels (1 for foreground, 0 for background). Must be provided 
                         if point_coords is provided.
            box: Bounding box(es) in xyxy format. Can be:
                - Single box: [x1, y1, x2, y2]
                - Multiple boxes: [[x1, y1, x2, y2], [x1, y1, x2, y2], ...]
                Coordinates should be in image pixel coordinates if normalize_coords=True.
            mask_input: Previous mask prediction to refine. Should be a low resolution mask 
                       (typically 256x256) from a previous prediction iteration.
            multimask_output: If True, the model will return three masks. For ambiguous input 
                            prompts (such as a single click), this will often produce better masks 
                            than a single prediction. If only a single mask is needed, the model's 
                            predicted quality score can be used to select the best mask.
            normalize_coords: If True, the point coordinates will be normalized to the range [0,1] 
                            and point_coords is expected to be wrt. image dimensions.
            return_logits: If True, returns un-thresholded masks logits instead of a binary mask.
            
        Returns:
            Tuple of (masks, scores, logits) where:
            - masks: Output masks in CxHxW format, where C is the number of masks, and (H, W) is the original image size
            - scores: Array of length C containing the model's predictions for the quality of each mask
            - logits: Array of shape CxHxW with low resolution logits (can be passed to subsequent iteration as mask input)
            Returns None if prediction fails.
        """
        if self.predictor is None:
            if self.model is None:
                raise ModelNotLoadedError("Model not loaded. Call load_model() first.")
            else:
                raise InferenceObjectNotAvailableError("Predictor not loaded. Call create_predictor() first.")
                
        if self.image_np is None:
            raise ImageNotSetError("Image not set. Call set_image() first.")
        
        try:
            # Ensure predictor is active in exclusive mode
            if self.exclusive_mode and self.active_inference_type != 'predictor':
                if not self.create_predictor(**self.predictor_args):
                    print("Failed to activate predictor in exclusive mode.")
                    return None
            
            # Convert inputs to numpy arrays if provided
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
            
            # Run prediction with appropriate precision
            # TODO: Control precision cast from class attr. depeneding on device
            if self.device.type == "cuda":
                with torch.autocast(self.device.type, dtype=torch.bfloat16):
                    masks, scores, logits = self.predictor.predict(
                        point_coords=point_coords, point_labels=point_labels,
                        box=box, mask_input=mask_input,
                        multimask_output=multimask_output, normalize_coords=normalize_coords,
                        return_logits=return_logits
                    )
            else:
                masks, scores, logits = self.predictor.predict(
                    point_coords=point_coords, point_labels=point_labels,
                    box=box, mask_input=mask_input,
                    multimask_output=multimask_output, normalize_coords=normalize_coords,
                    return_logits=return_logits
                )
            
            # Sort results by score if multiple masks and scores available
            if scores is not None and len(scores) > 1:
                sorted_ind = np.argsort(scores)[::-1]
                masks = masks[sorted_ind]
                scores = scores[sorted_ind]
                if logits is not None:
                    logits = logits[sorted_ind]

            # Store results
            self.masks = masks
            self.scores = scores
            self.logits = logits
            
            return (masks, scores, logits)
        except Exception as e:
            print(f"Error during prediction: {e}")
            return None
    
    def generate_auto_masks(self, image_data: Optional[Union[str, np.ndarray, Image.Image]] = None, 
                           **kwargs) -> Optional[List[Dict[str, Any]]]:
        """
        Generate automatic masks for the entire image using SAM2AutomaticMaskGenerator.
        
        Args:
            image_data: Optional image data to use. If None, uses the currently set image.
                       Can be file path (str), PIL Image, or numpy array in RGB format.
            **kwargs: Additional parameters to override the automask generator settings for this call.
                     Can include any parameter accepted by SAM2AutomaticMaskGenerator.generate().
                     
        Available kwargs (will override generator defaults if provided):
            - Any parameter from create_automatic_mask_generator() can be passed here to 
              temporarily override the generator's configuration for this specific generation call.
            
        Returns:
            List of mask annotation dictionaries, each containing:
            - segmentation: The mask data (format depends on output_mode setting)
            - bbox: Bounding box around the mask in XYWH format
            - area: Area in pixels of the mask
            - predicted_iou: Model's prediction of the mask quality
            - point_coords: Point coordinates used to generate this mask
            - stability_score: Measure of mask quality under threshold changes
            - crop_box: Crop region used to generate the mask in XYWH format
            Returns None if generation fails.
        """
        if self.model is None:
            raise ModelNotLoadedError("Model not loaded. Call load_model() first.")
            
        # Determine target image
        target_image_np: Optional[np.ndarray] = None
        if image_data is not None:
            if isinstance(image_data, str):
                if not os.path.exists(image_data): 
                    print(f"Provided image path does not exist: {image_data}")
                    return None
                target_image_np = np.array(Image.open(image_data).convert("RGB"))
            elif isinstance(image_data, Image.Image):
                target_image_np = np.array(image_data.convert("RGB"))
            elif isinstance(image_data, np.ndarray):
                target_image_np = image_data
            else:
                print("Invalid image_data type. Must be path, PIL Image, or numpy array.")
                return None
        else:
            target_image_np = self.image_np

        if target_image_np is None:
            raise ImageNotSetError("No image available. Call set_image() or provide image_data.")

        # Handle automask generator creation/updating
        if self.automatic_mask_generator is None:
            print("Automatic mask generator not found. Creating with default parameters...")
            if not self.create_automatic_mask_generator():
                print("Failed to create automatic mask generator.")
                return None
        elif self.exclusive_mode and self.active_inference_type != 'automask':
            # Reactivate automask generator in exclusive mode
            if not self.create_automatic_mask_generator(**self.automatic_mask_generator_args):
                print("Failed to reactivate automatic mask generator in exclusive mode.")
                return None
        
        # Update generator with temporary kwargs if provided
        temp_generator = None
        if kwargs:
            try:
                # Create temporary generator with modified args
                temp_args = self.automatic_mask_generator_args.copy()
                temp_args.update(kwargs)
                temp_generator = SAM2AutomaticMaskGenerator(self.model, **temp_args)
                generator_to_use = temp_generator
                print(f"Using temporary generator with modified parameters: {list(kwargs.keys())}")
            except Exception as e:
                print(f"Failed to create temporary generator with kwargs: {e}")
                generator_to_use = self.automatic_mask_generator
        else:
            generator_to_use = self.automatic_mask_generator
        
        try:
            # Generate masks with appropriate precision
            # TODO: Control precision cast from class attr. depeneding on device
            if self.device.type == "cuda":
                with torch.autocast(self.device.type, dtype=torch.bfloat16):
                    generated_masks = generator_to_use.generate(target_image_np)
            else:
                generated_masks = generator_to_use.generate(target_image_np)
                
            print(f"Generated {len(generated_masks)} automatic masks.")
            return generated_masks
        except Exception as e:
            print(f"Error generating masks: {e}")
            return None
        finally:
            # Clean up temporary generator
            if temp_generator is not None:
                del temp_generator
                if self.device.type == "cuda":
                    torch.cuda.empty_cache()

    def get_recent_results(self) -> Dict[str, Any]:
        """
        Get the most recent prediction results.
        
        Returns:
            Dictionary containing recent masks, scores, and logits from interactive prediction.
        """
        return {
            "masks": self.masks, 
            "scores": self.scores, 
            "logits": self.logits,
            "image_hash": self.image_hash
        }

    def get_image_info(self) -> Dict[str, Any]:
        """
        Get information about the currently loaded image.
        
        Returns:
            Dictionary containing image dimensions, hash, and other metadata.
        """
        if self.image_np is None:
            return {"loaded": False}
            
        return {
            "loaded": True,
            "width": int(self.image_np.shape[1]),
            "height": int(self.image_np.shape[0]), 
            "channels": int(self.image_np.shape[2]) if len(self.image_np.shape) > 2 else 1,
            "hash": self.image_hash,
            "path": self.image_path
        }

    def get_image_dimensions(self) -> Optional[Tuple[int, int]]:
        """
        Get the dimensions of the currently loaded image.
        
        Returns:
            Tuple of (width, height) or None if no image is loaded.
        """
        if self.image_np is not None:
            return (self.image_np.shape[1], self.image_np.shape[0]) # W, H
        return None

    def get_available_model_keys(self) -> List[str]:
        """
        Get the list of available model size keys that can be used with load_model().
        
        Returns:
            List of model size keys (e.g., ['tiny', 'small', 'base_plus', 'large']).
            The 'base' key is hidden if 'base_plus' exists to avoid confusion.
        """
        try:
            model_sizes = list(MODEL_FILES.keys())

            # Hide the alias "base" if both "base" and "base_plus" exist
            if "base" in model_sizes and "base_plus" in model_sizes:
                model_sizes.remove("base")
            return sorted(model_sizes)
        except Exception as e:
            print(f"Error getting available model keys: {e}")
            return []

    def get_model_info(self) -> Dict[str, Any]:
        """
        Get information about the currently loaded model.
        
        Returns:
            Dictionary containing model details and status.
        """
        return {
            "loaded": self.model is not None,
            "model_size_key": self.current_model_size_key,
            "model_path": self.current_model_path,
            "config_path": self.current_config_path,
            "apply_postprocessing": self.apply_postprocessing,
            "device": str(self.device),
            "inference_status": self.get_inference_status()
        }

    def prepare_masks_for_export(self, masks: Optional[np.ndarray] = None, 
                                format_type: str = "rle") -> Optional[List[Dict[str, Any]]]:
        """
        Prepare masks for export in various formats.
        
        Args:
            masks: Mask array to prepare. If None, uses the most recent prediction results.
            format_type: Export format ("rle", "binary", "coco_rle").
            
        Returns:
            List of mask dictionaries ready for export, or None if no masks available.
        """
        if masks is None:
            masks = self.masks
            
        if masks is None:
            print("No masks available for export.")
            return None
            
        try:
            from sam2.utils.amg import mask_to_rle_pytorch, rle_to_mask
            export_masks = []
            
            for i, mask in enumerate(masks):
                mask_dict = {"mask_id": i}
                
                if format_type == "binary":
                    mask_dict["segmentation"] = mask.astype(np.uint8)
                elif format_type == "rle":
                    # Convert to RLE format
                    mask_tensor = torch.from_numpy(mask.astype(bool)).unsqueeze(0)
                    rle = mask_to_rle_pytorch(mask_tensor)[0]
                    mask_dict["segmentation"] = {
                        "size": rle["size"],
                        "counts": rle["counts"]
                    }
                elif format_type == "coco_rle":
                    try:
                        from pycocotools import mask as mask_utils
                        # Convert to COCO RLE format
                        mask_fortran = np.asfortranarray(mask.astype(np.uint8))
                        rle = mask_utils.encode(mask_fortran)
                        mask_dict["segmentation"] = {
                            "size": rle["size"],
                            "counts": rle["counts"].decode("utf-8") if isinstance(rle["counts"], bytes) else rle["counts"]
                        }
                    except ImportError:
                        print("pycocotools not available for COCO RLE format. Using regular RLE.")
                        mask_tensor = torch.from_numpy(mask.astype(bool)).unsqueeze(0)
                        rle = mask_to_rle_pytorch(mask_tensor)[0]
                        mask_dict["segmentation"] = {
                            "size": rle["size"],
                            "counts": rle["counts"]
                        }
                
                # Add score if available
                if self.scores is not None and i < len(self.scores):
                    mask_dict["score"] = float(self.scores[i])
                    
                export_masks.append(mask_dict)
                
            return export_masks
        except Exception as e:
            print(f"Error preparing masks for export: {e}")
            return None

    def reset_inference_state(self) -> None:
        """
        Reset the inference state, clearing current results but keeping the model and image loaded.
        """
        self.masks = None
        self.scores = None
        self.logits = None
        print("Inference state reset.")

    def cleanup(self) -> None:
        """
        Clean up all resources and clear memory.
        """
        self.model = None
        self.predictor = None
        self.automatic_mask_generator = None
        self.image_np = None
        self.image_path = None
        self.image_hash = None
        self.masks = None
        self.scores = None
        self.logits = None
        self.active_inference_type = None
        
        # Clear device cache
        if self.device.type == "cuda":
            torch.cuda.empty_cache()
        elif self.device.type == "mps":
            # MPS doesn't have empty_cache, but we can clear some memory
            if hasattr(torch.mps, 'empty_cache'):
                torch.mps.empty_cache()
                
        print("SAMInference resources cleaned up.")

    def __del__(self):
        """Destructor to ensure cleanup when object is deleted."""
        try:
            self.cleanup()
        except:
            pass  # Ignore errors during cleanup in destructor
