"""
model_advisor/scripts/validate_dataset.py
=========================================
Validates the structural integrity, schema compliance, distributions,
and split isolation of the dataset before model training.

Usage:
    python model_advisor/scripts/validate_dataset.py
"""

import sys
import json
from pathlib import Path
from collections import Counter
from typing import Dict, List, Any

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

REQUIRED_FIELDS = [
    "user_id", "period", "currency", "income", "expense",
    "previous_month_expense", "categories", "savings_goals",
    "wallets", "ground_truth"
]

GROUND_TRUTH_FIELDS = [
    "health_grade", "risk_score", "confidence",
    "summary", "warnings", "suggestions"
]

VALID_HEALTH_GRADES = {"EXCELLENT", "HEALTHY", "CAUTION", "CRITICAL"}


def validate_sample(sample: Dict[str, Any], idx: int, split_name: str) -> List[str]:
    """Validates an individual sample against schema and integrity rules."""
    errors = []

    # Check top-level required fields
    for field in REQUIRED_FIELDS:
        if field not in sample:
            errors.append(f"[{split_name}#{idx}] Missing required field: '{field}'")

    if errors:
        return errors

    # Check numeric bounds
    if sample["income"] <= 0:
        errors.append(f"[{split_name}#{idx}] income must be positive, got {sample['income']}")
    if sample["expense"] < 0:
        errors.append(f"[{split_name}#{idx}] expense must be non-negative, got {sample['expense']}")

    # Check categories
    if not isinstance(sample.get("categories"), list) or len(sample["categories"]) == 0:
        errors.append(f"[{split_name}#{idx}] categories must be a non-empty list")
    else:
        for c_idx, cat in enumerate(sample["categories"]):
            for cf in ["name", "kind", "amount", "budget"]:
                if cf not in cat:
                    errors.append(f"[{split_name}#{idx}] category #{c_idx} missing '{cf}'")

    # Check ground truth
    gt = sample.get("ground_truth", {})
    for gtf in GROUND_TRUTH_FIELDS:
        if gtf not in gt:
            errors.append(f"[{split_name}#{idx}] ground_truth missing '{gtf}'")

    if gt.get("health_grade") not in VALID_HEALTH_GRADES:
        errors.append(f"[{split_name}#{idx}] Invalid health_grade: {gt.get('health_grade')}")

    conf = gt.get("confidence", 0)
    if not (0.0 <= conf <= 1.0):
        errors.append(f"[{split_name}#{idx}] confidence {conf} not in [0.0, 1.0]")

    risk = gt.get("risk_score", 0)
    if not (0.0 <= risk <= 1.0):
        errors.append(f"[{split_name}#{idx}] risk_score {risk} not in [0.0, 1.0]")

    if not isinstance(gt.get("summary"), str) or len(gt["summary"].strip()) < 10:
        errors.append(f"[{split_name}#{idx}] summary must be a substantial string")

    if not isinstance(gt.get("warnings"), list):
        errors.append(f"[{split_name}#{idx}] warnings must be a list")

    if not isinstance(gt.get("suggestions"), list) or len(gt["suggestions"]) == 0:
        errors.append(f"[{split_name}#{idx}] suggestions must be a non-empty list")

    return errors


def validate_split(file_path: Path, split_name: str) -> (List[Dict[str, Any]], List[str]):
    """Loads and validates an entire dataset split."""
    if not file_path.exists():
        return [], [f"File not found: {file_path}"]

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list) or len(data) == 0:
        return [], [f"Split {split_name} is empty or not a list."]

    all_errors = []
    for idx, sample in enumerate(data):
        errs = validate_sample(sample, idx, split_name)
        all_errors.extend(errs)

    return data, all_errors


def main():
    print("==================================================")
    print("DATASET VALIDATION SUITE — MODEL ADVISOR")
    print("==================================================")

    splits = {
        "train": DATA_DIR / "train.json",
        "val": DATA_DIR / "val.json",
        "test": DATA_DIR / "test.json",
    }

    loaded_data = {}
    total_errors = []
    user_ids_by_split = {}

    for name, path in splits.items():
        print(f"\nValidating split: {name.upper()} ({path.name})...")
        data, errors = validate_split(path, name)
        loaded_data[name] = data
        total_errors.extend(errors)
        user_ids_by_split[name] = set(s.get("user_id") for s in data)

        if errors:
            print(f"  ❌ Found {len(errors)} validation errors in {name}!")
            for err in errors[:5]:
                print(f"     - {err}")
        else:
            print(f"  ✔ Schema & bounds check: PASSED ({len(data)} samples)")

        # Distribution metrics
        grades = [s["ground_truth"]["health_grade"] for s in data]
        counts = Counter(grades)
        print(f"  ✔ Class distribution: {dict(counts)}")

    # Check Data Leakage across splits
    print("\n--------------------------------------------------")
    print("Checking split isolation (Zero Data Leakage)...")
    train_ids = user_ids_by_split.get("train", set())
    val_ids = user_ids_by_split.get("val", set())
    test_ids = user_ids_by_split.get("test", set())

    leakage_train_val = train_ids.intersection(val_ids)
    leakage_train_test = train_ids.intersection(test_ids)
    leakage_val_test = val_ids.intersection(test_ids)

    if leakage_train_val or leakage_train_test or leakage_val_test:
        total_errors.append("Data leakage detected between splits!")
        print(f"  ❌ Leakage detected! Train-Val: {len(leakage_train_val)}, Train-Test: {len(leakage_train_test)}")
    else:
        print("  ✔ Zero overlap detected between Train, Val, and Test sets (100% disjoint).")

    print("\n==================================================")
    if total_errors:
        print(f"❌ VALIDATION FAILED with {len(total_errors)} errors.")
        sys.exit(1)
    else:
        print("✔ ALL DATASET INTEGRITY CHECKS PASSED (100% VALID).")
        print("==================================================")
        sys.exit(0)


if __name__ == "__main__":
    main()
