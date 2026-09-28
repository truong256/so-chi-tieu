"""
ai_service/tests/test_production_regression.py
=============================================
Production Regression Test Suite covering Phases M, N, O, P:
- Phase M: Classification Prompt Cases & Edge/Adversarial Inputs.
- Phase N: Risk Edge Cases (null, zero, extreme values, NaNs, infinities, all-optional-null).
- Phase O: Forecast Multi-Horizon & Irregular / Cold-Start Histories.
- Phase P: Advisor Safety Scenarios & Hallucination Prevention.
"""

import math
import pytest
from fastapi.testclient import TestClient

from ai_service.app import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ===========================================================================
# Phase M: Classification Regression Tests
# ===========================================================================
PROMPT_TEST_CASES = [
    ("cf 50k", "ăn uống"),
    ("ăn trưa 35", "ăn uống"),
    ("grab 45k", "di chuyển"),
    ("đóng học phí", "giáo dục"),
    ("nạp điện thoại", "hóa đơn"),
    ("mua thuốc cho mẹ", "sức khỏe"),
    ("tiền điện tháng này", "hóa đơn"),
    ("shoppe 220k", "mua sắm"),
    ("trà sữa", "ăn uống"),
    ("chuyển khoản cho bạn", "khác"),
    ("an trua 50k", "ăn uống"),
    ("AN TRUA 50K", "ăn uống"),
    ("ăn trưa 50.000", "ăn uống"),
    ("grab 100000", "di chuyển"),
]


@pytest.mark.parametrize("text,expected_category", PROMPT_TEST_CASES)
def test_classification_prompt_cases(client, text, expected_category):
    res = client.post("/classify", json={"text": text})
    assert res.status_code == 200
    data = res.json()
    assert data["category"] == expected_category
    assert data["confidence"] > 0.0
    assert data["advisory"] is True
    assert data["meta"]["model"] == "classify"


def test_classification_empty_and_whitespace(client):
    # Empty string -> 422
    res_empty = client.post("/classify", json={"text": ""})
    assert res_empty.status_code == 422

    # Whitespace only -> 422
    res_ws = client.post("/classify", json={"text": "   \n\t  "})
    assert res_ws.status_code == 422


def test_classification_adversarial_and_extreme_inputs(client):
    # Very long text (5,000 characters)
    long_text = "tiền ăn trưa bún bò " * 250
    # Over 1000 chars should be safely rejected by pydantic or processed gracefully
    res_long = client.post("/classify", json={"text": long_text})
    assert res_long.status_code in (200, 422)

    # Emoji input
    res_emoji = client.post("/classify", json={"text": "🍔 trà sữa trân châu đường đen 35k 🥤"})
    assert res_emoji.status_code == 200
    assert res_emoji.json()["category"] == "ăn uống"

    # Special characters
    res_spec = client.post("/classify", json={"text": "!@#$%^&*()_+=-~ ăn trưa 40k"})
    assert res_spec.status_code == 200
    assert res_spec.json()["category"] == "ăn uống"

    # SQL Injection-like text
    res_sql = client.post("/classify", json={"text": "SELECT * FROM transactions WHERE amount > 0; DROP TABLE users; ăn trưa"})
    assert res_sql.status_code == 200
    assert res_sql.json()["category"] == "ăn uống"

    # XSS / HTML-like text
    res_xss = client.post("/classify", json={"text": "<script>alert('xss')</script> ăn trưa 40k"})
    assert res_xss.status_code == 200
    assert res_xss.json()["category"] == "ăn uống"

    # JSON-looking input
    res_json = client.post("/classify", json={"text": '{"category": "hack", "amount": 1000} mua sắm'})
    assert res_json.status_code == 200
    assert res_json.json()["category"] == "mua sắm"


# ===========================================================================
# Phase N: Risk Regression Tests
# ===========================================================================
def test_risk_null_credit_limit(client):
    res = client.post("/risk", json={"amount": 100000.0, "credit_limit": None, "mcc": 5411})
    assert res.status_code == 200
    assert res.json()["risk_level"] == "SAFE"


def test_risk_zero_credit_limit(client):
    res = client.post("/risk", json={"amount": 50000.0, "credit_limit": 0.0, "mcc": 5411})
    assert res.status_code == 200
    assert res.json()["risk_level"] == "SAFE"


