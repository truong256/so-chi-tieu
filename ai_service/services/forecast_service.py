"""
ai_service/services/forecast_service.py
=======================================
Service logic for spending forecasting:
- Primary: model_prediction_v3 (Walk-forward recursive Ridge, sMAPE 25.17%).
- Fallback: model_prediction_v2 (Recursive Ridge).
- Shadow Mode: Parallel evaluation of V2 vs V3 for verification without user impact.
- Telemetry & Metadata: Structured logging and response envelope metadata.
"""

import time
import json
import logging
from pathlib import Path
from typing import Union, List, Dict, Any
from datetime import datetime, timedelta

from ai_service.config import (
    MODEL_PREDICTION_V3_DIR,
    AI_FORECAST_MODEL_VERSION,
    AI_MODEL_FALLBACK_ENABLED,
    AI_SHADOW_MODE,
    AI_V3_CANARY_PERCENT,
    should_run_shadow,
    get_canary_decision,
)
from ai_service.loaders.model_loader import ModelContainer
from ai_service.services.registry import check_model_approval
from ai_service.schemas.forecast import ForecastRequest, ForecastResponse, DailyForecastItem
from ai_service.schemas.common import FailSafeResponse, ResponseMetadata
from ai_service.observability import log_inference_event, log_shadow_event

logger = logging.getLogger("ai_service.forecast")


def get_default_demo_history() -> List[Dict[str, Any]]:
    val_file = MODEL_PREDICTION_V3_DIR / "data" / "val.json"
    if val_file.exists():
        with open(val_file, "r", encoding="utf-8") as f:
            return json.load(f)[-45:]
    base_dt = datetime.now() - timedelta(days=35)
    return [
        {"date": (base_dt + timedelta(days=i)).strftime("%Y-%m-%d"), "amount": 200000.0}
        for i in range(35)
    ]


def run_forecast(request: ForecastRequest) -> Union[ForecastResponse, FailSafeResponse]:
    t0 = time.perf_counter()

    allowed, reason = check_model_approval("forecast", request.allow_unapproved)
    if not allowed:
        lat = (time.perf_counter() - t0) * 1000.0
        log_inference_event(
            endpoint="/forecast",
            model="forecast",
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
                model="forecast",
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
        canary_active, canary_ver, _ = get_canary_decision("forecast_default")
        if AI_V3_CANARY_PERCENT > 0:
            primary_version = canary_ver
            is_canary = canary_active
        else:
            primary_version = AI_FORECAST_MODEL_VERSION
            is_canary = False

    primary_engine = container.forecast_engine_v3 if primary_version == "v3" else container.forecast_engine_v2
    fallback_engine = container.forecast_engine_v2 if primary_version == "v3" else container.forecast_engine_v3

    fallback_used = False
    active_version = primary_version
    result = None

    history = request.history if request.history is not None else get_default_demo_history()

    # 1. Primary Execution
    if primary_engine is not None:
        try:
            r = primary_engine.forecast(history=history, horizon=request.days)
            if r.get("success"):
                result = r
            else:
                logger.warning(f"Forecast primary returned error: {r.get('error')}. Trying fallback...")
        except Exception as e:
            logger.warning(f"Forecast primary ({primary_version}) exception: {e}. Trying fallback...", exc_info=True)
            result = None

    # 2. Fallback Execution
    if result is None:
        if AI_MODEL_FALLBACK_ENABLED and fallback_engine is not None:
            try:
                r2 = fallback_engine.forecast(history=history, horizon=request.days)
                if r2.get("success"):
                    result = r2
                    fallback_used = True
                    active_version = "v2" if primary_version == "v3" else "v3"
                    logger.info(f"Forecast fallback ({active_version}) succeeded.")
            except Exception as e2:
                logger.error(f"Forecast fallback ({active_version}) exception: {e2}", exc_info=True)
                result = None

    # 3. If all failed
    if result is None:
        lat = (time.perf_counter() - t0) * 1000.0
        log_inference_event(
            endpoint="/forecast",
            model="forecast",
            version=primary_version,
            latency_ms=lat,
            success=False,
            fallback_used=fallback_used,
            error_type="forecast_execution_failed",
        )
        return FailSafeResponse(
            available=False,
            reason="forecast_execution_failed",
            detail="Forecasting model execution failed.",
            advisory=True,
            meta=ResponseMetadata(
                model="forecast",
                version=primary_version,
                latency_ms=lat,
                fallback_used=fallback_used,
                advisory=True,
            ),
        )

    # 4. Shadow Verification Mode
    if should_run_shadow(request.days) and not fallback_used:
        shadow_engine = fallback_engine
        shadow_version = "v2" if primary_version == "v3" else "v3"
        if shadow_engine is not None:
            try:
                t_shadow = time.perf_counter()
                s_res = shadow_engine.forecast(history=history, horizon=request.days)
                shadow_lat = (time.perf_counter() - t_shadow) * 1000.0
                if s_res.get("success"):
                    # Mean delta across horizon
                    v3_avg = sum(f["predicted_spending"] for f in result["forecast"]) / len(result["forecast"])
                    v2_avg = sum(f["predicted_spending"] for f in s_res["forecast"]) / len(s_res["forecast"])
                    log_shadow_event(
                        model="forecast",
                        primary_version=primary_version,
                        shadow_version=shadow_version,
                        same_prediction=abs(v3_avg - v2_avg) < 10000.0,
                        confidence_delta=v3_avg - v2_avg,
                        latency_delta_ms=shadow_lat,
                    )
            except Exception as se:
                logger.debug(f"Forecast shadow execution error (ignored): {se}")

    total_lat = (time.perf_counter() - t0) * 1000.0

    items = [
        DailyForecastItem(
            date=item["date"],
            predicted_spending=float(item["predicted_spending"]),
        )
        for item in result["forecast"]
    ]

    log_inference_event(
        endpoint="/forecast",
        model="forecast",
        version=active_version,
        latency_ms=total_lat,
        success=True,
        fallback_used=fallback_used,
    )

    return ForecastResponse(
        forecast=items,
        days=len(items),
        note=f"Mode: {result.get('mode', 'walkforward')}, History days: {result.get('days_history', len(history))}",
        advisory=True,
        meta=ResponseMetadata(
            model="forecast",
            version=active_version,
            latency_ms=round(total_lat, 2),
            fallback_used=fallback_used,
            canary=is_canary,
            advisory=True,
        ),
    )
