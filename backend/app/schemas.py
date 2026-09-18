from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


LogicalType = Literal["numeric", "datetime", "boolean", "categorical", "text"]


class VariableMetadata(BaseModel):
    name: str  # variable name in the dataset.
    ordinal_position: int = Field(ge=0)  # zero-based position of the variable.
    logical_type: LogicalType  # inferred analytical type of the variable.
    physical_type: str  # pandas storage type of the variable.
    nullable: bool  # whether the variable contains missing values.
    missing_count: int = Field(ge=0)  # number of missing values.
    distinct_count: int = Field(ge=0)  # number of distinct non-missing values.
    sample_values: list[Any]  # first non-missing values for inspection.
    min_value: Any | None = None  # smallest numeric or datetime value.
    max_value: Any | None = None  # largest numeric or datetime value.
    is_time_candidate: bool  # whether the variable is a datetime value.
    is_numeric_candidate: bool  # whether the variable is numeric.


class DatasetSummary(BaseModel):
    id: str  # unique identifier of the dataset.
    original_filename: str  # filename provided during import.
    source_format: Literal["csv", "xlsx", "parquet"]  # format of the imported file.
    row_count: int = Field(ge=0)  # number of rows in the dataset.
    column_count: int = Field(ge=0)  # number of variables in the dataset.
    variables: list[VariableMetadata]  # metadata for each dataset variable.
    created_at: datetime  # time when the dataset was imported.


FilterOperator = Literal[
    "equals", "not_equals", "contains", "greater_than", "less_than", "between", "before", "after", "is_missing", "is_not_missing"
]


class PreviewFilter(BaseModel):
    column: str = Field(min_length=1)  # variable to filter.
    operator: FilterOperator  # comparison applied to the variable.
    value: str | None = None  # first comparison value.
    second_value: str | None = None  # second value used by range filters.


class FilteredPreviewRequest(BaseModel):
    filters: list[PreviewFilter] = Field(default_factory=list, max_length=20)  # filters combined with logical and.
    sort_column: str | None = None  # variable used to order rows.
    sort_descending: bool = False  # whether rows are ordered descending.
    offset: int = Field(default=0, ge=0)  # zero-based position of the first row.
    limit: int = Field(default=1000, ge=1, le=1000)  # maximum number of rows to return.


class DatasetPreview(BaseModel):
    dataset_id: str  # identifier of the previewed dataset.
    columns: list[str]  # variable names in display order.
    rows: list[dict[str, Any]]  # requested dataset rows.
    source_row_numbers: list[int] = Field(default_factory=list)  # original one-based row numbers.
    offset: int = Field(ge=0)  # zero-based position of the first returned row.
    limit: int = Field(ge=1)  # requested maximum number of rows.
    total_rows: int = Field(ge=0)  # number of rows after filtering.
    date_format_suggestions: list[str] = Field(default_factory=list)  # datetime variables that contain dates only.


class DateDisplayRequest(BaseModel):
    column: str = Field(min_length=1)  # datetime variable displayed without a time.


class RenameVariableRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)  # current variable name.
    new_name: str = Field(min_length=1, max_length=255)  # replacement variable name.
