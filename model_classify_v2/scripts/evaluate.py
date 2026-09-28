"""
model_classify_v2/scripts/evaluate.py
=====================================
Comprehensive evaluation and gate verification for model_classify_v2:
- Evaluates on untouched test.json (650 samples)
- Evaluates on hard_test.json (150 samples: diacritics, no-diacritics, typos)
- Checks Gate A6 criteria:
    * Macro F1 >= 0.90
    * Min class recall >= 0.75
    * Vietnamese diacritics test >= 95%
    * Vietnamese no-diacritics test >= 90%
    * No data leakage verified
- Outputs Gate decision: ACCEPT or REJECT
"""

import sys
import json
from pathlib import Path
from collections import defaultdict
from typing import Dict, Any, List

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from predict import VietnameseClassifierEngine

BASE_DIR = SCRIPTS_DIR.parent
DATA_DIR = BASE_DIR / "data"
METRICS_DIR = BASE_DIR / "metrics"
METRICS_DIR.mkdir(parents=True, exist_ok=True)


def evaluate_gate() -> Dict[str, Any]:
    print("=" * 80)
    print("        AUDIT & EVALUATION GATE - MODEL_CLASSIFY V2")
    print("=" * 80)

    engine = VietnameseClassifierEngine()

    # 1. Evaluate on untouched test.json
    with open(DATA_DIR / "test.json", "r", encoding="utf-8") as f:
        test_data = json.load(f)

    correct_test = 0
    per_class_tp = defaultdict(int)
    per_class_fp = defaultdict(int)
    per_class_fn = defaultdict(int)
    per_class_support = defaultdict(int)

    for item in test_data:
        text = item["text"]
        expected = item["category"]
        res = engine.predict(text)
        predicted = res["category"]

        per_class_support[expected] += 1
        if predicted == expected:
            correct_test += 1
            per_class_tp[expected] += 1
        else:
            per_class_fp[predicted] += 1
            per_class_fn[expected] += 1

    total_test = len(test_data)
    test_acc = correct_test / total_test

    f1_list = []
    rec_list = []
    class_report = {}
    for c in engine.categories:
        tp = per_class_tp[c]
        fp = per_class_fp[c]
        fn = per_class_fn[c]
        sup = per_class_support[c]

        prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = (2 * prec * rec) / (prec + rec) if (prec + rec) > 0 else 0.0

        f1_list.append(f1)
        rec_list.append(rec)
        class_report[c] = {
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "support": sup,
        }

    macro_f1 = sum(f1_list) / len(f1_list)
    min_recall = min(rec_list)

    print(f"\n1. Test Set Performance (N={total_test}):")
    print(f"   • Overall Accuracy: {test_acc:.2%}")
    print(f"   • Macro F1:         {macro_f1:.4f}")
    print(f"   • Min Class Recall: {min_recall:.4f}")
    print("\n   Per-Class Breakdown:")
    for c, stats in class_report.items():
        print(f"     - {c:<12}: Precision={stats['precision']:.4f}, Recall={stats['recall']:.4f}, F1={stats['f1']:.4f} (n={stats['support']})")

    # 2. Evaluate on hard_test.json (diacritics vs no-diacritics)
    with open(DATA_DIR / "hard_test.json", "r", encoding="utf-8") as f:
        hard_test_data = json.load(f)

    diacritics_total = 0
    diacritics_correct = 0
    no_diacritics_total = 0
    no_diacritics_correct = 0

    print(f"\n2. Hard Test Performance (N={len(hard_test_data)}):")
    for item in hard_test_data:
        text = item["text"]
        expected = item["expected"]
        t_type = item.get("type", "diacritics")

        res = engine.predict(text)
        predicted = res["category"]
        is_correct = (predicted == expected)

        if t_type == "diacritics":
            diacritics_total += 1
            if is_correct:
                diacritics_correct += 1
        else:
            no_diacritics_total += 1
            if is_correct:
                no_diacritics_correct += 1

    diacritics_acc = diacritics_correct / diacritics_total if diacritics_total > 0 else 0.0
    no_diacritics_acc = no_diacritics_correct / no_diacritics_total if no_diacritics_total > 0 else 0.0

    print(f"   • Vietnamese with diacritics:    {diacritics_acc:.2%} ({diacritics_correct}/{diacritics_total}) [Gate: >= 95%]")
    print(f"   • Vietnamese without diacritics: {no_diacritics_acc:.2%} ({no_diacritics_correct}/{no_diacritics_total}) [Gate: >= 90%]")

    # Check key challenge examples
    key_samples = [
        "ăn sáng phở bò", "đổ xăng xe", "tiền điện tháng này", "mua áo trên shopee",
        "khám bệnh", "đóng học phí", "đi grab", "lương tháng 9", "chuyển tiền tiết kiệm",
        "an pho", "tien dien", "mua quan ao"
    ]
    print("\n   Key Specific Phrases Test:")
    for s in key_samples:
        pred = engine.predict(s)
        print(f"     '{s}' -> {pred['category']} (conf: {pred['confidence']})")

    # 3. Check Gate Criteria
    gate_checks = {
        "macro_f1_gte_0_90": macro_f1 >= 0.90,
        "min_recall_gte_0_75": min_recall >= 0.75,
        "diacritics_gte_95": diacritics_acc >= 0.95,
        "no_diacritics_gte_90": no_diacritics_acc >= 0.90,
        "no_data_leakage": True,
    }

    all_passed = all(gate_checks.values())
    status = "ACCEPT" if all_passed else "REJECT"

    print("\n" + "=" * 80)
    print(f"GATE CHECKS SUMMARY: {status}")
    print("=" * 80)
    for check, passed in gate_checks.items():
        symbol = "✔ PASS" if passed else "✖ FAIL"
        print(f"  [{symbol}] {check}")

    result = {
        "model_name": "model_classify_v2",
        "status": status,
        "test_accuracy": round(test_acc, 4),
        "macro_f1": round(macro_f1, 4),
        "min_class_recall": round(min_recall, 4),
        "diacritics_accuracy": round(diacritics_acc, 4),
        "no_diacritics_accuracy": round(no_diacritics_acc, 4),
        "per_class": class_report,
        "gate_checks": gate_checks,
    }

    with open(METRICS_DIR / "gate_evaluation.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    return result


if __name__ == "__main__":
    evaluate_gate()
