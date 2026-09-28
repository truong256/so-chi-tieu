import pytest
from ai_service.config import (
    stable_user_bucket,
    get_canary_decision,
    AI_V3_CANARY_PERCENT,
)


def test_stable_user_bucket_determinism():
    uid = "user_alpha_12345"
    b1 = stable_user_bucket(uid)
    for _ in range(100):
        assert stable_user_bucket(uid) == b1
    assert 0 <= b1 < 100


def test_canary_decision_bounds(monkeypatch):
    # Test 0%
    monkeypatch.setattr("ai_service.config.AI_V3_CANARY_PERCENT", 0)
    for i in range(20):
        is_canary, ver, bucket = get_canary_decision(f"user_{i}")
        assert not is_canary
        assert ver == "v2"

    # Test 100%
    monkeypatch.setattr("ai_service.config.AI_V3_CANARY_PERCENT", 100)
    for i in range(20):
        is_canary, ver, bucket = get_canary_decision(f"user_{i}")
        assert ver == "v3"

    # Test 5%
    monkeypatch.setattr("ai_service.config.AI_V3_CANARY_PERCENT", 5)
    # anonymous
    assert get_canary_decision(None) == (False, "v2", 0)
    assert get_canary_decision("") == (False, "v2", 0)


def test_canary_distribution_10000(monkeypatch):
    import hashlib
    monkeypatch.setattr("ai_service.config.AI_V3_CANARY_PERCENT", 5)
    v3_count = 0
    total = 10000
    for i in range(total):
        uid = hashlib.sha1(f"seed_user_id_{i}".encode()).hexdigest()
        is_canary, ver, _ = get_canary_decision(uid)
        if ver == "v3":
            v3_count += 1
    pct = (v3_count / total) * 100.0
    assert 4.5 <= pct <= 5.5, f"Expected ~5% canary, got {pct}% ({v3_count}/{total})"
