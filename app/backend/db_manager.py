"""SQLite persistence layer for SAM-Batcher projects.

This module exposes helper functions to create and query project databases.
Functions here perform no higher level logic; they simply translate Python
values to SQL operations and back.

Input/Output:
    * Inputs: primitive values describing project metadata, images and masks.
    * Outputs: dictionaries representing rows from the database.
"""

# project_root/app/backend/db_manager.py
import sqlite3
import os
import json
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

# Assuming config.py is in the project_root, one level above app/backend/
# Adjust path if your structure is different or use absolute imports if app is a package
try:
    from .... import config  # For running from within app/backend
except ImportError:
    import sys

    sys.path.append(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )  # Add project_root to path
    import config


def get_db_path(project_id: str) -> str:
    """Returns the full path to the project's database file."""
    return os.path.join(config.PROJECTS_DATA_DIR, f"{project_id}{config.DB_EXTENSION}")


def get_db_connection(
    project_id: str, detect_types: bool = False
) -> sqlite3.Connection:
    """Establishes a connection to the project's SQLite database."""
    db_path = get_db_path(project_id)
    if detect_types:
        conn = sqlite3.connect(
            db_path, detect_types=sqlite3.PARSE_DECLTYPES | sqlite3.PARSE_COLNAMES
        )
    else:
        conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row  # Access columns by name
    conn.execute("PRAGMA foreign_keys = ON;")  # Enforce foreign key constraints
    return conn


def ensure_mask_layers_schema(conn: sqlite3.Connection) -> None:
    """Add new columns to Mask_Layers table if they are missing."""
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(Mask_Layers)")
    existing = {row[1] for row in cursor.fetchall()}
    migrations = {
        "class_label": "ALTER TABLE Mask_Layers ADD COLUMN class_label TEXT",
        "status": "ALTER TABLE Mask_Layers ADD COLUMN status TEXT",
        "display_color": "ALTER TABLE Mask_Layers ADD COLUMN display_color TEXT",
        "source_metadata": "ALTER TABLE Mask_Layers ADD COLUMN source_metadata TEXT",
        "updated_at": "ALTER TABLE Mask_Layers ADD COLUMN updated_at TEXT",
    }
    for col, stmt in migrations.items():
        if col not in existing:
            cursor.execute(stmt)
    conn.commit()


