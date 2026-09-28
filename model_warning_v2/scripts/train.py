"""
model_warning_v2/scripts/train.py
=================================
Train Risk/Warning Classifier (v2):
- Strict pipeline fitting on TRAIN ONLY (no leakage).
- Threshold selection performed exclusively on VALIDATION SET.
- Evaluates PR-AUC, ROC-AUC, Precision, Recall, F1 on Validation.
- Serializes trained weights, pipeline parameters, and validation thresholds.
"""

import sys
import json
import pickle
import time
from pathlib import Path
from typing import List, Dict, Any, Tuple
import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from pipeline import LeakageFreePipeline, FEATURE_NAMES
from classifier import RiskMLPClassifier, compute_roc_auc, compute_pr_auc, compute_brier_score

BASE_DIR = SCRIPTS_DIR.parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
METRICS_DIR = BASE_DIR / "metrics"

MODELS_DIR.mkdir(parents=True, exist_ok=True)
METRICS_DIR.mkdir(parents=True, exist_ok=True)


def tune_thresholds_on_validation(
    y_val: np.ndarray,
    val_probs: np.ndarray,
    target_recall: float = 0.88,
) -> Tuple[float, float, Dict[str, float]]:
    """
    Tune thresholds exclusively on VALIDATION:
    1. Select binary classification threshold that achieves target_recall (>= 0.88)
       while maximizing F1.
    2. Set safe_threshold = candidate_threshold, danger_threshold = high-confidence percentile.
    """
    best_thresh = 0.5
    best_f1 = 0.0
    best_stats = {}

    candidates = np.linspace(0.15, 0.75, 61)
    for t in candidates:
        y_pred = (val_probs >= t).astype(int)
        tp = np.sum((val_probs >= t) & (y_val == 1))
        fp = np.sum((val_probs >= t) & (y_val == 0))
        fn = np.sum((val_probs < t) & (y_val == 1))
        tn = np.sum((val_probs < t) & (y_val == 0))

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0

        if rec >= target_recall and f1 > best_f1:
            best_f1 = f1
            best_thresh = float(t)
            best_stats = {
                "threshold": float(t),
                "precision": float(prec),
                "recall": float(rec),
                "f1": float(f1),
                "tp": int(tp),
                "fp": int(fp),
                "fn": int(fn),
                "tn": int(tn),
            }

    if not best_stats:
        # Fallback if target recall was not met
        best_thresh = 0.35
        y_pred = (val_probs >= best_thresh).astype(int)
        tp = np.sum((val_probs >= best_thresh) & (y_val == 1))
        fp = np.sum((val_probs >= best_thresh) & (y_val == 0))
        fn = np.sum((val_probs < best_thresh) & (y_val == 1))
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        best_stats = {
            "threshold": best_thresh,
            "precision": float(prec),
            "recall": float(rec),
            "f1": float((2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0),
        }

    safe_threshold = best_thresh
    danger_threshold = float(np.percentile(val_probs[val_probs >= safe_threshold], 70))
    danger_threshold = max(danger_threshold, safe_threshold + 0.20)
    danger_threshold = min(danger_threshold, 0.92)

    return safe_threshold, danger_threshold, best_stats


def main():
    print("=" * 80)
    print("      MODEL_WARNING V2 TRAINING & LEAKAGE-FREE VALIDATION")
    print("=" * 80)

    with open(DATA_DIR / "raw_train.json", "r", encoding="utf-8") as f:
        train_records = json.load(f)
    with open(DATA_DIR / "raw_val.json", "r", encoding="utf-8") as f:
        val_records = json.load(f)

    # 1. Fit Feature Pipeline STRICTLY on TRAIN
    print("\n--- Fitting Pipeline on TRAIN ONLY ---")
    pipeline = LeakageFreePipeline()
    pipeline.fit(train_records)
    print(f"✔ Fitted on {len(train_records)} train transactions.")
    print(f"  • Global Card Avg: {pipeline.global_card_avg:,.0f} VND")
    print(f"  • Global User Avg: {pipeline.global_user_avg:,.0f} VND")
    print(f"  • Unique Train Cards: {len(pipeline.card_avg)}")
    print(f"  • Unique Train Users: {len(pipeline.user_avg)}")

    # 2. Transform TRAIN and VAL
    X_train = pipeline.transform(train_records)
    y_train = np.array([r["is_fraud"] for r in train_records], dtype=int)

    X_val = pipeline.transform(val_records)
    y_val = np.array([r["is_fraud"] for r in val_records], dtype=int)

    print(f"\nFeature matrix X_train: {X_train.shape}, y_train: {y_train.shape} (Fraud: {np.sum(y_train)} / {len(y_train)})")
    print(f"Feature matrix X_val:   {X_val.shape}, y_val: {y_val.shape} (Fraud: {np.sum(y_val)} / {len(y_val)})")

    # 3. Fit RiskMLPClassifier
    print("\n--- Training Supervised Classifier ---")
    pos_weight = float((len(y_train) - np.sum(y_train)) / np.sum(y_train)) * 0.7  # Balanced weighting
    clf = RiskMLPClassifier(input_dim=X_train.shape[1], hidden_dim=32, l2_reg=1e-4, pos_weight=pos_weight)
    clf.fit(X_train, y_train, epochs=90, batch_size=128, lr=0.008)

    # 4. Tune Thresholds & Evaluate Calibration on VALIDATION ONLY
    print("\n--- Tuning Thresholds on VALIDATION ONLY ---")
    val_probs = clf.predict_proba(X_val)
    val_roc_auc = compute_roc_auc(y_val, val_probs)
    val_pr_auc = compute_pr_auc(y_val, val_probs)
    val_brier = compute_brier_score(y_val, val_probs)
    val_baseline_ap = float(np.mean(y_val))

    safe_thresh, danger_thresh, val_stats = tune_thresholds_on_validation(y_val, val_probs, target_recall=0.88)

    print(f"  • Validation ROC-AUC:    {val_roc_auc:.4f}")
    print(f"  • Validation PR-AUC:     {val_pr_auc:.4f} (Baseline: {val_baseline_ap:.4f})")
    print(f"  • Validation Brier Score:{val_brier:.4f}")
    print(f"  • Selected Safe Threshold:   {safe_thresh:.4f}")
    print(f"  • Selected Danger Threshold: {danger_thresh:.4f}")
    print(f"  • Val Fraud Recall:     {val_stats['recall']:.2%}")
    print(f"  • Val Fraud Precision:  {val_stats['precision']:.2%}")
    print(f"  • Val F1 Score:         {val_stats['f1']:.4f}")

    # 5. Serialize Model Bundle
    bundle = {
        "clf": {
            "input_dim": clf.input_dim,
            "hidden_dim": clf.hidden_dim,
            "W1": clf.W1,
            "b1": clf.b1,
            "W2": clf.W2,
            "b2": clf.b2,
            "pos_weight": clf.pos_weight,
        },
        "pipeline": pipeline,
        "thresholds": {
            "safe_threshold": safe_thresh,
            "danger_threshold": danger_thresh,
            "source": "tuned_on_validation_only",
        },
        "feature_names": FEATURE_NAMES,
    }

    with open(MODELS_DIR / "warning_model.pkl", "wb") as f:
        pickle.dump(bundle, f)

    metadata = {
        "model_name": "model_warning_v2",
        "approach": "Leakage-Free RiskMLPClassifier with Class Imbalance Weighting",
        "features": FEATURE_NAMES,
        "num_features": len(FEATURE_NAMES),
        "split_strategy": "Strict Group Split by User & Card (Train: 350 users, Val: 75 users, Test: 75 users)",
        "train_samples": len(train_records),
        "val_samples": len(val_records),
        "safe_threshold": safe_thresh,
        "danger_threshold": danger_thresh,
        "val_roc_auc": round(val_roc_auc, 4),
        "val_pr_auc": round(val_pr_auc, 4),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(MODELS_DIR / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    val_metrics_out = {
        "val_roc_auc": round(val_roc_auc, 4),
        "val_pr_auc": round(val_pr_auc, 4),
        "val_baseline_ap": round(val_baseline_ap, 4),
        "val_brier_score": round(val_brier, 4),
        "val_stats": val_stats,
        "thresholds": {
            "safe_threshold": safe_thresh,
            "danger_threshold": danger_thresh,
        },
    }
    with open(METRICS_DIR / "val_metrics.json", "w", encoding="utf-8") as f:
        json.dump(val_metrics_out, f, indent=2)

    print(f"\n✔ Model saved:    {MODELS_DIR / 'warning_model.pkl'}")
    print(f"✔ Metadata saved: {MODELS_DIR / 'metadata.json'}")
    print(f"✔ Val metrics:    {METRICS_DIR / 'val_metrics.json'}")
    print("=" * 80)


if __name__ == "__main__":
    main()
