"""
ai_service/observability.py
===========================
Structured logging and observability for the AI Subsystem:
- Structured JSON-format event logging.
- Latency and fallback tracking.
- Strict PII and financial confidentiality enforcement:
  * NEVER logs transaction text or descriptions.
  * NEVER logs bank account, card numbers, or credit limits.
  * NEVER logs authorization headers, cookies, or secrets.
  * Logs only operational metrics: endpoint, model, version, latency_ms, status, fallback, confidence bucket.
"""

import time
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

logger = logging.getLogger("ai_service.telemetry")


def get_confidence_bucket(confidence: Optional[float]) -> str:
    """Bucket confidence into coarse intervals for privacy-safe aggregate analysis."""
    if confidence is None:
        return "none"
    if confidence >= 0.85:
        return "high (>=0.85)"
    if confidence >= 0.60:
        return "medium (0.60-0.85)"
    if confidence >= 0.40:
        return "low (0.40-0.60)"
    return "very_low (<0.40)"


def log_inference_event(
    endpoint: str,
    model: str,
    version: str,
    latency_ms: float,
    success: bool,
    fallback_used: bool = False,
    confidence: Optional[float] = None,
    error_type: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
):
    """
    Log an inference event with structured, non-sensitive telemetry.
    """
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": "ai_inference",
        "endpoint": endpoint,
        "model": model,
        "version": version,
        "latency_ms": round(latency_ms, 2),
        "success": success,
        "fallback_used": fallback_used,
        "confidence_bucket": get_confidence_bucket(confidence),
    }

    if error_type:
        payload["error_type"] = error_type

    if extra:
        safe_extra = {
            k: v for k, v in extra.items()
            if not any(sub in k.lower() for sub in ["text", "card", "token", "auth", "secret", "password", "key", "desc"])
        }
        payload["extra"] = safe_extra

    log_msg = json.dumps(payload)
    if success:
        logger.info(log_msg)
    else:
        logger.warning(log_msg)


def log_shadow_event(
    model: str,
    primary_version: str,
    shadow_version: str,
    same_prediction: bool,
    confidence_delta: float,
    latency_delta_ms: float,
):
    """
    Log a shadow comparison event without revealing raw user inputs.
    """
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": "ai_shadow_verification",
        "model": model,
        "primary_version": primary_version,
        "shadow_version": shadow_version,
        "same_prediction": same_prediction,
        "confidence_delta": round(confidence_delta, 4),
        "latency_delta_ms": round(latency_delta_ms, 2),
    }
    logger.info(json.dumps(payload))


from pathlib import Path
import numpy as np

DATA_DIR = Path(__file__).resolve().parent / "data"
SHADOW_TELEMETRY_FILE = DATA_DIR / "shadow_telemetry.jsonl"
FEEDBACK_TELEMETRY_FILE = DATA_DIR / "feedback_telemetry.jsonl"
REAL_EVENTS_TELEMETRY_FILE = DATA_DIR / "real_events_telemetry.jsonl"

# In-memory buffer for Classify V4 shadow telemetry (survives restart via jsonl replay)
_v4_shadow_records: list = []
_user_feedback_records: list = []
_real_event_records: list = []
_seen_real_event_idempotency_keys: set = set()


def _ensure_data_dir():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.error(f"Could not create telemetry data dir: {e}")


