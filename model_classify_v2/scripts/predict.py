"""
model_classify_v2/scripts/predict.py
===================================
Inference engine for model_classify_v2.
Usage:
    python model_classify_v2/scripts/predict.py --text "Ăn sáng phở bò 45k"
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

# Ensure scripts dir is on path
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from preprocess import clean_vietnamese_text, remove_vietnamese_accents

BASE_DIR = CURRENT_DIR.parent
MODELS_DIR = BASE_DIR / "models"


class VietnameseClassifierEngine:
    def __init__(self, models_dir: Path = MODELS_DIR):
        with open(models_dir / "vectorizer.pkl", "rb") as f:
            v_bundle = pickle.load(f)
        with open(models_dir / "classifier_model.pkl", "rb") as f:
            c_bundle = pickle.load(f)

        self.vocab = v_bundle["vocab"]
        self.idf = v_bundle["idf"]
        self.use_word = v_bundle.get("use_word", True)
        self.max_word_ngram = v_bundle.get("max_word_ngram", 2)
        self.use_char = v_bundle.get("use_char", False)
        self.min_char_ngram = v_bundle.get("min_char_ngram", 3)
        self.max_char_ngram = v_bundle.get("max_char_ngram", 4)

        self.W = c_bundle["W"]
        self.b = c_bundle["b"]
        self.categories = c_bundle["categories"]

    def _extract_tokens(self, text: str) -> List[str]:
        cleaned = clean_vietnamese_text(text)
        tokens = []
        words = cleaned.split()

        # Word ngrams
        if self.use_word and words:
            for n in range(1, self.max_word_ngram + 1):
                for i in range(len(words) - n + 1):
                    tokens.append("w:" + " ".join(words[i:i+n]))

        # Char ngrams
        if self.use_char and cleaned:
            padded = f" {cleaned} "
            for n in range(self.min_char_ngram, self.max_char_ngram + 1):
                for i in range(len(padded) - n + 1):
                    tokens.append("c:" + padded[i:i+n])

        return tokens

    def predict(self, text: str) -> Dict[str, Any]:
        if not text or not str(text).strip():
            return {"category": "khác", "confidence": 0.0}

        tokens = self._extract_tokens(str(text))
        tf_counter = Counter(tokens)
        D = len(self.vocab)
        x = np.zeros(D, dtype=np.float32)

        for tok, cnt in tf_counter.items():
            if tok in self.vocab:
                idx = self.vocab[tok]
                tf = 1.0 + math.log(cnt)
                x[idx] = tf * self.idf[idx]

        norm = np.linalg.norm(x)
        if norm > 1e-8:
            x /= norm

        # Forward
        logits = np.dot(x.reshape(1, -1), self.W) + self.b
        exp_logits = np.exp(logits - np.max(logits, axis=1, keepdims=True))
        probs = (exp_logits / np.sum(exp_logits, axis=1, keepdims=True))[0]

        pred_idx = int(np.argmax(probs))
        confidence = float(probs[pred_idx])

        return {
            "category": self.categories[pred_idx],
            "confidence": round(confidence, 4),
        }


def main():
    parser = argparse.ArgumentParser(description="Classify Vietnamese transaction description.")
    parser.add_argument("--text", type=str, required=True, help="Transaction text")
    args = parser.parse_args()

    engine = VietnameseClassifierEngine()
    res = engine.predict(args.text)
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
