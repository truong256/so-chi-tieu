"""
model_prediction_v2/scripts/train.py
===================================
Train Time-Series Forecaster (v2):
- Builds feature matrix strictly respecting temporal ordering (no future leakage).
- Hyperparameter tuning (alpha) via Walk-Forward Backtesting on Validation Set.
- Compares against reference baselines:
    1. Naive (last value)
    2. 7-day Moving Average
    3. Same Weekday Average
    4. Seasonal Naive 7-day
- Serializes trained model bundle to model_prediction_v2/models/forecaster_model.pkl
"""

import sys
import json
import pickle
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Tuple
import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from forecaster import RidgeTimeSeriesForecaster, extract_features_for_day, FEATURE_NAMES
from baselines import (
    compute_metrics,
    forecast_naive_last_value,
    forecast_moving_average_7,
    forecast_same_weekday_average,
    forecast_seasonal_naive_7,
)

BASE_DIR = SCRIPTS_DIR.parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
METRICS_DIR = BASE_DIR / "metrics"

MODELS_DIR.mkdir(parents=True, exist_ok=True)
METRICS_DIR.mkdir(parents=True, exist_ok=True)


def build_training_matrix(train_records: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray]:
    """
    Builds X, y matrix for one-step training using strictly prior history.
    """
    values = [float(r["daily_spending"]) for r in train_records]
    dates = [datetime.strptime(r["date"], "%Y-%m-%d") for r in train_records]

    X_list = []
    y_list = []

    # Start at day 30 to allow 30-day warmup for rolling stats
    for t in range(30, len(train_records)):
        history_prior = values[:t]
        target_dt = dates[t]
        feat = extract_features_for_day(history_prior, target_dt)
        X_list.append(feat)
        y_list.append(values[t])

    return np.array(X_list, dtype=np.float64), np.array(y_list, dtype=np.float64)


def run_walk_forward_backtest(
    model: RidgeTimeSeriesForecaster,
    full_history: List[Dict[str, Any]],
    val_records: List[Dict[str, Any]],
    step_days: int = 14,
    horizon: int = 30,
) -> Dict[str, Any]:
    """
    Walk-forward backtest across validation period at step intervals:
    At each cutoff, forecasts 1..30 days ahead using ONLY data up to cutoff.
    """
    val_start_date = val_records[0]["date"]
    val_end_date = val_records[-1]["date"]

    # Candidate cutoffs inside validation window
    val_dt_start = datetime.strptime(val_start_date, "%Y-%m-%d")
    val_dt_end = datetime.strptime(val_end_date, "%Y-%m-%d") - timedelta(days=horizon)

    cutoffs = []
    curr = val_dt_start
    while curr <= val_dt_end:
        cutoffs.append(curr.strftime("%Y-%m-%d"))
        curr += timedelta(days=step_days)

    methods = ["model", "naive_last", "ma_7", "same_weekday", "seasonal_naive_7"]
    horizon_buckets = [1, 7, 14, 30]

    # Store errors per method and per horizon bucket
    results: Dict[str, Dict[int, Dict[str, List[float]]]] = {
        m: {h: {"y_true": [], "y_pred": []} for h in horizon_buckets}
        for m in methods
    }

    full_dict = {r["date"]: r for r in full_history}

    for cutoff in cutoffs:
        cutoff_dt = datetime.strptime(cutoff, "%Y-%m-%d")
        hist_up_to_cutoff = [r for r in full_history if r["date"] <= cutoff]
        hist_values = [float(r["daily_spending"]) for r in hist_up_to_cutoff]

        # Target 30 future dates
        target_dates = [
            (cutoff_dt + timedelta(days=i + 1)).strftime("%Y-%m-%d")
            for i in range(horizon)
        ]
        actuals = [float(full_dict[d]["daily_spending"]) for d in target_dates]

        # Predictions for each method
        pred_model_dict = model.forecast_recursive(hist_up_to_cutoff, horizon=horizon)
        pred_model = [r["predicted_spending"] for r in pred_model_dict]

        pred_naive = forecast_naive_last_value(hist_values, horizon=horizon)
        pred_ma7 = forecast_moving_average_7(hist_values, horizon=horizon)
        pred_weekday = forecast_same_weekday_average(hist_up_to_cutoff, target_dates)
        pred_s_naive = forecast_seasonal_naive_7(hist_values, horizon=horizon)

        preds_map = {
            "model": pred_model,
            "naive_last": pred_naive,
            "ma_7": pred_ma7,
            "same_weekday": pred_weekday,
            "seasonal_naive_7": pred_s_naive,
        }

        for m in methods:
            for h in horizon_buckets:
                results[m][h]["y_true"].extend(actuals[:h])
                results[m][h]["y_pred"].extend(preds_map[m][:h])

    # Compute metrics summary
    summary = {}
    for m in methods:
        summary[m] = {}
        for h in horizon_buckets:
            y_t = np.array(results[m][h]["y_true"])
            y_p = np.array(results[m][h]["y_pred"])
            summary[m][f"h_{h}"] = compute_metrics(y_t, y_p)

    return summary


