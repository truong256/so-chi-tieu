"""
model_classify_v2/scripts/train.py
==================================
Train Vietnamese Transaction Category Classifier (v2):
- Feature representation: Combined Word N-grams (1, 2) + Character N-grams (3, 4)
- TF-IDF weighting with sublinear scaling
- Multiclass Softmax Linear Classifier with L2 Regularization (trained via Adam optimizer)
- Model comparison: Word ngrams vs Char ngrams vs Word+Char ngrams
- Evaluation on Val and Test sets
- Serializes artifacts to model_classify_v2/models/
"""

import sys
import json
import time
import pickle
import math
from pathlib import Path
from collections import Counter, defaultdict
from typing import List, Dict, Tuple, Set, Any
import numpy as np

# Ensure scripts dir is on sys.path
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from preprocess import clean_vietnamese_text, remove_vietnamese_accents

BASE_DIR = SCRIPTS_DIR.parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
METRICS_DIR = BASE_DIR / "metrics"

MODELS_DIR.mkdir(parents=True, exist_ok=True)
METRICS_DIR.mkdir(parents=True, exist_ok=True)

CATEGORIES = [
    "ăn uống",
    "di chuyển",
    "mua sắm",
    "hóa đơn",
    "giải trí",
    "sức khỏe",
    "giáo dục",
    "đầu tư",
    "thu nhập",
    "khác",
]
CAT2IDX = {c: i for i, c in enumerate(CATEGORIES)}
IDX2CAT = {i: c for i, c in enumerate(CATEGORIES)}


class VietnameseTfidfVectorizer:
    """
    Zero-dependency TF-IDF Vectorizer supporting:
    - Word ngrams (1 to max_word_ngram)
    - Character ngrams (min_char_ngram to max_char_ngram)
    - Sublinear TF and L2 normalization
    """
    def __init__(
        self,
        use_word: bool = True,
        max_word_ngram: int = 2,
        use_char: bool = True,
        min_char_ngram: int = 3,
        max_char_ngram: int = 4,
        max_features: int = 12000,
        min_df: int = 2,
    ):
        self.use_word = use_word
        self.max_word_ngram = max_word_ngram
        self.use_char = use_char
        self.min_char_ngram = min_char_ngram
        self.max_char_ngram = max_char_ngram
        self.max_features = max_features
        self.min_df = min_df

        self.vocab: Dict[str, int] = {}
        self.idf: np.ndarray = np.array([])

    def _extract_tokens(self, text: str) -> List[str]:
        cleaned = clean_vietnamese_text(text)
        tokens = []
        words = cleaned.split()

        # Word ngrams
        if self.use_word and words:
            for n in range(1, self.max_word_ngram + 1):
                for i in range(len(words) - n + 1):
                    tokens.append("w:" + " ".join(words[i:i+n]))

        # Char ngrams (includes word boundaries)
        if self.use_char and cleaned:
            padded = f" {cleaned} "
            for n in range(self.min_char_ngram, self.max_char_ngram + 1):
                for i in range(len(padded) - n + 1):
                    tokens.append("c:" + padded[i:i+n])

        return tokens

    def fit(self, texts: List[str]):
        df_counter = Counter()
        N = len(texts)

        for text in texts:
            unique_tokens = set(self._extract_tokens(text))
            for tok in unique_tokens:
                df_counter[tok] += 1

        # Filter by min_df and select top max_features
        filtered_items = [
            (tok, count) for tok, count in df_counter.items() if count >= self.min_df
        ]
        filtered_items.sort(key=lambda x: -x[1])
        selected_tokens = filtered_items[:self.max_features]

        self.vocab = {tok: idx for idx, (tok, _) in enumerate(selected_tokens)}
        # Compute smooth IDF: log((1 + N) / (1 + df)) + 1
        idf_list = []
        for tok, idx in self.vocab.items():
            df_val = df_counter[tok]
            idf = math.log((1.0 + N) / (1.0 + df_val)) + 1.0
            idf_list.append(idf)

        self.idf = np.array(idf_list, dtype=np.float32)
        return self

    def transform(self, texts: List[str]) -> np.ndarray:
        N = len(texts)
        D = len(self.vocab)
        X = np.zeros((N, D), dtype=np.float32)

        for i, text in enumerate(texts):
            tokens = self._extract_tokens(text)
            tf_counter = Counter(tokens)
            for tok, cnt in tf_counter.items():
                if tok in self.vocab:
                    idx = self.vocab[tok]
                    # Sublinear TF: 1 + log(cnt)
                    tf = 1.0 + math.log(cnt)
                    X[i, idx] = tf * self.idf[idx]

            # L2 normalize row
            norm = np.linalg.norm(X[i])
            if norm > 1e-8:
                X[i] /= norm

        return X

    def fit_transform(self, texts: List[str]) -> np.ndarray:
        return self.fit(texts).transform(texts)


