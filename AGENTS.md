# AGENTS Instructions

This repository contains a FastAPI backend and JavaScript frontend implementing the "SAM Batcher" annotation tool.  The documents in `docs/` capture the design, specification and current progress.  Use this file as a quick reference for where to look and how to contribute.

## Documentation Overview
- `docs/specification.md` – High level system architecture and API specification.
- `docs/canvas_specification.md` – Technical details of the canvas interaction layer.
- `docs/project_structure.md` – Explains the directory layout and purpose of modules.
- `docs/annotation_workflow_specification.md` – Main feature design for the multi-layer annotation workflow.  Read this carefully before implementing new features.
- `docs/annotation_workflow_progress.md` – Tracks what parts of the workflow have been implemented.
- `docs/roles.md` – Outlines the roles of server and client components.
- `docs/todo.md` – Remaining tasks and ideas.

Always consult these documents before making changes so your work aligns with the expected architecture and current progress.

## Coding Guidelines
- **Python** code follows standard [PEP 8](https://peps.python.org/pep-0008/) style with 4‑space indentation and type hints where practical.  Keep functions small and focused.  Docstrings are encouraged for public functions.
- **JavaScript** uses modern ES6 syntax with semicolons.  Organise frontend logic according to the modules described in `docs/project_structure.md`.
- Avoid unnecessary complexity; prefer clear and direct solutions that integrate with existing modules.
- Update documentation when behaviour or APIs change.

## Running & Testing
The project currently has no automated test suite.  If tests are added under a `tests/` folder, run `pytest` before committing.  Formatting can be checked with `black` for Python and a standard formatter such as `prettier` for JavaScript if configured.

## Development Notes
- The main entry point is `main.py`, which starts the FastAPI server defined in `app/backend/server.py`.
- A submodule containing the SAM2 model resides under `Modules/sam2` and may have its own contribution guidelines.
- Environment setup instructions are provided in `setup.sh` and `setup.py`.
- Keep PRs focussed and reference the relevant docs for context in commit messages and pull request descriptions.

