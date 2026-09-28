"""
model_classify_v3/scripts/predict.py
===================================
Inference engine for model_classify_v3:
- Hybrid Word (1,2) + Char (3,4) TF-IDF representations.
- Pure NumPy forward pass, zero external DLL dependencies.
- Calibrated confidence threshold evaluation.
- Fully backwards-compatible with v2 API response.
"""

import sys
import json
import pickle
import math
import argparse
from pathlib import Path
from collections import Counter
from typing import Dict, Any, List
import numpy as np

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from preprocess import extract_ngrams

BASE_DIR = CURRENT_DIR.parent
MODELS_DIR = BASE_DIR / "models"


class VietnameseClassifierEngineV3:
    def __init__(self, models_dir: Path = MODELS_DIR):
        with open(models_dir / "vectorizer.pkl", "rb") as f:
            v_bundle = pickle.load(f)
        with open(models_dir / "classifier_model.pkl", "rb") as f:
            c_bundle = pickle.load(f)

        self.vocab = v_bundle["vocab"]
        self.idf = v_bundle["idf"]
        self.use_word = v_bundle.get("use_word", True)
        self.max_word_ngram = v_bundle.get("max_word_ngram", 2)
        self.use_char = v_bundle.get("use_char", True)
        self.min_char_ngram = v_bundle.get("min_char_ngram", 3)
        self.max_char_ngram = v_bundle.get("max_char_ngram", 4)

        self.W = c_bundle["W"]
        self.b = c_bundle["b"]
        self.categories = c_bundle["categories"]

        # Load calibrated thresholds
        threshold_file = models_dir / "confidence_thresholds.json"
        if threshold_file.exists():
            with open(threshold_file, "r", encoding="utf-8") as f:
                t_data = json.load(f)
            self.high_threshold = float(t_data.get("high_threshold", 0.60))
            self.low_threshold = float(t_data.get("low_threshold", 0.35))
        else:
            self.high_threshold = 0.60
            self.low_threshold = 0.35

    def predict(self, text: str) -> Dict[str, Any]:
        if not text or not str(text).strip():
            return {
                "category": "khác",
                "confidence": 0.0,
                "suggestion_level": "LOW_CONFIDENCE",
                "is_confident": False,
            }

        toks = extract_ngrams(
            str(text),
            use_word=self.use_word,
            max_word_ngram=self.max_word_ngram,
            use_char=self.use_char,
            min_char_ngram=self.min_char_ngram,
            max_char_ngram=self.max_char_ngram,
        )

        D = len(self.vocab)
        vec = np.zeros(D, dtype=np.float32)
        tf_counter = Counter(toks)

        matched_tokens = 0
        for tok, cnt in tf_counter.items():
            if tok in self.vocab:
                matched_tokens += 1
                idx = self.vocab[tok]
                tf = 1.0 + math.log(cnt)
                vec[idx] = tf * self.idf[idx]

        norm = np.linalg.norm(vec)
        if norm > 1e-8:
            vec /= norm
        elif matched_tokens == 0:
            # Completely unknown tokens
            return {
                "category": "khác",
                "confidence": 0.10,
                "suggestion_level": "LOW_CONFIDENCE",
                "is_confident": False,
            }

        # Forward
        logits = np.dot(vec.reshape(1, -1), self.W) + self.b
        exp_logits = np.exp(logits - np.max(logits, axis=1, keepdims=True))
        probs = (exp_logits / np.sum(exp_logits, axis=1, keepdims=True))[0]

        pred_idx = int(np.argmax(probs))
        confidence = float(round(probs[pred_idx], 4))

        if confidence >= self.high_threshold:
            suggestion_level = "HIGH_CONFIDENCE"
            is_confident = True
        elif confidence >= self.low_threshold:
            suggestion_level = "UNCERTAIN_SUGGESTION"
            is_confident = False
        else:
            suggestion_level = "LOW_CONFIDENCE"
            is_confident = False

        return {
            "category": self.categories[pred_idx],
            "confidence": confidence,
            "suggestion_level": suggestion_level,
            "is_confident": is_confident,
            "high_threshold": self.high_threshold,
            "low_threshold": self.low_threshold,
        }


# Backwards compatibility alias
VietnameseClassifierEngine = VietnameseClassifierEngineV3


def main():
    parser = argparse.ArgumentParser(description="Classify Vietnamese transaction description (v3).")
    parser.add_argument("--text", type=str, required=True, help="Transaction text")
    args = parser.parse_args()

    engine = VietnameseClassifierEngineV3()
    res = engine.predict(args.text)
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
