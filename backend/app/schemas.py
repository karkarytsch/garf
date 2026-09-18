from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


LogicalType = Literal["numeric", "datetime", "boolean", "categorical", "text"]


class VariableMetadata(BaseModel):
    """Describe one dataset variable for the frontend data workspace.

    Args:
        name: normalized dataset column name.
        ordinal_position: zero-based position of the column.
        logical_type: inferred type used by analytical controls.
        physical_type: pandas storage type of the column.
        nullable: whether the column contains missing values.
        missing_count: number of missing values.
        distinct_count: number of non-missing distinct values.
        sample_values: small sample used for inspection.
        min_value: smallest numeric or datetime value, when available.
        max_value: largest numeric or datetime value, when available.

    Garf creates this profile when a dataset is imported or a variable changes.
    It gives the frontend enough information to label the variable and choose
    suitable controls without loading its entire column.
    """

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


class DatasetSummary(BaseModel):
    """Provide the lightweight metadata needed to identify a saved dataset.

    Args:
        id: unique dataset identifier.
        original_filename: name of the imported source file.
        source_format: source format used during import.
        row_count: number of stored rows.
        column_count: number of stored variables.
        variables: metadata records for all variables.
        created_at: UTC timestamp of dataset creation.
    """

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
    """Describe one rule for selecting rows in a preview or analysis request.

    Args:
        column: variable to inspect.
        operator: supported comparison to apply.
        value: first comparison value, if required by the operator.
        second_value: upper or second comparison value for range operators.
    """

    column: str = Field(min_length=1)  # variable to filter.
    operator: FilterOperator  # comparison applied to the variable.
    value: str | None = None  # first comparison value.
    second_value: str | None = None  # second value used by range filters.


class FilteredPreviewRequest(BaseModel):
    """Collect table-view controls sent from the frontend in one request.

    Args:
        filters: rules used to select rows.
        sort_column: optional variable used to order rows.
        sort_descending: whether the sort order is descending.
        offset: zero-based position of the first requested row.
        limit: maximum number of requested rows.
    """

    filters: list[PreviewFilter] = Field(default_factory=list, max_length=20)  # filters combined with logical and.
    sort_column: str | None = None  # variable used to order rows.
    sort_descending: bool = False  # whether rows are ordered descending.
    offset: int = Field(default=0, ge=0)  # zero-based position of the first row.
    limit: int = Field(default=1000, ge=1, le=1000)  # maximum number of rows to return.


class DatasetPreview(BaseModel):
    """Represent one page of a dataset after its view controls are applied.

    Args:
        dataset_id: identifier of the source dataset.
        columns: variable names in display order.
        rows: JSON-safe row values for the requested page.
        source_row_numbers: original one-based row positions.
        offset: zero-based position of the first returned row.
        limit: requested maximum row count.
        total_rows: row count after filters are applied.
        date_format_suggestions: datetime variables containing dates only.

    This is intentionally a slice rather than a whole dataframe so the browser
    can inspect large datasets without receiving every row at once.
    """

    dataset_id: str  # identifier of the previewed dataset.
    columns: list[str]  # variable names in display order.
    rows: list[dict[str, Any]]  # requested dataset rows.
    source_row_numbers: list[int] = Field(default_factory=list)  # original one-based row numbers.
    offset: int = Field(ge=0)  # zero-based position of the first returned row.
    limit: int = Field(ge=1)  # requested maximum number of rows.
    total_rows: int = Field(ge=0)  # number of rows after filtering.
    date_format_suggestions: list[str] = Field(default_factory=list)  # datetime variables that contain dates only.


class DateDisplayRequest(BaseModel):
    """Request a date-only display preference for one datetime variable.

    Args:
        column: datetime variable to display without a time component.
    """

    column: str = Field(min_length=1)  # datetime variable displayed without a time.


class RenameVariableRequest(BaseModel):
    """Request a change from an existing variable name to a new name.

    Args:
        name: current variable name.
        new_name: requested replacement name.
    """

    name: str = Field(min_length=1, max_length=255)  # current variable name.
    new_name: str = Field(min_length=1, max_length=255)  # replacement variable name.
