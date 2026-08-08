export type TransactionType = "income" | "expense";
export type WalletType = "cash" | "bank" | "ewallet";
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";

export type Profile = {
  id: string;
  username: string | null;
  full_name: string;
  currency: string;
  language: "vi" | "en";
};

export type Wallet = {
  id: string;
  user_id: string;
  name: string;
  type: WalletType;
  balance: number;
  currency: string;
  color: string;
  icon: string;
};

export type Category = {
  id: string;
  user_id: string;
  name: string;
  kind: TransactionType;
  parent_id: string | null;
  icon: string;
  color: string;
  is_default: boolean;
};

export type Transaction = {
  id: string;
  user_id: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: string;
  category_id: string | null;
  wallet_id: string | null;
  occurred_at: string;
  note: string;
  receipt_path: string | null;
  recurrence_id: string | null;
};

export type Transfer = {
  id: string;
  user_id: string;
  from_wallet_id: string;
  to_wallet_id: string;
  amount: number;
  occurred_at: string;
  note: string;
};

export type Budget = {
  id: string;
  user_id: string;
  category_id: string | null;
  name: string;
  amount: number;
  period: "weekly" | "monthly" | "yearly";
  period_start: string;
  alert_percent: number;
};

export type SavingsGoal = {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  current_amount: number;
  deadline: string | null;
  color: string;
};

export type RecurringTransaction = {
  id: string;
  user_id: string;
  wallet_id: string | null;
  category_id: string | null;
  title: string;
  amount: number;
  type: TransactionType;
  frequency: Frequency;
  next_run_at: string;
  active: boolean;
  auto_create: boolean;
  note: string;
};

export type ModalState =
  | { kind: "transaction"; item?: Transaction }
  | { kind: "wallet"; item?: Wallet }
  | { kind: "transfer" }
  | { kind: "category"; item?: Category }
  | { kind: "budget"; item?: Budget }
  | { kind: "goal"; item?: SavingsGoal }
  | { kind: "recurring"; item?: RecurringTransaction }
  | null;
