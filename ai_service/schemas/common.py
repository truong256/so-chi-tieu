"""
ai_service/schemas/common.py
============================
Shared schemas, health check models, and fail-safe envelopes.
"""

import math
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class ResponseMetadata(BaseModel):
    model: str
    version: str
    latency_ms: float
    fallback_used: bool = False
    canary: bool = False
    advisory: bool = True


class FailSafeResponse(BaseModel):
    available: bool = False
    reason: str = "model_not_approved"
    detail: Optional[str] = None
    advisory: bool = True
    meta: Optional[ResponseMetadata] = None


class HealthResponse(BaseModel):
    status: str  # "ok" or "degraded"
    models: Dict[str, bool]
    registry: Dict[str, str]
    versions: Optional[Dict[str, str]] = None
    model_details: Optional[Dict[str, Any]] = None
    fallback_enabled: bool = True
    shadow_mode: bool = False


def validate_finite_non_negative(v: float, name: str = "amount") -> float:
    if math.isnan(v) or math.isinf(v):
        raise ValueError(f"{name} must be a finite number.")
    if v < 0:
        raise ValueError(f"{name} must be non-negative (>= 0).")
    return v
