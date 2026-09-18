from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.dataframe.importing import SUPPORTED_SUFFIXES, read_source
from app.dataframe.normalization import normalize_frame
from app.dataframe.profiling import profile_frame
from app.schemas import DatasetSummary
from app.storage.datasets import DatasetRepository


class DatasetService:
    """Coordinate dataset-level workflows between API routes and storage.

    Args:
        repository: filesystem adapter supplied during service construction.

    This service handles the dataset lifecycle: import, list, inspect, and
    delete. It uses dataframe helpers for data preparation and the repository
    for local files, keeping HTTP routes small and focused.
    """

    def __init__(self, repository: DatasetRepository) -> None:
        """Initialize the service with its persistence dependency.

        Args:
            repository: filesystem adapter used to store dataset files and metadata.
        """
        self.repository = repository

    async def import_upload(self, upload: UploadFile) -> DatasetSummary:
        """Import an uploaded file and return its persisted dataset summary.

        Args:
            upload: FastAPI file object supplied by the dataset upload route.

        The source file is retained, and its normalized dataframe is saved as
        Parquet. The method profiles variables and records metadata so the
        workspace can load summaries without reading every source file.
        """
        filename = upload.filename or "dataset"
        suffix = Path(filename).suffix.lower()
        source_format = SUPPORTED_SUFFIXES.get(suffix)
        if source_format is None:
            raise HTTPException(status_code=415, detail="Supported formats are CSV, XLSX, and Parquet.")

        dataset_id = str(uuid4())
        dataset_dir = self.repository.create_dataset_dir(dataset_id)
        original_path = dataset_dir / f"source{suffix}"
        with original_path.open("wb") as destination:
            shutil.copyfileobj(upload.file, destination)

        try:
            frame = normalize_frame(read_source(original_path, source_format))
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=422, detail=f"Garf could not read this dataset: {error}") from error
        finally:
            await upload.close()

        if frame.columns.empty:
            raise HTTPException(status_code=422, detail="The dataset does not contain any columns.")

        canonical_path = dataset_dir / "dataset.parquet"
        frame.to_parquet(canonical_path, index=False)
        created_at = datetime.now(UTC)
        record = {
            "id": dataset_id,
            "original_filename": filename,
            "source_format": source_format,
            "row_count": len(frame),
            "column_count": len(frame.columns),
            "variables": [variable.model_dump(mode="json") for variable in profile_frame(frame)],
            "created_at": created_at.isoformat(),
            "canonical_path": str(canonical_path),
        }
        registry = self.repository.get_registry()
        registry[dataset_id] = record
        self.repository.save_registry(registry)
        return DatasetSummary.model_validate(record)

    def list_summaries(self) -> list[DatasetSummary]:
        """Return saved datasets newest first for workspace restoration."""
        records = self.repository.get_registry().values()
        sorted_records = sorted(records, key=lambda record: record["created_at"], reverse=True)
        return [DatasetSummary.model_validate(record) for record in sorted_records]

    def get_summary(self, dataset_id: str) -> DatasetSummary:
        """Return the metadata needed to open one saved dataset.

        Args:
            dataset_id: identifier of the dataset to inspect.
        """
        return DatasetSummary.model_validate(self.repository.get_record(dataset_id))

    def delete(self, dataset_id: str) -> None:
        """Delete a dataset's files and remove its metadata registry record.

        Args:
            dataset_id: identifier of the dataset to delete.
        """
        registry = self.repository.get_registry()
        if dataset_id not in registry:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        self.repository.delete_dataset_dir(dataset_id)
        del registry[dataset_id]
        self.repository.save_registry(registry)