def _load_persisted_records():
    """Load persisted records from disk into memory on startup so telemetry survives restarts."""
    global _v4_shadow_records, _user_feedback_records, _real_event_records, _seen_real_event_idempotency_keys
    _ensure_data_dir()
    if SHADOW_TELEMETRY_FILE.exists():
        try:
            with open(SHADOW_TELEMETRY_FILE, "r", encoding="utf-8") as f:
                lines = f.readlines()
                # Load up to the last 5000 records
                for line in lines[-5000:]:
                    line = line.strip()
                    if line:
                        try:
                            _v4_shadow_records.append(json.loads(line))
                        except Exception:
                            continue
            logger.info(f"Loaded {len(_v4_shadow_records)} shadow telemetry events from {SHADOW_TELEMETRY_FILE}.")
        except Exception as e:
            logger.warning(f"Failed to read existing shadow telemetry: {e}")

    if FEEDBACK_TELEMETRY_FILE.exists():
        try:
            with open(FEEDBACK_TELEMETRY_FILE, "r", encoding="utf-8") as f:
                lines = f.readlines()
                for line in lines[-5000:]:
                    line = line.strip()
                    if line:
                        try:
                            _user_feedback_records.append(json.loads(line))
                        except Exception:
                            continue
            logger.info(f"Loaded {len(_user_feedback_records)} feedback events from {FEEDBACK_TELEMETRY_FILE}.")
        except Exception as e:
            logger.warning(f"Failed to read existing feedback telemetry: {e}")

    if REAL_EVENTS_TELEMETRY_FILE.exists():
        try:
            with open(REAL_EVENTS_TELEMETRY_FILE, "r", encoding="utf-8") as f:
                lines = f.readlines()
                for line in lines[-10000:]:
                    line = line.strip()
                    if line:
                        try:
                            rec = json.loads(line)
                            _real_event_records.append(rec)
                            if rec.get("idempotency_key"):
                                _seen_real_event_idempotency_keys.add(rec["idempotency_key"])
                        except Exception:
                            continue
            logger.info(f"Loaded {len(_real_event_records)} real traffic events from {REAL_EVENTS_TELEMETRY_FILE}.")
        except Exception as e:
            logger.warning(f"Failed to read existing real traffic telemetry: {e}")


# Initialize on import
_load_persisted_records()


def _sanitize_no_pii(data: Dict[str, Any]) -> Dict[str, Any]:
    """Strictly assert no raw text or sensitive fields exist in telemetry records."""
    banned_substrings = ["text", "desc", "card", "token", "auth", "secret", "password", "key", "account", "email", "phone"]
    for k in data.keys():
        lower_k = k.lower()
        if any(sub in lower_k for sub in banned_substrings) and k not in ("request_id", "idempotency_key"):
            raise ValueError(f"PII Leakage Prevention: Forbidden telemetry key '{k}' detected.")
    return data


