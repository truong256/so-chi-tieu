"""
ai_service/schemas/risk.py
==========================
Request and Response schemas for /risk endpoint.
"""

from typing import List, Optional, Any
from pydantic import BaseModel, Field, field_validator
from ai_service.schemas.common import validate_finite_non_negative, ResponseMetadata


class RiskRequest(BaseModel):
    amount: float = Field(..., description="Transaction amount")
    credit_limit: Optional[float] = Field(default=None, description="Card credit limit if credit card")
    client_id: Optional[str] = Field(default=None, description="User identifier")
    card_id: Optional[str] = Field(default=None, description="Card identifier")
    hour: Optional[int] = Field(default=12, ge=0, le=23, description="Hour of transaction")
    day_of_week: Optional[int] = Field(default=2, ge=0, le=6, description="Day of week (0=Mon, 6=Sun)")
    month: Optional[int] = Field(default=6, ge=1, le=12, description="Month of transaction")
    mcc: int = Field(default=5411, description="Merchant Category Code (e.g. 5411 Grocery, 5732 Electronics)")
    use_chip: str = Field(default="Chip Transaction", description="Swipe, Chip, or Online Transaction")
    card_brand: str = Field(default="Visa", description="Visa, Mastercard, JCB, American Express")
    card_type: str = Field(default="Credit", description="Credit, Debit, Prepaid")
    has_chip: Optional[str] = Field(default="YES", description="YES or NO")
    card_on_dark_web: Optional[str] = Field(default="No", description="Yes or No")
    credit_score: Optional[int] = Field(default=700, ge=300, le=850, description="User credit score")
    yearly_income: Optional[float] = Field(default=None, description="User annual income")
    current_age: Optional[int] = Field(default=35, description="User age")
    gender: Optional[str] = Field(default="Male", description="Male or Female")
    errors: Optional[str] = Field(default=None, description="Transaction error message if any")
    allow_unapproved: bool = Field(default=False, description="Bypass model approval status for testing")
    preferred_version: Optional[str] = Field(default=None, description="Preferred model version (e.g. 'v3' or 'v2')")
    canary: Optional[bool] = Field(default=None, description="Whether request is in canary cohort")

    @field_validator("amount")
    @classmethod
    def check_amount(cls, v: float) -> float:
        return validate_finite_non_negative(v, "amount")

    @field_validator("credit_limit")
    @classmethod
    def check_credit_limit(cls, v: Optional[float]) -> Optional[float]:
        if v is not None:
            return validate_finite_non_negative(v, "credit_limit")
        return v


class RiskResponse(BaseModel):
    risk_score: float
    risk_level: str  # SAFE, WARNING, DANGER
    fraud_probability: float
    risk_indicators: List[str]
    warning: Optional[str] = None
    advisory: bool = True
    meta: Optional[ResponseMetadata] = None
