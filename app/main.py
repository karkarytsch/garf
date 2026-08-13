from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.datasets import DatasetStore
from app.schemas import DateDisplayRequest, DatasetPreview, DatasetSummary, FilteredPreviewRequest, RenameVariableRequest, VariableMetadata

app = FastAPI(title="Garf API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
store = DatasetStore()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/datasets", response_model=DatasetSummary, status_code=201)
async def upload_dataset(file: UploadFile = File(...)) -> DatasetSummary:
    return await store.import_upload(file)


@app.get("/api/datasets", response_model=list[DatasetSummary])
def list_datasets() -> list[DatasetSummary]:
    return store.list_summaries()


@app.get("/api/datasets/{dataset_id}", response_model=DatasetSummary)
def get_dataset(dataset_id: str) -> DatasetSummary:
    return store.get_summary(dataset_id)


@app.delete("/api/datasets/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str) -> None:
    store.delete(dataset_id)


@app.get("/api/datasets/{dataset_id}/variables", response_model=list[VariableMetadata])
def get_variables(dataset_id: str) -> list[VariableMetadata]:
    return store.get_summary(dataset_id).variables


@app.delete("/api/datasets/{dataset_id}/variables", response_model=DatasetSummary)
def delete_variable(dataset_id: str, name: str = Query(min_length=1)) -> DatasetSummary:
    return store.delete_variable(dataset_id, name)


@app.patch("/api/datasets/{dataset_id}/variables", response_model=DatasetSummary)
def rename_variable(dataset_id: str, request: RenameVariableRequest) -> DatasetSummary:
    return store.rename_variable(dataset_id, request.name, request.new_name)


@app.post("/api/datasets/{dataset_id}/descriptive-statistics")
def descriptive_statistics(dataset_id: str, request: FilteredPreviewRequest) -> list[dict]:
    return store.descriptive_statistics(dataset_id, request.filters)


@app.post("/api/datasets/{dataset_id}/date-display", status_code=204)
def set_date_display(dataset_id: str, request: DateDisplayRequest) -> None:
    store.set_date_only_display(dataset_id, request.column)


@app.post("/api/datasets/{dataset_id}/preview/query", response_model=DatasetPreview)
def query_preview(dataset_id: str, request: FilteredPreviewRequest) -> DatasetPreview:
    return store.preview(dataset_id, request.offset, request.limit, request.filters, request.sort_column, request.sort_descending)


@app.get("/api/datasets/{dataset_id}/preview", response_model=DatasetPreview)
def get_preview(
    dataset_id: str,
    sort_column: str | None = None,
    sort_descending: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=1000),
) -> DatasetPreview:
    return store.preview(dataset_id, offset, limit, sort_column=sort_column, sort_descending=sort_descending)
