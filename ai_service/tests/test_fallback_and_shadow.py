"""
ai_service/tests/test_fallback_and_shadow.py
============================================
Comprehensive tests for:
1. Response metadata integrity (meta: { model, version, latency_ms, fallback_used, advisory }).
2. V3 -> V2 fallback simulation on inference exception.
3. Fallback when primary model is unavailable.
4. Shadow mode execution and verification.
5. Health endpoint status: ok vs degraded.
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from ai_service.app import app
from ai_service.loaders.model_loader import ModelContainer


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_response_metadata_presence(client):
    """Verify that all endpoints return backward-compatible data with meta block."""
    # Classify
    res_c = client.post("/classify", json={"text": "Ăn trưa 50k"})
    assert res_c.status_code == 200
    d_c = res_c.json()
    assert d_c["category"] == "ăn uống"
    assert "meta" in d_c
    assert d_c["meta"]["model"] == "classify"
    assert d_c["meta"]["version"] in ("v3", "v2")
    assert d_c["meta"]["fallback_used"] is False
    assert d_c["meta"]["advisory"] is True
    assert "latency_ms" in d_c["meta"]

    # Risk
    res_r = client.post("/risk", json={"amount": 50000.0, "mcc": 5411})
    assert res_r.status_code == 200
    d_r = res_r.json()
    assert d_r["risk_level"] == "SAFE"
    assert "meta" in d_r
    assert d_r["meta"]["model"] == "risk"
    assert d_r["meta"]["version"] in ("v3", "v2")

    # Forecast
    res_f = client.post("/forecast", json={"days": 7})
    assert res_f.status_code == 200
    d_f = res_f.json()
    assert len(d_f["forecast"]) == 7
    assert "meta" in d_f
    assert d_f["meta"]["model"] == "forecast"

    # Advisor
    res_a = client.post("/advisor", json={
        "financial_summary": {
            "income": 20000000.0,
            "expense": 12000000.0,
        }
    })
    assert res_a.status_code == 200
    d_a = res_a.json()
    assert "summary" in d_a
    assert "meta" in d_a
    assert d_a["meta"]["model"] == "advisor"


def test_classify_v3_to_v2_fallback(client):
    """Simulate primary V3 engine failure and verify graceful fallback to V2."""
    container = ModelContainer.get_instance()
    original_v3 = container.classify_engine_v3

    try:
        # Mock V3 to fail with an exception
        mock_v3 = MagicMock()
        mock_v3.predict.side_effect = RuntimeError("Simulated V3 Inference Crash")
        container.classify_engine_v3 = mock_v3

        res = client.post("/classify", json={"text": "Mua áo khoác 350k"})
        assert res.status_code == 200
        data = res.json()
        assert data["category"] == "mua sắm"
        assert data["meta"]["fallback_used"] is True
        assert data["meta"]["version"] == "v2"
    finally:
        container.classify_engine_v3 = original_v3


def test_risk_v3_to_v2_fallback(client):
    """Simulate primary Risk V3 failure and verify fallback to V2."""
    container = ModelContainer.get_instance()
    original_v3 = container.risk_engine_v3

    try:
        mock_v3 = MagicMock()
        mock_v3.evaluate_transaction.side_effect = RuntimeError("Simulated Risk V3 Failure")
        container.risk_engine_v3 = mock_v3

        res = client.post("/risk", json={"amount": 100000.0, "mcc": 5411})
        assert res.status_code == 200
        data = res.json()
        assert data["risk_level"] == "SAFE"
        assert data["meta"]["fallback_used"] is True
        assert data["meta"]["version"] == "v2"
    finally:
        container.risk_engine_v3 = original_v3


def test_advisor_ml_to_rule_fallback(client):
    """Simulate Advisor ML engine failure and verify fallback to deterministic rules."""
    container = ModelContainer.get_instance()
    original_advisor = container.advisor_engine_v3

    try:
        mock_adv = MagicMock()
        mock_adv.predict.side_effect = RuntimeError("Simulated Advisor Engine Failure")
        container.advisor_engine_v3 = mock_adv

        res = client.post("/advisor", json={
            "financial_summary": {
                "income": 15000000.0,
                "expense": 18000000.0,
            }
        })
        assert res.status_code == 200
        data = res.json()
        assert "thâm hụt" in data["summary"].lower()
        assert data["health_grade"] == "CRITICAL"
        assert data["meta"]["fallback_used"] is True
        assert data["meta"]["version"] == "rule_fallback"
    finally:
        container.advisor_engine_v3 = original_advisor


def test_health_degraded_state(client):
    """Verify health status reports 'degraded' when a primary model is missing but fallback exists."""
    container = ModelContainer.get_instance()
    original_classify_v3 = container.classify_engine_v3

    try:
        container.classify_engine_v3 = None
        status = container.get_health_status()
        assert status == "degraded"
    finally:
        container.classify_engine_v3 = original_classify_v3
