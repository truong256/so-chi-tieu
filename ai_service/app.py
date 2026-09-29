"""
ai_service/app.py
=================
FastAPI application for So Chi Tieu AI Service.
Integrates 4 independent ML models under a unified, resilient REST API.
"""

import time
import logging
from contextlib import asynccontextmanager
from typing import Union

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError

from ai_service.config import SERVICE_NAME, SERVICE_VERSION, MODEL_REGISTRY
from ai_service.loaders.model_loader import ModelContainer
from ai_service.schemas import (
    HealthResponse,
    FailSafeResponse,
    ClassifyRequest,
    ClassifyResponse,
    ForecastRequest,
    ForecastResponse,
    RiskRequest,
    RiskResponse,
    AdvisorRequest,
    AdvisorResponse,
)
from ai_service.services import (
    run_classify,
    run_forecast,
    run_risk,
    run_advisor,
)

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ai_service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load all model artifacts once on startup."""
    t0 = time.perf_counter()
    logger.info(f"Starting {SERVICE_NAME} v{SERVICE_VERSION}...")
    container = ModelContainer.get_instance()
    container.load_all_models()
    load_time = (time.perf_counter() - t0) * 1000.0
    logger.info(f"Model startup initialization finished in {load_time:.2f} ms.")
    yield
    logger.info(f"Shutting down {SERVICE_NAME}...")


app = FastAPI(
    title=SERVICE_NAME,
    version=SERVICE_VERSION,
    description="Standalone AI/ML Integration Service for Sổ Chi Tiêu",
    lifespan=lifespan,
)

# CORS Middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Exception Handlers
# ---------------------------------------------------------------------------
from fastapi.encoders import jsonable_encoder


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "Validation Error",
            "detail": jsonable_encoder(exc.errors()),
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error processing {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "Internal Server Error",
            "message": str(exc),
        },
    )


# ---------------------------------------------------------------------------
# Endpoints & Internal Telemetry Security Guard
# ---------------------------------------------------------------------------
from typing import Optional
from pydantic import BaseModel
from fastapi import Header, HTTPException, Depends
import hmac
from ai_service.config import (
    SERVICE_NAME,
    SERVICE_VERSION,
    MODEL_REGISTRY,
    AI_MODEL_FALLBACK_ENABLED,
    AI_SHADOW_MODE,
    AI_CLASSIFY_V4_SHADOW_ENABLED,
    AI_CLASSIFY_V4_CANARY_ENABLED,
    AI_CLASSIFY_V4_CANARY_PERCENT,
    AI_INTERNAL_TELEMETRY_TOKEN,
)
from ai_service.observability import (
    get_classify_v4_shadow_metrics,
    get_user_feedback_metrics,
    record_user_correction_signal,
)
from ai_service.services.canary_guard import get_v4_canary_guard_status


def verify_internal_auth(
    authorization: Optional[str] = Header(None),
    x_internal_key: Optional[str] = Header(None),
):
    """
    Security Guard: Prevent unauthorized external access to internal telemetry metrics.
    Requires Authorization: Bearer <AI_INTERNAL_TELEMETRY_TOKEN> or X-Internal-Key: <token>.
    FAIL CLOSED: If AI_INTERNAL_TELEMETRY_TOKEN is unset/empty, all telemetry requests are rejected.
    """
    if not AI_INTERNAL_TELEMETRY_TOKEN:
        logger.warning("Telemetry access rejected: AI_INTERNAL_TELEMETRY_TOKEN is unconfigured (FAIL CLOSED).")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Telemetry authentication is unconfigured on server (FAIL CLOSED).",
        )

    # Extract provided token
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    elif x_internal_key:
        token = x_internal_key.strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Missing internal telemetry credentials.",
        )

    # Constant-time comparison
    if hmac.compare_digest(token, AI_INTERNAL_TELEMETRY_TOKEN):
        return True

    logger.warning("Telemetry access attempt with invalid/unauthorized token.")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Unauthorized: Invalid internal telemetry credentials.",
    )


class UserFeedbackPayload(BaseModel):
    model_version: str
    suggested_category: str
    final_category: str
    confidence_band: str
    user_id_hash: Optional[str] = None
    accepted: Optional[bool] = None
    latency_ms: Optional[float] = None


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check and model readiness status",
)
async def health():
    container = ModelContainer.get_instance()
    overall_status = container.get_health_status()
    return HealthResponse(
        status=overall_status,
        models={
            "classify": container.loaded_status.get("classify", False),
            "forecast": container.loaded_status.get("forecast", False),
            "risk": container.loaded_status.get("risk", False),
            "advisor": container.loaded_status.get("advisor", False),
        },
        registry={k: v.status for k, v in MODEL_REGISTRY.items()},
        versions={
            "classify": "v3" if container.loaded_status.get("classify_v3") else "v2",
            "risk": "v3" if container.loaded_status.get("risk_v3") else "v2",
            "forecast": "v3" if container.loaded_status.get("forecast_v3") else "v2",
            "advisor": "v3",
        },
        model_details={
            "classify": {
                "v3_loaded": container.loaded_status.get("classify_v3", False),
                "v4_loaded": container.loaded_status.get("classify_v4", False),
                "v4_shadow_enabled": AI_CLASSIFY_V4_SHADOW_ENABLED,
                "v4_canary_enabled": AI_CLASSIFY_V4_CANARY_ENABLED,
                "v4_canary_percent": AI_CLASSIFY_V4_CANARY_PERCENT,
                "v2_loaded": container.loaded_status.get("classify_v2", False),
            },
            "risk": {
                "v3_loaded": container.loaded_status.get("risk_v3", False),
                "v2_loaded": container.loaded_status.get("risk_v2", False),
            },
            "forecast": {
                "v3_loaded": container.loaded_status.get("forecast_v3", False),
                "v2_loaded": container.loaded_status.get("forecast_v2", False),
            },
            "advisor": {
                "v3_loaded": container.loaded_status.get("advisor_v3", False),
            },
        },
        fallback_enabled=AI_MODEL_FALLBACK_ENABLED,
        shadow_mode=AI_SHADOW_MODE,
    )


@app.get(
    "/telemetry/shadow",
    summary="Get Classify V3 vs V4 shadow telemetry metrics (Internal Protected)",
    dependencies=[Depends(verify_internal_auth)],
)
async def shadow_telemetry():
    return get_classify_v4_shadow_metrics()


@app.get(
    "/telemetry/canary",
    summary="Get Classify V4 canary guard, circuit breaker status, and real traffic promotion gate (Internal Protected)",
    dependencies=[Depends(verify_internal_auth)],
)
async def canary_telemetry():
    from ai_service.observability import get_real_events_status
    return {
        "canary_enabled": AI_CLASSIFY_V4_CANARY_ENABLED,
        "canary_percent": AI_CLASSIFY_V4_CANARY_PERCENT,
        "guard_status": get_v4_canary_guard_status(),
        "real_traffic": get_real_events_status(),
    }


@app.post(
    "/telemetry/feedback",
    summary="Record user category suggestion acceptance or correction (Internal Protected)",
    dependencies=[Depends(verify_internal_auth)],
)
async def record_feedback(payload: UserFeedbackPayload):
    return record_user_correction_signal(
        model_version=payload.model_version,
        suggested_category=payload.suggested_category,
        final_category=payload.final_category,
        confidence_band=payload.confidence_band,
        user_id_hash=payload.user_id_hash,
        accepted=payload.accepted,
        latency_ms=payload.latency_ms,
    )


@app.get(
    "/telemetry/feedback",
    summary="Get user suggestion acceptance vs correction metrics (Internal Protected)",
    dependencies=[Depends(verify_internal_auth)],
)
async def feedback_metrics():
    return get_user_feedback_metrics()


@app.post(
    "/classify",
    response_model=Union[ClassifyResponse, FailSafeResponse],
    summary="Classify transaction description into spending category",
)
async def classify(request: ClassifyRequest):
    return run_classify(request)


@app.post(
    "/forecast",
    response_model=Union[ForecastResponse, FailSafeResponse],
    summary="Forecast future daily spending",
)
async def forecast(request: ForecastRequest):
    return run_forecast(request)


@app.post(
    "/risk",
    response_model=Union[RiskResponse, FailSafeResponse],
    summary="Assess transaction fraud and risk score",
)
async def risk(request: RiskRequest):
    return run_risk(request)


@app.post(
    "/advisor",
    response_model=AdvisorResponse,
    summary="Generate comprehensive personal financial advice",
)
async def advisor(request: AdvisorRequest):
    return run_advisor(request)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ai_service.app:app", host="0.0.0.0", port=8000, reload=False)
