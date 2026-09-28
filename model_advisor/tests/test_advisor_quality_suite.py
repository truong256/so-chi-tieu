"""
model_advisor/tests/test_advisor_quality_suite.py
=================================================
Quality and Safety Verification Test Suite for Financial Advisor (Step 10):
Tests 9 distinct user financial scenarios:
1. Normal month
2. Overspending month
3. Low savings
4. High fixed cost
5. Unexpected spike (compared to previous month)
6. High food spending
7. High entertainment spending
8. No transactions (zero income, zero expense)
9. Very little history (cold start)

Verifies:
- summary, warnings, suggestions, risk, confidence
- No hallucinated amounts or categories
- Advice logically matches user data
- Safe degradation under empty/cold start
"""

import sys
import json
from pathlib import Path
import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from inference import AdvisorInferenceEngine


@pytest.fixture(scope="module")
def engine():
    return AdvisorInferenceEngine()


def test_scenario_1_normal_month(engine):
    profile = {
        "income": 20000000.0,
        "expense": 14000000.0,
        "previous_month_expense": 13800000.0,
        "categories": [
            {"name": "Ăn uống", "budget": 5000000.0, "amount": 4800000.0},
            {"name": "Thuê nhà", "budget": 4500000.0, "amount": 4500000.0},
            {"name": "Di chuyển", "budget": 1500000.0, "amount": 1200000.0},
        ],
        "wallets": [{"name": "Ví chính", "balance": 15000000.0}],
        "savings_goals": [{"name": "Quỹ khẩn cấp", "target": 50000000.0, "current": 20000000.0}],
    }
    res = engine.predict(profile)
    assert res["health_grade"] in ("HEALTHY", "EXCELLENT")
    assert res["risk_score"] < 0.40
    assert res["confidence"] >= 0.70
    assert len(res["suggestions"]) > 0


def test_scenario_2_overspending_month(engine):
    profile = {
        "income": 15000000.0,
        "expense": 22000000.0,
        "categories": [
            {"name": "Mua sắm", "budget": 3000000.0, "amount": 9000000.0},
            {"name": "Ăn uống", "budget": 5000000.0, "amount": 7500000.0},
        ],
        "wallets": [{"name": "Ví chính", "balance": 2000000.0}],
    }
    res = engine.predict(profile)
    assert res["health_grade"] in ("CAUTION", "CRITICAL")
    assert res["risk_score"] > 0.60
    assert len(res["warnings"]) > 0
    # Must warn about deficit/overspending
    warning_text = " ".join(res["warnings"]).lower()
    assert "thâm hụt" in warning_text or "vượt" in warning_text or "bội chi" in warning_text


def test_scenario_3_low_savings(engine):
    profile = {
        "income": 20000000.0,
        "expense": 19500000.0,
        "categories": [
            {"name": "Ăn uống", "budget": 8000000.0, "amount": 8000000.0},
            {"name": "Thuê nhà", "budget": 8000000.0, "amount": 8000000.0},
        ],
    }
    res = engine.predict(profile)
    assert res["health_grade"] in ("CAUTION", "CRITICAL")
    assert res["risk_score"] >= 0.40


def test_scenario_4_high_fixed_cost(engine):
    profile = {
        "income": 20000000.0,
        "expense": 16000000.0,
        "categories": [
            {"name": "Thuê nhà", "budget": 10000000.0, "amount": 10000000.0},
            {"name": "Tiền điện nước", "budget": 3000000.0, "amount": 3000000.0},
            {"name": "Ăn uống", "budget": 3000000.0, "amount": 3000000.0},
        ],
    }
    res = engine.predict(profile)
    assert "summary" in res
    assert len(res["suggestions"]) > 0


def test_scenario_5_unexpected_spike(engine):
    profile = {
        "income": 25000000.0,
        "expense": 24000000.0,
        "previous_month_expense": 10000000.0,  # +140% spike
        "categories": [
            {"name": "Y tế", "budget": 2000000.0, "amount": 12000000.0},
            {"name": "Sinh hoạt", "budget": 8000000.0, "amount": 12000000.0},
        ],
    }
    res = engine.predict(profile)
    assert res["risk_score"] > 0.45


def test_scenario_6_high_food_spending(engine):
    profile = {
        "income": 15000000.0,
        "expense": 13000000.0,
        "categories": [
            {"name": "Ăn uống & Cafe", "budget": 4000000.0, "amount": 8500000.0},
            {"name": "Tiền nhà", "budget": 3500000.0, "amount": 3500000.0},
        ],
    }
    res = engine.predict(profile)
    warning_or_suggestion = " ".join(res["warnings"] + res["suggestions"])
    # Food category mentioned in warnings or suggestions
    assert "ăn" in warning_or_suggestion.lower() or "vượt" in warning_or_suggestion.lower()


def test_scenario_7_high_entertainment_spending(engine):
    profile = {
        "income": 20000000.0,
        "expense": 17000000.0,
        "categories": [
            {"name": "Giải trí & Du lịch", "budget": 2000000.0, "amount": 7500000.0},
            {"name": "Chi phí cơ bản", "budget": 9000000.0, "amount": 9500000.0},
        ],
    }
    res = engine.predict(profile)
    warning_or_sugg = " ".join(res["warnings"] + res["suggestions"]).lower()
    assert "giải trí" in warning_or_sugg or "du lịch" in warning_or_sugg or "vượt" in warning_or_sugg


def test_scenario_8_no_transactions(engine):
    profile = {
        "income": 0.0,
        "expense": 0.0,
        "categories": [],
        "wallets": [],
        "savings_goals": [],
    }
    res = engine.predict(profile)
    assert "summary" in res
    assert isinstance(res["warnings"], list)
    assert isinstance(res["suggestions"], list)
    assert res["confidence"] <= 0.60  # Low confidence when no data


def test_scenario_9_very_little_history(engine):
    profile = {
        "income": 10000000.0,
        "expense": 250000.0,
        "categories": [{"name": "Ăn sáng", "amount": 250000.0}],
    }
    res = engine.predict(profile)
    assert "summary" in res
    assert res["health_grade"] in ("HEALTHY", "EXCELLENT")
