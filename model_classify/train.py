"""
model_classify/train.py
========================
Train a text classification model (TF-IDF + Logistic Regression)
to predict transaction categories from transaction descriptions.

Dataset: data_classify/train_transactions.csv (train)
         data_classify/test_transactions.csv  (test)

Columns:
  - transaction_text: text description of the transaction
  - category: one of 9 categories

Output:
  - classifier_model.pkl  (Logistic Regression model)
  - vectorizer.pkl        (TF-IDF vectorizer)
  - metadata.json         (training metadata)
  - metrics.json          (evaluation metrics)
"""

import re
import json
import logging
import platform
from pathlib import Path
from datetime import datetime

import numpy as np
import pandas as pd
import joblib
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
RANDOM_STATE = 42
MODULE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODULE_DIR.parent
DATA_DIR = PROJECT_ROOT / "data_classify"

# Output paths
MODEL_PATH = MODULE_DIR / "classifier_model.pkl"
VECTORIZER_PATH = MODULE_DIR / "vectorizer.pkl"
METADATA_PATH = MODULE_DIR / "metadata.json"
METRICS_PATH = MODULE_DIR / "metrics.json"

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Text cleaning — identical logic must be used in predict.py
# ---------------------------------------------------------------------------
def clean_text(text: str) -> str:
    """Clean and normalize transaction text."""
    if text is None or (isinstance(text, float) and np.isnan(text)):
        return ""
    text = str(text)
    text = text.lower().strip()
    # Remove special characters but keep alphanumeric and spaces
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    # Normalize whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---------------------------------------------------------------------------
# Main training pipeline
# ---------------------------------------------------------------------------
def train():
    logger.info("=" * 60)
    logger.info("MODEL CLASSIFY — Training Pipeline")
    logger.info("=" * 60)

    # ------------------------------------------------------------------
    # 1. Load datasets
    # ------------------------------------------------------------------
    train_path = DATA_DIR / "train_transactions.csv"
    test_path = DATA_DIR / "test_transactions.csv"

    if not train_path.exists():
        raise FileNotFoundError(f"Training file not found: {train_path}")
    if not test_path.exists():
        raise FileNotFoundError(f"Test file not found: {test_path}")

    df_train = pd.read_csv(train_path)
    df_test = pd.read_csv(test_path)

    logger.info(f"Train file: {train_path.name} — {df_train.shape}")
    logger.info(f"Test file:  {test_path.name} — {df_test.shape}")

    # Verify expected columns
    text_col = "transaction_text"
    label_col = "category"

    for col in [text_col, label_col]:
        if col not in df_train.columns:
            raise KeyError(f"Column '{col}' not found in train data. "
                           f"Available: {list(df_train.columns)}")
        if col not in df_test.columns:
            raise KeyError(f"Column '{col}' not found in test data. "
                           f"Available: {list(df_test.columns)}")

    # ------------------------------------------------------------------
    # 2. Data quality checks
    # ------------------------------------------------------------------
    logger.info("\n--- Data Quality ---")

    # Check nulls
    train_text_nulls = df_train[text_col].isnull().sum()
    train_label_nulls = df_train[label_col].isnull().sum()
    test_text_nulls = df_test[text_col].isnull().sum()
    test_label_nulls = df_test[label_col].isnull().sum()

    logger.info(f"Train text nulls: {train_text_nulls}, label nulls: {train_label_nulls}")
    logger.info(f"Test  text nulls: {test_text_nulls}, label nulls: {test_label_nulls}")

    # Check duplicates
    train_dupes = df_train.duplicated().sum()
    test_dupes = df_test.duplicated().sum()
    logger.info(f"Train duplicates: {train_dupes}")
    logger.info(f"Test  duplicates: {test_dupes}")

    # Drop rows with null text or label
    df_train = df_train.dropna(subset=[text_col, label_col]).copy()
    df_test = df_test.dropna(subset=[text_col, label_col]).copy()

    # Drop duplicates
    df_train = df_train.drop_duplicates().reset_index(drop=True)
    df_test = df_test.drop_duplicates().reset_index(drop=True)

    logger.info(f"After cleaning — Train: {len(df_train)}, Test: {len(df_test)}")

    # ------------------------------------------------------------------
    # 3. Class distribution
    # ------------------------------------------------------------------
    train_classes = sorted(df_train[label_col].unique().tolist())
    n_classes = len(train_classes)

    logger.info(f"\nClasses ({n_classes}): {train_classes}")
    logger.info("\nTrain class distribution:")
    for cat, count in df_train[label_col].value_counts().items():
        logger.info(f"  {cat}: {count} ({count / len(df_train) * 100:.1f}%)")

    # Check class imbalance
    counts = df_train[label_col].value_counts()
    imbalance_ratio = counts.max() / counts.min()
    logger.info(f"\nClass imbalance ratio (max/min): {imbalance_ratio:.2f}")
    if imbalance_ratio > 3:
        logger.warning("Significant class imbalance detected! Consider using class_weight='balanced'.")

    # ------------------------------------------------------------------
    # 4. Text cleaning
    # ------------------------------------------------------------------
    logger.info("\n--- Text Cleaning ---")
    df_train["clean_text"] = df_train[text_col].apply(clean_text)
    df_test["clean_text"] = df_test[text_col].apply(clean_text)

    # Remove rows with empty text after cleaning
    empty_train = (df_train["clean_text"] == "").sum()
    empty_test = (df_test["clean_text"] == "").sum()
    logger.info(f"Empty after cleaning — Train: {empty_train}, Test: {empty_test}")

    df_train = df_train[df_train["clean_text"] != ""].reset_index(drop=True)
    df_test = df_test[df_test["clean_text"] != ""].reset_index(drop=True)

    X_train = df_train["clean_text"]
    y_train = df_train[label_col]
    X_test = df_test["clean_text"]
    y_test = df_test[label_col]

    logger.info(f"Final — Train: {len(X_train)}, Test: {len(X_test)}")

    # ------------------------------------------------------------------
    # 5. TF-IDF Vectorization (FIT on train ONLY)
    # ------------------------------------------------------------------
    logger.info("\n--- TF-IDF Vectorization ---")
    vectorizer = TfidfVectorizer(
        max_features=10000,
        ngram_range=(1, 2),
        min_df=2,
        max_df=0.95,
        sublinear_tf=True,
    )

    X_train_tfidf = vectorizer.fit_transform(X_train)
    X_test_tfidf = vectorizer.transform(X_test)  # Transform only — NO fit

    logger.info(f"Vocabulary size: {len(vectorizer.vocabulary_)}")
    logger.info(f"TF-IDF train shape: {X_train_tfidf.shape}")
    logger.info(f"TF-IDF test shape:  {X_test_tfidf.shape}")

    # ------------------------------------------------------------------
    # 6. Model Training — Logistic Regression
    # ------------------------------------------------------------------
    logger.info("\n--- Model Training ---")
    model = LogisticRegression(
        max_iter=1000,
        random_state=RANDOM_STATE,
        class_weight="balanced",  # Handle any class imbalance
        solver="lbfgs",
        C=1.0,
    )
    model.fit(X_train_tfidf, y_train)
    logger.info("Logistic Regression trained successfully.")

    # ------------------------------------------------------------------
    # 7. Evaluation
    # ------------------------------------------------------------------
    logger.info("\n--- Evaluation ---")
    y_pred = model.predict(X_test_tfidf)

    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, average="weighted", zero_division=0)
    recall = recall_score(y_test, y_pred, average="weighted", zero_division=0)
    f1 = f1_score(y_test, y_pred, average="weighted", zero_division=0)

    logger.info(f"Accuracy:  {accuracy:.4f}")
    logger.info(f"Precision: {precision:.4f}")
    logger.info(f"Recall:    {recall:.4f}")
    logger.info(f"F1-score:  {f1:.4f}")

    # Classification report
    report_str = classification_report(y_test, y_pred, zero_division=0)
    report_dict = classification_report(y_test, y_pred, output_dict=True, zero_division=0)
    logger.info(f"\nClassification Report:\n{report_str}")

    # Confusion matrix
    cm = confusion_matrix(y_test, y_pred, labels=train_classes)
    logger.info("\nConfusion Matrix (rows=actual, cols=predicted):")
    logger.info(f"Labels: {train_classes}")
    for i, row in enumerate(cm):
        logger.info(f"  {train_classes[i]:15s}: {row.tolist()}")

    # ------------------------------------------------------------------
    # 8. Save artifacts
    # ------------------------------------------------------------------
    logger.info("\n--- Saving Artifacts ---")

    # Save model (using joblib, but with .pkl extension as required)
    joblib.dump(model, MODEL_PATH)
    logger.info(f"Model saved: {MODEL_PATH}")

    # Save vectorizer
    joblib.dump(vectorizer, VECTORIZER_PATH)
    logger.info(f"Vectorizer saved: {VECTORIZER_PATH}")

    # Metadata
    metadata = {
        "model_type": "LogisticRegression",
        "vectorizer_type": "TfidfVectorizer",
        "dataset_train": "train_transactions.csv",
        "dataset_test": "test_transactions.csv",
        "training_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "num_classes": n_classes,
        "classes": train_classes,
        "random_state": RANDOM_STATE,
        "tfidf_max_features": 10000,
        "tfidf_ngram_range": [1, 2],
        "python_version": platform.python_version(),
        "sklearn_version": sklearn.__version__,
        "training_timestamp": datetime.now().isoformat(),
        "text_column": text_col,
        "label_column": label_col,
        "class_weight": "balanced",
    }

    with open(METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)
    logger.info(f"Metadata saved: {METADATA_PATH}")

    # Metrics
    metrics = {
        "accuracy": round(accuracy, 4),
        "precision_weighted": round(precision, 4),
        "recall_weighted": round(recall, 4),
        "f1_weighted": round(f1, 4),
        "classification_report": report_dict,
        "confusion_matrix": cm.tolist(),
        "confusion_matrix_labels": train_classes,
    }

    with open(METRICS_PATH, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)
    logger.info(f"Metrics saved: {METRICS_PATH}")

    # ------------------------------------------------------------------
    # 9. Quick inference test
    # ------------------------------------------------------------------
    logger.info("\n--- Quick Inference Test ---")
    test_texts = [
        "Flipkart order INR 5000",
        "Uber ride to airport",
        "Netflix subscription payment",
        "Hospital bill payment",
        "College tuition fee",
    ]
    for t in test_texts:
        cleaned = clean_text(t)
        vec = vectorizer.transform([cleaned])
        pred = model.predict(vec)[0]
        proba = model.predict_proba(vec).max()
        logger.info(f"  '{t}' → {pred} (confidence: {proba:.3f})")

    logger.info("\n" + "=" * 60)
    logger.info("MODEL CLASSIFY — Training Complete!")
    logger.info("=" * 60)

    return model, vectorizer, metadata, metrics


if __name__ == "__main__":
    train()
