from __future__ import annotations

from app.dataframe.preview import build_preview
from app.schemas import DatasetPreview, PreviewFilter
from app.storage.datasets import DatasetRepository


class DataViewService:
    """Prepare dataset slices for Garf's interactive table and charts.

    Args:
        repository: filesystem adapter supplied during service construction.

    This service reads a canonical dataset and delegates the dataframe work to
    ``build_preview``. It is deliberately separate from mutation services so
    preview requests do not write or alter stored data.
    """

    def __init__(self, repository: DatasetRepository) -> None:
        """Initialize the service with its read-only data dependency.

        Args:
            repository: filesystem adapter used to load canonical dataframes.
        """
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
        """Return one filtered, sorted, and paginated dataset preview.

        Args:
            dataset_id: identifier of the dataset to view.
            offset: zero-based index of the first row to return.
            limit: maximum number of rows to return.
            filters: optional rules that select rows before pagination.
            sort_column: optional column used to order rows.
            sort_descending: whether the selected sort order is descending.

        The frontend requests a page rather than a complete dataset, keeping
        table and chart exploration responsive for larger files.
        """
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
