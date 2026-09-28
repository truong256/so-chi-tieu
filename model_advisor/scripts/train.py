"""
model_advisor/scripts/train.py
==============================
Training pipeline for model_advisor:
- Feature extraction from financial profiles (20 features)
- Feature normalization (StandardScaler)
- Multi-class Softmax Neural Classifier for Health Grade (CRITICAL, CAUTION, HEALTHY, EXCELLENT)
- Ridge Regressor for continuous Risk Score [0.0, 1.0]
- Model artifact serialization to model_advisor/models/
- Evaluation on train/val/test splits and metrics generation

Usage:
    python model_advisor/scripts/train.py
"""

import os
import json
import time
import pickle
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Tuple
import numpy as np

# Set deterministic random seed
np.random.seed(42)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
METRICS_DIR = BASE_DIR / "metrics"

MODELS_DIR.mkdir(parents=True, exist_ok=True)
METRICS_DIR.mkdir(parents=True, exist_ok=True)

CLASS_LABELS = ["CRITICAL", "CAUTION", "HEALTHY", "EXCELLENT"]
LABEL_TO_IDX = {lbl: i for i, lbl in enumerate(CLASS_LABELS)}
IDX_TO_LABEL = {i: lbl for i, lbl in enumerate(CLASS_LABELS)}

FEATURE_NAMES = [
    "savings_rate",
    "expense_to_income",
    "net_flow_log",
    "expense_growth",
    "emergency_months",
    "emergency_months_capped",
    "needs_ratio",
    "wants_ratio",
    "overbudget_count",
    "overbudget_total_ratio",
    "max_overbudget_ratio",
    "food_ratio",
    "housing_ratio",
    "entertainment_ratio",
    "shopping_ratio",
    "savings_goals_count",
    "savings_goals_avg_progress",
    "wallets_count",
    "log_income",
    "log_expense",
]


def extract_features(profile: Dict[str, Any]) -> np.ndarray:
    """Extract a 20-dimensional feature vector from a financial profile."""
    income = float(profile.get("income", 0.0))
    expense = float(profile.get("expense", 0.0))
    prev_expense = float(profile.get("previous_month_expense", expense))
    categories = profile.get("categories", [])
    wallets = profile.get("wallets", [])
    savings_goals = profile.get("savings_goals", [])

    net_flow = income - expense
    if income > 0:
        savings_rate = net_flow / income
        expense_to_income = min(expense / income, 5.0)
    else:
        savings_rate = -1.0 if expense > 0 else 0.0
        expense_to_income = 5.0 if expense > 0 else 0.0

    net_flow_log = np.sign(net_flow) * np.log1p(np.abs(net_flow))
    expense_growth = ((expense - prev_expense) / prev_expense) if prev_expense > 0 else 0.0

    total_wallet = sum(float(w.get("balance", 0.0)) for w in wallets)
    emergency_months = (total_wallet / expense) if expense > 0 else 0.0
    emergency_months_capped = min(emergency_months, 12.0)

    # Categories breakdown
    cat_expenses = {c.get("name", ""): float(c.get("amount", 0.0)) for c in categories}
    needs_names = ["Ăn uống gia đình", "Thuê nhà & Nhà ở", "Đi lại & Xăng xe", "Tiện ích (Điện, Nước, Net)", "Y tế & Sức khỏe"]
    wants_names = ["Ăn ngoài & Cafe", "Mua sắm & Quần áo", "Giải trí & Dịch vụ số", "Làm đẹp & Chăm sóc cá nhân", "Du lịch & Giao lưu bạn bè"]

    needs_sum = sum(cat_expenses.get(k, 0.0) for k in needs_names)
    wants_sum = sum(cat_expenses.get(k, 0.0) for k in wants_names)

    needs_ratio = (needs_sum / expense) if expense > 0 else 0.0
    wants_ratio = (wants_sum / expense) if expense > 0 else 0.0

    # Overbudget analysis
    overbudget_count = 0
    overbudget_total = 0.0
    max_over_ratio = 0.0
    for c in categories:
        b = float(c.get("budget", 0.0))
        a = float(c.get("amount", 0.0))
        if b > 0 and a > b:
            overbudget_count += 1
            overbudget_total += (a - b)
            max_over_ratio = max(max_over_ratio, a / b)

    overbudget_total_ratio = (overbudget_total / income) if income > 0 else 0.0

    # Specific category ratios
    food_ratio = (cat_expenses.get("Ăn uống gia đình", 0.0) + cat_expenses.get("Ăn ngoài & Cafe", 0.0)) / expense if expense > 0 else 0.0
    housing_ratio = cat_expenses.get("Thuê nhà & Nhà ở", 0.0) / expense if expense > 0 else 0.0
    entertainment_ratio = cat_expenses.get("Giải trí & Dịch vụ số", 0.0) / expense if expense > 0 else 0.0
    shopping_ratio = cat_expenses.get("Mua sắm & Quần áo", 0.0) / expense if expense > 0 else 0.0

    # Savings goals & wallets
    savings_goals_count = float(len(savings_goals))
    progresses = [(float(g.get("current", 0)) / float(g.get("target", 1))) for g in savings_goals if float(g.get("target", 1)) > 0]
    savings_goals_avg_progress = float(np.mean(progresses)) if progresses else 0.0
    wallets_count = float(len(wallets))

    log_income = float(np.log10(max(income, 1.0)))
    log_expense = float(np.log10(max(expense, 1.0)))

    feat = np.array([
        savings_rate,
        expense_to_income,
        net_flow_log,
        expense_growth,
        emergency_months,
        emergency_months_capped,
        needs_ratio,
        wants_ratio,
        float(overbudget_count),
        overbudget_total_ratio,
        max_over_ratio,
        food_ratio,
        housing_ratio,
        entertainment_ratio,
        shopping_ratio,
        savings_goals_count,
        savings_goals_avg_progress,
        wallets_count,
        log_income,
        log_expense,
    ], dtype=np.float32)

    return feat


