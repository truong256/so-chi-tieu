"""
model_advisor/scripts/generate_dataset.py
=========================================
Generates a comprehensive, realistic, and balanced dataset of Vietnamese
personal financial profiles and expert financial advisory ground truth.

Outputs:
  - model_advisor/data/raw/financial_profiles_raw.json (2,000 samples)
  - model_advisor/data/train.json (1,400 samples - 70%)
  - model_advisor/data/val.json (300 samples - 15%)
  - model_advisor/data/test.json (300 samples - 15%)
"""

import json
import random
from pathlib import Path
from typing import Dict, List, Any

RANDOM_SEED = 42
random.seed(RANDOM_SEED)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
RAW_DIR = DATA_DIR / "raw"

# Category templates by financial bucket (50/30/20 standard)
NEEDS_CATEGORIES = [
    {"name": "Ăn uống gia đình", "kind": "expense", "budget_ratio": 0.25},
    {"name": "Thuê nhà & Nhà ở", "kind": "expense", "budget_ratio": 0.22},
    {"name": "Đi lại & Xăng xe", "kind": "expense", "budget_ratio": 0.08},
    {"name": "Tiện ích (Điện, Nước, Net)", "kind": "expense", "budget_ratio": 0.06},
    {"name": "Y tế & Sức khỏe", "kind": "expense", "budget_ratio": 0.04},
]

WANTS_CATEGORIES = [
    {"name": "Ăn ngoài & Cafe", "kind": "expense", "budget_ratio": 0.12},
    {"name": "Mua sắm & Quần áo", "kind": "expense", "budget_ratio": 0.10},
    {"name": "Giải trí & Dịch vụ số", "kind": "expense", "budget_ratio": 0.05},
    {"name": "Làm đẹp & Chăm sóc cá nhân", "kind": "expense", "budget_ratio": 0.04},
    {"name": "Du lịch & Giao lưu bạn bè", "kind": "expense", "budget_ratio": 0.04},
]

SAVINGS_GOALS_TEMPLATES = [
    {"name": "Quỹ khẩn cấp 6 tháng", "target_mult": 4.0, "monthly_ratio": 0.10},
    {"name": "Tích lũy mua xe / nhà", "target_mult": 10.0, "monthly_ratio": 0.15},
    {"name": "Học tập & Nâng cao kỹ năng", "target_mult": 1.5, "monthly_ratio": 0.05},
    {"name": "Quỹ đầu tư dài hạn", "target_mult": 6.0, "monthly_ratio": 0.12},
]


def format_vnd(amount: float) -> str:
    """Format float into Vietnamese currency string."""
    return f"{int(amount):,}đ".replace(",", ".")


