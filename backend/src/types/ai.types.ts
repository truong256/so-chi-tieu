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
}
