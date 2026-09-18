from __future__ import annotations

from app.dataframe.preview import build_preview
from app.schemas import DatasetPreview, PreviewFilter
from app.storage.datasets import DatasetRepository


class DataViewService:
    def __init__(self, repository: DatasetRepository) -> None:
        self.repository = repository

    def preview(
        self,
        dataset_id: str,
        offset: int,
        limit: int,
        filters: list[PreviewFilter] | None = None,
        sort_column: str | None = None,
        sort_descending: bool = False,
    ) -> DatasetPreview:
        record = self.repository.get_record(dataset_id)
        frame = self.repository.read_frame(record)
        return build_preview(
            dataset_id=dataset_id,
            frame=frame,
            offset=offset,
            limit=limit,
            filters=filters or [],
            sort_column=sort_column,
            sort_descending=sort_descending,
            date_only_columns=set(record.get("date_only_columns", [])),
        )
