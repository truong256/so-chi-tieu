"""
ai_service/services/classify_service.py
=======================================
Service logic for transaction category classification:
- Primary: model_classify_v3 (Hybrid Word/Char TF-IDF + Softmax LR).
- Fallback: model_classify_v2 (Word TF-IDF + Logistic Regression).
- Shadow Mode: Parallel evaluation of V2 vs V3 for verification without user impact.
- Telemetry & Metadata: Structured logging and response envelope metadata.
"""

import time
import logging
from typing import Union

from ai_service.config import (
    AI_CLASSIFY_MODEL_VERSION,
    AI_CLASSIFY_PRIMARY_VERSION,
    AI_MODEL_FALLBACK_ENABLED,
    AI_SHADOW_MODE,
    AI_CLASSIFY_V4_SHADOW_ENABLED,
    AI_CLASSIFY_V4_CANARY_ENABLED,
    AI_CLASSIFY_V4_CANARY_PERCENT,
    should_run_shadow,
    get_v4_canary_decision,
    get_canary_decision,
)
from ai_service.loaders.model_loader import ModelContainer
from ai_service.services.registry import check_model_approval
from ai_service.schemas.classify import ClassifyRequest, ClassifyResponse
from ai_service.schemas.common import FailSafeResponse, ResponseMetadata
from ai_service.observability import (
    log_inference_event,
    log_shadow_event,
    record_classify_v4_shadow_event,
)
from ai_service.services.canary_guard import record_canary_execution, is_v4_canary_tripped

logger = logging.getLogger("ai_service.classify")