def init_project_db(project_id: str, project_name: str) -> None:
    """Initializes a new project database with the required schema."""
    conn = get_db_connection(project_id)
    cursor = conn.cursor()

    # Project_Info Table
    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS Project_Info (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """
    )
    project_info_initial = [
        ("project_id", project_id),
        ("project_name", project_name),
        ("db_schema_version", "1.0"),  # For future migrations
        ("created_at", datetime.utcnow().isoformat()),
        ("last_modified_at_content", datetime.utcnow().isoformat()),
    ]
    cursor.executemany(
        "INSERT OR REPLACE INTO Project_Info (key, value) VALUES (?, ?)",
        project_info_initial,
    )

    # Image_Sources Table
    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS Image_Sources (
        source_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        details TEXT NOT NULL, -- JSON: path, URL, URI
        credentials_alias TEXT,
        added_at TEXT NOT NULL
    )
    """
    )

    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS Source_Image_Exemptions (
        source_id TEXT NOT NULL,
        image_hash TEXT NOT NULL,
        PRIMARY KEY (source_id, image_hash),
        FOREIGN KEY (source_id) REFERENCES Image_Sources(source_id) ON DELETE CASCADE,
        FOREIGN KEY (image_hash) REFERENCES Images(image_hash) ON DELETE CASCADE
    )
    """
    )

    # Images Table
    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS Images (
        image_hash TEXT PRIMARY KEY,
        original_filename TEXT,
        source_id_ref TEXT, -- Can be NULL if image is orphaned or from direct upload not tied to a persistent source
        path_in_source TEXT, -- Relative path or identifier within the source
        width INTEGER,
        height INTEGER,
        status TEXT DEFAULT 'unprocessed', -- e.g., "unprocessed", "in_progress", "ready_for_review", "approved", "rejected", "skip"
        added_to_pool_at TEXT NOT NULL,
        last_processed_at TEXT,
        notes TEXT,
        FOREIGN KEY (source_id_ref) REFERENCES Image_Sources(source_id) ON DELETE SET NULL
    )
    """
    )

    # Mask_Layers Table
    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS Mask_Layers (
        layer_id TEXT PRIMARY KEY,
        image_hash_ref TEXT NOT NULL,
        layer_type TEXT NOT NULL, -- legacy status field
        created_at TEXT NOT NULL,
        model_details TEXT,
        prompt_details TEXT,
        mask_data_rle TEXT NOT NULL,
        metadata TEXT,
        is_selected_for_final BOOLEAN DEFAULT FALSE,
        name TEXT,
        class_label TEXT,
        status TEXT,
        display_color TEXT,
        source_metadata TEXT,
        updated_at TEXT,
        FOREIGN KEY (image_hash_ref) REFERENCES Images(image_hash) ON DELETE CASCADE
    )
    """
    )

    ensure_mask_layers_schema(conn)

    # Project_Settings Table
    cursor.execute(
        """
    CREATE TABLE IF NOT EXISTS Project_Settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT -- JSON if complex
    )
    """
    )
    default_settings = [
        ("current_sam_model_key", config.DEFAULT_SAM_MODEL_KEY),
        ("current_sam_model_path", None),
        ("current_sam_config_path", None),
        (
            "current_sam_apply_postprocessing",
            str(config.DEFAULT_APPLY_POSTPROCESSING),
        ),  # Store as string
        ("export_format_default", config.DEFAULT_EXPORT_FORMAT),
        (
            "mask_layers_to_export_default",
            json.dumps(config.DEFAULT_MASK_LAYERS_TO_EXPORT),
        ),
    ]
    for key, value in default_settings:
        if value is not None:
            cursor.execute(
                "INSERT OR IGNORE INTO Project_Settings (setting_key, setting_value) VALUES (?, ?)",
                (key, value),
            )

    conn.commit()
    conn.close()
    print(f"Database initialized for project {project_id} at {get_db_path(project_id)}")


def update_last_modified(project_id: str) -> None:
    """Updates the last_modified_at_content in Project_Info."""
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE Project_Info SET value = ? WHERE key = 'last_modified_at_content'",
            (datetime.utcnow().isoformat(),),
        )
        conn.commit()
    except sqlite3.Error as e:
        print(f"Error updating last_modified for {project_id}: {e}")
    finally:
        conn.close()


# --- Project Info ---
def get_project_info(project_id: str) -> Dict[str, Any]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM Project_Info")
    info = {row["key"]: row["value"] for row in cursor.fetchall()}
    conn.close()
    return info


def get_project_name(project_id: str) -> Optional[str]:
    info = get_project_info(project_id)
    return info.get("project_name")


def set_project_name(project_id: str, new_name: str) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE Project_Info SET value = ? WHERE key = 'project_name'", (new_name,)
    )
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def delete_project_data(project_id: str) -> None:
    db_path = get_db_path(project_id)
    if os.path.exists(db_path):
        os.remove(db_path)
    project_dir = os.path.join(config.PROJECTS_DATA_DIR, project_id)
    if os.path.isdir(project_dir):
        import shutil

        shutil.rmtree(project_dir, ignore_errors=True)


# --- Project Settings ---
def get_project_setting(project_id: str, setting_key: str) -> Optional[str]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT setting_value FROM Project_Settings WHERE setting_key = ?",
        (setting_key,),
    )
    row = cursor.fetchone()
    conn.close()
    return row["setting_value"] if row else None


def set_project_setting(project_id: str, setting_key: str, setting_value: Any) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    # Convert boolean to string for storage if necessary
    if isinstance(setting_value, bool):
        value_to_store = str(setting_value)
    elif isinstance(setting_value, (dict, list)):
        value_to_store = json.dumps(setting_value)
    else:
        value_to_store = setting_value

    cursor.execute(
        "INSERT OR REPLACE INTO Project_Settings (setting_key, setting_value) VALUES (?, ?)",
        (setting_key, value_to_store),
    )
    conn.commit()
    conn.close()
    update_last_modified(project_id)


# --- Image Sources ---
def add_image_source(
    project_id: str,
    source_id: str,
    type: str,
    details: Dict,
    credentials_alias: Optional[str],
) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        """
    INSERT INTO Image_Sources (source_id, type, details, credentials_alias, added_at)
    VALUES (?, ?, ?, ?, ?)
    """,
        (
            source_id,
            type,
            json.dumps(details),
            credentials_alias,
            datetime.utcnow().isoformat(),
        ),
    )
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def get_image_sources(project_id: str) -> List[Dict[str, Any]]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        """
    SELECT s.source_id, s.type, s.details, s.credentials_alias, s.added_at, COUNT(i.image_hash) as image_count
    FROM Image_Sources s
    LEFT JOIN Images i ON s.source_id = i.source_id_ref
    GROUP BY s.source_id, s.type, s.details, s.credentials_alias, s.added_at
    """
    )
    sources = []
    for row in cursor.fetchall():
        source = dict(row)
        source["details"] = json.loads(source["details"])
        sources.append(source)
    conn.close()
    return sources


def remove_image_source(project_id: str, source_id: str) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    # Images referencing this source will have source_id_ref set to NULL due to ON DELETE SET NULL
    cursor.execute("DELETE FROM Image_Sources WHERE source_id = ?", (source_id,))
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def get_images_for_source(project_id: str, source_id: str) -> List[Dict[str, Any]]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        """
    SELECT i.*, CASE WHEN e.image_hash IS NOT NULL THEN 1 ELSE 0 END AS exempted
    FROM Images i
    LEFT JOIN Source_Image_Exemptions e ON i.image_hash = e.image_hash AND e.source_id = ?
    WHERE i.source_id_ref = ?
    ORDER BY i.added_to_pool_at DESC
    """,
        (source_id, source_id),
    )
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    for r in rows:
        r["exempted"] = bool(r["exempted"])
    return rows


def set_image_exemption(
    project_id: str, source_id: str, image_hash: str, exempt: bool = True
) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    if exempt:
        cursor.execute(
            "INSERT OR IGNORE INTO Source_Image_Exemptions (source_id, image_hash) VALUES (?, ?)",
            (source_id, image_hash),
        )
    else:
        cursor.execute(
            "DELETE FROM Source_Image_Exemptions WHERE source_id = ? AND image_hash = ?",
            (source_id, image_hash),
        )
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def get_source_id_for_image(project_id: str, image_hash: str) -> Optional[str]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT source_id_ref FROM Images WHERE image_hash = ?", (image_hash,)
    )
    row = cursor.fetchone()
    conn.close()
    return row["source_id_ref"] if row else None


def delete_image_from_pool(project_id: str, image_hash: str) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM Images WHERE image_hash = ?", (image_hash,))
    conn.commit()
    conn.close()
    update_last_modified(project_id)


# --- Images ---
def add_image_to_pool(
    project_id: str,
    image_hash: str,
    original_filename: Optional[str],
    source_id_ref: Optional[str],
    path_in_source: str,
    width: int,
    height: int,
    status: str = "unprocessed",
) -> bool:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
        INSERT INTO Images (image_hash, original_filename, source_id_ref, path_in_source, width, height, status, added_to_pool_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(image_hash) DO UPDATE SET
            original_filename = COALESCE(excluded.original_filename, Images.original_filename), -- Keep existing if new is null
            source_id_ref = COALESCE(excluded.source_id_ref, Images.source_id_ref) -- Prioritize new, but might need more complex logic if an image can belong to multiple sources
        """,
            (
                image_hash,
                original_filename,
                source_id_ref,
                path_in_source,
                width,
                height,
                status,
                datetime.utcnow().isoformat(),
            ),
        )
        conn.commit()
        is_new = cursor.rowcount > 0
    except sqlite3.IntegrityError:  # Should be caught by ON CONFLICT, but as fallback
        is_new = False  # Image already exists
    finally:
        conn.close()

    if is_new:
        update_last_modified(project_id)
    return is_new  # True if new image added, False if updated or existed


