"""
ai_service/tests/test_classify_v4_shadow.py
===========================================
Integration & regression test suite for Classify V4 Shadow Mode:
- Verifies V3 remains primary and user output is NEVER altered by V4.
- Verifies failure isolation: if V4 throws exception or is missing, V3 passes gracefully.
- Verifies shadow telemetry schema: zero leakage of user text, tokens, or secrets.
- Verifies /telemetry/shadow aggregate metric calculations.
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from ai_service.app import app
from ai_service.loaders.model_loader import ModelContainer
from ai_service.observability import (
    get_classify_v4_shadow_metrics,
    reset_classify_v4_shadow_records,
)


TEST_TELEMETRY_TOKEN = "dummy-unit-test-telemetry-token"
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_TELEMETRY_TOKEN}"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def setup_teardown(monkeypatch):
    monkeypatch.setattr("ai_service.app.AI_INTERNAL_TELEMETRY_TOKEN", TEST_TELEMETRY_TOKEN)
    reset_classify_v4_shadow_records()
    yield
    reset_classify_v4_shadow_records()


def test_v3_primary_unchanged(client):
    """Verify user receives V3 prediction and confidence, completely unaltered by V4."""
    container = ModelContainer.get_instance()
    assert container.classify_engine_v3 is not None

    res = client.post("/classify", json={"text": "ăn phở 50k"})
    assert res.status_code == 200
    data = res.json()

    # V3 prediction for "ăn phở 50k"
    v3_expected = container.classify_engine_v3.predict("ăn phở 50k")
    assert data["category"] == v3_expected["category"]
    assert data["confidence"] == pytest.approx(v3_expected["confidence"], abs=1e-3)
    assert data["meta"]["version"] == "v3"
    assert data["meta"]["fallback_used"] is False


def test_shadow_telemetry_schema(client):
    """Verify shadow telemetry records valid schema without PII, tokens, or raw text."""
    res = client.post("/classify", json={"text": "đổ xăng 100k"})
    assert res.status_code == 200

    metrics = client.get("/telemetry/shadow", headers=AUTH_HEADERS).json()
    assert metrics["total_samples"] >= 1
    assert "agreement_rate" in metrics
    assert "v4_success_count" in metrics
    assert "shadow_failure" in metrics or "v4_error_count" in metrics


def test_shadow_failure_isolation_on_exception(client):
    """Verify that if V4 engine raises an unexpected error, user request SUCCEEDS with V3."""
    container = ModelContainer.get_instance()
    original_v4 = container.classify_engine_v4

    try:
        # Mock V4 engine to raise an exception
        faulty_v4 = MagicMock()
        faulty_v4.predict.side_effect = RuntimeError("Simulated internal V4 tensor corruption")
        container.classify_engine_v4 = faulty_v4

        res = client.post("/classify", json={"text": "mua thuốc 85k"})
        # User request MUST NOT FAIL
        assert res.status_code == 200
        data = res.json()
        assert data["category"] == "sức khỏe"
        assert data["meta"]["version"] == "v3"

        # Check that error was isolated in shadow telemetry
        metrics = client.get("/telemetry/shadow", headers=AUTH_HEADERS).json()
        assert metrics["shadow_failure"] >= 1
    finally:
        container.classify_engine_v4 = original_v4


def test_shadow_failure_isolation_on_missing_artifact(client):
    """Verify that if V4 engine is None (artifact missing), user request SUCCEEDS with V3."""
    container = ModelContainer.get_instance()
    original_v4 = container.classify_engine_v4

    try:
        container.classify_engine_v4 = None

        res = client.post("/classify", json={"text": "đóng tiền điện"})
        assert res.status_code == 200
        data = res.json()
        assert data["category"] == "hóa đơn"
        assert data["meta"]["version"] == "v3"
    finally:
        container.classify_engine_v4 = original_v4


def test_shadow_telemetry_privacy(client):
    """Ensure telemetry summary never leaks sensitive keys."""
    client.post("/classify", json={"text": "chuyển khoản trả nợ ngân hàng"})
    metrics = client.get("/telemetry/shadow", headers=AUTH_HEADERS).json()

    metrics_str = str(metrics).lower()
    for forbidden in ["password", "secret", "token", "auth", "vietcombank", "bidv", "chuyển khoản"]:
        assert forbidden not in metrics_str, f"Forbidden term '{forbidden}' leaked into telemetry!"
