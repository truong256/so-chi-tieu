"""
model_prediction_v2/scripts/generate_data.py
============================================
Generate realistic temporal daily expense series for Vietnamese personal finance:
- Strict chronological timeline (2023-01-01 to 2026-06-30, 1,277 days).
- Incorporates real-world patterns:
    * Baseline daily living expenses (meals, transit, groceries)
    * Weekly seasonality (Saturday/Sunday higher spending)
    * Monthly recurring cycles (utility bills / rent on 1st-5th)
    * Post-payday discretionary spending (25th-30th)
    * Controlled stochastic noise (strictly positive, non-negative)
- Strict temporal split:
    * Train: 2023-01-01 to 2025-06-30 (912 days)
    * Val:   2025-07-01 to 2025-12-31 (184 days)
    * Test:  2026-01-01 to 2026-06-30 (181 days)
- No look-ahead, zero shuffling.
"""

import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any

random.seed(42)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def simulate_daily_expense(dt: datetime, base_spending: float = 200000.0) -> float:
    # 1. Day of week effect (0=Mon, 6=Sun)
    dow = dt.weekday()
    if dow in (5, 6):  # Weekend
        dow_factor = random.uniform(1.6, 2.4)
    elif dow == 4:  # Friday evening
        dow_factor = random.uniform(1.2, 1.6)
    else:
        dow_factor = random.uniform(0.85, 1.15)

    # 2. Day of month cycle
    dom = dt.day
    dom_factor = 1.0
    if 1 <= dom <= 5:
        # Bills / rent / services period
        dom_factor = random.uniform(1.3, 1.8)
    elif 25 <= dom <= 30:
        # Payday bump
        dom_factor = random.uniform(1.15, 1.45)
    elif 15 <= dom <= 20:
        # Mid-month frugal dip
        dom_factor = random.uniform(0.85, 1.05)

    # 3. Stochastic variation (log-normal positive shock)
    shock = random.lognormvariate(mu=0.0, sigma=0.22)

    # Occasional high expense (appliance, dentist, celebration)
    spike = 0.0
    if random.random() < 0.03:
        spike = random.uniform(500000.0, 1500000.0)

    daily_total = (base_spending * dow_factor * dom_factor * shock) + spike
    # Round to nearest 1,000 VND
    return round(daily_total / 1000.0) * 1000.0


def generate_time_series():
    start_date = datetime(2023, 1, 1)
    end_date = datetime(2026, 6, 30)
    total_days = (end_date - start_date).days + 1

    records: List[Dict[str, Any]] = []
    curr = start_date
    while curr <= end_date:
        amt = simulate_daily_expense(curr)
        records.append({
            "date": curr.strftime("%Y-%m-%d"),
            "daily_spending": amt,
            "day_of_week": curr.weekday(),
            "day_of_month": curr.day,
            "month": curr.month,
            "is_weekend": 1 if curr.weekday() in (5, 6) else 0,
        })
        curr += timedelta(days=1)

    # Strict temporal split
    train_records = [r for r in records if r["date"] <= "2025-06-30"]
    val_records = [r for r in records if "2025-07-01" <= r["date"] <= "2025-12-31"]
    test_records = [r for r in records if r["date"] >= "2026-01-01"]

    with open(DATA_DIR / "full_series.json", "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2)

    with open(DATA_DIR / "train.json", "w", encoding="utf-8") as f:
        json.dump(train_records, f, indent=2)

    with open(DATA_DIR / "val.json", "w", encoding="utf-8") as f:
        json.dump(val_records, f, indent=2)

    with open(DATA_DIR / "test.json", "w", encoding="utf-8") as f:
        json.dump(test_records, f, indent=2)

    print(f"✔ Generated {total_days} total days ({records[0]['date']} to {records[-1]['date']}):")
    print(f"  • Train: {len(train_records)} days ({train_records[0]['date']} to {train_records[-1]['date']})")
    print(f"  • Val:   {len(val_records)} days ({val_records[0]['date']} to {val_records[-1]['date']})")
    print(f"  • Test:  {len(test_records)} days ({test_records[0]['date']} to {test_records[-1]['date']})")


if __name__ == "__main__":
    generate_time_series()
