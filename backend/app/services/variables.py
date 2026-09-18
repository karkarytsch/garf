from __future__ import annotations

import pandas as pd
from fastapi import HTTPException

from app.dataframe.profiling import profile_frame
from app.schemas import DatasetSummary, VariableMetadata
from app.storage.datasets import DatasetRepository


class VariableService:
    def __init__(self, repository: DatasetRepository) -> None:
        self.repository = repository

    def list_variables(self, dataset_id: str) -> list[VariableMetadata]:
        return DatasetSummary.model_validate(self.repository.get_record(dataset_id)).variables

    def delete_variable(self, dataset_id: str, variable_name: str) -> DatasetSummary:
        registry = self.repository.get_registry()
        record = registry.get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")

        frame = self.repository.read_frame(record)
        if variable_name not in frame.columns:
            raise HTTPException(status_code=404, detail="Variable not found.")
        if len(frame.columns) == 1:
            raise HTTPException(status_code=422, detail="A dataset must retain at least one variable.")

        frame = frame.drop(columns=[variable_name])
        self.repository.write_frame(record, frame)
        record["column_count"] = len(frame.columns)
        record["variables"] = [variable.model_dump(mode="json") for variable in profile_frame(frame)]
        registry[dataset_id] = record
        self.repository.save_registry(registry)
        return DatasetSummary.model_validate(record)

    def rename_variable(self, dataset_id: str, variable_name: str, new_name: str) -> DatasetSummary:
        registry = self.repository.get_registry()
        record = registry.get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")

        cleaned_name = new_name.strip()
        if not cleaned_name:
            raise HTTPException(status_code=422, detail="Enter a variable name.")
        frame = self.repository.read_frame(record)
        if variable_name not in frame.columns:
            raise HTTPException(status_code=404, detail="Variable not found.")
        if cleaned_name != variable_name and cleaned_name in frame.columns:
            raise HTTPException(status_code=422, detail="A variable with this name already exists.")
        if cleaned_name == variable_name:
            return DatasetSummary.model_validate(record)

        frame = frame.rename(columns={variable_name: cleaned_name})
        self.repository.write_frame(record, frame)
        record["variables"] = [variable.model_dump(mode="json") for variable in profile_frame(frame)]
        record["date_only_columns"] = [cleaned_name if name == variable_name else name for name in record.get("date_only_columns", [])]
        registry[dataset_id] = record
        self.repository.save_registry(registry)
        return DatasetSummary.model_validate(record)

    def set_date_only_display(self, dataset_id: str, column: str) -> None:
        registry = self.repository.get_registry()
        record = registry.get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        frame = self.repository.read_frame(record)
        if column not in frame.columns or not pd.api.types.is_datetime64_any_dtype(frame[column]):
            raise HTTPException(status_code=422, detail="Choose a detected date column.")
        date_only_columns = set(record.get("date_only_columns", []))
        date_only_columns.add(column)
        record["date_only_columns"] = sorted(date_only_columns)
        registry[dataset_id] = record
        self.repository.save_registry(registry)
