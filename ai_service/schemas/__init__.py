"""
ai_service/schemas/__init__.py
"""

from ai_service.schemas.common import HealthResponse, FailSafeResponse
from ai_service.schemas.classify import ClassifyRequest, ClassifyResponse
from ai_service.schemas.forecast import ForecastRequest, ForecastResponse, DailyForecastItem
from ai_service.schemas.risk import RiskRequest, RiskResponse
from ai_service.schemas.advisor import AdvisorRequest, AdvisorResponse, FinancialSummary

__all__ = [
    "HealthResponse",
    "FailSafeResponse",
    "ClassifyRequest",
    "ClassifyResponse",
    "ForecastRequest",
    "ForecastResponse",
    "DailyForecastItem",
    "RiskRequest",
    "RiskResponse",
    "AdvisorRequest",
    "AdvisorResponse",
    "FinancialSummary",
]
