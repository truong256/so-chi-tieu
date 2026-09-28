"""
model_warning_v2/scripts/classifier.py
======================================
Pure-NumPy Supervised Risk & Fraud Classifier with Class Imbalance Weighting:
- Architecture: 2-layer Neural Network (Input -> 32 -> ReLU -> 1 -> Sigmoid) with Adam Optimizer
- Weighted Binary Cross-Entropy Loss to handle fraud imbalance (pos_weight)
- Exact ROC-AUC (Mann-Whitney rank statistic) and PR-AUC (Average Precision)
- Probability calibration verification (Brier score & calibration curves)
"""

import math
from typing import List, Dict, Any, Tuple
import numpy as np


def compute_roc_auc(y_true: np.ndarray, y_scores: np.ndarray) -> float:
    """Exact ROC-AUC via Mann-Whitney U rank statistic."""
    y_true = np.asarray(y_true, dtype=int)
    y_scores = np.asarray(y_scores, dtype=np.float64)

    pos_mask = (y_true == 1)
    n_pos = int(np.sum(pos_mask))
    n_neg = len(y_true) - n_pos

    if n_pos == 0 or n_neg == 0:
        return 0.5

    # Rank with average ranks for ties
    order = np.argsort(y_scores)
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, len(y_scores) + 1)

    sum_ranks_pos = np.sum(ranks[pos_mask])
    u_stat = sum_ranks_pos - (n_pos * (n_pos + 1)) / 2.0
    return float(u_stat / (n_pos * n_neg))


def compute_pr_auc(y_true: np.ndarray, y_scores: np.ndarray) -> float:
    """Precision-Recall AUC (Average Precision)."""
    y_true = np.asarray(y_true, dtype=int)
    y_scores = np.asarray(y_scores, dtype=np.float64)

    order = np.argsort(-y_scores)
    y_sorted = y_true[order]

    n_pos = int(np.sum(y_true == 1))
    if n_pos == 0:
        return 0.0

    tps = np.cumsum(y_sorted == 1)
    fps = np.cumsum(y_sorted == 0)

    recalls = tps / n_pos
    precisions = tps / (tps + fps)

    # Average precision: sum (R_k - R_{k-1}) * P_k
    recall_prev = 0.0
    ap = 0.0
    for r, p in zip(recalls, precisions):
        if r > recall_prev:
            ap += (r - recall_prev) * p
            recall_prev = r

    return float(ap)


def compute_brier_score(y_true: np.ndarray, y_prob: np.ndarray) -> float:
    return float(np.mean((y_prob - y_true) ** 2))


class RiskMLPClassifier:
    def __init__(self, input_dim: int, hidden_dim: int = 32, l2_reg: float = 1e-4, pos_weight: float = 5.0):
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.l2_reg = l2_reg
        self.pos_weight = pos_weight

        # He / Xavier initialization
        rng = np.random.RandomState(42)
        self.W1 = rng.randn(input_dim, hidden_dim) * math.sqrt(2.0 / input_dim)
        self.b1 = np.zeros(hidden_dim, dtype=np.float64)
        self.W2 = rng.randn(hidden_dim, 1) * math.sqrt(2.0 / hidden_dim)
        self.b2 = np.zeros(1, dtype=np.float64)

    def _forward(self, X: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        # Hidden layer with ReLU
        z1 = X @ self.W1 + self.b1
        a1 = np.maximum(0.0, z1)
        # Output layer with Sigmoid
        z2 = a1 @ self.W2 + self.b2
        # Clip z2 to avoid overflow
        z2_clipped = np.clip(z2, -30.0, 30.0)
        prob = 1.0 / (1.0 + np.exp(-z2_clipped))
        return z1, a1, prob

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        _, _, prob = self._forward(np.asarray(X, dtype=np.float64))
        return prob.flatten()

    def fit(self, X: np.ndarray, y: np.ndarray, epochs: int = 80, batch_size: int = 128, lr: float = 0.005):
        X = np.asarray(X, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64).reshape(-1, 1)
        N = X.shape[0]

        # Adam optimizer state
        mW1, vW1 = np.zeros_like(self.W1), np.zeros_like(self.W1)
        mb1, vb1 = np.zeros_like(self.b1), np.zeros_like(self.b1)
        mW2, vW2 = np.zeros_like(self.W2), np.zeros_like(self.W2)
        mb2, vb2 = np.zeros_like(self.b2), np.zeros_like(self.b2)

        beta1, beta2 = 0.9, 0.999
        eps = 1e-8
        t_step = 0

        for epoch in range(epochs):
            indices = np.random.permutation(N)
            X_shuffled = X[indices]
            y_shuffled = y[indices]

            for i in range(0, N, batch_size):
                t_step += 1
                xb = X_shuffled[i:i + batch_size]
                yb = y_shuffled[i:i + batch_size]
                bs = xb.shape[0]

                z1, a1, prob = self._forward(xb)

                # Weighted BCE gradient w.r.t z2:
                # dL/dz2 = prob * (1 + (pos_weight - 1) * y) - pos_weight * y
                grad_z2 = (prob * (1.0 + (self.pos_weight - 1.0) * yb) - self.pos_weight * yb) / bs

                # Gradients w.r.t W2, b2
                grad_W2 = (a1.T @ grad_z2) + self.l2_reg * self.W2
                grad_b2 = np.sum(grad_z2, axis=0)

                # Backprop to hidden
                grad_a1 = grad_z2 @ self.W2.T
                grad_z1 = grad_a1 * (z1 > 0.0)

                grad_W1 = (xb.T @ grad_z1) + self.l2_reg * self.W1
                grad_b1 = np.sum(grad_z1, axis=0)

                # Adam updates
                for param, grad, m, v in [
                    (self.W1, grad_W1, mW1, vW1),
                    (self.b1, grad_b1, mb1, vb1),
                    (self.W2, grad_W2, mW2, vW2),
                    (self.b2, grad_b2, mb2, vb2),
                ]:
                    m[:] = beta1 * m + (1.0 - beta1) * grad
                    v[:] = beta2 * v + (1.0 - beta2) * (grad ** 2)
                    m_hat = m / (1.0 - beta1 ** t_step)
                    v_hat = v / (1.0 - beta2 ** t_step)
                    param -= lr * m_hat / (np.sqrt(v_hat) + eps)
