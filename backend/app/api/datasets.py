from fastapi import APIRouter, Depends, File, UploadFile

from app.dependencies import get_dataset_service
from app.schemas import DatasetSummary
from app.services.datasets import DatasetService


router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.post("", response_model=DatasetSummary, status_code=201)
async def upload_dataset(
    file: UploadFile = File(...),
    service: DatasetService = Depends(get_dataset_service),
) -> DatasetSummary:
    """Accept a file upload and create a saved Garf dataset from it.

    Args:
        file: uploaded CSV, XLSX, or Parquet file.
        service: injected service that performs the import workflow.

    The handler maps HTTP input to DatasetService; it does not perform storage
    or dataframe work itself.
    """
    return await service.import_upload(file)


@router.get("", response_model=list[DatasetSummary])
def list_datasets(service: DatasetService = Depends(get_dataset_service)) -> list[DatasetSummary]:
    """List saved datasets so the frontend can restore its workspace.

    Args:
        service: injected service that reads saved dataset summaries.
    """
    return service.list_summaries()


@router.get("/{dataset_id}", response_model=DatasetSummary)
def get_dataset(dataset_id: str, service: DatasetService = Depends(get_dataset_service)) -> DatasetSummary:
    """Return one dataset's saved summary and variable metadata.

    Args:
        dataset_id: path identifier of the requested dataset.
        service: injected service that reads the dataset summary.
    """
    return service.get_summary(dataset_id)


@router.delete("/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str, service: DatasetService = Depends(get_dataset_service)) -> None:
    """Delete one dataset after the frontend confirms the user action.

    Args:
        dataset_id: path identifier of the dataset to delete.
        service: injected service that removes stored dataset files and metadata.
    """
    service.delete(dataset_id)