class StandardScalerCustom:
    """Zero-dependency standard scaler."""
    def __init__(self):
        self.mean = None
        self.scale = None

    def fit(self, X: np.ndarray):
        self.mean = np.mean(X, axis=0)
        self.scale = np.std(X, axis=0)
        self.scale[self.scale < 1e-8] = 1.0
        return self

    def transform(self, X: np.ndarray) -> np.ndarray:
        return (X - self.mean) / self.scale

    def fit_transform(self, X: np.ndarray) -> np.ndarray:
        return self.fit(X).transform(X)


class SoftmaxMLPClassifier:
    """
    2-Layer Neural Network with ReLU activation and Softmax output.
    Trained with Adam optimizer and Cross-Entropy loss + L2 regularization.
    """
    def __init__(self, in_dim=20, hidden_dim=32, out_dim=4, l2_reg=1e-4, lr=0.01):
        self.in_dim = in_dim
        self.hidden_dim = hidden_dim
        self.out_dim = out_dim
        self.l2_reg = l2_reg
        self.lr = lr

        # Xavier initialization
        self.W1 = np.random.randn(in_dim, hidden_dim).astype(np.float32) * np.sqrt(2.0 / in_dim)
        self.b1 = np.zeros((1, hidden_dim), dtype=np.float32)
        self.W2 = np.random.randn(hidden_dim, out_dim).astype(np.float32) * np.sqrt(2.0 / hidden_dim)
        self.b2 = np.zeros((1, out_dim), dtype=np.float32)

    def _relu(self, z):
        return np.maximum(0, z)

    def _softmax(self, z):
        exp_z = np.exp(z - np.max(z, axis=1, keepdims=True))
        return exp_z / np.sum(exp_z, axis=1, keepdims=True)

    def forward(self, X):
        z1 = np.dot(X, self.W1) + self.b1
        a1 = self._relu(z1)
        z2 = np.dot(a1, self.W2) + self.b2
        probs = self._softmax(z2)
        return a1, probs

    def predict_proba(self, X):
        _, probs = self.forward(X)
        return probs

    def predict(self, X):
        probs = self.predict_proba(X)
        return np.argmax(probs, axis=1)

    def fit(self, X_train, y_train, X_val, y_val, epochs=450, batch_size=32):
        N = X_train.shape[0]
        num_classes = self.out_dim

        # One-hot encode y_train
        Y_train = np.zeros((N, num_classes), dtype=np.float32)
        Y_train[np.arange(N), y_train] = 1.0

        # Adam momentum variables
        mW1, vW1 = np.zeros_like(self.W1), np.zeros_like(self.W1)
        mb1, vb1 = np.zeros_like(self.b1), np.zeros_like(self.b1)
        mW2, vW2 = np.zeros_like(self.W2), np.zeros_like(self.W2)
        mb2, vb2 = np.zeros_like(self.b2), np.zeros_like(self.b2)
        beta1, beta2, eps = 0.9, 0.999, 1e-8
        t = 0

        best_val_acc = 0.0
        best_weights = None

        for epoch in range(1, epochs + 1):
            # Shuffle
            indices = np.random.permutation(N)
            X_shuffled = X_train[indices]
            Y_shuffled = Y_train[indices]

            for start in range(0, N, batch_size):
                t += 1
                end = min(start + batch_size, N)
                xb = X_shuffled[start:end]
                yb = Y_shuffled[start:end]
                B = xb.shape[0]

                # Forward
                a1, probs = self.forward(xb)

                # Gradients
                dz2 = (probs - yb) / B  # (B, out_dim)
                dW2 = np.dot(a1.T, dz2) + self.l2_reg * self.W2
                db2 = np.sum(dz2, axis=0, keepdims=True)

                da1 = np.dot(dz2, self.W2.T)
                dz1 = da1 * (a1 > 0)
                dW1 = np.dot(xb.T, dz1) + self.l2_reg * self.W1
                db1 = np.sum(dz1, axis=0, keepdims=True)

                # Adam updates
                for p, grad, m, v in [
                    (self.W1, dW1, mW1, vW1),
                    (self.b1, db1, mb1, vb1),
                    (self.W2, dW2, mW2, vW2),
                    (self.b2, db2, mb2, vb2),
                ]:
                    m[:] = beta1 * m + (1.0 - beta1) * grad
                    v[:] = beta2 * v + (1.0 - beta2) * (grad ** 2)
                    m_corr = m / (1.0 - beta1 ** t)
                    v_corr = v / (1.0 - beta2 ** t)
                    p -= self.lr * m_corr / (np.sqrt(v_corr) + eps)

            # Validation check
            if epoch % 10 == 0 or epoch == epochs:
                val_preds = self.predict(X_val)
                val_acc = np.mean(val_preds == y_val)
                if val_acc >= best_val_acc:
                    best_val_acc = val_acc
                    best_weights = {
                        "W1": self.W1.copy(),
                        "b1": self.b1.copy(),
                        "W2": self.W2.copy(),
                        "b2": self.b2.copy(),
                    }

        # Restore best weights
        if best_weights is not None:
            self.W1 = best_weights["W1"]
            self.b1 = best_weights["b1"]
            self.W2 = best_weights["W2"]
            self.b2 = best_weights["b2"]

        return self


