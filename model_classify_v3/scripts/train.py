"""
model_classify_v3/scripts/train.py
=================================
Train Vietnamese Transaction Category Classifier (v3):
- Hybrid Word (1,2) + Char (3,4) N-grams with sublinear TF-IDF representation.
- Softmax Multi-Class Logistic Regression with L2 regularization & Adam Optimizer.
- Strictly tunes hyper-parameters & evaluates confidence thresholds on VALIDATION SET.
- Serializes model artifact, vectorizer, metadata, and calibrated confidence thresholds.
"""

import sys
import json
import math
import pickle
import time
from pathlib import Path
from collections import Counter, defaultdict
from typing import Dict, Any, List, Tuple
import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from preprocess import extract_ngrams

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


class TfIdfVectorizerHybrid:
    def __init__(
        self,
        use_word: bool = True,
        max_word_ngram: int = 2,
        use_char: bool = True,
        min_char_ngram: int = 3,
        max_char_ngram: int = 4,
        min_df: int = 2,
        max_features: int = 8000,
    ):
        self.use_word = use_word
        self.max_word_ngram = max_word_ngram
        self.use_char = use_char
        self.min_char_ngram = min_char_ngram
        self.max_char_ngram = max_char_ngram
        self.min_df = min_df
        self.max_features = max_features

        self.vocab: Dict[str, int] = {}
        self.idf: np.ndarray = np.array([], dtype=np.float32)

    def fit(self, texts: List[str]):
        doc_freq = Counter()
        tokenized_docs = []

        for text in texts:
            toks = extract_ngrams(
                text,
                use_word=self.use_word,
                max_word_ngram=self.max_word_ngram,
                use_char=self.use_char,
                min_char_ngram=self.min_char_ngram,
                max_char_ngram=self.max_char_ngram,
            )
            tokenized_docs.append(toks)
            unique_toks = set(toks)
            doc_freq.update(unique_toks)

        N = len(texts)
        # Filter by min_df and sort by document frequency descending
        candidate_items = [
            (tok, df) for tok, df in doc_freq.items() if df >= self.min_df
        ]
        candidate_items.sort(key=lambda x: x[1], reverse=True)

        if self.max_features and len(candidate_items) > self.max_features:
            candidate_items = candidate_items[: self.max_features]

        self.vocab = {tok: idx for idx, (tok, _) in enumerate(candidate_items)}
        self.idf = np.zeros(len(self.vocab), dtype=np.float32)

        for tok, idx in self.vocab.items():
            df = doc_freq[tok]
            # Smooth IDF formula: ln((1 + N) / (1 + df)) + 1
            self.idf[idx] = math.log((1.0 + N) / (1.0 + df)) + 1.0

        return self

    def transform_single(self, text: str) -> np.ndarray:
        D = len(self.vocab)
        vec = np.zeros(D, dtype=np.float32)
        if not text:
            return vec

        toks = extract_ngrams(
            text,
            use_word=self.use_word,
            max_word_ngram=self.max_word_ngram,
            use_char=self.use_char,
            min_char_ngram=self.min_char_ngram,
            max_char_ngram=self.max_char_ngram,
        )
        tf_counter = Counter(toks)

        for tok, cnt in tf_counter.items():
            if tok in self.vocab:
                idx = self.vocab[tok]
                tf = 1.0 + math.log(cnt)
                vec[idx] = tf * self.idf[idx]

        norm = np.linalg.norm(vec)
        if norm > 1e-8:
            vec /= norm
        return vec

    def transform(self, texts: List[str]) -> np.ndarray:
        N = len(texts)
        D = len(self.vocab)
        X = np.zeros((N, D), dtype=np.float32)
        for i, text in enumerate(texts):
            X[i] = self.transform_single(text)
        return X


