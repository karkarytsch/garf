from datetime import UTC, datetime

import pandas as pd

from app.dataframe.filtering import apply_filters
from app.dataframe.normalization import normalize_frame
from app.dataframe.profiling import profile_frame
from app.main import app
from app.schemas import PreviewFilter
from app.services.data_views import DataViewService
from app.services.variables import VariableService
from app.storage.datasets import DatasetRepository


def test_openapi_keeps_existing_api_routes() -> None:
    paths = app.openapi()["paths"]

    assert set(paths) == {
        "/api/health",
        "/api/datasets",
        "/api/datasets/{dataset_id}",
        "/api/datasets/{dataset_id}/variables",
        "/api/datasets/{dataset_id}/descriptive-statistics",
        "/api/datasets/{dataset_id}/date-display",
        "/api/datasets/{dataset_id}/preview/query",
        "/api/datasets/{dataset_id}/preview",
    }
    assert set(paths["/api/datasets"]) == {"get", "post"}
    assert set(paths["/api/datasets/{dataset_id}/variables"]) == {"get", "patch", "delete"}


def test_profile_frame_identifies_numeric_datetime_and_categorical_columns() -> None:
    frame = pd.DataFrame(
        {
            "date": ["2026-01-01", "2026-01-02", "2026-01-03"],
            "price": [1.61, 1.63, 1.62],
            "region": ["Brno", "Brno", "Prague"],
        }
    )

    variables = {variable.name: variable for variable in profile_frame(normalize_frame(frame))}

    assert variables["date"].logical_type == "datetime"
    assert variables["date"].is_time_candidate is True
    assert variables["price"].logical_type == "numeric"
    assert variables["price"].is_numeric_candidate is True
    assert variables["region"].logical_type == "categorical"


def test_normalize_frame_makes_duplicate_and_blank_names_unique() -> None:
    frame = pd.DataFrame([[1, 2, 3]], columns=["value", "value", " "])
    normalized = normalize_frame(frame)

    assert list(normalized.columns) == ["value", "value_2", "column_3"]


def test_delete_variable_updates_saved_dataset_and_metadata(tmp_path) -> None:
    repository = DatasetRepository(tmp_path)
    data_views = DataViewService(repository)
    variables = VariableService(repository)
    dataset_id = "test-dataset"
    dataset_dir = repository.datasets_dir / dataset_id
    dataset_dir.mkdir()
    canonical_path = dataset_dir / "dataset.parquet"
    frame = pd.DataFrame({"date": pd.to_datetime(["2026-01-01", "2026-01-02"]), "price": [1.63, 1.61]})
    frame.to_parquet(canonical_path, index=False)
    repository.save_registry(
        {
            dataset_id: {
                "id": dataset_id,
                "original_filename": "prices.csv",
                "source_format": "csv",
                "row_count": 2,
                "column_count": 2,
                "variables": [item.model_dump(mode="json") for item in profile_frame(frame)],
                "created_at": datetime.now(UTC).isoformat(),
                "canonical_path": str(canonical_path),
            }
        }
    )

    sorted_preview = data_views.preview(dataset_id, 0, 12, sort_column="price")
    assert [row["price"] for row in sorted_preview.rows] == [1.61, 1.63]
    assert sorted_preview.source_row_numbers == [2, 1]
    descending_preview = data_views.preview(dataset_id, 0, 12, sort_column="price", sort_descending=True)
    assert [row["price"] for row in descending_preview.rows] == [1.63, 1.61]
    reverse_observations = data_views.preview(dataset_id, 0, 12, sort_column="__row_number__", sort_descending=True)
    assert reverse_observations.source_row_numbers == [2, 1]

    updated = variables.delete_variable(dataset_id, "price")

    assert updated.column_count == 1
    assert [variable.name for variable in updated.variables] == ["date"]
    assert list(pd.read_parquet(canonical_path).columns) == ["date"]

    assert data_views.preview(dataset_id, 0, 12).date_format_suggestions == ["date"]
    variables.set_date_only_display(dataset_id, "date")
    cleaned_preview = data_views.preview(dataset_id, 0, 12)
    assert cleaned_preview.date_format_suggestions == []
    assert cleaned_preview.rows[0]["date"] == "2026-01-01"


def test_preview_filters_are_combined_with_and(tmp_path) -> None:
    frame = pd.DataFrame({
        "date": pd.to_datetime(["2026-01-01", "2026-02-01", "2026-03-01"]),
        "price": [1.2, 1.8, 2.1],
        "region": ["Brno", "Prague", None],
    })

    filtered = apply_filters(frame, [
        PreviewFilter(column="price", operator="greater_than", value="1.5"),
        PreviewFilter(column="date", operator="before", value="2026-03-01"),
        PreviewFilter(column="region", operator="contains", value="prag"),
    ])

    assert filtered.index.tolist() == [1]
    assert len(apply_filters(frame, [PreviewFilter(column="region", operator="is_missing")])) == 1


def test_rename_variable_updates_parquet_metadata_and_date_display_state(tmp_path) -> None:
    repository = DatasetRepository(tmp_path)
    data_views = DataViewService(repository)
    variables = VariableService(repository)
    dataset_id = "test-rename"
    dataset_dir = repository.datasets_dir / dataset_id
    dataset_dir.mkdir()
    canonical_path = dataset_dir / "dataset.parquet"
    frame = pd.DataFrame({"date": pd.to_datetime(["2026-01-01", "2026-02-01"]), "price": [1.63, 1.61]})
    frame.to_parquet(canonical_path, index=False)
    repository.save_registry({dataset_id: {
        "id": dataset_id, "original_filename": "prices.csv", "source_format": "csv", "row_count": 2,
        "column_count": 2, "variables": [item.model_dump(mode="json") for item in profile_frame(frame)],
        "created_at": datetime.now(UTC).isoformat(), "canonical_path": str(canonical_path), "date_only_columns": ["date"],
    }})

    updated = variables.rename_variable(dataset_id, "date", "month")

    assert [variable.name for variable in updated.variables] == ["month", "price"]
    assert list(pd.read_parquet(canonical_path).columns) == ["month", "price"]
    assert data_views.preview(dataset_id, 0, 10).rows[0]["month"] == "2026-01-01"