class SoftmaxLogisticRegression:
    """
    Multiclass Softmax Classifier with L2 Regularization.
    Trained via Mini-batch Adam optimizer.
    """
    def __init__(self, num_classes: int, l2_reg: float = 1e-4, lr: float = 0.05):
        self.num_classes = num_classes
        self.l2_reg = l2_reg
        self.lr = lr
        self.W: np.ndarray = None  # (num_features, num_classes)
        self.b: np.ndarray = None  # (1, num_classes)

    def _softmax(self, logits: np.ndarray) -> np.ndarray:
        shifted = logits - np.max(logits, axis=1, keepdims=True)
        exp_logits = np.exp(shifted)
        return exp_logits / np.sum(exp_logits, axis=1, keepdims=True)

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        logits = np.dot(X, self.W) + self.b
        return self._softmax(logits)

    def predict(self, X: np.ndarray) -> np.ndarray:
        probs = self.predict_proba(X)
        return np.argmax(probs, axis=1)

    def fit(self, X_train: np.ndarray, y_train: np.ndarray, epochs: int = 150, batch_size: int = 64):
        N, D = X_train.shape
        K = self.num_classes

        # Initialize weights
        self.W = np.zeros((D, K), dtype=np.float32)
        self.b = np.zeros((1, K), dtype=np.float32)

        # One-hot encode targets
        Y = np.zeros((N, K), dtype=np.float32)
        Y[np.arange(N), y_train] = 1.0

        # Adam optimizer state
        mW, vW = np.zeros_like(self.W), np.zeros_like(self.W)
        mb, vb = np.zeros_like(self.b), np.zeros_like(self.b)
        beta1, beta2, eps = 0.9, 0.999, 1e-8
        t = 0

        for epoch in range(epochs):
            indices = np.random.permutation(N)
            X_shuffled = X_train[indices]
            Y_shuffled = Y[indices]

            for start in range(0, N, batch_size):
                t += 1
                end = min(start + batch_size, N)
                xb = X_shuffled[start:end]
                yb = Y_shuffled[start:end]
                B = xb.shape[0]

                # Forward
                probs = self._softmax(np.dot(xb, self.W) + self.b)

                # Gradients
                dz = (probs - yb) / B
                dW = np.dot(xb.T, dz) + self.l2_reg * self.W
                db = np.sum(dz, axis=0, keepdims=True)

                # Adam step
                for param, grad, m, v in [
                    (self.W, dW, mW, vW),
                    (self.b, db, mb, vb),
                ]:
                    m[:] = beta1 * m + (1.0 - beta1) * grad
                    v[:] = beta2 * v + (1.0 - beta2) * (grad ** 2)
                    m_hat = m / (1.0 - beta1 ** t)
                    v_hat = v / (1.0 - beta2 ** t)
                    param -= self.lr * m_hat / (np.sqrt(v_hat) + eps)

        return self


def compute_classification_metrics(y_true: List[str], y_pred: List[str]) -> Dict[str, Any]:
    classes = CATEGORIES
    y_true_arr = np.array(y_true)
    y_pred_arr = np.array(y_pred)

    acc = float(np.mean(y_true_arr == y_pred_arr))

    f1s = []
    class_stats = {}
    for c in classes:
        tp = int(np.sum((y_true_arr == c) & (y_pred_arr == c)))
        fp = int(np.sum((y_true_arr != c) & (y_pred_arr == c)))
        fn = int(np.sum((y_true_arr == c) & (y_pred_arr != c)))

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
        f1s.append(f1)

        class_stats[c] = {
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1_score": round(f1, 4),
            "support": int(np.sum(y_true_arr == c)),
        }

    macro_f1 = float(np.mean(f1s))
    min_recall = min(v["recall"] for v in class_stats.values())

    return {
        "accuracy": round(acc, 4),
        "macro_f1": round(macro_f1, 4),
        "min_class_recall": round(min_recall, 4),
        "class_stats": class_stats,
    }


