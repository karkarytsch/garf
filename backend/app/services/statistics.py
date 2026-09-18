from __future__ import annotations

from typing import Any

from app.dataframe.filtering import apply_filters
from app.dataframe.profiling import json_value, profile_frame
from app.schemas import PreviewFilter
from app.storage.datasets import DatasetRepository


class DescriptiveStatisticsService:
    """Calculate descriptive statistics for a dataset or filtered subset.

    Args:
        repository: filesystem adapter supplied during service construction.

    This service is the first analysis-focused boundary in the backend. It
    shares filtering with previews so users can connect a visible data subset
    to its numeric summaries and categorical modes.
    """

    def __init__(self, repository: DatasetRepository) -> None:
        """Initialize the service with its calculation data dependency.

        Args:
            repository: filesystem adapter used to load canonical dataframes.
        """
        self.repository = repository

    def calculate(self, dataset_id: str, filters: list[PreviewFilter] | None = None) -> list[dict[str, Any]]:
        """Calculate per-variable descriptive statistics after optional filters.

        Args:
            dataset_id: identifier of the dataset to analyze.
            filters: optional preview-compatible rules that select rows first.

        Numeric variables receive common distribution measures. Other variable
        types receive their most frequent non-missing value.
        """
        record = self.repository.get_record(dataset_id)
        frame = self.repository.read_frame(record)
        if filters:
            frame = apply_filters(frame, filters)

        results: list[dict[str, Any]] = []
        for variable in profile_frame(frame):
            series = frame[variable.name]
            result: dict[str, Any] = {
                "variable": variable.name,
                "type": variable.logical_type,
                "observations": int(series.notna().sum()),
                "missing": int(series.isna().sum()),
                "distinct": int(series.nunique(dropna=True)),
            }
            if variable.logical_type == "numeric":
                numeric = series.dropna().astype(float)
                result.update({
                    "mean": json_value(numeric.mean()) if not numeric.empty else None,
                    "std_dev": json_value(numeric.std(ddof=1)) if len(numeric) > 1 else None,
                    "min": json_value(numeric.min()) if not numeric.empty else None,
                    "p25": json_value(numeric.quantile(.25)) if not numeric.empty else None,
                    "median": json_value(numeric.median()) if not numeric.empty else None,
                    "p75": json_value(numeric.quantile(.75)) if not numeric.empty else None,
                    "max": json_value(numeric.max()) if not numeric.empty else None,
                })
            else:
                non_null = series.dropna()
                mode = non_null.mode()
                result["mode"] = json_value(mode.iloc[0]) if not mode.empty else None
            results.append(result)
        return results