class SoftmaxLogisticRegression:
    def __init__(
        self,
        num_classes: int = 10,
        lr: float = 0.02,
        l2_reg: float = 1e-4,
        epochs: int = 45,
        batch_size: int = 64,
    ):
        self.num_classes = num_classes
        self.lr = lr
        self.l2_reg = l2_reg
        self.epochs = epochs
        self.batch_size = batch_size

        self.W: np.ndarray = np.array([])
        self.b: np.ndarray = np.array([])

    def _softmax(self, logits: np.ndarray) -> np.ndarray:
        exp_logits = np.exp(logits - np.max(logits, axis=1, keepdims=True))
        return exp_logits / np.sum(exp_logits, axis=1, keepdims=True)

    def fit(self, X_train: np.ndarray, y_train: np.ndarray, X_val: np.ndarray, y_val: np.ndarray):
        N, D = X_train.shape
        K = self.num_classes

        # Initialize weights with Xavier uniform
        limit = math.sqrt(6.0 / (D + K))
        self.W = np.random.uniform(-limit, limit, (D, K)).astype(np.float32)
        self.b = np.zeros((1, K), dtype=np.float32)

        # Adam optimizer state
        mW = np.zeros_like(self.W)
        vW = np.zeros_like(self.W)
        mb = np.zeros_like(self.b)
        vb = np.zeros_like(self.b)
        beta1, beta2, eps = 0.9, 0.999, 1e-8

        # Convert y_train to one-hot
        Y_train_onehot = np.zeros((N, K), dtype=np.float32)
        Y_train_onehot[np.arange(N), y_train] = 1.0

        t = 0
        best_val_f1 = 0.0
        best_W = self.W.copy()
        best_b = self.b.copy()

        indices = np.arange(N)

        for epoch in range(1, self.epochs + 1):
            np.random.shuffle(indices)
            for start in range(0, N, self.batch_size):
                t += 1
                batch_idx = indices[start : start + self.batch_size]
                xb = X_train[batch_idx]
                yb = Y_train_onehot[batch_idx]
                M = len(batch_idx)

                # Forward
                logits = np.dot(xb, self.W) + self.b
                probs = self._softmax(logits)

                # Backward
                grad_z = (probs - yb) / M
                grad_W = np.dot(xb.T, grad_z) + self.l2_reg * self.W
                grad_b = np.sum(grad_z, axis=0, keepdims=True)

                # Adam updates
                mW = beta1 * mW + (1.0 - beta1) * grad_W
                vW = beta2 * vW + (1.0 - beta2) * (grad_W ** 2)
                mW_hat = mW / (1.0 - beta1 ** t)
                vW_hat = vW / (1.0 - beta2 ** t)
                self.W -= self.lr * mW_hat / (np.sqrt(vW_hat) + eps)

                mb = beta1 * mb + (1.0 - beta1) * grad_b
                vb = beta2 * vb + (1.0 - beta2) * (grad_b ** 2)
                mb_hat = mb / (1.0 - beta1 ** t)
                vb_hat = vb / (1.0 - beta2 ** t)
                self.b -= self.lr * mb_hat / (np.sqrt(vb_hat) + eps)

            # Evaluate on Validation
            val_probs = self.predict_proba(X_val)
            val_preds = np.argmax(val_probs, axis=1)
            val_acc = np.mean(val_preds == y_val)

            # Macro F1
            f1_scores = []
            for k in range(K):
                tp = np.sum((val_preds == k) & (y_val == k))
                fp = np.sum((val_preds == k) & (y_val != k))
                fn = np.sum((val_preds != k) & (y_val == k))
                prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
                rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
                f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
                f1_scores.append(f1)
            macro_f1 = float(np.mean(f1_scores))

            if macro_f1 > best_val_f1:
                best_val_f1 = macro_f1
                best_W = self.W.copy()
                best_b = self.b.copy()

        self.W = best_W
        self.b = best_b
        return best_val_f1

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        logits = np.dot(X, self.W) + self.b
        return self._softmax(logits)

    def predict(self, X: np.ndarray) -> np.ndarray:
        probs = self.predict_proba(X)
        return np.argmax(probs, axis=1)


def calibrate_confidence_thresholds(
    val_probs: np.ndarray, val_preds: np.ndarray, y_val: np.ndarray
) -> Dict[str, float]:
    """
    Calibrate confidence thresholds exclusively on VALIDATION SET:
    - HIGH_THRESHOLD: Confidence level where accuracy >= 98%
    - LOW_THRESHOLD: Minimum acceptable confidence for suggesting a category (accuracy >= 80%)
    """
    correct = (val_preds == y_val)
    confidences = np.max(val_probs, axis=1)

    # Search for high threshold achieving >= 98% precision
    high_threshold = 0.65
    for t in np.linspace(0.40, 0.90, 51):
        mask = confidences >= t
        if np.sum(mask) >= 50:
            acc_at_t = np.mean(correct[mask])
            if acc_at_t >= 0.98:
                high_threshold = float(round(t, 2))
                break

    # Search for low threshold achieving >= 80% precision
    low_threshold = 0.35
    for t in np.linspace(0.20, 0.60, 41):
        mask = confidences >= t
        if np.sum(mask) >= 50:
            acc_at_t = np.mean(correct[mask])
            if acc_at_t >= 0.80:
                low_threshold = float(round(t, 2))
                break

    return {
        "high_threshold": high_threshold,
        "low_threshold": low_threshold,
        "high_accuracy": float(round(np.mean(correct[confidences >= high_threshold]), 4)),
        "coverage_high": float(round(np.mean(confidences >= high_threshold), 4)),
        "coverage_low": float(round(np.mean(confidences >= low_threshold), 4)),
    }


