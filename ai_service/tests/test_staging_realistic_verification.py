"""
ai_service/tests/test_staging_realistic_verification.py
======================================================
Comprehensive automated verification for:
- Phase 9: Risk Realistic Scenarios (Synthetic Risk Classification / Rule Approximation).
- Phase 10: Forecast Multi-Horizon and Long/Complex Histories.
- Phase 11: Advisor Real-world Financial Profiles & Hallucination Prevention.
"""

import math
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

from ai_service.app import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ===========================================================================
# Phase 9: Risk Realistic Verification
# ===========================================================================
def test_risk_normal_grocery(client):
    res = client.post("/risk", json={
        "amount": 125000.0,
        "credit_limit": 50000000.0,
        "mcc": 5411,  # Grocery
        "use_chip": "Chip Transaction",
        "hour": 10,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] == "SAFE"
    assert data["risk_score"] < 0.20


def test_risk_dark_web_online_high_risk(client):
    """High risk MCC + Card on dark web + late night must NOT be SAFE."""
    res = client.post("/risk", json={
        "amount": 25000000.0,
        "credit_limit": 30000000.0,
        "mcc": 5732,  # Electronics
        "use_chip": "Online Transaction",
        "card_on_dark_web": "Yes",
        "hour": 3,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] in ("WARNING", "DANGER")
    assert data["risk_score"] > 0.50


def test_risk_betting_crypto_mcc(client):
    """Betting (7995) or Crypto (6051) must flag elevated risk."""
    res = client.post("/risk", json={
        "amount": 10000000.0,
        "credit_limit": 20000000.0,
        "mcc": 7995,  # Betting
        "hour": 2,
    })
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] in ("WARNING", "DANGER")


def test_risk_null_and_zero_limits(client):
    """Handles credit_limit null or 0 without crashing or false alarm."""
    for limit in [None, 0.0]:
        res = client.post("/risk", json={"amount": 50000.0, "credit_limit": limit, "mcc": 5411})
        assert res.status_code == 200
        assert res.json()["risk_level"] == "SAFE"


# ===========================================================================
# Phase 10: Forecast Staging Verification
# ===========================================================================
def generate_history(days: int, pattern: str):
    start = datetime(2026, 1, 1)
    history = []
    for i in range(days):
        dt = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        if pattern == "stable":
            amt = 200000.0
        elif pattern == "increasing":
            amt = 100000.0 + (i * 2000.0)
        elif pattern == "weekly_cycle":
            dow = (i % 7)
            amt = 400000.0 if dow in (5, 6) else 150000.0  # weekend higher
        elif pattern == "salary_spike":
            amt = 5000000.0 if (i % 30 == 0) else 150000.0
        elif pattern == "missing_dates":
            if i % 3 == 0:
                continue  # skip date
            amt = 250000.0
        else:
            amt = 180000.0
        history.append({"date": dt, "amount": amt})
    return history


@pytest.mark.parametrize("pattern", ["stable", "increasing", "weekly_cycle", "salary_spike", "missing_dates"])
@pytest.mark.parametrize("history_len", [7, 30, 90, 180, 365])
def test_forecast_long_and_complex_histories(client, pattern, history_len):
    hist = generate_history(history_len, pattern)
    res = client.post("/forecast", json={"days": 14, "history": hist})
    assert res.status_code == 200
    data = res.json()
    assert len(data["forecast"]) == 14

    # Verify no NaN, Infinity, or negative forecasts
    for item in data["forecast"]:
        val = item["predicted_spending"]
        assert math.isfinite(val), f"Forecast produced non-finite value: {val}"
        assert val >= 0.0, f"Forecast produced negative spending: {val}"
        assert val < 1e9, f"Forecast produced absurd value: {val}"


# ===========================================================================
# Phase 11: Advisor Staging Verification
# ===========================================================================
def test_advisor_healthy_finances(client):
    res = client.post("/advisor", json={
        "financial_summary": {
            "income": 35000000.0,
            "expense": 20000000.0,
            "previous_month_expense": 19000000.0,
            "wallets": [{"name": "Techcombank", "balance": 60000000.0}],
            "savings_goals": [{"name": "Quỹ dự phòng", "target": 100000000.0, "current": 50000000.0}],
            "categories": [
                {"name": "Ăn uống", "budget": 8000000.0, "amount": 7200000.0},
                {"name": "Di chuyển", "budget": 3000000.0, "amount": 2500000.0},
            ],
        }
    })
    assert res.status_code == 200
    data = res.json()
    assert data["health_grade"] in ("HEALTHY", "EXCELLENT")
    assert data["risk_score"] < 0.45
    assert data["confidence"] >= 0.80
    assert len(data["suggestions"]) > 0


def test_advisor_critical_overspending(client):
    res = client.post("/advisor", json={
        "financial_summary": {
            "income": 12000000.0,
            "expense": 19000000.0,  # 7M deficit
            "categories": [
                {"name": "Ăn ngoài", "budget": 3000000.0, "amount": 8500000.0},  # big breach
            ],
            "wallets": [{"name": "Ví", "balance": 2000000.0}],
        }
    })
    assert res.status_code == 200
    data = res.json()
    assert data["health_grade"] == "CRITICAL"
    assert data["risk_score"] > 0.50
    # Must contain overspending warning
    assert any("vượt" in w.lower() or "thâm hụt" in w.lower() for w in data["warnings"])


def test_advisor_cold_start_sparse_data(client):
    """When income=0 and expense=0, confidence must drop to 0.50 and advise tracking daily."""
    res = client.post("/advisor", json={
        "financial_summary": {
            "income": 0.0,
            "expense": 0.0,
            "wallets": [],
            "categories": [],
        }
    })
    assert res.status_code == 200
    data = res.json()
    assert data["confidence"] == 0.50
    assert "chưa ghi nhận" in data["summary"].lower()
    # Does NOT invent balance or transactions
    assert data["risk_score"] == 0.0
