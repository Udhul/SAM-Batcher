#!/usr/bin/env python3
import sys
import os
import json
import base64
from io import BytesIO
import time # For automask duration

try:
    import numpy as np
    from PIL import Image
except ImportError:
    print("Error: NumPy and Pillow are required. Please install them (pip install numpy Pillow)")
    sys.exit(1)


from PySide6.QtCore import (
    Qt, QPoint, QRect, QSize, Slot, QByteArray, QBuffer, QIODevice, QThread, Signal, QObject, QFile, QTimer
)
from PySide6.QtGui import (
    QPixmap, QImage, QPainter, QPen, QColor, QPolygon, QGuiApplication, QCursor, QAction, QTransform, QMouseEvent
)
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
    QLabel, QFileDialog, QComboBox, QSlider, QLineEdit, QCheckBox, QMessageBox,
    QProgressDialog, QGroupBox, QFormLayout, QDialog, QDialogButtonBox, QProgressBar,
    QRadioButton
)
from PySide6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply, QHttpMultiPart, QHttpPart

# Attempt to import SAMInference for local mode
SAM_INFERENCE_AVAILABLE = False
try:
    from Modules.sam_backend2 import SAMInference
    SAM_INFERENCE_AVAILABLE = True
except ImportError as e:
    print(f"Warning: SAMInference module not found, local mode will be disabled. Error: {e}")


# --- Configuration ---
DEFAULT_API_HOST = "127.0.0.1"
DEFAULT_API_PORT = 5000

