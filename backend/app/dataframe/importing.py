from __future__ import annotations

from pathlib import Path

import pandas as pd
from fastapi import HTTPException


SUPPORTED_SUFFIXES = {".csv": "csv", ".xlsx": "xlsx", ".parquet": "parquet"}


def read_source(path: Path, source_format: str) -> pd.DataFrame:
    """Read a supported source file into a dataframe.

    Args:
        path: local path of the uploaded source file.
        source_format: validated format name: ``csv``, ``xlsx``, or ``parquet``.

    Example:
        ``read_source(Path("prices.csv"), "csv")`` reads the CSV into a
        pandas dataframe.

    DatasetService calls this after saving an upload. CSV files use common
    encodings; XLSX and Parquet use their corresponding pandas readers.
    """
    if source_format == "csv":
        last_error: Exception | None = None
        for encoding in ("utf-8-sig", "utf-8", "latin-1"):
            try:
                return pd.read_csv(path, encoding=encoding, sep=None, engine="python")
            except UnicodeDecodeError as error:
                last_error = error
        raise HTTPException(status_code=422, detail=f"Could not decode CSV: {last_error}")
    if source_format == "xlsx":
        return pd.read_excel(path, engine="openpyxl")
    return pd.read_parquet(path)
