# SAM2 Image Masking Web Application: <br> Project Structure and Module Roles

**Version:** 1.0
**Date:** June 3, 2025

### Project Tree:
```
project_root/
  ├── main.py                     # Main application runner (initializes and starts the server)
  ├── config.py                   # Backend configurations (e.g., paths, default settings)
  ├── requirements.txt            # Python dependencies
  ├── README.md                   # Project documentation

  ├── app/                        # Main application package
  │   ├── __init__.py
  │   │
  │   ├── frontend/               # Client-side application (HTML, CSS, JavaScript)
  │   │   ├── templates/
  │   │   │   └── index.html      # Main HTML page
  │   │   └── static/
  │   │       ├── css/
  │   │       │   ├── style.css         # Global styles
  │   │       │   └── canvas.css        # Styles specific to the canvas interface
  │   │       ├── js/
  │   │       │   ├── main.js             # Main frontend script: initializes app, orchestrates modules
  │   │       │   ├── apiClient.js        # Handles all API calls to the backend
  │   │       │   ├── canvasController.js # Implements canvas_specification.md logic
  │   │       │   ├── uiManager.js        # Manages general UI elements (modals, notifications, nav)
  │   │       │   ├── projectHandler.js   # Handles project lifecycle (create, load, sources)
  │   │       │   ├── modelHandler.js     # Handles model selection, loading, status
  │   │       │   ├── imagePoolHandler.js # Handles image gallery, navigation, active image logic
  │   │       │   ├── stateManager.js     # Keeps track of current frontend state
  │   │       │   └── utils.js            # Frontend utility functions (DOM helpers, formatters)
  │   │       └── assets/                 # Static assets like icons, placeholder images
  │   │
  │   └── backend/                  # Server-side application (Python/FastAPI)
  │       ├── __init__.py
  │       ├── server.py               # FastAPI app: API routes, request/response handling
  │       ├── sam_backend.py         # SAM2 model interaction, inference logic
  │       ├── db_manager.py           # Database interaction: SQLite CRUD operations, schema
  │       ├── project_logic.py        # Business logic for projects, images, sources, mask persistence
  │       ├── export_logic.py         # Logic for data export functionalities
  │       └── azure_handler.py        # (If needed) Specific logic for Azure Blob Storage interactions
  │
  ├── utils/                      # Utilities for SAM2 model/config fetching (as used by sam_backend.py)
  │   ├── __init__.py
  │   ├── get_model.py
  │   └── get_model_config.py
  │
  └── <PROJECTS_DATA_DIR>/              # Dynamically created: stores project databases and uploaded images
      # Example:
      # ├── project_alpha_120725.sqlite
      # └── project_alpha_120725/
      #     └── uploads/
      #         └── ab/
      #             └── abcdef123456.jpg

  └── tests/                      # Unit and integration tests (For the future)
      ├── backend/
      │   ├── test_sam_backend.py
      │   ├── test_db_manager.py
      │   ├── test_project_logic.py
      │   └── test_api_endpoints.py
      └── frontend/ # (if using JS testing frameworks like Jest, Mocha)
          ├── test_canvasController.js
          └── test_apiClient.js
```

---

### Role of Each Key Module:

**Core Application (`project_root/`):**

*   **`main.py`**:
    *   Entry point for running the application.
    *   Parses command-line arguments (e.g., `--api-only`, `--port`).
    *   Imports and runs the FastAPI app from `app.backend.server`.
*   **`config.py`**:
    *   Stores backend configurations: `PROJECTS_DATA_DIR`, `CHECKPOINTS_DIR`, default SAM model settings, database connection details (if more complex than SQLite file path), Azure credentials strategy, etc.
    *   Loaded by `app.backend.server` and other backend modules as needed.

**Frontend (`project_root/app/frontend/static/js/`):**

*   **`main.js`**:
    *   Initializes the entire frontend application on page load.
    *   Sets up global event listeners (e.g., for main UI controls outside specific components).
    *   Coordinates the initialization and interaction of other frontend modules (`projectHandler`, `modelHandler`, `canvasController`, etc.).
*   **`apiClient.js`** (Handles Frontend I/O to Backend API):
    *   Provides a centralized way to make HTTP requests to the backend API.
    *   Abstracts `fetch` calls, JSON parsing, error handling for API communication.
    *   Functions like `apiClient.loadModel(params)`, `apiClient.uploadImage(fileData)`, `apiClient.getPredictions(prompts)`.
*   **`canvasController.js`**:
    *   **Primary Role:** Implements all functionalities detailed in `canvas_specification.md`.
    *   Manages the multi-layer HTML5 Canvas setup (Image Display, Prediction Mask, User Input, Final Mask Edit layers).
    *   Handles rendering of images, masks (with dynamic coloring, opacity), and user inputs (points, boxes, polygons).
    *   Manages user interactions on the canvas: drawing, selecting, toggling masks/regions.
    *   Handles coordinate system transformations (display to original image and vice-versa).
    *   Communicates with `apiClient.js` to send user prompts (points, boxes) and `maskInput` to the backend for interactive predictions.
    *   Receives mask data from `apiClient.js` and updates the Prediction Mask Layer.
    *   Manages canvas-specific state (zoom, pan, selected tools for canvas).
    *   Manages rotation of the image (on rotation, affect both the canvas representation, and the image stored in the backend, so predictions are done on a correctly oriented image)
*   **`uiManager.js`**:
    *   Manages general UI elements and interactions not tied to a specific handler (e.g., modals for messages, loading spinners, theme toggles, overall layout adjustments).
    *   Provides utility functions for common DOM manipulations or UI patterns.
