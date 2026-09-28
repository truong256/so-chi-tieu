"""
ai_service/services/advisor_service.py
======================================
Service logic for personal financial advisor:
- Primary: model_advisor (Softmax MLP + Ridge Regressor + Calibrated Vietnamese synthesis).
- Fallback: Deterministic financial rules engine.
- Telemetry & Metadata: Structured logging and response envelope metadata.
"""

import time
import logging
from typing import Dict, Any, List

from ai_service.config import AI_V3_CANARY_PERCENT, get_canary_decision
from ai_service.loaders.model_loader import ModelContainer
from ai_service.schemas.advisor import AdvisorRequest, AdvisorResponse
from ai_service.schemas.common import ResponseMetadata
from ai_service.observability import log_inference_event

logger = logging.getLogger("ai_service.advisor")


def _deterministic_advisor_fallback(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Heuristic rule-based fallback when ML engine fails."""
    income = float(profile.get("income", 0.0))
    expense = float(profile.get("expense", 0.0))
    net = income - expense
    savings_rate = net / income if income > 0 else 0.0

    warnings = []
    suggestions = []

    if income <= 0 and expense <= 0:
        health_grade = "HEALTHY"
        risk_score = 0.0
        conf = 0.50
        summary = "Chưa ghi nhận dữ liệu thu chi. Hãy bắt đầu ghi chép để nhận đánh giá chi tiết."
    elif expense > income:
        health_grade = "CRITICAL"
        risk_score = 0.85
        conf = 0.70
        summary = f"Cảnh báo thâm hụt: Chi tiêu {expense:,.0f}đ vượt thu nhập {income:,.0f}đ ({abs(net):,.0f}đ)."
        warnings.append("Thu không đủ chi: Bạn đang chi tiêu vượt thu nhập.")
        suggestions.append("Cắt giảm ngay các khoản chi không thiết yếu để tránh thâm hụt kéo dài.")
    else:
        health_grade = "HEALTHY"
        risk_score = 0.25
        conf = 0.75
        summary = f"Tài chính ổn định: Thu nhập {income:,.0f}đ, chi tiêu {expense:,.0f}đ. Tỷ lệ tiết kiệm {savings_rate:.1%}."
        suggestions.append("Duy trì tỷ lệ tích lũy và chuyển phần thặng dư vào quỹ dự phòng.")

    return {
        "summary": summary,
        "warnings": warnings,
        "suggestions": suggestions,
        "confidence": conf,
        "health_grade": health_grade,
        "risk_score": risk_score,
    }


def run_advisor(request: AdvisorRequest) -> AdvisorResponse:
    t0 = time.perf_counter()
    container = ModelContainer.get_instance()

    summary_dict = request.financial_summary.model_dump()
    profile = {
        "income": summary_dict["income"],
        "expense": summary_dict["expense"],
        "previous_month_expense": summary_dict.get("previous_month_expense") or summary_dict["expense"],
        "categories": summary_dict.get("categories", []),
        "wallets": summary_dict.get("wallets", []),
        "savings_goals": summary_dict.get("savings_goals", []),
        "user_id": summary_dict.get("user_id", "user_local"),
        "month": summary_dict.get("month", "2026-09"),
    }

    is_canary = False
    if request.canary is not None:
        is_canary = bool(request.canary)
    elif AI_V3_CANARY_PERCENT > 0:
        is_canary, _, _ = get_canary_decision(profile["user_id"])

    fallback_used = False
    active_version = "v3"
    res = None

    if container.advisor_engine is not None:
        try:
            res = container.advisor_engine.predict(profile)
        except Exception as e:
            logger.warning(f"Advisor engine execution failed: {e}. Using deterministic fallback...", exc_info=True)
            res = None

    if res is None:
        res = _deterministic_advisor_fallback(profile)
        fallback_used = True
        active_version = "rule_fallback"

    warnings: List[str] = list(res.get("warnings", []))
    suggestions: List[str] = list(res.get("suggestions", []))

    # Augment with auxiliary risk information if approved/available
    if request.risk and isinstance(request.risk, dict) and request.risk.get("available") is not False:
        risk_level = request.risk.get("risk_level")
        if risk_level in ["DANGER", "WARNING"]:
            warnings.append(f"Cảnh báo bảo mật phụ trợ: Phát hiện giao dịch nghi vấn mức độ {risk_level}.")

    # Augment with forecast information if approved/available
    if request.forecast and isinstance(request.forecast, dict) and request.forecast.get("available") is not False:
        forecast_items = request.forecast.get("forecast", [])
        if forecast_items and isinstance(forecast_items, list):
            total_predicted_spending = sum(float(x.get("predicted_spending", 0.0)) for x in forecast_items)
            suggestions.append(f"Dự báo xu hướng: Dự kiến tổng chi 30 ngày tới khoảng {total_predicted_spending:,.0f}đ.")

    total_lat = (time.perf_counter() - t0) * 1000.0
    conf = float(res.get("confidence", 0.85))

    log_inference_event(
        endpoint="/advisor",
        model="advisor",
        version=active_version,
        latency_ms=total_lat,
        success=True,
        fallback_used=fallback_used,
        confidence=conf,
    )

    return AdvisorResponse(
        summary=res["summary"],
        warnings=warnings,
        suggestions=suggestions,
        confidence=conf,
        model_version=active_version,
        health_grade=res.get("health_grade"),
        risk_score=res.get("risk_score"),
        advisory=True,
        meta=ResponseMetadata(
            model="advisor",
            version=active_version,
            latency_ms=round(total_lat, 2),
            fallback_used=fallback_used,
            canary=is_canary,
            advisory=True,
        ),
    )
