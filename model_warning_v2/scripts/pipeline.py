"""
model_warning_v2/scripts/pipeline.py
====================================
Leakage-Free Feature Engineering Pipeline for Risk/Warning Classification:
- Fit strictly on TRAIN ONLY:
    * Global and per-group statistics (card_avg, user_avg, user_txn_count)
    * Medians for missing value imputation
    * Categorical mappings
    * Standard scaler parameters (mean, std)
- Transform validation, test, and production transactions:
    * Unseen cards/users fallback to TRAIN global statistics
    * No computation on test or val data
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


class LeakageFreePipeline:
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

        # Scaler parameters (mean & std fitted strictly on TRAIN)
        self.scaler_means: np.ndarray = np.array([])
        self.scaler_stds: np.ndarray = np.array([])

    def fit(self, train_records: List[Dict[str, Any]]):
        amounts = [float(r["transaction_amount"]) for r in train_records]
        self.global_card_avg = float(np.mean(amounts))
        self.global_user_avg = self.global_card_avg

        # Group by card_id
        card_amounts: Dict[str, List[float]] = defaultdict(list)
        # Group by client_id
        user_amounts: Dict[str, List[float]] = defaultdict(list)

        c_scores, incomes, ages, limits = [], [], [], []

        for r in train_records:
            amt = float(r["transaction_amount"])
            cid = str(r["card_id"])
            uid = str(r["client_id"])

            card_amounts[cid].append(amt)
            user_amounts[uid].append(amt)

            if r.get("credit_score") is not None:
                c_scores.append(float(r["credit_score"]))
            if r.get("yearly_income") is not None:
                incomes.append(float(r["yearly_income"]))
            if r.get("current_age") is not None:
                ages.append(float(r["current_age"]))
            if r.get("credit_limit") is not None:
                limits.append(float(r["credit_limit"]))

        # Aggregate on train
        self.card_avg = {cid: float(np.mean(vals)) for cid, vals in card_amounts.items()}
        self.user_avg = {uid: float(np.mean(vals)) for uid, vals in user_amounts.items()}
        self.user_txn_count = {uid: float(len(vals)) for uid, vals in user_amounts.items()}
        self.global_user_txn_count = float(np.mean(list(self.user_txn_count.values())))

        if c_scores:
            self.median_credit_score = float(np.median(c_scores))
        if incomes:
            self.median_yearly_income = float(np.median(incomes))
        if ages:
            self.median_current_age = float(np.median(ages))
        if limits:
            self.median_credit_limit = float(np.median(limits))

        # Extract raw feature matrix on TRAIN to fit scaler
        X_raw = self._extract_raw_matrix(train_records)
        self.scaler_means = np.mean(X_raw, axis=0)
        self.scaler_stds = np.std(X_raw, axis=0)
        self.scaler_stds[self.scaler_stds < 1e-6] = 1.0

        self.fitted = True

    def _extract_single_feature_vector(self, r: Dict[str, Any]) -> List[float]:
        amt_raw = r.get("transaction_amount")
        amt = float(amt_raw) if amt_raw is not None else 0.0

        limit_raw = r.get("credit_limit")
        limit = float(limit_raw) if limit_raw is not None else self.median_credit_limit
        ratio = (amt / limit) if limit > 0 else 0.0

        hour_raw = r.get("hour")
        hour = int(hour_raw) if hour_raw is not None else 12
        is_night = 1.0 if 1 <= hour <= 5 else 0.0

        dow_raw = r.get("day_of_week")
        dow = int(dow_raw) if dow_raw is not None else 2
        is_weekend = 1.0 if dow in (5, 6) else 0.0

        month_raw = r.get("month")
        month = int(month_raw) if month_raw is not None else 6

        mcc_raw = r.get("mcc")
        mcc = int(mcc_raw) if mcc_raw is not None else 0
        is_high_risk_mcc = 1.0 if mcc in HIGH_RISK_MCCS else 0.0

        use_chip_raw = str(r.get("use_chip") or "Swipe Transaction")
        use_chip_encoded = float(self.use_chip_map.get(use_chip_raw, 0))

        brand_raw = str(r.get("card_brand") or "Visa")
        brand_encoded = float(self.brand_map.get(brand_raw, 0))

        type_raw = str(r.get("card_type") or "Debit")
        type_encoded = float(self.type_map.get(type_raw, 0))

        has_chip_encoded = 1.0 if str(r.get("has_chip") or "").upper() == "YES" else 0.0
        dark_web_encoded = 1.0 if str(r.get("card_on_dark_web") or "").lower() == "yes" else 0.0

        c_score_raw = r.get("credit_score")
        c_score = float(c_score_raw) if c_score_raw is not None else self.median_credit_score

        income_raw = r.get("yearly_income")
        income = float(income_raw) if income_raw is not None else self.median_yearly_income

        age_raw = r.get("current_age")
        age = float(age_raw) if age_raw is not None else self.median_current_age

        gender_encoded = 1.0 if str(r.get("gender") or "").lower() == "female" else 0.0

        has_error = 1.0 if r.get("errors") else 0.0

        # Features with fallback for unknown card/user
        cid = str(r.get("card_id", ""))
        c_avg = self.card_avg.get(cid, self.global_card_avg)
        dev_card = amt - c_avg

        uid = str(r.get("client_id", ""))
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
