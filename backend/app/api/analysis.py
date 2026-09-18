from typing import Any

from fastapi import APIRouter, Depends

from app.dependencies import get_descriptive_statistics_service
from app.schemas import FilteredPreviewRequest
from app.services.statistics import DescriptiveStatisticsService


router = APIRouter(prefix="/api/datasets/{dataset_id}", tags=["analysis"])


@router.post("/descriptive-statistics")
def descriptive_statistics(
    dataset_id: str,
    request: FilteredPreviewRequest,
    service: DescriptiveStatisticsService = Depends(get_descriptive_statistics_service),
) -> list[dict[str, Any]]:
    return service.calculate(dataset_id, request.filters)