class RidgeRegressor:
    """Closed-form Ridge Regression for continuous risk score prediction."""
    def __init__(self, alpha=1.0):
        self.alpha = alpha
        self.weights = None
        self.intercept = 0.0

    def fit(self, X: np.ndarray, y: np.ndarray):
        N, D = X.shape
        X_aug = np.hstack([np.ones((N, 1), dtype=np.float32), X])
        I = np.eye(D + 1, dtype=np.float32)
        I[0, 0] = 0.0  # Do not regularize intercept

        # Solve (X^T X + alpha * I) theta = X^T y
        A = np.dot(X_aug.T, X_aug) + self.alpha * I
        b = np.dot(X_aug.T, y)
        theta = np.linalg.solve(A, b)

        self.intercept = float(theta[0])
        self.weights = theta[1:]
        return self

    def predict(self, X: np.ndarray) -> np.ndarray:
        preds = np.dot(X, self.weights) + self.intercept
        return np.clip(preds, 0.0, 1.0)


def load_dataset_split(filename: str):
    path = DATA_DIR / filename
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    X_list = []
    y_class_list = []
    y_risk_list = []
    y_conf_list = []

    for item in data:
        feat = extract_features(item)
        gt = item["ground_truth"]
        X_list.append(feat)
        y_class_list.append(LABEL_TO_IDX[gt["health_grade"]])
        y_risk_list.append(float(gt["risk_score"]))
        y_conf_list.append(float(gt["confidence"]))

    return np.array(X_list, dtype=np.float32), np.array(y_class_list, dtype=np.int32), np.array(y_risk_list, dtype=np.float32), np.array(y_conf_list, dtype=np.float32), data


