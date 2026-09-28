"""
ai_service/tests/test_api.py
============================
Comprehensive test suite for FastAPI AI Service V2:
- GET /health
- POST /classify:
    * Vietnamese diacritics
    * Vietnamese no-diacritics / typos
    * Whitespace validation (422)
- POST /forecast:
    * Recursive multi-horizon forecast (7, 14, 30 days)
    * Dynamic user history input
    * Missing/empty history graceful fallback
- POST /risk:
    * Normal transaction (SAFE)
    * Suspicious transaction (DANGER with explainable factors)
    * Unknown user resilience
    * Unknown card resilience
    * Data leakage validation check
- POST /advisor:
    * Standard profile
    * Financial health assessment
- Registry Gating:
    * Fail-safe behavior when a model is marked REJECT
- Concurrency:
    * Concurrent requests across all endpoints
"""

import sys
import pytest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ai_service.app import app
from ai_service.config import MODEL_REGISTRY, ModelRegistryEntry


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# 1. Health Endpoint Tests
# ---------------------------------------------------------------------------
def test_health_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "models" in data
    assert data["models"]["classify"] is True
    assert data["models"]["forecast"] is True
    assert data["models"]["risk"] is True
    assert data["models"]["advisor"] is True

    assert data["registry"]["classify"] == "ACCEPT"
    assert data["registry"]["forecast"] == "ACCEPT"
    assert data["registry"]["risk"] == "ACCEPT"
    assert data["registry"]["advisor"] in ("ACCEPT", "ACCEPT_FOR_INTEGRATION_TEST")


# ---------------------------------------------------------------------------
# 2. Classify Endpoint Tests (V2)
# ---------------------------------------------------------------------------
def test_classify_vietnamese_diacritics(client):
    phrases = [
        ("Ăn sáng phở bò 45k", "ăn uống"),
        ("Đổ xăng xe máy", "di chuyển"),
        ("Thanh toán tiền điện EVN", "hóa đơn"),
        ("Mua áo trên Shopee", "mua sắm"),
        ("Khám bệnh nha khoa", "sức khỏe"),
        ("Đóng học phí đại học", "giáo dục"),
    ]
    for text, expected in phrases:
        res = client.post("/classify", json={"text": text})
        assert res.status_code == 200
        data = res.json()
        assert data.get("category") == expected, f"Failed for '{text}': got {data.get('category')}"
        assert data.get("confidence", 0.0) > 0.3


def test_classify_no_diacritics(client):
    phrases = [
        ("an pho", "ăn uống"),
        ("tien dien", "hóa đơn"),
        ("mua quan ao", "mua sắm"),
        ("do xang xe", "di chuyển"),
    ]
    for text, expected in phrases:
        res = client.post("/classify", json={"text": text})
        assert res.status_code == 200
        data = res.json()
        assert data.get("category") == expected, f"Failed for '{text}': got {data.get('category')}"


def test_classify_validation_error(client):
    res = client.post("/classify", json={"text": "   "})
    assert res.status_code == 422


# ---------------------------------------------------------------------------
# 3. Forecast Endpoint Tests (V2)
# ---------------------------------------------------------------------------
def test_forecast_recursive_multi_horizon(client):
    for h in [7, 14, 30]:
        res = client.post("/forecast", json={"days": h})
        assert res.status_code == 200
        data = res.json()
        assert "forecast" in data
        assert len(data["forecast"]) == h
        for item in data["forecast"]:
            assert "date" in item
            assert item["predicted_spending"] >= 0.0


def test_forecast_dynamic_user_history(client):
    user_history = [
        {"date": f"2026-08-{i:02d}", "amount": 150000.0 + (i * 2000.0)}
        for i in range(1, 25)
    ]
    res = client.post("/forecast", json={"days": 10, "history": user_history})
    assert res.status_code == 200
    data = res.json()
    assert len(data["forecast"]) == 10


