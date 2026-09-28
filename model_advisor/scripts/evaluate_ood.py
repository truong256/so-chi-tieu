"""
model_advisor/scripts/evaluate_ood.py
====================================
Evaluate model_advisor on the 120 Out-Of-Distribution (OOD) & challenging edge cases.
Checks:
- Error / crash rate (0 expected)
- Predictions across difficult scenarios
- Confidence calibration under OOD
- Advice and warning generation soundness

Outputs:
    model_advisor/metrics/ood_evaluation_report.json
"""

import sys
import json
import time
from pathlib import Path
from collections import Counter
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BASE_DIR / "scripts"
TESTS_DIR = BASE_DIR / "tests"
METRICS_DIR = BASE_DIR / "metrics"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from inference import AdvisorInferenceEngine


def evaluate_ood():
    engine = AdvisorInferenceEngine()
    ood_file = TESTS_DIR / "out_of_distribution.jsonl"

    cases = []
    with open(ood_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                cases.append(json.loads(line))

    print("================================================================================")
    print(f"EVALUATING MODEL_ADVISOR ON OUT-OF-DISTRIBUTION (OOD) DATASET ({len(cases)} cases)")
    print("================================================================================")

    results_by_scenario = {}
    grade_distribution = Counter()
    latencies = []
    crashes = 0
    anomalies = []

    for c in cases:
        scenario = c.get("scenario", "unknown")
        if scenario not in results_by_scenario:
            results_by_scenario[scenario] = {
                "count": 0,
                "grades": Counter(),
                "avg_risk": [],
                "avg_conf": [],
            }

        t0 = time.perf_counter()
        try:
            pred = engine.predict(c)
            dt = (time.perf_counter() - t0) * 1000.0
            latencies.append(dt)

            grade = pred["health_grade"]
            risk = pred["risk_score"]
            conf = pred["confidence"]

            grade_distribution[grade] += 1
            results_by_scenario[scenario]["count"] += 1
            results_by_scenario[scenario]["grades"][grade] += 1
            results_by_scenario[scenario]["avg_risk"].append(risk)
            results_by_scenario[scenario]["avg_conf"].append(conf)

            # Scenario specific sanity checks
            if scenario == "zero_income_sabbatical" and grade != "CRITICAL":
                anomalies.append(f"Case {c['id']} (0 income): expected CRITICAL, got {grade}")
            if scenario == "massive_overbudget_runaway_spending" and grade not in ["CRITICAL", "CAUTION"]:
                anomalies.append(f"Case {c['id']} (massive overbudget): expected CRITICAL/CAUTION, got {grade}")
            if scenario == "high_earner_zero_reserve_lifestyle_inflation":
                # Must flag reserve warning
                has_reserve_warning = any("dự phòng" in w.lower() for w in pred["warnings"])
                if not has_reserve_warning:
                    anomalies.append(f"Case {c['id']} (0 reserve): missing emergency reserve warning")

        except Exception as e:
            crashes += 1
            anomalies.append(f"Crash in {c['id']} ({scenario}): {str(e)}")

    # Summarize per scenario
    summary_scenarios = {}
    for sc, data in results_by_scenario.items():
        summary_scenarios[sc] = {
            "count": data["count"],
            "grade_distribution": dict(data["grades"]),
            "mean_risk_score": round(float(np.mean(data["avg_risk"])), 3) if data["avg_risk"] else 0.0,
            "mean_confidence": round(float(np.mean(data["avg_conf"])), 3) if data["avg_conf"] else 0.0,
        }

    report = {
        "ood_dataset": "out_of_distribution.jsonl",
        "total_cases": len(cases),
        "crash_count": crashes,
        "robustness_rate": round((len(cases) - crashes) / len(cases) * 100.0, 2),
        "overall_grade_distribution": dict(grade_distribution),
        "mean_latency_ms": round(float(np.mean(latencies)), 3),
        "p95_latency_ms": round(float(np.percentile(latencies, 95)), 3),
        "scenario_breakdown": summary_scenarios,
        "detected_anomalies_count": len(anomalies),
        "sample_anomalies": anomalies[:10],
    }

    report_path = METRICS_DIR / "ood_evaluation_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"Robustness (Zero-crash Rate): {report['robustness_rate']}% ({crashes} crashes)")
    print(f"Mean Latency:                 {report['mean_latency_ms']:.3f} ms (P95: {report['p95_latency_ms']:.3f} ms)")
    print("\nOverall Grade Distribution under OOD Stress:")
    for g, cnt in grade_distribution.items():
        print(f"  • {g:<10}: {cnt:>3d} cases ({cnt/len(cases)*100:.1f}%)")

    print("\nScenario Breakdown:")
    for sc, stats in summary_scenarios.items():
        print(f"  [{sc}]")
        print(f"    Grades: {stats['grade_distribution']}, Mean Risk: {stats['mean_risk_score']:.2f}, Mean Conf: {stats['mean_confidence']:.2f}")

    print(f"\n✔ Full OOD report saved to: {report_path}")
    print("================================================================================")


if __name__ == "__main__":
    evaluate_ood()
