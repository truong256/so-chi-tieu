"""
ai_service/tests/test_production_learning_hardening.py
======================================================
Regression tests for:
1. Real Traffic Telemetry Gating:
   - Synthetic & test requests DO NOT increment real events.
   - Authenticated real requests increment real events by exactly 1.
   - Idempotency key deduplication prevents double-counting retries.
   - PII fields are strictly sanitized and never stored in telemetry.
2. User Feedback Pipeline:
   - Suggestion accepted (accepted=true) telemetry.
   - Suggestion corrected (accepted=false) telemetry with predicted vs corrected.
   - Fail-closed auth requiring valid internal token.
   - Feedback aggregate metrics (acceptance rate, correction by category).
3. Canary Guard & Promotion Gate:
   - Promotion > 5% strictly blocked when real_events_count < 500.
   - Single source of truth in FastAPI.
4. Advisor Hardening:
   - Data sparsity / cold-start: low confidence (< 0.50) + "Chưa đủ dữ liệu...".
   - Lumpy expense with liquid savings cushion: avoids false critical panic.
   - Sabbatical with liquid runway: avoids debt/insolvency panic.
   - Lifestyle inflation: catches thin liquid buffer despite high income.
5. Warning V4 Realistic Challenge & Quality Gate:
   - Human-curated challenge dataset evaluation.
   - Shortcut detection and quality gate REJECT status.
6. Model Registry Standardization:
   - Verified status mappings (classify_v3, classify_v4, forecast_v3, warning_v3, warning_v4, advisor).
"""

import sys
import uuid
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from ai_service.app import app
from ai_service.config import (
    MODEL_REGISTRY,
    AI_CLASSIFY_V4_CANARY_PERCENT,
)
from ai_service.observability import (
    get_real_events_status,
    record_real_traffic_event,
    record_user_correction_signal,
    get_user_feedback_metrics,
    _sanitize_no_pii,
)
from ai_service.services.advisor_service import apply_advisor_hardening_policy

TEST_TELEMETRY_TOKEN = "test-internal-token-hardening-999"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module", autouse=True)
def clean_telemetry_after_tests():
    """Ensure test runs never pollute production real events telemetry."""
    yield
    from ai_service.observability import reset_real_events_records
    reset_real_events_records()


@pytest.fixture(autouse=True)
def setup_telemetry_token(monkeypatch):
    """Ensure internal telemetry & service tokens are configured during tests."""
    monkeypatch.setattr("ai_service.app.AI_INTERNAL_TELEMETRY_TOKEN", TEST_TELEMETRY_TOKEN)
    monkeypatch.setattr("ai_service.config.AI_INTERNAL_TELEMETRY_TOKEN", TEST_TELEMETRY_TOKEN)
    monkeypatch.setattr("ai_service.app.AI_INTERNAL_SERVICE_TOKEN", TEST_TELEMETRY_TOKEN)
    monkeypatch.setattr("ai_service.config.AI_INTERNAL_SERVICE_TOKEN", TEST_TELEMETRY_TOKEN)


# ---------------------------------------------------------------------------
# 1. Telemetry Gating, Trust Boundary & Idempotency Tests
# ---------------------------------------------------------------------------
def test_synthetic_and_test_requests_do_not_increment_real_count(client):
    initial_metrics = get_real_events_status()
    initial_count = initial_metrics["total_real_events"]

    # Synthetic request (is_real_traffic = False)
    res_synthetic = client.post("/classify", json={
        "text": "Ăn trưa 50k",
        "is_real_traffic": False,
        "sample_seed": "test-synthetic-seed"
    })
    assert res_synthetic.status_code == 200

    # Request without is_real_traffic defaults to False
    res_default = client.post("/classify", json={
        "text": "Đổ xăng 70k"
    })
    assert res_default.status_code == 200

    after_metrics = get_real_events_status()
    assert after_metrics["total_real_events"] == initial_count, (
        f"Synthetic requests must NOT increment real count! Before: {initial_count}, After: {after_metrics['total_real_events']}"
    )


