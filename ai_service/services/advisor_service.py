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


def apply_advisor_hardening_policy(
    profile: Dict[str, Any],
    res: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Enforce realistic financial reasoning and uncertainty guardrails:
    - If data is sparse or missing: "Chưa đủ dữ liệu để đưa ra khuyến nghị đáng tin cậy".
    - If lumpy expense with large liquid savings cushion: avoid false CRITICAL panic.
    - If sabbatical with long runway: recognize planned burn rate.
    - If high earner with lifestyle inflation: warn about thin reserve cushion.
    - All outputs remain strictly advisory-only.
    """
    income = float(profile.get("income", 0.0))
    expense = float(profile.get("expense", 0.0))
    categories = profile.get("categories", [])
    wallets = profile.get("wallets", [])

    total_wallet = sum(float(w.get("balance", 0.0)) for w in wallets)
    reserve_months = (total_wallet / expense) if expense > 0 else 0.0
    net_flow = income - expense

    # 1. Zero data / Cold start
    if income <= 0 and expense <= 0:
        return {
            "summary": "Chưa ghi nhận dữ liệu thu chi trong kỳ. Hãy bắt đầu ghi chép các giao dịch hàng ngày để AI phân tích sức khỏe tài chính cho bạn.",
            "warnings": [],
            "suggestions": [
                "Bắt đầu ghi chép các khoản chi tiêu đầu tiên trong tháng để xây dựng thói quen tài chính tốt.",
                "Thiết lập ngân sách dự kiến cho các danh mục thiết yếu như Ăn uống, Đi lại và Hóa đơn.",
            ],
            "confidence": 0.50,
            "health_grade": "HEALTHY",
            "risk_score": 0.0,
        }

    # 2. Sparse input (missing categories AND missing wallets)
    if (not categories or len(categories) == 0) and (not wallets or len(wallets) == 0):
        if expense > income:
            diff = expense - income
            return {
                "summary": f"Cảnh báo thâm hụt: Chi tiêu {expense:,.0f}đ vượt thu nhập {income:,.0f}đ (thâm hụt {diff:,.0f}đ). Chưa đủ dữ liệu danh mục và ví để đưa ra khuyến nghị tối ưu chuyên sâu.",
                "warnings": [
                    "Thu không đủ chi: Bạn đang chi tiêu vượt thu nhập trong kỳ.",
                    "Dữ liệu chưa đầy đủ: Cần bổ sung danh mục và số dư ví để phân tích chính xác.",
                ],
                "suggestions": [
                    "Cắt giảm các khoản chi không cấp thiết để cân bằng dòng tiền.",
                    "Thêm thông tin ví và danh mục để AI phân tích cơ cấu chi tiêu cụ thể.",
                ],
                "confidence": 0.45,
                "health_grade": "CRITICAL",
                "risk_score": 0.70,
            }
        elif income > 0:
            return {
                "summary": f"Ghi nhận dòng tiền thặng dư ({income - expense:,.0f}đ). Tuy nhiên chưa đủ dữ liệu danh mục và ví để đưa ra khuyến nghị đáng tin cậy.",
                "warnings": ["Thiếu thông tin phân loại danh mục và số dư ví."],
                "suggestions": ["Cập nhật thêm số dư ví và danh mục để AI đánh giá mức độ an toàn quỹ dự phòng."],
                "confidence": 0.45,
                "health_grade": "CAUTION",
                "risk_score": 0.30,
            }
        else:
            return {
                "summary": "Chưa đủ dữ liệu để đưa ra khuyến nghị đáng tin cậy. Vui lòng ghi chép thêm chi tiêu và thiết lập ví/danh mục để AI phân tích chính xác hơn.",
                "warnings": ["Dữ liệu tài chính chưa hoàn thiện: Thiếu thông tin phân loại danh mục và số dư ví."],
                "suggestions": [
                    "Tạo các danh mục chi tiêu chính (Ăn uống, Nhà cửa, Hóa đơn) để theo dõi cơ cấu ngân sách.",
                    "Cập nhật số dư ví tài khoản để hệ thống ước tính quỹ dự phòng khẩn cấp.",
                ],
                "confidence": 0.35,
                "health_grade": "CAUTION",
                "risk_score": 0.40,
            }

    # 3. Lumpy one-off expense cushioned by large savings (>= 3 months reserve)
    if expense > income and reserve_months >= 3.0:
        adjusted_res = dict(res)
        adjusted_res["health_grade"] = "CAUTION"
        adjusted_res["risk_score"] = min(float(res.get("risk_score", 0.5)), 0.45)
        adjusted_res["confidence"] = min(float(res.get("confidence", 0.8)), 0.85)
        cushion_note = f"Khoản chi tiêu tăng đột biến trong kỳ ({expense:,.0f}đ so với thu nhập {income:,.0f}đ), tuy nhiên bạn có quỹ dự phòng tốt ({total_wallet:,.0f}đ, tương đương {reserve_months:.1f} tháng chi tiêu) giúp hấp thụ biến động an toàn."
        adjusted_res["summary"] = cushion_note + " Khuyến nghị: Duy trì nhịp chi tiêu bình thường trong các tháng tới để tái tích lũy quỹ dự phòng."
        adjusted_res["warnings"] = [w for w in res.get("warnings", []) if "khẩn cấp" not in w.lower() and "suy giảm tài chính" not in w.lower()]
        adjusted_res["warnings"].append(f"Dòng tiền âm trong tháng: -{abs(net_flow):,.0f}đ (được đệm an toàn bởi quỹ dự phòng).")
        return adjusted_res

    # 4. Sabbatical / Career break with substantial savings cushion (>= 6 months reserve)
    if income == 0 and expense > 0 and reserve_months >= 6.0:
        adjusted_res = dict(res)
        adjusted_res["health_grade"] = "CAUTION"
        adjusted_res["risk_score"] = min(float(res.get("risk_score", 0.5)), 0.40)
        adjusted_res["confidence"] = 0.80
        adjusted_res["summary"] = f"Giai đoạn tạm dừng thu nhập (Sabbatical/Nghỉ ngơi): Chi tiêu {expense:,.0f}đ/tháng với quỹ dự phòng {total_wallet:,.0f}đ (đủ trang trải {reserve_months:.1f} tháng). Tình trạng tài chính được kiểm soát tốt."
        adjusted_res["suggestions"] = ["Theo dõi tốc độ tiêu dùng (burn rate) hàng tháng để đảm bảo quỹ dự phòng kéo dài đúng kế hoạch."]
        return adjusted_res

    # 5. High earner with lifestyle inflation and near-zero cushion (< 0.5 months)
    if income >= 50000000.0 and reserve_months < 0.5 and net_flow < income * 0.10:
        adjusted_res = dict(res)
        adjusted_res["health_grade"] = "CAUTION"
        adjusted_res["risk_score"] = max(float(res.get("risk_score", 0.3)), 0.55)
        current_warnings = list(res.get("warnings", []))
        if not any("lối sống" in w for w in current_warnings):
            current_warnings.append("Nguy cơ lạm phát lối sống: Thu nhập cao nhưng tỷ lệ tích lũy mỏng và quỹ dự phòng dưới 0.5 tháng.")
        adjusted_res["warnings"] = current_warnings
        return adjusted_res

    return res


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

    # Apply realistic scenario and uncertainty guardrails
    res = apply_advisor_hardening_policy(profile, res)

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
