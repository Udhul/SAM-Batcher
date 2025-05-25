#!/usr/bin/env python3
# server.py

from flask import Flask, request, jsonify, render_template, send_from_directory
import numpy as np
import os
from PIL import Image
import io
import base64
import argparse # For command-line arguments

from Modules.sam_backend2 import SAMInference 
from Modules.mask_visualizer import mask_to_base64_png, get_random_color, composite_masks_on_image_to_base64, generate_mask_overlay_colors


app = Flask(__name__, template_folder='templates', static_folder='static')

sam_inference_instance: SAMInference = SAMInference()

UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# --- Conditional UI Routes ---
# These will only be active if ui_enabled is True
ui_enabled_flag = True 

@app.route('/')
def index():
    if not ui_enabled_flag:
        return jsonify({"message": "API server is running. UI is disabled."}), 404
    return render_template('index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    if not ui_enabled_flag:
        return jsonify({"message": "Static files not served in API-only mode."}), 404
    return send_from_directory(app.static_folder, filename)

# --- API Endpoints ---
@app.route('/api/load_model', methods=['POST'])
def load_model_endpoint():
    data = request.json
    model_size_key = data.get('model_size_key')
    model_path = data.get('model_path')
    config_path = data.get('config_path')
    apply_postprocessing = data.get('apply_postprocessing', True) # Get from client

    # Handle custom model path
    if model_path and config_path:
        success = sam_inference_instance.load_model(
            model_path_override=model_path,
            config_path_override=config_path,
            apply_postprocessing=apply_postprocessing
        )
        if success:
            model_name = os.path.basename(model_path)
            return jsonify({
                "success": True, 
                "message": f"Custom model '{model_name}' loaded. Post-processing: {apply_postprocessing}"
            })
        else:
            return jsonify({
                "success": False, 
                "error": f"Failed to load custom model from path '{model_path}'."
            }), 500
    
    # Handle predefined model
    if not model_size_key:
        return jsonify({"success": False, "error": "Neither model_size_key nor model_path provided."}), 400
    
    available_keys = sam_inference_instance.get_available_model_keys()
    
    # Handle 'base' alias: if user selects 'base' and 'base_plus' is what utils/get_model uses,
    # sam_backend2.load_model should already handle this mapping via get_model.
    # So, we pass the user's selected key directly.
    model_key_to_check = model_size_key
    if model_size_key == 'base' and 'base_plus' in available_keys and 'base' not in available_keys: # if 'base' is purely an alias not in MODEL_FILES
        model_key_to_check = 'base_plus'


    if model_key_to_check not in available_keys and model_size_key not in available_keys : # Check both original and potential alias
         # Filter 'base' from available_keys for error message if 'base_plus' is the actual key
        display_available_keys = [k for k in available_keys if not (k == 'base' and 'base_plus' in available_keys)]
        return jsonify({"success": False, "error": f"Invalid model size key '{model_size_key}'. Available: {display_available_keys}"}), 400

    success = sam_inference_instance.load_model(
        model_size_key=model_size_key, # Pass the user's selection; backend handles alias if needed
        force_download=False, # Force download button removed from UI
        apply_postprocessing=apply_postprocessing
    )
    if success:
        # sam_inference_instance.current_model_size_key will reflect the actual key used (e.g. 'base_plus')
        loaded_key_display = sam_inference_instance.current_model_size_key or model_size_key
        return jsonify({
            "success": True, 
            "message": f"Model '{loaded_key_display}' loaded. Post-processing: {apply_postprocessing}"
        })
    else:
        return jsonify({"success": False, "error": f"Failed to load model for size '{model_size_key}'."}), 500

@app.route('/api/get_available_models', methods=['GET'])
def get_available_models():
    raw_keys = sam_inference_instance.get_available_model_keys()
    # Filter out 'base' if 'base_plus' also exists, as 'base' is an alias handled by get_model
    models_to_show = [key for key in raw_keys if not (key == 'base' and 'base_plus' in raw_keys)]
    
    return jsonify({
        "success": True, 
        "models": models_to_show, 
        "current_model": sam_inference_instance.current_model_size_key 
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
            pil_image = Image.open(file.stream).convert("RGB")
            
            success = sam_inference_instance.set_image(pil_image)
            if success:
                w, h = sam_inference_instance.get_image_dimensions()
                
                img_byte_arr = io.BytesIO()
                # Save as JPEG for potentially smaller size, or PNG for perfect fidelity
                pil_image.save(img_byte_arr, format='JPEG', quality=90) 
                img_base64 = base64.b64encode(img_byte_arr.getvalue()).decode('utf-8')
                
                return jsonify({
                    "success": True, 
                    "message": "Image set successfully.",
                    "width": w, 
                    "height": h,
                    "image_data": f"data:image/jpeg;base64,{img_base64}", # Match format
                    "filename": file.filename # Send filename back
                })
            else:
                return jsonify({"success": False, "error": "Failed to set image in SAM backend."}), 500
        except Exception as e:
            app.logger.error(f"Error processing image: {str(e)}", exc_info=True)
            return jsonify({"success": False, "error": f"Error processing image: {str(e)}"}), 500

@app.route('/api/predict', methods=['POST'])
def predict_endpoint():
    if not sam_inference_instance.model:
        return jsonify({"success": False, "error": "Model not loaded."}), 400
    if sam_inference_instance.image_np is None: 
        return jsonify({"success": False, "error": "Image not set."}), 400

    try:
        data = request.json
        points = data.get('points')
        labels = data.get('labels')
        box = data.get('box') 
        mask_input_arr = data.get('mask_input')
        # Client will decide which masks to show, so always request multiple if available
        multimask_output = True 

        np_points = np.array(points) if points and len(points) > 0 else None
        np_labels = np.array(labels) if labels and len(labels) > 0 else None
        np_box = np.array(box) if box else None # SAM expects a single box [X1,Y1,X2,Y2] or None
        
        np_mask_input = None
        if mask_input_arr and isinstance(mask_input_arr, list) and len(mask_input_arr) > 0:
            try:
                # Ensure mask_input_arr is a list of lists (2D)
                if all(isinstance(row, list) for row in mask_input_arr):
                    h_mask, w_mask = len(mask_input_arr), len(mask_input_arr[0]) if mask_input_arr[0] else 0
                    if h_mask == 256 and w_mask == 256: # SAM expects 256x256 low-res mask
                         np_mask_input = np.array(mask_input_arr, dtype=np.float32).reshape(1, h_mask, w_mask)
                    else:
                        app.logger.warning(f"Received mask_input with dimensions {h_mask}x{w_mask}, expected 256x256. Ignoring.")
                else:
                    app.logger.warning("mask_input_arr was not a list of lists. Ignoring.")
            except Exception as e:
                app.logger.warning(f"Could not process mask_input: {str(e)}")
        
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
            # generate_mask_overlay_colors expects positive num_masks
            num_masks_found = len(masks_np) if masks_np is not None else 0
            colors = generate_mask_overlay_colors(num_masks_found) if num_masks_found > 0 else []

            if masks_np is not None:
                for i, m in enumerate(masks_np):
                    color_to_use = colors[i % len(colors)] if colors else get_random_color()
                    mask_images_base64.append(mask_to_base64_png(m, color=color_to_use))
            
            return jsonify({
                "success": True, 
                "masks": mask_images_base64, # List of base64 PNGs
                "scores": scores_np.tolist() if scores_np is not None else [] # List of scores
            })
        else:
            # This case means sam_inference_instance.predict itself returned None
            return jsonify({"success": False, "error": "Prediction returned no results or failed in backend."}), 500
    except Exception as e:
        app.logger.error(f"Error in /api/predict: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": f"Server error during prediction: {str(e)}"}), 500


@app.route('/api/generate_auto_masks', methods=['POST'])
def generate_auto_masks_endpoint():
    # This endpoint will be long-running.
    # True progress/cancellation is hard with current SAM.
    # Client will handle UI lock and a client-side "cancel" (aborting fetch).
    if not sam_inference_instance.model:
        return jsonify({"success": False, "error": "Model not loaded."}), 400
    if sam_inference_instance.image_np is None: 
        return jsonify({"success": False, "error": "Image not set."}), 400

    try:
        params = request.json if request.is_json else {}
        
        auto_masks_anns = sam_inference_instance.generate_auto_masks(**params) # This is blocking

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
            return jsonify({"success": False, "error": "Automatic mask generation failed or returned no masks."}), 500
    except Exception as e:
        app.logger.error(f"Error in /api/generate_auto_masks: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": f"Server error during automask generation: {str(e)}"}), 500


def run_server(serve_ui=True):
    global ui_enabled_flag
    ui_enabled_flag = serve_ui
    
    if serve_ui:
        print("Starting server with API and Web UI.")
    else:
        print("Starting server with API only. Web UI routes will be disabled.")
    
    # Werkzeug is not recommended for production, use Gunicorn or similar.
    # For development, debug=True is helpful.
    app.run(host='0.0.0.0', port=5000, debug=True)

if __name__ == '__main__':
    parser_main = argparse.ArgumentParser(description="Run SAM2 Backend Server")
    parser_main.add_argument('--api-only', action='store_true', 
                             help="Run in API only mode (Web UI routes will return 404)")
    cli_args = parser_main.parse_args()

    run_server(serve_ui=not cli_args.api_only)