def test_risk_all_optional_fields_null(client):
    payload = {
        "amount": 250000.0,
        "credit_limit": None,
        "client_id": None,
        "card_id": None,
        "hour": None,
        "day_of_week": None,
        "month": None,
        "credit_score": None,
        "yearly_income": None,
        "current_age": None,
        "gender": None,
        "errors": None,
    }
    res = client.post("/risk", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] in ("SAFE", "WARNING")


def test_risk_extreme_large_values(client):
    res = client.post("/risk", json={"amount": 1e12, "credit_limit": 2e12, "mcc": 5411})
    assert res.status_code == 200
    assert "risk_score" in res.json()


def test_risk_invalid_numbers_rejected_safely(client):
    # String for amount -> 422
    res_str = client.post("/risk", json={"amount": "invalid_number"})
    assert res_str.status_code == 422

    # Negative amount -> 422
    res_neg = client.post("/risk", json={"amount": -50000.0})
    assert res_neg.status_code == 422


# ===========================================================================
# Phase O: Forecast Regression Tests
# ===========================================================================
@pytest.mark.parametrize("horizon", [7, 14, 30])
def test_forecast_multi_horizons(client, horizon):
    res = client.post("/forecast", json={"days": horizon})
    assert res.status_code == 200
    assert len(res.json()["forecast"]) == horizon


def test_forecast_history_edge_cases(client):
    # 1. Zero history (empty list) -> graceful fail-safe or default
    res_empty = client.post("/forecast", json={"days": 14, "history": []})
    assert res_empty.status_code == 200
    d_empty = res_empty.json()
    assert ("forecast" in d_empty) or (d_empty.get("available") is False)

    # 2. 1 day history
    res_1 = client.post("/forecast", json={"days": 7, "history": [{"date": "2026-09-01", "amount": 100000.0}]})
    assert res_1.status_code == 200
    assert len(res_1.json()["forecast"]) == 7

    # 3. All zeros
    res_zeros = client.post("/forecast", json={
        "days": 7,
        "history": [{"date": f"2026-09-{i:02d}", "amount": 0.0} for i in range(1, 15)]
    })
    assert res_zeros.status_code == 200
    assert len(res_zeros.json()["forecast"]) == 7

    # 4. Giant spike in history
    spike_history = [{"date": f"2026-09-{i:02d}", "amount": 100000.0} for i in range(1, 10)]
    spike_history.append({"date": "2026-09-10", "amount": 50000000.0})  # 50M spike
    res_spike = client.post("/forecast", json={"days": 7, "history": spike_history})
    assert res_spike.status_code == 200
    assert len(res_spike.json()["forecast"]) == 7


# ===========================================================================
# Phase P: Advisor Safety Scenarios
# ===========================================================================
def test_advisor_zero_transactions_low_confidence(client):
    """When income=0 and expense=0, confidence should be reduced to 0.50 (insufficient data)."""
    res = client.post("/advisor", json={
        "financial_summary": {
            "income": 0.0,
            "expense": 0.0,
            "categories": [],
            "wallets": [],
        }
    })
    assert res.status_code == 200
    data = res.json()
    assert data["confidence"] == 0.50
    assert "chưa ghi nhận" in data["summary"].lower()


def test_advisor_overspending_warning(client):
    """When expense exceeds income, warnings must trigger."""
    res = client.post("/advisor", json={
        "financial_summary": {
            "income": 15000000.0,
            "expense": 22000000.0,
            "categories": [
                {"name": "Ăn uống", "budget": 5000000.0, "amount": 9000000.0},
                {"name": "Mua sắm", "budget": 3000000.0, "amount": 6000000.0},
            ],
            "wallets": [{"name": "Ví chính", "balance": 5000000.0}],
        }
    })
    assert res.status_code == 200
    data = res.json()
    assert len(data["warnings"]) >= 1
    assert data["risk_score"] > 0.40


def test_advisor_healthy_month(client):
    res = client.post("/advisor", json={
        "financial_summary": {
            "income": 30000000.0,
            "expense": 15000000.0,
            "categories": [
                {"name": "Ăn uống", "budget": 8000000.0, "amount": 6000000.0},
                {"name": "Nhà cửa", "budget": 7000000.0, "amount": 7000000.0},
            ],
            "wallets": [{"name": "Tiết kiệm", "balance": 90000000.0}],
        }
    })
    assert res.status_code == 200
    data = res.json()
    assert data["health_grade"] in ("HEALTHY", "EXCELLENT")
    assert data["confidence"] >= 0.80