def generate_profile(user_idx: int, archetype: str) -> Dict[str, Any]:
    """Generates a consistent financial profile and expert advisory label."""
    # Income brackets (VND)
    income_brackets = [
        random.randint(12_000_000, 20_000_000),
        random.randint(22_000_000, 35_000_000),
        random.randint(38_000_000, 60_000_000),
        random.randint(65_000_000, 100_000_000),
    ]
    income = random.choice(income_brackets)

    categories = []
    warnings = []
    suggestions = []

    # Configure scenario dynamics based on archetype
    if archetype == "CRITICAL":
        # Deficit spending: expense 105% - 145% of income
        expense_ratio = random.uniform(1.05, 1.45)
        wants_factor = random.uniform(1.4, 2.2)
        growth_rate = random.uniform(0.15, 0.40)
        wallet_months = random.uniform(0.1, 0.8)
        health_grade = "CRITICAL"
        risk_score = round(random.uniform(0.75, 0.98), 2)
        confidence = round(random.uniform(0.88, 0.96), 2)
    elif archetype == "CAUTION":
        # Tight budget / near-zero savings: expense 88% - 100% of income
        expense_ratio = random.uniform(0.88, 1.00)
        wants_factor = random.uniform(1.15, 1.5)
        growth_rate = random.uniform(0.08, 0.25)
        wallet_months = random.uniform(0.8, 2.0)
        health_grade = "CAUTION"
        risk_score = round(random.uniform(0.50, 0.74), 2)
        confidence = round(random.uniform(0.85, 0.94), 2)
    elif archetype == "HEALTHY":
        # Good savings: expense 68% - 82% of income
        expense_ratio = random.uniform(0.68, 0.82)
        wants_factor = random.uniform(0.85, 1.05)
        growth_rate = random.uniform(-0.05, 0.08)
        wallet_months = random.uniform(2.5, 5.0)
        health_grade = "HEALTHY"
        risk_score = round(random.uniform(0.20, 0.45), 2)
        confidence = round(random.uniform(0.86, 0.95), 2)
    else:  # EXCELLENT
        # Superior financial discipline: expense 45% - 65% of income
        expense_ratio = random.uniform(0.45, 0.65)
        wants_factor = random.uniform(0.6, 0.85)
        growth_rate = random.uniform(-0.15, 0.02)
        wallet_months = random.uniform(5.5, 12.0)
        health_grade = "EXCELLENT"
        risk_score = round(random.uniform(0.05, 0.19), 2)
        confidence = round(random.uniform(0.90, 0.98), 2)

    total_expense = round(income * expense_ratio, -4)
    previous_month_expense = round(total_expense / (1.0 + growth_rate), -4)

    # Distribute category expenses and budgets
    # Needs
    needs_budget_sum = 0
    needs_spent_sum = 0
    for cat in NEEDS_CATEGORIES:
        budget = round(income * cat["budget_ratio"] * random.uniform(0.95, 1.05), -4)
        spent = round(budget * random.uniform(0.92, 1.12), -4)
        needs_budget_sum += budget
        needs_spent_sum += spent
        categories.append({
            "name": cat["name"],
            "kind": cat["kind"],
            "budget": int(budget),
            "amount": int(spent),
        })

    # Wants
    wants_budget_sum = 0
    wants_spent_sum = 0
    overbudget_wants = []
    for cat in WANTS_CATEGORIES:
        budget = round(income * cat["budget_ratio"] * random.uniform(0.9, 1.1), -4)
        spent = round(budget * wants_factor * random.uniform(0.9, 1.15), -4)
        wants_budget_sum += budget
        wants_spent_sum += spent
        if spent > budget:
            overbudget_wants.append((cat["name"], spent, budget, spent - budget))
        categories.append({
            "name": cat["name"],
            "kind": cat["kind"],
            "budget": int(budget),
            "amount": int(spent),
        })

    # Savings goals & wallets
    goal_template = random.choice(SAVINGS_GOALS_TEMPLATES)
    goal_target = round(income * goal_template["target_mult"], -5)
    monthly_target = round(income * goal_template["monthly_ratio"], -4)
    current_saved = round(min(goal_target, income * wallet_months * 0.7), -4)

    savings_goals = [{
        "name": goal_template["name"],
        "target": int(goal_target),
        "current": int(current_saved),
        "monthly_target": int(monthly_target),
    }]

    total_wallet_balance = round(total_expense * wallet_months, -4)
    wallets = [
        {"name": "Tài khoản thanh toán", "balance": int(round(total_wallet_balance * 0.75, -4))},
        {"name": "Tiền mặt / Ví phụ", "balance": int(round(total_wallet_balance * 0.25, -4))},
    ]

    net_cash_flow = income - total_expense
    savings_rate = round((net_cash_flow / income) * 100, 1)

    # -------------------------------------------------------------------------
    # Expert Advisory Generation
    # -------------------------------------------------------------------------
    if health_grade == "CRITICAL":
        summary = (
            f"Tình hình tài chính trong kỳ ở mức BÁO ĐỘNG ĐỎ: Chi tiêu ({format_vnd(total_expense)}) "
            f"vượt thu nhập ({format_vnd(income)}), thâm hụt ròng {format_vnd(abs(net_cash_flow))}. "
            f"Tỷ lệ thâm hụt đạt {abs(savings_rate)}%, chủ yếu do các khoản chi tiêu tùy ý tăng vọt."
        )
        warnings.append(
            f"Thâm hụt dòng tiền nghiêm trọng: Bạn đang bội chi {format_vnd(abs(net_cash_flow))} trong tháng."
        )
        if overbudget_wants:
            top_over = sorted(overbudget_wants, key=lambda x: x[3], reverse=True)[0]
            warnings.append(
                f"Danh mục '{top_over[0]}' vượt ngân sách {int((top_over[1]/top_over[2]-1)*100)}% "
                f"({format_vnd(top_over[1])} so với định mức {format_vnd(top_over[2])})."
            )
        if wallet_months < 1.0:
            warnings.append(
                f"Quỹ dự phòng khẩn cấp đang ở mức báo động ({wallet_months:.1f} tháng chi tiêu), "
                "không đủ ứng phó rủi ro phát sinh."
            )

        cut_target = format_vnd(round(abs(net_cash_flow) * 0.6, -4))
        suggestions.append(
            f"Kích hoạt ngay chế độ tiết kiệm khẩn cấp: Cắt giảm tối thiểu {cut_target} từ các danh mục ăn ngoài, cafe và mua sắm."
        )
        suggestions.append(
            "Tạm dừng toàn bộ các quyết định mua sắm đồ dùng không thiết yếu trong 30 ngày tới."
        )
        suggestions.append(
            "Rà soát và hủy các dịch vụ thuê bao trực tuyến, gói thành viên định kỳ không tận dụng hết công suất."
        )

    elif health_grade == "CAUTION":
        summary = (
            f"Tình hình tài chính trong kỳ cần CHÚ Ý: Chi tiêu chiếm {int(expense_ratio*100)}% tổng thu nhập, "
            f"dư thặng ròng chỉ đạt {format_vnd(net_cash_flow)} (tỷ lệ tiết kiệm {savings_rate}%). "
            "Biên độ an toàn tài chính còn mỏng trước các biến động chi phí phát sinh."
        )
        if overbudget_wants:
            top_over = sorted(overbudget_wants, key=lambda x: x[3], reverse=True)[0]
            warnings.append(
                f"Danh mục '{top_over[0]}' đã vượt ngân sách {format_vnd(top_over[3])} "
                f"({format_vnd(top_over[1])} / {format_vnd(top_over[2])})."
            )
        if growth_rate > 0.15:
            warnings.append(
                f"Tốc độ tăng trưởng chi tiêu tháng này cao hơn tháng trước {int(growth_rate*100)}%, "
                "có dấu hiệu trôi dạt ngân sách."
            )
        if wallet_months < 2.5:
            warnings.append(
                f"Quỹ dự phòng hiện đạt {wallet_months:.1f} tháng chi phí, cần nâng lên tối thiểu 3 tháng theo tiêu chuẩn an toàn."
            )

        suggestions.append(
            f"Tái cân bằng ngân sách: Giảm chi tiêu danh mục giải trí và mua sắm về đúng hạn mức để bảo đảm dòng tiền dương."
        )
        suggestions.append(
            f"Tự động trích lập tối thiểu {format_vnd(monthly_target)} ngay vào ngày nhận lương để đảm bảo mục tiêu '{goal_template['name']}'."
        )
        suggestions.append(
            "Áp dụng quy tắc trì hoãn 48 giờ trước khi mua sắm các món hàng có giá trị trên 500.000đ."
        )

    elif health_grade == "HEALTHY":
        summary = (
            f"Tình hình tài chính trong kỳ ỔN ĐỊNH VÀ LÀNH MẠNH: Bạn duy trì tỷ lệ tiết kiệm tốt {savings_rate}% "
            f"với thặng dư ròng {format_vnd(net_cash_flow)}. Chi tiêu cơ bản và chi tiêu linh hoạt "
            "nằm trong ngưỡng kiểm soát hợp lý."
        )
        if overbudget_wants and random.random() < 0.4:
            warnings.append(
                f"Lưu ý nhẹ: Danh mục '{overbudget_wants[0][0]}' chạm cận trên ngân sách, cần theo dõi sát trong tuần cuối kỳ."
            )
        suggestions.append(
            f"Duy trì kỷ luật ngân sách hiện tại và chuyển đều đặn {format_vnd(monthly_target)} vào '{goal_template['name']}'."
        )
        suggestions.append(
            "Cân nhắc tìm hiểu các kênh đầu tư tích lũy an toàn (chứng chỉ tiền gửi, quỹ mở) cho phần thặng dư nhàn rỗi."
        )
        suggestions.append(
            "Tối ưu hóa các chi phí cố định (cước viễn thông, thẻ ngân hàng) bằng các chương trình hoàn tiền / ưu đãi gói năm."
        )

    else:  # EXCELLENT
        summary = (
            f"Tình hình tài chính trong kỳ XUẤT SẮC: Tỷ lệ tiết kiệm vượt trội đạt {savings_rate}%, "
            f"thặng dư ròng tích lũy đạt {format_vnd(net_cash_flow)}. Bạn kiểm soát ngân sách rất kỷ luật, "
            f"quỹ dự phòng đạt {wallet_months:.1f} tháng chi phí, tạo nền tảng vững chắc cho tự do tài chính."
        )
        suggestions.append(
            "Phân bổ phần thặng dư vượt kế hoạch vào danh mục tài sản sinh lời trung và dài hạn để gia tăng lãi kép."
        )
        suggestions.append(
            f"Mục tiêu '{goal_template['name']}' đang tiến triển rất khả quan; có thể xem xét nâng mục tiêu hoặc mở rộng quỹ đầu tư mới."
        )
        suggestions.append(
            "Tự thưởng một phần nhỏ (5-10% thặng dư) cho trải nghiệm cá nhân xứng đáng mà không làm ảnh hưởng kế hoạch dài hạn."
        )

    return {
        "user_id": f"user_{user_idx:04d}",
        "period": "2026-09",
        "currency": "VND",
        "income": int(income),
        "expense": int(total_expense),
        "previous_month_expense": int(previous_month_expense),
        "categories": categories,
        "savings_goals": savings_goals,
        "wallets": wallets,
        "ground_truth": {
            "health_grade": health_grade,
            "risk_score": risk_score,
            "confidence": confidence,
            "summary": summary,
            "warnings": warnings,
            "suggestions": suggestions,
        },
    }


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating 2,000 synthetic personal financial profiles...")
    # Archetype distribution: 25% EXCELLENT, 30% HEALTHY, 25% CAUTION, 20% CRITICAL
    archetype_choices = (
        ["EXCELLENT"] * 500
        + ["HEALTHY"] * 600
        + ["CAUTION"] * 500
        + ["CRITICAL"] * 400
    )
    random.shuffle(archetype_choices)

    dataset = []
    for idx, arch in enumerate(archetype_choices, start=1):
        sample = generate_profile(idx, arch)
        dataset.append(sample)

    raw_path = RAW_DIR / "financial_profiles_raw.json"
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False, indent=2)
    print(f"✔ Saved raw dataset: {raw_path} ({len(dataset)} samples)")

    # Split: Train (70% - 1400), Val (15% - 300), Test (15% - 300)
    train_data = dataset[:1400]
    val_data = dataset[1400:1700]
    test_data = dataset[1700:]

    train_path = DATA_DIR / "train.json"
    val_path = DATA_DIR / "val.json"
    test_path = DATA_DIR / "test.json"

    with open(train_path, "w", encoding="utf-8") as f:
        json.dump(train_data, f, ensure_ascii=False, indent=2)
    with open(val_path, "w", encoding="utf-8") as f:
        json.dump(val_data, f, ensure_ascii=False, indent=2)
    with open(test_path, "w", encoding="utf-8") as f:
        json.dump(test_data, f, ensure_ascii=False, indent=2)

    print(f"✔ Saved train set: {train_path} ({len(train_data)} samples)")
    print(f"✔ Saved val set:   {val_path} ({len(val_data)} samples)")
    print(f"✔ Saved test set:  {test_path} ({len(test_data)} samples)")


if __name__ == "__main__":
    main()