def record_classify_v4_shadow_event(
    v3_category: str,
    v3_confidence: float,
    v4_category: Optional[str],
    v4_confidence: float,
    v4_status: str,
    v3_latency_ms: float,
    v4_latency_ms: float,
    request_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Log and record a Classify V4 shadow evaluation with strict privacy guarantee:
    - NEVER records raw user text, transaction descriptions, tokens, or financial accounts.
    - Records only pseudonymous request_id, timestamps, categories, confidences, agreement, and latencies.
    - Survives process crashes and restarts via durable JSONL append.
    - Telemetry I/O failures are safely isolated and NEVER fail classification.
    """
    import uuid
    req_id = request_id or str(uuid.uuid4())
    now_str = datetime.now(timezone.utc).isoformat()

    agreement = (v3_category == v4_category) if v4_category is not None else False
    v3_conf = float(v3_confidence)
    v4_conf = float(v4_confidence)
    v3_high = v3_conf >= 0.60
    v4_high = v4_conf >= 0.60

    confidence_band = "HIGH" if v3_conf >= 0.60 else ("MEDIUM" if v3_conf >= 0.40 else "LOW")

    record = {
        "request_id": req_id,
        "timestamp": now_str,
        "model_version": "v3",
        "category": v3_category,
        "confidence_band": confidence_band,
        "latency_ms": round(float(v3_latency_ms), 2),
        "success": True,
        "v3_category": v3_category,
        "v3_confidence": round(v3_conf, 4),
        "v4_category": v4_category,
        "v4_confidence": round(v4_conf, 4),
        "agreement": agreement,
        "v3_high_confidence": v3_high,
        "v4_high_confidence": v4_high,
        "shadow_status": v4_status,
        "v3_latency_ms": round(float(v3_latency_ms), 2),
        "v4_latency_ms": round(float(v4_latency_ms), 2),
    }

    _sanitize_no_pii(record)

    _v4_shadow_records.append(record)
    if len(_v4_shadow_records) > 5000:
        _v4_shadow_records.pop(0)

    # Durable persistence (survives restart)
    try:
        _ensure_data_dir()
        with open(SHADOW_TELEMETRY_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as io_err:
        logger.error(f"Telemetry write failed (isolated, classification safe): {io_err}")

    logger.info(json.dumps({"event": "ai_v4_shadow_telemetry", **record}))
    return record


def record_user_correction_signal(
    model_version: str,
    suggested_category: str,
    final_category: str,
    confidence_band: str,
    user_id_hash: Optional[str] = None,
    accepted: Optional[bool] = None,
    latency_ms: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Record user acceptance or correction of AI category suggestion:
    - If suggested == final -> suggestion_accepted
    - If suggested != final -> suggestion_changed
    - Strictly no raw transaction text.
    """
    now_str = datetime.now(timezone.utc).isoformat()
    is_accepted = (suggested_category == final_category) if accepted is None else bool(accepted)
    event_type = "suggestion_accepted" if is_accepted else "suggestion_changed"

    record = {
        "timestamp": now_str,
        "event": event_type,
        "accepted": is_accepted,
        "model_version": model_version,
        "suggested_category": suggested_category,
        "final_category": final_category,
        "confidence_band": confidence_band,
        "user_id_hash": user_id_hash,
    }
    if latency_ms is not None:
        record["latency_ms"] = round(float(latency_ms), 2)

    _sanitize_no_pii(record)

    _user_feedback_records.append(record)
    if len(_user_feedback_records) > 5000:
        _user_feedback_records.pop(0)

    try:
        _ensure_data_dir()
        with open(FEEDBACK_TELEMETRY_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as io_err:
        logger.error(f"Feedback telemetry write failed (isolated): {io_err}")

    logger.info(json.dumps(record))
    return record


def get_classify_v4_shadow_metrics() -> Dict[str, Any]:
    """Calculate comprehensive aggregate telemetry metrics for V3 vs V4 shadow execution."""
    total = len(_v4_shadow_records)
    if total == 0:
        return {
            "total_events": 0,
            "total_samples": 0,
            "agreement_count": 0,
            "disagreement_count": 0,
            "agreement_rate": 0.0,
            "v3_high_v4_high_disagreement": 0,
            "v3_high_v4_low": 0,
            "v3_low_v4_high": 0,
            "v3_high_confidence_rate": 0.0,
            "v4_high_confidence_rate": 0.0,
            "shadow_success": 0,
            "shadow_failure": 0,
            "shadow_timeout": 0,
            "v3_latency_p50": 0.0,
            "v3_latency_p95": 0.0,
            "v3_latency_p99": 0.0,
            "v4_latency_p50": 0.0,
            "v4_latency_p95": 0.0,
            "v4_latency_p99": 0.0,
            "transitions": {},
            "correctness_disclaimer": "V3 == V4 represents model agreement, NOT true classification correctness.",
        }

    agreements = sum(1 for r in _v4_shadow_records if r.get("agreement", False))
    disagreements = total - agreements
    agreement_rate = round(agreements / total, 4)

    v3_high_count = sum(1 for r in _v4_shadow_records if r.get("v3_high_confidence", False))
    v4_high_count = sum(1 for r in _v4_shadow_records if r.get("v4_high_confidence", False))

    v3_high_v4_high_disagreement = sum(
        1 for r in _v4_shadow_records
        if not r.get("agreement", False) and r.get("v3_high_confidence", False) and r.get("v4_high_confidence", False)
    )
    v3_high_v4_low = sum(
        1 for r in _v4_shadow_records
        if r.get("v3_confidence", 0.0) >= 0.60 and r.get("v4_confidence", 0.0) < 0.40
    )
    v3_low_v4_high = sum(
        1 for r in _v4_shadow_records
        if r.get("v3_confidence", 0.0) < 0.40 and r.get("v4_confidence", 0.0) >= 0.60
    )

    shadow_success = sum(1 for r in _v4_shadow_records if r.get("shadow_status") == "success" or r.get("v4_shadow_status") == "success")
    shadow_timeout = sum(1 for r in _v4_shadow_records if "timeout" in str(r.get("shadow_status", "")).lower())
    shadow_failure = total - shadow_success

    transitions: Dict[str, int] = {}
    for r in _v4_shadow_records:
        if not r.get("agreement", False) and r.get("v4_category"):
            key = f"{r.get('v3_category')} -> {r.get('v4_category')}"
            transitions[key] = transitions.get(key, 0) + 1

    v3_lats = [r.get("v3_latency_ms", 0.0) for r in _v4_shadow_records if r.get("v3_latency_ms") is not None]
    v4_lats = [r.get("v4_latency_ms", 0.0) for r in _v4_shadow_records if (r.get("shadow_status") == "success" or r.get("v4_shadow_status") == "success") and r.get("v4_latency_ms") is not None]

    def _calc_p(values: list, p: float) -> float:
        if not values:
            return 0.0
        return round(float(np.percentile(values, p)), 2)

    return {
        "total_events": total,
        "total_samples": total,
        "agreement_count": agreements,
        "disagreement_count": disagreements,
        "agreement_rate": agreement_rate,
        "v3_high_v4_high_disagreement": v3_high_v4_high_disagreement,
        "v3_high_v4_low": v3_high_v4_low,
        "v3_low_v4_high": v3_low_v4_high,
        "v3_high_confidence_rate": round(v3_high_count / total, 4),
        "v4_high_confidence_rate": round(v4_high_count / total, 4),
        "shadow_success": shadow_success,
        "shadow_failure": shadow_failure,
        "shadow_timeout": shadow_timeout,
        "v4_success_count": shadow_success,
        "v4_error_count": shadow_failure,
        "v3_latency_p50": _calc_p(v3_lats, 50),
        "v3_latency_p95": _calc_p(v3_lats, 95),
        "v3_latency_p99": _calc_p(v3_lats, 99),
        "v4_latency_p50": _calc_p(v4_lats, 50),
        "v4_latency_p95": _calc_p(v4_lats, 95),
        "v4_latency_p99": _calc_p(v4_lats, 99),
        "transitions": transitions,
        "correctness_disclaimer": "V3 == V4 represents model agreement, NOT true classification correctness.",
    }


def get_user_feedback_metrics() -> Dict[str, Any]:
    """
    Aggregate statistics for user category suggestion acceptance vs correction.
    Tracks V3 and V4 separately as proxy ground-truth (agreement is not correctness).
    """
    total = len(_user_feedback_records)
    if total == 0:
        return {
            "total_events": 0,
            "v3_total": 0,
            "v4_total": 0,
            "v3_acceptance_rate": 0.0,
            "v4_acceptance_rate": 0.0,
            "v3_correction_rate": 0.0,
            "v4_correction_rate": 0.0,
            "v3_high_confidence_correction": 0.0,
            "v4_high_confidence_correction": 0.0,
            "v3_uncertain_rate": 0.0,
            "v4_uncertain_rate": 0.0,
            "ground_truth_note": "User correction signals are proxy ground-truth. V3 == V4 agreement is NOT treated as ground truth.",
        }

    v3_records = [r for r in _user_feedback_records if r.get("model_version") == "v3"]
    v4_records = [r for r in _user_feedback_records if r.get("model_version") == "v4"]

    def _calc_model_stats(records: list) -> Dict[str, Any]:
        count = len(records)
        if count == 0:
            return {
                "total": 0,
                "accepted": 0,
                "changed": 0,
                "acceptance_rate": 0.0,
                "correction_rate": 0.0,
                "high_conf_correction_rate": 0.0,
                "uncertain_rate": 0.0,
            }
        accepted = sum(1 for r in records if r.get("event") == "suggestion_accepted")
        changed = sum(1 for r in records if r.get("event") == "suggestion_changed")

        high_records = [r for r in records if r.get("confidence_band") == "HIGH"]
        high_changed = sum(1 for r in high_records if r.get("event") == "suggestion_changed")
        high_corr_rate = round(high_changed / len(high_records), 4) if high_records else 0.0

        low_records = sum(1 for r in records if r.get("confidence_band") == "LOW")
        uncertain_rate = round(low_records / count, 4)

        return {
            "total": count,
            "accepted": accepted,
            "changed": changed,
            "acceptance_rate": round(accepted / count, 4),
            "correction_rate": round(changed / count, 4),
            "high_conf_correction_rate": high_corr_rate,
            "uncertain_rate": uncertain_rate,
        }

    v3_stats = _calc_model_stats(v3_records)
    v4_stats = _calc_model_stats(v4_records)

    accepted_total = sum(1 for r in _user_feedback_records if r.get("event") == "suggestion_accepted")
    changed_total = total - accepted_total

    correction_by_category: Dict[str, int] = {}
    for r in _user_feedback_records:
        if r.get("event") == "suggestion_changed" and r.get("suggested_category"):
            cat = r["suggested_category"]
            correction_by_category[cat] = correction_by_category.get(cat, 0) + 1

    return {
        "total_events": total,
        "accepted_count": accepted_total,
        "changed_count": changed_total,
        "acceptance_rate": round(accepted_total / total, 4),
        "correction_rate": round(changed_total / total, 4),
        "v3": v3_stats,
        "v4": v4_stats,
        "v3_total": v3_stats["total"],
        "v4_total": v4_stats["total"],
        "v3_acceptance_rate": v3_stats["acceptance_rate"],
        "v4_acceptance_rate": v4_stats["acceptance_rate"],
        "v3_correction_rate": v3_stats["correction_rate"],
        "v4_correction_rate": v4_stats["correction_rate"],
        "v3_high_confidence_correction": v3_stats["high_conf_correction_rate"],
        "v4_high_confidence_correction": v4_stats["high_conf_correction_rate"],
        "v3_uncertain_rate": v3_stats["uncertain_rate"],
        "v4_uncertain_rate": v4_stats["uncertain_rate"],
        "correction_by_category": correction_by_category,
        "ground_truth_note": "User correction signals are proxy ground-truth. V3 == V4 agreement is NOT treated as ground truth.",
    }


def reset_classify_v4_shadow_records():
    """Clear in-memory and persisted shadow records (used in tests)."""
    global _v4_shadow_records, _user_feedback_records
    _v4_shadow_records.clear()
    _user_feedback_records.clear()
    try:
        if SHADOW_TELEMETRY_FILE.exists():
            SHADOW_TELEMETRY_FILE.unlink()
        if FEEDBACK_TELEMETRY_FILE.exists():
            FEEDBACK_TELEMETRY_FILE.unlink()
    except Exception as e:
        logger.warning(f"Could not remove telemetry files during reset: {e}")


def _persist_to_supabase_async(record: Dict[str, Any]):
    """
    Persist telemetry record to Supabase ai_canary_telemetry table:
    - Fire-and-forget daemon thread (error-isolated, never blocks response).
    - Uses SUPABASE_SERVICE_ROLE_KEY (anon/authenticated roles are revoked in migration 017).
    - Automatically resolves distributed duplicates via resolution=ignore-duplicates.
    - Handles HTTP 409 Conflict cleanly without tripping circuit breaker.
    """
    import os
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "") or os.getenv("SUPABASE_KEY", "")
    if not supabase_url or not supabase_key:
        return

    import threading
    def _worker():
        try:
            import urllib.request
            import urllib.error
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
                "Prefer": "resolution=ignore-duplicates,return=minimal",
            }
            url = f"{supabase_url.rstrip('/')}/rest/v1/ai_canary_telemetry"
            data = json.dumps(record).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=3.0):
                pass
        except urllib.error.HTTPError as http_err:
            if http_err.code == 409:
                logger.info("Supabase telemetry insert: duplicate idempotency_key already recorded in database (distributed conflict resolved).")
            else:
                logger.debug(f"Supabase telemetry HTTP error: {http_err.code} {http_err.reason}")
        except Exception as e:
            logger.debug(f"Supabase telemetry insert skipped/failed: {e}")

    t = threading.Thread(target=_worker, daemon=True)
    t.start()


