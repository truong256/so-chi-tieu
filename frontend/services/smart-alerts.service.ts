import type { Budget, RecurringTransaction, SavingsGoal, Transaction, Wallet } from "../types/finance.types";
import { inRange, periodBounds } from "../utils/finance.utils.ts";

export type AlertSeverity = "info" | "warning" | "danger" | "success";

export interface SmartAlert {
  id: string;
  type: "budget_over" | "budget_near" | "recurring_due" | "goal_deadline" | "goal_done" | "low_balance" | "anomaly";
  severity: AlertSeverity;
  title: string;
  body: string;
  timestamp: string; // ISO string
  entityId?: string;
  actionView?: string;
  isRead?: boolean;
}

const READ_ALERTS_STORAGE_KEY = "sct_read_alert_ids_v1";

export function getStoredReadAlertIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(READ_ALERTS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveStoredReadAlertIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(READ_ALERTS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // SessionStorage may be restricted in some browser privacy modes
  }
}

/**
 * Generates real-time financial alerts based on system state.
 * Anti-spam: Deterministic IDs ensure alerts don't duplicate on re-renders.
 */
export function generateSmartAlerts(params: {
  wallets: Wallet[];
  availableBalances: Map<string, number>;
  transactions: Transaction[];
  budgets: Budget[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  formatMoney: (amount: number) => string;
}): SmartAlert[] {
  const { wallets, availableBalances, transactions, budgets, goals, recurring, formatMoney } = params;
  const alerts: SmartAlert[] = [];
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const readIds = getStoredReadAlertIds();

  // 1. Budget Alerts (near limit and exceeded)
  for (const budget of budgets) {
    if (budget.status !== "active") continue;
    const bounds = periodBounds(budget.period === "weekly" ? "week" : budget.period === "yearly" ? "year" : "month");
    const spent = transactions
      .filter(
        (item) =>
          item.type === "expense" &&
          inRange(item, bounds.start, bounds.end) &&
          (!budget.category_id || item.category_id === budget.category_id),
      )
      .reduce((sum, item) => sum + item.amount, 0);

    const percent = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0;
    const periodKey = `${bounds.start.toISOString().slice(0, 10)}`;

    if (percent >= 100) {
      const id = `budget_over_${budget.id}_${periodKey}`;
      alerts.push({
        id,
        type: "budget_over",
        severity: "danger",
        title: `Vượt ngân sách: ${budget.name}`,
        body: `Đã chi ${percent}% (${formatMoney(spent)}). Vượt ${formatMoney(spent - budget.amount)}.`,
        timestamp: new Date().toISOString(),
        entityId: budget.id,
        actionView: "planning",
        isRead: readIds.has(id),
      });
    } else if (percent >= budget.alert_percent) {
      const id = `budget_near_${budget.id}_${periodKey}`;
      alerts.push({
        id,
        type: "budget_near",
        severity: "warning",
        title: `Sắp đạt hạn mức: ${budget.name}`,
        body: `Đã chi ${percent}% (${formatMoney(spent)} / ${formatMoney(budget.amount)}). Còn lại ${formatMoney(Math.max(0, budget.amount - spent))}.`,
        timestamp: new Date().toISOString(),
        entityId: budget.id,
        actionView: "planning",
        isRead: readIds.has(id),
      });
    }
  }

  // 2. Upcoming Recurring Transactions (due today, tomorrow, or within 3 days)
  for (const item of recurring) {
    if (!item.active) continue;
    const nextRun = new Date(item.next_run_at);
    const diffMs = nextRun.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 3) {
      const runDateStr = nextRun.toISOString().slice(0, 10);
      const id = `rec_due_${item.id}_${runDateStr}`;
      const dayLabel =
        diffDays <= 0
          ? "Hôm nay"
          : diffDays === 1
          ? "Ngày mai"
          : `Trong ${diffDays} ngày tới`;

      alerts.push({
        id,
        type: "recurring_due",
        severity: diffDays <= 0 ? "danger" : "warning",
        title: `Đến hạn giao dịch định kỳ: ${item.title}`,
        body: `${dayLabel} (${item.type === "expense" ? "Khoản chi" : "Khoản thu"}: ${formatMoney(item.amount)}).`,
        timestamp: item.next_run_at,
        entityId: item.id,
        actionView: "recurring",
        isRead: readIds.has(id),
      });
    }
  }

  // 3. Savings Goals (deadline approaching within 7 days or completed)
  for (const goal of goals) {
    if (goal.target_amount > 0 && goal.current_amount >= goal.target_amount) {
      const id = `goal_done_${goal.id}`;
      alerts.push({
        id,
        type: "goal_done",
        severity: "success",
        title: `Hoàn thành mục tiêu: ${goal.title}`,
        body: `Chúc mừng bạn! Đã tích lũy đủ ${formatMoney(goal.target_amount)}.`,
        timestamp: new Date().toISOString(),
        entityId: goal.id,
        actionView: "planning",
        isRead: readIds.has(id),
      });
    } else if (goal.deadline) {
      const deadlineDate = new Date(`${goal.deadline}T23:59:59`);
      const diffDays = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays <= 7) {
        const id = `goal_deadline_${goal.id}_${goal.deadline}`;
        const remaining = goal.target_amount - goal.current_amount;
        alerts.push({
          id,
          type: "goal_deadline",
          severity: "warning",
          title: `Mục tiêu sắp hết hạn: ${goal.title}`,
          body: `Còn ${diffDays} ngày (hạn ${goal.deadline}). Còn thiếu ${formatMoney(remaining)}.`,
          timestamp: new Date().toISOString(),
          entityId: goal.id,
          actionView: "planning",
          isRead: readIds.has(id),
        });
      }
    }
  }

  // 4. Low Wallet Balance Alerts (< 100.000 VND or available <= 0)
  for (const wallet of wallets) {
    const avail = availableBalances.get(wallet.id) ?? 0;
    if (avail <= 0) {
      const id = `wallet_empty_${wallet.id}_${todayStr}`;
      alerts.push({
        id,
        type: "low_balance",
        severity: "danger",
        title: `Ví hết tiền khả dụng: ${wallet.name}`,
        body: `Ví "${wallet.name}" không còn số dư khả dụng (${formatMoney(avail)}). Vui lòng nạp thêm hoặc chuyển tiền.`,
        timestamp: new Date().toISOString(),
        entityId: wallet.id,
        actionView: "wallets",
        isRead: readIds.has(id),
      });
    } else if (avail < 100_000 && wallet.currency === "VND") {
      const id = `wallet_low_${wallet.id}_${todayStr}`;
      alerts.push({
        id,
        type: "low_balance",
        severity: "warning",
        title: `Số dư ví thấp: ${wallet.name}`,
        body: `Ví "${wallet.name}" chỉ còn ${formatMoney(avail)} khả dụng.`,
        timestamp: new Date().toISOString(),
        entityId: wallet.id,
        actionView: "wallets",
        isRead: readIds.has(id),
      });
    }
  }

  return alerts;
}