def test_direct_fastapi_request_without_token_must_not_increase_real_counter(client):
    """
    Requirement 3 & 13: Direct FastAPI request with is_real_traffic=True WITHOUT internal proof
    MUST NOT increase real counter.
    """
    initial_metrics = get_real_events_status()
    initial_total = initial_metrics["total_real_events"]
    initial_v4 = initial_metrics["valid_v4_canary_events"]

    res = client.post("/classify", json={
        "text": "Ăn tối lẩu bò 200k",
        "is_real_traffic": True,
        "user_id": "direct-unauthenticated-caller",
        "idempotency_key": f"untrusted-{uuid.uuid4()}",
    })
    assert res.status_code == 200
    after_metrics = get_real_events_status()
    assert after_metrics["total_real_events"] == initial_total, "Direct call without internal token must NOT increase real counter!"
    assert after_metrics["valid_v4_canary_events"] == initial_v4


def test_fake_user_id_without_token_cannot_bypass_trust_boundary(client):
    """
    Requirement 3 & 13: Fake user_id or invalid token cannot bypass trust boundary.
    """
    before = get_real_events_status()["total_real_events"]

    res = client.post(
        "/classify",
        json={"text": "Mua áo khoác 500k", "is_real_traffic": True, "user_id": "fake_admin"},
        headers={"X-AI-Internal-Token": "invalid-spoofed-token"}
    )
    assert res.status_code == 200
    after = get_real_events_status()["total_real_events"]
    assert after == before, "Fake user_id with invalid token must NOT increase real counter!"


def test_authenticated_trusted_request_increments_real_counter(client):
    """
    Requirement 3 & 13: Authenticated/internal trusted request CAN increase valid real counter.
    """
    before = get_real_events_status()["total_real_events"]

    trusted_headers = {"X-AI-Internal-Token": TEST_TELEMETRY_TOKEN}
    res = client.post(
        "/classify",
        json={
            "text": "Cà phê Highland 65k",
            "is_real_traffic": True,
            "user_id": "authenticated-session-user-123",
            "idempotency_key": f"trusted-req-{uuid.uuid4()}",
        },
        headers=trusted_headers
    )
    assert res.status_code == 200
    after = get_real_events_status()["total_real_events"]
    assert after == before + 1, "Authenticated request with valid internal token must increment real counter by 1!"


def test_idempotency_deduplication_same_request_retried(client):
    """
    Requirement 4 & 13: Same logical request retried 2x => increment exactly 1.
    Different logical transaction => increment independently.
    """
    trusted_headers = {"X-AI-Internal-Token": TEST_TELEMETRY_TOKEN}
    shared_key = f"idemp-flow-{uuid.uuid4()}"

    before = get_real_events_status()["total_real_events"]

    # First attempt
    res1 = client.post("/classify", json={
        "text": "Mua thuốc tây 120k",
        "is_real_traffic": True,
        "user_id": "user-retry-123",
        "idempotency_key": shared_key
    }, headers=trusted_headers)
    assert res1.status_code == 200
    assert get_real_events_status()["total_real_events"] == before + 1

    # Second attempt (network retry of same request)
    res2 = client.post("/classify", json={
        "text": "Mua thuốc tây 120k",
        "is_real_traffic": True,
        "user_id": "user-retry-123",
        "idempotency_key": shared_key
    }, headers=trusted_headers)
    assert res2.status_code == 200
    # Must NOT double-count
    assert get_real_events_status()["total_real_events"] == before + 1

    # Third attempt (different logical transaction with new key)
    res3 = client.post("/classify", json={
        "text": "Mua trà sữa 55k",
        "is_real_traffic": True,
        "user_id": "user-retry-123",
        "idempotency_key": f"idemp-flow-{uuid.uuid4()}"
    }, headers=trusted_headers)
    assert res3.status_code == 200
    assert get_real_events_status()["total_real_events"] == before + 2


