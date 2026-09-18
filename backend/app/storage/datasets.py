from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import HTTPException


class DatasetRepository:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or Path(os.getenv("GARF_STORAGE_DIR", "data"))
        self.datasets_dir = self.root / "datasets"
        self.registry_path = self.root / "datasets.json"
        self.datasets_dir.mkdir(parents=True, exist_ok=True)
        if not self.registry_path.exists():
            self.registry_path.write_text("{}", encoding="utf-8")

    def get_registry(self) -> dict[str, dict[str, Any]]:
        return json.loads(self.registry_path.read_text(encoding="utf-8"))

    def save_registry(self, registry: dict[str, dict[str, Any]]) -> None:
        self.registry_path.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    def get_record(self, dataset_id: str) -> dict[str, Any]:
        record = self.get_registry().get(dataset_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Dataset not found.")
        return record

    def create_dataset_dir(self, dataset_id: str) -> Path:
        dataset_dir = self.datasets_dir / dataset_id
        dataset_dir.mkdir(parents=True)
        return dataset_dir

    def delete_dataset_dir(self, dataset_id: str) -> None:
        shutil.rmtree(self.datasets_dir / dataset_id, ignore_errors=False)

    def read_frame(self, record: dict[str, Any]) -> pd.DataFrame:
        return pd.read_parquet(record["canonical_path"])

    def write_frame(self, record: dict[str, Any], frame: pd.DataFrame) -> None:
        frame.to_parquet(record["canonical_path"], index=False)
