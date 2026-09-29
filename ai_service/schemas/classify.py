"""
ai_service/schemas/classify.py
==============================
Request and Response schemas for /classify endpoint.
"""

from typing import Optional, Dict
from pydantic import BaseModel, Field, field_validator
from ai_service.schemas.common import ResponseMetadata


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000, description="Transaction text description")
    user_id: Optional[str] = Field(default=None, description="Optional pseudonymized user ID for deterministic canary routing")
    allow_unapproved: bool = Field(default=False, description="Bypass model approval status for testing")
    preferred_version: Optional[str] = Field(default=None, description="Preferred model version (e.g. 'v3' or 'v2')")
    canary: Optional[bool] = Field(default=None, description="Whether request is in canary cohort")
    is_real_traffic: bool = Field(default=False, description="Flag indicating if request originates from actual authenticated user application flow")
    idempotency_key: Optional[str] = Field(default=None, max_length=128, description="Optional idempotency key to prevent duplicate telemetry counting on retries")

    @field_validator("text")
    @classmethod
    def check_non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Transaction text cannot be empty or whitespace only.")
        return v.strip()


class ClassifyResponse(BaseModel):
    category: str
    confidence: float
    warning: Optional[str] = None
    advisory: bool = True
    meta: Optional[ResponseMetadata] = None
