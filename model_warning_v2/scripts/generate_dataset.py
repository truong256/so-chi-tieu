"""
model_warning_v2/scripts/generate_dataset.py
============================================
Generate benchmark personal finance transactions with risk/fraud labels:
- Strict Pre-Split: RAW DATA is generated and split into Train, Val, Test BEFORE any feature engineering.
- Group Split by user_id and card_id:
    * Train cards/users DO NOT overlap with Test cards/users.
    * Guarantees evaluation tests true card-level and user-level generalization.
- Features generated in raw schema:
    * Users: user_id, credit_score, yearly_income, current_age, gender
    * Cards: card_id, user_id, credit_limit, card_brand, card_type, has_chip, card_on_dark_web
    * Transactions: id, client_id, card_id, date, hour, day_of_week, month,
                    transaction_amount, mcc, use_chip, errors, is_fraud
- Realistic fraud patterns:
    * Online purchases on dark-web leaked cards
    * High amount-to-limit ratio (> 0.85)
    * Abnormal amounts far exceeding normal baseline
    * High-risk MCCs (crypto, jewelry, online betting, electronics)
    * Late-night anomalies (2 AM - 4 AM)
    * Error-prone rapid attempts
- Outputs:
    * data/raw_train.json (~12,000 txns)
    * data/raw_val.json (~3,000 txns)
    * data/raw_test.json (~3,000 txns)
"""

import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Tuple

random.seed(42)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


HIGH_RISK_MCCS = [5732, 5944, 7995, 6051, 4829]  # Electronics, Jewelry, Betting, Crypto, Wire
NORMAL_MCCS = [5411, 5812, 5814, 5541, 5912, 5311, 4121, 4900]  # Groceries, Dining, Fast food, Gas, Pharmacy, Dept, Taxi, Utilities
CARD_BRANDS = ["Visa", "Mastercard", "JCB", "American Express"]
CARD_TYPES = ["Debit", "Credit", "Prepaid"]


