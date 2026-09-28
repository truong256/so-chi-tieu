"""
model_warning_v3/scripts/pipeline.py
====================================
Hardened Leakage-Free Feature Engineering Pipeline for Risk/Warning Classification (v3):
- Strictly fit on TRAIN ONLY (card_avg, user_avg, user_txn_count, medians, scalers).
- Robust defense against None, null, 0, negative values, and out-of-distribution outliers:
  * Eliminates float(None) bug completely
  * credit_limit = null -> imputes median_credit_limit
  * credit_limit = 0 -> ratio safely clamped to 0.0
  * negative amounts/income clamped to >= 0.0 before log1p
  * missing categorical/continuous fields smoothly imputed
- Fallback for unknown cards and users to global Train statistics.
"""

import math
from collections import defaultdict
from typing import List, Dict, Any, Tuple
import numpy as np

HIGH_RISK_MCCS = {5732, 5944, 7995, 6051, 4829}

FEATURE_NAMES = [
    "log_transaction_amount",
    "log_credit_limit",
    "amount_to_limit_ratio",
    "hour",
    "is_night",
    "day_of_week",
    "is_weekend",
    "month",
    "is_high_risk_mcc",
    "use_chip_encoded",
    "card_brand_encoded",
    "card_type_encoded",
    "has_chip_encoded",
    "dark_web_encoded",
    "credit_score",
    "log_yearly_income",
    "current_age",
    "gender_encoded",
    "has_error",
    "deviation_from_card_average",
    "deviation_from_user_average",
    "user_txn_count",
]


