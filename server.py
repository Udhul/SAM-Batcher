#!/usr/bin/env python3
# server.py

from flask import Flask, request, jsonify, render_template, send_from_directory
import numpy as np
import os
from PIL import Image
import io
import base64

from Modules.sam_backend2 import SAMInference
from Modules.mask_visualizer import mask_to_base64_png, get_random_color, composite_masks_on_image_to_base64, generate_mask_overlay_colors


app = Flask(__name__, template_folder='templates', static_folder='static')

# --- Global SAMInference instance ---
# Initialize with a default model or leave it None until user loads one
# It's generally better to let the user explicitly load a model via UI.
sam_inference_instance: SAMInference = SAMInference()


UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory(app.static_folder, filename)

@app.route('/api/load_model', methods=['POST'])
def load_model_endpoint():
    data = request.json
    model_size_key = data.get('model_size_key') # Changed from model_key
    force_download = data.get('force_download', False) # New parameter from client
    
    if not model_size_key:
        return jsonify({"success": False, "error": "model_size_key not provided."}), 400
    
    # The SAMInference.load_model will use get_model from utils, which handles MODEL_FILES internally
    if model_size_key not in sam_inference_instance.get_available_model_keys():
         return jsonify({"success": False, "error": f"Invalid model size key. Available: {sam_inference_instance.get_available_model_keys()}"}), 400

    success = sam_inference_instance.load_model(
        model_size_key=model_size_key,
        force_download=force_download # Pass this to the backend
    )
    if success:
        return jsonify({"success": True, "message": f"Model for size '{model_size_key}' loaded."})
    else:
        return jsonify({"success": False, "error": f"Failed to load model for size '{model_size_key}'."}), 500

@app.route('/api/get_available_models', methods=['GET'])
def get_available_models():
    # get_available_model_keys() now returns ['large', 'base_plus', 'small', 'tiny']
    return jsonify({
        "success": True, 
        "models": sam_inference_instance.get_available_model_keys(), 
        "current_model": sam_inference_instance.current_model_size_key # Use current_model_size_key
    })

@app.route('/api/upload_image', methods=['POST'])
def upload_image_endpoint():
    if 'image' not in request.files:
        return jsonify({"success": False, "error": "No image file provided."}), 400
    
    file = request.files['image']
    if file.filename == '':
        return jsonify({"success": False, "error": "No image file selected."}), 400

    if file:
        try:
            pil_image = Image.open(file.stream).convert("RGB") # Ensure RGB
            
            success = sam_inference_instance.set_image(pil_image)
            if success:
                w, h = sam_inference_instance.get_image_dimensions()
                
                img_byte_arr = io.BytesIO()
                pil_image.save(img_byte_arr, format='PNG')
                img_base64 = base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')
                
                return jsonify({
                    "success": True, 
                    "message": "Image set successfully.",
                    "width": w, 
                    "height": h,
                    "image_data": f"data:image/png;base64,{img_base64}"
                })
            else:
                return jsonify({"success": False, "error": "Failed to set image in SAM backend."}), 500
        except Exception as e:
            return jsonify({"success": False, "error": f"Error processing image: {str(e)}"}), 500

@app.route('/api/predict', methods=['POST'])
def predict_endpoint():
    if not sam_inference_instance.model:
        return jsonify({"success": False, "error": "Model not loaded."}), 400
    if sam_inference_instance.image_np is None: # Check for None
        return jsonify({"success": False, "error": "Image not set."}), 400

    data = request.json
    points = data.get('points')
    labels = data.get('labels')
    box = data.get('box') 
    mask_input_arr = data.get('mask_input')
    multimask_output = data.get('multimask_output', True)

    np_points = np.array(points) if points and len(points) > 0 else None
    np_labels = np.array(labels) if labels and len(labels) > 0 else None
    np_box = np.array(box) if box else None
    
    np_mask_input = None
    if mask_input_arr and isinstance(mask_input_arr, list) and len(mask_input_arr) > 0:
        try:
            # Assuming mask_input_arr is a 2D list
            h_mask, w_mask = len(mask_input_arr), len(mask_input_arr[0]) if isinstance(mask_input_arr[0], list) else 0
            if h_mask > 0 and w_mask > 0:
                 np_mask_input = np.array(mask_input_arr, dtype=np.float32).reshape(1, h_mask, w_mask)
            else: # If not a 2D list, or empty inner list
                np_mask_input = None # Or raise error
        except Exception as e:
            print(f"Warning: Could not process mask_input: {str(e)}")
            np_mask_input = None


    results = sam_inference_instance.predict(
        point_coords=np_points,
        point_labels=np_labels,
        box=np_box,
        mask_input=np_mask_input,
        multimask_output=multimask_output,
        return_logits_to_caller=False
    )

    if results:
        masks_np, scores_np, _ = results
        
        mask_images_base64 = []
        colors = generate_mask_overlay_colors(len(masks_np)) if masks_np is not None and len(masks_np) > 1 else [get_random_color()]

        if masks_np is not None:
            for i, m in enumerate(masks_np):
                color_to_use = colors[i % len(colors)]
                mask_images_base64.append(mask_to_base64_png(m, color=color_to_use))
        
        return jsonify({
            "success": True, 
            "masks": mask_images_base64, 
            "scores": scores_np.tolist() if scores_np is not None else []
        })
    else:
        return jsonify({"success": False, "error": "Prediction failed."}), 500

@app.route('/api/generate_auto_masks', methods=['POST'])
def generate_auto_masks_endpoint():
    if not sam_inference_instance.model:
        return jsonify({"success": False, "error": "Model not loaded."}), 400
    if sam_inference_instance.image_np is None: # Check for None
        return jsonify({"success": False, "error": "Image not set."}), 400

    params = request.json if request.is_json else {}
    
    auto_masks_anns = sam_inference_instance.generate_masks(**params)

    if auto_masks_anns is not None:
        composite_image_base64 = composite_masks_on_image_to_base64(
            sam_inference_instance.image_np, 
            auto_masks_anns
        )
        return jsonify({
            "success": True, 
            "auto_mask_composite": composite_image_base64,
            "count": len(auto_masks_anns)
        })
    else:
        return jsonify({"success": False, "error": "Automatic mask generation failed."}), 500

def run():
    app.run(host='0.0.0.0', port=5000, debug=True)

if __name__ == '__main__':
    run()