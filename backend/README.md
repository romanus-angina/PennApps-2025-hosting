Backend quickstart

1. Create a virtualenv and install requirements

python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt

2. Run the server

uvicorn app:app --reload --port 8000

Endpoints:
- GET /health
- POST /llm/weights {"prompt": "..."}
- GET /route/fetch
