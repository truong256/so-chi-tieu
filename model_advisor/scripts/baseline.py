"""
model_advisor/scripts/baseline.py
=================================
Rule-based heuristic baseline model for personal financial advice.
Serves as the benchmark to evaluate the machine learning / fine-tuned model.

Usage:
    python model_advisor/scripts/baseline.py
"""

import time
import json
from pathlib import Path
from typing import Dict, Any, List
import time
import json
from pathlib import Path
from typing import Dict, Any, List
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
METRICS_DIR = BASE_DIR / "metrics"
METRICS_DIR.mkdir(parents=True, exist_ok=True)


def calculate_metrics(y_true_grade: List[str], y_pred_grade: List[str], y_true_risk: List[float], y_pred_risk: List[float]):
    classes = sorted(list(set(y_true_grade) | set(y_pred_grade)))
    y_true_arr = np.array(y_true_grade)
    y_pred_arr = np.array(y_pred_grade)

    # Accuracy
    acc = float(np.mean(y_true_arr == y_pred_arr))

    # Precision, Recall, F1 per class
    f1s = []
    class_metrics = {}
    for c in classes:
        tp = int(np.sum((y_true_arr == c) & (y_pred_arr == c)))
        fp = int(np.sum((y_true_arr != c) & (y_pred_arr == c)))
        fn = int(np.sum((y_true_arr == c) & (y_pred_arr != c)))

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0
        f1s.append(f1)
        class_metrics[c] = {
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1_score": round(f1, 4),
            "support": int(np.sum(y_true_arr == c))
        }

    macro_f1 = float(np.mean(f1s)) if f1s else 0.0
    mae_risk = float(np.mean(np.abs(np.array(y_true_risk) - np.array(y_pred_risk))))

    return acc, macro_f1, mae_risk, class_metrics


class RuleBasedBaselineAdvisor:
    """Heuristic rule-based baseline advisor."""

    def predict(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        income = float(profile.get("income", 0))
        expense = float(profile.get("expense", 0))
        categories = profile.get("categories", [])
        savings_goals = profile.get("savings_goals", [])
        wallets = profile.get("wallets", [])

        net_flow = income - expense
        savings_rate = (net_flow / income) if income > 0 else 0.0

        # Heuristic Health Grade
        if expense > income:
            grade = "CRITICAL"
            risk_score = 0.85
            confidence = 0.72
        elif savings_rate < 0.15:
            grade = "CAUTION"
            risk_score = 0.60
            confidence = 0.70
        elif savings_rate < 0.35:
            grade = "HEALTHY"
            risk_score = 0.30
            confidence = 0.75
        else:
            grade = "EXCELLENT"
            risk_score = 0.10
            confidence = 0.80

        # Summary
        if net_flow < 0:
            summary = (
                f"Đánh giá sơ bộ: Chi tiêu ({expense:,.0f}đ) vượt quá thu nhập ({income:,.0f}đ), "
                f"thâm hụt {abs(net_flow):,.0f}đ. Cần cắt giảm chi tiêu ngay lập tức."
            )
        else:
            summary = (
                f"Đánh giá sơ bộ: Thu nhập {income:,.0f}đ, chi tiêu {expense:,.0f}đ. "
                f"Dư dả {net_flow:,.0f}đ (tỷ lệ tiết kiệm {savings_rate*100:.1f}%)."
            )

        # Warnings
        warnings = []
        if net_flow < 0:
            warnings.append(f"Cảnh báo: Dòng tiền âm {abs(net_flow):,.0f}đ trong tháng.")

        total_wallet = sum(w.get("balance", 0) for w in wallets)
        months_reserve = (total_wallet / expense) if expense > 0 else 0
        if months_reserve < 2.0:
            warnings.append("Cảnh báo: Quỹ dự phòng dưới 2 tháng chi tiêu.")

        for cat in categories:
            b = cat.get("budget", 0)
            a = cat.get("amount", 0)
            if b > 0 and a > b:
                warnings.append(f"Danh mục '{cat.get('name')}' vượt ngân sách {a - b:,.0f}đ.")

        # Suggestions
        suggestions = []
        if net_flow < 0:
            suggestions.append("Cắt giảm chi tiêu tùy ý để đưa dòng tiền về mức dương.")
            suggestions.append("Tạm dừng mua sắm các khoản chi không cấp bách.")
        elif savings_rate < 0.20:
            suggestions.append("Tăng tỷ lệ tiết kiệm lên mức tối thiểu 20% theo quy tắc 50/30/20.")
            suggestions.append("Xem xét lại các danh mục chi tiêu ăn ngoài và giải trí.")
        else:
            suggestions.append("Duy trì tỷ lệ tiết kiệm hiện tại và tìm hiểu các kênh đầu tư sinh lời.")
            suggestions.append("Tiếp tục đóng góp định kỳ vào mục tiêu tích lũy.")

        return {
            "summary": summary,
            "warnings": warnings,
            "suggestions": suggestions,
            "confidence": confidence,
            "health_grade": grade,
            "risk_score": risk_score,
        }


def evaluate_baseline():
    test_path = DATA_DIR / "test.json"
    with open(test_path, "r", encoding="utf-8") as f:
        test_data = json.load(f)

    advisor = RuleBasedBaselineAdvisor()

    y_true_grade = []
    y_pred_grade = []
    y_true_risk = []
    y_pred_risk = []
    latencies = []

    for sample in test_data:
        t0 = time.perf_counter()
        pred = advisor.predict(sample)
        lat = (time.perf_counter() - t0) * 1000.0  # ms
        latencies.append(lat)

        gt = sample["ground_truth"]
        y_true_grade.append(gt["health_grade"])
        y_pred_grade.append(pred["health_grade"])
        y_true_risk.append(gt["risk_score"])
        y_pred_risk.append(pred["risk_score"])

    # Metrics
    acc, macro_f1, mae_risk, class_metrics = calculate_metrics(y_true_grade, y_pred_grade, y_true_risk, y_pred_risk)
    avg_latency = sum(latencies) / len(latencies)

    results = {
        "model_name": "RuleBased_Baseline",
        "test_samples": len(test_data),
        "health_grade_accuracy": round(float(acc), 4),
        "health_grade_macro_f1": round(float(macro_f1), 4),
        "risk_score_mae": round(float(mae_risk), 4),
        "per_class_metrics": class_metrics,
        "avg_latency_ms": round(float(avg_latency), 3),
        "p95_latency_ms": round(float(sorted(latencies)[int(len(latencies) * 0.95)]), 3),
    }

    out_file = METRICS_DIR / "baseline_metrics.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print("==================================================")
    print("BASELINE EVALUATION RESULTS (HEURISTIC ENGINE)")
    print("==================================================")
    print(f"Test Samples:             {results['test_samples']}")
    print(f"Health Grade Accuracy:    {results['health_grade_accuracy']:.2%}")
    print(f"Health Grade Macro F1:    {results['health_grade_macro_f1']:.4f}")
    print(f"Risk Score MAE:           {results['risk_score_mae']:.4f}")
    print(f"Avg Latency:              {results['avg_latency_ms']:.2f} ms")
    print(f"P95 Latency:              {results['p95_latency_ms']:.2f} ms")
    print(f"✔ Metrics saved to:       {out_file}")
    print("==================================================")


if __name__ == "__main__":
    evaluate_baseline()