def get_image_by_hash(project_id: str, image_hash: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM Images WHERE image_hash = ?", (image_hash,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_images_from_pool(
    project_id: str,
    page: int = 1,
    per_page: int = 50,
    status_filter: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()

    base_query = (
        "FROM Images i "
        "LEFT JOIN Source_Image_Exemptions e ON i.image_hash = e.image_hash "
        "WHERE e.image_hash IS NULL"
    )

    params: List[Any] = []
    if status_filter:
        base_query += " AND i.status = ?"
        params.append(status_filter)

    count_query = "SELECT COUNT(*) " + base_query
    cursor.execute(count_query, params)
    total_items = cursor.fetchone()[0]

    data_query = (
        "SELECT i.* "
        + base_query
        + " ORDER BY i.added_to_pool_at DESC LIMIT ? OFFSET ?"
    )
    params.extend([per_page, (page - 1) * per_page])

    cursor.execute(data_query, params)
    images = [dict(row) for row in cursor.fetchall()]
    conn.close()

    pagination = {
        "total": total_items,
        "page": page,
        "per_page": per_page,
        "total_pages": (total_items + per_page - 1) // per_page if per_page > 0 else 0,
    }
    return images, pagination


def update_image_status(project_id: str, image_hash: str, status: str) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE Images SET status = ?, last_processed_at = ? WHERE image_hash = ?",
        (status, datetime.utcnow().isoformat(), image_hash),
    )
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def get_next_unprocessed_image(
    project_id: str, current_image_hash: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    # Basic: find first unprocessed. More complex logic could order by added_at or filename.
    query = "SELECT * FROM Images WHERE status = 'unprocessed'"
    params = []
    if (
        current_image_hash
    ):  # Try to get one *after* the current, if any, to avoid loops. This needs an order.
        query += " AND added_to_pool_at > (SELECT added_to_pool_at FROM Images WHERE image_hash = ?)"
        params.append(current_image_hash)
    query += " ORDER BY added_to_pool_at ASC LIMIT 1"  # Get the oldest unprocessed

    cursor.execute(query, params)
    row = cursor.fetchone()

    if (
        not row and current_image_hash
    ):  # If no unprocessed after current, try any unprocessed
        cursor.execute(
            "SELECT * FROM Images WHERE status = 'unprocessed' ORDER BY added_to_pool_at ASC LIMIT 1"
        )
        row = cursor.fetchone()

    conn.close()
    return dict(row) if row else None


def get_next_image_by_statuses(
    project_id: str, statuses: List[str], current_image_hash: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Returns the next image with a status in the provided list."""
    if not statuses:
        return None

    placeholders = ",".join(["?"] * len(statuses))
    query = f"SELECT * FROM Images WHERE status IN ({placeholders})"
    params: List[Any] = list(statuses)
    if current_image_hash:
        query += " AND added_to_pool_at > (SELECT added_to_pool_at FROM Images WHERE image_hash = ?)"
        params.append(current_image_hash)
    query += " ORDER BY added_to_pool_at ASC LIMIT 1"

    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(query, params)
    row = cursor.fetchone()

    if not row and current_image_hash:
        cursor.execute(
            f"SELECT * FROM Images WHERE status IN ({placeholders}) ORDER BY added_to_pool_at ASC LIMIT 1",
            statuses,
        )
        row = cursor.fetchone()

    conn.close()
    return dict(row) if row else None


def get_image_hashes_by_statuses(project_id: str, statuses: List[str]) -> List[str]:
    """Returns image hashes for images whose status is in the provided list."""
    if not statuses:
        return []
    placeholders = ",".join(["?"] * len(statuses))
    query = f"SELECT image_hash FROM Images WHERE status IN ({placeholders})"
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(query, statuses)
    rows = cursor.fetchall()
    conn.close()
    return [row["image_hash"] for row in rows]


def get_layers_by_image_and_statuses(
    project_id: str, image_hashes: List[str], layer_statuses: List[str]
) -> List[Dict[str, Any]]:
    """Returns mask layers for given images filtered by layer_type/status."""
    if not image_hashes:
        return []
    placeholders_imgs = ",".join(["?"] * len(image_hashes))
    query = f"SELECT * FROM Mask_Layers WHERE image_hash_ref IN ({placeholders_imgs})"
    params: List[Any] = list(image_hashes)
    if layer_statuses:
        placeholders_layers = ",".join(["?"] * len(layer_statuses))
        query += f" AND status IN ({placeholders_layers})"
        params.extend(layer_statuses)
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(query, params)
    layers = []
    for row in cursor.fetchall():
        layer = dict(row)
        if layer.get("source_metadata"):
            try:
                layer["source_metadata"] = json.loads(layer["source_metadata"])
            except json.JSONDecodeError:
                pass
        if layer.get("model_details"):
            layer["model_details"] = json.loads(layer["model_details"])
        if layer.get("prompt_details"):
            layer["prompt_details"] = json.loads(layer["prompt_details"])
        try:
            layer["mask_data_rle"] = json.loads(layer["mask_data_rle"])
        except (json.JSONDecodeError, TypeError):
            pass
        if layer.get("metadata"):
            layer["metadata"] = json.loads(layer["metadata"])
        layers.append(layer)
    conn.close()
    return layers


# --- Mask Layers ---
def save_mask_layer(
    project_id: str,
    layer_id: str,
    image_hash_ref: str,
    status: str,
    mask_data_rle: Any,
    name: Optional[str] = None,
    class_label: Optional[str] = None,
    display_color: Optional[str] = None,
    source_metadata: Optional[Dict] = None,
) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        """
    INSERT INTO Mask_Layers (
        layer_id,
        image_hash_ref,
        status,
        mask_data_rle,
        name,
        class_label,
        display_color,
        source_metadata,
        created_at,
        updated_at,
        layer_type,
        model_details,
        prompt_details,
        metadata,
        is_selected_for_final
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            layer_id,
            image_hash_ref,
            status,
            (
                json.dumps(mask_data_rle)
                if isinstance(mask_data_rle, (dict, list))
                else mask_data_rle
            ),
            name,
            class_label,
            display_color,
            json.dumps(source_metadata) if source_metadata else None,
            datetime.utcnow().isoformat(),
            datetime.utcnow().isoformat(),
            status,
            None,
            None,
            None,
            False,
        ),
    )
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def get_mask_layers_for_image(
    project_id: str, image_hash: str, layer_type: Optional[str] = None
) -> List[Dict[str, Any]]:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    query = "SELECT * FROM Mask_Layers WHERE image_hash_ref = ?"
    params = [image_hash]
    if layer_type:
        query += " AND layer_type = ?"
        params.append(layer_type)
    query += " ORDER BY created_at DESC"

    cursor.execute(query, params)
    layers = []
    for row in cursor.fetchall():
        layer = dict(row)
        if layer.get("source_metadata"):
            try:
                layer["source_metadata"] = json.loads(layer["source_metadata"])
            except json.JSONDecodeError:
                pass
        if layer.get("model_details"):
            layer["model_details"] = json.loads(layer["model_details"])
        if layer.get("prompt_details"):
            layer["prompt_details"] = json.loads(layer["prompt_details"])
        try:
            layer["mask_data_rle"] = json.loads(layer["mask_data_rle"])
        except (json.JSONDecodeError, TypeError):
            pass
        if layer.get("metadata"):
            layer["metadata"] = json.loads(layer["metadata"])
            if "class_label" in layer["metadata"] and not layer.get("class_label"):
                layer["class_label"] = layer["metadata"].get("class_label")
            if "display_color" in layer["metadata"] and not layer.get("display_color"):
                layer["display_color"] = layer["metadata"].get("display_color")
        layers.append(layer)
    conn.close()
    return layers


def count_mask_layers_for_image(project_id: str, image_hash: str) -> int:
    """Returns the number of mask layers for the given image."""
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM Mask_Layers WHERE image_hash_ref = ?", (image_hash,)
    )
    count = cursor.fetchone()[0]
    conn.close()
    return count


