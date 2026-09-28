"""
ai_service/schemas/advisor.py
=============================
Request and Response schemas for /advisor endpoint.
Accepts structured input:
{
  "financial_summary": {...},
  "classification": {...},
  "forecast": {...},
  "risk": {...}
}
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, field_validator
from ai_service.schemas.common import validate_finite_non_negative


class CategoryItem(BaseModel):
    name: str = Field(..., max_length=200)
    kind: str = Field(default="expense")
    budget: float = Field(default=0.0)
    amount: float = Field(default=0.0)

    @field_validator("budget")
    @classmethod
    def check_budget(cls, v: float) -> float:
        return validate_finite_non_negative(v, "budget")

    @field_validator("amount")
    @classmethod
    def check_amount(cls, v: float) -> float:
        return validate_finite_non_negative(v, "amount")


class WalletItem(BaseModel):
    name: str = Field(..., max_length=200)
    balance: float = Field(default=0.0)

    @field_validator("balance")
    @classmethod
    def check_balance(cls, v: float) -> float:
        import math
        if math.isnan(v) or math.isinf(v):
            raise ValueError("wallet balance must be finite.")
        return v


class SavingsGoalItem(BaseModel):
    name: str = Field(..., max_length=200)
    target: float = Field(default=0.0)
    current: float = Field(default=0.0)
    monthly_target: float = Field(default=0.0)

    @field_validator("target", "current", "monthly_target")
    @classmethod
    def check_finite(cls, v: float) -> float:
        return validate_finite_non_negative(v, "goal value")


class FinancialSummary(BaseModel):
    income: float = Field(..., description="Monthly income")
    expense: float = Field(..., description="Monthly expense")
    previous_month_expense: Optional[float] = Field(default=None)
    categories: List[CategoryItem] = Field(default_factory=list)
    wallets: List[WalletItem] = Field(default_factory=list)
    savings_goals: List[SavingsGoalItem] = Field(default_factory=list)
    user_id: Optional[str] = Field(default="user_local")
    month: Optional[str] = Field(default="2026-09")

    @field_validator("income")
    @classmethod
    def check_income(cls, v: float) -> float:
        return validate_finite_non_negative(v, "income")

    @field_validator("expense")
    @classmethod
    def check_expense(cls, v: float) -> float:
        return validate_finite_non_negative(v, "expense")


class AdvisorRequest(BaseModel):
    financial_summary: FinancialSummary
    classification: Optional[Dict[str, Any]] = Field(default=None, description="Optional output from /classify")
    forecast: Optional[Dict[str, Any]] = Field(default=None, description="Optional output from /forecast")
    risk: Optional[Dict[str, Any]] = Field(default=None, description="Optional output from /risk")
    preferred_version: Optional[str] = Field(default=None, description="Preferred model version (e.g. 'v3' or 'v2')")
    canary: Optional[bool] = Field(default=None, description="Whether request is in canary cohort")


from ai_service.schemas.common import validate_finite_non_negative, ResponseMetadata


class AdvisorResponse(BaseModel):
    summary: str
    warnings: List[str]
    suggestions: List[str]
    confidence: float
    model_version: str = "v3"
    health_grade: Optional[str] = None
    risk_score: Optional[float] = None
    advisory: bool = True
    meta: Optional[ResponseMetadata] = None
