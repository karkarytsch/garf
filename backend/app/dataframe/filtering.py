from __future__ import annotations

import pandas as pd
from fastapi import HTTPException

from app.schemas import PreviewFilter


def apply_filters(frame: pd.DataFrame, filters: list[PreviewFilter]) -> pd.DataFrame:
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