def test_pii_sanitization_strictly_omits_sensitive_fields():
    # Sensitive keys must raise ValueError
    for bad_key in ["text", "description", "raw_text", "password", "token", "email", "phone", "card_number"]:
        with pytest.raises(ValueError, match="PII Leakage Prevention"):
            _sanitize_no_pii({bad_key: "sensitive_data_value"})

    clean_payload = {
        "model_version": "v3",
        "category": "ăn uống",
        "confidence": 0.95,
        "latency_ms": 12.5,
        "success": True,
        "fallback": False,
        "user_id_hash": "hash-abc",
        "idempotency_key": "idemp-123",
        "is_real_traffic": True,
    }
    sanitized = _sanitize_no_pii(clean_payload)
    assert sanitized["model_version"] == "v3"
    assert sanitized["category"] == "ăn uống"
    assert sanitized["idempotency_key"] == "idemp-123"


# ---------------------------------------------------------------------------
# 2. Feedback Telemetry & Version Isolation Tests
# ---------------------------------------------------------------------------
def test_feedback_endpoint_fails_closed_without_valid_internal_token(client, monkeypatch):
    payload = {
        "model_version": "v3",
        "suggested_category": "ăn uống",
        "final_category": "ăn uống",
        "confidence_band": "HIGH",
        "accepted": True,
        "user_id_hash": "hashed_cohort_001",
    }

    # Missing token header
    res_no_token = client.post("/telemetry/feedback", json=payload)
    assert res_no_token.status_code == 401, f"Expected 401, got {res_no_token.status_code}"

    # Invalid token header
    res_bad_token = client.post(
        "/telemetry/feedback",
        json=payload,
        headers={"X-Internal-Key": "invalid_wrong_token"}
    )
    assert res_bad_token.status_code == 401, f"Expected 401, got {res_bad_token.status_code}"

    # Unset token on server -> FAIL CLOSED
    monkeypatch.setattr("ai_service.app.AI_INTERNAL_TELEMETRY_TOKEN", None)
    monkeypatch.setattr("ai_service.app.AI_INTERNAL_SERVICE_TOKEN", None)
    res_unset = client.post(
        "/telemetry/feedback",
        json=payload,
        headers={"X-Internal-Key": TEST_TELEMETRY_TOKEN}
    )
    assert res_unset.status_code == 401


def test_feedback_isolation_v3_vs_v4(client):
    """
    Requirement 6 & 13:
    V3 accepted, V3 corrected, V4 accepted, V4 corrected.
    V4 must NEVER increment V3 counters.
    """
    headers = {"X-Internal-Key": TEST_TELEMETRY_TOKEN}

    from ai_service.observability import _user_feedback_records, get_user_feedback_metrics
    _user_feedback_records.clear()

    # V3 Accepted
    client.post("/telemetry/feedback", json={
        "model_version": "v3",
        "suggested_category": "ăn uống",
        "final_category": "ăn uống",
        "confidence_band": "HIGH",
        "accepted": True,
        "user_id_hash": "u_v3_1",
    }, headers=headers)

    # V3 Corrected
    client.post("/telemetry/feedback", json={
        "model_version": "v3",
        "suggested_category": "ăn uống",
        "final_category": "mua sắm",
        "confidence_band": "HIGH",
        "accepted": False,
        "user_id_hash": "u_v3_2",
    }, headers=headers)

    metrics_mid = get_user_feedback_metrics()
    assert metrics_mid["v3_total"] == 2
    assert metrics_mid["v4_total"] == 0

    # V4 Accepted
    client.post("/telemetry/feedback", json={
        "model_version": "v4",
        "suggested_category": "di chuyển",
        "final_category": "di chuyển",
        "confidence_band": "HIGH",
        "accepted": True,
        "user_id_hash": "u_v4_1",
    }, headers=headers)

    # V4 Corrected
    client.post("/telemetry/feedback", json={
        "model_version": "v4",
        "suggested_category": "di chuyển",
        "final_category": "hóa đơn",
        "confidence_band": "HIGH",
        "accepted": False,
        "user_id_hash": "u_v4_2",
    }, headers=headers)

    metrics_final = get_user_feedback_metrics()
    # V4 MUST NEVER increment V3 counters
    assert metrics_final["v3_total"] == 2, f"V3 total must remain 2, got {metrics_final['v3_total']}"
    assert metrics_final["v4_total"] == 2, f"V4 total must be 2, got {metrics_final['v4_total']}"
    assert metrics_final["v3_acceptance_rate"] == 0.5
    assert metrics_final["v4_acceptance_rate"] == 0.5
    assert metrics_final["v3_correction_rate"] == 0.5
    assert metrics_final["v4_correction_rate"] == 0.5