def delete_mask_layer(project_id: str, layer_id: str) -> None:
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM Mask_Layers WHERE layer_id = ?", (layer_id,))
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def update_mask_layer_basic(
    project_id: str,
    layer_id: str,
    name: Optional[str] = None,
    class_label: Optional[str] = None,
    display_color: Optional[str] = None,
) -> None:
    """Update simple editable fields for a mask layer."""
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    updates = []
    params: List[Any] = []
    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if class_label is not None:
        updates.append("class_label = ?")
        params.append(class_label)
    if display_color is not None:
        updates.append("display_color = ?")
        params.append(display_color)
    if not updates:
        conn.close()
        return
    updates.append("updated_at = ?")
    params.append(datetime.utcnow().isoformat())
    query = f"UPDATE Mask_Layers SET {', '.join(updates)} WHERE layer_id = ?"
    params.append(layer_id)
    cursor.execute(query, params)
    conn.commit()
    conn.close()
    update_last_modified(project_id)


def update_mask_layer_status(project_id: str, layer_id: str, status: str) -> None:
    """Update the layer_type/status field for a mask layer."""
    conn = get_db_connection(project_id)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE Mask_Layers SET layer_type = ?, status = ?, updated_at = ? WHERE layer_id = ?",
        (
            status,
            status,
            datetime.utcnow().isoformat(),
            layer_id,
        ),
    )
    conn.commit()
    conn.close()
    update_last_modified(project_id)