def evaluate_model(clf: SoftmaxMLPClassifier, reg: RidgeRegressor, scaler: StandardScalerCustom, data_items: List[Dict[str, Any]]):
    X = np.array([extract_features(item) for item in data_items], dtype=np.float32)
    X_norm = scaler.transform(X)

    y_true_grade = [item["ground_truth"]["health_grade"] for item in data_items]
    y_true_risk = [item["ground_truth"]["risk_score"] for item in data_items]

    t0 = time.perf_counter()
    pred_indices = clf.predict(X_norm)
    y_pred_grade = [IDX_TO_LABEL[i] for i in pred_indices]
    y_pred_risk = reg.predict(X_norm).tolist()
    total_time_ms = (time.perf_counter() - t0) * 1000.0
    avg_latency = total_time_ms / len(data_items)

    y_true_arr = np.array(y_true_grade)
    y_pred_arr = np.array(y_pred_grade)

    acc = float(np.mean(y_true_arr == y_pred_arr))

    # Per class metrics
    classes = sorted(CLASS_LABELS)
    f1s = []
    class_metrics = {}
    for c in classes:
        tp = int(np.sum((y_true_arr == c) & (y_pred_arr == c)))
        fp = int(np.sum((y_true_arr != c) & (y_pred_arr == c)))
        fn = int(np.sum((y_true_arr == c) & (y_pred_arr != c)))

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
        f1s.append(f1)
        class_metrics[c] = {
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1_score": round(f1, 4),
            "support": int(np.sum(y_true_arr == c)),
        }

    macro_f1 = float(np.mean(f1s)) if f1s else 0.0
    mae_risk = float(np.mean(np.abs(np.array(y_true_risk) - np.array(y_pred_risk))))

    return {
        "accuracy": round(acc, 4),
        "macro_f1": round(macro_f1, 4),
        "risk_mae": round(mae_risk, 4),
        "class_metrics": class_metrics,
        "avg_latency_ms": round(avg_latency, 3),
    }


