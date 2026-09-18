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
    return await service.import_upload(file)


@router.get("", response_model=list[DatasetSummary])
def list_datasets(service: DatasetService = Depends(get_dataset_service)) -> list[DatasetSummary]:
    return service.list_summaries()


@router.get("/{dataset_id}", response_model=DatasetSummary)
def get_dataset(dataset_id: str, service: DatasetService = Depends(get_dataset_service)) -> DatasetSummary:
    return service.get_summary(dataset_id)


@router.delete("/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str, service: DatasetService = Depends(get_dataset_service)) -> None:
    service.delete(dataset_id)
