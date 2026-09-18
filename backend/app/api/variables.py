from fastapi import APIRouter, Depends, Query

from app.dependencies import get_variable_service
from app.schemas import DateDisplayRequest, DatasetSummary, RenameVariableRequest, VariableMetadata
from app.services.variables import VariableService


router = APIRouter(prefix="/api/datasets/{dataset_id}", tags=["variables"])


@router.get("/variables", response_model=list[VariableMetadata])
def get_variables(dataset_id: str, service: VariableService = Depends(get_variable_service)) -> list[VariableMetadata]:
    """Return variable metadata for the workspace's data panel.

    Args:
        dataset_id: path identifier of the requested dataset.
        service: injected service that reads saved variable metadata.
    """
    return service.list_variables(dataset_id)


@router.delete("/variables", response_model=DatasetSummary)
def delete_variable(
    dataset_id: str,
    name: str = Query(min_length=1),
    service: VariableService = Depends(get_variable_service),
) -> DatasetSummary:
    """Delete a variable and return refreshed dataset metadata to the client.

    Args:
        dataset_id: path identifier of the dataset to modify.
        name: query parameter containing the variable name to delete.
        service: injected service that applies the dataset mutation.
    """
    return service.delete_variable(dataset_id, name)


@router.patch("/variables", response_model=DatasetSummary)
def rename_variable(
    dataset_id: str,
    request: RenameVariableRequest,
    service: VariableService = Depends(get_variable_service),
) -> DatasetSummary:
    """Rename a variable and return metadata with the new column name.

    Args:
        dataset_id: path identifier of the dataset to modify.
        request: validated body with the current and replacement names.
        service: injected service that applies the dataset mutation.
    """
    return service.rename_variable(dataset_id, request.name, request.new_name)


@router.post("/date-display", status_code=204)
def set_date_display(
    dataset_id: str,
    request: DateDisplayRequest,
    service: VariableService = Depends(get_variable_service),
) -> None:
    """Save a date-only display preference for one datetime variable.

    Args:
        dataset_id: path identifier of the dataset to update.
        request: validated body naming the datetime variable.
        service: injected service that saves the display preference.
    """
    service.set_date_only_display(dataset_id, request.column)