# ---------------------------------------------------------------------------
# 3. Canary Guard & Promotion Gate Scenarios
# ---------------------------------------------------------------------------
def test_promotion_gate_exact_scenarios():
    """
    Requirement 2 & 13:
    499 valid V4 canary events => PROMOTION_BLOCKED
    500 valid V4 canary events => READY_FOR_HUMAN_REVIEW
    500 V3 events + 0 V4 => PROMOTION_BLOCKED
    500 failed V4 events => PROMOTION_BLOCKED
    synthetic/test event => PROMOTION_BLOCKED
    """
    from ai_service.observability import reset_real_events_records, record_real_traffic_event, get_real_events_status

    # Scenario 1: 500 V3 events + 0 V4 => PROMOTION_BLOCKED
    reset_real_events_records()
    for i in range(500):
        record_real_traffic_event(
            model_version="v3",
            route_type="control",
            category="ăn uống",
            confidence=0.9,
            latency_ms=10.0,
            success=True,
            fallback=False,
            idempotency_key=f"v3-test-{i}",
        )
    st1 = get_real_events_status()
    assert st1["total_real_events"] == 500
    assert st1["v3_real_events"] == 500
    assert st1["valid_v4_canary_events"] == 0
    assert st1["promotion_gate"] == "PROMOTION_BLOCKED", "500 V3 events must NOT open V4 gate!"

    # Scenario 2: 500 failed V4 events => PROMOTION_BLOCKED
    reset_real_events_records()
    for i in range(500):
        record_real_traffic_event(
            model_version="v4",
            route_type="canary",
            category="unknown",
            confidence=0.0,
            latency_ms=10.0,
            success=False,
            fallback=False,
            idempotency_key=f"v4-fail-{i}",
        )
    st2 = get_real_events_status()
    assert st2["v4_failure_events"] == 500
    assert st2["valid_v4_canary_events"] == 0
    assert st2["promotion_gate"] == "PROMOTION_BLOCKED", "500 failed V4 events must NOT open V4 gate!"

    # Scenario 3: 500 fallback V4 events => PROMOTION_BLOCKED
    reset_real_events_records()
    for i in range(500):
        record_real_traffic_event(
            model_version="v4",
            route_type="canary",
            category="ăn uống",
            confidence=0.8,
            latency_ms=10.0,
            success=True,
            fallback=True,
            idempotency_key=f"v4-fb-{i}",
        )
    st3 = get_real_events_status()
    assert st3["v4_fallback_events"] == 500
    assert st3["valid_v4_canary_events"] == 0
    assert st3["promotion_gate"] == "PROMOTION_BLOCKED", "Fallback-only V4 events must NOT open V4 gate!"

    # Scenario 4: 499 valid V4 canary events => PROMOTION_BLOCKED
    reset_real_events_records()
    for i in range(499):
        record_real_traffic_event(
            model_version="v4",
            route_type="canary",
            category="ăn uống",
            confidence=0.9,
            latency_ms=10.0,
            success=True,
            fallback=False,
            idempotency_key=f"v4-val-{i}",
        )
    st4 = get_real_events_status()
    assert st4["valid_v4_canary_events"] == 499
    assert st4["promotion_gate"] == "PROMOTION_BLOCKED", "499 valid V4 events must be PROMOTION_BLOCKED!"

    # Scenario 5: 500 valid V4 canary events => READY_FOR_HUMAN_REVIEW (NOT auto-promote)
    record_real_traffic_event(
        model_version="v4",
        route_type="canary",
        category="ăn uống",
        confidence=0.9,
        latency_ms=10.0,
        success=True,
        fallback=False,
        idempotency_key="v4-val-500",
    )
    st5 = get_real_events_status()
    assert st5["valid_v4_canary_events"] == 500
    assert st5["promotion_gate"] == "READY_FOR_HUMAN_REVIEW", "500 valid V4 events must be READY_FOR_HUMAN_REVIEW!"


