"""
model_warning_v3/scripts/train.py
=================================
Train Risk/Warning Classifier (v3):
- Strict pipeline fitting on TRAIN ONLY (zero entity leakage).
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

from pipeline import LeakageFreePipelineV3, FEATURE_NAMES
from classifier import RiskMLPClassifierV3, compute_roc_auc, compute_pr_auc, compute_brier_score

BASE_DIR = SCRIPTS_DIR.parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
METRICS_DIR = BASE_DIR / "metrics"

MODELS_DIR.mkdir(parents=True, exist_ok=True)
METRICS_DIR.mkdir(parents=True, exist_ok=True)


def tune_thresholds_on_validation(
    y_val: np.ndarray,
    val_probs: np.ndarray,
    target_recall: float = 0.90,
) -> Tuple[float, float, Dict[str, float]]:
    """
    Tune thresholds exclusively on VALIDATION:
    1. Select binary classification threshold that achieves target_recall (>= 0.90)
       while maximizing F1 to prevent false SAFE.
    2. Set safe_threshold = candidate_threshold, danger_threshold = high-confidence percentile.
    """
    best_thresh = 0.5
    best_f1 = 0.0
    best_stats = {}

    candidates = np.linspace(0.10, 0.80, 71)
    for t in candidates:
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
        best_thresh = 0.35
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

    safe_threshold = round(best_thresh, 4)
    danger_threshold = float(np.percentile(val_probs[val_probs >= safe_threshold], 70))
    danger_threshold = max(danger_threshold, safe_threshold + 0.20)
    danger_threshold = min(danger_threshold, 0.92)
    danger_threshold = round(danger_threshold, 4)

    return safe_threshold, danger_threshold, best_stats


def main():
    print("=" * 80)
    print("      MODEL_WARNING V3 TRAINING & LEAKAGE-FREE VALIDATION")
    print("=" * 80)

    with open(DATA_DIR / "raw_train.json", "r", encoding="utf-8") as f:
        train_records = json.load(f)
    with open(DATA_DIR / "raw_val.json", "r", encoding="utf-8") as f:
        val_records = json.load(f)

    # 1. Fit Feature Pipeline STRICTLY on TRAIN
    print("\n--- Fitting Pipeline on TRAIN ONLY ---")
    pipeline = LeakageFreePipelineV3()
    pipeline.fit(train_records)
    print(f"✔ Fitted on {len(train_records)} train transactions.")
    print(f"  • Global Card Avg: {pipeline.global_card_avg:,.0f} VND")
    print(f"  • Global User Avg: {pipeline.global_user_avg:,.0f} VND")
    print(f"  • Unique Train Cards: {len(pipeline.card_avg)}")
    print(f"  • Unique Train Users: {len(pipeline.user_avg)}")

    # 2. Transform TRAIN and VAL
    print("\n--- Transforming TRAIN and VAL Feature Matrices ---")
    X_train = pipeline.transform(train_records)
    y_train = np.array([int(r.get("is_fraud", 0)) for r in train_records], dtype=np.int32)

    X_val = pipeline.transform(val_records)
    y_val = np.array([int(r.get("is_fraud", 0)) for r in val_records], dtype=np.int32)

    train_fraud_rate = float(np.mean(y_train))
    val_fraud_rate = float(np.mean(y_val))
    pos_weight = float((1.0 - train_fraud_rate) / (train_fraud_rate + 1e-6))
    print(f"  • Train Fraud Rate: {train_fraud_rate:.2%} (pos_weight: {pos_weight:.2f})")
    print(f"  • Val Fraud Rate:   {val_fraud_rate:.2%}")

    # 3. Train MLP Classifier
    print("\n--- Training RiskMLPClassifierV3 (Adam) ---")
    np.random.seed(2026)
    clf = RiskMLPClassifierV3(
        input_dim=len(FEATURE_NAMES),
        hidden_dim=32,
        pos_weight=pos_weight,
        lr=0.005,
        l2_reg=1e-4,
    )
    t0 = time.perf_counter()
    clf.fit(X_train, y_train, epochs=35, batch_size=128)
    train_time = time.perf_counter() - t0
    print(f"✔ Classifier trained in {train_time:.2f}s.")

    # 4. Tune Thresholds on Validation Only
    val_probs = clf.predict_proba(X_val)
    safe_thresh, danger_thresh, stats = tune_thresholds_on_validation(y_val, val_probs, target_recall=0.90)

    val_roc_auc = compute_roc_auc(y_val, val_probs)
    val_pr_auc = compute_pr_auc(y_val, val_probs)
    val_brier = compute_brier_score(y_val, val_probs)

    print("\n--- Validation Threshold Tuning Results (Zero Test Contact) ---")
    print(f"  • Tuned Safe Threshold:   {safe_thresh:.4f}")
    print(f"  • Tuned Danger Threshold: {danger_thresh:.4f}")
    print(f"  • Val Fraud Recall:       {stats['recall']:.2%}")
    print(f"  • Val Fraud Precision:    {stats['precision']:.2%}")
    print(f"  • Val F1 Score:           {stats['f1']:.4f}")
    print(f"  • Val ROC-AUC:            {val_roc_auc:.4f}")
    print(f"  • Val PR-AUC:             {val_pr_auc:.4f} (Baseline: {val_fraud_rate:.4f})")
    print(f"  • Val Brier Score:        {val_brier:.4f}")

    # 5. Serialize Artifact
    bundle = {
        "pipeline": pipeline,
        "clf": {
            "input_dim": clf.input_dim,
            "hidden_dim": clf.hidden_dim,
            "pos_weight": clf.pos_weight,
            "W1": clf.W1,
            "b1": clf.b1,
            "W2": clf.W2,
            "b2": clf.b2,
        },
        "thresholds": {
            "safe_threshold": safe_thresh,
            "danger_threshold": danger_thresh,
        },
        "feature_names": FEATURE_NAMES,
    }

    with open(MODELS_DIR / "warning_model.pkl", "wb") as f:
        pickle.dump(bundle, f, protocol=pickle.HIGHEST_PROTOCOL)

    metadata = {
        "model_name": "model_warning_v3",
        "approach": "Leakage-Free Group-Split Pipeline + RiskMLPClassifier (Hardened null/zero defense)",
        "train_samples": len(train_records),
        "val_samples": len(val_records),
        "features": FEATURE_NAMES,
        "num_features": len(FEATURE_NAMES),
        "thresholds": {
            "safe_threshold": safe_thresh,
            "danger_threshold": danger_thresh,
        },
        "val_metrics": {
            "roc_auc": round(val_roc_auc, 4),
            "pr_auc": round(val_pr_auc, 4),
            "recall": round(stats["recall"], 4),
            "precision": round(stats["precision"], 4),
            "f1": round(stats["f1"], 4),
            "brier_score": round(val_brier, 4),
        },
        "timestamp": "2026-09-26T17:42:00Z",
    }
    with open(MODELS_DIR / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    with open(METRICS_DIR / "val_metrics.json", "w", encoding="utf-8") as f:
        json.dump(metadata["val_metrics"], f, ensure_ascii=False, indent=2)

    print(f"\n✔ Model V3 artifacts successfully saved to: {MODELS_DIR}")


if __name__ == "__main__":
    main()