def main():
    print("=" * 80)
    print("   MODEL_PREDICTION V2 TRAINING & WALK-FORWARD VALIDATION")
    print("=" * 80)

    with open(DATA_DIR / "train.json", "r", encoding="utf-8") as f:
        train_records = json.load(f)
    with open(DATA_DIR / "val.json", "r", encoding="utf-8") as f:
        val_records = json.load(f)
    with open(DATA_DIR / "full_series.json", "r", encoding="utf-8") as f:
        full_series = json.load(f)

    print(f"Train series: {len(train_records)} days ({train_records[0]['date']} to {train_records[-1]['date']})")
    print(f"Val series:   {len(val_records)} days ({val_records[0]['date']} to {val_records[-1]['date']})")

    # 1. Build Training Set
    X_train, y_train = build_training_matrix(train_records)
    print(f"Constructed X_train: {X_train.shape}, y_train: {y_train.shape} (Warmup: 30 days dropped)")

    # 2. Hyperparameter Search on Validation Walk-Forward Backtest
    candidate_alphas = [0.01, 0.1, 1.0, 5.0, 10.0, 50.0]
    best_alpha = 1.0
    best_val_smape = float("inf")
    best_model = None

    print("\n--- Hyperparameter Tuning (Walk-Forward 30-Day Recursive Backtest) ---")
    history_train_val = [r for r in full_series if r["date"] <= val_records[-1]["date"]]

    for alpha in candidate_alphas:
        model = RidgeTimeSeriesForecaster(alpha=alpha)
        model.fit(X_train, y_train)

        val_summary = run_walk_forward_backtest(
            model=model,
            full_history=history_train_val,
            val_records=val_records,
            step_days=14,
            horizon=30,
        )

        h30_smape = val_summary["model"]["h_30"]["smape"]
        h30_mae = val_summary["model"]["h_30"]["mae"]
        print(f"  • alpha={alpha:<5} -> 30-Day Recursive: sMAPE={h30_smape:.2f}%, MAE={h30_mae:,.0f} VND")

        if h30_smape < best_val_smape:
            best_val_smape = h30_smape
            best_alpha = alpha
            best_model = model

    print(f"\n✔ Selected best alpha: {best_alpha} (Validation 30-Day sMAPE: {best_val_smape:.2f}%)")

    # 3. Baseline Comparison on Validation Set
    val_summary = run_walk_forward_backtest(
        model=best_model,
        full_history=history_train_val,
        val_records=val_records,
        step_days=14,
        horizon=30,
    )

    print("\n--- Baseline Comparison on Validation Set (30-Day Horizon) ---")
    header = f"{'Method':<20} | {'MAE':<12} | {'RMSE':<12} | {'sMAPE':<10} | {'WAPE':<10}"
    print(header)
    print("-" * len(header))
    for m in ["model", "seasonal_naive_7", "same_weekday", "ma_7", "naive_last"]:
        met = val_summary[m]["h_30"]
        print(f"{m:<20} | {met['mae']:<12,.0f} | {met['rmse']:<12,.0f} | {met['smape']:<9.2f}% | {met['wape']:<9.2f}%")

    # 4. Serialize Model Artifacts
    bundle = {
        "alpha": best_alpha,
        "weights": best_model.weights,
        "bias": best_model.bias,
        "feature_means": best_model.feature_means,
        "feature_stds": best_model.feature_stds,
        "feature_names": FEATURE_NAMES,
    }
    with open(MODELS_DIR / "forecaster_model.pkl", "wb") as f:
        pickle.dump(bundle, f)

    metadata = {
        "model_name": "model_prediction_v2",
        "approach": "Pure NumPy L2-Regularized Ridge Time-Series Forecaster",
        "features": FEATURE_NAMES,
        "best_alpha": best_alpha,
        "train_days": len(train_records),
        "val_days": len(val_records),
        "val_30d_smape": best_val_smape,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(MODELS_DIR / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n✔ Model bundle saved: {MODELS_DIR / 'forecaster_model.pkl'}")
    print(f"✔ Metadata saved:     {MODELS_DIR / 'metadata.json'}")
    print("=" * 80)


if __name__ == "__main__":
    main()