def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely convert any input to float, handling None, empty strings, and non-numeric types."""
    if val is None:
        return default
    try:
        s = str(val).strip()
        if not s:
            return default
        f = float(s)
        return f if math.isfinite(f) else default
    except (ValueError, TypeError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    """Safely convert any input to int."""
    if val is None:
        return default
    try:
        s = str(val).strip()
        if not s:
            return default
        return int(float(s))
    except (ValueError, TypeError):
        return default


class LeakageFreePipelineV3:
    def __init__(self):
        self.fitted = False

        # Statistics fitted strictly on TRAIN
        self.card_avg: Dict[str, float] = {}
        self.user_avg: Dict[str, float] = {}
        self.user_txn_count: Dict[str, float] = {}

        self.global_card_avg: float = 0.0
        self.global_user_avg: float = 0.0
        self.global_user_txn_count: float = 0.0

        # Imputation medians fitted strictly on TRAIN
        self.median_credit_score: float = 680.0
        self.median_yearly_income: float = 80000000.0
        self.median_current_age: float = 35.0
        self.median_credit_limit: float = 30000000.0

        # Categorical maps
        self.brand_map = {"Visa": 0, "Mastercard": 1, "JCB": 2, "American Express": 3}
        self.type_map = {"Debit": 0, "Credit": 1, "Prepaid": 2}
        self.use_chip_map = {"Swipe Transaction": 0, "Chip Transaction": 1, "Online Transaction": 2}

        # Scaler parameters
        self.scaler_means: np.ndarray = np.array([])
        self.scaler_stds: np.ndarray = np.array([])

    def fit(self, train_records: List[Dict[str, Any]]):
        amounts = [max(0.0, _safe_float(r.get("transaction_amount"))) for r in train_records]
        self.global_card_avg = float(np.mean(amounts)) if amounts else 200000.0
        self.global_user_avg = self.global_card_avg

        # Group by card_id & client_id
        card_amounts: Dict[str, List[float]] = defaultdict(list)
        user_amounts: Dict[str, List[float]] = defaultdict(list)

        c_scores, incomes, ages, limits = [], [], [], []

        for r in train_records:
            amt = max(0.0, _safe_float(r.get("transaction_amount")))
            cid = str(r.get("card_id", ""))
            uid = str(r.get("client_id", ""))

            if cid:
                card_amounts[cid].append(amt)
            if uid:
                user_amounts[uid].append(amt)

            if r.get("credit_score") is not None:
                c_scores.append(_safe_float(r.get("credit_score")))
            if r.get("yearly_income") is not None:
                incomes.append(max(0.0, _safe_float(r.get("yearly_income"))))
            if r.get("current_age") is not None:
                ages.append(_safe_float(r.get("current_age")))
            if r.get("credit_limit") is not None:
                lim = _safe_float(r.get("credit_limit"))
                if lim > 0:
                    limits.append(lim)

        self.card_avg = {cid: float(np.mean(vals)) for cid, vals in card_amounts.items()}
        self.user_avg = {uid: float(np.mean(vals)) for uid, vals in user_amounts.items()}
        self.user_txn_count = {uid: float(len(vals)) for uid, vals in user_amounts.items()}
        if self.user_txn_count:
            self.global_user_txn_count = float(np.mean(list(self.user_txn_count.values())))
        else:
            self.global_user_txn_count = 10.0

        if c_scores:
            self.median_credit_score = float(np.median(c_scores))
        if incomes:
            self.median_yearly_income = float(np.median(incomes))
        if ages:
            self.median_current_age = float(np.median(ages))
        if limits:
            self.median_credit_limit = float(np.median(limits))

        X_raw = self._extract_raw_matrix(train_records)
        self.scaler_means = np.mean(X_raw, axis=0)
        self.scaler_stds = np.std(X_raw, axis=0)
        self.scaler_stds[self.scaler_stds < 1e-6] = 1.0

        self.fitted = True

    def _extract_single_feature_vector(self, r: Dict[str, Any]) -> List[float]:
        # 1. Amount: safe, non-negative
        raw_amt = r.get("transaction_amount")
        amt = max(0.0, _safe_float(raw_amt, 0.0))

        # 2. Limit: safe, handles null, 0, negatives
        raw_limit = r.get("credit_limit")
        if raw_limit is None or str(raw_limit).strip() == "":
            limit = self.median_credit_limit
        else:
            parsed_limit = _safe_float(raw_limit, 0.0)
            limit = self.median_credit_limit if parsed_limit <= 0 else parsed_limit

        ratio = (amt / limit) if limit > 0 else 0.0

        # 3. Time features
        hour = _safe_int(r.get("hour"), 12)
        hour = max(0, min(23, hour))
        is_night = 1.0 if 1 <= hour <= 5 else 0.0

        dow = _safe_int(r.get("day_of_week"), 2)
        dow = max(0, min(6, dow))
        is_weekend = 1.0 if dow in (5, 6) else 0.0

        month = _safe_int(r.get("month"), 6)
        month = max(1, min(12, month))

        # 4. MCC
        mcc = _safe_int(r.get("mcc"), 0)
        is_high_risk_mcc = 1.0 if mcc in HIGH_RISK_MCCS else 0.0

        # 5. Encoded categorical
        use_chip_raw = str(r.get("use_chip") or "Swipe Transaction")
        use_chip_encoded = float(self.use_chip_map.get(use_chip_raw, 0))

        brand_raw = str(r.get("card_brand") or "Visa")
        brand_encoded = float(self.brand_map.get(brand_raw, 0))

        type_raw = str(r.get("card_type") or "Debit")
        type_encoded = float(self.type_map.get(type_raw, 0))

        has_chip_encoded = 1.0 if str(r.get("has_chip") or "").upper() == "YES" else 0.0
        dark_web_encoded = 1.0 if str(r.get("card_on_dark_web") or "").lower() == "yes" else 0.0

        # 6. User profile continuous features
        raw_c_score = r.get("credit_score")
        c_score = (
            _safe_float(raw_c_score, self.median_credit_score)
            if raw_c_score is not None
            else self.median_credit_score
        )
        c_score = max(300.0, min(850.0, c_score))

        raw_income = r.get("yearly_income")
        income = (
            max(0.0, _safe_float(raw_income, self.median_yearly_income))
            if raw_income is not None
            else self.median_yearly_income
        )

        raw_age = r.get("current_age")
        age = (
            max(18.0, min(100.0, _safe_float(raw_age, self.median_current_age)))
            if raw_age is not None
            else self.median_current_age
        )

        gender_encoded = 1.0 if str(r.get("gender") or "").lower() == "female" else 0.0
        has_error = 1.0 if r.get("errors") else 0.0

        # 7. Group aggregations with graceful fallbacks
        cid = str(r.get("card_id", "") or "")
        c_avg = self.card_avg.get(cid, self.global_card_avg)
        dev_card = amt - c_avg

        uid = str(r.get("client_id", "") or "")
        u_avg = self.user_avg.get(uid, self.global_user_avg)
        dev_user = amt - u_avg

        u_cnt = self.user_txn_count.get(uid, self.global_user_txn_count)

        return [
            math.log1p(amt),
            math.log1p(limit),
            ratio,
            float(hour),
            is_night,
            float(dow),
            is_weekend,
            float(month),
            is_high_risk_mcc,
            use_chip_encoded,
            brand_encoded,
            type_encoded,
            has_chip_encoded,
            dark_web_encoded,
            c_score,
            math.log1p(income),
            age,
            gender_encoded,
            has_error,
            dev_card,
            dev_user,
            u_cnt,
        ]

    def _extract_raw_matrix(self, records: List[Dict[str, Any]]) -> np.ndarray:
        return np.array([self._extract_single_feature_vector(r) for r in records], dtype=np.float64)

    def transform(self, records: List[Dict[str, Any]]) -> np.ndarray:
        if not self.fitted:
            raise RuntimeError("Pipeline must be fitted on TRAIN before transform.")
        X_raw = self._extract_raw_matrix(records)
        return (X_raw - self.scaler_means) / self.scaler_stds

    def transform_single(self, r: Dict[str, Any]) -> np.ndarray:
        if not self.fitted:
            raise RuntimeError("Pipeline must be fitted on TRAIN before transform.")
        vec = np.array(self._extract_single_feature_vector(r), dtype=np.float64)
        return (vec - self.scaler_means) / self.scaler_stds
