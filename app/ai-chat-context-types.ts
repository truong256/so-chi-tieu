import type { Budget, SavingsGoal, Transaction, Wallet } from "./finance-types";

export interface FinancialContext {
  totalBalance: number;
  monthlyIncome: number;
  monthlyExpense: number;
  wallets: Wallet[];
  transactions: Transaction[];
  budgets: Budget[];
  savingsGoals: SavingsGoal[];
}
