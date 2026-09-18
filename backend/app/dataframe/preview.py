from __future__ import annotations

import json

import pandas as pd
from fastapi import HTTPException

from app.schemas import DatasetPreview, PreviewFilter
from app.dataframe.filtering import apply_filters


def build_preview(
    dataset_id: str,
    frame: pd.DataFrame,
    offset: int,
    limit: int,
    filters: list[PreviewFilter],
    sort_column: str | None,
    sort_descending: bool,
    date_only_columns: set[str],
) -> DatasetPreview:
    """Build a JSON-safe page of a dataset for the frontend.

    Args:
        dataset_id: identifier included in the returned preview.
        frame: canonical dataframe loaded from Parquet.
        offset: zero-based index of the first requested row.
        limit: maximum number of rows to include.
        filters: rules applied before sorting and pagination.
        sort_column: column name, or ``__row_number__``, used for sorting.
        sort_descending: whether to reverse the sort order.
        date_only_columns: datetime columns formatted as dates for display.

    The function prevents large datasets from being sent in full: it filters,
    sorts, pages, tracks original row numbers, and serializes the result.
    """
    filtered_frame = apply_filters(frame, filters)
    if sort_column == "__row_number__":
        filtered_frame = filtered_frame.sort_index(ascending=not sort_descending, kind="stable")
    elif sort_column is not None:
        if sort_column not in filtered_frame.columns:
            raise HTTPException(status_code=422, detail=f"Unknown sort column: {sort_column}")
        filtered_frame = filtered_frame.sort_values(sort_column, ascending=not sort_descending, kind="stable", na_position="last")

    suggestions = [
        column
        for column in filtered_frame.columns
        if column not in date_only_columns
        and pd.api.types.is_datetime64_any_dtype(filtered_frame[column])
        and not filtered_frame[column].dropna().empty
        and bool(filtered_frame[column].dropna().eq(filtered_frame[column].dropna().dt.normalize()).all())
    ]
    preview = filtered_frame.iloc[offset : offset + limit].copy()
    source_row_numbers = [int(index) + 1 for index in preview.index.tolist()]
    for column in date_only_columns.intersection(preview.columns):
        if pd.api.types.is_datetime64_any_dtype(preview[column]):
            preview[column] = preview[column].dt.strftime("%Y-%m-%d")
    preview = preview.where(pd.notna(preview), None)
    rows = json.loads(preview.to_json(orient="records", date_format="iso"))
    return DatasetPreview(
        dataset_id=dataset_id,
        columns=list(frame.columns),
        rows=rows,
        source_row_numbers=source_row_numbers,
        offset=offset,
        limit=limit,
        total_rows=len(filtered_frame),
        date_format_suggestions=suggestions,
    )