# --- General Utility ---
def list_project_ids() -> List[str]:
    """Lists project IDs by finding .sqlite files in PROJECTS_DATA_DIR."""
    project_ids = []
    if os.path.exists(config.PROJECTS_DATA_DIR):
        for f_name in os.listdir(config.PROJECTS_DATA_DIR):
            if f_name.endswith(config.DB_EXTENSION):
                project_id = f_name[: -len(config.DB_EXTENSION)]
                # Basic validation: check if it's a valid DB by trying to get project_name
                try:
                    if get_project_name(project_id):  # Ensures DB is somewhat valid
                        project_ids.append(project_id)
                except sqlite3.Error:
                    print(f"Warning: Found potentially corrupt DB file: {f_name}")
                    pass  # Skip corrupt or non-project DB files
    return project_ids


if __name__ == "__main__":
    # Example Usage (for testing)
    test_project_id = "test_project_db_manager"
    test_project_name = "DB Manager Test Project"

    if os.path.exists(get_db_path(test_project_id)):
        os.remove(get_db_path(test_project_id))

    init_project_db(test_project_id, test_project_name)
    print(f"Project Info: {get_project_info(test_project_id)}")

    set_project_setting(test_project_id, "ui_theme", "dark")
    print(f"UI Theme: {get_project_setting(test_project_id, 'ui_theme')}")

    source_id = "src_123"
    add_image_source(test_project_id, source_id, "folder", {"path": "/mnt/data"}, None)
    print(f"Image Sources: {get_image_sources(test_project_id)}")

    img_hash = "dummyhash123"
    add_image_to_pool(
        test_project_id, img_hash, "image1.jpg", source_id, "image1.jpg", 800, 600
    )
    print(f"Image by hash: {get_image_by_hash(test_project_id, img_hash)}")

    images, pagi = get_images_from_pool(test_project_id)
    print(f"Images from pool: {images}, Pagination: {pagi}")

    update_image_status(test_project_id, img_hash, "completed")
    print(
        f"Updated image status: {get_image_by_hash(test_project_id, img_hash)['status']}"
    )

    print(f"Next unprocessed: {get_next_unprocessed_image(test_project_id)}")

    layer_id_1 = "layer_abc"
    save_mask_layer(
        test_project_id,
        layer_id_1,
        img_hash,
        "automask",
        {"name": "model_X"},
        None,
        "RLE_DATA_STRING_1",
        {"score": 0.9},
    )
    print(f"Masks for image: {get_mask_layers_for_image(test_project_id, img_hash)}")

    # Clean up test file
    # if os.path.exists(get_db_path(test_project_id)):
    #     os.remove(get_db_path(test_project_id))
    # print(f"Cleaned up {get_db_path(test_project_id)}")

    print("DB Manager Test Complete.")
