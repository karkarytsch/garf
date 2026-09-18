from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import HTTPException


class DatasetRepository:
    """Provide filesystem persistence for Garf datasets.

    Args:
        root: optional storage directory passed to the constructor.

    This is the persistence boundary for the current local application. It
    manages the JSON registry and each dataset's directory while services own
    the higher-level import, variable, preview, and analysis workflows.
    """

    def __init__(self, root: Path | None = None) -> None:
        """Initialize dataset storage and create the registry if required.

        Args:
            root: storage directory for tests or a custom local installation.
                When omitted, uses ``GARF_STORAGE_DIR`` or ``data``.
        """
        self.root = root or Path(os.getenv("GARF_STORAGE_DIR", "data"))
        self.datasets_dir = self.root / "datasets"
        self.registry_path = self.root / "datasets.json"
        self.datasets_dir.mkdir(parents=True, exist_ok=True)
        if not self.registry_path.exists():
            self.registry_path.write_text("{}", encoding="utf-8")

    def get_registry(self) -> dict[str, dict[str, Any]]:
        """Read all dataset metadata records from the JSON registry.

        The records point to canonical Parquet files, allowing services to
        list dataset summaries without reading each complete dataframe.
        """
        return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def save_registry(self, registry: dict[str, dict[str, Any]]) -> None:
        """Write the complete dataset metadata registry to disk.

        Args:
            registry: full mapping of dataset identifiers to metadata records.
        """
        self.registry_path.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    def get_record(self, dataset_id: str) -> dict[str, Any]:
        """Return one metadata record or raise the standard 404 error.

        Args:
            dataset_id: identifier of the requested dataset.
        """
        record = self.get_registry().get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        return record

    def create_dataset_dir(self, dataset_id: str) -> Path:
        """Create the directory that holds one dataset's source and Parquet files.

        Args:
            dataset_id: identifier used as the directory name.
        """
        dataset_dir = self.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True)
        return dataset_dir

    def delete_dataset_dir(self, dataset_id: str) -> None:
        """Remove the source upload and canonical data for one dataset.

        Args:
            dataset_id: identifier of the dataset directory to remove.
        """
        shutil.rmtree(self.datasets_dir / dataset_id, ignore_errors=False)

    def read_frame(self, record: dict[str, Any]) -> pd.DataFrame:
        """Load the canonical Parquet dataframe named by a metadata record.

        Args:
            record: dataset metadata containing ``canonical_path``.
        """
        return pd.read_parquet(record["canonical_path"])

    def write_frame(self, record: dict[str, Any], frame: pd.DataFrame) -> None:
        """Replace the canonical Parquet dataframe after a data mutation.

        Args:
            record: dataset metadata containing the destination path.
            frame: updated dataframe to persist.
        """
        frame.to_parquet(record["canonical_path"], index=False)