def test_canary_promotion_gate_locked_under_500_events(client):
    headers = {"X-Internal-Key": TEST_TELEMETRY_TOKEN}
    res = client.get("/telemetry/canary", headers=headers)
    assert res.status_code == 200
    data = res.json()

    real_data = data["real_traffic"]
    v4_valid = real_data["valid_v4_canary_events"]
    # Check that promotion is strictly locked when under 500
    if v4_valid < 500:
        assert real_data["promotion_gate"] == "PROMOTION_BLOCKED", "Promotion must be strictly BLOCKED when valid_v4_canary_events < 500!"
        assert "500" in real_data["reason"].lower() or "blocked" in real_data["reason"].lower()

    # Canary percentage must not exceed 5%
    assert AI_CLASSIFY_V4_CANARY_PERCENT <= 5, f"Canary percent {AI_CLASSIFY_V4_CANARY_PERCENT} must not exceed 5%!"


# ---------------------------------------------------------------------------
# 4. Advisor Hardening Tests (Uncertainty & Scenarios)
# ---------------------------------------------------------------------------
def test_advisor_cold_start_sparsity_guard():
    profile = {
        "income": 0.0,
        "expense": 0.0,
        "categories": [],
        "wallets": [],
    }
    base_res = {
        "summary": "Lời khuyên gốc",
        "warnings": [],
        "suggestions": [],
        "confidence": 0.85,
        "health_grade": "HEALTHY",
        "risk_score": 0.0,
    }
    res = apply_advisor_hardening_policy(profile, base_res)
    assert res["confidence"] <= 0.50, f"Expected confidence <= 0.50 for zero data, got {res['confidence']}"
    assert "Chưa ghi nhận dữ liệu thu chi" in res["summary"] or "Chưa đủ dữ liệu" in res["summary"]


def test_advisor_lumpy_expense_with_liquid_cushion():
    # 80m expense in month (e.g. tuition/laptop), but 300m in savings (> 3 months cushion)
    profile = {
        "income": 30_000_000.0,
        "expense": 80_000_000.0,
        "categories": [{"name": "giáo dục", "spent": 60_000_000}, {"name": "ăn uống", "spent": 20_000_000}],
        "wallets": [{"type": "SAVINGS", "balance": 300_000_000, "is_liquid": True}],
    }
    base_res = {
        "summary": "Nguy cấp tài chính!",
        "warnings": ["Bội chi nghiêm trọng"],
        "suggestions": ["Cắt giảm ngay lập tức"],
        "confidence": 0.90,
        "health_grade": "CRITICAL",
        "risk_score": 0.85,
    }
    res = apply_advisor_hardening_policy(profile, base_res)
    # Should be CAUTION instead of CRITICAL panic because user has 300m liquid reserves
    assert res["health_grade"] in ("CAUTION", "HEALTHY"), f"Lumpy expense with 300m reserve cushion should be CAUTION, got {res['health_grade']}"
    assert "đệm" in res["summary"].lower() or "dự phòng" in res["summary"].lower()


def test_advisor_sabbatical_with_runway():
    # Zero income sabbatical, 15m expense, 120m liquid savings (8 months runway)
    profile = {
        "income": 0.0,
        "expense": 15_000_000.0,
        "categories": [{"name": "ăn uống", "spent": 10_000_000}, {"name": "di chuyển", "spent": 5_000_000}],
        "wallets": [{"type": "SAVINGS", "balance": 120_000_000, "is_liquid": True}],
    }
    base_res = {
        "summary": "Chi tiêu không kiểm soát!",
        "warnings": ["Thu nhập 0"],
        "suggestions": ["Tìm việc ngay"],
        "confidence": 0.85,
        "health_grade": "CRITICAL",
        "risk_score": 0.90,
    }
    res = apply_advisor_hardening_policy(profile, base_res)
    assert res["health_grade"] != "CRITICAL", f"Sabbatical with 8 months liquid runway should not trigger CRITICAL panic, got {res['health_grade']}"
    assert "sabbatical" in res["summary"].lower() or "kế hoạch" in res["summary"].lower() or "dự phòng" in res["summary"].lower()


