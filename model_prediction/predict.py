"""
model_prediction/predict.py
=============================
Load the trained forecasting model and predict spending for the next 30 days.

Usage:
    from model_prediction.predict import forecast_next_30_days
    results = forecast_next_30_days()
    # [{"date": "2025-01-01", "predicted_spending": 1234.56}, ...]
"""

import json
import logging
from pathlib import Path
from datetime import timedelta

import numpy as np
import pandas as pd
import joblib

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MODULE_DIR = Path(__file__).resolve().parent
MODEL_PATH = MODULE_DIR / "forecaster_model.pkl"
HISTORY_PATH = MODULE_DIR / "history_data.csv"
METADATA_PATH = MODULE_DIR / "metadata.json"

FEATURE_COLS = [
    "lag_1",
    "lag_7",
    "rolling_mean_7",
    "rolling_std_7",
    "rolling_mean_30",
    "day_of_week",
    "day_of_month",
    "month",
    "is_weekend",
]

logger = logging.getLogger(__name__)

# Lazy-loaded singletons
_model = None
_history = None


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------
def _load_artifacts():
    """Load model and historical data."""
    global _model, _history

    if _model is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Model not found: {MODEL_PATH}. Run train.py first."
            )
        _model = joblib.load(MODEL_PATH)
        logger.info("Forecasting model loaded.")

    if _history is None:
        if not HISTORY_PATH.exists():
            raise FileNotFoundError(
                f"History data not found: {HISTORY_PATH}. Run train.py first."
            )
        _history = pd.read_csv(HISTORY_PATH, parse_dates=["date"])
        _history = _history.sort_values("date").reset_index(drop=True)
        logger.info(f"History loaded: {len(_history)} days")

    return _model, _history.copy()


# ---------------------------------------------------------------------------
# Recursive forecasting
# ---------------------------------------------------------------------------
def forecast_next_30_days() -> list:
    """
    Forecast daily spending for the next 30 days using recursive forecasting.

    Each day's prediction is used as input for the next day's features.

    Returns
    -------
    list of dict
        [{"date": "YYYY-MM-DD", "predicted_spending": float}, ...]
        Exactly 30 entries.
    """
    try:
        model, history = _load_artifacts()
    except FileNotFoundError as e:
        return [{"error": str(e)}]

    # Validate history has enough data
    min_required_days = 30  # For rolling_mean_30
    if len(history) < min_required_days:
        return [{
            "error": f"Insufficient historical data: {len(history)} days "
                     f"(minimum {min_required_days} required)"
        }]

    # Start forecasting from the day after the last historical date
    last_date = history["date"].max()
    forecasts = []

    # Working copy of daily spending values for computing lag features
    spending_values = history["daily_spending"].tolist()
    dates = history["date"].tolist()

    for day_offset in range(1, 31):
        forecast_date = last_date + timedelta(days=day_offset)

        # Build features from history + previous predictions
        n = len(spending_values)

        # Lag features
        lag_1 = spending_values[-1] if n >= 1 else 0.0
        lag_7 = spending_values[-7] if n >= 7 else 0.0

        # Rolling statistics (using shifted data to avoid leakage)
        recent_7 = spending_values[-7:] if n >= 7 else spending_values
        recent_30 = spending_values[-30:] if n >= 30 else spending_values

        rolling_mean_7 = float(np.mean(recent_7)) if recent_7 else 0.0
        rolling_std_7 = float(np.std(recent_7)) if len(recent_7) > 1 else 0.0
        rolling_mean_30 = float(np.mean(recent_30)) if recent_30 else 0.0

        # Date features
        day_of_week = forecast_date.weekday()
        day_of_month = forecast_date.day
        month = forecast_date.month
        is_weekend = 1 if day_of_week >= 5 else 0

        # Assemble feature vector
        features = np.array([[
            lag_1,
            lag_7,
            rolling_mean_7,
            rolling_std_7,
            rolling_mean_30,
            day_of_week,
            day_of_month,
            month,
            is_weekend,
        ]])

        # Predict
        predicted = float(model.predict(features)[0])

        # Ensure non-negative spending
        predicted = max(0.0, predicted)

        # Append prediction to history for next iteration
        spending_values.append(predicted)
        dates.append(forecast_date)

        forecasts.append({
            "date": forecast_date.strftime("%Y-%m-%d"),
            "predicted_spending": round(predicted, 2),
        })

    return forecasts


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    results = forecast_next_30_days()

    print("\n=== Spending Forecast — Next 30 Days ===\n")

    if results and "error" in results[0]:
        print(f"ERROR: {results[0]['error']}")
    else:
        total = 0.0
        for r in results:
            total += r["predicted_spending"]
            print(f"  {r['date']}  →  ${r['predicted_spending']:>10,.2f}")
        print(f"\n  {'Total':>10s}      →  ${total:>10,.2f}")
        print(f"  {'Average':>10s}      →  ${total / 30:>10,.2f}")
        print(f"\n  Forecast count: {len(results)} days")

    # Also dump as JSON
    print("\nJSON output:")
    print(json.dumps(results, indent=2))
