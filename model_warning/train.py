"""
model_warning/train.py
========================
Train a fraud/risk detection model using XGBoost.

Datasets (from data_warning/):
  - transactions_data.csv  (13.3M rows, 1.2GB)
  - cards_data.csv         (6,146 rows)
  - users_data.csv         (2,000 rows)
  - train_fraud_labels.json (8.9M entries, key=txn_id → "Yes"/"No")
  - mcc_codes.json          (109 MCC code descriptions)

JOIN keys:
  - transactions_data.id → train_fraud_labels.target keys
  - transactions_data.card_id → cards_data.id
  - transactions_data.client_id → users_data.id
  - transactions_data.mcc → mcc_codes.json keys

Strategy:
  - Read transactions in chunks (file is 1.2GB)
  - Match with fraud labels via transaction id
  - Stratified sample: keep ALL fraud cases + proportional non-fraud
  - XGBoost with scale_pos_weight for class imbalance
  - Risk score → SAFE / WARNING / DANGER

Output:
  - warning_model.pkl
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
import sklearn
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix,
    roc_auc_score,
)
from sklearn.preprocessing import LabelEncoder

try:
    import xgboost as xgb
    XGBOOST_VERSION = xgb.__version__
except ImportError:
    raise ImportError("xgboost is required. Install with: pip install xgboost")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RANDOM_STATE = 42
MODULE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODULE_DIR.parent
DATA_DIR = PROJECT_ROOT / "data_warning"

# Output paths
MODEL_PATH = MODULE_DIR / "warning_model.pkl"
METADATA_PATH = MODULE_DIR / "metadata.json"
METRICS_PATH = MODULE_DIR / "metrics.json"

# Sampling config — for memory-constrained environments
# Keep ALL fraud cases, sample non-fraud proportionally
MAX_NON_FRAUD_SAMPLES = 200000  # ~200K non-fraud + ~13K fraud ≈ 213K total

# Chunk size for reading large CSV
CHUNK_SIZE = 500000

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper: parse dollar amounts
# ---------------------------------------------------------------------------
def parse_dollar(value):
    """Convert '$1,234.56' or '$-77.00' to float."""
    if pd.isna(value):
        return np.nan
    s = str(value).replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return np.nan


# ---------------------------------------------------------------------------
# Main training pipeline
# ---------------------------------------------------------------------------
def train():
    logger.info("=" * 60)
    logger.info("MODEL WARNING — Training Pipeline")
    logger.info("=" * 60)

    # ------------------------------------------------------------------
    # 1. Load auxiliary datasets (small files first)
    # ------------------------------------------------------------------
    logger.info("\n--- Loading Auxiliary Datasets ---")

    # Users
    users_path = DATA_DIR / "users_data.csv"
    df_users = pd.read_csv(users_path)
    logger.info(f"Users: {df_users.shape}")

    # Parse dollar columns in users
    for col in ["per_capita_income", "yearly_income", "total_debt"]:
        if col in df_users.columns:
            df_users[col] = df_users[col].apply(parse_dollar)

    # Cards
    cards_path = DATA_DIR / "cards_data.csv"
    df_cards = pd.read_csv(cards_path)
    logger.info(f"Cards: {df_cards.shape}")

    # Parse credit_limit
    if "credit_limit" in df_cards.columns:
        df_cards["credit_limit"] = df_cards["credit_limit"].apply(parse_dollar)

    # MCC codes
    mcc_path = DATA_DIR / "mcc_codes.json"
    with open(mcc_path, "r", encoding="utf-8") as f:
        mcc_codes = json.load(f)
    logger.info(f"MCC codes: {len(mcc_codes)} entries")

    # Fraud labels
    logger.info("Loading fraud labels (this may take a moment)...")
    fraud_path = DATA_DIR / "train_fraud_labels.json"
    with open(fraud_path, "r", encoding="utf-8") as f:
        fraud_data = json.load(f)
    fraud_labels = fraud_data["target"]  # dict: {str(txn_id): "Yes"/"No"}
    logger.info(f"Fraud labels: {len(fraud_labels)} entries")

    # Count fraud distribution
    fraud_yes = sum(1 for v in fraud_labels.values() if v == "Yes")
    fraud_no = len(fraud_labels) - fraud_yes
    logger.info(f"Fraud distribution: Yes={fraud_yes}, No={fraud_no}")

    # ------------------------------------------------------------------
    # 2. Read transactions in chunks + match with fraud labels
    # ------------------------------------------------------------------
    logger.info("\n--- Loading Transactions (Chunked) ---")
    txn_path = DATA_DIR / "transactions_data.csv"

    fraud_rows = []
    non_fraud_rows = []
    total_matched = 0
    total_unmatched = 0
    chunk_count = 0

    for chunk in pd.read_csv(txn_path, chunksize=CHUNK_SIZE):
        chunk_count += 1

        # Look up fraud labels for each transaction
        chunk["fraud_label"] = chunk["id"].astype(str).map(fraud_labels)

        # Split into matched and unmatched
        matched = chunk[chunk["fraud_label"].notna()].copy()
        unmatched_count = chunk["fraud_label"].isna().sum()

        total_matched += len(matched)
        total_unmatched += unmatched_count

        if len(matched) > 0:
            fraud_chunk = matched[matched["fraud_label"] == "Yes"]
            non_fraud_chunk = matched[matched["fraud_label"] == "No"]

            # Keep ALL fraud cases
            if len(fraud_chunk) > 0:
                fraud_rows.append(fraud_chunk)

            # Sample non-fraud per chunk to stay within memory limits (< 500MB RAM)
            if len(non_fraud_chunk) > 0:
                chunk_sample_size = min(len(non_fraud_chunk), 8000)
                sampled_chunk = non_fraud_chunk.sample(
                    n=chunk_sample_size, random_state=RANDOM_STATE
                )
                non_fraud_rows.append(sampled_chunk)

        if chunk_count % 5 == 0:
            logger.info(f"  Processed {chunk_count} chunks "
                        f"({chunk_count * CHUNK_SIZE:,} rows), "
                        f"matched={total_matched:,}")

    logger.info(f"Total chunks: {chunk_count}")
    logger.info(f"Total matched with fraud labels: {total_matched:,}")
    logger.info(f"Total unmatched: {total_unmatched:,}")

    # Combine fraud rows
    if fraud_rows:
        df_fraud = pd.concat(fraud_rows, ignore_index=True)
    else:
        raise ValueError("No fraud cases found! Cannot train supervised model.")

    # Combine non-fraud rows and sample
    if non_fraud_rows:
        df_non_fraud = pd.concat(non_fraud_rows, ignore_index=True)
    else:
        raise ValueError("No non-fraud cases found!")

    logger.info(f"Fraud cases collected: {len(df_fraud)}")
    logger.info(f"Non-fraud cases collected: {len(df_non_fraud)}")

    # Sample non-fraud to keep dataset manageable
    if len(df_non_fraud) > MAX_NON_FRAUD_SAMPLES:
        df_non_fraud_sampled = df_non_fraud.sample(
            n=MAX_NON_FRAUD_SAMPLES,
            random_state=RANDOM_STATE,
        )
        logger.info(f"Sampled non-fraud: {len(df_non_fraud_sampled)}")
    else:
        df_non_fraud_sampled = df_non_fraud

    # Combine
    df = pd.concat([df_fraud, df_non_fraud_sampled], ignore_index=True)
    df["is_fraud"] = (df["fraud_label"] == "Yes").astype(int)
    logger.info(f"Combined dataset: {df.shape}")
    logger.info(f"Fraud ratio: {df['is_fraud'].mean() * 100:.2f}%")

    # ------------------------------------------------------------------
    # 3. JOIN with cards and users
    # ------------------------------------------------------------------
    logger.info("\n--- Joining with Cards and Users ---")

    # JOIN cards: transactions.card_id → cards.id
    cards_for_join = df_cards[["id", "credit_limit", "card_brand", "card_type",
                               "has_chip", "card_on_dark_web"]].copy()
    cards_for_join = cards_for_join.rename(columns={"id": "card_id"})
    # Handle duplicate card_ids (take first)
    cards_for_join = cards_for_join.drop_duplicates(subset=["card_id"], keep="first")

    df = df.merge(cards_for_join, on="card_id", how="left")
    logger.info(f"After card join: {df.shape}")

    # JOIN users: transactions.client_id → users.id
    users_for_join = df_users[["id", "credit_score", "yearly_income",
                                "current_age", "gender"]].copy()
    users_for_join = users_for_join.rename(columns={"id": "client_id"})

    df = df.merge(users_for_join, on="client_id", how="left")
    logger.info(f"After user join: {df.shape}")

    # ------------------------------------------------------------------
    # 4. Feature Engineering
    # ------------------------------------------------------------------
    logger.info("\n--- Feature Engineering ---")

    # Parse amount
    df["transaction_amount"] = df["amount"].apply(parse_dollar).abs()

    # Parse date
    df["txn_datetime"] = pd.to_datetime(df["date"], errors="coerce")
    df["hour"] = df["txn_datetime"].dt.hour
    df["day_of_week"] = df["txn_datetime"].dt.dayofweek
    df["month"] = df["txn_datetime"].dt.month

    # Amount to credit limit ratio
    df["amount_to_limit_ratio"] = np.where(
        (df["credit_limit"].notna()) & (df["credit_limit"] > 0),
        df["transaction_amount"] / df["credit_limit"],
        0.0,
    )

    # MCC category (encode as numeric)
    df["mcc_category"] = df["mcc"].astype(str).map(mcc_codes).fillna("Unknown")

    # Encode categorical features
    # use_chip
    use_chip_map = {"Swipe Transaction": 0, "Chip Transaction": 1, "Online Transaction": 2}
    df["use_chip_encoded"] = df["use_chip"].map(use_chip_map).fillna(-1).astype(int)

    # card_brand encoding
    card_brand_enc = LabelEncoder()
    df["card_brand_encoded"] = card_brand_enc.fit_transform(
        df["card_brand"].fillna("Unknown").astype(str)
    )

    # card_type encoding
    card_type_enc = LabelEncoder()
    df["card_type_encoded"] = card_type_enc.fit_transform(
        df["card_type"].fillna("Unknown").astype(str)
    )

    # has_chip encoding
    df["has_chip_encoded"] = (df["has_chip"] == "YES").astype(int)

    # card_on_dark_web encoding
    df["dark_web_encoded"] = (df["card_on_dark_web"] == "Yes").astype(int)

    # gender encoding
    df["gender_encoded"] = (df["gender"] == "Female").astype(int)

    # errors — has_error flag
    df["has_error"] = df["errors"].notna().astype(int)

    # Compute per-card and per-user statistics for deviation features
    # Average transaction amount per card
    card_avg = df.groupby("card_id")["transaction_amount"].transform("mean")
    df["deviation_from_card_average"] = df["transaction_amount"] - card_avg

    # Average transaction amount per user
    user_avg = df.groupby("client_id")["transaction_amount"].transform("mean")
    df["deviation_from_user_average"] = df["transaction_amount"] - user_avg

    # Transaction count per user (approximate from this sample)
    user_txn_count = df.groupby("client_id")["id"].transform("count")
    df["user_txn_count"] = user_txn_count

    # Define feature columns
    feature_cols = [
        "transaction_amount",
        "credit_limit",
        "amount_to_limit_ratio",
        "hour",
        "day_of_week",
        "month",
        "mcc",
        "use_chip_encoded",
        "card_brand_encoded",
        "card_type_encoded",
        "has_chip_encoded",
        "dark_web_encoded",
        "credit_score",
        "yearly_income",
        "current_age",
        "gender_encoded",
        "has_error",
        "deviation_from_card_average",
        "deviation_from_user_average",
        "user_txn_count",
    ]

    logger.info(f"Feature columns ({len(feature_cols)}): {feature_cols}")

    # ------------------------------------------------------------------
    # 5. Handle missing values
    # ------------------------------------------------------------------
    logger.info("\n--- Handling Missing Values ---")

    for col in feature_cols:
        null_count = df[col].isnull().sum()
        if null_count > 0:
            if df[col].dtype in ["float64", "int64"]:
                fill_val = df[col].median()
                df[col] = df[col].fillna(fill_val)
                logger.info(f"  {col}: filled {null_count} nulls with median={fill_val:.2f}")
            else:
                df[col] = df[col].fillna(0)
                logger.info(f"  {col}: filled {null_count} nulls with 0")

    # Replace inf values
    df[feature_cols] = df[feature_cols].replace([np.inf, -np.inf], 0)

    # ------------------------------------------------------------------
    # 6. Train/Test Split (stratified)
    # ------------------------------------------------------------------
    logger.info("\n--- Train/Test Split ---")

    X = df[feature_cols].values
    y = df["is_fraud"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y,
        test_size=0.2,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    logger.info(f"Train: {X_train.shape[0]} (fraud: {y_train.sum()})")
    logger.info(f"Test:  {X_test.shape[0]} (fraud: {y_test.sum()})")

    # ------------------------------------------------------------------
    # 7. Model Training — XGBoost
    # ------------------------------------------------------------------
    logger.info("\n--- Model Training (XGBoost) ---")

    # Calculate scale_pos_weight for class imbalance
    n_negative = (y_train == 0).sum()
    n_positive = (y_train == 1).sum()
    scale_pos_weight = n_negative / max(n_positive, 1)
    logger.info(f"scale_pos_weight: {scale_pos_weight:.2f}")

    model = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale_pos_weight,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=RANDOM_STATE,
        eval_metric="logloss",
        n_jobs=-1,
    )

    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False,
    )
    logger.info("XGBoost classifier trained successfully.")

    # Feature importance
    logger.info("\nFeature importance (top 10):")
    importances = model.feature_importances_
    feat_imp = sorted(zip(feature_cols, importances), key=lambda x: -x[1])
    for feat, imp in feat_imp[:10]:
        logger.info(f"  {feat:35s}: {imp:.4f}")

    # ------------------------------------------------------------------
    # 8. Evaluation
    # ------------------------------------------------------------------
    logger.info("\n--- Evaluation ---")

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)
    f1 = f1_score(y_test, y_pred, zero_division=0)
    roc_auc = roc_auc_score(y_test, y_proba)

    logger.info(f"Accuracy:  {accuracy:.4f}")
    logger.info(f"Precision: {precision:.4f}")
    logger.info(f"Recall:    {recall:.4f}")
    logger.info(f"F1-score:  {f1:.4f}")
    logger.info(f"ROC-AUC:   {roc_auc:.4f}")

    report_str = classification_report(y_test, y_pred, zero_division=0)
    report_dict = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
    logger.info(f"\nClassification Report:\n{report_str}")

    cm = confusion_matrix(y_test, y_pred)
    logger.info(f"Confusion Matrix:\n{cm}")

    # ------------------------------------------------------------------
    # 9. Risk thresholds
    # ------------------------------------------------------------------
    logger.info("\n--- Risk Threshold Calibration ---")

    # Use fraud probability distribution to set thresholds
    # SAFE: low probability (below 50th percentile of fraud probabilities)
    # WARNING: moderate probability
    # DANGER: high probability (above 90th percentile of all scores)

    # Get probabilities for non-fraud and fraud separately
    non_fraud_proba = y_proba[y_test == 0]
    fraud_proba = y_proba[y_test == 1]

    # Threshold strategy:
    # safe_threshold: p95 of non-fraud probabilities (most non-fraud below this)
    # danger_threshold: p10 of fraud probabilities (most fraud above this)
    safe_threshold = float(np.percentile(non_fraud_proba, 95))
    danger_threshold = float(np.percentile(fraud_proba, 10))

    # Ensure safe < danger
    if safe_threshold >= danger_threshold:
        # Fallback: use overall distribution
        safe_threshold = float(np.percentile(y_proba, 90))
        danger_threshold = float(np.percentile(y_proba, 99))
        threshold_method = "percentile_fallback_90_99"
    else:
        threshold_method = "percentile_non_fraud_p95_fraud_p10"

    logger.info(f"Safe threshold (below → SAFE):    {safe_threshold:.4f}")
    logger.info(f"Danger threshold (above → DANGER): {danger_threshold:.4f}")
    logger.info(f"Threshold method: {threshold_method}")

    # Validate thresholds
    test_risk_levels = np.where(
        y_proba < safe_threshold, "SAFE",
        np.where(y_proba < danger_threshold, "WARNING", "DANGER")
    )
    for level in ["SAFE", "WARNING", "DANGER"]:
        count = (test_risk_levels == level).sum()
        fraud_in_level = y_test[test_risk_levels == level].sum()
        logger.info(f"  {level:8s}: {count:>6d} transactions, {fraud_in_level:>4d} fraud")

    # ------------------------------------------------------------------
    # 10. Save artifacts
    # ------------------------------------------------------------------
    logger.info("\n--- Saving Artifacts ---")

    # Calculate feature medians and defaults for inference
    feature_medians = {
        col: float(df[col].median()) if df[col].dtype in ["float64", "int64"] else 0.0
        for col in feature_cols
    }

    # Save feature column order, encoders info and defaults
    model_bundle = {
        "model": model,
        "feature_cols": feature_cols,
        "safe_threshold": float(safe_threshold),
        "danger_threshold": float(danger_threshold),
        "threshold_method": threshold_method,
        "feature_medians": feature_medians,
        "card_brand_classes": list(card_brand_enc.classes_),
        "card_type_classes": list(card_type_enc.classes_),
        "card_avg_default": float(card_avg.mean()),
        "user_avg_default": float(user_avg.mean()),
    }
    joblib.dump(model_bundle, MODEL_PATH)
    logger.info(f"Model bundle saved: {MODEL_PATH}")

    # Metadata
    metadata = {
        "model_type": "XGBClassifier",
        "approach": "supervised (XGBoost with fraud labels)",
        "datasets": {
            "transactions": "transactions_data.csv",
            "cards": "cards_data.csv",
            "users": "users_data.csv",
            "fraud_labels": "train_fraud_labels.json",
            "mcc_codes": "mcc_codes.json",
        },
        "join_keys": {
            "txn_to_fraud": "transactions_data.id → train_fraud_labels.target keys",
            "txn_to_cards": "transactions_data.card_id → cards_data.id",
            "txn_to_users": "transactions_data.client_id → users_data.id",
        },
        "total_transactions_with_labels": int(total_matched),
        "fraud_cases_total": int(fraud_yes),
        "training_samples": int(len(X_train) + len(X_test)),
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "fraud_in_train": int(y_train.sum()),
        "fraud_in_test": int(y_test.sum()),
        "feature_columns": feature_cols,
        "num_features": len(feature_cols),
        "safe_threshold": safe_threshold,
        "danger_threshold": danger_threshold,
        "threshold_method": threshold_method,
        "scale_pos_weight": round(scale_pos_weight, 2),
        "random_state": RANDOM_STATE,
        "xgboost_params": {
            "n_estimators": 300,
            "max_depth": 6,
            "learning_rate": 0.05,
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
        "accuracy": round(accuracy, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "roc_auc": round(roc_auc, 4),
        "classification_report": report_dict,
        "confusion_matrix": cm.tolist(),
        "feature_importance": {
            feat: round(float(imp), 4) for feat, imp in feat_imp
        },
        "risk_distribution": {
            level: int((test_risk_levels == level).sum())
            for level in ["SAFE", "WARNING", "DANGER"]
        },
    }

    with open(METRICS_PATH, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)
    logger.info(f"Metrics saved: {METRICS_PATH}")

    logger.info("\n" + "=" * 60)
    logger.info("MODEL WARNING — Training Complete!")
    logger.info("=" * 60)

    return model_bundle, metadata, metrics


if __name__ == "__main__":
    train()
