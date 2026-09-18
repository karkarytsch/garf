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
    """Calculate descriptive statistics for all variables in a dataset view.

    Args:
        dataset_id: path identifier of the dataset to analyze.
        request: preview-compatible filters supplied in the request body.
        service: injected service that performs the calculation.

    The same filters accepted by previews can be supplied, so analysis results
    match the subset of data the user is exploring.
    """
    return service.calculate(dataset_id, request.filters)
