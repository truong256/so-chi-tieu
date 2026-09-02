import type {
  Budget,
  SavingsGoal,
  Transaction,
  Transfer,
  Wallet,
} from "../types/finance.types";

export type TransactionTotals = {
  income: number;
  expense: number;
};

export function calculateWalletBalances(
  wallets: Wallet[],
  transactions: Transaction[],
  transfers: Transfer[],
  budgets: Budget[],
): Map<string, number> {
  const balances = new Map(wallets.map((wallet) => [wallet.id, wallet.balance]));
  const budgetWalletById = new Map(
    budgets.map((budget) => [budget.id, budget.source_wallet_id]),
  );

  for (const transaction of transactions) {
    const walletId =
      transaction.wallet_id ??
      (transaction.payment_source_type === "budget" && transaction.budget_id
        ? budgetWalletById.get(transaction.budget_id)
        : null);

    if (!walletId || !balances.has(walletId)) continue;
    const direction = transaction.type === "income" ? 1 : -1;
    balances.set(walletId, (balances.get(walletId) ?? 0) + direction * transaction.amount);
  }

  for (const transfer of transfers) {
    if (balances.has(transfer.from_wallet_id)) {
      balances.set(
        transfer.from_wallet_id,
        (balances.get(transfer.from_wallet_id) ?? 0) - transfer.amount,
      );
    }
    if (balances.has(transfer.to_wallet_id)) {
      balances.set(
        transfer.to_wallet_id,
        (balances.get(transfer.to_wallet_id) ?? 0) + transfer.amount,
      );
    }
  }

  return balances;
}

export function calculateReservedByWallet(
  wallets: Wallet[],
  budgets: Budget[],
  goals: SavingsGoal[],
): Map<string, number> {
  const reserved = new Map(wallets.map((wallet) => [wallet.id, 0]));

  for (const budget of budgets) {
    if (
      budget.source_wallet_id &&
      budget.status === "active" &&
      budget.remaining_amount > 0 &&
      reserved.has(budget.source_wallet_id)
    ) {
      reserved.set(
        budget.source_wallet_id,
        (reserved.get(budget.source_wallet_id) ?? 0) + budget.remaining_amount,
      );
    }
  }

  for (const goal of goals) {
    if (
      goal.source_wallet_id &&
      goal.reserved_in_wallet > 0 &&
      reserved.has(goal.source_wallet_id)
    ) {
      reserved.set(
        goal.source_wallet_id,
        (reserved.get(goal.source_wallet_id) ?? 0) + goal.reserved_in_wallet,
      );
    }
  }

  return reserved;
}

export function calculateAvailableBalances(
  balances: Map<string, number>,
  reserved: Map<string, number>,
): Map<string, number> {
  return new Map(
    [...balances].map(([walletId, balance]) => [
      walletId,
      balance - (reserved.get(walletId) ?? 0),
    ]),
  );
}

export function calculateTransactionTotals(
  transactions: Transaction[],
  start: Date,
  end: Date,
): TransactionTotals {
  const totals: TransactionTotals = { income: 0, expense: 0 };

  for (const transaction of transactions) {
    const occurredAt = new Date(transaction.occurred_at);
    if (occurredAt >= start && occurredAt < end) {
      totals[transaction.type] += transaction.amount;
    }
  }

  return totals;
}
