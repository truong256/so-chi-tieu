/**
 * backend/src/services/fast-path.service.ts
 * ==========================================
 * Fast Path Deterministic Engine for Financial Copilot Chatbot.
 *
 * Responsibilities:
 * 1. Instantly answers queries that have 100% deterministic mathematical answers
 *    WITHOUT calling the LLM (0ms inference latency, 100% accuracy, 0 hallucination).
 * 2. Supported Fast Path Categories:
 *    - Total Assets & Breakdown per wallet
 *    - Total Available Balance & explanation
 *    - Total Allocated / Reserved Funds & reassurance
 *    - Specific Wallet Balances (Cash, Bank, E-wallet, Highest Balance)
 *    - Transaction Statistics (period count, today's expense, month expense, month income)
 *    - Budget Status & Limits Remaining
 *    - Savings Goals Progress & Deadlines
 *    - Off-topic instant rejection
 * 3. Preserves full authentication, RLS, and security controls.
 * 4. Yields gracefully to LLM when subjective advice, multi-day planning, or hypothetical
 *    simulation is required.
 */

import type { ServerFinancialContext } from "./financial-context.service.ts";
import type { RoutingResult } from "./ai-router.service.ts";
import { executeFinancialTool, type ToolExecutionContext } from "./financial-tools.service.ts";
import { OFF_TOPIC_REPLY, isObviouslyOffTopic } from "./ai-chat.service.ts";

interface FastTransactionStatsData {
  period: string;
  periodTransactionCount: number;
  expenseCount: number;
  incomeCount: number;
  totalExpense: number;
  totalIncome: number;
  netDifference: number;
  transfersCount: number;
  totalTransfersAmount: number;
}

interface FastBudgetData {
  totalBudgeted: number;
  totalSpent: number;
  overallPercentUsed: number;
  totalRemaining: number;
  budgets?: Array<{
    name: string;
    actualSpent: number;
    limit: number;
    limitRemaining: number;
    percentUsed: number;
    isOverLimit?: boolean;
    isNearLimit?: boolean;
  }>;
}

interface FastSavingsGoalData {
  totalTarget: number;
  totalAccumulated: number;
  overallPercentProgress: number;
  totalRemainingToSave: number;
  goals?: Array<{
    title: string;
    currentAmount: number;
    targetAmount: number;
    percentProgress: number;
    deadline?: string | null;
  }>;
}

export interface FastPathResult {
  handled: boolean;
  reply?: string;
  source?: "FAST_PATH_DETERMINISTIC" | "FAST_PATH_OFF_TOPIC";
  latencyMs?: number;
}

/**
 * Determine if a user query can and should be resolved via Fast Path.
 */