def main():
    print("=" * 80)
    print("       MODEL_CLASSIFY V3 TRAINING & VALIDATION BENCHMARK")
    print("=" * 80)

    # 1. Load data
    with open(DATA_DIR / "train.json", "r", encoding="utf-8") as f:
        train_data = json.load(f)
    with open(DATA_DIR / "val.json", "r", encoding="utf-8") as f:
        val_data = json.load(f)

    train_texts = [d["text"] for d in train_data]
    train_labels = np.array([CAT2IDX[d["category"]] for d in train_data], dtype=np.int32)

    val_texts = [d["text"] for d in val_data]
    val_labels = np.array([CAT2IDX[d["category"]] for d in val_data], dtype=np.int32)

    print(f"Loaded: Train={len(train_texts)} samples, Val={len(val_texts)} samples.")

    # 2. Fit Hybrid Vectorizer on TRAIN ONLY
    print("\n--- Fitting Hybrid Word+Char Vectorizer on TRAIN ONLY ---")
    t0 = time.perf_counter()
    vectorizer = TfIdfVectorizerHybrid(
        use_word=True,
        max_word_ngram=2,
        use_char=True,
        min_char_ngram=3,
        max_char_ngram=4,
        min_df=2,
        max_features=10000,
    )
    vectorizer.fit(train_texts)
    vec_time = time.perf_counter() - t0
    print(f"✔ Vectorizer fitted in {vec_time:.2f}s. Vocab size: {len(vectorizer.vocab)} features.")

    # Transform
    X_train = vectorizer.transform(train_texts)
    X_val = vectorizer.transform(val_texts)

    # 3. Train Softmax Classifier
    print("\n--- Training Softmax Multi-Class Logistic Regression (Adam) ---")
    t0 = time.perf_counter()
    clf = SoftmaxLogisticRegression(
        num_classes=10,
        lr=0.03,
        l2_reg=1e-4,
        epochs=40,
        batch_size=64,
    )
    best_val_f1 = clf.fit(X_train, train_labels, X_val, val_labels)
    train_time = time.perf_counter() - t0
    print(f"✔ Training finished in {train_time:.2f}s. Best Val Macro F1: {best_val_f1:.4f}")

    # 4. Calibrate Confidence Thresholds on VALIDATION ONLY
    val_probs = clf.predict_proba(X_val)
    val_preds = np.argmax(val_probs, axis=1)
    val_acc = float(np.mean(val_preds == val_labels))
    thresholds = calibrate_confidence_thresholds(val_probs, val_preds, val_labels)
    print(f"\n--- Validation Confidence Calibration ---")
    print(f"  • Overall Val Accuracy: {val_acc:.2%}")
    print(f"  • High Threshold:       {thresholds['high_threshold']} (Acc: {thresholds['high_accuracy']:.2%}, Coverage: {thresholds['coverage_high']:.2%})")
    print(f"  • Low Threshold:        {thresholds['low_threshold']} (Coverage: {thresholds['coverage_low']:.2%})")

    # 5. Serialize Artifacts
    # Vectorizer bundle
    v_bundle = {
        "vocab": vectorizer.vocab,
        "idf": vectorizer.idf,
        "use_word": vectorizer.use_word,
        "max_word_ngram": vectorizer.max_word_ngram,
        "use_char": vectorizer.use_char,
        "min_char_ngram": vectorizer.min_char_ngram,
        "max_char_ngram": vectorizer.max_char_ngram,
    }
    with open(MODELS_DIR / "vectorizer.pkl", "wb") as f:
        pickle.dump(v_bundle, f, protocol=pickle.HIGHEST_PROTOCOL)

    # Classifier bundle
    c_bundle = {
        "W": clf.W,
        "b": clf.b,
        "categories": CATEGORIES,
    }
    with open(MODELS_DIR / "classifier_model.pkl", "wb") as f:
        pickle.dump(c_bundle, f, protocol=pickle.HIGHEST_PROTOCOL)

    # Metadata
    metadata = {
        "model_name": "model_classify_v3",
        "approach": "Hybrid TF-IDF (Word (1,2) + Char (3,4)) + Softmax Logistic Regression (Adam)",
        "categories": CATEGORIES,
        "num_classes": 10,
        "train_samples": len(train_texts),
        "val_samples": len(val_texts),
        "vocab_size": len(vectorizer.vocab),
        "val_accuracy": round(val_acc, 4),
        "val_macro_f1": round(best_val_f1, 4),
        "confidence_thresholds": thresholds,
        "timestamp": "2026-09-26T17:40:00Z",
    }
    with open(MODELS_DIR / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    with open(MODELS_DIR / "confidence_thresholds.json", "w", encoding="utf-8") as f:
        json.dump(thresholds, f, ensure_ascii=False, indent=2)

    print(f"\n✔ Model V3 artifacts successfully saved to: {MODELS_DIR}")


if __name__ == "__main__":
    main()
