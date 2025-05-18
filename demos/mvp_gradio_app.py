# demos/mvp_gradio_app.py

# if run from demos dir, add parent dir to path in order to use relative imports from project root
if __name__ == "__main__":
    import sys
    sys.path[0] = os.path.join(os.path.dirname(__file__), '..')

import os
import numpy as np
import torch
import matplotlib.pyplot as plt
from PIL import Image
import gradio as gr
import cv2

from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

from utils.get_model import get_model, get_config

# ------ Select the device for computation
if torch.cuda.is_available():
    device = torch.device("cuda")
elif torch.backends.mps.is_available():
    device = torch.device("mps")
else:
    device = torch.device("cpu")
print(f"using device: {device}")

if device.type == "cuda":
    # use bfloat16 for the entire notebook
    torch.autocast("cuda", dtype=torch.bfloat16).__enter__()
    # turn on tfloat32 for Ampere GPUs
    if torch.cuda.get_device_properties(0).major >= 8:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
elif device.type == "mps":
    print(
        "\nSupport for MPS devices is preliminary. SAM 2 is trained with CUDA and might "
        "give numerically different outputs and sometimes degraded performance on MPS. "
    )

# Global variables
predictor = None
current_image = None
input_points = []
input_labels = []
box_coords = None

def initialize_model(model_size):
    """Initialize the SAM2 model based on selected size"""
    global predictor
    
    sam2_checkpoint = get_model(model_size)
    model_cfg = get_config(model_size)
    
    sam2_model = build_sam2(model_cfg, sam2_checkpoint, device=device.type)
    predictor = SAM2ImagePredictor(sam2_model)
    
    return f"Model {model_size} loaded on {device}"

def process_image(image):
    """Process the uploaded image"""
    global current_image, input_points, input_labels, box_coords, predictor
    
    # Reset points and box
    input_points = []
    input_labels = []
    box_coords = None
    
    if predictor is None:
        return image, "Please select a model first"
    
    current_image = np.array(image)
    predictor.set_image(current_image)
    
    return image, "Image loaded. Click to add points or draw a box."

def draw_points_on_image(image, points, labels):
    """Draw points on the image with color according to label"""
    result = image.copy()
    
    for point, label in zip(points, labels):
        # Green for positive points (foreground), Red for negative points (background)
        color = (0, 255, 0) if label == 1 else (255, 0, 0)
        
        # Draw a circle for each point
        cv2.circle(result, (int(point[0]), int(point[1])), 10, color, -1)
        # Add border to make the point more visible
        cv2.circle(result, (int(point[0]), int(point[1])), 10, (255, 255, 255), 2)
    
    return result

def apply_mask_to_image(image, mask, points=None, labels=None, alpha=0.5):
    """Apply a colored mask on top of the image and draw points"""
    color = np.array([30/255, 144/255, 255/255])  # Blue color
    h, w = mask.shape[-2:]
    colored_mask = np.zeros((h, w, 3), dtype=np.float32)
    for i in range(3):
        colored_mask[:, :, i] = color[i]
    
    mask_image = np.zeros_like(image, dtype=np.float32)
    mask = mask.astype(bool)
    mask_image[mask] = colored_mask[mask] * alpha + image[mask] * (1 - alpha)
    mask_image[~mask] = image[~mask]
    
    # Add contours
    binary_mask = mask.astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    result = mask_image.copy().astype(np.uint8)
    cv2.drawContours(result, contours, -1, (255, 255, 255), 2)
    
    # Draw points if provided
    if points is not None and labels is not None and len(points) > 0:
        result = draw_points_on_image(result, points, labels)
    
    return result

def update_canvas(canvas_data, tool, evt: gr.SelectData):
    """Update canvas with points or box and run prediction"""
    global input_points, input_labels, box_coords, current_image, predictor
    
    if current_image is None or predictor is None:
        return canvas_data
    
    if tool == "positive":
        # Add positive point
        input_points.append([evt.index[0], evt.index[1]])
        input_labels.append(1)
        box_coords = None
    elif tool == "negative":
        # Add negative point
        input_points.append([evt.index[0], evt.index[1]])
        input_labels.append(0)
        box_coords = None
    elif tool == "box" and len(evt.index) == 4:
        # Set box coordinates
        box_coords = [
            evt.index[0], evt.index[1],
            evt.index[0] + evt.index[2], evt.index[1] + evt.index[3]
        ]
        # Reset points when using box
        input_points = []
        input_labels = []
    elif tool == "clear":
        # Clear all inputs
        input_points = []
        input_labels = []
        box_coords = None
        return current_image
    
    # Run prediction if we have points or a box
    if len(input_points) > 0 or box_coords is not None:
        np_input_points = np.array(input_points) if input_points else None
        np_input_labels = np.array(input_labels) if input_labels else None
        
        try:
            # Run prediction
            masks, scores, _ = predictor.predict(
                point_coords=np_input_points,
                point_labels=np_input_labels,
                box=box_coords,
                multimask_output=True,
            )
            
            # Get the highest scoring mask
            if len(scores) > 0:
                best_mask_idx = np.argmax(scores)
                best_mask = masks[best_mask_idx]
                
                # Apply the mask to the image and draw points
                result_image = apply_mask_to_image(
                    current_image, 
                    best_mask, 
                    points=input_points, 
                    labels=input_labels
                )
                return result_image
        except Exception as e:
            print(f"Prediction error: {e}")
            
            # If prediction fails, at least show the points
            result_image = draw_points_on_image(
                current_image.copy(), 
                input_points, 
                input_labels
            )
            return result_image
    
    # If no prediction was run but we have points, show them
    if len(input_points) > 0:
        result_image = draw_points_on_image(
            current_image.copy(), 
            input_points, 
            input_labels
        )
        return result_image
    
    return current_image

def create_ui():
    with gr.Blocks() as demo:
        gr.Markdown("# SAM2 Interactive Segmentation")
        
        with gr.Row():
            with gr.Column(scale=1):
                model_dropdown = gr.Dropdown(
                    choices=["tiny", "small", "base", "large"], 
                    label="Select Model Size",
                    value="tiny"
                )
                load_button = gr.Button("Load Model")
                status = gr.Textbox(label="Status", value="Select a model and click 'Load Model'")
                
                tool_radio = gr.Radio(
                    choices=["positive", "negative", "box", "clear"],
                    label="Tool",
                    value="positive"
                )
                
                gr.Markdown("""
                ### Instructions:
                1. Select a model size and click 'Load Model'
                2. Upload an image using the canvas
                3. Use tools:
                   - **positive**: Click to add foreground points (green)
                   - **negative**: Click to add background points (red)
                   - **box**: Draw a box around the object
                   - **clear**: Reset all inputs
                """)
                
            with gr.Column(scale=2):
                # Single interactive canvas for both input and interaction
                canvas = gr.Image(
                    label="Interactive Canvas", 
                    interactive=True, 
                    type="numpy",
                    # tool="sketch"
                )
                
        # Event handlers
        load_button.click(
            fn=initialize_model,
            inputs=[model_dropdown],
            outputs=[status]
        )
        
        # Handle image upload to the canvas
        canvas.upload(
            fn=process_image,
            inputs=[canvas],
            outputs=[canvas, status]
        )
        
        canvas.select(
            fn=update_canvas,
            inputs=[canvas, tool_radio],
            outputs=[canvas]
        )
        
    return demo

if __name__ == "__main__":
    demo = create_ui()
    demo.launch()