*   **`projectHandler.js`**:
    *   Handles UI and logic for:
        *   Creating new projects, loading existing projects (listing, selecting, uploading DB).
        *   Managing image sources (UI for adding file uploads, server folders, URLs, Azure URIs; listing, removing sources).
    *   Uses `apiClient.js` for all project and image source-related backend communication.
    *   Updates the UI based on backend responses (e.g., populating project list, image source list).
*   **`modelHandler.js`**:
    *   Handles UI and logic for:
        *   Displaying available SAM models.
        *   Selecting a model or providing custom paths.
        *   Setting model load parameters (e.g., `apply_postprocessing`).
        *   Initiating model loading via `apiClient.js`.
        *   Displaying model loading status and information about the currently loaded model.
*   **`imagePoolHandler.js`**:
    *   Handles UI and logic for:
        *   Displaying the image pool/gallery (thumbnails, status).
        *   Navigating images (next/previous unprocessed, selecting a specific image).
        *   Setting the "active image" for annotation, which involves:
            *   Notifying the backend via `apiClient.js`.
            *   Receiving image data (base64, dimensions) and any existing masks for that image.
            *   Passing the image data to `canvasController.js` to display.
            *   Passing existing mask data to `canvasController.js` to render.
        *   Updating image status (e.g., "mark as complete").
*   **`stateManager.js`**:
    *   Manages global client-side state that needs to be shared across multiple modules (e.g., current `project_id`, `active_image_hash`, UI preferences).
    *   Helps prevent prop-drilling and makes state changes more predictable.
*   **`utils.js`**:
    *   Contains common frontend utility functions (e.g., debouncing, throttling, simple data formatters, unique ID generators for client-side elements).

**Backend (`project_root/app/backend/`):**

*   **`server.py`** (Handles Backend I/O from Frontend API calls):
    *   Defines all FastAPI endpoints as specified in `specification.md` (e.g., `/api/project`, `/api/model/load`, `/api/images/.../predict_interactive`).
    *   Parses incoming requests (JSON, form data, file uploads).
    *   Performs initial request validation.
    *   Delegates business logic to `project_logic.py`, `sam_backend.py` (for model operations), and `export_logic.py`.
    *   Uses `db_manager.py` (often via `project_logic.py`) for data persistence.
    *   Formats and returns JSON responses to the client.
    *   Serves the main `index.html` and static frontend files.
*   **`sam_backend.py`**:
    *   **Primary Role:** Encapsulates all direct interactions with the SAM2 library.
    *   Manages loading SAM2 models (using `utils/get_model.py`, `utils/get_model_config.py`).
    *   Handles setting the image into the SAM2 predictor (`predictor.set_image()`).
    *   Performs inference:
        *   `predict()`: For interactive prompts (points, boxes, mask inputs).
        *   `generate_auto_masks()`: For automatic mask generation.
    *   Has no knowledge of FastAPI, HTTP requests, or the database structure directly. It operates on Python data types (NumPy arrays, paths, etc.).
*   **`db_manager.py`** (Handles Persistence):
    *   **Primary Role:** Manages all interactions with the SQLite project databases.
    *   Defines functions for:
        *   Creating/initializing the schema for a new project database (tables: `Project_Info`, `Image_Sources`, `Images`, `Mask_Layers`, `Project_Settings` as per `specification.md`).
        *   CRUD (Create, Read, Update, Delete) operations for all tables.
        *   Example functions: `create_project_db(project_id)`, `add_image_source(project_id, source_details)`, `get_image_by_hash(project_id, image_hash)`, `save_mask_layer(project_id, image_hash, layer_data)`, `get_project_settings(project_id)`.
        *   Handles SQLite connections and transactions.
*   **`project_logic.py`**:
    *   Contains the core business logic of the application, acting as an orchestrator between `server.py` (API requests), `db_manager.py` (data), and `sam_backend.py` (AI model).
    *   Handles:
        *   Project creation (instructing `db_manager.py` to create DB, generating project ID).
        *   Loading projects (querying `db_manager.py`).
        *   Managing image sources: validating paths/URLs, listing images from sources (local files, URLs, Azure via `azure_handler.py`), calculating image hashes, adding image metadata to the DB via `db_manager.py`.
        *   Image pool management: determining next unprocessed image, setting active image (fetches image path from DB, tells `sam_backend.py` to load it, fetches image data for client).
        *   Mask management: Storing prompts and generated masks (from `sam_backend.py`) into the database via `db_manager.py` (e.g., converting masks to RLE for storage). Committing final masks.
        *   Updating image statuses in the DB.
*   **`export_logic.py`**:
    *   Handles the logic for exporting annotated data.
    *   Retrieves image and mask data from `db_manager.py` based on export criteria.
    *   Transforms masks into the required export format (e.g., COCO JSON, binary masks in a ZIP).
    *   Generates the final export file(s).
*   **`azure_handler.py` (Optional, for complex Azure interactions):**
    *   If interactions with Azure Blob Storage become complex (e.g., advanced listing with filters, resumable uploads/downloads, specific authentication flows beyond default credentials), this module would encapsulate that logic.
    *   Used by `project_logic.py` when an image source is of type "azure_blob".

**Utilities (`project_root/utils/`):**

*   **`get_model.py`**, **`get_model_config.py`**:
    *   These are responsible for downloading/locating SAM2 model checkpoint files and their corresponding configuration files. They are dependencies of `sam_backend.py`.

