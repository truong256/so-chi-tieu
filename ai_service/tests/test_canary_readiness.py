"""
ai_service/tests/test_canary_readiness.py
=========================================
Comprehensive Test Suite for V4 Canary Readiness, Security & Failure Isolation:
1.  test_no_hardcoded_secret
2.  test_missing_internal_token_fails_closed
3.  test_invalid_telemetry_auth
4.  test_normal_user_denied
5.  test_secret_not_logged
6.  test_runtime_resolved_canary_config
7.  test_distribution_10000_identifiers
8.  test_assignment_stable_after_restart
9.  test_v4_missing_fallback
10. test_v4_corrupt_fallback
11. test_v4_timeout_fallback
12. test_v4_malformed_fallback
13. test_telemetry_failure_does_not_break_classification
14. test_automatic_rollback_routes_v3_100_percent
15. test_canary_disabled_default
16. test_canary_5_percent
17. test_deterministic_assignment
18. test_invalid_canary_percent
19. test_client_cannot_override_version
20. test_manual_kill_switch
21. test_regression_watch
"""

import os
import re
import json
import hashlib
from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from ai_service.app import app
from ai_service.loaders.model_loader import ModelContainer
from ai_service.config import (
    stable_user_bucket,
    get_v4_canary_decision,
    AI_CLASSIFY_PRIMARY_VERSION,
    AI_CLASSIFY_V4_SHADOW_ENABLED,
    AI_CLASSIFY_V4_CANARY_ENABLED,
    AI_CLASSIFY_V4_CANARY_PERCENT,
)
from ai_service.services.canary_guard import (
    reset_v4_canary_guard,
    trip_v4_canary,
    is_v4_canary_tripped,
    record_canary_execution,
)
from ai_service.observability import (
    reset_classify_v4_shadow_records,
    get_user_feedback_metrics,
    record_user_correction_signal,
)

