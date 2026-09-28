"""
model_advisor/scripts/generate_ood_testset.py
============================================
Generate 120 Out-Of-Distribution (OOD) and challenging edge cases for model_advisor:
- Income ~= Expense (break-even, net_flow ~ 0)
- Multiple overlapping / conflicting budgets
- Missing values / empty lists (no wallets, no categories, no savings goals)
- Unusually high income (> 500M VND)
- Unusually low income (< 3M VND)
- Mixed risk signals (e.g. high income + zero savings, or negative flow + huge wallet)
- Contradictory signals (e.g. 50% savings rate but critical overbudget in food)
- No budgets set (all budget = 0)
- Zero income with positive expenses
- Zero expenses with positive income
- Irregular/surge spending

Outputs:
    model_advisor/tests/out_of_distribution.jsonl
"""

import json
import random
from pathlib import Path

# Deterministic seed
random.seed(1337)

TESTS_DIR = Path(__file__).resolve().parent.parent / "tests"
OUTPUT_FILE = TESTS_DIR / "out_of_distribution.jsonl"


def generate_ood_cases():
    cases = []
    case_id = 1

    # 1. Break-even cases (Income ~= Expense, net flow within +/- 100,000 VND) - 15 cases
    for i in range(15):
        inc = random.randint(12_000_000, 35_000_000)
        diff = random.randint(-150_000, 150_000)
        exp = inc + diff
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "break_even_cashflow",
            "income": float(inc),
            "expense": float(exp),
            "previous_month_expense": float(exp * random.uniform(0.95, 1.05)),
            "wallets": [{"name": "Ví chính", "balance": float(inc * random.uniform(0.5, 2.0))}],
            "savings_goals": [{"name": "Quỹ dự phòng", "target": float(inc * 3), "current": float(inc * 0.8), "monthly_target": 1_000_000.0}],
            "categories": [
                {"name": "Ăn uống gia đình", "kind": "expense", "budget": float(exp * 0.4), "amount": float(exp * 0.42)},
                {"name": "Thuê nhà & Nhà ở", "kind": "expense", "budget": float(exp * 0.35), "amount": float(exp * 0.35)},
                {"name": "Tiện ích & Khác", "kind": "expense", "budget": float(exp * 0.25), "amount": float(exp * 0.23)},
            ]
        })
        case_id += 1

    # 2. Extreme Income Outliers: Very high (> 500M VND) & Very low (< 3M VND) - 15 cases
    # High income
    for i in range(8):
        inc = random.randint(500_000_000, 1_500_000_000)
        exp = random.randint(80_000_000, 250_000_000)
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "extreme_high_income",
            "income": float(inc),
            "expense": float(exp),
            "previous_month_expense": float(exp * 0.9),
            "wallets": [{"name": "Private Banking", "balance": float(inc * 4)}],
            "savings_goals": [{"name": "Bất động sản nghỉ dưỡng", "target": 5_000_000_000.0, "current": 2_000_000_000.0, "monthly_target": 100_000_000.0}],
            "categories": [
                {"name": "Sinh hoạt gia đình", "kind": "expense", "budget": float(exp * 0.4), "amount": float(exp * 0.35)},
                {"name": "Du lịch & Giải trí hạng sang", "kind": "expense", "budget": float(exp * 0.4), "amount": float(exp * 0.45)},
            ]
        })
        case_id += 1

    # Low income (< 3M VND)
    for i in range(7):
        inc = random.randint(1_500_000, 2_900_000)
        exp = random.randint(2_200_000, 3_800_000)
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "extreme_low_income_student_or_subsidized",
            "income": float(inc),
            "expense": float(exp),
            "previous_month_expense": float(exp),
            "wallets": [{"name": "Tiền mặt sinh viên", "balance": 500_000.0}],
            "savings_goals": [],
            "categories": [
                {"name": "Ăn uống bình dân", "kind": "expense", "budget": 1_800_000.0, "amount": float(exp * 0.65)},
                {"name": "Trọ ghép", "kind": "expense", "budget": 1_000_000.0, "amount": float(exp * 0.35)},
            ]
        })
        case_id += 1

    # 3. Mixed / Contradictory signals: High income but zero emergency fund (< 0.1 month) - 15 cases
    for i in range(15):
        inc = random.randint(40_000_000, 90_000_000)
        exp = random.randint(38_000_000, 88_000_000)
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "high_earner_zero_reserve_lifestyle_inflation",
            "income": float(inc),
            "expense": float(exp),
            "previous_month_expense": float(exp * 0.8),
            "wallets": [{"name": "Tài khoản thanh toán", "balance": random.randint(100_000, 1_500_000)}], # < 0.05 month!
            "savings_goals": [],
            "categories": [
                {"name": "Ăn uống nhà hàng & Bar", "kind": "expense", "budget": 15_000_000.0, "amount": 22_000_000.0},
                {"name": "Mua sắm hàng hiệu", "kind": "expense", "budget": 10_000_000.0, "amount": 18_000_000.0},
                {"name": "Căn hộ cao cấp", "kind": "expense", "budget": 15_000_000.0, "amount": 15_000_000.0},
            ]
        })
        case_id += 1

    # 4. Mixed / Contradictory signals: Negative cashflow this month but huge existing wallet reserve (> 24 months) - 15 cases
    for i in range(15):
        inc = random.randint(15_000_000, 30_000_000)
        exp = inc * random.uniform(1.3, 2.0) # Deficit!
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "temporary_lumpy_expense_with_huge_cushion",
            "income": float(inc),
            "expense": float(exp),
            "previous_month_expense": float(inc * 0.6), # Normal month was low
            "wallets": [{"name": "Sổ tiết kiệm dự phòng", "balance": float(exp * random.randint(15, 30))}],
            "savings_goals": [{"name": "Quỹ hưu trí", "target": 1_000_000_000.0, "current": 400_000_000.0, "monthly_target": 5_000_000.0}],
            "categories": [
                {"name": "Sửa chữa nhà cửa đột xuất", "kind": "expense", "budget": 5_000_000.0, "amount": float(exp * 0.6)},
                {"name": "Sinh hoạt cơ bản", "kind": "expense", "budget": float(inc * 0.5), "amount": float(inc * 0.5)},
            ]
        })
        case_id += 1

    # 5. Missing values & Empty lists (Zero budgets, no wallets, no goals, no categories) - 20 cases
    # No categories set
    for i in range(5):
        inc = float(random.randint(15_000_000, 25_000_000))
        exp = float(random.randint(10_000_000, 18_000_000))
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "missing_categories_empty_breakdown",
            "income": inc,
            "expense": exp,
            "wallets": [{"name": "Ví", "balance": inc * 2}],
            "savings_goals": [],
            "categories": []
        })
        case_id += 1

    # No wallets set (wallets = [])
    for i in range(5):
        inc = float(random.randint(15_000_000, 25_000_000))
        exp = float(random.randint(10_000_000, 18_000_000))
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "missing_wallets_empty_balances",
            "income": inc,
            "expense": exp,
            "wallets": [],
            "savings_goals": [],
            "categories": [{"name": "Tổng chi tiêu", "kind": "expense", "budget": 0.0, "amount": exp}]
        })
        case_id += 1

    # Zero budgets on all categories (budget = 0.0)
    for i in range(5):
        inc = float(random.randint(18_000_000, 30_000_000))
        exp = float(random.randint(12_000_000, 20_000_000))
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "unbudgeted_user_all_zero_budgets",
            "income": inc,
            "expense": exp,
            "wallets": [{"name": "Ví chính", "balance": inc}],
            "savings_goals": [],
            "categories": [
                {"name": "Ăn uống", "kind": "expense", "budget": 0.0, "amount": exp * 0.5},
                {"name": "Mua sắm", "kind": "expense", "budget": 0.0, "amount": exp * 0.3},
                {"name": "Đi lại", "kind": "expense", "budget": 0.0, "amount": exp * 0.2},
            ]
        })
        case_id += 1

    # Zero income edge cases (e.g. unemployed or sabbatical)
    for i in range(5):
        exp = float(random.randint(6_000_000, 15_000_000))
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "zero_income_sabbatical",
            "income": 0.0,
            "expense": exp,
            "wallets": [{"name": "Quỹ tích lũy", "balance": exp * random.uniform(0.5, 4.0)}],
            "savings_goals": [],
            "categories": [
                {"name": "Sinh hoạt", "kind": "expense", "budget": exp, "amount": exp}
            ]
        })
        case_id += 1

    # 6. Budget overlap and massive overbudget (all categories > 200% overbudget) - 15 cases
    for i in range(15):
        inc = float(random.randint(20_000_000, 40_000_000))
        budget_allocated = inc * 0.7
        actual_spent = budget_allocated * random.uniform(2.0, 3.5)
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "massive_overbudget_runaway_spending",
            "income": inc,
            "expense": actual_spent,
            "wallets": [{"name": "Ví", "balance": 1_000_000.0}],
            "savings_goals": [],
            "categories": [
                {"name": "Ăn ngoài & Cafe", "kind": "expense", "budget": budget_allocated * 0.3, "amount": budget_allocated * 0.9},
                {"name": "Mua sắm & Quần áo", "kind": "expense", "budget": budget_allocated * 0.4, "amount": budget_allocated * 1.2},
                {"name": "Giải trí & Du lịch", "kind": "expense", "budget": budget_allocated * 0.3, "amount": budget_allocated * 0.8},
            ]
        })
        case_id += 1

    # 7. Zero expense cases (total frugality or passive corporate expensed) - 10 cases
    for i in range(10):
        inc = float(random.randint(15_000_000, 40_000_000))
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "zero_expense_fully_saved",
            "income": inc,
            "expense": 0.0,
            "wallets": [{"name": "Ví", "balance": inc * 5}],
            "savings_goals": [{"name": "Tích lũy", "target": 100_000_000.0, "current": 50_000_000.0, "monthly_target": inc}],
            "categories": []
        })
        case_id += 1

    # 8. Contradictory signals: High savings rate (> 50%) but 1 essential category severely overbudget - 15 cases
    for i in range(15):
        inc = float(random.randint(30_000_000, 60_000_000))
        exp = inc * 0.4 # 60% savings rate!
        cases.append({
            "id": f"ood_{case_id:03d}",
            "scenario": "high_savings_rate_with_isolated_overbudget",
            "income": inc,
            "expense": exp,
            "wallets": [{"name": "Ví chính", "balance": inc * 3}],
            "savings_goals": [{"name": "Đầu tư", "target": 200_000_000.0, "current": 80_000_000.0, "monthly_target": 15_000_000.0}],
            "categories": [
                {"name": "Ăn uống gia đình", "kind": "expense", "budget": 3_000_000.0, "amount": 7_500_000.0}, # Over by 4.5M!
                {"name": "Tiện ích & Khác", "kind": "expense", "budget": exp - 7_500_000.0, "amount": exp - 7_500_000.0},
            ]
        })
        case_id += 1

    return cases


def main():
    cases = generate_ood_cases()
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    print(f"✔ Generated {len(cases)} OOD / Edge test cases to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
