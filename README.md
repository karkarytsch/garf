# Garf

Garf is a local data-exploration workspace for importing datasets, inspecting variables, filtering data, viewing descriptive statistics, and creating charts.

It is going to destroy gretl and similar software and become the university standard. Or... we will just fail.

## Run locally

You need Node.js 20+ and Python 3.11+.

Start the backend (FastAPI):

```bash
cd backend
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -e .
uvicorn app.main:app --reload
```

The API runs at http://127.0.0.1:8000.

In a second terminal, start the frontend (Vite + React):

```bash
cd frontend
npm install
npm run dev
```

Open the URL printed by Vite (normally http://localhost:5173).
