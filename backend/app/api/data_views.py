from fastapi import APIRouter, Depends, Query

from app.dependencies import get_data_view_service
from app.schemas import DatasetPreview, FilteredPreviewRequest
from app.services.data_views import DataViewService


router = APIRouter(prefix="/api/datasets/{dataset_id}/preview", tags=["data views"])


@router.post("/query", response_model=DatasetPreview)
def query_preview(
    dataset_id: str,
    request: FilteredPreviewRequest,
    service: DataViewService = Depends(get_data_view_service),
) -> DatasetPreview:
    return service.preview(
        dataset_id,
        request.offset,
        request.limit,
        request.filters,
        request.sort_column,
        request.sort_descending,
    )


@router.get("", response_model=DatasetPreview)
def get_preview(
    dataset_id: str,
    sort_column: str | None = None,
    sort_descending: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=1000),
    service: DataViewService = Depends(get_data_view_service),
) -> DatasetPreview:
    return service.preview(dataset_id, offset, limit, sort_column=sort_column, sort_descending=sort_descending)
