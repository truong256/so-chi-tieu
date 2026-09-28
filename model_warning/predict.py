"""
model_warning/predict.py
=========================
Load the trained risk/fraud warning model and evaluate risk levels for transactions.

Usage:
    from model_warning.predict import check_risk

    txn = {
        "amount": "$1,500.00",
        "credit_limit": "$2,000.00",
        "mcc": 5411,
        "use_chip": "Online Transaction",
        "card_brand": "Visa",
        "card_type": "Credit",
        "credit_score": 580
    }
    result = check_risk(txn)
    # {
    #     "risk_score": 0.85,
    #     "risk_level": "DANGER",
    #     "fraud_probability": 0.85,
    #     "risk_indicators": ["High amount-to-credit-limit ratio (75.0%)", ...]
    # }
"""

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MODULE_DIR = Path(__file__).resolve().parent
MODEL_PATH = MODULE_DIR / "warning_model.pkl"
METADATA_PATH = MODULE_DIR / "metadata.json"

logger = logging.getLogger(__name__)

# Lazy singleton
_bundle = None


# ---------------------------------------------------------------------------
# Helper: dollar parser
# ---------------------------------------------------------------------------
def _parse_dollar(val):
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, (int, float)):
        return float(abs(val))
    s = str(val).replace("$", "").replace(",", "").strip()
    try:
        return float(abs(float(s)))
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Model Loader
# ---------------------------------------------------------------------------
def _load_bundle():
    """Load model bundle (model, feature order, thresholds, medians)."""
    global _bundle
    if _bundle is None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Warning model bundle not found: {MODEL_PATH}. "
                "Please run model_warning/train.py first."
            )
        _bundle = joblib.load(MODEL_PATH)
        logger.info("Warning model bundle loaded successfully.")
    return _bundle


