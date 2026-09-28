"""
ai_service/services/risk_service.py
===================================
Service logic for transaction risk & anomaly classification:
- Primary: model_warning_v3 (Leakage-free, group split, hardened null/zero defense, RiskMLP).
- Fallback: model_warning_v2 (Group split RiskMLP).
- Shadow Mode: Parallel evaluation of V2 vs V3 for verification without user impact.
- Telemetry & Metadata: Structured logging and response envelope metadata.
"""

import time
import logging
from typing import Union

from ai_service.config import (
    AI_RISK_MODEL_VERSION,
    AI_MODEL_FALLBACK_ENABLED,
    AI_SHADOW_MODE,
    AI_V3_CANARY_PERCENT,
    should_run_shadow,
    get_canary_decision,
)
from ai_service.loaders.model_loader import ModelContainer
from ai_service.services.registry import check_model_approval
from ai_service.schemas.risk import RiskRequest, RiskResponse
from ai_service.schemas.common import FailSafeResponse, ResponseMetadata
from ai_service.observability import log_inference_event, log_shadow_event

logger = logging.getLogger("ai_service.risk")


def run_risk(request: RiskRequest) -> Union[RiskResponse, FailSafeResponse]:
    t0 = time.perf_counter()

    allowed, reason = check_model_approval("risk", request.allow_unapproved)
    if not allowed:
        lat = (time.perf_counter() - t0) * 1000.0
        log_inference_event(
            endpoint="/risk",
            model="risk",
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
                model="risk",
                version="none",
                latency_ms=lat,
                fallback_used=False,
                advisory=True,
            ),
        )

    container = ModelContainer.get_instance()
    is_canary = False
    if request.preferred_version in ("v3", "v2"):
        primary_version = request.preferred_version
        is_canary = bool(request.canary) if request.canary is not None else (primary_version == "v3" and AI_V3_CANARY_PERCENT > 0)
    else:
        canary_active, canary_ver, _ = get_canary_decision(request.client_id)
        if AI_V3_CANARY_PERCENT > 0:
            primary_version = canary_ver
            is_canary = canary_active
        else:
            primary_version = AI_RISK_MODEL_VERSION
            is_canary = False

    primary_engine = container.risk_engine_v3 if primary_version == "v3" else container.risk_engine_v2
    fallback_engine = container.risk_engine_v2 if primary_version == "v3" else container.risk_engine_v3

    fallback_used = False
    active_version = primary_version
    result = None

    txn_dict = {
        "transaction_amount": request.amount,
        "credit_limit": request.credit_limit,
        "client_id": request.client_id,
        "card_id": request.card_id,
        "hour": request.hour,
        "day_of_week": request.day_of_week,
        "month": request.month,
        "mcc": request.mcc,
        "use_chip": request.use_chip,
        "card_brand": request.card_brand,
        "card_type": request.card_type,
        "has_chip": request.has_chip,
        "card_on_dark_web": request.card_on_dark_web,
        "credit_score": request.credit_score,
        "yearly_income": request.yearly_income,
        "current_age": request.current_age,
        "gender": request.gender,
        "errors": request.errors,
    }

    # 1. Primary Execution
    if primary_engine is not None:
        try:
            result = primary_engine.evaluate_transaction(txn_dict)
        except Exception as e:
            logger.warning(f"Risk primary ({primary_version}) failed: {e}. Checking fallback...", exc_info=True)
            result = None

    # 2. Fallback Execution
    if result is None:
        if AI_MODEL_FALLBACK_ENABLED and fallback_engine is not None:
            try:
                result = fallback_engine.evaluate_transaction(txn_dict)
                fallback_used = True
                active_version = "v2" if primary_version == "v3" else "v3"
                logger.info(f"Risk fallback ({active_version}) succeeded.")
            except Exception as e2:
                logger.error(f"Risk fallback ({active_version}) also failed: {e2}", exc_info=True)
                result = None

    # 3. If all failed
    if result is None:
        lat = (time.perf_counter() - t0) * 1000.0
        log_inference_event(
            endpoint="/risk",
            model="risk",
            version=primary_version,
            latency_ms=lat,
            success=False,
            fallback_used=fallback_used,
            error_type="model_artifact_unavailable",
        )
        return FailSafeResponse(
            available=False,
            reason="model_artifact_unavailable",
            detail="Risk warning model artifact unavailable.",
            advisory=True,
            meta=ResponseMetadata(
                model="risk",
                version=primary_version,
                latency_ms=lat,
                fallback_used=fallback_used,
                advisory=True,
            ),
        )

    # 4. Shadow Verification Mode
    if should_run_shadow(request.amount) and not fallback_used:
        shadow_engine = fallback_engine
        shadow_version = "v2" if primary_version == "v3" else "v3"
        if shadow_engine is not None:
            try:
                t_shadow = time.perf_counter()
                s_res = shadow_engine.evaluate_transaction(txn_dict)
                shadow_lat = (time.perf_counter() - t_shadow) * 1000.0
                same_level = s_res["risk_level"] == result["risk_level"]
                score_delta = float(result["risk_score"]) - float(s_res["risk_score"])
                log_shadow_event(
                    model="risk",
                    primary_version=primary_version,
                    shadow_version=shadow_version,
                    same_prediction=same_level,
                    confidence_delta=score_delta,
                    latency_delta_ms=shadow_lat,
                )
            except Exception as se:
                logger.debug(f"Risk shadow execution error (ignored): {se}")

    total_lat = (time.perf_counter() - t0) * 1000.0
    risk_score = float(result["risk_score"])
    risk_level = result["risk_level"]
    factors = result.get("factors", [])

    # Observability log
    log_inference_event(
        endpoint="/risk",
        model="risk",
        version=active_version,
        latency_ms=total_lat,
        success=True,
        fallback_used=fallback_used,
        confidence=risk_score,
    )

    return RiskResponse(
        risk_score=risk_score,
        risk_level=risk_level,
        fraud_probability=risk_score,
        risk_indicators=factors,
        warning=None,
        advisory=True,
        meta=ResponseMetadata(
            model="risk",
            version=active_version,
            latency_ms=round(total_lat, 2),
            fallback_used=fallback_used,
            canary=is_canary,
            advisory=True,
        ),
    )
