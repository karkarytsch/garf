from __future__ import annotations

import json
import os
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
from fastapi import HTTPException, UploadFile

from app.schemas import DatasetPreview, DatasetSummary, PreviewFilter, VariableMetadata

SUPPORTED_SUFFIXES = {".csv": "csv", ".xlsx": "xlsx", ".parquet": "parquet"}
DATE_NAME_PATTERN = re.compile(r"(?:date|time|year|month|quarter|week|day)", re.IGNORECASE)


def _json_value(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _sanitize_columns(frame: pd.DataFrame) -> pd.DataFrame:
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


def _infer_datetime(series: pd.Series, name: str) -> pd.Series | None:
    if pd.api.types.is_datetime64_any_dtype(series):
        return series
    if not DATE_NAME_PATTERN.search(name) or pd.api.types.is_numeric_dtype(series):
        return None
    non_null = series.dropna()
    if non_null.empty:
        return None
    parsed = pd.to_datetime(non_null, errors="coerce")
    if parsed.notna().mean() >= 0.9:
        result = pd.to_datetime(series, errors="coerce")
        return result
    return None


def normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    frame = _sanitize_columns(frame)
    for name in frame.columns:
        inferred = _infer_datetime(frame[name], name)
        if inferred is not None:
            frame[name] = inferred
    return frame


def profile_frame(frame: pd.DataFrame) -> list[VariableMetadata]:
    variables: list[VariableMetadata] = []
    for position, name in enumerate(frame.columns):
        series = frame[name]
        missing_count = int(series.isna().sum())
        distinct_count = int(series.nunique(dropna=True))
        samples = [_json_value(value) for value in series.dropna().head(5).tolist()]
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
                min_value = _json_value(non_null.min())
                max_value = _json_value(non_null.max())

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
                is_time_candidate=is_datetime,
                is_numeric_candidate=is_numeric,
            )
        )
    return variables


class DatasetStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(os.getenv("GARF_STORAGE_DIR", "data"))
        self.datasets_dir = self.root / "datasets"
        self.registry_path = self.root / "datasets.json"
        self.datasets_dir.mkdir(parents=True, exist_ok=True)
        if not self.registry_path.exists():
            self.registry_path.write_text("{}", encoding="utf-8")

    def _registry(self) -> dict[str, dict[str, Any]]:
        return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def _save_registry(self, registry: dict[str, dict[str, Any]]) -> None:
        self.registry_path.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    def _read_source(self, path: Path, source_format: str) -> pd.DataFrame:
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

    async def import_upload(self, upload: UploadFile) -> DatasetSummary:
        filename = upload.filename or "dataset"
        suffix = Path(filename).suffix.lower()
        source_format = SUPPORTED_SUFFIXES.get(suffix)
        if source_format is None:
            raise HTTPException(status_code=415, detail="Supported formats are CSV, XLSX, and Parquet.")

        dataset_id = str(uuid4())
        dataset_dir = self.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True)
        original_path = dataset_dir / f"source{suffix}"
        with original_path.open("wb") as destination:
            shutil.copyfileobj(upload.file, destination)

        try:
            frame = normalize_frame(self._read_source(original_path, source_format))
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
        variables = profile_frame(frame)
        created_at = datetime.now(UTC)
        record = {
            "id": dataset_id,
            "original_filename": filename,
            "source_format": source_format,
            "row_count": len(frame),
            "column_count": len(frame.columns),
            "variables": [variable.model_dump(mode="json") for variable in variables],
            "created_at": created_at.isoformat(),
            "canonical_path": str(canonical_path),
        }
        registry = self._registry()
        registry[dataset_id] = record
        self._save_registry(registry)
        return DatasetSummary.model_validate(record)

    def list_summaries(self) -> list[DatasetSummary]:
        records = self._registry().values()
        sorted_records = sorted(records, key=lambda record: record["created_at"], reverse=True)
        return [DatasetSummary.model_validate(record) for record in sorted_records]

    def get_summary(self, dataset_id: str) -> DatasetSummary:
        record = self._registry().get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        return DatasetSummary.model_validate(record)

    def delete(self, dataset_id: str) -> None:
        registry = self._registry()
        if dataset_id not in registry:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        shutil.rmtree(self.datasets_dir / dataset_id, ignore_errors=False)
        del registry[dataset_id]
        self._save_registry(registry)

    def delete_variable(self, dataset_id: str, variable_name: str) -> DatasetSummary:
        registry = self._registry()
        record = registry.get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")

        frame = pd.read_parquet(record["canonical_path"])
        if variable_name not in frame.columns:
            raise HTTPException(status_code=404, detail="Variable not found.")
        if len(frame.columns) == 1:
            raise HTTPException(status_code=422, detail="A dataset must retain at least one variable.")

        frame = frame.drop(columns=[variable_name])
        frame.to_parquet(record["canonical_path"], index=False)
        record["column_count"] = len(frame.columns)
        record["variables"] = [variable.model_dump(mode="json") for variable in profile_frame(frame)]
        registry[dataset_id] = record
        self._save_registry(registry)
        return DatasetSummary.model_validate(record)

    def descriptive_statistics(self, dataset_id: str, filters: list[PreviewFilter] | None = None) -> list[dict[str, Any]]:
        record = self._registry().get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        frame = pd.read_parquet(record["canonical_path"])
        if filters:
            frame = self._apply_filters(frame, filters)

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
                    "mean": _json_value(numeric.mean()) if not numeric.empty else None,
                    "std_dev": _json_value(numeric.std(ddof=1)) if len(numeric) > 1 else None,
                    "min": _json_value(numeric.min()) if not numeric.empty else None,
                    "p25": _json_value(numeric.quantile(.25)) if not numeric.empty else None,
                    "median": _json_value(numeric.median()) if not numeric.empty else None,
                    "p75": _json_value(numeric.quantile(.75)) if not numeric.empty else None,
                    "max": _json_value(numeric.max()) if not numeric.empty else None,
                })
            else:
                non_null = series.dropna()
                mode = non_null.mode()
                result["mode"] = _json_value(mode.iloc[0]) if not mode.empty else None
            results.append(result)
        return results

    def rename_variable(self, dataset_id: str, variable_name: str, new_name: str) -> DatasetSummary:
        registry = self._registry()
        record = registry.get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")

        cleaned_name = new_name.strip()
        if not cleaned_name:
            raise HTTPException(status_code=422, detail="Enter a variable name.")
        frame = pd.read_parquet(record["canonical_path"])
        if variable_name not in frame.columns:
            raise HTTPException(status_code=404, detail="Variable not found.")
        if cleaned_name != variable_name and cleaned_name in frame.columns:
            raise HTTPException(status_code=422, detail="A variable with this name already exists.")
        if cleaned_name == variable_name:
            return DatasetSummary.model_validate(record)

        frame = frame.rename(columns={variable_name: cleaned_name})
        frame.to_parquet(record["canonical_path"], index=False)
        record["variables"] = [variable.model_dump(mode="json") for variable in profile_frame(frame)]
        record["date_only_columns"] = [cleaned_name if name == variable_name else name for name in record.get("date_only_columns", [])]
        registry[dataset_id] = record
        self._save_registry(registry)
        return DatasetSummary.model_validate(record)

    def set_date_only_display(self, dataset_id: str, column: str) -> None:
        registry = self._registry()
        record = registry.get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        frame = pd.read_parquet(record["canonical_path"])
        if column not in frame.columns or not pd.api.types.is_datetime64_any_dtype(frame[column]):
            raise HTTPException(status_code=422, detail="Choose a detected date column.")
        date_only_columns = set(record.get("date_only_columns", []))
        date_only_columns.add(column)
        record["date_only_columns"] = sorted(date_only_columns)
        registry[dataset_id] = record
        self._save_registry(registry)

    def _apply_filters(self, frame: pd.DataFrame, filters: list[PreviewFilter]) -> pd.DataFrame:
        filtered = frame
        for rule in filters:
            if rule.column not in filtered.columns:
                raise HTTPException(status_code=422, detail=f"Unknown filter column: {rule.column}")
            series = filtered[rule.column]
            operator = rule.operator
            if operator == "is_missing":
                mask = series.isna()
            elif operator == "is_not_missing":
                mask = series.notna()
            elif pd.api.types.is_numeric_dtype(series) and not pd.api.types.is_bool_dtype(series):
                try:
                    value = float(rule.value or "")
                    second_value = float(rule.second_value or "") if operator == "between" else None
                except ValueError as error:
                    raise HTTPException(status_code=422, detail=f"Enter a numeric value for {rule.column}.") from error
                mask = {"equals": series.eq(value), "not_equals": series.ne(value), "greater_than": series.gt(value), "less_than": series.lt(value)}.get(operator)
                if operator == "between":
                    if second_value is None:
                        raise HTTPException(status_code=422, detail=f"Enter both values for {rule.column}.")
                    mask = series.between(value, second_value)
            elif pd.api.types.is_datetime64_any_dtype(series):
                try:
                    value = pd.Timestamp(rule.value) if rule.value else None
                    second_value = pd.Timestamp(rule.second_value) if operator == "between" and rule.second_value else None
                except (TypeError, ValueError) as error:
                    raise HTTPException(status_code=422, detail=f"Enter a valid date for {rule.column}.") from error
                mask = {"equals": series.eq(value), "not_equals": series.ne(value), "before": series.lt(value), "after": series.gt(value)}.get(operator)
                if operator == "between":
                    if second_value is None:
                        raise HTTPException(status_code=422, detail=f"Enter both dates for {rule.column}.")
                    mask = series.between(value, second_value)
            else:
                value = rule.value or ""
                text = series.astype("string")
                mask = {"equals": text.eq(value), "not_equals": text.ne(value), "contains": text.str.contains(value, case=False, regex=False, na=False)}.get(operator)
            if mask is None:
                raise HTTPException(status_code=422, detail=f"{operator.replace('_', ' ')} is not available for {rule.column}.")
            filtered = filtered.loc[mask]
        return filtered

    def preview(self, dataset_id: str, offset: int, limit: int, filters: list[PreviewFilter] | None = None, sort_column: str | None = None, sort_descending: bool = False) -> DatasetPreview:
        self.get_summary(dataset_id)
        record = self._registry()[dataset_id]
        frame = pd.read_parquet(record["canonical_path"])
        filtered_frame = self._apply_filters(frame, filters or [])
        if sort_column == "__row_number__":
            filtered_frame = filtered_frame.sort_index(ascending=not sort_descending, kind="stable")
        elif sort_column is not None:
            if sort_column not in filtered_frame.columns:
                raise HTTPException(status_code=422, detail=f"Unknown sort column: {sort_column}")
            filtered_frame = filtered_frame.sort_values(sort_column, ascending=not sort_descending, kind="stable", na_position="last")
        date_only_columns = set(record.get("date_only_columns", []))
        suggestions = [column for column in filtered_frame.columns if column not in date_only_columns and pd.api.types.is_datetime64_any_dtype(filtered_frame[column]) and not filtered_frame[column].dropna().empty and bool(filtered_frame[column].dropna().eq(filtered_frame[column].dropna().dt.normalize()).all())]
        preview = filtered_frame.iloc[offset : offset + limit].copy()
        source_row_numbers = [int(index) + 1 for index in preview.index.tolist()]
        for column in date_only_columns.intersection(preview.columns):
            if pd.api.types.is_datetime64_any_dtype(preview[column]):
                preview[column] = preview[column].dt.strftime("%Y-%m-%d")
        preview = preview.where(pd.notna(preview), None)
        rows = json.loads(preview.to_json(orient="records", date_format="iso"))
        return DatasetPreview(dataset_id=dataset_id, columns=list(frame.columns), rows=rows, source_row_numbers=source_row_numbers, offset=offset, limit=limit, total_rows=len(filtered_frame), date_format_suggestions=suggestions)