# ---------------------------------------------------------------------------
# Feature Extraction from raw transaction dictionary
# ---------------------------------------------------------------------------
def _extract_features(txn: dict, bundle: dict):
    """
    Extract and encode features from arbitrary input dict.
    Returns 2D numpy array [1, n_features] and a list of risk indicator strings.
    """
    feature_cols = bundle["feature_cols"]
    medians = bundle.get("feature_medians", {})
    card_brand_classes = bundle.get("card_brand_classes", [])
    card_type_classes = bundle.get("card_type_classes", [])

    indicators = []

    # 1. Amount
    raw_amount = txn.get("transaction_amount", txn.get("amount", None))
    amount = _parse_dollar(raw_amount)
    if amount is None:
        amount = medians.get("transaction_amount", 50.0)

    # 2. Credit limit
    raw_limit = txn.get("credit_limit", None)
    credit_limit = _parse_dollar(raw_limit)
    if credit_limit is None:
        credit_limit = medians.get("credit_limit", 5000.0)

    # 3. Ratio (safe division)
    if credit_limit > 0:
        ratio = amount / credit_limit
    else:
        ratio = 0.0

    if ratio > 0.8:
        indicators.append(f"High amount-to-credit-limit ratio ({ratio * 100:.1f}%)")
    elif ratio > 0.5:
        indicators.append(f"Moderate amount-to-credit-limit ratio ({ratio * 100:.1f}%)")

    # 4. Date/Time features
    dt = None
    raw_date = txn.get("date", txn.get("datetime", txn.get("timestamp", None)))
    if raw_date is not None:
        try:
            dt = pd.to_datetime(raw_date)
        except Exception:
            dt = None

    if dt is not None and not pd.isna(dt):
        hour = dt.hour
        day_of_week = dt.dayofweek
        month = dt.month
    else:
        hour = int(txn.get("hour", medians.get("hour", 12)))
        day_of_week = int(txn.get("day_of_week", medians.get("day_of_week", 2)))
        month = int(txn.get("month", medians.get("month", 6)))

    if hour in [1, 2, 3, 4]:
        indicators.append(f"Unusual transaction time: {hour:02d}:00")

    # 5. MCC code
    mcc = txn.get("mcc", txn.get("mcc_code", medians.get("mcc", 5411)))
    try:
        mcc = int(mcc)
    except (ValueError, TypeError):
        mcc = int(medians.get("mcc", 5411))

    # 6. use_chip encoding
    use_chip_map = {
        "Swipe Transaction": 0, "swipe": 0, "0": 0, 0: 0,
        "Chip Transaction": 1, "chip": 1, "1": 1, 1: 1,
        "Online Transaction": 2, "online": 2, "2": 2, 2: 2,
    }
    raw_use_chip = txn.get("use_chip", "")
    use_chip_encoded = use_chip_map.get(str(raw_use_chip).strip(), int(medians.get("use_chip_encoded", 1)))

    if str(raw_use_chip).strip() in ["Online Transaction", "online"]:
        indicators.append("Online transaction")

    # 7. card_brand encoding
    card_brand = str(txn.get("card_brand", "Unknown")).strip()
    try:
        card_brand_encoded = card_brand_classes.index(card_brand) if card_brand in card_brand_classes else -1
    except Exception:
        card_brand_encoded = int(medians.get("card_brand_encoded", 0))

    # 8. card_type encoding
    card_type = str(txn.get("card_type", "Unknown")).strip()
    try:
        card_type_encoded = card_type_classes.index(card_type) if card_type in card_type_classes else -1
    except Exception:
        card_type_encoded = int(medians.get("card_type_encoded", 0))

    # 9. has_chip encoding
    has_chip_raw = txn.get("has_chip", "YES")
    has_chip_encoded = 1 if str(has_chip_raw).upper() in ["YES", "1", "TRUE"] else 0

    # 10. card_on_dark_web
    dark_web_raw = txn.get("card_on_dark_web", "No")
    dark_web_encoded = 1 if str(dark_web_raw).upper() in ["YES", "1", "TRUE"] else 0
    if dark_web_encoded == 1:
        indicators.append("Card has been flagged on dark web")

    # 11. credit_score
    try:
        credit_score = float(txn.get("credit_score", medians.get("credit_score", 700)))
    except (ValueError, TypeError):
        credit_score = float(medians.get("credit_score", 700))
    if credit_score < 600:
        indicators.append(f"Low credit score ({int(credit_score)})")

    # 12. yearly_income
    raw_income = txn.get("yearly_income", None)
    yearly_income = _parse_dollar(raw_income)
    if yearly_income is None:
        yearly_income = float(medians.get("yearly_income", 50000.0))

    # 13. current_age
    try:
        current_age = float(txn.get("current_age", medians.get("current_age", 45)))
    except (ValueError, TypeError):
        current_age = float(medians.get("current_age", 45))

    # 14. gender_encoded
    gender_raw = str(txn.get("gender", "")).lower()
    gender_encoded = 1 if gender_raw in ["female", "f", "1"] else 0

    # 15. has_error
    errors_raw = txn.get("errors", txn.get("has_error", None))
    has_error = 1 if errors_raw not in [None, "", 0, False, np.nan] else 0
    if has_error == 1:
        indicators.append("Transaction contains processing error flag")

    # 16-17. Deviations
    card_avg = bundle.get("card_avg_default", medians.get("transaction_amount", 50.0))
    user_avg = bundle.get("user_avg_default", medians.get("transaction_amount", 50.0))

    dev_card = txn.get("deviation_from_card_average", amount - card_avg)
    dev_user = txn.get("deviation_from_user_average", amount - user_avg)

    try:
        dev_card = float(dev_card)
        dev_user = float(dev_user)
    except (ValueError, TypeError):
        dev_card = 0.0
        dev_user = 0.0

    if amount > card_avg * 3 and amount > 200:
        indicators.append(f"Amount is significantly higher than card average (${card_avg:.2f})")

    # 18. user_txn_count
    try:
        user_txn_count = float(txn.get("user_txn_count", medians.get("user_txn_count", 50)))
    except (ValueError, TypeError):
        user_txn_count = float(medians.get("user_txn_count", 50))

    # Construct feature mapping
    row_data = {
        "transaction_amount": amount,
        "credit_limit": credit_limit,
        "amount_to_limit_ratio": ratio,
        "hour": hour,
        "day_of_week": day_of_week,
        "month": month,
        "mcc": mcc,
        "use_chip_encoded": use_chip_encoded,
        "card_brand_encoded": card_brand_encoded,
        "card_type_encoded": card_type_encoded,
        "has_chip_encoded": has_chip_encoded,
        "dark_web_encoded": dark_web_encoded,
        "credit_score": credit_score,
        "yearly_income": yearly_income,
        "current_age": current_age,
        "gender_encoded": gender_encoded,
        "has_error": has_error,
        "deviation_from_card_average": dev_card,
        "deviation_from_user_average": dev_user,
        "user_txn_count": user_txn_count,
    }

    # Assemble in exact trained feature order
    feature_vector = []
    for col in feature_cols:
        val = row_data.get(col, medians.get(col, 0.0))
        # ensure no NaN/inf
        if val is None or pd.isna(val) or np.isinf(val):
            val = medians.get(col, 0.0)
        feature_vector.append(float(val))

    X = np.array([feature_vector], dtype=np.float32)
    return X, indicators


