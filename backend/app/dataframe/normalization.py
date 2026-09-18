from __future__ import annotations

import re

import pandas as pd


DATE_NAME_PATTERN = re.compile(r"(?:date|time|year|month|quarter|week|day)", re.IGNORECASE)


def sanitize_columns(frame: pd.DataFrame) -> pd.DataFrame:
    """Return a dataframe with non-empty, unique column names.

    Args:
        frame: dataframe whose source column names should be normalized.

    Example:
        ``sanitize_columns(pd.DataFrame([[1, 2]], columns=["value", "value"]))``
        produces columns ``["value", "value_2"]``.

    This runs during import because dataset metadata, filters, and frontend
    requests identify variables by their normalized names.
    """
    columns: list[str] = []
    counts: dict[str, int] = {}
    for index, column in enumerate(frame.columns):
        base = str(column).strip() or f"column_{index + 1}"
        count = counts.get(base, 0)
        counts[base] = count + 1
        columns.append(base if count == 0 else f"{base}_{count + 1}")
    result = frame.copy()
    result.columns = columns
    return result


def infer_datetime(series: pd.Series, name: str) -> pd.Series | None:
    """Return parsed datetime values when a column is safely date-like.

    Args:
        series: source column to inspect and possibly convert.
        name: normalized column name used to decide whether date parsing applies.

    Example:
        ``infer_datetime(pd.Series(["2026-01-01"]), "date")`` returns a
        datetime series.

    The importer requires a date-like name and at least 90 percent valid
    values. ``None`` means that the caller should preserve the original series.
    """
    if pd.api.types.is_datetime64_any_dtype(series):
        return series
    if not DATE_NAME_PATTERN.search(name) or pd.api.types.is_numeric_dtype(series):
        return None
    non_null = series.dropna()
    if non_null.empty:
        return None
    parsed = pd.to_datetime(non_null, errors="coerce")
    if parsed.notna().mean() >= 0.9:
        return pd.to_datetime(series, errors="coerce")
    return None


def normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """Normalize an imported dataframe before canonical storage.

    Args:
        frame: dataframe read from an uploaded CSV, XLSX, or Parquet file.

    Example:
        ``normalize_frame(frame)`` replaces unusable headers and converts
        confidently detected date columns before the frame is saved as Parquet.

    DatasetService calls this once during import, before profiling the dataset.
    """
    frame = sanitize_columns(frame)
    for name in frame.columns:
        inferred = infer_datetime(frame[name], name)
        if inferred is not None:
            frame[name] = inferred
    return frame