# --- Color Generation for Local Mode ---
def generate_pyside_colors(num_colors: int) -> list[QColor]:
    # Simple distinct colors, can be expanded (e.g., using HSL cycles)
    base_colors = [
        QColor(255, 87, 87), QColor(87, 255, 87), QColor(87, 87, 255),
        QColor(255, 255, 87), QColor(87, 255, 255), QColor(255, 87, 255),
        QColor(255, 165, 0), QColor(128, 0, 128), QColor(0, 128, 0) 
    ]
    if num_colors <= len(base_colors):
        return base_colors[:num_colors]
    
    # If more colors are needed, cycle with slight variations
    generated_colors = list(base_colors)
    for i in range(len(base_colors), num_colors):
        original_color = base_colors[i % len(base_colors)]
        # Slightly vary brightness or saturation for more colors
        h, s, l, a = original_color.getHsl()
        l_new = (l + 30 + (i // len(base_colors)) * 15) % 256 # Vary lightness
        s_new = max(100, (s + (i // len(base_colors)) * 10) % 256) # Ensure some saturation
        new_color = QColor.fromHsl(h, s_new, l_new, a)
        generated_colors.append(new_color)
    return generated_colors

# --- Worker for Network/Local Processing ---
class ProcessingWorker(QObject):
    finished = Signal(object, str) # result, request_type
    error = Signal(str, str)       # error_message, request_type
    uploadProgress = Signal(int)   # For uploads specifically

    def __init__(self, local_sam_instance=None, parent=None):
        super().__init__(parent)
        self.local_sam_instance = local_sam_instance # For local mode
        self.is_local_mode = local_sam_instance is not None

        if not self.is_local_mode:
            self.manager = QNetworkAccessManager()
            self.manager.finished.connect(self.handle_network_finished)
        
        self._current_request_type = ""

    def handle_network_finished(self, reply: QNetworkReply):
        request_type = self._current_request_type # Use stored type for this reply
        if reply.error() != QNetworkReply.NetworkError.NoError:
            try:
                # Try to parse error from server if it's JSON
                error_data_bytes = reply.readAll()
                error_json = json.loads(bytes(error_data_bytes).decode('utf-8', errors='ignore'))
                server_error_msg = error_json.get("error", reply.errorString())
                self.error.emit(f"Network Error: {server_error_msg}", request_type)
            except json.JSONDecodeError:
                 self.error.emit(f"Network Error: {reply.errorString()} (Non-JSON server response: {bytes(error_data_bytes).decode('utf-8', errors='ignore')[:200]})", request_type)

        else:
            self.finished.emit(reply, request_type)
        reply.deleteLater()

    def _execute_local(self, func_name, args, kwargs, request_type):
        self._current_request_type = request_type # Store for local execution too
        try:
            if not self.local_sam_instance:
                self.error.emit("Local SAM instance not available.", request_type)
                return
            
            method_to_call = getattr(self.local_sam_instance, func_name)
            result = method_to_call(*args, **kwargs)
            self.finished.emit(result, request_type)
        except Exception as e:
            self.error.emit(f"Local processing error in {func_name}: {str(e)}", request_type)

    # --- Network Methods ---
    def get_remote(self, url_str, request_type):
        self._current_request_type = request_type
        request = QNetworkRequest(url_str)
        self.manager.get(request)

    def post_remote(self, url_str, request_type, data_bytes=None, json_data=None, content_type="application/json"):
        self._current_request_type = request_type
        request = QNetworkRequest(url_str)
        request.setHeader(QNetworkRequest.ContentTypeHeader, content_type)
        payload = QByteArray()
        if json_data: payload.append(json.dumps(json_data).encode('utf-8'))
        elif data_bytes: payload.append(data_bytes)
        self.manager.post(request, payload)

    def post_multipart_remote(self, url_str, request_type, file_path, field_name="image"):
        self._current_request_type = request_type
        request = QNetworkRequest(url_str)
        multi_part = QHttpMultiPart(QHttpMultiPart.FormDataType)
        file_part = QHttpPart()
        file_part.setHeader(QNetworkRequest.ContentDispositionHeader,
                            f'form-data; name="{field_name}"; filename="{os.path.basename(file_path)}"')
        file_obj = QFile(file_path) # Renamed from 'file' to avoid conflict
        if not file_obj.open(QIODevice.ReadOnly):
            self.error.emit(f"Could not open file: {file_path}", request_type)
            return
        file_part.setBodyDevice(file_obj)
        file_obj.setParent(multi_part)
        multi_part.append(file_part)
        reply = self.manager.post(request, multi_part)
        multi_part.setParent(reply)
        if reply:
            reply.uploadProgress.connect(lambda sent, total: self.uploadProgress.emit(int(sent * 100 / total) if total > 0 else 0))

    # --- Local Wrappers ---
    def get_available_models_local(self, request_type):
        self._execute_local("get_available_model_keys", [], {}, request_type)

    def load_model_local(self, request_type, model_size_key, apply_postprocessing):
        self._execute_local("load_model", [], {
            "model_size_key": model_size_key, 
            "force_download": False, # No force download UI anymore
            "apply_postprocessing": apply_postprocessing
        }, request_type)

    def set_image_local(self, request_type, pil_image): # Expects PIL Image
        self._execute_local("set_image", [pil_image], {}, request_type)

    def predict_local(self, request_type, points, labels, box, mask_input):
        kwargs = {
            "point_coords": np.array(points) if points else None,
            "point_labels": np.array(labels) if labels else None,
            "box": np.array(box) if box else None,
            "mask_input": np.array(mask_input).reshape(1, 256, 256) if mask_input else None,
            "multimask_output": True, # Always get multiple for client-side filtering
            "return_logits_to_caller": False
        }
        self._execute_local("predict", [], kwargs, request_type)

    def generate_automask_local(self, request_type, amg_params):
        self._execute_local("generate_masks", [], amg_params, request_type)

# --- ImageDisplayWidget (mostly same, paintEvent for predictions adjusted) ---
class ImageDisplayWidget(QLabel):
    point_added = Signal(QPoint, int)
    box_drawn = Signal(QRect)
    lasso_drawn = Signal(QPolygon)
    clear_box_requested = Signal()
    clear_lasso_requested = Signal(QPoint)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_pixmap = None       # QPixmap of original full-size base image
        self.scaled_pixmap = None        # QPixmap of base image, scaled for display
        self.scale_factor = 1.0
        self.offset_x = 0
        self.offset_y = 0

        self.user_points = []  # list of (QPoint (original_coords), label)
        self.user_box_orig = None # QRect in original_coords
        self.user_lassos_orig = [] # list of QPolygon (original_coords)

        # This will store original-sized, colored QPixmaps of predictions
        self.prediction_pixmaps_orig_colored = [] 

        self.drawing_box = False
        self.drawing_lasso = False
        self.box_start_point_display = None # QPoint in display_coords
        self.current_lasso_points_display = [] # list of QPoint in display_coords

        self.setMinimumSize(400, 300)
        self.setAlignment(Qt.AlignCenter)
        self.setMouseTracking(True)

        self.user_input_opacity = 0.7
        self.prediction_opacity = 0.6
        self.current_click_start_pos_display = None # For distinguishing click vs drag
    
    def set_pixmap(self, pixmap: QPixmap): # Expects original, full-size pixmap
        self.current_pixmap = pixmap
        self.user_points = []
        self.user_box_orig = None
        self.user_lassos_orig = []
        self.prediction_pixmaps_orig_colored = []
        self.update_display()

    def set_prediction_pixmaps(self, pixmap_list: list[QPixmap]):
        # Expects a list of original-sized, already colored QPixmaps
        self.prediction_pixmaps_orig_colored = pixmap_list
        self.update()

    def set_user_input_opacity(self, opacity_float):
        self.user_input_opacity = opacity_float
        self.update()

    def set_prediction_opacity(self, opacity_float):
        self.prediction_opacity = opacity_float
        self.update()

    def _calculate_scale_and_offset(self):
        if not self.current_pixmap or self.current_pixmap.isNull():
            self.scale_factor = 1.0; self.offset_x = 0; self.offset_y = 0; return

        widget_size = self.size()
        pixmap_size = self.current_pixmap.size()

        if pixmap_size.width() == 0 or pixmap_size.height() == 0:
            self.scale_factor = 1.0; self.offset_x = 0; self.offset_y = 0; return

        self.scale_factor = min(widget_size.width() / pixmap_size.width(),
                                widget_size.height() / pixmap_size.height())
        if self.scale_factor > 1.0: self.scale_factor = 1.0 # Don't scale up beyond 100%

        scaled_width = int(pixmap_size.width() * self.scale_factor)
        scaled_height = int(pixmap_size.height() * self.scale_factor)
        self.offset_x = (widget_size.width() - scaled_width) / 2
        self.offset_y = (widget_size.height() - scaled_height) / 2

    def update_display(self):
        if not self.current_pixmap or self.current_pixmap.isNull():
            self.scaled_pixmap = None; self.clear(); return
        
        self._calculate_scale_and_offset()
        
        scaled_width = int(self.current_pixmap.width() * self.scale_factor)
        scaled_height = int(self.current_pixmap.height() * self.scale_factor)

        if scaled_width > 0 and scaled_height > 0:
            self.scaled_pixmap = self.current_pixmap.scaled(
                scaled_width, scaled_height, Qt.KeepAspectRatio, Qt.SmoothTransformation
            )
        else:
            self.scaled_pixmap = None
        self.update()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.update_display()

    def paintEvent(self, event):
        super().paintEvent(event)
        if not self.scaled_pixmap or self.scaled_pixmap.isNull(): return

        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        
        # 1. Draw base scaled image
        painter.drawPixmap(QPoint(int(self.offset_x), int(self.offset_y)), self.scaled_pixmap)

        # 2. Draw prediction masks (original-sized, colored, scaled on-the-fly)
        if self.prediction_pixmaps_orig_colored:
            painter.setOpacity(self.prediction_opacity)
            for original_colored_mask_pixmap in self.prediction_pixmaps_orig_colored:
                if not original_colored_mask_pixmap.isNull():
                    # Scale it to the current display size of the base image
                    scaled_mask_pixmap = original_colored_mask_pixmap.scaled(
                        self.scaled_pixmap.size(), Qt.IgnoreAspectRatio, Qt.SmoothTransformation # Ignore aspect, should match base
                    )
                    painter.drawPixmap(QPoint(int(self.offset_x), int(self.offset_y)), scaled_mask_pixmap)
        
        # 3. Draw user inputs
        painter.setOpacity(self.user_input_opacity)
        # User-drawn lassos (filled)
        for lasso_poly_orig in self.user_lassos_orig:
            display_poly = QPolygon([self.original_to_display_coords(pt) for pt in lasso_poly_orig])
            painter.setPen(QPen(QColor(255,223,0, 180), 1)) # Outline for lasso
            painter.setBrush(QColor(255, 223, 0, 100)) 
            painter.drawPolygon(display_poly)

        # Current lasso (if drawing)
        if self.drawing_lasso and len(self.current_lasso_points_display) > 1:
            painter.setPen(QPen(QColor("magenta"), 2, Qt.DashLine))
            painter.setBrush(Qt.NoBrush)
            painter.drawPolyline(QPolygon(self.current_lasso_points_display))

        # User box (finalized or temporary)
        if self.user_box_orig:
            db = self.original_to_display_coords_rect(self.user_box_orig)
            painter.setPen(QPen(QColor(0,100,255,200), 2))
            painter.setBrush(Qt.NoBrush)
            painter.drawRect(db)
        elif self.drawing_box and self.box_start_point_display:
            current_pos = self.mapFromGlobal(QCursor.pos())
            temp_box_display = QRect(self.box_start_point_display, current_pos).normalized()
            painter.setPen(QPen(QColor(0,200,255,150), 2, Qt.DashLine))
            painter.drawRect(temp_box_display)

        # User points
        for pt_orig, label in self.user_points:
            dp = self.original_to_display_coords(pt_orig)
            color = QColor(0,200,0,200) if label == 1 else QColor(200,0,0,200)
            painter.setPen(QPen(Qt.white, 1))
            painter.setBrush(color)
            painter.drawEllipse(dp, 4, 4)
            
        painter.end()

    def display_to_original_coords(self, display_point: QPoint) -> QPoint:
        if not self.current_pixmap or self.current_pixmap.isNull() or self.scale_factor == 0:
            return display_point 
        return QPoint(
            int((display_point.x() - self.offset_x) / self.scale_factor),
            int((display_point.y() - self.offset_y) / self.scale_factor)
        )

    def original_to_display_coords(self, original_point: QPoint) -> QPoint:
        if not self.current_pixmap or self.current_pixmap.isNull():
            return original_point
        return QPoint(
            int(original_point.x() * self.scale_factor + self.offset_x),
            int(original_point.y() * self.scale_factor + self.offset_y)
        )

    def original_to_display_coords_rect(self, original_rect: QRect) -> QRect:
        tl_disp = self.original_to_display_coords(original_rect.topLeft())
        br_disp = self.original_to_display_coords(original_rect.bottomRight())
        return QRect(tl_disp, br_disp)

    def _is_within_image_bounds(self, display_point: QPoint) -> bool:
        if not self.scaled_pixmap or self.scaled_pixmap.isNull(): return False
        image_rect = QRect(int(self.offset_x), int(self.offset_y),
                           self.scaled_pixmap.width(), self.scaled_pixmap.height())
        return image_rect.contains(display_point)

    def mousePressEvent(self, event: QMouseEvent):
        if not self.current_pixmap or not self._is_within_image_bounds(event.position().toPoint()):
            return

        self.current_click_start_pos_display = event.position().toPoint()
        
        is_shift = bool(event.modifiers() & Qt.ShiftModifier)
        is_ctrl = bool(event.modifiers() & Qt.ControlModifier)

        if is_ctrl:
            self.drawing_lasso = True
            self.current_lasso_points_display = [event.position().toPoint()]
        elif is_shift:
             # Check if clicking existing box to clear ONLY ON PRESS if it's a simple click
            if self.user_box_orig:
                display_box_rect = self.original_to_display_coords_rect(self.user_box_orig)
                if display_box_rect.contains(event.position().toPoint()):
                    # This is a potential clear, defer actual clear to mouseRelease if it's a click
                    pass # Don't immediately clear, wait for mouseRelease to check if it's a drag
            self.drawing_box = True # Always assume drawing starts on shift+press
            self.box_start_point_display = event.position().toPoint()
        self.update()

    def mouseMoveEvent(self, event: QMouseEvent):
        if not self.current_pixmap: return
        
        if self.drawing_box and self.box_start_point_display:
            self.update() 
        elif self.drawing_lasso:
            self.current_lasso_points_display.append(event.position().toPoint())
            self.update()

    def mouseReleaseEvent(self, event: QMouseEvent):
        if not self.current_pixmap: return
        
        is_click = (self.current_click_start_pos_display - event.position().toPoint()).manhattanLength() < 5
        end_pos_display = event.position().toPoint()
        end_pos_orig = self.display_to_original_coords(end_pos_display)

        is_shift_on_release = bool(event.modifiers() & Qt.ShiftModifier)
        is_ctrl_on_release = bool(event.modifiers() & Qt.ControlModifier)
        
        # Capture states before they are reset
        was_drawing_box = self.drawing_box
        was_drawing_lasso = self.drawing_lasso

        # Always reset drawing states on mouse up
        self.drawing_box = False
        self.drawing_lasso = False
        
        if was_drawing_box: # Finished drawing a box (Shift+Drag)
            if self.box_start_point_display: # Ensure drag happened
                display_rect = QRect(self.box_start_point_display, end_pos_display).normalized()
                if display_rect.width() > 5 and display_rect.height() > 5:
                    orig_rect_start = self.display_to_original_coords(display_rect.topLeft())
                    orig_rect_end = self.display_to_original_coords(display_rect.bottomRight())
                    self.user_box_orig = QRect(orig_rect_start, orig_rect_end).normalized()
                    self.box_drawn.emit(self.user_box_orig)
                else: # Drag was too small, effectively a click
                    if self.user_box_orig and self.original_to_display_coords_rect(self.user_box_orig).contains(self.box_start_point_display):
                        self.user_box_orig = None # Clear existing box on Shift+Click
                        self.clear_box_requested.emit()

            self.box_start_point_display = None
        elif was_drawing_lasso: # Finished drawing a lasso (Ctrl+Drag)
            if len(self.current_lasso_points_display) > 2:
                final_lasso_orig = QPolygon([self.display_to_original_coords(pt) for pt in self.current_lasso_points_display])
                self.lasso_drawn.emit(final_lasso_orig) # MainWindow will add it to its list
            self.current_lasso_points_display = []
        elif is_click: # Was a click, not a drag
            if is_ctrl_on_release: # Ctrl+Click
                 self.clear_lasso_requested.emit(end_pos_orig)
            elif is_shift_on_release : # Shift+Click (and not a drag that formed a new box)
                if self.user_box_orig and self.original_to_display_coords_rect(self.user_box_orig).contains(end_pos_display):
                    self.user_box_orig = None
                    self.clear_box_requested.emit()
            else: # Normal click (add/remove point)
                label = 1 if event.button() == Qt.LeftButton else 0
                removed = False
                click_radius_orig = 5 / self.scale_factor if self.scale_factor > 0 else 5
                for i, (pt_orig, _) in reversed(list(enumerate(self.user_points))):
                    # Using manhattanLength for simple proximity check
                    if (pt_orig - end_pos_orig).manhattanLength() < click_radius_orig * 2 : 
                        self.user_points.pop(i)
                        removed = True
                        break
                if not removed:
                    self.user_points.append((end_pos_orig, label))
                # Emit signal: -1 for label means point was removed for context
                self.point_added.emit(end_pos_orig, label if not removed else -1) 
        
        self.current_lasso_points_display = [] # Always clear temp lasso points
        self.update()


# --- Mode Selection Dialog ---
class ModeSelectionDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Select Operation Mode")
        layout = QVBoxLayout(self)
        self.local_mode_radio = QRadioButton("Local Mode (Run SAM directly)")
        self.remote_mode_radio = QRadioButton("Remote Mode (Connect to API Server)")
        
        if not SAM_INFERENCE_AVAILABLE:
            self.local_mode_radio.setEnabled(False)
            self.local_mode_radio.setText("Local Mode (SAMInference module not found)")
            self.remote_mode_radio.setChecked(True)
        else:
            self.local_mode_radio.setChecked(True)

        layout.addWidget(self.local_mode_radio)
        layout.addWidget(self.remote_mode_radio)
        
        buttons = QDialogButtonBox(QDialogButtonBox.Ok)
        buttons.accepted.connect(self.accept)
        layout.addWidget(buttons)
        self.selected_mode = "local" if self.local_mode_radio.isChecked() else "remote"

    def accept(self):
        self.selected_mode = "local" if self.local_mode_radio.isChecked() else "remote"
        super().accept()


class ApiConfigDialog(QDialog):
    def __init__(self, host, port, parent=None):
        super().__init__(parent)
        self.setWindowTitle("API Server Configuration")
        layout = QFormLayout(self)
        self.host_edit = QLineEdit(host)
        self.port_edit = QLineEdit(str(port))
        layout.addRow("Host:", self.host_edit)
        layout.addRow("Port:", self.port_edit)
        
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def get_values(self):
        return self.host_edit.text(), int(self.port_edit.text())


# --- MainWindow ---
class MainWindow(QMainWindow):
    # ... (init and other methods from previous version, then update API calls)
    def __init__(self):
        super().__init__()
        self.setWindowTitle("SAM2 Interactive Segmenter (PySide6 Client)")
        self.setGeometry(100, 100, 1300, 850) # Slightly larger

        self.operation_mode = None # "local" or "remote"
        self.local_sam_instance = None # If local mode
        
        self.api_host = DEFAULT_API_HOST
        self.api_port = DEFAULT_API_PORT
        self.api_base_url = f"http://{self.api_host}:{self.api_port}/api"

        self.processing_thread = QThread() # Single thread for both local and remote
        # Worker will be instantiated after mode selection

        self.image_display = ImageDisplayWidget()
        # ... (connect signals as before) ...
        self.image_display.point_added.connect(self.on_interaction_changed)
        self.image_display.box_drawn.connect(self.on_interaction_changed)
        self.image_display.lasso_drawn.connect(self.add_user_lasso)
        self.image_display.clear_box_requested.connect(self.on_interaction_changed) # Clears box, then predicts
        self.image_display.clear_lasso_requested.connect(self.remove_user_lasso_at_point)


        # --- Controls ---
        self.controls_widget = QWidget()
        controls_layout = QVBoxLayout(self.controls_widget)
        self.controls_widget.setFixedWidth(380) # Slightly wider

        # API Config / Mode Display
        self.mode_config_group = QGroupBox("Operation Mode") # Renamed
        mode_config_layout = QFormLayout()
        self.mode_status_label = QLabel("Mode: Not selected") # Will show Local or Remote URL
        mode_config_layout.addRow(self.mode_status_label)
        self.config_api_btn = QPushButton("Configure API Server (Remote Mode)")
        self.config_api_btn.clicked.connect(self.configure_api)
        mode_config_layout.addRow(self.config_api_btn)
        self.mode_config_group.setLayout(mode_config_layout)
        controls_layout.addWidget(self.mode_config_group)
        
        # Model Controls
        model_group = QGroupBox("Model")
        model_layout = QFormLayout()
        self.model_combo = QComboBox()
        model_layout.addRow("Select Model:", self.model_combo)
        self.postprocess_cb = QCheckBox("Apply Post-processing")
        self.postprocess_cb.setChecked(True)
        model_layout.addRow(self.postprocess_cb)
        load_model_btn = QPushButton("Load Model")
        load_model_btn.clicked.connect(self.load_model)
        model_layout.addRow(load_model_btn)
        self.model_status_label = QLabel("No model loaded.")
        model_layout.addRow(self.model_status_label)
        model_group.setLayout(model_layout)
        controls_layout.addWidget(model_group)

        # Image Controls (same as before)
        image_group = QGroupBox("Image")
        image_layout = QVBoxLayout()
        load_image_btn = QPushButton("Load Image")
        load_image_btn.clicked.connect(self.load_image_dialog) # Changed to dialog
        image_layout.addWidget(load_image_btn)
        self.image_upload_progress_bar = QProgressBar()
        self.image_upload_progress_bar.setVisible(False)
        image_layout.addWidget(self.image_upload_progress_bar)
        self.current_image_label = QLabel("No image loaded.")
        image_layout.addWidget(self.current_image_label)
        image_group.setLayout(image_layout)
        controls_layout.addWidget(image_group)


        # Interaction Controls (same as before)
        interaction_group = QGroupBox("Interaction & Display")
        interaction_layout = QVBoxLayout()
        clear_inputs_btn = QPushButton("Clear Inputs & Predictions")
        clear_inputs_btn.clicked.connect(self.clear_inputs_and_predictions)
        interaction_layout.addWidget(clear_inputs_btn)

        mask_display_layout = QHBoxLayout()
        mask_display_layout.addWidget(QLabel("Show Masks:"))
        self.mask_display_combo = QComboBox()
        self.mask_display_combo.addItems(["Best (Highest Score)", "All", "AutoMask Result"])
        self.mask_display_combo.setCurrentText("Best (Highest Score)")
        self.mask_display_combo.currentIndexChanged.connect(self.update_prediction_display)
        mask_display_layout.addWidget(self.mask_display_combo)
        interaction_layout.addLayout(mask_display_layout)
        interaction_group.setLayout(interaction_layout)
        controls_layout.addWidget(interaction_group)

        # AutoMask Controls (same as before)
        automask_group = QGroupBox("Automatic Mask Generation")
        # ... (AMG params UI can be added here later) ...
        automask_layout = QVBoxLayout()
        self.amg_points_per_side_edit = QLineEdit("32") # Example
        self.amg_pred_iou_thresh_edit = QLineEdit("0.88") # Example
        form_amg = QFormLayout()
        form_amg.addRow("Points/Side:", self.amg_points_per_side_edit)
        form_amg.addRow("Pred IoU Thresh:", self.amg_pred_iou_thresh_edit)
        automask_layout.addLayout(form_amg)

        self.run_automask_btn = QPushButton("Run AutoMask")
        self.run_automask_btn.clicked.connect(self.run_automask)
        automask_layout.addWidget(self.run_automask_btn)
        self.automask_status_label = QLabel("")
        automask_layout.addWidget(self.automask_status_label)
        automask_group.setLayout(automask_layout)
        controls_layout.addWidget(automask_group)


        # Opacity Controls (same as before)
        opacity_group = QGroupBox("Overlay Opacity")
        opacity_layout = QFormLayout()
        self.pred_opacity_slider = QSlider(Qt.Horizontal)
        self.pred_opacity_slider.setRange(0, 100); self.pred_opacity_slider.setValue(60)
        self.pred_opacity_slider.valueChanged.connect(lambda v: self.image_display.set_prediction_opacity(v / 100.0))
        opacity_layout.addRow("Predictions:", self.pred_opacity_slider)
        self.user_opacity_slider = QSlider(Qt.Horizontal)
        self.user_opacity_slider.setRange(0, 100); self.user_opacity_slider.setValue(70)
        self.user_opacity_slider.valueChanged.connect(lambda v: self.image_display.set_user_input_opacity(v / 100.0))
        opacity_layout.addRow("User Inputs:", self.user_opacity_slider)
        opacity_group.setLayout(opacity_layout)
        controls_layout.addWidget(opacity_group)

        save_view_btn = QPushButton("Save Current View") # Same as before
        save_view_btn.clicked.connect(self.save_current_view)
        controls_layout.addWidget(save_view_btn)
        
        controls_layout.addStretch()

        main_layout = QHBoxLayout()
        main_layout.addWidget(self.controls_widget)
        main_layout.addWidget(self.image_display, 1)
        central_widget = QWidget()
        central_widget.setLayout(main_layout)
        self.setCentralWidget(central_widget)

        self.status_bar = self.statusBar()
        self.status_bar.showMessage("Select operation mode.")

        self.current_image_pil = None # Store PIL image for local mode
        self.current_image_qpixmap = None # Store QPixmap for display
        self.last_automask_qpixmap = None # For recovery
        self.current_sam_predictions_data = [] # Store list of {pixmap_orig_colored, score}

        self.processing_worker = None # Will be set after mode selection
        self.show() # Show main window first
        self._select_mode_and_initialize()


    def _select_mode_and_initialize(self):
        dialog = ModeSelectionDialog(self)
        if dialog.exec():
            self.operation_mode = dialog.selected_mode
            if self.operation_mode == "local":
                if not SAM_INFERENCE_AVAILABLE:
                    QMessageBox.critical(self, "Error", "Local mode selected but SAMInference module is not available. Exiting.")
                    QApplication.instance().quit()
                    return
                self.local_sam_instance = SAMInference() # Init local SAM
                self.processing_worker = ProcessingWorker(local_sam_instance=self.local_sam_instance)
                self.mode_status_label.setText("Mode: Local (Direct SAM)")
                self.config_api_btn.setEnabled(False)
            else: # Remote mode
                self.processing_worker = ProcessingWorker() # No local_sam_instance
                self.mode_status_label.setText(f"Mode: Remote (API: {self.api_host}:{self.api_port})")
                self.config_api_btn.setEnabled(True)
            
            self.processing_worker.moveToThread(self.processing_thread)
            self.processing_thread.start()
            self.processing_worker.finished.connect(self.handle_processing_finished)
            self.processing_worker.error.connect(self.handle_processing_error)
            self.processing_worker.uploadProgress.connect(self.handle_upload_progress)
            
            self._fetch_available_models()
        else: # User cancelled mode selection
            QApplication.instance().quit()


    def configure_api(self):
        if self.operation_mode == "local": return # No API config for local mode
        dialog = ApiConfigDialog(self.api_host, self.api_port, self)
        if dialog.exec():
            self.api_host, self.api_port = dialog.get_values()
            self.api_base_url = f"http://{self.api_host}:{self.api_port}/api"
            self.mode_status_label.setText(f"Mode: Remote (API: {self.api_host}:{self.api_port})")
            self.status_bar.showMessage(f"API server set to {self.api_base_url}")
            self._fetch_available_models()

    def _fetch_available_models(self):
        self.status_bar.showMessage("Fetching available models...")
        if self.operation_mode == "local":
            self.processing_worker.get_available_models_local("get_models")
        else:
            self.processing_worker.get_remote(f"{self.api_base_url}/get_available_models", "get_models")

    def load_model(self):
        model_key = self.model_combo.currentText()
        if not model_key: QMessageBox.warning(self, "No Model", "Please select a model."); return
        
        apply_postproc = self.postprocess_cb.isChecked()
        self.status_bar.showMessage(f"Loading model: {model_key}...")
        if self.operation_mode == "local":
            self.processing_worker.load_model_local("load_model", model_key, apply_postproc)
        else:
            payload = {"model_size_key": model_key, "apply_postprocessing": apply_postproc}
            self.processing_worker.post_remote(f"{self.api_base_url}/load_model", "load_model", json_data=payload)

    def load_image_dialog(self): # Renamed to avoid conflict with internal load_image
        file_path, _ = QFileDialog.getOpenFileName(self, "Open Image", "", "Images (*.png *.jpg *.jpeg *.bmp)")
        if file_path:
            try:
                self.current_image_pil = Image.open(file_path).convert("RGB")
                self.current_image_qpixmap = QPixmap(file_path) # For immediate display if needed
                self.image_display.set_pixmap(self.current_image_qpixmap) # Display original
                self.current_image_label.setText(f"Loaded: {os.path.basename(file_path)}")
                self.clear_inputs_and_predictions(clear_image_specific_data=True) # Clear preds/inputs for new image

                if self.operation_mode == "local":
                    self.status_bar.showMessage(f"Setting image in local SAM: {os.path.basename(file_path)}...")
                    self.processing_worker.set_image_local("set_local_image", self.current_image_pil)
                else: # Remote mode
                    self.status_bar.showMessage(f"Uploading image: {os.path.basename(file_path)}...")
                    self.image_upload_progress_bar.setValue(0)
                    self.image_upload_progress_bar.setVisible(True)
                    self.processing_worker.post_multipart_remote(f"{self.api_base_url}/upload_image", "upload_image", file_path)
            except Exception as e:
                QMessageBox.critical(self, "Image Load Error", f"Could not load image: {str(e)}")
                self.current_image_pil = None
                self.current_image_qpixmap = None


    def handle_upload_progress(self, percent): # Only for remote mode
        self.image_upload_progress_bar.setValue(percent)
        if percent == 100 and self.operation_mode == "remote": # Check mode for safety
            self.status_bar.showMessage("Image upload complete. Server processing...")
            # Server will send back image data again, which will be handled in handle_processing_finished


    def clear_inputs_and_predictions(self, clear_image_specific_data=False):
        self.image_display.user_points = []
        self.image_display.user_box_orig = None
        self.image_display.user_lassos_orig = []
        self.image_display.set_prediction_pixmaps([]) # Clears display
        self.current_sam_predictions_data = []
        if clear_image_specific_data: # When new image is loaded
            self.last_automask_qpixmap = None
            # Ensure "AutoMask Result" is removed or disabled if it was specific to old image
            idx = self.mask_display_combo.findText("AutoMask Result")
            if idx != -1: self.mask_display_combo.removeItem(idx)
            if self.mask_display_combo.currentText() == "AutoMask Result":
                self.mask_display_combo.setCurrentIndex(0) # Default to "Best"
            self.automask_status_label.setText("")


        self.image_display.update()
        self.status_bar.showMessage("Inputs and predictions cleared.")


    @Slot()
    def on_interaction_changed(self):
        QTimer.singleShot(100, self.predict_with_current_inputs) # Debounce slightly

    @Slot(QPolygon)
    def add_user_lasso(self, lasso_polygon_orig: QPolygon):
        self.image_display.user_lassos_orig.append(lasso_polygon_orig)
        self.image_display.update()
        self.on_interaction_changed() # Trigger prediction
        
    @Slot(QPoint)
    def remove_user_lasso_at_point(self, click_point_orig: QPoint):
        removed = False
        for i, lasso_poly in reversed(list(enumerate(self.image_display.user_lassos_orig))):
            if lasso_poly.containsPoint(click_point_orig, Qt.OddEvenFill):
                self.image_display.user_lassos_orig.pop(i)
                removed = True
                break
        if removed:
            self.image_display.update()
            self.on_interaction_changed()

    def _prepare_mask_input_from_lassos_for_sam(self): # Returns list of lists for SAM
        if not self.image_display.user_lassos_orig or not self.current_image_pil: # Use PIL for original dims
            return None

        orig_w, orig_h = self.current_image_pil.size
        if orig_w == 0 or orig_h == 0: return None

        MASK_DIM = 256 # SAM expects 256x256 low-res mask
        
        # Create a PIL Image for mask drawing ( альфа-канал не нужен для бинарной маски )
        mask_pil_image = Image.new("L", (MASK_DIM, MASK_DIM), 0) # Black background
        from PIL import ImageDraw
        draw = ImageDraw.Draw(mask_pil_image)

        for lasso_poly_orig_qpoints in self.image_display.user_lassos_orig:
            # Convert QPoints to list of tuples (x,y) for PIL
            pil_polygon_points = []
            for q_point in lasso_poly_orig_qpoints:
                # Scale original QPoint coordinates to MASK_DIM space
                scaled_x = int((q_point.x() / orig_w) * MASK_DIM)
                scaled_y = int((q_point.y() / orig_h) * MASK_DIM)
                pil_polygon_points.append((scaled_x, scaled_y))
            
            if len(pil_polygon_points) > 2:
                draw.polygon(pil_polygon_points, outline=255, fill=255) # Draw white polygon
        
        # Convert PIL mask image to numpy array, then to list of lists
        mask_np = np.array(mask_pil_image)
        mask_array_list = ((mask_np > 128).astype(float)).tolist() # Threshold and convert
        return mask_array_list


    def predict_with_current_inputs(self):
        if ((self.operation_mode == "local" and not self.local_sam_instance) or \
            (self.operation_mode == "remote" and not self.api_base_url)) or \
            not self.current_image_pil or \
            not self.model_status_label.text().startswith("Current:"):
            return

        self.status_bar.showMessage("Running prediction...")

        points_payload = [[p.x(), p.y()] for p, _ in self.image_display.user_points]
        labels_payload = [label for _, label in self.image_display.user_points]
        
        box_payload = None
        if self.image_display.user_box_orig:
            b = self.image_display.user_box_orig
            box_payload = [b.left(), b.top(), b.right()+1, b.bottom()+1] # XYXY, inclusive for SAM? (check SAM docs)

        mask_input_payload = self._prepare_mask_input_from_lassos_for_sam()
        
        # Clear previous interactive predictions, but not automask
        if self.mask_display_combo.currentText() != "AutoMask Result":
            self.last_automask_qpixmap = None # Clear if user makes new interactive pred

        if self.operation_mode == "local":
            self.processing_worker.predict_local("predict", 
                                                 points_payload, labels_payload, 
                                                 box_payload, mask_input_payload)
        else: # Remote
            payload_json = {
                "points": points_payload if points_payload else None,
                "labels": labels_payload if labels_payload else None,
                "box": box_payload,
                "mask_input": mask_input_payload
            }
            self.processing_worker.post_remote(f"{self.api_base_url}/predict", "predict", json_data=payload_json)


    def run_automask(self):
        if ((self.operation_mode == "local" and not self.local_sam_instance) or \
            (self.operation_mode == "remote" and not self.api_base_url)) or \
            not self.current_image_pil or \
            not self.model_status_label.text().startswith("Current:"):
            QMessageBox.warning(self, "Error", "Please load an image and a model first.")
            return

        self.status_bar.showMessage("Running AutoMask... This may take time.")
        self.run_automask_btn.setEnabled(False)
        self.automask_status_label.setText("Running...")
        
        amg_params = {
            "points_per_side": int(self.amg_points_per_side_edit.text() or "32"),
            "pred_iou_thresh": float(self.amg_pred_iou_thresh_edit.text() or "0.88"),
            # Add other AMG params from UI if you create more input fields
        }
        if self.operation_mode == "local":
             # For local, generate_masks expects the image data.
             # If it's already set in self.local_sam_instance.image_np, pass None.
             # Otherwise, pass self.current_image_pil converted to np.array
            if self.local_sam_instance.image_np is None and self.current_image_pil:
                 amg_params["image_data"] = np.array(self.current_image_pil)
            else: # image already set in SAM instance
                 amg_params["image_data"] = None # Or let SAMInference use its current image

            self.processing_worker.generate_automask_local("automask", amg_params)
        else: # Remote
            self.processing_worker.post_remote(f"{self.api_base_url}/generate_auto_masks", "automask", json_data=amg_params)


    def update_prediction_display(self):
        pixmaps_to_display_orig_colored = []
        mode = self.mask_display_combo.currentText()

        if "AutoMask Result" in mode and self.last_automask_qpixmap:
             pixmaps_to_display_orig_colored = [self.last_automask_qpixmap]
        elif self.current_sam_predictions_data: # Interactive predictions
            if "Best" in mode and self.current_sam_predictions_data:
                pixmaps_to_display_orig_colored = [self.current_sam_predictions_data[0]['pixmap_orig_colored']]
            elif "All" in mode:
                pixmaps_to_display_orig_colored = [pred['pixmap_orig_colored'] for pred in self.current_sam_predictions_data]
        
        self.image_display.set_prediction_pixmaps(pixmaps_to_display_orig_colored)


    def _process_local_prediction_results(self, results_tuple, request_type_original_call):
        if results_tuple is None:
            self.handle_processing_error("Local prediction returned None.", request_type_original_call)
            return
        
        masks_np, scores_np, _ = results_tuple # logits ignored for now
        self.current_sam_predictions_data = []
        self.last_automask_qpixmap = None # Clear automask display

        if masks_np is not None and self.current_image_qpixmap:
            colors = generate_pyside_colors(len(masks_np))
            original_qsize = self.current_image_qpixmap.size() # Use QPixmap size

            for i, mask_arr in enumerate(masks_np):
                # Convert numpy mask to colored QPixmap
                # Ensure mask_arr is boolean or 0/1 uint8
                bool_mask_arr = mask_arr.astype(bool) if mask_arr.dtype != bool else mask_arr
                
                # Create QImage for this mask
                h, w = bool_mask_arr.shape
                q_img_mask = QImage(w, h, QImage.Format_ARGB32_Premultiplied)
                q_img_mask.fill(Qt.transparent)
                
                mask_color = QColor(colors[i % len(colors)])
                mask_color.setAlphaF(0.6) # Apply standard alpha

                for r in range(h):
                    for c in range(w):
                        if bool_mask_arr[r, c]:
                            q_img_mask.setPixelColor(c, r, mask_color)
                
                self.current_sam_predictions_data.append({
                    "pixmap_orig_colored": QPixmap.fromImage(q_img_mask),
                    "score": float(scores_np[i]) if scores_np is not None and i < len(scores_np) else 0.0
                })
        
        self.current_sam_predictions_data.sort(key=lambda x: x['score'], reverse=True)
        self.update_prediction_display()
        self.status_bar.showMessage("Local prediction complete.")


    def _process_local_automask_results(self, anns_list, request_type_original_call):
        if not anns_list:
            self.handle_processing_error("Local AutoMask returned no annotations.", request_type_original_call)
            self.automask_status_label.setText("AutoMask: No objects found.")
            return

        if not self.current_image_qpixmap:
            self.handle_processing_error("Current image not available for automask compositing.", request_type_original_call)
            return

        # Composite onto current_image_qpixmap
        base_pixmap = self.current_image_qpixmap
        composite_pixmap = QPixmap(base_pixmap.size())
        composite_pixmap.fill(Qt.transparent)
        
        painter = QPainter(composite_pixmap)
        painter.drawPixmap(0,0, base_pixmap) # Base image

        pyside_colors = generate_pyside_colors(len(anns_list))

        for i, ann in enumerate(anns_list):
            mask_np = ann['segmentation'] # boolean HxW
            h, w = mask_np.shape
            
            temp_mask_qimage = QImage(w, h, QImage.Format_ARGB32_Premultiplied)
            temp_mask_qimage.fill(Qt.transparent)
            
            ann_color = QColor(pyside_colors[i % len(pyside_colors)])
            ann_color.setAlphaF(0.5) # Default opacity for automask layers

            for r_idx in range(h):
                for c_idx in range(w):
                    if mask_np[r_idx, c_idx]:
                        temp_mask_qimage.setPixelColor(c_idx, r_idx, ann_color)
            painter.drawImage(0,0, temp_mask_qimage) # Alpha blending should occur

        painter.end()
        self.last_automask_qpixmap = composite_pixmap
        self.current_sam_predictions_data = [] # Clear interactive predictions

        if self.mask_display_combo.findText("AutoMask Result") == -1:
            self.mask_display_combo.addItem("AutoMask Result")
        self.mask_display_combo.setCurrentText("AutoMask Result")
        self.update_prediction_display() # Will show the automask
        self.automask_status_label.setText(f"AutoMask: {len(anns_list)} objects found.")
        self.status_bar.showMessage("Local AutoMask complete.")


    @Slot(object, str) # result_obj (can be QNetworkReply or local result), request_type
    def handle_processing_finished(self, result_obj, request_type):
        data_dict = None # For remote mode
        local_result = None # For local mode

        if self.operation_mode == "remote":
            reply = result_obj # It's a QNetworkReply
            try:
                response_data_bytes = reply.readAll()
                response_str = bytes(response_data_bytes).decode('utf-8')
                data_dict = json.loads(response_str)
                if not data_dict.get("success"):
                    self.handle_processing_error(data_dict.get("error", "Unknown API error (success=false)"), request_type)
                    return
            except json.JSONDecodeError:
                self.handle_processing_error(f"Invalid JSON response: {response_str[:200]}...", request_type)
                return
            except Exception as e:
                self.handle_processing_error(f"Error parsing remote response: {str(e)}", request_type)
                return
        else: # Local mode
            local_result = result_obj # Direct result from SAMInference method


        # --- Common processing logic using data_dict (for remote) or local_result ---
        if request_type == "get_models":
            models_list = local_result if self.operation_mode == "local" else data_dict.get("models", [])
            current_model_server = None
            if self.operation_mode == "remote": current_model_server = data_dict.get("current_model")
            elif self.local_sam_instance: current_model_server = self.local_sam_instance.current_model_size_key

            self.model_combo.clear()
            self.model_combo.addItems(models_list) # Server/local backend already filtered 'base'
            if current_model_server:
                self.model_status_label.setText(f"Current: {current_model_server}")
                idx = self.model_combo.findText(current_model_server)
                if idx != -1: self.model_combo.setCurrentIndex(idx)
            else:
                self.model_status_label.setText("No model loaded.")
            self.status_bar.showMessage("Models list updated.")
        
        elif request_type == "load_model":
            msg = ""
            if self.operation_mode == "remote": msg = data_dict.get("message", "Model status unknown")
            else: # Local mode, result is boolean success
                loaded_key = self.local_sam_instance.current_model_size_key or self.model_combo.currentText()
                postproc_text = "enabled" if self.postprocess_cb.isChecked() else "disabled"
                msg = f"Model '{loaded_key}' loaded locally. Post-processing {postproc_text}."
            
            self.model_status_label.setText(msg if local_result or (data_dict and data_dict.get("success")) else "Model load failed.")
            self.status_bar.showMessage(msg)
            if self.current_image_pil: self.predict_with_current_inputs()

        elif request_type == "upload_image": # Remote mode only for this type string
            self.image_upload_progress_bar.setVisible(False)
            img_b64 = data_dict.get("image_data", "").split(",")[1]
            img_bytes = base64.b64decode(img_b64)
            qimg = QImage.fromData(img_bytes)
            if qimg.isNull(): self.handle_processing_error("Failed to load image from server response.", request_type); return
            
            self.current_image_qpixmap = QPixmap.fromImage(qimg)
            self.image_display.set_pixmap(self.current_image_qpixmap) # This is the full-size original
            # self.current_image_pil must have been set in load_image_dialog before calling upload
            self.current_image_label.setText(f"Loaded: {data_dict.get('filename', 'Image')}")
            self.status_bar.showMessage("Image processed by server.")
            # clear_inputs_and_predictions was called in load_image_dialog
        
        elif request_type == "set_local_image": # Local mode only
            # result_obj is boolean success from SAMInference.set_image
            if local_result: # True means success
                self.status_bar.showMessage("Image set in local SAM instance.")
                # clear_inputs_and_predictions was called in load_image_dialog
            else:
                self.handle_processing_error("Failed to set image in local SAM instance.", request_type)


        elif request_type == "predict":
            if self.operation_mode == "local":
                self._process_local_prediction_results(local_result, request_type)
            else: # Remote
                self.current_sam_predictions_data = []
                self.last_automask_qpixmap = None

                mask_b64_list = data_dict.get("masks", [])
                scores = data_dict.get("scores", [])

                for i, mask_b64_full in enumerate(mask_b64_list):
                    mask_b64_data = mask_b64_full.split(",")[1]
                    mask_bytes = base64.b64decode(mask_b64_data)
                    qimg_mask = QImage.fromData(mask_bytes) # This is already colored by server
                    if not qimg_mask.isNull():
                         self.current_sam_predictions_data.append({
                             "pixmap_orig_colored": QPixmap.fromImage(qimg_mask), # Store as original size
                             "score": scores[i] if i < len(scores) else 0.0
                         })
                self.current_sam_predictions_data.sort(key=lambda x: x['score'], reverse=True)
                self.update_prediction_display()
                self.status_bar.showMessage("Remote prediction received.")


        elif request_type == "automask":
            self.run_automask_btn.setEnabled(True)
            if self.operation_mode == "local":
                self._process_local_automask_results(local_result, request_type)
            else: # Remote
                composite_b64_full = data_dict.get("auto_mask_composite", "")
                if composite_b64_full:
                    composite_b64_data = composite_b64_full.split(",")[1]
                    composite_bytes = base64.b64decode(composite_b64_data)
                    qimg_composite = QImage.fromData(composite_bytes)
                    if not qimg_composite.isNull():
                        self.last_automask_qpixmap = QPixmap.fromImage(qimg_composite)
                        self.current_sam_predictions_data = []
                        if self.mask_display_combo.findText("AutoMask Result") == -1:
                            self.mask_display_combo.addItem("AutoMask Result")
                        self.mask_display_combo.setCurrentText("AutoMask Result")
                        # update_prediction_display called by combo change
                    self.automask_status_label.setText(f"AutoMask: {data_dict.get('count', 0)} objects found.")
                else:
                    self.automask_status_label.setText("AutoMask: No result from server.")
            self.status_bar.showMessage("AutoMask completed.")

    @Slot(str, str)
    def handle_processing_error(self, error_message, request_type):
        self.status_bar.showMessage(f"Error ({request_type}): {error_message}", 7000)
        QMessageBox.critical(self, f"Error: {request_type}", str(error_message))
        if request_type == "upload_image" and self.operation_mode == "remote":
            self.image_upload_progress_bar.setVisible(False)
        if request_type == "automask":
            self.run_automask_btn.setEnabled(True)
            self.automask_status_label.setText(f"AutoMask failed: {error_message[:100]}")
        # Potentially reset other UI states based on request_type

    def save_current_view(self): # Same as previous full script
        if not self.image_display.current_pixmap:
            QMessageBox.information(self, "No Image", "No image to save.")
            return

        file_path, _ = QFileDialog.getSaveFileName(self, "Save Image As", "",
                                                   "PNG Image (*.png);;JPEG Image (*.jpg *.jpeg)")
        if file_path:
            if self.image_display.scaled_pixmap and not self.image_display.scaled_pixmap.isNull():
                final_pixmap_to_save = QPixmap(self.image_display.scaled_pixmap.size())
                final_pixmap_to_save.fill(Qt.transparent)
                
                temp_painter = QPainter(final_pixmap_to_save)
                temp_painter.drawPixmap(0, 0, self.image_display.scaled_pixmap) # Base
                
                # Draw active predictions
                temp_painter.setOpacity(self.image_display.prediction_opacity)
                # self.image_display.prediction_pixmaps_orig_colored contains original size pixmaps
                # We need to figure out which ones are active based on self.mask_display_combo
                active_pred_pixmaps = []
                mode = self.mask_display_combo.currentText()
                if "AutoMask Result" in mode and self.last_automask_qpixmap:
                    active_pred_pixmaps = [self.last_automask_qpixmap]
                elif self.current_sam_predictions_data:
                    if "Best" in mode and self.current_sam_predictions_data:
                        active_pred_pixmaps = [self.current_sam_predictions_data[0]['pixmap_orig_colored']]
                    elif "All" in mode:
                        active_pred_pixmaps = [pred['pixmap_orig_colored'] for pred in self.current_sam_predictions_data]

                for orig_pred_pix in active_pred_pixmaps:
                    if not orig_pred_pix.isNull():
                        scaled_pred_pix = orig_pred_pix.scaled(final_pixmap_to_save.size(), Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
                        temp_painter.drawPixmap(0,0, scaled_pred_pix)

                # Draw user inputs (simplified: grab from ImageDisplayWidget's already painted content)
                # This requires ImageDisplayWidget to have an offscreen buffer for user inputs
                # For now, let's skip re-drawing user inputs precisely for save, or accept it won't be perfect.
                # A simpler approach for user inputs: draw them directly if simple enough.
                temp_painter.setOpacity(self.image_display.user_input_opacity)
                # Re-draw user points, box, lassos scaled to final_pixmap_to_save.size()
                # This is a bit of repeated logic from ImageDisplayWidget.paintEvent
                # For simplicity, this part is omitted but would be needed for perfect save.
                # A quick grab of the user input canvas might work if its opacity is handled.

                temp_painter.end()

                if final_pixmap_to_save.save(file_path):
                    self.status_bar.showMessage(f"View saved to {file_path}", 3000)
                else:
                    QMessageBox.warning(self, "Save Error", f"Could not save image to {file_path}")
            else:
                 QMessageBox.warning(self, "Save Error", "No scaled image available to save.")


    def closeEvent(self, event):
        if self.processing_thread.isRunning():
            self.processing_thread.quit()
            self.processing_thread.wait(3000) # Wait up to 3s
        super().closeEvent(event)


if __name__ == "__main__":
    app = QApplication(sys.argv)
    main_window = MainWindow()
    # main_window.show() # Moved into _select_mode_and_initialize after dialog
    sys.exit(app.exec())