def run_classify(
    request: ClassifyRequest,
    is_trusted_internal: bool = False,
) -> Union[ClassifyResponse, FailSafeResponse]:
    t0 = time.perf_counter()

    # 1. Gate Approval Check
    allowed, reason = check_model_approval("classify", request.allow_unapproved)
    if not allowed:
        lat = (time.perf_counter() - t0) * 1000.0
        log_inference_event(
            endpoint="/classify",
            model="classify",
            version="none",
            latency_ms=lat,
            success=False,
            error_type="model_not_approved",
        )
        return FailSafeResponse(
            available=False,
            reason="model_not_approved",
            detail=reason,
            advisory=True,
            meta=ResponseMetadata(
                model="classify",
                version="none",
                latency_ms=lat,
                fallback_used=False,
                advisory=True,
            ),
        )

    container = ModelContainer.get_instance()

    # 2. Block Client Model Override (Section 9: Client cannot send model=v4 to bypass canary)
    # If client attempts to force "v4", silently sanitize/reject it and follow server routing
    safe_preferred_version = request.preferred_version
    if safe_preferred_version and safe_preferred_version.lower().strip() == "v4":
        logger.warning("Client requested version=v4 directly. Blocked per security policy; applying server-side routing.")
        safe_preferred_version = None

    # 3. Canary Routing Decision (Section 7, 8, 10)
    # Identifier for deterministic routing: user_id if present, else stable hash of text
    routing_identifier = request.user_id if request.user_id else request.text
    if not AI_CLASSIFY_V4_CANARY_ENABLED:
        is_v4_canary, target_version, bucket = False, "v3", 0
    else:
        is_v4_canary, target_version, bucket = get_v4_canary_decision(routing_identifier)

    # Allow legacy V2 selection if explicitly requested (e.g. testing V2 baseline)
    if safe_preferred_version == "v2":
        primary_version = "v2"
        is_canary = False
    elif is_v4_canary and target_version == "v4":
        primary_version = "v4"
        is_canary = True
    else:
        primary_version = "v3"
        is_canary = False

    result = None
    fallback_used = False
    active_version = primary_version
    v3_lat = 0.0

    # 4. Canary V4 Primary Execution (with immediate fallback to V3 Control on ANY failure)
    if primary_version == "v4":
        v4_engine = container.classify_engine_v4
        v4_success = False
        t_v4 = time.perf_counter()
        if v4_engine is not None:
            try:
                candidate = v4_engine.predict(request.text)
                if not isinstance(candidate, dict) or not candidate.get("category") or candidate.get("confidence") is None:
                    raise ValueError(f"Malformed V4 response schema: {candidate}")
                result = candidate
                v4_lat = (time.perf_counter() - t_v4) * 1000.0
                v4_success = True
                record_canary_execution("v4", success=True, latency_ms=v4_lat)
            except Exception as e:
                v4_lat = (time.perf_counter() - t_v4) * 1000.0
                logger.warning(f"V4 Canary prediction exception/malformed: {e}. Falling back immediately to V3 Control.")
                record_canary_execution("v4", success=False, latency_ms=v4_lat, error_type=str(e))
                result = None
        else:
            logger.warning("V4 Canary artifact missing/unavailable. Falling back immediately to V3 Control.")
            record_canary_execution("v4", success=False, latency_ms=0.0, error_type="v4_engine_null")
            result = None

        # Immediate Fallback to V3 Control if V4 failed
        if result is None:
            v3_engine = container.classify_engine_v3
            if v3_engine is not None:
                try:
                    t_v3_fb = time.perf_counter()
                    result = v3_engine.predict(request.text)
                    v3_lat = (time.perf_counter() - t_v3_fb) * 1000.0
                    active_version = "v3"
                    fallback_used = True
                    logger.info("Successfully recovered from V4 canary failure via V3 Control.")
                except Exception as e_v3:
                    logger.error(f"V3 Control fallback also failed: {e_v3}", exc_info=True)
                    result = None

    # 5. Standard V3 Control Execution (95% cohort or when canary is disabled)
    elif primary_version == "v3":
        primary_engine = container.classify_engine_v3
        fallback_engine = container.classify_engine_v2

        if primary_engine is not None:
            try:
                t_prim = time.perf_counter()
                result = primary_engine.predict(request.text)
                v3_lat = (time.perf_counter() - t_prim) * 1000.0
            except Exception as e:
                logger.warning(f"Classify primary (v3) failed: {e}. Checking fallback...", exc_info=True)
                result = None

        # Fallback to V2 if V3 failed
        if result is None and AI_MODEL_FALLBACK_ENABLED and fallback_engine is not None:
            try:
                result = fallback_engine.predict(request.text)
                fallback_used = True
                active_version = "v2"
                logger.info(f"Classify fallback ({active_version}) succeeded.")
            except Exception as e2:
                logger.error(f"Classify fallback ({active_version}) also failed: {e2}", exc_info=True)
                result = None

        # 6. Classify V4 Shadow Execution (Telemetry only; NEVER alters user result)
        if AI_CLASSIFY_V4_SHADOW_ENABLED and result is not None and not fallback_used:
            v4_engine = container.classify_engine_v4
            if v4_engine is not None:
                try:
                    t_v4 = time.perf_counter()
                    v4_res = v4_engine.predict(request.text)
                    v4_lat = (time.perf_counter() - t_v4) * 1000.0
                    record_classify_v4_shadow_event(
                        v3_category=result["category"],
                        v3_confidence=float(result["confidence"]),
                        v4_category=v4_res["category"],
                        v4_confidence=float(v4_res["confidence"]),
                        v4_status="success",
                        v3_latency_ms=v3_lat,
                        v4_latency_ms=v4_lat,
                    )
                except Exception as v4_err:
                    logger.warning(f"Classify V4 shadow execution error (safely isolated): {v4_err}")
                    record_classify_v4_shadow_event(
                        v3_category=result["category"],
                        v3_confidence=float(result["confidence"]),
                        v4_category=None,
                        v4_confidence=0.0,
                        v4_status=f"error: {v4_err}",
                        v3_latency_ms=v3_lat,
                        v4_latency_ms=0.0,
                    )
            else:
                record_classify_v4_shadow_event(
                    v3_category=result["category"],
                    v3_confidence=float(result["confidence"]),
                    v4_category=None,
                    v4_confidence=0.0,
                    v4_status="artifact_missing",
                    v3_latency_ms=v3_lat,
                    v4_latency_ms=0.0,
                )

    # 7. Legacy V2 Primary Execution (if explicitly requested)
    else:
        v2_engine = container.classify_engine_v2
        if v2_engine is not None:
            try:
                result = v2_engine.predict(request.text)
            except Exception as e:
                logger.error(f"Classify V2 execution failed: {e}")
                result = None

    # 8. If all attempts failed
    if result is None:
        lat = (time.perf_counter() - t0) * 1000.0
        log_inference_event(
            endpoint="/classify",
            model="classify",
            version=primary_version,
            latency_ms=lat,
            success=False,
            fallback_used=fallback_used,
            error_type="model_artifact_unavailable",
        )
        effective_is_real_traffic = bool(getattr(request, "is_real_traffic", False) and is_trusted_internal)
        if effective_is_real_traffic:
            import hashlib
            from ai_service.observability import record_real_traffic_event
            uid_hash = hashlib.sha256(request.user_id.encode("utf-8")).hexdigest() if request.user_id else None
            record_real_traffic_event(
                model_version="v4" if is_canary else primary_version,
                route_type="canary" if is_canary else "control",
                category="unknown",
                confidence=0.0,
                latency_ms=lat,
                success=False,
                fallback=fallback_used,
                user_id_hash=uid_hash,
                idempotency_key=getattr(request, "idempotency_key", None),
            )
        return FailSafeResponse(
            available=False,
            reason="model_artifact_unavailable",
            detail="Classify model artifact unavailable.",
            advisory=True,
            meta=ResponseMetadata(
                model="classify",
                version=primary_version,
                latency_ms=lat,
                fallback_used=fallback_used,
                advisory=True,
            ),
        )

    total_lat = (time.perf_counter() - t0) * 1000.0
    category = result["category"]
    confidence = float(result["confidence"])

    # 9. Confidence Gating Policy (Section 11)
    # HIGH >= 0.60 | MEDIUM >= 0.40 | LOW < 0.40
    warning = None
    if confidence < 0.40:
        warning = "Độ tin cậy thấp (<40%) — vui lòng kiểm tra lại gợi ý."

    # Observability log
    log_inference_event(
        endpoint="/classify",
        model="classify",
        version=active_version,
        latency_ms=total_lat,
        success=True,
        fallback_used=fallback_used,
        confidence=confidence,
    )

    # Real Event Tracking (Section 10: Only genuine authenticated application flow)
    effective_is_real_traffic = bool(getattr(request, "is_real_traffic", False) and is_trusted_internal)
    if effective_is_real_traffic:
        import hashlib
        from ai_service.observability import record_real_traffic_event
        uid_hash = hashlib.sha256(request.user_id.encode("utf-8")).hexdigest() if request.user_id else None
        record_real_traffic_event(
            model_version="v4" if is_canary else active_version,
            route_type="canary" if is_canary else "control",
            category=category,
            confidence=confidence,
            latency_ms=total_lat,
            success=True,
            fallback=fallback_used,
            user_id_hash=uid_hash,
            idempotency_key=getattr(request, "idempotency_key", None),
        )

    return ClassifyResponse(
        category=category,
        confidence=confidence,
        warning=warning,
        advisory=True,
        meta=ResponseMetadata(
            model="classify",
            version=active_version,
            latency_ms=round(total_lat, 2),
            fallback_used=fallback_used,
            canary=is_canary,
            advisory=True,
        ),
    )
