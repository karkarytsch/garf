from __future__ import annotations

from typing import Any

import pandas as pd

from app.schemas import VariableMetadata


def json_value(value: Any) -> Any:
    """Convert a pandas or NumPy value into a JSON-compatible value.

    Args:
        value: scalar value taken from a dataframe or calculation result.

    Example:
        ``json_value(pd.Timestamp("2026-01-01"))`` returns
        ``"2026-01-01T00:00:00"``.

    Metadata, previews, and statistics use this conversion before they are
    returned in JSON responses.
    """
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def profile_frame(frame: pd.DataFrame) -> list[VariableMetadata]:
    """Create metadata records for every variable in a dataframe.

    Args:
        frame: normalized dataframe whose columns should be profiled.

    Example:
        ``profile_frame(pd.DataFrame({"price": [1.2, 1.5]}))`` returns one
        metadata record with ``logical_type`` set to ``"numeric"``.

    The import and variable services call this after data is created or
    changed. Its result supplies types, sample values, ranges, and counts to
    the frontend without sending full columns.
    """
    variables: list[VariableMetadata] = []
    for position, name in enumerate(frame.columns):
        series = frame[name]
        missing_count = int(series.isna().sum())
        distinct_count = int(series.nunique(dropna=True))
        samples = [json_value(value) for value in series.dropna().head(5).tolist()]
        is_numeric = bool(pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series))
        is_datetime = bool(pd.api.types.is_datetime64_any_dtype(series))
        is_boolean = bool(pd.api.types.is_bool_dtype(series))
        if is_numeric:
            logical_type = "numeric"
        elif is_datetime:
            logical_type = "datetime"
        elif is_boolean:
            logical_type = "boolean"
        elif distinct_count <= min(30, max(5, int(len(series) * 0.15))):
            logical_type = "categorical"
        else:
            logical_type = "text"

        min_value = max_value = None
        if is_numeric or is_datetime:
            non_null = series.dropna()
            if not non_null.empty:
                min_value = json_value(non_null.min())
                max_value = json_value(non_null.max())

        variables.append(
            VariableMetadata(
                name=name,
                ordinal_position=position,
                logical_type=logical_type,
                physical_type=str(series.dtype),
                nullable=missing_count > 0,
                missing_count=missing_count,
                distinct_count=distinct_count,
                sample_values=samples,
                min_value=min_value,
                max_value=max_value,
            )
        )
    return variables
