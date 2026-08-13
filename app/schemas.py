from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


LogicalType = Literal["numeric", "datetime", "boolean", "categorical", "text"]


class VariableMetadata(BaseModel):
    name: str
    ordinal_position: int = Field(ge=0)
    logical_type: LogicalType
    physical_type: str
    nullable: bool
    missing_count: int = Field(ge=0)
    distinct_count: int = Field(ge=0)
    sample_values: list[Any]
    min_value: Any | None = None
    max_value: Any | None = None
    is_time_candidate: bool
    is_numeric_candidate: bool


class DatasetSummary(BaseModel):
    id: str
    original_filename: str
    source_format: Literal["csv", "xlsx", "parquet"]
    row_count: int = Field(ge=0)
    column_count: int = Field(ge=0)
    variables: list[VariableMetadata]
    created_at: datetime


FilterOperator = Literal[
    "equals", "not_equals", "contains", "greater_than", "less_than", "between", "before", "after", "is_missing", "is_not_missing"
]


class PreviewFilter(BaseModel):
    column: str = Field(min_length=1)
    operator: FilterOperator
    value: str | None = None
    second_value: str | None = None


class FilteredPreviewRequest(BaseModel):
    filters: list[PreviewFilter] = Field(default_factory=list, max_length=20)
    sort_column: str | None = None
    sort_descending: bool = False
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=1000, ge=1, le=1000)


class DatasetPreview(BaseModel):
    dataset_id: str
    columns: list[str]
    rows: list[dict[str, Any]]
    source_row_numbers: list[int] = Field(default_factory=list)
    offset: int = Field(ge=0)
    limit: int = Field(ge=1)
    total_rows: int = Field(ge=0)
    date_format_suggestions: list[str] = Field(default_factory=list)


class DateDisplayRequest(BaseModel):
    column: str = Field(min_length=1)


class RenameVariableRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    new_name: str = Field(min_length=1, max_length=255)
