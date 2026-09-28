"""
ai_service/schemas/forecast.py
==============================
Request and Response schemas for /forecast endpoint.
Supports dynamic user historical daily expenses.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from ai_service.schemas.common import ResponseMetadata


class ForecastRequest(BaseModel):
    days: int = Field(default=30, ge=1, le=90, description="Forecast horizon in days (1 to 90)")
    history: Optional[List[Dict[str, Any]]] = Field(default=None, description="Dynamic user historical daily expenses")
    allow_unapproved: bool = Field(default=False, description="Bypass model approval status for testing")
    preferred_version: Optional[str] = Field(default=None, description="Preferred model version (e.g. 'v3' or 'v2')")
    canary: Optional[bool] = Field(default=None, description="Whether request is in canary cohort")


class DailyForecastItem(BaseModel):
    date: str
    predicted_spending: float


class ForecastResponse(BaseModel):
    forecast: List[DailyForecastItem]
    days: int
    note: Optional[str] = None
    advisory: bool = True
    meta: Optional[ResponseMetadata] = None
