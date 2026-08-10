export type TransactionType = "income" | "expense";
export type WalletType = "cash" | "bank" | "ewallet";
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
export type PaymentSourceType = "wallet" | "budget";
export type BudgetStatus = "active" | "paused" | "completed" | "cancelled";

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
  /** Tổng tiền đang bị giữ cho budgets và goals — không được chi tiêu */
  reserved_amount: number;
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
  /** ID ngân sách mà khoản chi này được trả từ đó (nếu có) */
  budget_id: string | null;
  /** "wallet" = trừ ví bình thường; "budget" = chỉ trừ remaining_amount của budget */
  payment_source_type: PaymentSourceType;
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
  /** Hạn mức tham chiếu ban đầu (tương thích ngược) */
  amount: number;
  /** Tổng tiền đã được phân bổ vào ngân sách (trừ khỏi ví) */
  allocated_amount: number;
  /** Tổng tiền đã chi từ ngân sách */
  spent_amount: number;
  /** Tiền còn lại trong ngân sách = allocated - spent */
  remaining_amount: number;
  /** Ví nguồn đã phân bổ tiền cho ngân sách này */
  source_wallet_id: string | null;
  period: "weekly" | "monthly" | "yearly";
  period_start: string;
  start_date: string | null;
  end_date: string | null;
  alert_percent: number;
  status: BudgetStatus;
};

export type SavingsGoal = {
  id: string;
  user_id: string;
  title: string;
  target_amount: number;
  /** Tổng tiền đã thực sự dành cho mục tiêu (saved) */
  current_amount: number;
  /** Tổng tiền đã được trừ khỏi ví và giữ cho mục tiêu */
  reserved_in_wallet: number;
  /** Ví nguồn đang giữ tiền cho mục tiêu */
  source_wallet_id: string | null;
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

export type FundAllocation = {
  id: string;
  user_id: string;
  type: "wallet_to_budget" | "budget_to_wallet" | "wallet_to_goal" | "goal_to_wallet";
  wallet_id: string | null;
  budget_id: string | null;
  goal_id: string | null;
  amount: number;
  note: string;
  created_at: string;
};

export type ModalState =
  | { kind: "transaction"; item?: Transaction }
  | { kind: "wallet"; item?: Wallet }
  | { kind: "transfer" }
  | { kind: "category"; item?: Category }
  | { kind: "budget"; item?: Budget }
  | { kind: "budget-topup"; budget: Budget }
  | { kind: "budget-return"; budget: Budget }
  | { kind: "goal"; item?: SavingsGoal }
  | { kind: "goal-topup"; goal: SavingsGoal }
  | { kind: "goal-return"; goal: SavingsGoal }
  | { kind: "recurring"; item?: RecurringTransaction }
  | null;