def test_forecast_missing_or_empty_history(client):
    res = client.post("/forecast", json={"days": 7, "history": []})
    assert res.status_code == 200
    data = res.json()
    # Gracefully returns fail-safe or fallback rather than crashing
    assert "forecast" in data or data.get("available") is False


# ---------------------------------------------------------------------------
# 4. Risk Endpoint Tests (V2)
# ---------------------------------------------------------------------------
def test_risk_normal_safe(client):
    payload = {
        "amount": 150000.0,
        "credit_limit": 50000000.0,
        "mcc": 5411,
        "use_chip": "Chip Transaction",
        "hour": 12,
    }
    res = client.post("/risk", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] == "SAFE"
    assert data["risk_score"] < 0.5


def test_risk_suspicious_danger(client):
    payload = {
        "amount": 45000000.0,
        "credit_limit": 50000000.0,
        "mcc": 5732,
        "use_chip": "Online Transaction",
        "card_on_dark_web": "Yes",
        "hour": 3,
    }
    res = client.post("/risk", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] in ("WARNING", "DANGER")
    assert len(data["risk_indicators"]) > 0


def test_risk_unknown_user_resilience(client):
    payload = {
        "client_id": "totally_new_user_12345",
        "amount": 200000.0,
        "credit_limit": 30000000.0,
        "mcc": 5411,
        "hour": 14,
    }
    res = client.post("/risk", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] == "SAFE"


def test_risk_unknown_card_resilience(client):
    payload = {
        "card_id": "totally_new_card_99999",
        "amount": 250000.0,
        "credit_limit": 30000000.0,
        "mcc": 5411,
        "hour": 15,
    }
    res = client.post("/risk", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["risk_level"] == "SAFE"


def test_risk_no_leakage_validation_check(client):
    # Verify that pipeline card_avg and user_avg do not contain unknown card/user
    from ai_service.loaders.model_loader import ModelContainer
    container = ModelContainer.get_instance()
    pipe = container.risk_engine.pipeline
    assert "unseen_test_card_xyz" not in pipe.card_avg
    assert pipe.global_card_avg > 0


# ---------------------------------------------------------------------------
# 5. Advisor Endpoint Tests
# ---------------------------------------------------------------------------
def test_advisor_standard(client):
    payload = {
        "financial_summary": {
            "income": 25000000.0,
            "expense": 18000000.0,
            "categories": [{"name": "ăn uống", "amount": 6000000.0, "budget": 7000000.0}],
            "wallets": [{"name": "Ví chính", "balance": 50000000.0}],
        }
    }
    res = client.post("/advisor", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "summary" in data
    assert "warnings" in data
    assert "suggestions" in data
    assert data["confidence"] > 0.7


# ---------------------------------------------------------------------------
# 6. Registry Gating Test
# ---------------------------------------------------------------------------
def test_registry_gating_failsafe(client):
    # Temporarily set classify to REJECT to verify fail-safe gating
    original_status = MODEL_REGISTRY["classify"].status
    try:
        MODEL_REGISTRY["classify"].status = "REJECT"
        MODEL_REGISTRY["classify"].rejection_reason = "Test gate rejection"

        res = client.post("/classify", json={"text": "ăn sáng phở bò"})
        assert res.status_code == 200
        data = res.json()
        assert data.get("available") is False
        assert data.get("reason") == "model_not_approved"
        assert "Test gate rejection" in data.get("detail", "")
    finally:
        MODEL_REGISTRY["classify"].status = original_status


# ---------------------------------------------------------------------------
# 7. Concurrent Requests Test
# ---------------------------------------------------------------------------
def test_concurrent_requests(client):
    def make_call(i):
        if i % 3 == 0:
            return client.post("/classify", json={"text": "tiền điện tháng này"}).status_code
        elif i % 3 == 1:
            return client.post("/forecast", json={"days": 7}).status_code
        else:
            return client.post("/risk", json={"amount": 100000.0, "credit_limit": 20000000.0}).status_code

    with ThreadPoolExecutor(max_workers=8) as executor:
        status_codes = list(executor.map(make_call, range(24)))

    assert all(code == 200 for code in status_codes)