def main():
    print("================================================================================")
    print("               MODEL_CLASSIFY V2 — TRAINING & MODEL SELECTION                   ")
    print("================================================================================")

    # Load splits
    with open(DATA_DIR / "train.json", "r", encoding="utf-8") as f:
        train_data = json.load(f)
    with open(DATA_DIR / "val.json", "r", encoding="utf-8") as f:
        val_data = json.load(f)
    with open(DATA_DIR / "test.json", "r", encoding="utf-8") as f:
        test_data = json.load(f)

    X_train_raw = [item["text"] for item in train_data]
    y_train = np.array([CAT2IDX[item["category"]] for item in train_data], dtype=np.int32)

    X_val_raw = [item["text"] for item in val_data]
    y_val_str = [item["category"] for item in val_data]

    X_test_raw = [item["text"] for item in test_data]
    y_test_str = [item["category"] for item in test_data]

    print(f"Train samples: {len(X_train_raw)}")
    print(f"Val samples:   {len(X_val_raw)}")
    print(f"Test samples:  {len(X_test_raw)}")

    # -------------------------------------------------------------------------
    # ABLATION & COMPARISON: Word ngrams vs Char ngrams vs Combined Word+Char
    # -------------------------------------------------------------------------
    configs = [
        {"name": "Word N-grams only (1, 2)", "use_word": True, "use_char": False},
        {"name": "Char N-grams only (3, 4)", "use_word": False, "use_char": True},
        {"name": "Combined Word + Char N-grams", "use_word": True, "use_char": True},
    ]

    best_f1 = 0.0
    best_vectorizer = None
    best_clf = None
    best_cfg_name = ""

    print("\n--- Model Architecture Comparison (Validation Set) ---")
    for cfg in configs:
        vec = VietnameseTfidfVectorizer(
            use_word=cfg["use_word"],
            max_word_ngram=2,
            use_char=cfg["use_char"],
            min_char_ngram=3,
            max_char_ngram=4,
            max_features=12000,
        )
        X_tr = vec.fit_transform(X_train_raw)
        X_va = vec.transform(X_val_raw)

        clf = SoftmaxLogisticRegression(num_classes=len(CATEGORIES), l2_reg=1e-4, lr=0.08)
        clf.fit(X_tr, y_train, epochs=120, batch_size=64)

        preds_val = [IDX2CAT[i] for i in clf.predict(X_va)]
        metrics_val = compute_classification_metrics(y_val_str, preds_val)

        print(f"  • {cfg['name']:<32}: Acc={metrics_val['accuracy']:.2%}, Macro F1={metrics_val['macro_f1']:.4f}, Min Recall={metrics_val['min_class_recall']:.4f}")

        if metrics_val["macro_f1"] > best_f1:
            best_f1 = metrics_val["macro_f1"]
            best_vectorizer = vec
            best_clf = clf
            best_cfg_name = cfg["name"]

    print(f"\n✔ Selected best configuration: {best_cfg_name} (Val Macro F1 = {best_f1:.4f})")

    # Evaluate best model on TEST SET
    X_te = best_vectorizer.transform(X_test_raw)
    preds_test = [IDX2CAT[i] for i in best_clf.predict(X_te)]
    metrics_test = compute_classification_metrics(y_test_str, preds_test)

    print("\n================================================================================")
    print("                     EVALUATION ON UNTOUCHED TEST SET                          ")
    print("================================================================================")
    print(f"Accuracy:         {metrics_test['accuracy']:.2%}")
    print(f"Macro F1:         {metrics_test['macro_f1']:.4f}")
    print(f"Min Class Recall: {metrics_test['min_class_recall']:.4f}")
    print("\nPer-Class Breakdown:")
    for c in CATEGORIES:
        stats = metrics_test["class_stats"][c]
        print(f"  • {c:<12}: Precision={stats['precision']:.4f}, Recall={stats['recall']:.4f}, F1={stats['f1_score']:.4f} (n={stats['support']})")

    # Save artifacts
    vectorizer_bundle = {
        "vocab": best_vectorizer.vocab,
        "idf": best_vectorizer.idf,
        "use_word": best_vectorizer.use_word,
        "max_word_ngram": best_vectorizer.max_word_ngram,
        "use_char": best_vectorizer.use_char,
        "min_char_ngram": best_vectorizer.min_char_ngram,
        "max_char_ngram": best_vectorizer.max_char_ngram,
        "max_features": best_vectorizer.max_features,
    }
    with open(MODELS_DIR / "vectorizer.pkl", "wb") as f:
        pickle.dump(vectorizer_bundle, f)

    classifier_bundle = {
        "W": best_clf.W,
        "b": best_clf.b,
        "categories": CATEGORIES,
        "num_classes": len(CATEGORIES),
    }
    with open(MODELS_DIR / "classifier_model.pkl", "wb") as f:
        pickle.dump(classifier_bundle, f)

    # Save metadata.json
    metadata = {
        "model_name": "model_classify_v2",
        "approach": "TF-IDF (Word (1,2) + Char (3,4)) + Softmax Logistic Regression (Adam)",
        "categories": CATEGORIES,
        "num_classes": len(CATEGORIES),
        "best_configuration": best_cfg_name,
        "train_samples": len(X_train_raw),
        "val_samples": len(X_val_raw),
        "test_samples": len(X_test_raw),
        "vocab_size": len(best_vectorizer.vocab),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(MODELS_DIR / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    # Save metrics.json
    with open(METRICS_DIR / "metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics_test, f, ensure_ascii=False, indent=2)

    print(f"\n✔ Model saved:    {MODELS_DIR / 'classifier_model.pkl'}")
    print(f"✔ Vectorizer saved: {MODELS_DIR / 'vectorizer.pkl'}")
    print(f"✔ Metadata saved:   {MODELS_DIR / 'metadata.json'}")
    print(f"✔ Metrics saved:    {METRICS_DIR / 'metrics.json'}")
    print("================================================================================")


if __name__ == "__main__":
    main()
