"""
model_warning_v3/scripts/classifier.py
======================================
Custom NumPy-only Multilayer Perceptron for Risk & Fraud Classification (v3):
Architecture: Input (22) -> Dense (32, ReLU) -> Dense (1, Sigmoid)
Optimizer: Adam with Class Imbalance Weighting (pos_weight).
Zero external C-extension or DLL dependencies.
"""

import math
from typing import Tuple, Dict, Any, List
import numpy as np


class RiskMLPClassifierV3:
    def __init__(
        self,
        input_dim: int = 22,
        hidden_dim: int = 32,
        pos_weight: float = 8.0,
        lr: float = 0.005,
        l2_reg: float = 1e-4,
    ):
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.pos_weight = pos_weight
        self.lr = lr
        self.l2_reg = l2_reg

        # Initialize weights with He/Kaiming normal for layer 1, Xavier for layer 2
        std1 = math.sqrt(2.0 / input_dim)
        self.W1 = (np.random.randn(input_dim, hidden_dim) * std1).astype(np.float64)
        self.b1 = np.zeros((1, hidden_dim), dtype=np.float64)

        std2 = math.sqrt(1.0 / hidden_dim)
        self.W2 = (np.random.randn(hidden_dim, 1) * std2).astype(np.float64)
        self.b2 = np.zeros((1, 1), dtype=np.float64)

    def _relu(self, z: np.ndarray) -> np.ndarray:
        return np.maximum(0.0, z)

    def _sigmoid(self, z: np.ndarray) -> np.ndarray:
        z_clipped = np.clip(z, -30.0, 30.0)
        return 1.0 / (1.0 + np.exp(-z_clipped))

    def forward(self, X: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        z1 = np.dot(X, self.W1) + self.b1
        a1 = self._relu(z1)
        z2 = np.dot(a1, self.W2) + self.b2
        a2 = self._sigmoid(z2)
        return z1, a1, z2, a2

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        _, _, _, a2 = self.forward(X)
        return a2.flatten()

    def fit(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        epochs: int = 35,
        batch_size: int = 128,
        verbose: bool = True,
    ):
        N = X_train.shape[0]
        y_train_col = y_train.reshape(-1, 1).astype(np.float64)

        # Adam state
        mW1, vW1 = np.zeros_like(self.W1), np.zeros_like(self.W1)
        mb1, vb1 = np.zeros_like(self.b1), np.zeros_like(self.b1)
        mW2, vW2 = np.zeros_like(self.W2), np.zeros_like(self.W2)
        mb2, vb2 = np.zeros_like(self.b2), np.zeros_like(self.b2)

        beta1, beta2, eps = 0.9, 0.999, 1e-8
        t = 0
        indices = np.arange(N)

        for epoch in range(1, epochs + 1):
            np.random.shuffle(indices)
            for start in range(0, N, batch_size):
                t += 1
                batch_idx = indices[start : start + batch_size]
                xb = X_train[batch_idx]
                yb = y_train_col[batch_idx]
                M = len(batch_idx)

                # Forward
                z1, a1, z2, a2 = self.forward(xb)

                # Weighted binary cross-entropy gradient
                weights = np.where(yb == 1.0, self.pos_weight, 1.0)
                # dL/dz2 = (p - y) * weight
                dz2 = (a2 - yb) * weights / M
                dW2 = np.dot(a1.T, dz2) + self.l2_reg * self.W2
                db2 = np.sum(dz2, axis=0, keepdims=True)

                # Backprop to layer 1
                da1 = np.dot(dz2, self.W2.T)
                dz1 = da1 * (z1 > 0.0).astype(np.float64)
                dW1 = np.dot(xb.T, dz1) + self.l2_reg * self.W1
                db1 = np.sum(dz1, axis=0, keepdims=True)

                # Adam update W1, b1
                mW1 = beta1 * mW1 + (1 - beta1) * dW1
                vW1 = beta2 * vW1 + (1 - beta2) * (dW1 ** 2)
                self.W1 -= self.lr * (mW1 / (1 - beta1 ** t)) / (np.sqrt(vW1 / (1 - beta2 ** t)) + eps)

                mb1 = beta1 * mb1 + (1 - beta1) * db1
                vb1 = beta2 * vb1 + (1 - beta2) * (db1 ** 2)
                self.b1 -= self.lr * (mb1 / (1 - beta1 ** t)) / (np.sqrt(vb1 / (1 - beta2 ** t)) + eps)

                # Adam update W2, b2
                mW2 = beta1 * mW2 + (1 - beta1) * dW2
                vW2 = beta2 * vW2 + (1 - beta2) * (dW2 ** 2)
                self.W2 -= self.lr * (mW2 / (1 - beta1 ** t)) / (np.sqrt(vW2 / (1 - beta2 ** t)) + eps)

                mb2 = beta1 * mb2 + (1 - beta1) * db2
                vb2 = beta2 * vb2 + (1 - beta2) * (db2 ** 2)
                self.b2 -= self.lr * (mb2 / (1 - beta1 ** t)) / (np.sqrt(vb2 / (1 - beta2 ** t)) + eps)

        return self


def compute_roc_auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    pos_mask = (y_true == 1)
    neg_mask = (y_true == 0)
    n_pos = int(np.sum(pos_mask))
    n_neg = int(np.sum(neg_mask))
    if n_pos == 0 or n_neg == 0:
        return 0.5
    order = np.argsort(y_score)
    ranks = np.empty_like(order, dtype=float)
    ranks[order] = np.arange(1, len(y_score) + 1)
    sum_ranks_pos = np.sum(ranks[pos_mask])
    u = sum_ranks_pos - (n_pos * (n_pos + 1)) / 2.0
    return float(u / (n_pos * n_neg))


def compute_pr_auc(y_true: np.ndarray, y_score: np.ndarray) -> float:
    order = np.argsort(-y_score)
    y_sorted = y_true[order]
    n_pos = np.sum(y_true == 1)
    if n_pos == 0:
        return 0.0
    cum_tp = np.cumsum(y_sorted == 1)
    cum_fp = np.cumsum(y_sorted == 0)
    precisions = cum_tp / (cum_tp + cum_fp)
    recalls = cum_tp / n_pos

    precisions = np.concatenate(([1.0], precisions))
    recalls = np.concatenate(([0.0], recalls))
    return float(np.sum((recalls[1:] - recalls[:-1]) * precisions[1:]))


def compute_brier_score(y_true: np.ndarray, y_score: np.ndarray) -> float:
    return float(np.mean((y_score - y_true) ** 2))