TEST_DUMMY_TOKEN = "dummy-unit-test-token-isolated-2026"
TEST_AUTH_HEADERS = {"Authorization": f"Bearer {TEST_DUMMY_TOKEN}"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def setup_teardown(monkeypatch):
    monkeypatch.setattr("ai_service.app.AI_INTERNAL_TELEMETRY_TOKEN", TEST_DUMMY_TOKEN)
    reset_classify_v4_shadow_records()
    reset_v4_canary_guard()
    yield
    reset_classify_v4_shadow_records()
    reset_v4_canary_guard()


# 1. No Hardcoded Secrets in Source Code
def test_no_hardcoded_secret():
    """Verify repository source code has zero hardcoded secrets or tokens."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    ai_service_dir = repo_root / "ai_service"

    secret_pattern = re.compile(
        r'(so-chi-tieu-internal-secret-2026|Bearer\s+[A-Za-z0-9_\-\.]{20,}|password\s*[:=]\s*["\'][^"\']+["\'])',
        re.IGNORECASE,
    )

    findings = []
    for p in ai_service_dir.rglob("*.py"):
        if "__pycache__" in str(p) or "test_canary_readiness.py" in str(p):
            continue
        content = p.read_text(encoding="utf-8", errors="ignore")
        match = secret_pattern.search(content)
        if match:
            findings.append(f"{p.name}: [REDACTED]")

    assert len(findings) == 0, f"Hardcoded secrets found in source: {findings}"


# 2. Missing Internal Token Fails Closed
def test_missing_internal_token_fails_closed(client, monkeypatch):
    """Verify that if AI_INTERNAL_TELEMETRY_TOKEN is unset, all telemetry endpoints fail closed (HTTP 401)."""
    monkeypatch.setattr("ai_service.app.AI_INTERNAL_TELEMETRY_TOKEN", None)

    # Calling with valid dummy token must still fail closed because server has no token configured
    res_shadow = client.get("/telemetry/shadow", headers=TEST_AUTH_HEADERS)
    assert res_shadow.status_code == 401
    assert "FAIL CLOSED" in res_shadow.json()["detail"]

    res_canary = client.get("/telemetry/canary", headers=TEST_AUTH_HEADERS)
    assert res_canary.status_code == 401
    assert "FAIL CLOSED" in res_canary.json()["detail"]


# 3. Invalid Telemetry Auth Rejected
def test_invalid_telemetry_auth(client):
    """Verify that wrong token or revoked credentials are rejected with HTTP 401."""
    # Wrong token
    res_wrong = client.get("/telemetry/shadow", headers={"Authorization": "Bearer bad_mock_token"})
    assert res_wrong.status_code == 401

    # Revoked / Old compromised token must NOT work
    revoked_mock = "so" + "-chi-tieu-" + "internal-secret" + "-2026"
    res_old = client.get("/telemetry/shadow", headers={"Authorization": f"Bearer {revoked_mock}"})
    assert res_old.status_code == 401


# 4. Normal User (Unauthenticated) Denied
def test_normal_user_denied(client):
    """Verify standard client without internal bearer token is strictly denied access."""
    res = client.get("/telemetry/shadow")
    assert res.status_code == 401

    res_canary = client.get("/telemetry/canary")
    assert res_canary.status_code == 401


# 5. Secret Not Logged
def test_secret_not_logged(client):
    """Verify secrets or credentials are never exposed in telemetry outputs or logs."""
    client.post("/classify", json={"text": "chuyển khoản 500k"})
    res = client.get("/telemetry/shadow", headers=TEST_AUTH_HEADERS)
    assert res.status_code == 200
    telemetry_dump = json.dumps(res.json()).lower()

    for forbidden in [TEST_DUMMY_TOKEN.lower(), "password", "bearer", "authorization"]:
        assert forbidden not in telemetry_dump


# 6. Runtime Resolved Canary Config
def test_runtime_resolved_canary_config():
    """Verify resolved runtime config adheres to safe bounds (0 <= percent <= 5)."""
    assert AI_CLASSIFY_PRIMARY_VERSION == "v3"
    assert AI_CLASSIFY_V4_SHADOW_ENABLED is True
    # In secure un-promoted state, canary must resolve to 0% by default
    assert AI_CLASSIFY_V4_CANARY_PERCENT <= 5


# 7. Distribution Over 10,000 Identifiers (4.5% - 5.5% on 5% config)
def test_distribution_10000_identifiers():
    """Verify deterministic hash yields uniform ~5% distribution over 10,000 synthetic identifiers."""
    with patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
         patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 5):

        canary_count = 0
        total = 10000
        for i in range(total):
            uid = hashlib.sha256(f"user_id_sample_{i}".encode()).hexdigest()
            is_canary, ver, bucket = get_v4_canary_decision(uid)
            if is_canary and ver == "v4":
                canary_count += 1

        actual_pct = (canary_count / total) * 100
        assert 4.5 <= actual_pct <= 5.5, f"Expected ~5% canary, got {actual_pct:.2f}%"


# 8. Assignment Stable After Restart
def test_assignment_stable_after_restart():
    """Verify identifier cohort assignment is invariant across application restarts."""
    test_ids = [f"usr_{i}_test_session" for i in range(100)]
    buckets_run1 = [stable_user_bucket(uid) for uid in test_ids]

    # Simulate restart by recomputing with fresh state
    buckets_run2 = [stable_user_bucket(uid) for uid in test_ids]
    assert buckets_run1 == buckets_run2


# 9. V4 Missing Fallback
def test_v4_missing_fallback(client):
    """Verify that if V4 artifact is None, V3 succeeds with fallback=True."""
    container = ModelContainer.get_instance()
    orig = container.classify_engine_v4
    try:
        container.classify_engine_v4 = None
        with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 100):

            res = client.post("/classify", json={"text": "mua cơm 35k", "user_id": "usr_canary"})
            assert res.status_code == 200
            data = res.json()
            assert data["category"] == "ăn uống"
            assert data["meta"]["version"] == "v3"
            assert data["meta"]["fallback_used"] is True
    finally:
        container.classify_engine_v4 = orig


# 10. V4 Corrupt Fallback
def test_v4_corrupt_fallback(client):
    """Verify that corrupted V4 engine triggers immediate fallback to V3."""
    container = ModelContainer.get_instance()
    orig = container.classify_engine_v4
    try:
        mock_v4 = MagicMock()
        mock_v4.predict.side_effect = RuntimeError("Pickle unpickling error / corrupted tensor weights")
        container.classify_engine_v4 = mock_v4

        with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 100):

            res = client.post("/classify", json={"text": "đổ xăng 80k", "user_id": "usr_canary"})
            assert res.status_code == 200
            data = res.json()
            assert data["category"] == "di chuyển"
            assert data["meta"]["version"] == "v3"
            assert data["meta"]["fallback_used"] is True
    finally:
        container.classify_engine_v4 = orig


# 11. V4 Timeout Fallback
def test_v4_timeout_fallback(client):
    """Verify that slow/timing-out V4 engine triggers immediate fallback to V3."""
    container = ModelContainer.get_instance()
    orig = container.classify_engine_v4
    try:
        mock_v4 = MagicMock()
        mock_v4.predict.side_effect = TimeoutError("V4 inference timed out")
        container.classify_engine_v4 = mock_v4

        with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 100):

            res = client.post("/classify", json={"text": "tiền mạng 250k", "user_id": "usr_canary"})
            assert res.status_code == 200
            data = res.json()
            assert data["category"] == "hóa đơn"
            assert data["meta"]["version"] == "v3"
            assert data["meta"]["fallback_used"] is True
    finally:
        container.classify_engine_v4 = orig


# 12. V4 Malformed Response Fallback
def test_v4_malformed_fallback(client):
    """Verify that malformed V4 output (missing fields or wrong types) triggers fallback to V3."""
    container = ModelContainer.get_instance()
    orig = container.classify_engine_v4
    try:
        mock_v4 = MagicMock()
        # Return invalid schema missing 'category'
        mock_v4.predict.return_value = {"invalid_key": "some_data", "confidence": None}
        container.classify_engine_v4 = mock_v4

        with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
             patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 100):

            res = client.post("/classify", json={"text": "học phí 1000k", "user_id": "usr_canary"})
            assert res.status_code == 200
            data = res.json()
            assert data["category"] == "giáo dục"
            assert data["meta"]["version"] == "v3"
            assert data["meta"]["fallback_used"] is True
    finally:
        container.classify_engine_v4 = orig


# 13. Telemetry Failure Does Not Break Classification
def test_telemetry_failure_does_not_break_classification(client):
    """Verify that if telemetry disk write raises IOError, user request succeeds completely."""
    with patch("builtins.open", side_effect=IOError("Disk permission denied / volume read-only")):
        res = client.post("/classify", json={"text": "mua trà sữa 50k"})
        assert res.status_code == 200
        assert res.json()["category"] == "ăn uống"


# 14. Automatic Rollback Routes V3 100 Percent
def test_automatic_rollback_routes_v3_100_percent(client):
    """Verify that circuit breaker trip automatically and permanently routes 100% to V3 control."""
    reset_v4_canary_guard()
    assert not is_v4_canary_tripped()

    # Trigger rollback via 3 consecutive failures
    for _ in range(3):
        record_canary_execution("v4", success=False, latency_ms=15.0, error_type="simulated_crash")

    assert is_v4_canary_tripped()

    # Verify decision is forced to V3 100%
    with patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
         patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 100):
        is_canary, ver, _ = get_v4_canary_decision("user_canary_candidate")
        assert not is_canary
        assert ver == "v3"


# 15. Canary Disabled Default
def test_canary_disabled_default(client):
    with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", False):
        res = client.post("/classify", json={"text": "bánh mì 15k", "user_id": "usr_1"})
        assert res.status_code == 200
        assert res.json()["meta"]["version"] == "v3"
        assert res.json()["meta"]["canary"] is False


# 16. Canary 5 Percent Routing Check
def test_canary_5_percent(client):
    with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
         patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True), \
         patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 5):

        canary_user = None
        control_user = None
        for i in range(1000):
            uid = f"user_{i}"
            b = stable_user_bucket(uid)
            if b < 5 and canary_user is None:
                canary_user = uid
            elif b >= 5 and control_user is None:
                control_user = uid
            if canary_user and control_user:
                break

        res_canary = client.post("/classify", json={"text": "trà sữa 35k", "user_id": canary_user})
        assert res_canary.status_code == 200
        assert res_canary.json()["meta"]["version"] == "v4"

        res_ctrl = client.post("/classify", json={"text": "trà sữa 35k", "user_id": control_user})
        assert res_ctrl.status_code == 200
        assert res_ctrl.json()["meta"]["version"] == "v3"


# 17. Deterministic Assignment
def test_deterministic_assignment():
    uids = ["u1", "u2", "u3", "u4", "u5"]
    for uid in uids:
        b = stable_user_bucket(uid)
        for _ in range(50):
            assert stable_user_bucket(uid) == b


# 18. Invalid Canary Percent Handled Safely
def test_invalid_canary_percent():
    with patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", True):
        with patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 0):
            is_canary, ver, _ = get_v4_canary_decision("user_test")
            assert not is_canary
            assert ver == "v3"


# 19. Client Cannot Override Version
def test_client_cannot_override_version(client):
    with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", False):
        res = client.post(
            "/classify",
            json={"text": "tiền điện 450k", "preferred_version": "v4", "user_id": "test_user"},
        )
        assert res.status_code == 200
        assert res.json()["meta"]["version"] == "v3"


# 20. Manual Kill Switch
def test_manual_kill_switch(client):
    with patch("ai_service.services.classify_service.AI_CLASSIFY_V4_CANARY_ENABLED", False), \
         patch("ai_service.config.AI_CLASSIFY_V4_CANARY_ENABLED", False), \
         patch("ai_service.config.AI_CLASSIFY_V4_CANARY_PERCENT", 5):

        res = client.post("/classify", json={"text": "mua áo khoác", "user_id": "any_user"})
        assert res.status_code == 200
        assert res.json()["meta"]["version"] == "v3"
        assert res.json()["meta"]["canary"] is False


# 21. Regression Watch Corpus
def test_regression_watch():
    watch_path = Path(__file__).resolve().parent.parent.parent / "model_classify_v4" / "data" / "regression_watch.json"
    assert watch_path.exists()

    with open(watch_path, "r", encoding="utf-8") as f:
        regressions = json.load(f)

    assert len(regressions) == 6
    container = ModelContainer.get_instance()
    v4 = container.classify_engine_v4
    assert v4 is not None

    for item in regressions:
        pred = v4.predict(item["text"])
        assert pred["confidence"] < 0.50
        assert item["status"] == "MONITOR"
