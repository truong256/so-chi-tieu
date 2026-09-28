"""
model_prediction_v2/scripts/baselines.py
========================================
Reference forecasting baselines and standard time-series evaluation metrics:
1. Naive (last value): y_{t+h} = y_t
2. 7-day Moving Average: y_{t+h} = mean(y_{t-6:t})
3. Same Weekday Average: mean of past values on the same day of the week
4. Seasonal Naive 7-day: y_{t+h} = y_{t - (7 - (h-1)%7 - 1)} (repeating last 7-day cycle)

Metrics:
- MAE: Mean Absolute Error
- RMSE: Root Mean Squared Error
- sMAPE: Symmetric Mean Absolute Percentage Error (0% to 200%)
- WAPE: Weighted Absolute Percentage Error (sum(|e|) / sum(y))
"""

import math
from datetime import datetime, timedelta
from typing import List, Dict, Any
import numpy as np


def compute_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    y_true = np.asarray(y_true, dtype=np.float64)
    y_pred = np.asarray(y_pred, dtype=np.float64)

    # MAE
    mae = float(np.mean(np.abs(y_true - y_pred)))

    # RMSE
    rmse = float(math.sqrt(np.mean((y_true - y_pred) ** 2)))

    # sMAPE
    denom = (np.abs(y_true) + np.abs(y_pred)) / 2.0
    mask = denom > 1e-6
    if np.sum(mask) == 0:
        smape = 0.0
    else:
        smape = float(np.mean(np.abs(y_true[mask] - y_pred[mask]) / denom[mask]) * 100.0)

    # WAPE
    sum_true = float(np.sum(np.abs(y_true)))
    if sum_true < 1e-6:
        wape = 0.0
    else:
        wape = float(np.sum(np.abs(y_true - y_pred)) / sum_true * 100.0)

    return {
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "smape": round(smape, 2),
        "wape": round(wape, 2),
    }


def forecast_naive_last_value(history_values: List[float], horizon: int) -> List[float]:
    last_val = history_values[-1] if history_values else 0.0
    return [float(last_val)] * horizon


def forecast_moving_average_7(history_values: List[float], horizon: int) -> List[float]:
    window = history_values[-7:] if len(history_values) >= 7 else history_values
    avg_val = float(np.mean(window)) if window else 0.0
    return [avg_val] * horizon


def forecast_same_weekday_average(
    history: List[Dict[str, Any]],
    forecast_dates: List[str],
) -> List[float]:
    # Group history by weekday
    weekday_vals: Dict[int, List[float]] = {i: [] for i in range(7)}
    for r in history:
        dt = datetime.strptime(r["date"], "%Y-%m-%d")
        weekday_vals[dt.weekday()].append(float(r["daily_spending"]))

    # Mean per weekday
    weekday_means = {}
    for d, vals in weekday_vals.items():
        weekday_means[d] = float(np.mean(vals[-8:])) if vals else 0.0

    preds = []
    for d_str in forecast_dates:
        dt = datetime.strptime(d_str, "%Y-%m-%d")
        preds.append(weekday_means[dt.weekday()])
    return preds


def forecast_seasonal_naive_7(history_values: List[float], horizon: int) -> List[float]:
    last_7 = history_values[-7:] if len(history_values) >= 7 else history_values
    preds = []
    for step in range(horizon):
        preds.append(float(last_7[step % len(last_7)]))
    return preds
