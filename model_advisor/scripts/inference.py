"""
model_advisor/scripts/inference.py
==================================
Standalone local inference engine for model_advisor.
Takes a personal financial profile (JSON) and returns structured financial advice in Vietnamese:
{
  "summary": "...",
  "warnings": [],
  "suggestions": [],
  "confidence": 0.85
}

Usage:
    python model_advisor/scripts/inference.py --input model_advisor/tests/sample.json
    cat model_advisor/tests/sample.json | python model_advisor/scripts/inference.py
"""

import sys
import json
import argparse
import pickle
from pathlib import Path
from typing import Dict, Any, List
import numpy as np

# Ensure scripts directory is on python path for unpickling
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

# Import definitions needed for pickle and feature extraction
from train import (
    extract_features,
    StandardScalerCustom,
    SoftmaxMLPClassifier,
    RidgeRegressor,
    CLASS_LABELS,
    IDX_TO_LABEL,
)

BASE_DIR = CURRENT_DIR.parent
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "advisor_model.pkl"


class AdvisorInferenceEngine:
    """Production-ready inference engine for personal financial advice."""

    def __init__(self, model_path: Path = MODEL_PATH):
        if not model_path.exists():
            raise FileNotFoundError(
                f"Model bundle not found at '{model_path}'. "
                "Please run 'python model_advisor/scripts/train.py' first."
            )

        with open(model_path, "rb") as f:
            bundle = pickle.load(f)

        # Restore scaler
        self.scaler = StandardScalerCustom()
        self.scaler.mean = bundle["scaler"]["mean"]
        self.scaler.scale = bundle["scaler"]["scale"]

        # Restore classifier
        self.clf = SoftmaxMLPClassifier(in_dim=20, hidden_dim=32, out_dim=4)
        self.clf.W1 = bundle["classifier"]["W1"]
        self.clf.b1 = bundle["classifier"]["b1"]
        self.clf.W2 = bundle["classifier"]["W2"]
        self.clf.b2 = bundle["classifier"]["b2"]

        # Restore regressor
        self.reg = RidgeRegressor()
        self.reg.weights = bundle["regressor"]["weights"]
        self.reg.intercept = bundle["regressor"]["intercept"]

        self.feature_names = bundle.get("feature_names", [])
        self.class_labels = bundle.get("class_labels", CLASS_LABELS)

    def predict(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        """Generate structured financial advice from an input profile."""
        # 1. Feature Extraction & Scaling
        feat = extract_features(profile)
        feat_2d = feat.reshape(1, -1)
        feat_norm = self.scaler.transform(feat_2d)

        # 2. Machine Learning Predictions
        probs = self.clf.predict_proba(feat_norm)[0]  # (4,)
        pred_idx = int(np.argmax(probs))
        income = float(profile.get("income", 0.0))
        expense = float(profile.get("expense", 0.0))

        if income <= 0.0 and expense <= 0.0:
            health_grade = "HEALTHY"
            risk_score = 0.0
            confidence = 0.50
        elif income <= 0.0 and expense > 0.0:
            health_grade = "CRITICAL"
            risk_score = 0.95
            confidence = 0.85
        else:
            health_grade = self.class_labels[pred_idx]
            risk_score = float(self.reg.predict(feat_norm)[0])
            savings_rate = (income - expense) / income if income > 0 else 0.0
            if savings_rate < 0.10 and expense > 0:
                risk_score = max(risk_score, 0.45)
            risk_score = round(max(0.0, min(1.0, risk_score)), 2)

            # 3. Confidence Calculation
            max_prob = float(np.max(probs))
            # Shannon entropy normalized to [0, 1]
            probs_safe = np.clip(probs, 1e-12, 1.0)
            entropy = float(-np.sum(probs_safe * np.log(probs_safe)) / np.log(len(probs)))
            completeness = 1.0 if (profile.get("categories") and profile.get("wallets")) else 0.8
            raw_confidence = 0.55 * max_prob + 0.30 * (1.0 - entropy) + 0.15 * completeness
            confidence = round(float(np.clip(raw_confidence, 0.70, 0.98)), 2)

        # 4. Contextual Vietnamese Advice Synthesis
        summary, warnings, suggestions = self._synthesize_advice(
            profile=profile,
            health_grade=health_grade,
            risk_score=risk_score,
            confidence=confidence,
        )

        return {
            "summary": summary,
            "warnings": warnings,
            "suggestions": suggestions,
            "confidence": confidence,
            "health_grade": health_grade,
            "risk_score": risk_score,
        }

    def _synthesize_advice(
        self,
        profile: Dict[str, Any],
        health_grade: str,
        risk_score: float,
        confidence: float,
    ) -> (str, List[str], List[str]):
        income = float(profile.get("income", 0.0))
        expense = float(profile.get("expense", 0.0))
        prev_expense = float(profile.get("previous_month_expense", expense))
        categories = profile.get("categories", [])
        wallets = profile.get("wallets", [])
        savings_goals = profile.get("savings_goals", [])

        net_flow = income - expense
        savings_rate = (net_flow / income) if income > 0 else 0.0
        total_wallet = sum(float(w.get("balance", 0.0)) for w in wallets)
        reserve_months = (total_wallet / expense) if expense > 0 else 0.0

        # Overbudget categories
        overbudget_items = []
        for c in categories:
            b = float(c.get("budget", 0.0))
            a = float(c.get("amount", 0.0))
            if b > 0 and a > b:
                diff = a - b
                ratio = (a / b - 1.0) * 100.0
                overbudget_items.append((c.get("name", ""), diff, ratio))
        overbudget_items.sort(key=lambda x: x[1], reverse=True)

        # -------------------------------------------------------------
        # 1. Summary Generation
        # -------------------------------------------------------------
        if income <= 0.0 and expense <= 0.0:
            summary = (
                "Chưa ghi nhận dữ liệu thu chi trong kỳ. "
                "Hãy bắt đầu ghi chép các giao dịch hàng ngày để AI phân tích sức khỏe tài chính cho bạn."
            )
            warnings = []
            suggestions = [
                "Bắt đầu ghi chép các khoản chi tiêu đầu tiên trong tháng để xây dựng thói quen tài chính tốt.",
                "Thiết lập ngân sách dự kiến cho các danh mục thiết yếu như Ăn uống, Đi lại và Hóa đơn.",
            ]
            return summary, warnings, suggestions

        if health_grade == "CRITICAL":
            summary = (
                f"Đánh giá tài chính NGUY CẤP (Điểm rủi ro: {risk_score:.2f}): "
                f"Tổng chi tiêu ({expense:,.0f}đ) đang vượt thu nhập ({income:,.0f}đ), "
                f"thâm hụt dòng tiền {abs(net_flow):,.0f}đ trong tháng. "
                f"Quỹ dự phòng hiện tại chỉ tương đương {reserve_months:.1f} tháng chi phí sinh hoạt. "
                f"Bạn cần hành động khẩn cấp để chặn đà suy giảm tài chính."
            )
        elif health_grade == "CAUTION":
            summary = (
                f"Đánh giá tài chính CẦN LƯU TÂM (Điểm rủi ro: {risk_score:.2f}): "
                f"Thu nhập đạt {income:,.0f}đ, chi tiêu {expense:,.0f}đ, thặng dư ròng {net_flow:,.0f}đ. "
                f"Tuy nhiên, tỷ lệ tiết kiệm còn mỏng ({savings_rate*100:.1f}%) hoặc quỹ dự phòng ({reserve_months:.1f} tháng) "
                f"chưa đạt ngưỡng an toàn chuẩn (3-6 tháng). Cần thắt chặt các khoản chi tùy ý."
            )
        elif health_grade == "HEALTHY":
            summary = (
                f"Đánh giá tài chính LÀNH MẠNH & ỔN ĐỊNH (Điểm rủi ro: {risk_score:.2f}): "
                f"Thu nhập {income:,.0f}đ, chi tiêu {expense:,.0f}đ. "
                f"Bạn duy trì tỷ lệ tích lũy tốt đạt {savings_rate*100:.1f}% (thặng dư {net_flow:,.0f}đ). "
                f"Quỹ dự phòng hiện đạt {reserve_months:.1f} tháng, đảm bảo sự an tâm trước các biến động ngắn hạn."
            )
        else:  # EXCELLENT
            summary = (
                f"Đánh giá tài chính XUẤT SẮC (Điểm rủi ro: {risk_score:.2f}): "
                f"Hiệu quả quản lý tài chính vượt trội với tỷ lệ tiết kiệm ấn tượng {savings_rate*100:.1f}% "
                f"(dư dả {net_flow:,.0f}đ/tháng). Quỹ tích lũy và thanh khoản rất vững chắc ({reserve_months:.1f} tháng chi tiêu). "
                f"Bạn có nền tảng lý tưởng để mở rộng danh mục đầu tư gia tăng tài sản."
            )

        # -------------------------------------------------------------
        # 2. Warnings Generation
        # -------------------------------------------------------------
        warnings = []
        if net_flow < 0:
            warnings.append(
                f"Cảnh báo thâm hụt dòng tiền: Thu không đủ bù chi, thiếu hụt {abs(net_flow):,.0f}đ trong kỳ này."
            )

        if reserve_months < 1.0:
            warnings.append(
                f"Cảnh báo khẩn cấp quỹ dự phòng: Tổng số dư ví ({total_wallet:,.0f}đ) chưa đủ trang trải 1 tháng chi tiêu tối thiểu."
            )
        elif reserve_months < 2.5:
            warnings.append(
                f"Cảnh báo đệm tài chính mỏng: Quỹ dự phòng đạt {reserve_months:.1f} tháng (thấp hơn khuyến nghị 3-6 tháng)."
            )

        # Top overbudget alerts
        for name, diff, ratio in overbudget_items[:3]:
            warnings.append(
                f"Vượt hạn mức ngân sách: Danh mục '{name}' đã chi vượt định mức {diff:,.0f}đ (+{ratio:.1f}%)."
            )

        # Surge warning
        if prev_expense > 0 and (expense - prev_expense) / prev_expense > 0.20:
            surge_pct = ((expense - prev_expense) / prev_expense) * 100.0
            warnings.append(
                f"Cảnh báo tăng trưởng chi tiêu: Tổng chi tháng này tăng mạnh +{surge_pct:.1f}% so với tháng trước."
            )

        if not warnings and health_grade in ["HEALTHY", "EXCELLENT"]:
            warnings.append("Không ghi nhận cảnh báo rủi ro nghiêm trọng nào trong kỳ chi tiêu này.")

        # -------------------------------------------------------------
        # 3. Suggestions Generation
        # -------------------------------------------------------------
        suggestions = []

        # If overbudget, recommend cutting top overbudget item
        if overbudget_items:
            top_name, top_diff, _ = overbudget_items[0]
            suggestions.append(
                f"Cắt giảm ngay tối thiểu {top_diff:,.0f}đ tại danh mục '{top_name}' để đưa chi tiêu về đúng ngân sách ban đầu."
            )

        # Emergency fund suggestion
        target_emergency_3m = expense * 3.0
        if reserve_months < 3.0:
            deficit_reserve = max(0.0, target_emergency_3m - total_wallet)
            suggestions.append(
                f"Ưu tiên xây dựng Quỹ dự phòng khẩn cấp đạt mốc 3 tháng ({target_emergency_3m:,.0f}đ), "
                f"còn thiếu khoảng {deficit_reserve:,.0f}đ."
            )

        # Savings goals automation
        if savings_goals:
            active_goal = savings_goals[0]
            monthly_tg = float(active_goal.get("monthly_target", 0.0))
            if monthly_tg > 0:
                suggestions.append(
                    f"Thiết lập trích xuất tự động {monthly_tg:,.0f}đ vào mục tiêu '{active_goal.get('name')}' "
                    f"ngay trong ngày có lương để đảm bảo kỷ luật tài chính."
                )
            else:
                suggestions.append(
                    f"Đặt mục tiêu tích lũy cụ thể hàng tháng cho kế hoạch '{active_goal.get('name')}'."
                )
        elif net_flow > 0:
            suggestions.append(
                f"Khởi tạo ít nhất 1 mục tiêu tiết kiệm dài hạn (nhà cửa, hưu trí hoặc quỹ phát triển bản thân)."
            )

        # 50/30/20 rebalancing or investment
        if health_grade in ["CRITICAL", "CAUTION"]:
            suggestions.append(
                "Áp dụng nguyên tắc 50/30/20: Giữ chi phí sinh hoạt thiết yếu <= 50%, "
                "chi tiêu tùy ý <= 30%, và dành ít nhất 20% cho quỹ tích lũy."
            )
        else:
            investable_amount = net_flow * 0.70
            suggestions.append(
                f"Phân bổ phần thặng dư nhàn rỗi khoảng {investable_amount:,.0f}đ vào các kênh sinh lời ổn định "
                f"(quỹ mở trái phiếu, chứng chỉ tiền gửi hoặc tích lũy linh hoạt)."
            )

        return summary, warnings, suggestions


def main():
    parser = argparse.ArgumentParser(
        description="Run local inference for Personal Financial Advisor (model_advisor)."
    )
    parser.add_argument(
        "--input",
        type=str,
        default=None,
        help="Path to financial profile JSON file (or '-' to read from stdin).",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Output only the 4 requested keys: summary, warnings, suggestions, confidence.",
    )
    args = parser.parse_args()

    # Load input profile
    raw_data = None
    if args.input and args.input != "-":
        input_path = Path(args.input)
        if not input_path.exists():
            print(f"Error: Input file '{input_path}' not found.", file=sys.stderr)
            sys.exit(1)
        with open(input_path, "r", encoding="utf-8") as f:
            raw_data = json.load(f)
    else:
        if not sys.stdin.isatty():
            raw_data = json.load(sys.stdin)
        else:
            default_sample = BASE_DIR / "tests" / "sample.json"
            if default_sample.exists():
                with open(default_sample, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)
            else:
                parser.print_help()
                sys.exit(1)

    # If list of samples was passed, take first item
    if isinstance(raw_data, list):
        profile = raw_data[0]
    else:
        profile = raw_data

    engine = AdvisorInferenceEngine()
    result = engine.predict(profile)

    # Format strictly according to user specification
    output = {
        "summary": result["summary"],
        "warnings": result["warnings"],
        "suggestions": result["suggestions"],
        "confidence": result["confidence"],
    }

    # Print pure JSON output
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
