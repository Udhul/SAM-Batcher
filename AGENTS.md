# AGENTS Instructions

This repository contains a FastAPI backend and JavaScript frontend implementing the "SAM Batcher" annotation tool.  The documents in `docs/` capture the design, specification and current progress.  Use this file as a quick reference for where to look and how to contribute.

## Documentation Overview (Where to Learn About the Project)
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
- **JavaScript** uses modern ES6 syntax with semicolons.  Organise frontend logic according to the modules described in `docs/project_structure.md`. Document modules with JSDoc style comments similar, updating existing JSDoc comments as needed on change.
- Avoid unnecessary complexity; prefer clear and direct solutions that integrate with existing modules.
- Update documentation when behaviour or APIs change.

## Running & Testing
The project currently has no automated test suite.  If tests are added under a `tests/` folder, run `pytest` before committing.  Formatting can be checked with `black` for Python and a standard formatter such as `prettier` for JavaScript if configured.

## Development Notes
- The main entry point is `main.py`, which starts the FastAPI server defined in `app/backend/server.py`.
- A submodule containing the SAM2 package resides under `Modules/sam2/sam2`. T
  - This framework is used by `app/backend/sam_backend.py`. It is provided for context, for any development work requiring an understanding of the underlying functions.
  - We are not contributing to this submodule directly. Only using it through `app/backend/sam_backend.py`.
- Keep PRs focussed and reference the relevant docs for context in commit messages and pull request descriptions.

**Summary*
1. Read `docs/annotation_workflow_specification.md` together with the other docs to understand the current design.
2. Make use of commit history to understand development progression and current state and tasks in a temporal context.
3. Keep implementation simple and aligned with existing modules. Avoid over‑complication.
4. When changing behaviour or adding features, update the relevant documents:
   - Update specifications with the desired end state.
   - Update progress and todo lists to reflect current state.
5. Ensure new code integrates cleanly with the project structure described in `docs/project_structure.md`.
6. Commit concise structured messages describing the change.
