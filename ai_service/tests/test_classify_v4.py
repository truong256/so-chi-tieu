"""
ai_service/tests/test_classify_v4.py
====================================
Regression and quality test suite for Model Classify V4.
Verifies artifact integrity, inference contracts, and independent holdout criteria.
"""

import json
import pytest
from pathlib import Path
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
V4_DIR = PROJECT_ROOT / "model_classify_v4"
MODELS_DIR = V4_DIR / "models"
STAGING_TEST_SET = PROJECT_ROOT / "ai_service" / "data" / "staging_realistic_test_set.json"


@pytest.fixture(scope="module")
def v4_engine():
    import sys
    scripts_dir = V4_DIR / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from predict import VietnameseClassifierEngineV4
    return VietnameseClassifierEngineV4(models_dir=MODELS_DIR)


def test_v4_artifacts_exist():
    assert (MODELS_DIR / "vectorizer.pkl").exists(), "V4 vectorizer.pkl missing"
    assert (MODELS_DIR / "classifier_model.pkl").exists(), "V4 classifier_model.pkl missing"
    assert (MODELS_DIR / "metadata.json").exists(), "V4 metadata.json missing"
    assert (MODELS_DIR / "confidence_thresholds.json").exists(), "V4 confidence_thresholds.json missing"


def test_v4_metadata_contract():
    with open(MODELS_DIR / "metadata.json", "r", encoding="utf-8") as f:
        meta = json.load(f)
    assert meta["model_name"] == "model_classify_v4"
    assert meta["num_classes"] == 10
    assert meta["train_samples"] >= 3000
    assert meta["vocab_size"] >= 8000


def test_v4_inference_basic(v4_engine):
    res = v4_engine.predict("ăn phở gà 40k")
    assert res["category"] == "ăn uống"
    assert res["confidence"] > 0.50
    assert "suggestion_level" in res
    assert "is_confident" in res


def test_v4_boundary_hardening_cases(v4_engine):
    # Highway toll / ETC (was failed in V3)
    res_etc = v4_engine.predict("nạp tiền thẻ etc")
    assert res_etc["category"] == "di chuyển"

    # Security deposit (was failed in V3)
    res_coc = v4_engine.predict("tiền cọc giữ chỗ phòng")
    assert res_coc["category"] == "khác"

    # Pharmacy / Medical (was failed in V3)
    res_dau = v4_engine.predict("dầu gió xanh")
    assert res_dau["category"] == "sức khỏe"

    # Tax refund
    res_tax = v4_engine.predict("nhan tien hoan thue tncn")
    assert res_tax["category"] == "thu nhập"


def test_v4_independent_holdout_criteria(v4_engine):
    with open(STAGING_TEST_SET, "r", encoding="utf-8") as f:
        data = json.load(f)

    correct = 0
    high_conf_wrong = 0
    total = len(data)

    for item in data:
        text = item["text"]
        expected = item.get("expected") or item.get("expected_category")
        pred = v4_engine.predict(text)
        is_corr = (pred["category"] == expected)
        if is_corr:
            correct += 1
        if pred["confidence"] >= 0.60 and not is_corr:
            high_conf_wrong += 1

    accuracy = correct / total
    # Acceptance gate: V4 realistic accuracy must beat V3 (78.80%) by a significant margin
    assert accuracy >= 0.85, f"V4 realistic accuracy {accuracy:.2%} is below 85% requirement"
    # Acceptance gate: High confidence wrong count must be <= 2 (V3 was 4)
    assert high_conf_wrong <= 2, f"V4 high-confidence wrong count {high_conf_wrong} exceeds tolerance"
