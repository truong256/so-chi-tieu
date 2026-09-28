"""
model_prediction_v2/scripts/predict.py
======================================
Inference engine for model_prediction_v2.
- Designed to dynamically receive ANY user's historical daily spending list.
- Does NOT rely on a static global history_data.csv.
- Returns multi-horizon recursive forecasts (1 to 30 days).

Usage:
    from model_prediction_v2.scripts.predict import DailyExpenseForecaster
    engine = DailyExpenseForecaster()
    result = engine.forecast(history=[{"date": "2026-08-01", "amount": 150000}, ...], horizon=30)
"""

import sys
import json
import pickle
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional
import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from forecaster import RidgeTimeSeriesForecaster, extract_features_for_day, FEATURE_NAMES

MODELS_DIR = SCRIPTS_DIR.parent / "models"


class DailyExpenseForecaster:
    def __init__(self, models_dir: Path = MODELS_DIR):
        model_file = models_dir / "forecaster_model.pkl"
        if not model_file.exists():
            raise FileNotFoundError(f"Trained forecaster artifact not found at {model_file}")

        with open(model_file, "rb") as f:
            bundle = pickle.load(f)

        self.alpha = bundle["alpha"]
        self.feature_names = bundle["feature_names"]

        self.model = RidgeTimeSeriesForecaster(alpha=self.alpha)
        self.model.weights = bundle["weights"]
        self.model.bias = bundle["bias"]
        self.model.feature_means = bundle["feature_means"]
        self.model.feature_stds = bundle["feature_stds"]

    def forecast(
        self,
        history: List[Dict[str, Any]],
        horizon: int = 30,
    ) -> Dict[str, Any]:
        """
        Dynamically forecast for any user.
        history format: list of dicts with 'date' ('YYYY-MM-DD') and 'amount' or 'daily_spending'.
        """
        if not history:
            return {
                "success": False,
                "error": "Historical daily expenses list is empty.",
                "forecast": [],
            }

        # Normalize key names: support both 'amount' and 'daily_spending'
        normalized_hist = []
        for r in history:
            if "date" not in r:
                continue
            amt = float(r.get("amount", r.get("daily_spending", 0.0)))
            normalized_hist.append({
                "date": str(r["date"])[:10],
                "daily_spending": max(0.0, amt),
            })

        if not normalized_hist:
            return {
                "success": False,
                "error": "No valid date/amount records found in history.",
                "forecast": [],
            }

        # Sort chronologically
        normalized_hist.sort(key=lambda x: x["date"])

        # Check history length
        if len(normalized_hist) < 7:
            # Fallback for cold start / insufficient history: naive repeat of average
            avg_val = float(np.mean([r["daily_spending"] for r in normalized_hist]))
            last_date = datetime.strptime(normalized_hist[-1]["date"], "%Y-%m-%d")
            fallback_forecast = []
            for i in range(horizon):
                curr = last_date + timedelta(days=i + 1)
                fallback_forecast.append({
                    "date": curr.strftime("%Y-%m-%d"),
                    "predicted_spending": round(avg_val, 2),
                })
            return {
                "success": True,
                "mode": "cold_start_fallback",
                "days_history": len(normalized_hist),
                "forecast": fallback_forecast,
            }

        # Run recursive walk-forward prediction
        forecasts = self.model.forecast_recursive(normalized_hist, horizon=horizon)

        total_predicted = sum(r["predicted_spending"] for r in forecasts)

        return {
            "success": True,
            "mode": "recursive_v2",
            "days_history": len(normalized_hist),
            "horizon_days": horizon,
            "total_predicted_spending": round(total_predicted, 2),
            "forecast": forecasts,
        }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Forecast daily spending.")
    parser.add_argument("--history-file", type=str, help="Path to json file containing daily history")
    parser.add_argument("--horizon", type=int, default=30)
    args = parser.parse_args()

    engine = DailyExpenseForecaster()

    if args.history_file:
        with open(args.history_file, "r") as f:
            hist = json.load(f)
    else:
        # Default test using sample data
        data_file = SCRIPTS_DIR.parent / "data" / "val.json"
        with open(data_file, "r") as f:
            hist = json.load(f)[-45:]  # Last 45 days of val

    res = engine.forecast(hist, horizon=args.horizon)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
