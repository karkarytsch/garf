from fastapi import APIRouter, Depends, Query

from app.dependencies import get_variable_service
from app.schemas import DateDisplayRequest, DatasetSummary, RenameVariableRequest, VariableMetadata
from app.services.variables import VariableService


router = APIRouter(prefix="/api/datasets/{dataset_id}", tags=["variables"])


@router.get("/variables", response_model=list[VariableMetadata])
def get_variables(dataset_id: str, service: VariableService = Depends(get_variable_service)) -> list[VariableMetadata]:
    return service.list_variables(dataset_id)


@router.delete("/variables", response_model=DatasetSummary)
def delete_variable(
    dataset_id: str,
    name: str = Query(min_length=1),
    service: VariableService = Depends(get_variable_service),
) -> DatasetSummary:
    return service.delete_variable(dataset_id, name)


@router.patch("/variables", response_model=DatasetSummary)
def rename_variable(
    dataset_id: str,
    request: RenameVariableRequest,
    service: VariableService = Depends(get_variable_service),
) -> DatasetSummary:
    return service.rename_variable(dataset_id, request.name, request.new_name)


@router.post("/date-display", status_code=204)
def set_date_display(
    dataset_id: str,
    request: DateDisplayRequest,
    service: VariableService = Depends(get_variable_service),
) -> None:
    service.set_date_only_display(dataset_id, request.column)
