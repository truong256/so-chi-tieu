"""
ai_service/services/canary_guard.py
===================================
Circuit breaker and automatic rollback guard for Classify V4 Canary deployment:
- Tracks sliding window of canary requests.
- Automatic Rollback Triggers:
  * Canary error/exception rate > 5%
  * Canary latency p95 > 50.0 ms
  * Consecutive failures >= 3
- Fail-safe: When tripped, canary is automatically disabled and routes 100% to V3 Control.
- Manual Kill Switch: Setting AI_CLASSIFY_V4_CANARY_ENABLED=false immediately disables canary.
"""

import time
import logging
from collections import deque
from typing import Dict, Any, Optional

logger = logging.getLogger("ai_service.canary_guard")

MAX_WINDOW_SIZE = 100
ERROR_RATE_THRESHOLD = 0.05  # 5%
LATENCY_P95_THRESHOLD_MS = 50.0  # 50 ms
CONSECUTIVE_FAILURES_THRESHOLD = 3

_canary_window = deque(maxlen=MAX_WINDOW_SIZE)
_canary_tripped: bool = False
_trip_reason: str = ""
_trip_timestamp: Optional[float] = None
_consecutive_failures: int = 0


def record_canary_execution(
    version: str,
    success: bool,
    latency_ms: float,
    error_type: Optional[str] = None,
):
    """Record an outcome in the sliding window and evaluate automatic rollback rules."""
    global _canary_tripped, _trip_reason, _trip_timestamp, _consecutive_failures

    if version != "v4":
        return

    _canary_window.append({
        "timestamp": time.time(),
        "success": success,
        "latency_ms": latency_ms,
        "error_type": error_type,
    })

    if not success:
        _consecutive_failures += 1
    else:
        _consecutive_failures = 0

    # Evaluate Rollback Rules if not already tripped
    if not _canary_tripped:
        # Rule 1: Consecutive failures
        if _consecutive_failures >= CONSECUTIVE_FAILURES_THRESHOLD:
            trip_v4_canary(f"Automatic Rollback: {CONSECUTIVE_FAILURES_THRESHOLD} consecutive V4 canary failures detected.")
            return

        # Rule 2: Error rate over minimum window
        if len(_canary_window) >= 20:
            failures = sum(1 for item in _canary_window if not item["success"])
            err_rate = failures / len(_canary_window)
            if err_rate >= ERROR_RATE_THRESHOLD:
                trip_v4_canary(f"Automatic Rollback: V4 error rate ({err_rate:.1%}) exceeds threshold ({ERROR_RATE_THRESHOLD:.1%}).")
                return

            # Rule 3: Latency spike
            latencies = [item["latency_ms"] for item in _canary_window if item["success"]]
            if latencies:
                import numpy as np
                p95 = float(np.percentile(latencies, 95))
                if p95 >= LATENCY_P95_THRESHOLD_MS:
                    trip_v4_canary(f"Automatic Rollback: V4 p95 latency ({p95:.1f}ms) exceeds threshold ({LATENCY_P95_THRESHOLD_MS}ms).")
                    return


def trip_v4_canary(reason: str):
    """Trip the canary circuit breaker to instantly revert 100% traffic to V3."""
    global _canary_tripped, _trip_reason, _trip_timestamp
    _canary_tripped = True
    _trip_reason = reason
    _trip_timestamp = time.time()
    logger.critical(f"🚨 [CANARY ROLLBACK TRIPPED] {reason} — 100% traffic instantly reverted to V3 Control.")


def is_v4_canary_tripped() -> bool:
    """Return True if automatic rollback has tripped the canary circuit."""
    return _canary_tripped


def get_v4_canary_guard_status() -> Dict[str, Any]:
    """Inspect current canary circuit breaker state."""
    window_total = len(_canary_window)
    failures = sum(1 for item in _canary_window if not item["success"]) if window_total else 0
    err_rate = round(failures / window_total, 4) if window_total else 0.0

    return {
        "tripped": _canary_tripped,
        "trip_reason": _trip_reason,
        "consecutive_failures": _consecutive_failures,
        "window_size": window_total,
        "window_error_rate": err_rate,
        "trip_timestamp": _trip_timestamp,
    }


def reset_v4_canary_guard():
    """Reset the canary circuit breaker (used in tests and manual recovery)."""
    global _canary_tripped, _trip_reason, _trip_timestamp, _consecutive_failures
    _canary_tripped = False
    _trip_reason = ""
    _trip_timestamp = None
    _consecutive_failures = 0
    _canary_window.clear()
    logger.info("Canary guard circuit breaker reset to normal operation.")
