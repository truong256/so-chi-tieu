/**
 * Shared AI/API types used by backend services.
 * These types are used by both Next.js route handlers and the Cloudflare Worker.
 */

export interface ChatMessage {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

export interface FinancialContext {
  totalBalance?: number;
  monthlyIncome?: number;
  monthlyExpense?: number;
  wallets?: Array<{ name: string; balance: number; type: string }>;
  transactions?: Array<{ title: string; amount: number; type: string; category: string; occurred_at: string }>;
  budgets?: Array<{ name: string; amount: number; spent_amount: number; remaining_amount: number; period: string; status: string }>;
  savingsGoals?: Array<{ title: string; target_amount: number; current_amount: number; deadline: string | null }>;
}

export type CrudActionType =
  | "create_category"
  | "create_budget"
  | "create_transaction"
  | "create_recurring_transaction";

export type RefreshTarget =
  | "categories"
  | "budgets"
  | "transactions"
  | "recurring"
  | "wallets";

export interface ActionSummaryField {
  label: string;
  value: string;
}

export interface PendingCrudActionProposal {
  actionId: string;
  idempotencyKey: string;
  actionType: CrudActionType;
  title: string;
  summaryFields: ActionSummaryField[];
  warnings?: string[];
  payload: Record<string, unknown>;
  expiresAt: string;
}

export interface ExecutedCrudActionResult {
  actionId: string;
  idempotencyKey: string;
  actionType: CrudActionType;
  recordId: string;
  record: Record<string, unknown>;
  refreshTargets: RefreshTarget[];
  alreadyExecuted?: boolean;
}

export interface AiChatRequest {
  message: string;
  history: ChatMessage[];
  financialContext: FinancialContext | null;
  currentPage?: string;
  clientTime?: string;
}

export interface AiChatResult {
  reply?: string;
  error?: string;
  status: number;
  isFastPath?: boolean;
  pendingAction?: PendingCrudActionProposal;
  executedAction?: ExecutedCrudActionResult;
}
