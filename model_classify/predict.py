"""
model_classify/predict.py
==========================
Load the trained classification model and predict transaction categories.

Usage:
    from model_classify.predict import predict_category
    result = predict_category("GrabFood lunch")
    # {"category": "food", "confidence": 0.87}
"""

import re
import logging
from pathlib import Path

import numpy as np
import joblib

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MODULE_DIR = Path(__file__).resolve().parent
MODEL_PATH = MODULE_DIR / "classifier_model.pkl"
VECTORIZER_PATH = MODULE_DIR / "vectorizer.pkl"

logger = logging.getLogger(__name__)

# Lazy-loaded singletons
_model = None
_vectorizer = None


# ---------------------------------------------------------------------------
# Text cleaning — MUST be identical to train.py
# ---------------------------------------------------------------------------
def clean_text(text: str) -> str:
    """Clean and normalize transaction text."""
    if text is None or (isinstance(text, float) and np.isnan(text)):
        return ""
    text = str(text)
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---------------------------------------------------------------------------
# Model loading (lazy singleton)
# ---------------------------------------------------------------------------
def _load_model():
    """Load model and vectorizer once, cache for subsequent calls."""
    global _model, _vectorizer
    if _model is None or _vectorizer is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Model file not found: {MODEL_PATH}. "
                "Please run train.py first."
            )
        if not VECTORIZER_PATH.exists():
            raise FileNotFoundError(
                f"Vectorizer file not found: {VECTORIZER_PATH}. "
                "Please run train.py first."
            )
        _model = joblib.load(MODEL_PATH)
        _vectorizer = joblib.load(VECTORIZER_PATH)
        logger.info("Model and vectorizer loaded successfully.")
    return _model, _vectorizer


# ---------------------------------------------------------------------------
# Prediction function
# ---------------------------------------------------------------------------
def predict_category(text) -> dict:
    """
    Predict the spending category for a transaction description.

    Parameters
    ----------
    text : str
        Transaction description text.

    Returns
    -------
    dict
        {"category": str, "confidence": float}
        On error: {"category": "unknown", "confidence": 0.0, "error": str}
    """
    # --- Input validation ---
    if text is None:
        return {
            "category": "unknown",
            "confidence": 0.0,
            "error": "Input text is None",
        }

    if not isinstance(text, str):
        try:
            text = str(text)
        except Exception:
            return {
                "category": "unknown",
                "confidence": 0.0,
                "error": f"Cannot convert input type '{type(text).__name__}' to string",
            }

    # Clean text
    cleaned = clean_text(text)

    if not cleaned:
        return {
            "category": "unknown",
            "confidence": 0.0,
            "error": "Input text is empty after cleaning",
        }

    # --- Load model ---
    try:
        model, vectorizer = _load_model()
    except FileNotFoundError as e:
        return {
            "category": "unknown",
            "confidence": 0.0,
            "error": str(e),
        }

    # --- Predict ---
    try:
        text_tfidf = vectorizer.transform([cleaned])
        predicted_category = model.predict(text_tfidf)[0]
        probabilities = model.predict_proba(text_tfidf)[0]
        confidence = float(probabilities.max())

        return {
            "category": str(predicted_category),
            "confidence": round(confidence, 4),
        }
    except Exception as e:
        return {
            "category": "unknown",
            "confidence": 0.0,
            "error": f"Prediction error: {str(e)}",
        }


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import json

    logging.basicConfig(level=logging.INFO)

    test_inputs = [
        "GrabFood lunch",
        "Gas station",
        "Buy shoes",
        "Netflix subscription",
        "Hospital checkup",
        "College tuition fee payment",
        "Uber ride to work",
        "Electricity bill",
        "Stock investment",
        "Home loan EMI payment",
        "",          # empty string
        None,        # None input
        12345,       # numeric input
    ]

    print("\n=== model_classify — Predict Category ===\n")
    for inp in test_inputs:
        result = predict_category(inp)
        print(f"  Input: {repr(inp):45s} → {json.dumps(result)}")