def main():
    print("==================================================")
    print("TRAINING PERSONAL FINANCIAL ADVISOR MODEL")
    print("==================================================")

    print("→ 1. Loading datasets (train, val, test)...")
    X_train, y_train_class, y_train_risk, y_train_conf, train_data = load_dataset_split("train.json")
    X_val, y_val_class, y_val_risk, y_val_conf, val_data = load_dataset_split("val.json")
    X_test, y_test_class, y_test_risk, y_test_conf, test_data = load_dataset_split("test.json")

    print(f"   Train samples: {len(X_train)} (Features: {X_train.shape[1]})")
    print(f"   Val samples:   {len(X_val)}")
    print(f"   Test samples:  {len(X_test)}")

    print("→ 2. Fitting StandardScaler...")
    scaler = StandardScalerCustom()
    X_train_norm = scaler.fit_transform(X_train)
    X_val_norm = scaler.transform(X_val)
    X_test_norm = scaler.transform(X_test)

    print("→ 3. Training Softmax MLP Health Classifier...")
    clf = SoftmaxMLPClassifier(in_dim=20, hidden_dim=32, out_dim=4, l2_reg=1e-4, lr=0.015)
    t_clf_start = time.perf_counter()
    clf.fit(X_train_norm, y_train_class, X_val_norm, y_val_class, epochs=450, batch_size=32)
    clf_time = time.perf_counter() - t_clf_start
    print(f"   Classifier trained in {clf_time:.2f}s")

    print("→ 4. Training Ridge Risk Regressor...")
    t_reg_start = time.perf_counter()
    reg = RidgeRegressor(alpha=5.0)
    reg.fit(X_train_norm, y_train_risk)
    reg_time = time.perf_counter() - t_reg_start
    print(f"   Ridge Regressor trained in {reg_time:.4f}s")

    print("→ 5. Evaluating on Splits...")
    train_eval = evaluate_model(clf, reg, scaler, train_data)
    val_eval = evaluate_model(clf, reg, scaler, val_data)
    test_eval = evaluate_model(clf, reg, scaler, test_data)

    print("\n--- RESULTS ON TEST SPLIT ---")
    print(f"Accuracy:       {test_eval['accuracy']:.2%}")
    print(f"Macro F1:       {test_eval['macro_f1']:.4f}")
    print(f"Risk Score MAE: {test_eval['risk_mae']:.4f}")
    print(f"Avg Latency:    {test_eval['avg_latency_ms']:.3f} ms")

    # Save serialized model bundle (pure numpy arrays to avoid pickle module mismatch)
    bundle = {
        "scaler": {
            "mean": scaler.mean,
            "scale": scaler.scale,
        },
        "classifier": {
            "W1": clf.W1,
            "b1": clf.b1,
            "W2": clf.W2,
            "b2": clf.b2,
        },
        "regressor": {
            "weights": reg.weights,
            "intercept": reg.intercept,
        },
        "feature_names": FEATURE_NAMES,
        "class_labels": CLASS_LABELS,
    }

    model_pkl_path = MODELS_DIR / "advisor_model.pkl"
    with open(model_pkl_path, "wb") as f:
        pickle.dump(bundle, f)
    print(f"\n✔ Model bundle saved: {model_pkl_path}")

    # Save metadata.json
    metadata = {
        "model_type": "AdvisorEnsemble_SoftmaxMLP_Ridge",
        "approach": "Supervised Feature Classification + Metric Regression + Contextual Synthesis",
        "features": FEATURE_NAMES,
        "num_features": len(FEATURE_NAMES),
        "target_classes": CLASS_LABELS,
        "train_samples": len(X_train),
        "val_samples": len(X_val),
        "test_samples": len(X_test),
        "hyperparameters": {
            "hidden_dim": 32,
            "learning_rate": 0.015,
            "epochs": 450,
            "batch_size": 32,
            "l2_reg": 1e-4,
            "ridge_alpha": 5.0,
            "seed": 42,
        },
        "training_timestamp": datetime.utcnow().isoformat() + "Z",
        "model_file": "advisor_model.pkl",
    }
    with open(MODELS_DIR / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    print(f"✔ Metadata saved:     {MODELS_DIR / 'metadata.json'}")

    # Save metrics.json
    metrics_report = {
        "model_name": "model_advisor_v1",
        "train_metrics": train_eval,
        "validation_metrics": val_eval,
        "test_metrics": test_eval,
        "model_status": "ACCEPT" if test_eval["accuracy"] >= 0.90 and test_eval["risk_mae"] <= 0.10 else "REJECT",
    }
    with open(METRICS_DIR / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics_report, f, ensure_ascii=False, indent=2)
    print(f"✔ Metrics saved:      {METRICS_DIR / 'metrics.json'}")
    print(f"✔ Model Status:       {metrics_report['model_status']}")
    print("==================================================")


if __name__ == "__main__":
    main()
