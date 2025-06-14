# project_root/main.py
import argparse
import os
import sys

# Ensure the app directory is in the Python path if main.py is in project_root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.backend.server import run_server
import config

if __name__ == '__main__':
    parser_main = argparse.ArgumentParser(description="Run SAM2 Backend Server")
    parser_main.add_argument('--api-only', action='store_true',
                             help="Run in API only mode (Web UI routes will return 404)")
    parser_main.add_argument('--host', type=str, default=config.SERVER_HOST,
                             help="Host to bind the server to.")
    parser_main.add_argument('--port', type=int, default=config.SERVER_PORT,
                             help="Port to run the server on.")
    parser_main.add_argument('--debug', action='store_true', dest='debug',
                             help="Enable debug mode (auto reload) for the FastAPI server.")
    parser_main.set_defaults(debug=False)
    cli_args = parser_main.parse_args()

    run_server(
        serve_ui=not cli_args.api_only,
        host=cli_args.host,
        port=cli_args.port,
        debug=cli_args.debug,
    )

