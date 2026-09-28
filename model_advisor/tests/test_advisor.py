"""
model_advisor/tests/test_advisor.py
===================================
Automated test suite for model_advisor:
- Data & schema verification
- Feature extraction accuracy
- Model loading & inference correctness
- Edge case handling (zero income, missing categories, empty wallets)
- Output format compliance
"""

import sys
import json
import pytest
from pathlib import Path
import numpy as np

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from inference import AdvisorInferenceEngine
from train import extract_features, FEATURE_NAMES

TESTS_DIR = Path(__file__).resolve().parent
SAMPLE_PATH = TESTS_DIR / "sample.json"
DANGER_PATH = TESTS_DIR / "sample_danger.json"
EXCELLENT_PATH = TESTS_DIR / "sample_excellent.json"


@pytest.fixture(scope="module")
def engine():
    return AdvisorInferenceEngine()


@pytest.fixture
def sample_profile():
    with open(SAMPLE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def test_feature_extraction(sample_profile):
    feat = extract_features(sample_profile)
    assert isinstance(feat, np.ndarray)
    assert feat.shape == (20,)
    assert len(FEATURE_NAMES) == 20
    assert not np.isnan(feat).any()
    assert not np.isinf(feat).any()


def test_inference_output_schema(engine, sample_profile):
    output = engine.predict(sample_profile)

    # Required keys
    assert "summary" in output
    assert "warnings" in output
    assert "suggestions" in output
    assert "confidence" in output

    # Type assertions
    assert isinstance(output["summary"], str)
    assert len(output["summary"]) > 20
    assert isinstance(output["warnings"], list)
    assert isinstance(output["suggestions"], list)
    assert isinstance(output["confidence"], float)

    # Range assertions
    assert 0.0 <= output["confidence"] <= 1.0


def test_inference_danger_archetype(engine):
    with open(DANGER_PATH, "r", encoding="utf-8") as f:
        danger_data = json.load(f)

    res = engine.predict(danger_data)
    assert res["health_grade"] == "CRITICAL"
    assert res["risk_score"] > 0.70
    assert len(res["warnings"]) > 0
    assert any("thâm hụt" in w.lower() or "vượt" in w.lower() for w in res["warnings"])


def test_inference_excellent_archetype(engine):
    with open(EXCELLENT_PATH, "r", encoding="utf-8") as f:
        exc_data = json.load(f)

    res = engine.predict(exc_data)
    assert res["health_grade"] == "EXCELLENT"
    assert res["risk_score"] < 0.20
    assert "XUẤT SẮC" in res["summary"]


def test_edge_case_minimal_profile(engine):
    """Test inference when profile has minimal or empty lists."""
    minimal_profile = {
        "user_id": "usr_minimal",
        "month": "2026-09",
        "income": 10000000.0,
        "expense": 8000000.0,
        "categories": [],
        "wallets": [],
        "savings_goals": [],
    }
    res = engine.predict(minimal_profile)
    assert isinstance(res["summary"], str)
    assert 0.0 <= res["confidence"] <= 1.0
    assert isinstance(res["suggestions"], list)


def test_edge_case_zero_income(engine):
    """Test inference when income is zero."""
    zero_income = {
        "user_id": "usr_zero",
        "month": "2026-09",
        "income": 0.0,
        "expense": 5000000.0,
        "categories": [
            {"name": "Ăn uống gia đình", "kind": "expense", "budget": 3000000.0, "amount": 4000000.0}
        ],
        "wallets": [{"name": "Ví", "balance": 1000000.0}],
    }
    res = engine.predict(zero_income)
    assert res["health_grade"] == "CRITICAL"
    assert res["risk_score"] > 0.70


def test_inference_latency(engine, sample_profile):
    """Ensure inference completes well within real-time SLA (< 20ms)."""
    import time
    latencies = []
    for _ in range(50):
        t0 = time.perf_counter()
        engine.predict(sample_profile)
        latencies.append((time.perf_counter() - t0) * 1000.0)

    avg_ms = sum(latencies) / len(latencies)
    assert avg_ms < 5.0, f"Average latency too high: {avg_ms} ms"