def generate_users_and_cards(num_users: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    users = []
    cards = []
    card_id_counter = 1

    for u_idx in range(1, num_users + 1):
        user_id = f"user_{u_idx:04d}"
        credit_score = int(random.gauss(680, 75))
        credit_score = max(350, min(850, credit_score))
        yearly_income = max(60000000.0, random.lognormvariate(18.6, 0.45))
        yearly_income = round(yearly_income / 1000000.0) * 1000000.0
        current_age = random.randint(20, 65)
        gender = random.choice(["Male", "Female"])

        users.append({
            "id": user_id,
            "credit_score": credit_score,
            "yearly_income": yearly_income,
            "current_age": current_age,
            "gender": gender,
            # Typical baseline spending per transaction for this user
            "baseline_amount": random.uniform(150000.0, 650000.0),
        })

        # Each user has 1 to 3 cards
        num_cards = random.choices([1, 2, 3], weights=[0.6, 0.3, 0.1])[0]
        for _ in range(num_cards):
            card_id = f"card_{card_id_counter:05d}"
            card_id_counter += 1
            brand = random.choice(CARD_BRANDS)
            ctype = random.choice(CARD_TYPES)
            limit = random.choice([15000000.0, 30000000.0, 50000000.0, 100000000.0, 200000000.0]) if ctype == "Credit" else 50000000.0
            has_chip = random.choices(["YES", "NO"], weights=[0.88, 0.12])[0]
            dark_web = random.choices(["Yes", "No"], weights=[0.05, 0.95])[0]

            cards.append({
                "id": card_id,
                "client_id": user_id,
                "credit_limit": limit,
                "card_brand": brand,
                "card_type": ctype,
                "has_chip": has_chip,
                "card_on_dark_web": dark_web,
            })

    return users, cards


def generate_transactions_for_users(
    users: List[Dict[str, Any]],
    cards: List[Dict[str, Any]],
    target_txns: int,
    base_fraud_rate: float = 0.065,
) -> List[Dict[str, Any]]:
    cards_by_user = {}
    for c in cards:
        cards_by_user.setdefault(c["client_id"], []).append(c)

    user_map = {u["id"]: u for u in users}
    transactions = []
    txn_id_counter = 1

    start_date = datetime(2025, 1, 1)

    while len(transactions) < target_txns:
        user = random.choice(users)
        user_cards = cards_by_user[user["id"]]
        card = random.choice(user_cards)

        dt = start_date + timedelta(
            days=random.randint(0, 365),
            hours=random.randint(0, 23),
            minutes=random.randint(0, 59),
        )

        is_dark_web = (card["card_on_dark_web"] == "Yes")
        # Probability of fraud on this attempt
        fraud_prob = base_fraud_rate
        if is_dark_web:
            fraud_prob += 0.35

        is_fraud = 1 if random.random() < fraud_prob else 0

        # Features influenced by fraud status
        if is_fraud:
            # Fraud characteristics
            mcc = random.choice(HIGH_RISK_MCCS)
            use_chip = random.choice(["Online Transaction", "Online Transaction", "Swipe Transaction"])
            # Abnormal transaction amount: either huge spike or close to credit limit
            if random.random() < 0.6:
                amount = random.uniform(user["baseline_amount"] * 6.0, user["baseline_amount"] * 25.0)
            else:
                amount = random.uniform(card["credit_limit"] * 0.75, card["credit_limit"] * 0.98)
            hour = random.choice([1, 2, 3, 4, 23, 14, 15])  # higher night probability
            errors = random.choice([None, "Bad PIN", "Insufficient Funds", "PIN Retry Exceeded"]) if random.random() < 0.3 else None
        else:
            # Normal characteristics
            mcc = random.choice(NORMAL_MCCS)
            use_chip = random.choice(["Chip Transaction", "Chip Transaction", "Online Transaction", "Swipe Transaction"])
            amount = max(20000.0, random.gauss(user["baseline_amount"], user["baseline_amount"] * 0.35))
            hour = random.choices(
                list(range(24)),
                weights=[1, 1, 1, 1, 1, 2, 4, 7, 9, 10, 11, 12, 10, 9, 8, 8, 9, 10, 11, 9, 7, 5, 3, 2]
            )[0]
            errors = random.choice(["Bad CVV", "Bad Expiration"]) if random.random() < 0.02 else None

        amount = round(amount / 1000.0) * 1000.0

        transactions.append({
            "id": f"txn_{txn_id_counter:07d}",
            "client_id": user["id"],
            "card_id": card["id"],
            "date": dt.strftime("%Y-%m-%d"),
            "hour": hour,
            "day_of_week": dt.weekday(),
            "month": dt.month,
            "transaction_amount": amount,
            "mcc": mcc,
            "use_chip": use_chip,
            "errors": errors,
            "is_fraud": is_fraud,
            # Joined card features
            "credit_limit": card["credit_limit"],
            "card_brand": card["card_brand"],
            "card_type": card["card_type"],
            "has_chip": card["has_chip"],
            "card_on_dark_web": card["card_on_dark_web"],
            # Joined user features
            "credit_score": user["credit_score"],
            "yearly_income": user["yearly_income"],
            "current_age": user["current_age"],
            "gender": user["gender"],
        })
        txn_id_counter += 1

    return transactions


def main():
    print("=" * 80)
    print("      GENERATING GROUP-SPLIT DATASETS FOR MODEL_WARNING V2")
    print("=" * 80)

    # 1. Generate 500 users and their cards
    total_users = 500
    all_users, all_cards = generate_users_and_cards(total_users)

    # 2. Strict Group Split by User and Card:
    # 70% Train Users, 15% Val Users, 15% Test Users
    # Guaranteeing ZERO card/user overlap between Train and Test!
    random.shuffle(all_users)
    n_train_users = int(total_users * 0.70)
    n_val_users = int(total_users * 0.15)

    train_users = all_users[:n_train_users]
    val_users = all_users[n_train_users:n_train_users + n_val_users]
    test_users = all_users[n_train_users + n_val_users:]

    train_user_ids = {u["id"] for u in train_users}
    val_user_ids = {u["id"] for u in val_users}
    test_user_ids = {u["id"] for u in test_users}

    train_cards = [c for c in all_cards if c["client_id"] in train_user_ids]
    val_cards = [c for c in all_cards if c["client_id"] in val_user_ids]
    test_cards = [c for c in all_cards if c["client_id"] in test_user_ids]

    # Verify zero overlap
    assert len(train_user_ids.intersection(test_user_ids)) == 0, "Leakage: User overlap detected!"
    assert len({c["id"] for c in train_cards}.intersection({c["id"] for c in test_cards})) == 0, "Leakage: Card overlap detected!"
    print("✔ Verified 0% user overlap and 0% card overlap between Train and Test.")

    # 3. Generate Transactions independently per group
    train_txns = generate_transactions_for_users(train_users, train_cards, target_txns=12000)
    val_txns = generate_transactions_for_users(val_users, val_cards, target_txns=3000)
    test_txns = generate_transactions_for_users(test_users, test_cards, target_txns=3000)

    # Save raw split files
    with open(DATA_DIR / "raw_train.json", "w", encoding="utf-8") as f:
        json.dump(train_txns, f, indent=2)
    with open(DATA_DIR / "raw_val.json", "w", encoding="utf-8") as f:
        json.dump(val_txns, f, indent=2)
    with open(DATA_DIR / "raw_test.json", "w", encoding="utf-8") as f:
        json.dump(test_txns, f, indent=2)

    train_fraud = sum(t["is_fraud"] for t in train_txns)
    val_fraud = sum(t["is_fraud"] for t in val_txns)
    test_fraud = sum(t["is_fraud"] for t in test_txns)

    print(f"\nDatasets created successfully:")
    print(f"  • Train: {len(train_txns):,} txns | Users: {len(train_users)} | Cards: {len(train_cards)} | Fraud: {train_fraud} ({train_fraud/len(train_txns):.2%})")
    print(f"  • Val:   {len(val_txns):,} txns | Users: {len(val_users)} | Cards: {len(val_cards)} | Fraud: {val_fraud} ({val_fraud/len(val_txns):.2%})")
    print(f"  • Test:  {len(test_txns):,} txns | Users: {len(test_users)} | Cards: {len(test_cards)} | Fraud: {test_fraud} ({test_fraud/len(test_txns):.2%})")
    print("=" * 80)


if __name__ == "__main__":
    main()
