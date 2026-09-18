from __future__ import annotations

import re

import pandas as pd


DATE_NAME_PATTERN = re.compile(r"(?:date|time|year|month|quarter|week|day)", re.IGNORECASE)


def sanitize_columns(frame: pd.DataFrame) -> pd.DataFrame:
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
    frame = sanitize_columns(frame)
    for name in frame.columns:
        inferred = infer_datetime(frame[name], name)
        if inferred is not None:
            frame[name] = inferred
    return frame
