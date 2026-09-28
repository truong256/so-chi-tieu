"""
model_warning_v3/scripts/predict.py
===================================
Hardened Inference Engine for model_warning_v3:
- Zero data leakage: uses strictly frozen pipeline statistics from TRAIN.
- Smoothly handles unknown user, unknown card, null fields, 0 limit, and negative numbers.
- Completely immune to the float(None) bug.
- Returns risk score, risk level (SAFE, WARNING, DANGER), and contributing warning factors.
"""

import sys
import json
import pickle
import math
from pathlib import Path
from typing import Dict, Any, List
import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from pipeline import LeakageFreePipelineV3, FEATURE_NAMES, HIGH_RISK_MCCS, _safe_float, _safe_int
from classifier import RiskMLPClassifierV3

MODELS_DIR = SCRIPTS_DIR.parent / "models"


class RiskWarningEngineV3:
    def __init__(self, models_dir: Path = MODELS_DIR):
        model_file = models_dir / "warning_model.pkl"
        if not model_file.exists():
            raise FileNotFoundError(f"Model artifact not found at {model_file}")

        with open(model_file, "rb") as f:
            bundle = pickle.load(f)

        self.pipeline: LeakageFreePipelineV3 = bundle["pipeline"]
        self.thresholds = bundle["thresholds"]
        self.safe_threshold = float(self.thresholds.get("safe_threshold", 0.15))
        self.danger_threshold = float(self.thresholds.get("danger_threshold", 0.90))

        clf_dict = bundle["clf"]
        self.clf = RiskMLPClassifierV3(
            input_dim=clf_dict["input_dim"],
            hidden_dim=clf_dict["hidden_dim"],
            pos_weight=clf_dict["pos_weight"],
        )
        self.clf.W1 = clf_dict["W1"]
        self.clf.b1 = clf_dict["b1"]
        self.clf.W2 = clf_dict["W2"]
        self.clf.b2 = clf_dict["b2"]

    def evaluate_transaction(self, txn: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluate risk level of an incoming transaction with full error resilience.
        """
        if not isinstance(txn, dict):
            txn = {}

        # Transform using frozen pipeline
        x_scaled = self.pipeline.transform_single(txn)
        prob = float(self.clf.predict_proba(x_scaled.reshape(1, -1))[0])

        # Assign Risk Category based on frozen validation thresholds
        if prob >= self.danger_threshold:
            risk_level = "DANGER"
        elif prob >= self.safe_threshold:
            risk_level = "WARNING"
        else:
            risk_level = "SAFE"

        # Explainable warning factors (with 100% null resilience)
        factors: List[str] = []
        raw_amt = txn.get("transaction_amount")
        amt = max(0.0, _safe_float(raw_amt, 0.0))

        raw_limit = txn.get("credit_limit")
        limit = (
            _safe_float(raw_limit, self.pipeline.median_credit_limit)
            if raw_limit is not None and str(raw_limit).strip() != ""
            else self.pipeline.median_credit_limit
        )

        if limit > 0 and (amt / limit) >= 0.75:
            factors.append(f"Giao dịch chiếm tỷ lệ lớn hạn mức thẻ ({amt / limit:.0%})")

        if str(txn.get("card_on_dark_web", "") or "").lower() == "yes":
            factors.append("Thẻ có cảnh báo rò rỉ dữ liệu (Dark Web)")

        mcc = _safe_int(txn.get("mcc"), 0)
        if mcc in HIGH_RISK_MCCS:
            factors.append(f"Ngành hàng có mức rủi ro gian lận cao (MCC: {mcc})")

        hour = _safe_int(txn.get("hour"), 12)
        if 1 <= hour <= 5:
            factors.append(f"Giao dịch diễn ra vào khung giờ bất thường ban đêm ({hour:02d}:00)")

        uid = str(txn.get("client_id", "") or "")
        u_avg = self.pipeline.user_avg.get(uid, self.pipeline.global_user_avg)
        if u_avg > 0 and amt >= u_avg * 3.5:
            factors.append(f"Số tiền vượt {amt / u_avg:.1f} lần mức chi tiêu trung bình thông thường")

        if txn.get("errors"):
            factors.append(f"Phát hiện lỗi thử giao dịch: {txn['errors']}")

        return {
            "risk_score": round(prob, 4),
            "risk_level": risk_level,
            "safe_threshold": self.safe_threshold,
            "danger_threshold": self.danger_threshold,
            "factors": factors,
            "is_anomaly": risk_level != "SAFE",
        }


# Backwards compatibility alias
RiskWarningEngine = RiskWarningEngineV3


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Evaluate transaction risk (v3).")
    parser.add_argument("--amount", type=float, default=25000000.0)
    parser.add_argument("--limit", type=float, default=30000000.0)
    parser.add_argument("--mcc", type=int, default=5732)
    parser.add_argument("--hour", type=int, default=2)
    parser.add_argument("--dark-web", type=str, default="Yes")
    args = parser.parse_args()

    engine = RiskWarningEngineV3()
    res = engine.evaluate_transaction({
        "transaction_amount": args.amount,
        "credit_limit": args.limit,
        "mcc": args.mcc,
        "hour": args.hour,
        "card_on_dark_web": args.dark_web,
    })
    print(json.dumps(res, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
