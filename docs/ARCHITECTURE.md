# Garf architecture

This document describes the implementation currently in the repository.

## Repository layout

```text
backend/                 FastAPI dataset API and Python tests
  app/main.py            application and HTTP routes
  app/datasets.py        dataset import, persistence, metadata, previews, filters
  app/schemas.py         Pydantic request and response models
  tests/test_datasets.py dataset-store tests
frontend/                Vite + React + TypeScript client
  src/api.ts             typed HTTP client and shared API types
  src/App.tsx            routes
  src/components/EChart.tsx reusable Apache ECharts lifecycle wrapper
  src/visualizations/     focused visualization components
  src/pages/             role selection and student workspace
  src/styles.css         application styles
AGENTS.md                repository working instructions
README.md                local development instructions
```

## Backend

`backend/app/main.py` creates the FastAPI application and one process-local `DatasetStore`. CORS permits the Vite development origins on ports 5173.

`DatasetStore` is the current data boundary. It imports CSV, XLSX, and Parquet files with pandas; normalizes column names; infers datetime columns from date-like names and values; profiles variables; and serves dataset operations. Supported operations are:

- import, list, fetch summary, and delete datasets;
- list, rename, and delete variables;
- retrieve sorted and paginated previews;
- filter previews and descriptive statistics with the same filter rules;
- save a date-only display preference for datetime columns.

The API is rooted at `/api`. `schemas.py` defines the JSON contract for dataset summaries, variable metadata, previews, filters, renames, and date-display requests. There is no authentication, database, background work queue, or server-side analysis/model API.

## Dataset flow and persistence

```text
browser upload
  -> POST /api/datasets
  -> original file: data/datasets/<uuid>/source.<extension>
  -> pandas normalization and profiling
  -> canonical file: data/datasets/<uuid>/dataset.parquet
  -> registry metadata: data/datasets.json
  -> JSON summary/preview returned to the browser
```

The storage root defaults to `data/` and can be changed with `GARF_STORAGE_DIR`. `datasets.json` stores dataset metadata, including the canonical Parquet path, variable profile, and date-only display settings. Dataset mutations rewrite the canonical Parquet file and update the registry. Preview, filtering, and descriptive-statistics requests read the canonical Parquet file.

## Frontend

The frontend is a React 19 single-page application built by Vite. `main.tsx` mounts the app with `BrowserRouter`; `App.tsx` routes `/` to `RoleSelectionPage` and `/student` to `StudentWorkspacePage`. The Teacher card is display-only.

`api.ts` is the frontend/backend boundary. It reads `VITE_GARF_API_URL`, defaulting to `http://127.0.0.1:8000`, and wraps the dataset API with TypeScript request and response types.

`StudentWorkspacePage.tsx` currently owns the student workspace state and interactions:

- restores the backend dataset list and activates the newest dataset;
- imports, selects, deletes, renames, and removes variables from datasets;
- requests server-side previews, sorting, and filters;
- persists preview filters and delete-confirmation preferences in browser `localStorage`;
- builds line, scatter, bar, and histogram views from the loaded preview rows with Apache ECharts;
- applies chart-only time bucketing, aggregation, transformations, and date range in the browser before passing values into ECharts. ECharts owns chart zooming and panning through its native data-zoom controls.
- creates session-only custom numeric variables in the browser. These appear in the Data panel and preview table, and can be used in charts, but are deliberately not sent to or persisted by the API.

`EChart.tsx` owns only the DOM-to-ECharts lifecycle: initialization, option updates, ResizeObserver-based resizing, and cleanup. `DatasetChart.tsx` is a focused renderer for uploaded-dataset line, scatter, bar, and histogram views; it receives prepared application data rather than owning transformations or aggregation. The sample is clearly marked as local demonstration data and does not use the API or persistence.

The page requests at most 1,000 rows per preview. Charts therefore reflect the loaded preview, including its current server-side filters and sort order, rather than querying a separate chart endpoint.

## API boundary

| Area | Endpoints |
| --- | --- |
| Service | `GET /api/health` |
| Datasets | `POST /api/datasets`, `GET /api/datasets`, `GET /api/datasets/{id}`, `DELETE /api/datasets/{id}` |
| Variables | `GET`, `PATCH`, and `DELETE /api/datasets/{id}/variables` |
| Data views | `GET /api/datasets/{id}/preview`, `POST /api/datasets/{id}/preview/query` |
| Dataset options | `POST /api/datasets/{id}/date-display` |
| Statistics | `POST /api/datasets/{id}/descriptive-statistics` |

The frontend currently calls the dataset, variable, preview, filter, and date-display endpoints. The descriptive-statistics client wrapper exists in `api.ts`, but the rendered workspace does not yet invoke it.

## Testing and local operation

Backend tests in `backend/tests/test_datasets.py` cover normalization, profiling, filtering, previews, date-display settings, renaming, and variable deletion against temporary storage. The frontend has no test suite configured; `npm run build` runs TypeScript compilation followed by the Vite production build.

Run the backend with Uvicorn on port 8000 and the frontend with Vite on port 5173, as described in `README.md`. The development frontend connects to the API over HTTP using the configured API URL.