# ---------------------------------------------------------------------------
# Prediction function
# ---------------------------------------------------------------------------
def check_risk(transaction: dict) -> dict:
    """
    Check the risk level of a transaction.

    Parameters
    ----------
    transaction : dict
        Transaction dictionary containing transaction details.
        Accepts raw or structured fields (amount, credit_limit, date, mcc, etc.)

    Returns
    -------
    dict
        {
            "risk_score": float,
            "risk_level": "SAFE" | "WARNING" | "DANGER",
            "fraud_probability": float,
            "risk_indicators": list[str]
        }
    """
    # Validate input
    if transaction is None:
        return {
            "risk_score": 0.0,
            "risk_level": "SAFE",
            "fraud_probability": 0.0,
            "risk_indicators": ["Input transaction is None"],
            "error": "Input is None",
        }

    if not isinstance(transaction, dict):
        return {
            "risk_score": 0.0,
            "risk_level": "SAFE",
            "fraud_probability": 0.0,
            "risk_indicators": [f"Invalid input type: {type(transaction).__name__}"],
            "error": "Input must be a dictionary",
        }

    # Load model bundle
    try:
        bundle = _load_bundle()
    except FileNotFoundError as e:
        return {
            "risk_score": 0.0,
            "risk_level": "SAFE",
            "fraud_probability": 0.0,
            "risk_indicators": [],
            "error": str(e),
        }

    model = bundle["model"]
    safe_thresh = bundle.get("safe_threshold", 0.3)
    danger_thresh = bundle.get("danger_threshold", 0.7)

    # Extract features
    try:
        X, indicators = _extract_features(transaction, bundle)
    except Exception as e:
        return {
            "risk_score": 0.0,
            "risk_level": "SAFE",
            "fraud_probability": 0.0,
            "risk_indicators": [],
            "error": f"Feature extraction failed: {str(e)}",
        }

    # Predict probability
    try:
        # Probability of class 1 (Fraud)
        proba = float(model.predict_proba(X)[0, 1])
        risk_score = round(proba, 4)

        if risk_score >= danger_thresh:
            risk_level = "DANGER"
        elif risk_score >= safe_thresh:
            risk_level = "WARNING"
        else:
            risk_level = "SAFE"

        return {
            "risk_score": risk_score,
            "risk_level": risk_level,
            "fraud_probability": risk_score,
            "risk_indicators": indicators,
        }
    except Exception as e:
        return {
            "risk_score": 0.0,
            "risk_level": "SAFE",
            "fraud_probability": 0.0,
            "risk_indicators": [],
            "error": f"Model inference error: {str(e)}",
        }


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    test_transactions = [
        # 1. Normal daily swipe
        {
            "amount": "$15.50",
            "credit_limit": "$5000",
            "date": "2024-05-10 12:30:00",
            "mcc": 5411,
            "use_chip": "Swipe Transaction",
            "card_brand": "Visa",
            "card_type": "Debit",
            "credit_score": 750,
        },
        # 2. Very large amount exceeding credit limit
        {
            "amount": "$9,500.00",
            "credit_limit": "$3,000.00",
            "date": "2024-05-10 03:15:00",
            "mcc": 5311,
            "use_chip": "Online Transaction",
            "card_brand": "Mastercard",
            "card_type": "Credit",
            "card_on_dark_web": "Yes",
            "credit_score": 520,
        },
        # 3. High amount to limit ratio at 2 AM
        {
            "amount": "$2,800.00",
            "credit_limit": "$3,000.00",
            "date": "2024-05-10 02:45:00",
            "use_chip": "Online Transaction",
            "credit_score": 590,
        },
        # 4. Transaction with missing fields (graceful handling)
        {
            "amount": "$45.00",
        },
        # 5. Empty dictionary
        {},
    ]

    print("\n=== model_warning — Check Risk ===\n")
    for i, t in enumerate(test_transactions, 1):
        res = check_risk(t)
        print(f"Test {i}: Input = {t}")
        print(f"       Result = {json.dumps(res, indent=2)}\n")