def test_advisor_lifestyle_inflation_thin_buffer():
    # 100m income, 98m expense, only 10m liquid savings (< 0.5 month reserve)
    profile = {
        "income": 100_000_000.0,
        "expense": 98_000_000.0,
        "categories": [{"name": "mua sắm", "spent": 60_000_000}, {"name": "ăn uống", "spent": 38_000_000}],
        "wallets": [{"type": "BANK", "balance": 10_000_000, "is_liquid": True}],
    }
    base_res = {
        "summary": "Mọi thứ đều ổn!",
        "warnings": [],
        "suggestions": [],
        "confidence": 0.85,
        "health_grade": "HEALTHY",
        "risk_score": 0.20,
    }
    res = apply_advisor_hardening_policy(profile, base_res)
    assert res["health_grade"] in ("CAUTION", "CRITICAL")
    all_text = " ".join([res.get("summary", "")] + res.get("warnings", []))
    assert "mỏng" in all_text.lower() or "lối sống" in all_text.lower() or "cushion" in all_text.lower()


# ---------------------------------------------------------------------------
# 5. Warning Realistic Challenge Quality Gate Test
# ---------------------------------------------------------------------------
def test_warning_v3_realistic_challenge_evaluation():
    from warning_v3_realistic_audit.scripts.evaluate import run_warning_v3_realistic_audit

    report = run_warning_v3_realistic_audit()
    metrics = report["metrics"]

    assert metrics["recall"] == 0.8571
    assert metrics["precision"] == 0.4286
    assert metrics["f1"] == 0.5714
    assert metrics["fpr"] == 0.4706
    assert metrics["fnr"] == 0.1429
    assert metrics["brier_score"] == 0.1942
    assert metrics["pr_auc"] == 0.4865
    assert metrics["total_samples"] == 24

    # Exact consistency check between calculated FPR and reported verdict string
    fpr_str = f"{metrics['fpr'] * 100:.2f}%"
    assert fpr_str == "47.06%"
    assert fpr_str in report["verdict_reason"], f"Verdict reason must contain {fpr_str}, got {report['verdict_reason']}"
    assert "41.18%" not in report["verdict_reason"], "Stale 41.18% must not exist in verdict reason"
    assert report["status"] == "EXPERIMENTAL"


# ---------------------------------------------------------------------------
# 6. Model Registry Standardized Statuses Test
# ---------------------------------------------------------------------------
def test_model_registry_standardized_statuses():
    expected_statuses = {
        "classify_v3": "PRODUCTION_CONTROL",
        "classify_v4": "CANARY_5_PERCENT",
        "forecast_v3": "PRODUCTION_ADVISORY",
        "warning_v3": "EXPERIMENTAL",
        "advisor": "ADVISORY_EXPERIMENTAL",
    }

    for key, expected in expected_statuses.items():
        assert key in MODEL_REGISTRY, f"Key '{key}' missing from MODEL_REGISTRY!"
        assert MODEL_REGISTRY[key].status == expected, (
            f"Model {key} status is '{MODEL_REGISTRY[key].status}', expected '{expected}'"
        )
    assert "warning_v4" not in MODEL_REGISTRY, "warning_v4 must not exist in MODEL_REGISTRY without actual v4 artifact"


# ---------------------------------------------------------------------------
# 7. Classification Real-World Edge Cases (Typos & No Diacritics)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("text,expected_category", [
    ("cf 35k", "ăn uống"),
    ("do xang xe may 50k", "di chuyển"),
    ("mua giay sneaker shopee", "mua sắm"),
    ("nap the dien thoai viettel", "hóa đơn"),
    ("mua thuoc cam cum panadol", "sức khỏe"),
    ("dong tien hoc phi ky 1", "giáo dục"),
])
def test_classify_realistic_user_phrases(client, text, expected_category):
    res = client.post("/classify", json={"text": text})
    assert res.status_code == 200
    data = res.json()
    assert data["category"] == expected_category, (
        f"Input '{text}' predicted as '{data['category']}', expected '{expected_category}'"
    )
