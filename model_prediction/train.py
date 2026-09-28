"""
model_prediction/train.py
===========================
Train a time-series forecasting model (XGBoost) to predict
daily spending for the next 30 days.

Dataset: data_prediction/Personal_Finance_Dataset.csv
  - Date: transaction date (YYYY-MM-DD)
  - Amount: transaction amount
  - Type: Expense / Income (filter to Expense only)
  - Category: spending category
  - Transaction Description: text description

Pipeline:
  Raw Transactions → Date Processing → Daily Aggregation →
  Feature Engineering → XGBoost → Forecast

Output:
  - forecaster_model.pkl
  - metadata.json
  - metrics.json
"""

import json
import logging
import platform
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd
import joblib
from sklearn.metrics import mean_absolute_error, mean_squared_error

# XGBoost import
try:
    import xgboost as xgb
    XGBOOST_VERSION = xgb.__version__
except ImportError:
    raise ImportError("xgboost is required. Install with: pip install xgboost")

import sklearn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RANDOM_STATE = 42
MODULE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODULE_DIR.parent
DATA_DIR = PROJECT_ROOT / "data_prediction"

# Output paths
MODEL_PATH = MODULE_DIR / "forecaster_model.pkl"
METADATA_PATH = MODULE_DIR / "metadata.json"
METRICS_PATH = MODULE_DIR / "metrics.json"

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Feature engineering functions
# ---------------------------------------------------------------------------
def create_lag_features(df: pd.DataFrame, col: str = "daily_spending") -> pd.DataFrame:
    """Create lag and rolling features for time-series prediction."""
    df = df.copy()

    # Lag features
    df["lag_1"] = df[col].shift(1)
    df["lag_7"] = df[col].shift(7)

    # Rolling statistics
    df["rolling_mean_7"] = df[col].shift(1).rolling(window=7, min_periods=1).mean()
    df["rolling_std_7"] = df[col].shift(1).rolling(window=7, min_periods=1).std()
    df["rolling_mean_30"] = df[col].shift(1).rolling(window=30, min_periods=1).mean()

    # Date-based features
    df["day_of_week"] = df["date"].dt.dayofweek
    df["day_of_month"] = df["date"].dt.day
    df["month"] = df["date"].dt.month
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)

    return df


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


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def compute_smape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Symmetric Mean Absolute Percentage Error."""
    denominator = (np.abs(y_true) + np.abs(y_pred)) / 2.0
    # Avoid division by zero
    mask = denominator > 0
    if mask.sum() == 0:
        return 0.0
    return float(np.mean(np.abs(y_true[mask] - y_pred[mask]) / denominator[mask]) * 100)


# ---------------------------------------------------------------------------
# Main training pipeline
# ---------------------------------------------------------------------------
def train():
    logger.info("=" * 60)
    logger.info("MODEL PREDICTION — Training Pipeline")
    logger.info("=" * 60)

    # ------------------------------------------------------------------
    # 1. Load dataset
    # ------------------------------------------------------------------
    data_path = DATA_DIR / "Personal_Finance_Dataset.csv"

    if not data_path.exists():
        raise FileNotFoundError(f"Dataset not found: {data_path}")

    df = pd.read_csv(data_path)
    logger.info(f"Loaded: {data_path.name} — {df.shape}")
    logger.info(f"Columns: {list(df.columns)}")

    # ------------------------------------------------------------------
    # 2. Data quality checks
    # ------------------------------------------------------------------
    logger.info("\n--- Data Quality ---")
    logger.info(f"Null values:\n{df.isnull().sum()}")
    logger.info(f"Duplicates: {df.duplicated().sum()}")

    # Verify columns
    required_cols = {"Date", "Amount", "Type"}
    if not required_cols.issubset(set(df.columns)):
        raise KeyError(f"Missing columns: {required_cols - set(df.columns)}")

    # ------------------------------------------------------------------
    # 3. Preprocessing
    # ------------------------------------------------------------------
    logger.info("\n--- Preprocessing ---")

    # Parse dates
    df["date"] = pd.to_datetime(df["Date"], errors="coerce")
    invalid_dates = df["date"].isnull().sum()
    if invalid_dates > 0:
        logger.warning(f"Dropping {invalid_dates} rows with invalid dates")
        df = df.dropna(subset=["date"])

    # Filter to expenses only (we're predicting spending)
    type_dist = df["Type"].value_counts()
    logger.info(f"Type distribution:\n{type_dist}")

    df_expense = df[df["Type"] == "Expense"].copy()
    logger.info(f"Expense records: {len(df_expense)} of {len(df)}")

    if len(df_expense) == 0:
        raise ValueError("No 'Expense' records found in dataset")

    # Ensure Amount is positive for expenses
    df_expense["amount"] = df_expense["Amount"].abs()

    # Sort by date
    df_expense = df_expense.sort_values("date").reset_index(drop=True)
    logger.info(f"Date range: {df_expense['date'].min()} to {df_expense['date'].max()}")

    # ------------------------------------------------------------------
    # 4. Daily aggregation
    # ------------------------------------------------------------------
    logger.info("\n--- Daily Aggregation ---")
    daily = df_expense.groupby("date")["amount"].sum().reset_index()
    daily.columns = ["date", "daily_spending"]

    # Create continuous date range
    date_range = pd.date_range(
        start=daily["date"].min(),
        end=daily["date"].max(),
        freq="D",
    )

    daily_full = pd.DataFrame({"date": date_range})
    daily_full = daily_full.merge(daily, on="date", how="left")

    # Fill missing days — 0 spending on days with no transactions
    missing_days = daily_full["daily_spending"].isnull().sum()
    total_days = len(daily_full)
    logger.info(f"Total days in range: {total_days}")
    logger.info(f"Days with transactions: {total_days - missing_days}")
    logger.info(f"Days without transactions: {missing_days} (filled with 0)")
    daily_full["daily_spending"] = daily_full["daily_spending"].fillna(0)

    logger.info(f"Daily spending stats:\n{daily_full['daily_spending'].describe()}")

    # ------------------------------------------------------------------
    # 5. Feature engineering
    # ------------------------------------------------------------------
    logger.info("\n--- Feature Engineering ---")
    daily_full = create_lag_features(daily_full, "daily_spending")

    # Drop rows where lag features are NaN (first 30 days)
    # Use 30 because rolling_mean_30 needs 30 days
    warmup_period = 30
    df_features = daily_full.iloc[warmup_period:].copy().reset_index(drop=True)

    # Fill any remaining NaN in features
    for col in FEATURE_COLS:
        nan_count = df_features[col].isnull().sum()
        if nan_count > 0:
            logger.info(f"  Filling {nan_count} NaN in '{col}' with 0")
            df_features[col] = df_features[col].fillna(0)

    logger.info(f"Features shape after warmup removal: {df_features.shape}")
    logger.info(f"Feature columns: {FEATURE_COLS}")

    # ------------------------------------------------------------------
    # 6. Time-based train/test split
    # ------------------------------------------------------------------
    logger.info("\n--- Train/Test Split (Time-Based) ---")

    test_days = 90  # Last 90 days as test set
    if len(df_features) <= test_days + 30:
        # If not enough data, use 20% as test
        test_days = max(30, int(len(df_features) * 0.2))
        logger.warning(f"Not enough data for 90-day test. Using {test_days} days.")

    split_idx = len(df_features) - test_days

    df_train = df_features.iloc[:split_idx].copy()
    df_test = df_features.iloc[split_idx:].copy()

    X_train = df_train[FEATURE_COLS].values
    y_train = df_train["daily_spending"].values
    X_test = df_test[FEATURE_COLS].values
    y_test = df_test["daily_spending"].values

    logger.info(f"Train: {len(df_train)} days ({df_train['date'].min()} to {df_train['date'].max()})")
    logger.info(f"Test:  {len(df_test)} days ({df_test['date'].min()} to {df_test['date'].max()})")

    # ------------------------------------------------------------------
    # 7. Model Training — XGBoost
    # ------------------------------------------------------------------
    logger.info("\n--- Model Training (XGBoost) ---")

    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )
    logger.info("XGBoost model trained successfully.")

    # Feature importance
    logger.info("\nFeature importance:")
    importances = model.feature_importances_
    for feat, imp in sorted(zip(FEATURE_COLS, importances), key=lambda x: -x[1]):
        logger.info(f"  {feat:20s}: {imp:.4f}")

    # ------------------------------------------------------------------
    # 8. Evaluation
    # ------------------------------------------------------------------
    logger.info("\n--- Evaluation ---")

    y_pred = model.predict(X_test)

    mae = mean_absolute_error(y_test, y_pred)
    rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
    smape = compute_smape(y_test, y_pred)

    logger.info(f"MAE:   {mae:.2f}")
    logger.info(f"RMSE:  {rmse:.2f}")
    logger.info(f"SMAPE: {smape:.2f}%")

    # ------------------------------------------------------------------
    # 9. Save the full daily_full DataFrame for prediction
    # ------------------------------------------------------------------
    # Save the last N days of history needed for recursive forecasting
    history_path = MODULE_DIR / "history_data.csv"
    # Keep last 60 days of history (enough for lag_7 + rolling_mean_30)
    history_data = daily_full[["date", "daily_spending"]].tail(60).copy()
    history_data.to_csv(history_path, index=False)
    logger.info(f"History data saved: {history_path} ({len(history_data)} days)")

    # ------------------------------------------------------------------
    # 10. Save artifacts
    # ------------------------------------------------------------------
    logger.info("\n--- Saving Artifacts ---")

    # Save model
    joblib.dump(model, MODEL_PATH)
    logger.info(f"Model saved: {MODEL_PATH}")

    # Metadata
    metadata = {
        "model_type": "XGBRegressor",
        "dataset": "Personal_Finance_Dataset.csv",
        "data_filter": "Type == 'Expense'",
        "total_expense_records": int(len(df_expense)),
        "total_days_in_range": int(total_days),
        "training_days": int(len(df_train)),
        "test_days": int(len(df_test)),
        "warmup_period": warmup_period,
        "date_range_start": str(daily_full["date"].min().date()),
        "date_range_end": str(daily_full["date"].max().date()),
        "feature_columns": FEATURE_COLS,
        "random_state": RANDOM_STATE,
        "xgboost_params": {
            "n_estimators": 200,
            "max_depth": 5,
            "learning_rate": 0.05,
            "subsample": 0.8,
            "colsample_bytree": 0.8,
        },
        "python_version": platform.python_version(),
        "sklearn_version": sklearn.__version__,
        "xgboost_version": XGBOOST_VERSION,
        "training_timestamp": datetime.now().isoformat(),
    }

    with open(METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    logger.info(f"Metadata saved: {METADATA_PATH}")

    # Metrics
    metrics = {
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "smape": round(smape, 4),
        "test_days": int(len(df_test)),
        "feature_importance": {
            feat: round(float(imp), 4)
            for feat, imp in zip(FEATURE_COLS, importances)
        },
    }

    with open(METRICS_PATH, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)
    logger.info(f"Metrics saved: {METRICS_PATH}")

    logger.info("\n" + "=" * 60)
    logger.info("MODEL PREDICTION — Training Complete!")
    logger.info("=" * 60)

    return model, metadata, metrics


if __name__ == "__main__":
    train()