def record_real_traffic_event(
    model_version: str,
    route_type: str,
    category: str,
    confidence: float,
    latency_ms: float,
    success: bool,
    fallback: bool = False,
    user_id_hash: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Record an authentic user transaction classification event:
    - ONLY invoked when request originates from authenticated application flow.
    - NEVER records raw transaction text, descriptions, bank accounts, or tokens.
    - Saves to disk and keeps running tally of valid real events.
    - Deduplicates repeated retries with identical idempotency_key.
    """
    global _seen_real_event_idempotency_keys
    if idempotency_key:
        if idempotency_key in _seen_real_event_idempotency_keys:
            logger.info(f"Duplicate real traffic event ignored for idempotency_key={idempotency_key}")
            return {
                "idempotency_key": idempotency_key,
                "is_duplicate": True,
                "is_real_traffic": True,
                "model_version": model_version,
            }
        _seen_real_event_idempotency_keys.add(idempotency_key)

    now_str = datetime.now(timezone.utc).isoformat()
    record = {
        "timestamp": now_str,
        "model_version": model_version,
        "route_type": route_type,
        "category": category[:50] if category else "unknown",
        "confidence": round(float(confidence), 4),
        "confidence_band": "HIGH" if confidence >= 0.60 else ("MEDIUM" if confidence >= 0.40 else "LOW"),
        "latency_ms": round(float(latency_ms), 2),
        "success": bool(success),
        "fallback": bool(fallback),
        "user_id_hash": user_id_hash[:64] if user_id_hash else None,
        "is_real_traffic": True,
    }
    if idempotency_key:
        record["idempotency_key"] = idempotency_key[:128]

    _sanitize_no_pii(record)
    _real_event_records.append(record)
    if len(_real_event_records) > 10000:
        _real_event_records.pop(0)

    try:
        _ensure_data_dir()
        with open(REAL_EVENTS_TELEMETRY_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception as io_err:
        logger.error(f"Real traffic telemetry write failed (isolated): {io_err}")

    _persist_to_supabase_async(record)
    return record


def get_real_events_status() -> Dict[str, Any]:
    """
    Calculate progress towards the >=500 valid V4 canary event promotion gate.
    Returns:
    - total_real_events
    - v3_real_events
    - v4_real_events
    - valid_v4_canary_events (successful non-fallback V4 canary inferences)
    - v4_success_events
    - v4_failure_events
    - v4_fallback_events
    - promotion_gate: PROMOTION_BLOCKED or READY_FOR_HUMAN_REVIEW (based on valid_v4_canary_events >= 500)
    """
    total_real = len(_real_event_records)
    v4_events = [r for r in _real_event_records if r.get("model_version") == "v4"]
    v3_events = [r for r in _real_event_records if r.get("model_version") == "v3"]

    v4_success_events = len([r for r in v4_events if r.get("success", False) is True])
    v4_failure_events = len([r for r in v4_events if not r.get("success", False)])
    v4_fallback_events = len([r for r in v4_events if r.get("fallback", False)])

    # valid_v4_canary_events: strictly authentic real traffic, handled by V4, successfully executed without fallback
    valid_v4_canary_events = len([
        r for r in v4_events
        if r.get("success", False) is True and not r.get("fallback", False)
    ])

    target = 500
    is_blocked = valid_v4_canary_events < target
    status_str = "PROMOTION_BLOCKED" if is_blocked else "READY_FOR_HUMAN_REVIEW"
    reason = (
        f"Promotion blocked: {valid_v4_canary_events}/{target} valid V4 canary events collected. "
        f"Minimum {target} successful non-fallback V4 canary events required before human review."
        if is_blocked
        else f"Minimum valid V4 canary event count reached ({valid_v4_canary_events}>={target}). Ready for human review."
    )

    v4_err_rate = round(v4_failure_events / len(v4_events), 4) if v4_events else 0.0
    v4_fb_rate = round(v4_fallback_events / len(v4_events), 4) if v4_events else 0.0

    v4_lats = [r.get("latency_ms", 0.0) for r in v4_events if r.get("latency_ms") is not None]
    p95_lat = round(float(np.percentile(v4_lats, 95)), 2) if v4_lats else 0.0
    p99_lat = round(float(np.percentile(v4_lats, 99)), 2) if v4_lats else 0.0

    return {
        "total_real_events": total_real,
        "v3_real_events": len(v3_events),
        "v4_real_events": len(v4_events),
        "valid_v4_canary_events": valid_v4_canary_events,
        "v4_success_events": v4_success_events,
        "v4_failure_events": v4_failure_events,
        "v4_fallback_events": v4_fallback_events,
        "valid_real_events": valid_v4_canary_events,  # backward compatibility alias
        "target_events": target,
        "progress": f"{valid_v4_canary_events} / {target}",
        "promotion_gate": status_str,
        "reason": reason,
        "v4_error_rate": v4_err_rate,
        "v4_fallback_rate": v4_fb_rate,
        "v4_latency_p95": p95_lat,
        "v4_latency_p99": p99_lat,
    }


def reset_real_events_records():
    """Clear real events telemetry records (testing only)."""
    global _real_event_records, _seen_real_event_idempotency_keys
    _real_event_records.clear()
    _seen_real_event_idempotency_keys.clear()
    try:
        if REAL_EVENTS_TELEMETRY_FILE.exists():
            REAL_EVENTS_TELEMETRY_FILE.unlink()
    except Exception as e:
        logger.warning(f"Could not remove real events telemetry file during reset: {e}")


