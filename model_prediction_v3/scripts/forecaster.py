"""
model_prediction_v2/scripts/forecaster.py
=========================================
Time Series Forecaster for Personal Finance Daily Expenses (v2):
- Feature Engineering:
    * Lags: lag_1, lag_2, lag_3, lag_7, lag_14
    * Rolling stats: rolling_mean_7, rolling_std_7, rolling_mean_14, rolling_mean_30
    * Seasonal harmonics: dow_sin, dow_cos, dom_sin, dom_cos
    * Domain flags: is_weekend, is_bills_window (1-5), is_payday_window (25-30)
- Model: L2-Regularized Ridge Regressor with standard feature scaling
- Recursive Multi-Horizon Forecaster (1 to 30 days) with non-negativity constraint.
"""

import math
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple
import numpy as np


FEATURE_NAMES = [
    "lag_1",
    "lag_2",
    "lag_3",
    "lag_7",
    "lag_14",
    "rolling_mean_7",
    "rolling_std_7",
    "rolling_mean_14",
    "rolling_mean_30",
    "ratio_lag1_rm7",
    "dow_sin",
    "dow_cos",
    "dom_sin",
    "dom_cos",
    "is_weekend",
    "is_bills_window",
    "is_payday_window",
]


def extract_features_for_day(
    history_values: List[float],
    target_dt: datetime,
) -> np.ndarray:
    """
    Extract feature vector for predicting `target_dt` using ONLY history strictly prior to `target_dt`.
    history_values[-1] is the spending on target_dt - 1 day.
    """
    if len(history_values) < 30:
        # Pad with mean or edge value if history is less than 30 days
        pad_size = 30 - len(history_values)
        pad_val = history_values[0] if history_values else 0.0
        padded = [pad_val] * pad_size + list(history_values)
    else:
        padded = list(history_values)

    lag_1 = padded[-1]
    lag_2 = padded[-2]
    lag_3 = padded[-3]
    lag_7 = padded[-7]
    lag_14 = padded[-14]

    w7 = padded[-7:]
    rm7 = float(np.mean(w7))
    rstd7 = float(np.std(w7))

    w14 = padded[-14:]
    rm14 = float(np.mean(w14))

    w30 = padded[-30:]
    rm30 = float(np.mean(w30))

    ratio_lag1_rm7 = (lag_1 / (rm7 + 1e-4)) if rm7 > 1e-4 else 1.0

    dow = target_dt.weekday()
    dom = target_dt.day

    dow_sin = math.sin(2.0 * math.pi * dow / 7.0)
    dow_cos = math.cos(2.0 * math.pi * dow / 7.0)

    dom_sin = math.sin(2.0 * math.pi * dom / 31.0)
    dom_cos = math.cos(2.0 * math.pi * dom / 31.0)

    is_weekend = 1.0 if dow in (5, 6) else 0.0
    is_bills_window = 1.0 if 1 <= dom <= 5 else 0.0
    is_payday_window = 1.0 if 25 <= dom <= 30 else 0.0

    feats = [
        lag_1,
        lag_2,
        lag_3,
        lag_7,
        lag_14,
        rm7,
        rstd7,
        rm14,
        rm30,
        ratio_lag1_rm7,
        dow_sin,
        dow_cos,
        dom_sin,
        dom_cos,
        is_weekend,
        is_bills_window,
        is_payday_window,
    ]
    return np.array(feats, dtype=np.float64)


class RidgeTimeSeriesForecaster:
    def __init__(self, alpha: float = 1.0):
        self.alpha = alpha
        self.weights: np.ndarray = np.array([])
        self.bias: float = 0.0
        self.feature_means: np.ndarray = np.array([])
        self.feature_stds: np.ndarray = np.array([])

    def fit(self, X: np.ndarray, y: np.ndarray):
        X = np.asarray(X, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)

        # Standardize features
        self.feature_means = np.mean(X, axis=0)
        self.feature_stds = np.std(X, axis=0)
        self.feature_stds[self.feature_stds < 1e-6] = 1.0

        X_scaled = (X - self.feature_means) / self.feature_stds
        N, D = X_scaled.shape

        # Add intercept column
        X_design = np.column_stack([np.ones(N, dtype=np.float64), X_scaled])

        # Regularization matrix (do not regularize intercept)
        reg_matrix = np.eye(D + 1, dtype=np.float64) * self.alpha
        reg_matrix[0, 0] = 0.0

        # Normal equation: w = (X^T X + alpha*I)^{-1} X^T y
        A = X_design.T @ X_design + reg_matrix
        b = X_design.T @ y
        w_sol = np.linalg.solve(A, b)

        self.bias = float(w_sol[0])
        self.weights = w_sol[1:]

    def predict_one_step(self, x: np.ndarray) -> float:
        x_scaled = (x - self.feature_means) / self.feature_stds
        pred = self.bias + float(np.dot(x_scaled, self.weights))
        return max(0.0, pred)  # Spending is non-negative

    def forecast_recursive(
        self,
        history: List[Dict[str, Any]],
        horizon: int = 30,
    ) -> List[Dict[str, Any]]:
        """
        Walk-forward recursive prediction for `horizon` future days.
        Each day's prediction is added to the simulated history for subsequent lag calculation.
        """
        sorted_hist = sorted(history, key=lambda r: r["date"])
        last_date_str = sorted_hist[-1]["date"]
        curr_dt = datetime.strptime(last_date_str, "%Y-%m-%d")

        sim_values = [float(r["daily_spending"]) for r in sorted_hist]

        forecasts = []
        for _ in range(horizon):
            curr_dt += timedelta(days=1)
            x = extract_features_for_day(sim_values, curr_dt)
            y_pred = self.predict_one_step(x)
            sim_values.append(y_pred)
            forecasts.append({
                "date": curr_dt.strftime("%Y-%m-%d"),
                "predicted_spending": round(y_pred, 2),
            })

        return forecasts