export async function tryResolveFastPath(
  message: string,
  routing: RoutingResult,
  serverContext: ServerFinancialContext | null,
  toolContext?: ToolExecutionContext | null,
): Promise<FastPathResult> {
  const start = Date.now();
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // 1. Off-Topic Fast Path Rejection (0ms, no DB, no LLM)
  if (isObviouslyOffTopic(trimmed)) {
    return {
      handled: true,
      reply: OFF_TOPIC_REPLY,
      source: "FAST_PATH_OFF_TOPIC",
      latencyMs: Date.now() - start,
    };
  }

  // If query requires creative advice, What-If simulation, multi-day meal planning,
  // or multi-turn anaphoric reasoning, delegate to LLM!
  if (
    routing.category === "AFFORDABILITY_WHATIF" ||
    routing.category === "GENERAL_FINANCIAL_ADVICE" ||
    routing.primaryIntent === "FINANCIAL_ADVICE" ||
    routing.primaryIntent === "CONVERSATION_SUMMARY" ||
    routing.primaryIntent === "REALTIME_INFORMATION" ||
    /nên ăn gì|làm gì với số tiền|tư vấn|lập kế hoạch|mua được không|đủ tiền mua/i.test(lower)
  ) {
    return { handled: false };
  }

  // 2. Core Balances & Assets Fast Path
  if (routing.category === "USER_FINANCIAL_DATA" && serverContext?.snapshot) {
    const snapshot = serverContext.snapshot;
    const focus = routing.walletTargetQuery?.focusType || "TOTAL_ASSETS";
    const primaryCur = snapshot.primaryCurrency || "VND";
    const primaryStats = snapshot.byCurrency[primaryCur] || {
      totalAssets: snapshot.totalAssets,
      totalAllocated: snapshot.totalAllocated,
      totalAvailable: snapshot.totalAvailable,
    };

    // 2a. Total Assets
    if (focus === "TOTAL_ASSETS" || /bao nhiêu tiền\??$|tổng tài sản|tổng số dư/i.test(lower)) {
      const lines: string[] = [
        `**TỔNG QUAN TÀI CHÍNH CỦA BẠN:**`,
        `- **Tổng tài sản:** ${primaryStats.totalAssets.toLocaleString("vi-VN")} ${primaryCur}`,
        `- **Đã phân bổ:** ${primaryStats.totalAllocated.toLocaleString("vi-VN")} ${primaryCur} *(tiền giữ chỗ cho ngân sách & mục tiêu tiết kiệm)*`,
        `- **Số dư khả dụng:** **${primaryStats.totalAvailable.toLocaleString("vi-VN")} ${primaryCur}** *(sẵn sàng để chi tiêu tự do)*`,
        ``,
        `**Chi tiết từng ví:**`,
      ];

      for (const w of snapshot.enrichedWallets) {
        lines.push(
          `- **${w.name}** (${w.type}): ${w.balance.toLocaleString("vi-VN")} ${w.currency} *(Khả dụng: ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency} | Đã phân bổ: ${w.reservedAmount.toLocaleString("vi-VN")} ${w.currency})*`,
        );
      }

      return {
        handled: true,
        reply: lines.join("\n"),
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 2b. Available Balance
    if (focus === "TOTAL_AVAILABLE" || /khả dụng|sẵn sàng chi tiêu/i.test(lower)) {
      const reply = [
        `**SỐ DƯ KHẢ DỤNG CHI TIÊU:**`,
        `- Hiện tại bạn có **${primaryStats.totalAvailable.toLocaleString("vi-VN")} ${primaryCur}** khả dụng để chi tiêu tự do.`,
        `- *Công thức:* Khả dụng = Tổng tài sản (${primaryStats.totalAssets.toLocaleString("vi-VN")} ${primaryCur}) - Đã phân bổ (${primaryStats.totalAllocated.toLocaleString("vi-VN")} ${primaryCur}).`,
        primaryStats.totalAllocated > 0
          ? `- Số tiền ${primaryStats.totalAllocated.toLocaleString("vi-VN")} ${primaryCur} đã phân bổ không hề mất đi mà được giữ an toàn trong các ngân sách và mục tiêu tiết kiệm của bạn.`
          : ``,
      ].filter(Boolean).join("\n");

      return {
        handled: true,
        reply,
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 2c. Allocated Balance
    if (focus === "TOTAL_ALLOCATED" || /đã phân bổ|tiền phân bổ/i.test(lower)) {
      const reply = [
        `**TIỀN ĐÃ PHÂN BỔ (NGÂN SÁCH & MỤC TIÊU TIẾT KIỆM):**`,
        `- Bạn đã phân bổ tổng cộng **${primaryStats.totalAllocated.toLocaleString("vi-VN")} ${primaryCur}** vào các hạn mức chi tiêu và mục tiêu tiết kiệm.`,
        `- *Lưu ý:* Số tiền này vẫn thuộc tổng tài sản của bạn, hệ thống chỉ giữ chỗ để đảm bảo bạn không tiêu lạm vào các kế hoạch tài chính đã đề ra.`,
      ].join("\n");

      return {
        handled: true,
        reply,
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 2d. Specific Wallet / Highest Wallet
    if (focus === "HIGHEST_WALLET") {
      const sorted = [...snapshot.enrichedWallets].sort((a, b) => b.balance - a.balance);
      const top = sorted[0];
      if (top) {
        const reply = [
          `**VÍ CÓ NHIỀU TIỀN NHẤT:**`,
          `- Ví **"${top.name}"** (${top.type}) hiện đang có nhiều tiền nhất trong tài khoản.`,
          `- **Tổng số dư ví:** **${top.balance.toLocaleString("vi-VN")} ${top.currency}**`,
          `- **Đã phân bổ:** ${top.reservedAmount.toLocaleString("vi-VN")} ${top.currency}`,
          `- **Số dư khả dụng:** ${top.availableBalance.toLocaleString("vi-VN")} ${top.currency}`,
        ].join("\n");

        return {
          handled: true,
          reply,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    }

    // Specific Wallet by Keyword / Type (e.g. Cash, Bank)
    if (routing.walletTargetQuery?.targetWalletKeyword || routing.walletTargetQuery?.targetWalletType) {
      const kw = (routing.walletTargetQuery.targetWalletKeyword || "").toLowerCase();
      const type = routing.walletTargetQuery.targetWalletType;

      const target = snapshot.enrichedWallets.find((w) => {
        if (type && w.type.toLowerCase() === type) return true;
        if (kw.includes("tiền mặt") && (w.type === "cash" || w.name.toLowerCase().includes("tiền mặt"))) return true;
        if (kw.includes("ngân hàng") && (w.type === "bank" || w.name.toLowerCase().includes("ngân hàng"))) return true;
        return w.name.toLowerCase().includes(kw);
      });

      if (target) {
        const reply = [
          `**THÔNG TIN VÍ ${target.name.toUpperCase()}:**`,
          `- **Số dư ví:** **${target.balance.toLocaleString("vi-VN")} ${target.currency}**`,
          `- **Đã phân bổ:** ${target.reservedAmount.toLocaleString("vi-VN")} ${target.currency}`,
          `- **Số dư khả dụng chi tiêu:** **${target.availableBalance.toLocaleString("vi-VN")} ${target.currency}**`,
        ].join("\n");

        return {
          handled: true,
          reply,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    }
  }

  // 3. Transaction Statistics Fast Path
  if (routing.category === "TRANSACTION_STATISTICS" && toolContext) {
    try {
      const statsArgs: Record<string, unknown> = {};
      if (routing.transactionStatisticsQuery?.period) statsArgs.period = routing.transactionStatisticsQuery.period;
      if (routing.transactionStatisticsQuery?.startDate) statsArgs.start_date = routing.transactionStatisticsQuery.startDate;
      if (routing.transactionStatisticsQuery?.endDate) statsArgs.end_date = routing.transactionStatisticsQuery.endDate;
      if (routing.transactionStatisticsQuery?.month) statsArgs.month = routing.transactionStatisticsQuery.month;
      if (routing.transactionStatisticsQuery?.year) statsArgs.year = routing.transactionStatisticsQuery.year;
      if (routing.transactionStatisticsQuery?.type) statsArgs.type = routing.transactionStatisticsQuery.type;
      if (routing.transactionStatisticsQuery?.category) statsArgs.category = routing.transactionStatisticsQuery.category;

      const toolOutput = await executeFinancialTool("get_transaction_statistics", statsArgs, toolContext);
      if (toolOutput.success && toolOutput.data) {
        const d = toolOutput.data as unknown as FastTransactionStatsData;
        const lines = [
          `**THỐNG KÊ GIAO DỊCH (${d.period}):**`,
          `- **Số lượng giao dịch:** **${d.periodTransactionCount} giao dịch** (${d.expenseCount} khoản chi, ${d.incomeCount} khoản thu)`,
          `- **Tổng chi tiêu:** **${d.totalExpense.toLocaleString("vi-VN")} VND**`,
          `- **Tổng thu nhập:** **${d.totalIncome.toLocaleString("vi-VN")} VND**`,
          `- **Chênh lệch thu - chi:** **${d.netDifference >= 0 ? "+" : ""}${d.netDifference.toLocaleString("vi-VN")} VND**`,
        ];

        if (d.transfersCount > 0) {
          lines.push(`- **Chuyển tiền liên ví:** ${d.transfersCount} lượt (${d.totalTransfersAmount.toLocaleString("vi-VN")} VND - không tính vào thu/chi)`);
        }

        if (d.periodTransactionCount === 0) {
          lines.push(`\n*Lưu ý:* Bạn không có giao dịch nào được ghi nhận trong khoảng thời gian này.`);
        }

        return {
          handled: true,
          reply: lines.join("\n"),
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    } catch {
      // Fall through to LLM on tool error
    }
  }

  // 4. Budget Status Fast Path (when asking general budget overview or remaining budget)
  if (routing.category === "BUDGET_ADVICE" && toolContext && !/tư vấn|lập|hợp lý|nên đặt|cách/i.test(lower)) {
    try {
      const toolOutput = await executeFinancialTool("get_budget_status", {}, toolContext);
      if (toolOutput.success && toolOutput.data) {
        const d = toolOutput.data as unknown as FastBudgetData;
        const lines = [
          `**TỔNG QUAN NGÂN SÁCH CHI TIÊU:**`,
          `- **Tổng hạn mức:** ${d.totalBudgeted.toLocaleString("vi-VN")} VND`,
          `- **Tổng đã chi:** ${d.totalSpent.toLocaleString("vi-VN")} VND (${d.overallPercentUsed}%)`,
          `- **Hạn mức còn lại:** **${d.totalRemaining.toLocaleString("vi-VN")} VND**`,
          ``,
          `**Chi tiết các ngân sách:**`,
        ];

        for (const b of d.budgets || []) {
          const statusIcon = b.isOverLimit ? "🔴 VƯỢT HẠN MỨC" : (b.isNearLimit ? "⚠️ SẮP CHẠM TRẦN" : "🟢 AN TOÀN");
          lines.push(
            `- **${b.name}:** Đã chi ${b.actualSpent.toLocaleString("vi-VN")} / ${b.limit.toLocaleString("vi-VN")} VND (Còn lại: **${b.limitRemaining.toLocaleString("vi-VN")} VND** - ${b.percentUsed}%) [${statusIcon}]`,
          );
        }

        if ((d.budgets || []).length === 0) {
          lines.push(`Bạn chưa thiết lập ngân sách nào. Hãy vào tab "Ngân sách" để tạo hạn mức chi tiêu.`);
        }

        return {
          handled: true,
          reply: lines.join("\n"),
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    } catch {
      // Fall through to LLM
    }
  }

  // 5. Savings Goals Fast Path (when asking status or progress of savings)
  if (routing.category === "SAVINGS_PLANNING" && toolContext && !/tư vấn|lập|lời khuyên|gợi ý/i.test(lower)) {
    try {
      const toolOutput = await executeFinancialTool("get_savings_goals", {}, toolContext);
      if (toolOutput.success && toolOutput.data) {
        const d = toolOutput.data as unknown as FastSavingsGoalData;
        const lines = [
          `**TIẾN ĐỘ CÁC MỤC TIÊU TIẾT KIỆM:**`,
          `- **Tổng mục tiêu cần tích lũy:** ${d.totalTarget.toLocaleString("vi-VN")} VND`,
          `- **Đã tích lũy:** **${d.totalAccumulated.toLocaleString("vi-VN")} VND** (${d.overallPercentProgress}%)`,
          `- **Còn thiếu:** ${d.totalRemainingToSave.toLocaleString("vi-VN")} VND`,
          ``,
          `**Chi tiết từng mục tiêu:**`,
        ];

        for (const g of d.goals || []) {
          lines.push(
            `- **${g.title}:** ${g.currentAmount.toLocaleString("vi-VN")} / ${g.targetAmount.toLocaleString("vi-VN")} VND (Đạt **${g.percentProgress}%**) ${g.deadline ? `[Hạn chót: ${g.deadline}]` : ""}`,
          );
        }

        if ((d.goals || []).length === 0) {
          lines.push(`Bạn chưa thiết lập mục tiêu tiết kiệm nào. Hãy vào tab "Mục tiêu" để thêm mục tiêu mới.`);
        }

        return {
          handled: true,
          reply: lines.join("\n"),
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    } catch {
      // Fall through to LLM
    }
  }

  return { handled: false };
}
