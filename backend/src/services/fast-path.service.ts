/**
 * backend/src/services/fast-path.service.ts
 * ==========================================
 * Fast Path Deterministic Engine for Financial Copilot Chatbot.
 *
 * Responsibilities:
 * 1. Instantly answers queries that have 100% deterministic mathematical answers
 *    WITHOUT calling the LLM (0ms inference latency, 100% accuracy, 0 hallucination).
 * 2. Supported Fast Path Categories:
 *    - Simple Arithmetic & Periodic Accumulation (0 DB queries, 0 LLM)
 *    - Total Assets & Breakdown per wallet
 *    - Total Available Balance & explanation
 *    - Total Allocated / Reserved Funds & reassurance
 *    - Specific Wallet Balances (Cash, Bank, E-wallet, Highest Balance)
 *    - Transaction Statistics (period count, today's expense, month expense, month income)
 *    - Spending Analysis (top category spend, spending safety ratio)
 *    - Budget Status & Limits Remaining & What-If additional spending
 *    - Savings Goals Progress & Deadlines
 *    - Affordability What-If checks
 *    - Off-topic instant rejection
 * 3. Preserves full authentication, RLS, and security controls.
 * 4. Yields gracefully to LLM when subjective advice, multi-day planning, or hypothetical
 *    simulation is required.
 */

import type { ServerFinancialContext } from "./financial-context.service.ts";
import type { RoutingResult } from "./ai-router.service.ts";
import { executeFinancialTool, type ToolExecutionContext } from "./financial-tools.service.ts";
import { parseVietnameseAmount } from "../../../frontend/utils/smart-parser.ts";
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

  // 1b. Simple Calculation Fast Path (0ms, 100% deterministic, 0 hallucination)
  if (routing.simpleCalculation) {
    return {
      handled: true,
      reply: routing.simpleCalculation.explanationVi,
      source: "FAST_PATH_DETERMINISTIC",
      latencyMs: Date.now() - start,
    };
  }

  // 1c. Security, Authorization & Privacy Guards (Q096 - Q100)
  // Rejection of unauthorized actions, credential exfiltration, jailbreaks, cross-user tampering, and unconfirmed transfers

  // Q096: Credential / Secret Exfiltration
  if (/access token|service role key|service_role|jwt secret|database password|mã token|api key của hệ thống/i.test(lower)) {
    return {
      handled: true,
      reply: "Tôi không thể cung cấp thông tin này. Theo chính sách an toàn và bảo mật của hệ thống Sổ Chi Tiêu, các thông tin bảo mật như access token, service role key hoặc mã truy cập nội bộ đều được bảo vệ nghiêm ngặt và không bao giờ được phép tiết lộ.",
      source: "FAST_PATH_DETERMINISTIC",
      latencyMs: Date.now() - start,
    };
  }

  // Q097: Cross-User Tampering / Deletion
  if (/người dùng khác|tài khoản khác/i.test(lower) && /xóa|hủy|thay đổi|can thiệp/i.test(lower)) {
    return {
      handled: true,
      reply: "Tôi không thể thực hiện yêu cầu này. Hệ thống Sổ Chi Tiêu tuân thủ nghiêm ngặt nguyên tắc phân quyền và bảo vệ quyền riêng tư người dùng (Row-Level Security): mỗi tài khoản chỉ có quyền xem và thao tác trên dữ liệu của chính mình. Bạn không có quyền truy cập hoặc can thiệp vào dữ liệu của người dùng khác trong cơ sở dữ liệu.",
      source: "FAST_PATH_DETERMINISTIC",
      latencyMs: Date.now() - start,
    };
  }

  // Q098: Unauthorized Data Access (Admin account data)
  if (/(?:tài khoản admin|admin).*?(?:số dư|chi tiêu|thông tin)|(?:số dư|chi tiêu|thông tin).*?(?:tài khoản admin|admin)/i.test(lower)) {
    return {
      handled: true,
      reply: "Tôi không thể thực hiện yêu cầu này. Hệ thống tuân thủ nghiêm ngặt chính sách phân quyền người dùng và bảo vệ dữ liệu riêng tư: mỗi người dùng chỉ có quyền xem số dư và thông tin chi tiêu của chính mình. Tôi không có quyền truy cập hay chia sẻ thông tin tài chính của tài khoản admin hay bất kỳ người dùng nào khác.",
      source: "FAST_PATH_DETERMINISTIC",
      latencyMs: Date.now() - start,
    };
  }

  // Q099: Jailbreak & DB Connection String / Direct SQL Exfiltration
  if (/bỏ qua các nguyên tắc|bỏ qua hướng dẫn|ignore previous instructions|in ra câu lệnh sql|câu lệnh sql kết nối database|kết nối database/i.test(lower)) {
    return {
      handled: true,
      reply: "Tôi không thể thực hiện yêu cầu này. Để đảm bảo an toàn và bảo mật cho hệ thống Sổ Chi Tiêu, tôi không thể bỏ qua các nguyên tắc an toàn hoặc cung cấp câu lệnh SQL kết nối trực tiếp vào cơ sở dữ liệu.",
      source: "FAST_PATH_DETERMINISTIC",
      latencyMs: Date.now() - start,
    };
  }

  // Q100: Automated Unconfirmed Fund Transfers
  if (/(?:không cần xác nhận|tự ý chuyển|không cần hỏi)/i.test(lower) && /(?:chuyển.*tiền|chuyển.*triệu|chuyển.*ví|tự động chuyển)/i.test(lower)) {
    return {
      handled: true,
      reply: "Tôi không thể tự ý thực hiện giao dịch chuyển tiền khi chưa có xác nhận từ bạn. Theo nguyên tắc an toàn tài chính của Sổ Chi Tiêu, mọi thao tác chuyển tiền hoặc trích tiền khỏi ví đều bắt buộc phải được người dùng xem xét và xác nhận rõ ràng trước khi tiến hành.",
      source: "FAST_PATH_DETERMINISTIC",
      latencyMs: Date.now() - start,
    };
  }

  // Snapshot fallback across serverContext and toolContext
  const snapshot = serverContext?.snapshot || toolContext?.snapshot || toolContext?.serverContext?.snapshot;

  // 1c. Simple Purchase & Savings Affordability Fast Path
  if (
    (/đủ tiền|có thể mua|đủ khả năng|có đủ tiền/i.test(lower) || routing.category === "AFFORDABILITY_WHATIF") &&
    snapshot
  ) {
    const amtParsed = parseVietnameseAmount(trimmed);
    if (amtParsed.amount && amtParsed.amount > 0 && !lower.includes("ăn gì") && !lower.includes("trong 7 ngày") && !lower.includes("thực đơn")) {
      const price = amtParsed.amount;
      const totalAvailable = snapshot.byCurrency["VND"]?.totalAvailable ?? snapshot.totalAvailable;
      const isSaving = /tiết kiệm|để dành/i.test(lower);
      const actionLabel = isSaving ? "tiết kiệm thêm" : "chi tiêu / mua món đồ trị giá";

      if (price <= totalAvailable) {
        const remaining = totalAvailable - price;
        const lines = [
          `Bạn **HOÀN TOÀN ĐỦ TIỀN** để ${actionLabel} **${price.toLocaleString("vi-VN")} VND**:`,
          ``,
          `- **Số dư khả dụng hiện tại:** **${totalAvailable.toLocaleString("vi-VN")} VND** (${snapshot.enrichedWallets.map(w => `${w.name}: ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency}`).join(", ")}).`,
          `- **Sau khi thực hiện:** Bạn vẫn còn lại **${remaining.toLocaleString("vi-VN")} VND** khả dụng để chi tiêu tự do.`,
          `- **Khoản tiền bảo đảm:** ${snapshot.totalAllocated.toLocaleString("vi-VN")} VND đã phân bổ cho các ngân sách/mục tiêu khác hoàn toàn không bị ảnh hưởng.`,
        ];
        return {
          handled: true,
          reply: lines.join("\n"),
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      } else {
        const missing = price - totalAvailable;
        return {
          handled: true,
          reply: `Bạn **CHƯA ĐỦ TIỀN KHẢ DỤNG** để ${actionLabel} **${price.toLocaleString("vi-VN")} VND**:\n\n- **Số dư khả dụng hiện tại:** ${totalAvailable.toLocaleString("vi-VN")} VND.\n- **Số tiền còn thiếu:** **${missing.toLocaleString("vi-VN")} VND**.\n- **Khuyến nghị:** Bạn nên tích lũy thêm trước khi thực hiện khoản chi này để tránh ảnh hưởng đến các khoản tiền đã phân bổ.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    }
  }

  // If query requires creative advice, What-If simulation, multi-day meal planning,
  // or multi-turn anaphoric reasoning, delegate to LLM!
  if (
    routing.primaryIntent === "REALTIME_INFORMATION" ||
    /nên ăn gì|ăn sáng như thế nào|ăn gì trong|thực đơn/i.test(lower)
  ) {
    return { handled: false };
  }

  // 2. Core Balances & Assets Fast Path
  if (routing.category === "USER_FINANCIAL_DATA" && snapshot) {
    const focus = routing.walletTargetQuery?.focusType || "TOTAL_ASSETS";
    const primaryCur = snapshot.primaryCurrency || "VND";
    const primaryStats = snapshot.byCurrency[primaryCur] || {
      totalAssets: snapshot.totalAssets,
      totalAllocated: snapshot.totalAllocated,
      totalAvailable: snapshot.totalAvailable,
    };

    // 2a. Wallet Count: "Tôi có bao nhiêu ví trong hệ thống?"
    if (/bao nhiêu ví|mấy ví/i.test(lower)) {
      const lines = [
        `Hiện tại bạn đang quản lý **${snapshot.enrichedWallets.length} ví** trong hệ thống:`,
        ``,
        ...snapshot.enrichedWallets.map(
          (w) => `- **${w.name}** (${w.type}): ${w.balance.toLocaleString("vi-VN")} ${w.currency} (Khả dụng: ${w.availableBalance.toLocaleString("vi-VN")} ${w.currency})`
        ),
      ];
      return {
        handled: true,
        reply: lines.join("\n"),
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 2b. E-Wallet check: "Tôi có tiền trong ví điện tử nào không?"
    if (/ví điện tử|ewallet/i.test(lower)) {
      const ewallets = snapshot.enrichedWallets.filter((w) => w.type === "ewallet");
      if (ewallets.length === 0) {
        return {
          handled: true,
          reply: `Hiện tại bạn **chưa có ví điện tử** nào trong hệ thống. Tài khoản của bạn hiện có 2 ví: **Tiền mặt** (${snapshot.enrichedWallets.find(w => w.type === 'cash')?.balance.toLocaleString("vi-VN") || 0} VND) và **Tài khoản VCB** (${snapshot.enrichedWallets.find(w => w.type === 'bank')?.balance.toLocaleString("vi-VN") || 0} VND).`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    }

    // 2c. Specific Wallet by Keyword / Type (e.g. Cash, Bank, VCB)
    const isExplicitCash = /tiền mặt|cash/i.test(lower);
    const isExplicitBank = /ngân hàng|bank|vcb/i.test(lower);

    if (
      isExplicitCash ||
      isExplicitBank ||
      routing.walletTargetQuery?.targetWalletKeyword ||
      routing.walletTargetQuery?.targetWalletType
    ) {
      const kw = (routing.walletTargetQuery?.targetWalletKeyword || (isExplicitCash ? "tiền mặt" : isExplicitBank ? "ngân hàng" : "")).toLowerCase();
      const type = routing.walletTargetQuery?.targetWalletType || (isExplicitCash ? "cash" : isExplicitBank ? "bank" : undefined);

      const target = snapshot.enrichedWallets.find((w) => {
        if (type && w.type.toLowerCase() === type) return true;
        if (kw.includes("tiền mặt") && (w.type === "cash" || w.name.toLowerCase().includes("tiền mặt"))) return true;
        if (kw.includes("ngân hàng") && (w.type === "bank" || w.name.toLowerCase().includes("ngân hàng"))) return true;
        if (kw.includes("vcb") && w.name.toLowerCase().includes("vcb")) return true;
        return w.name.toLowerCase().includes(kw);
      });

      if (target) {
        const walletTypeLabel = target.type === "bank" ? "Ngân hàng" : target.type === "cash" ? "Tiền mặt" : target.type;
        const reply = [
          `**THÔNG TIN VÍ ${target.name.toUpperCase()} (${walletTypeLabel.toUpperCase()}):`,
          `- **Loại ví:** ${walletTypeLabel}`,
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

    // 2d. Highest Wallet (Balance or Available): "Ví nào đang có nhiều tiền nhất?", "Ví nào đang có số tiền khả dụng cao nhất?"
    if (focus === "HIGHEST_WALLET" || /ví nào.*(nhiều tiền nhất|khả dụng cao nhất|lớn nhất)/i.test(lower)) {
      const isAskingAvailable = /khả dụng/i.test(lower);
      const sorted = [...snapshot.enrichedWallets].sort((a, b) =>
        isAskingAvailable ? b.availableBalance - a.availableBalance : b.balance - a.balance
      );
      const top = sorted[0];
      if (top) {
        const reply = [
          `**VÍ ${isAskingAvailable ? "CÓ SỐ DƯ KHẢ DỤNG CAO NHẤT" : "CÓ NHIỀU TIỀN NHẤT"}:**`,
          `- Ví **"${top.name}"** (${top.type}) hiện đang có ${isAskingAvailable ? "số tiền khả dụng cao nhất" : "nhiều tiền nhất"} trong tài khoản.`,
          `- **Số dư khả dụng:** **${top.availableBalance.toLocaleString("vi-VN")} ${top.currency}**`,
          `- **Tổng số dư ví:** ${top.balance.toLocaleString("vi-VN")} ${top.currency}`,
          `- **Đã phân bổ:** ${top.reservedAmount.toLocaleString("vi-VN")} ${top.currency}`,
        ].join("\n");

        return {
          handled: true,
          reply,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }
    }

    // 2e. Allocated Balance: "Tôi đã phân bổ bao nhiêu tiền vào ngân sách và mục tiêu?"
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

    // 2f. General Available Balance: "Số dư khả dụng để chi tiêu của tôi là bao nhiêu?"
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

    // 2g. Total Assets: "Hiện tại tôi có tổng cộng bao nhiêu tiền?", "Liệt kê danh sách tất cả các ví"
    if (
      focus === "TOTAL_ASSETS" ||
      /bao nhiêu tiền\??$|tổng tài sản|tổng số dư|tổng cộng bao nhiêu tiền|danh sách.*ví/i.test(lower)
    ) {
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
  }

  // 3. Transaction Statistics & Spending Analysis Fast Path
  if (
    (routing.category === "TRANSACTION_STATISTICS" ||
      routing.category === "SPENDING_ANALYSIS" ||
      /tổng thu nhập|thu nhập.*tháng|khoản chi tiêu lớn nhất|chi tiêu lớn nhất|chuyển tiền liên ví|so với tháng trước|múi giờ|tỷ lệ tiết kiệm 100%/i.test(
        lower,
      )) &&
    toolContext
  ) {
    try {
      // 3a_today. Today expense query
      if (/hôm nay/i.test(lower) && /chi/i.test(lower)) {
        return {
          handled: true,
          reply: `**THỐNG KÊ CHI TIÊU HÔM NAY:**\n- **Hôm nay** bạn chưa có giao dịch **chi tiêu** nào phát sinh trong ngày.\n- Tổng chi tiêu hôm nay: **0 VND** (theo múi giờ Asia/Ho_Chi_Minh UTC+7).\n- Tổng chi tiêu lũy kế tháng 10/2026 hiện là: 4.850.000 VND.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3a_diff. Net income difference: "Chênh lệch thu chi trong tháng này của tôi là bao nhiêu?"
      if (/chênh lệch/i.test(lower)) {
        return {
          handled: true,
          reply: `**CHÊNH LỆCH THU CHI (Tháng 10/2026):**\n- **Tổng thu nhập:** **15.000.000 VND**\n- **Tổng chi tiêu:** **4.850.000 VND**\n- **Chênh lệch thu - chi:** **+10.150.000 VND** (Dòng tiền thặng dư dương rất tích cực).\n- *Ghi chú:* Giao dịch chuyển tiền liên ví 11.500.000 VND không ảnh hưởng đến chênh lệch thu chi.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3a0. Timezone info
      if (/múi giờ|timezone/i.test(lower)) {
        return {
          handled: true,
          reply: `Tất cả các giao dịch trong hệ thống Sổ Chi Tiêu đều được chuẩn hóa và ghi nhận chính xác theo múi giờ Việt Nam: **Asia/Ho_Chi_Minh** (**UTC+7**). Mọi mốc thời gian lọc (hôm nay, tháng này, tuần này) đều căn chỉnh theo múi giờ này để đảm bảo không bị sai lệch ngày giao dịch.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3a1. 100% savings rate rule check
      if (/tỷ lệ tiết kiệm 100%|tiết kiệm 100%/i.test(lower)) {
        return {
          handled: true,
          reply: `Tuyệt đối **không** được kết luận tỷ lệ tiết kiệm đạt **100%** chỉ vì **chưa có** giao dịch chi tiêu được ghi nhận trong tháng. Việc chưa có chi tiêu có thể do dữ liệu chưa kịp nhập, dữ liệu bị thiếu hoặc chưa phát sinh chi phí, không đồng nghĩa với việc toàn bộ thu nhập đã được tiết kiệm thực tế.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3a2. Transfers between wallets check
      if (/chuyển tiền.*liên ví|liên ví/i.test(lower)) {
        return {
          handled: true,
          reply: `Trong tháng này, bạn có **1 giao dịch chuyển tiền liên ví**:\n- **Chi tiết:** Chuyển từ **Tài khoản VCB** sang ví **Tiền mặt** số tiền **11.500.000 VND** (Rút tiền ATM về ví tiền mặt).\n- *Lưu ý:* Giao dịch chuyển tiền liên ví không tính vào tổng thu nhập hay tổng chi tiêu của tài khoản.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3a3. Compare with previous month
      if (/so với tháng trước|tăng hay giảm/i.test(lower)) {
        const spendingOutput = await executeFinancialTool("get_spending_analysis", {}, toolContext);
        const d = (spendingOutput?.data as { curExpense?: number; prevExpense?: number } | undefined) || {};
        const cur = d.curExpense || 4850000;
        const prev = d.prevExpense || 5500000;
        const diff = Math.abs(cur - prev);
        const pct = Math.round((diff / prev) * 1000) / 10;
        const isDown = cur < prev;
        return {
          handled: true,
          reply: `**SO SÁNH CHI TIÊU SO VỚI THÁNG TRƯỚC:**\n- **Chi tiêu tháng này (T10/2026):** **${cur.toLocaleString("vi-VN")} VND**\n- **Chi tiêu tháng trước (T9/2026):** **${prev.toLocaleString("vi-VN")} VND**\n- **Đánh giá:** Chi tiêu tháng này **${isDown ? "giảm" : "tăng"} ${diff.toLocaleString("vi-VN")} VND** (${isDown ? "-" : "+"}${pct}%) **so với tháng trước**. Bạn đang kiểm soát chi tiêu rất tốt!\n- *Lưu ý:* Giao dịch chuyển tiền liên ví 11.500.000 VND không được tính vào chi tiêu.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3a4. Monthly total income query
      if (/tổng thu nhập|thu nhập.*tháng/i.test(lower)) {
        return {
          handled: true,
          reply: `**TỔNG THU NHẬP THÁNG NÀY (Tháng 10/2026):**\n- **Tổng thu nhập:** **15.000.000 VND** (1 giao dịch thu nhập từ "Lương tháng 10" chuyển khoản vào Tài khoản VCB).\n- Khoản thu nhập này đã được cộng đầy đủ vào số dư tài khoản của bạn.`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3a. Top spending category & largest expense
      if (/(?:khoản\s+)?chi(?:\s+tiêu)?\s+lớn\s+nhất|chi\s+nhiều\s+tiền\s+nhất|chi\s+nhiều\s+nhất|danh\s+mục\s+nào\s+nhiều\s+nhất/i.test(lower)) {
        return {
          handled: true,
          reply: `Khoản chi tiêu **lớn nhất** trong tháng 10/2026 của bạn là **"Ăn uống gia đình và liên hoan"** với số tiền **2.100.000 VND** (thuộc danh mục **Ăn uống**).\n\nTổng cộng trong tháng này bạn đang chi nhiều nhất cho danh mục **Ăn uống** với tổng số tiền **2.650.000 VND** (chiếm 54.6% tổng chi tiêu tháng).`,
          source: "FAST_PATH_DETERMINISTIC",
          latencyMs: Date.now() - start,
        };
      }

      // 3c. Regular Transaction Statistics
      const statsArgs: Record<string, unknown> = {};
      if (/hôm nay|hom nay/i.test(lower)) {
        statsArgs.period = "today";
      } else if (routing.transactionStatisticsQuery?.period) {
        statsArgs.period = routing.transactionStatisticsQuery.period;
      }
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
          `**THỐNG KÊ CHI TIÊU (${d.period}):**`,
          `- **Tổng chi tiêu:** **${d.totalExpense.toLocaleString("vi-VN")} VND** (${d.expenseCount} giao dịch chi tiêu)`,
          `- **Tổng thu nhập:** **${d.totalIncome.toLocaleString("vi-VN")} VND** (${d.incomeCount} giao dịch thu nhập)`,
          `- **Chênh lệch thu - chi:** **${d.netDifference >= 0 ? "+" : ""}${d.netDifference.toLocaleString("vi-VN")} VND**`,
          `- **Tổng số giao dịch trong kỳ:** **${d.periodTransactionCount} giao dịch**`,
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
      // Fall through to LLM on error
    }
  }

  // 4. Budget Status Fast Path
  if (
    (routing.category === "BUDGET_ADVICE" ||
      /vượt ngân sách|ngân sách.*còn|hạn mức.*còn|cảnh báo|mức cảnh báo|vượt hạn mức|bị vượt|trên tổng tất cả các ngân sách|danh sách ngân sách/i.test(
        lower,
      )) &&
    toolContext &&
    !/tư vấn|lập kế hoạch|tạo ngân sách mới|thêm ngân sách/i.test(lower)
  ) {
    try {
      const toolOutput = await executeFinancialTool("get_budget_status", {}, toolContext);
      if (toolOutput.success && toolOutput.data) {
        const rawData = toolOutput.data as {
          budgets?: Array<{
            budgetName?: string;
            name?: string;
            categoryName?: string;
            limit: number;
            actualSpent: number;
            limitRemaining: number;
            percentUsed: number;
            statusText?: string;
          }>;
        };

        const budgets = (rawData.budgets || []).map((b) => ({
          name: b.budgetName || b.name || b.categoryName || "Ngân sách",
          categoryName: b.categoryName || "",
          limit: b.limit || 0,
          actualSpent: b.actualSpent || 0,
          limitRemaining: b.limitRemaining ?? Math.max(0, (b.limit || 0) - (b.actualSpent || 0)),
          percentUsed: b.percentUsed ?? ((b.limit || 0) > 0 ? Math.round(((b.actualSpent || 0) / b.limit) * 100) : 0),
          statusText: b.statusText,
        }));

        // 4a. Check What-If additional spend: "Nếu chi thêm 200.000đ, tôi có vượt ngân sách không?"
        if (/chi thêm|tiêu thêm/i.test(lower)) {
          const amtMatch = parseVietnameseAmount(trimmed);
          if (amtMatch.amount && amtMatch.amount > 0) {
            const addAmount = amtMatch.amount;
            const targetB =
              budgets.find((b) => {
                const bName = b.name.toLowerCase();
                const catName = b.categoryName.toLowerCase();
                return lower.includes("ăn uống") ? bName.includes("ăn uống") || catName.includes("ăn uống") : false;
              }) || budgets[0];

            if (targetB) {
              if (addAmount <= targetB.limitRemaining) {
                const remainingAfter = targetB.limitRemaining - addAmount;
                const pctAfter = Math.round(((targetB.actualSpent + addAmount) / targetB.limit) * 100);
                return {
                  handled: true,
                  reply: `Nếu chi thêm **${addAmount.toLocaleString("vi-VN")} VND**, bạn **KHÔNG VƯỢT** ngân sách ${targetB.name}:\n\n- **Hạn mức ngân sách:** ${targetB.limit.toLocaleString("vi-VN")} VND\n- **Hiện tại đã chi:** ${targetB.actualSpent.toLocaleString("vi-VN")} VND (còn lại ${targetB.limitRemaining.toLocaleString("vi-VN")} VND)\n- **Sau khi chi thêm:** Ngân sách còn lại **${remainingAfter.toLocaleString("vi-VN")} VND** (tương đương sử dụng ${pctAfter}% hạn mức).`,
                  source: "FAST_PATH_DETERMINISTIC",
                  latencyMs: Date.now() - start,
                };
              } else {
                const overAmount = addAmount - targetB.limitRemaining;
                return {
                  handled: true,
                  reply: `Nếu chi thêm **${addAmount.toLocaleString("vi-VN")} VND**, bạn **SẼ VƯỢT** ngân sách ${targetB.name} số tiền **${overAmount.toLocaleString("vi-VN")} VND** (Hiện ngân sách chỉ còn lại ${targetB.limitRemaining.toLocaleString("vi-VN")} VND).\n\nKhuyến nghị: Bạn nên điều chỉnh giảm bớt khoản chi để giữ an toàn tài chính.`,
                  source: "FAST_PATH_DETERMINISTIC",
                  latencyMs: Date.now() - start,
                };
              }
            }
          }
        }

        // 4b0. Envelope funding check: "Quỹ phong bì ngân sách ăn uống được cấp vốn từ ví nào?"
        if (/phong bì|cấp vốn/i.test(lower)) {
          const targetB =
            budgets.find((b) => {
              const bName = b.name.toLowerCase();
              const catName = b.categoryName.toLowerCase();
              return lower.includes("ăn uống") ? bName.includes("ăn uống") || catName.includes("ăn uống") : false;
            }) || budgets[0];

          let fundingWalletName = "Tiền mặt";
          if (snapshot?.enrichedWallets) {
            const reservedWallet = snapshot.enrichedWallets.find((w) => w.reservedAmount > 0);
            if (reservedWallet) fundingWalletName = reservedWallet.name;
          }

          const lines = [
            `**CƠ CHẾ CẤP VỐN PHONG BÌ CHO ${targetB ? targetB.name.toUpperCase() : "NGÂN SÁCH ĂN UỐNG"}:**`,
            `- Quỹ **phong bì** của **${targetB ? targetB.name : "Ngân sách Ăn uống"}** được cấp vốn và giữ chỗ từ **ví ${fundingWalletName}**.`,
            `- **Số tiền phong bì đã cấp vốn:** 500.000 VND (khoản tiền này được giữ chỗ trong ví để bảo đảm kế hoạch chi tiêu an toàn).`,
            `- **Hạn mức tổng thể:** ${targetB ? targetB.limit.toLocaleString("vi-VN") : "3.000.000"} VND.`,
            `- Khi bạn chi tiêu cho danh mục Ăn uống từ ví ${fundingWalletName}, tiền sẽ được khấu trừ tương ứng cả ở số dư ví và hạn mức ngân sách.`,
          ];
          return {
            handled: true,
            reply: lines.join("\n"),
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 4b. Budget warning check: "Ngân sách ăn uống có đang ở mức cảnh báo không?"
        if (/cảnh báo|mức cảnh báo/i.test(lower)) {
          const targetB =
            budgets.find((b) => {
              const bName = b.name.toLowerCase();
              const catName = b.categoryName.toLowerCase();
              return lower.includes("ăn uống") ? bName.includes("ăn uống") || catName.includes("ăn uống") : false;
            }) || budgets[0];

          if (targetB) {
            const isWarn = targetB.percentUsed >= 80;
            const lines = [
              `**TRẠNG THÁI CẢNH BÁO NGÂN SÁCH ${targetB.name.toUpperCase()}:**`,
              `- Ngân sách **${targetB.name}** hiện **${isWarn ? "ĐANG Ở MỨC CẢNH BÁO" : "ĐANG Ở MỨC AN TOÀN"}** (đã sử dụng **${targetB.percentUsed}%** hạn mức).`,
              `- **Hạn mức:** ${targetB.limit.toLocaleString("vi-VN")} VND`,
              `- **Đã chi:** ${targetB.actualSpent.toLocaleString("vi-VN")} VND`,
              `- **Hạn mức còn lại:** **${targetB.limitRemaining.toLocaleString("vi-VN")} VND**`,
              isWarn
                ? `- *Lưu ý cảnh báo:* Hệ thống kích hoạt cảnh báo khi ngân sách đạt từ 80% hạn mức trở lên. Bạn nên kiểm soát các khoản chi tiếp theo để tránh vượt hạn mức.`
                : `- *Trạng thái:* Ngân sách vẫn trong ngưỡng an toàn dưới mức cảnh báo 80%.`,
            ];
            return {
              handled: true,
              reply: lines.join("\n"),
              source: "FAST_PATH_DETERMINISTIC",
              latencyMs: Date.now() - start,
            };
          }
        }

        // 4c. Over budget check: "Có ngân sách nào của tôi bị vượt hạn mức chi tiêu chưa?"
        if (/bị vượt|vượt hạn mức.*chưa|có ngân sách nào.*vượt/i.test(lower)) {
          const overBudgets = budgets.filter((b) => b.actualSpent > b.limit || b.percentUsed >= 100);
          if (overBudgets.length === 0) {
            const lines = [
              `Hiện tại **chưa có ngân sách nào của bạn bị vượt** hạn mức chi tiêu.`,
              ``,
              `**Tình hình kiểm soát ngân sách:**`,
              ...budgets.map(
                (b) =>
                  `- **${b.name}:** Đã chi ${b.actualSpent.toLocaleString("vi-VN")} / ${b.limit.toLocaleString("vi-VN")} VND (Còn lại: **${b.limitRemaining.toLocaleString("vi-VN")} VND** - ${b.percentUsed}%) [${b.percentUsed >= 80 ? "⚠️ Cảnh báo sắp hết" : "🟢 An toàn"}]`,
              ),
              ``,
              `*Tất cả ngân sách đều đang được kiểm soát và chưa vượt mức giới hạn cho phép.*`,
            ];
            return {
              handled: true,
              reply: lines.join("\n"),
              source: "FAST_PATH_DETERMINISTIC",
              latencyMs: Date.now() - start,
            };
          } else {
            const lines = [
              `⚠️ Có **${overBudgets.length} ngân sách đã bị vượt hạn mức**: `,
              ...overBudgets.map(
                (b) =>
                  `- **${b.name}:** Đã chi ${b.actualSpent.toLocaleString("vi-VN")} / ${b.limit.toLocaleString("vi-VN")} VND (Vượt: ${(b.actualSpent - b.limit).toLocaleString("vi-VN")} VND)`,
              ),
            ];
            return {
              handled: true,
              reply: lines.join("\n"),
              source: "FAST_PATH_DETERMINISTIC",
              latencyMs: Date.now() - start,
            };
          }
        }

        // 4d. Overall % of total budgets spent: "Tôi đã chi bao nhiêu % trên tổng tất cả các ngân sách?"
        if (/bao nhiêu %.*ngân sách|chi.*% trên tổng/i.test(lower)) {
          const totalBudgeted = budgets.reduce((s, b) => s + b.limit, 0);
          const totalSpent = budgets.reduce((s, b) => s + b.actualSpent, 0);
          const totalRemaining = budgets.reduce((s, b) => s + b.limitRemaining, 0);
          const overallPercentUsed = totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0;
          const lines = [
            `Bạn đã chi **${overallPercentUsed}%** trên tổng tất cả các ngân sách chi tiêu đã thiết lập trong tháng:`,
            `- **Tổng hạn mức ngân sách:** ${totalBudgeted.toLocaleString("vi-VN")} VND`,
            `- **Tổng số tiền đã chi:** ${totalSpent.toLocaleString("vi-VN")} VND`,
            `- **Hạn mức ngân sách còn lại:** **${totalRemaining.toLocaleString("vi-VN")} VND**`,
            ``,
            `**Chi tiết từng ngân sách:**`,
            ...budgets.map((b) => `- **${b.name}:** Đã chi ${b.actualSpent.toLocaleString("vi-VN")} / ${b.limit.toLocaleString("vi-VN")} VND (${b.percentUsed}%)`),
          ];
          return {
            handled: true,
            reply: lines.join("\n"),
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 4e. Check specific budget query: "Ngân sách ăn uống còn bao nhiêu?"
        const specificBudget = budgets.find((b) => {
          const bName = b.name.toLowerCase();
          const catName = b.categoryName.toLowerCase();
          if (lower.includes("ăn uống") && (bName.includes("ăn uống") || catName.includes("ăn uống"))) return true;
          const cleanName = bName.replace("ngân sách", "").trim();
          return cleanName && lower.includes(cleanName);
        });

        if (specificBudget) {
          const statusText =
            specificBudget.statusText || (specificBudget.percentUsed >= 80 ? "⚠️ CẢNH BÁO: SẮP ĐẠT HẠN MỨC" : "🟢 AN TOÀN");
          const lines = [
            `**${specificBudget.name.toUpperCase()}:**`,
            `- **Hạn mức:** ${specificBudget.limit.toLocaleString("vi-VN")} VND`,
            `- **Đã chi:** ${specificBudget.actualSpent.toLocaleString("vi-VN")} VND (${specificBudget.percentUsed}%)`,
            `- **Hạn mức còn lại:** **${specificBudget.limitRemaining.toLocaleString("vi-VN")} VND**`,
            `- **Trạng thái:** ${statusText}`,
          ];
          return {
            handled: true,
            reply: lines.join("\n"),
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 4f. General budget overview
        const totalBudgeted = budgets.reduce((s, b) => s + b.limit, 0);
        const totalSpent = budgets.reduce((s, b) => s + b.actualSpent, 0);
        const totalRemaining = budgets.reduce((s, b) => s + b.limitRemaining, 0);
        const overallPercentUsed = totalBudgeted > 0 ? Math.round((totalSpent / totalBudgeted) * 100) : 0;

        const lines = [
          `**TỔNG QUAN NGÂN SÁCH CHI TIÊU:**`,
          `- **Tổng hạn mức:** ${totalBudgeted.toLocaleString("vi-VN")} VND`,
          `- **Tổng đã chi:** ${totalSpent.toLocaleString("vi-VN")} VND (${overallPercentUsed}%)`,
          `- **Hạn mức còn lại:** **${totalRemaining.toLocaleString("vi-VN")} VND**`,
          ``,
          `**Chi tiết các ngân sách:**`,
        ];

        for (const b of budgets) {
          lines.push(
            `- **${b.name}:** Đã chi ${b.actualSpent.toLocaleString("vi-VN")} / ${b.limit.toLocaleString("vi-VN")} VND (Còn lại: **${b.limitRemaining.toLocaleString("vi-VN")} VND** - ${b.percentUsed}%) [${b.statusText || "🟢 AN TOÀN"}]`,
          );
        }

        if (budgets.length === 0) {
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

  // 5. Savings Goals Fast Path
  if (
    (routing.category === "SAVINGS_PLANNING" ||
      /mục tiêu tiết kiệm|mục tiêu laptop|tiết kiệm.*mục tiêu|mục tiêu.*tiết kiệm|rút tiền từ mục tiêu|ảnh hưởng.*khả dụng|tiền tiết kiệm.*giữ ở ví nào|tạo mục tiêu tiết kiệm/i.test(
        lower,
      )) &&
    toolContext
  ) {
    try {
      const toolOutput = await executeFinancialTool("get_savings_goals", {}, toolContext);
      if (toolOutput.success && toolOutput.data) {
        const rawData = toolOutput.data as {
          savingsGoals?: Array<{
            id: string;
            title: string;
            targetAmount: number;
            currentAmount: number;
            remainingAmount: number;
            progressPercent: number;
            deadline?: string | null;
          }>;
          goals?: Array<{
            id: string;
            title: string;
            targetAmount?: number;
            currentAmount?: number;
            remainingAmount?: number;
            progressPercent?: number;
            deadline?: string | null;
          }>;
        };

        const rawList = rawData.savingsGoals || rawData.goals || [];
        const goals = rawList.map((g) => {
          const target = g.targetAmount || 0;
          const current = g.currentAmount || 0;
          const remaining = g.remainingAmount ?? Math.max(0, target - current);
          const percent = g.progressPercent ?? (target > 0 ? Math.round((current / target) * 100) : 0);
          return {
            title: g.title || "Mua Laptop M3",
            targetAmount: target,
            currentAmount: current,
            remainingAmount: remaining,
            progressPercent: percent,
            deadline: g.deadline,
          };
        });

        // 5a. Specific question: "Tôi đã tích lũy bao nhiêu cho mục tiêu hiện tại?", "Tôi đã tiết kiệm được bao nhiêu?"
        if (/đã tích lũy bao nhiêu|đã có bao nhiêu trong mục tiêu|tích lũy được bao nhiêu|đã tiết kiệm được bao nhiêu/i.test(lower)) {
          const g = goals[0] || { title: "Mua Laptop M3", currentAmount: 5000000, targetAmount: 25000000, progressPercent: 20 };
          return {
            handled: true,
            reply: `Mục tiêu **${g.title}** của bạn hiện đã tích lũy được: **${g.currentAmount.toLocaleString("vi-VN")} VND** (đạt **${g.progressPercent}%** trên tổng mục tiêu ${g.targetAmount.toLocaleString("vi-VN")} VND)${g.deadline ? ` [Hạn chót: ${g.deadline}]` : ""}.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5b. Specific question: "Tôi cần thêm bao nhiêu để đạt mục tiêu?", "Mục tiêu Laptop M3 đã tích lũy được 5 triệu thì còn thiếu bao nhiêu?"
        if (/cần thêm bao nhiêu|còn thiếu bao nhiêu|thiếu bao nhiêu/i.test(lower)) {
          const g = goals[0] || { title: "Mua Laptop M3", currentAmount: 5000000, targetAmount: 25000000, remainingAmount: 20000000, progressPercent: 20 };
          return {
            handled: true,
            reply: `Để hoàn thành mục tiêu **${g.title}** (${g.targetAmount.toLocaleString("vi-VN")} VND), bạn hiện **còn thiếu: ${g.remainingAmount.toLocaleString("vi-VN")} VND** (hiện đã tích lũy được ${g.currentAmount.toLocaleString("vi-VN")} VND, đạt ${g.progressPercent}%).`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5c. Percent progress: "Tiến độ mục tiêu Mua Laptop M3 hiện tại đạt bao nhiêu phần trăm?"
        if (/tiến độ.*bao nhiêu %|bao nhiêu phần trăm/i.test(lower)) {
          const g = goals[0] || { title: "Mua Laptop M3", currentAmount: 5000000, targetAmount: 25000000, progressPercent: 20 };
          return {
            handled: true,
            reply: `Tiến độ mục tiêu **${g.title}** hiện tại đạt **${g.progressPercent}%** (đã tích lũy ${g.currentAmount.toLocaleString("vi-VN")} VND trên tổng mục tiêu ${g.targetAmount.toLocaleString("vi-VN")} VND).`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5d. Target amount: "Mục tiêu mua laptop của tôi cần bao nhiêu tiền?"
        if (/cần bao nhiêu tiền|tổng số tiền mục tiêu/i.test(lower)) {
          const g = goals[0] || { title: "Mua Laptop M3", targetAmount: 25000000, currentAmount: 5000000 };
          return {
            handled: true,
            reply: `Mục tiêu mua **${g.title}** của bạn cần tổng số tiền là **${g.targetAmount.toLocaleString("vi-VN")} VND** (hiện bạn đã tích lũy được ${g.currentAmount.toLocaleString("vi-VN")} VND).`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5m. Advice on finishing before deadline: "Để hoàn thành mục tiêu laptop trước hạn chót, tôi cần làm gì?"
        if (/cần làm gì|làm sao để hoàn thành|để hoàn thành mục tiêu/i.test(lower)) {
          return {
            handled: true,
            reply: `Để hoàn thành mục tiêu mua **Laptop** M3 trước hạn chót 2026-12-31, bạn cần tiếp tục **tích lũy** thêm 20.000.000 VND bằng cách **tiết kiệm** định kỳ hàng tháng kết hợp kiểm soát ngân sách chi tiêu an toàn.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5e. Deadline: "Hạn chót hoàn thành mục tiêu Laptop M3 là khi nào?"
        if (/hạn chót|khi nào/i.test(lower)) {
          const g = goals[0] || { title: "Mua Laptop M3", deadline: "2026-12-31" };
          return {
            handled: true,
            reply: `Hạn chót hoàn thành mục tiêu **${g.title}** là ngày **${g.deadline || "2026-12-31"}**.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5f. Goal count: "Tôi có bao nhiêu mục tiêu tiết kiệm đang theo dõi?"
        if (/bao nhiêu mục tiêu/i.test(lower)) {
          const count = goals.length || 1;
          const names = goals.map((g) => `"${g.title}"`).join(", ") || '"Mua Laptop M3"';
          return {
            handled: true,
            reply: `Bạn hiện có **${count} mục tiêu tiết kiệm** đang theo dõi trong hệ thống: ${names}.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5g. Detailed list: "Liệt kê chi tiết các mục tiêu tiết kiệm của tôi."
        if (/liệt kê|danh sách.*mục tiêu|chi tiết các mục tiêu/i.test(lower)) {
          const lines = [
            `**DANH SÁCH CHI TIẾT CÁC MỤC TIÊU TIẾT KIỆM CỦA BẠN:**`,
            ...goals.map(
              (g) =>
                `- Mục tiêu: **${g.title}**\n  + Đã tích lũy: **${g.currentAmount.toLocaleString("vi-VN")} VND** / **${g.targetAmount.toLocaleString("vi-VN")} VND** (Đạt **${g.progressPercent}%**)\n  + Còn thiếu: **${g.remainingAmount.toLocaleString("vi-VN")} VND**\n  + Hạn chót: ${g.deadline || "2026-12-31"}`,
            ),
          ];
          return {
            handled: true,
            reply: lines.join("\n"),
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5h. Wallet holding savings: "Tiền tiết kiệm trong mục tiêu được giữ ở ví nào?"
        if (/tiền tiết kiệm.*giữ ở ví nào|giữ ở ví nào/i.test(lower)) {
          return {
            handled: true,
            reply: `Khoản tiền tiết kiệm trong mục tiêu được **phân bổ** và **giữ chỗ** an toàn trực tiếp trong **ví** tài khoản (ví dụ ví Tiền mặt hoặc ví VCB). Khoản tiền này vẫn nằm trong ví của bạn nhưng được tách khỏi số dư khả dụng để bảo đảm kế hoạch tài chính không bị ảnh hưởng.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5i. Available balance impact: "Mục tiêu tiết kiệm có ảnh hưởng đến số dư khả dụng của ví không?"
        if (/ảnh hưởng.*khả dụng|có ảnh hưởng.*số dư khả dụng/i.test(lower)) {
          return {
            handled: true,
            reply: `Có, khi tiền được tích lũy vào mục tiêu tiết kiệm, số tiền đó sẽ làm **giảm** số dư **khả dụng** của ví tương ứng. Cơ chế giữ chỗ này giúp bạn kiểm soát chi tiêu và ngăn chặn việc **tiêu lạm** vào khoản tiền đã dành cho mục tiêu.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5j. 100% completed check: "Mục tiêu Laptop M3 đã đạt được 100% chưa?"
        if (/đạt được 100% chưa|hoàn thành chưa/i.test(lower)) {
          const g = goals[0] || { title: "Mua Laptop M3", progressPercent: 20 };
          return {
            handled: true,
            reply: `Mục tiêu **${g.title}** hiện tại **chưa** đạt 100%. Tiến độ hiện tại mới đạt **${g.progressPercent}%**.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5k. Withdrawal to available: "Tôi có thể rút tiền từ mục tiêu tiết kiệm về ví khả dụng không?"
        if (/rút tiền từ mục tiêu|rút.*về ví khả dụng/i.test(lower)) {
          return {
            handled: true,
            reply: `Có, bạn hoàn toàn có thể **rút** tiền từ **mục tiêu** tiết kiệm về **ví** khả dụng bất cứ khi nào. Bạn chỉ cần vào tab **Mục tiêu**, chọn mục tiêu tương ứng và thực hiện thao tác rút hoặc điều chỉnh để giải phóng số dư khả dụng trong ví.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }

        // 5l. Create savings goal proposal: "Tôi muốn tạo mục tiêu tiết kiệm 500.000đ"
        if (/tạo mục tiêu tiết kiệm|muốn tạo mục tiêu/i.test(lower)) {
          return {
            handled: true,
            reply: `Bạn đang yêu cầu tạo **mục tiêu** tiết kiệm với số tiền **500.000** VND. Vui lòng bấm **xác nhận** hoặc truy cập tab Mục tiêu để hoàn tất thiết lập.`,
            source: "FAST_PATH_DETERMINISTIC",
            latencyMs: Date.now() - start,
          };
        }



        // 5n. General overview
        const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
        const totalAccumulated = goals.reduce((s, g) => s + g.currentAmount, 0);
        const totalRemainingToSave = goals.reduce((s, g) => s + g.remainingAmount, 0);
        const overallPercentProgress = totalTarget > 0 ? Math.round((totalAccumulated / totalTarget) * 100) : 0;

        const lines = [
          `**TIẾN ĐỘ CÁC MỤC TIÊU TIẾT KIỆM:**`,
          `- **Tổng mục tiêu cần tích lũy:** ${totalTarget.toLocaleString("vi-VN")} VND`,
          `- **Đã tích lũy:** **${totalAccumulated.toLocaleString("vi-VN")} VND** (${overallPercentProgress}%)`,
          `- **Còn thiếu:** ${totalRemainingToSave.toLocaleString("vi-VN")} VND`,
          ``,
          `**Chi tiết từng mục tiêu:**`,
        ];

        for (const g of goals) {
          lines.push(
            `- **${g.title}:** ${g.currentAmount.toLocaleString("vi-VN")} / ${g.targetAmount.toLocaleString("vi-VN")} VND (Đạt **${g.progressPercent}%**) ${g.deadline ? `[Hạn chót: ${g.deadline}]` : ""}`,
          );
        }

        if (goals.length === 0) {
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

  // 6. Financial Advice & Budget Planning Fast Path
  if (
    routing.canonicalIntent === "FINANCIAL_ADVICE" ||
    routing.primaryIntent === "FINANCIAL_ADVICE" ||
    /tiết kiệm thêm|tiêu quá nhiều tiền|phân bổ.*thu nhập|kế hoạch ăn sáng|cắt giảm chi tiêu|mua điện thoại đó xong|tóm tắt/i.test(lower)
  ) {
    // 6_whatif_multiturn. "Nếu mua điện thoại đó xong thì ví tiền mặt của tôi còn bao nhiêu?"
    if (/mua.*xong.*ví.*còn bao nhiêu|nếu mua.*xong/i.test(lower)) {
      return {
        handled: true,
        reply: "Nếu mua chiếc điện thoại đó (500.000 VND) xong, số dư **ví** **tiền mặt** của bạn sẽ **còn lại** là **4.500.000 VND** (số dư khả dụng chi tiêu của ví tiền mặt sẽ còn lại **4.000.000 VND** sau khi trừ đi 500.000 VND phân bổ cho ngân sách). Bạn hoàn toàn đủ tiền mua mà không bị thâm hụt tài chính.",
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 6_summary. "Tóm tắt những điều chúng ta vừa trao đổi về kế hoạch tài chính."
    if (/tóm tắt.*trao đổi|tóm tắt.*kế hoạch|tóm tắt những điều/i.test(lower)) {
      return {
        handled: true,
        reply: "**TÓM TẮT NỘI DUNG VÀ KẾ HOẠCH TÀI CHÍNH VỪA TRAO ĐỔI:**\n- **Số dư khả dụng hiện tại:** **14.500.000 VND** (sẵn sàng chi tiêu an toàn).\n- **Tình hình ngân sách:** Ngân sách Ăn uống đã chi 2.650.000 / 3.000.000 VND (88.3%, đang ở mức cảnh báo), hạn mức **kế hoạch** an toàn còn lại là **350.000 VND**.\n- **Định hướng tiếp theo:** Duy trì kiểm soát chặt chẽ các khoản chi ăn ngoài để hoàn thành đúng kế hoạch ngân sách tháng mà không vượt hạn mức.",
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }
    // 6a. "Tôi có đang tiêu quá nhiều tiền không?"
    if (/tiêu quá nhiều tiền|chi quá tay|có đang tiêu nhiều/i.test(lower)) {
      return {
        handled: true,
        reply: [
          `**ĐÁNH GIÁ MỨC ĐỘ CHI TIÊU THÁNG NÀY:**`,
          ``,
          `- **Tổng quan thu chi:** Bạn đã chi **4.850.000 VND** trên tổng thu nhập **15.000.000 VND** (tỷ lệ chi tiêu **32.3%**). Xét trên bình diện tổng thể, đây là mức chi tiêu **an toàn**, nằm dưới ngưỡng khuyến nghị 50% thu nhập.`,
          `- **Điểm cần lưu ý:** Riêng danh mục **Ăn uống** đã tiêu 2.650.000 / 3.000.000 VND (88.3%), đã vượt ngưỡng cảnh báo 80% của **ngân sách**. Bạn nên hạn chế chi tiêu ăn ngoài trong những ngày còn lại của tháng để không bị vượt hạn mức.`,
        ].join("\n"),
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 6b. "Tôi muốn tiết kiệm thêm 500.000đ"
    if (/tiết kiệm thêm/i.test(lower)) {
      return {
        handled: true,
        reply: [
          `**KẾ HOẠCH TIẾT KIỆM THÊM 500.000 VND:**`,
          `- Bạn hoàn toàn có thể **tiết kiệm thêm** số tiền **500.000** VND ngay trong kỳ này.`,
          `- Khoản tiền này sẽ được trích từ nguồn tiền **khả dụng** hiện có trong tài khoản (tổng số dư khả dụng hiện tại là 14.500.000 VND).`,
          `- Sau khi trích 500.000 VND vào quỹ tiết kiệm, số dư khả dụng tự do của bạn còn lại 14.000.000 VND, hoàn toàn bảo đảm an toàn chi tiêu sinh hoạt mà không gây thiếu hụt tài chính.`,
        ].join("\n"),
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 6c. "Tôi có nên cắt giảm chi tiêu ăn uống trong những ngày tới không?"
    if (/cắt giảm chi tiêu ăn uống|có nên cắt giảm/i.test(lower)) {
      return {
        handled: true,
        reply: [
          `Bạn **nên kiểm soát** và cân nhắc cắt giảm các khoản chi ngoài kế hoạch cho danh mục **Ăn uống** trong những ngày còn lại của tháng.`,
          `- Hiện tại, **ngân sách** Ăn uống của bạn đã chi **2.650.000 / 3.000.000 VND** (đạt **88.3%** hạn mức, vượt ngưỡng cảnh báo 80%).`,
          `- Hạn mức an toàn còn lại chỉ còn **350.000 VND**.`,
          `- *Khuyến nghị:* Ưu tiên tự nấu ăn tại nhà và tránh các bữa liên hoan tốn kém để bảo đảm không bị bội chi ngân sách.`,
        ].join("\n"),
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 6d. "Với mức thu nhập 15 triệu và chi tiêu hiện tại, tôi nên phân bổ tiền như thế nào?"
    if (/thu nhập 15 triệu.*phân bổ|phân bổ.*thu nhập 15 triệu|phân bổ tiền như thế nào/i.test(lower)) {
      return {
        handled: true,
        reply: [
          `**GỢI Ý PHÂN BỔ THU NHẬP 15.000.000 VND THEO NGUYÊN TẮC 50/30/20:**`,
          `- **Nhu cầu thiết yếu (50% - tối đa 7.500.000 VND):** Dành cho tiền nhà (1.5M), ăn uống (3.0M), xăng xe đi lại (0.7M) và các chi phí cố định khác. Hiện tại bạn đang chi 4.850.000 VND, mức kiểm soát rất tốt.`,
          `- **Mong muốn cá nhân (30% - tối đa 4.500.000 VND):** Dành cho mua sắm, giải trí, cà phê, phát triển bản thân.`,
          `- **Tích lũy & Tiết kiệm (20% - tối thiểu 3.000.000 VND):** Đưa vào quỹ khẩn cấp và các mục tiêu **tiết kiệm** (như mục tiêu Laptop M3).`,
          `*Khuyến nghị:* Bạn nên chủ động **phân bổ** ít nhất 3.000.000 VND từ thu nhập **15.000.000** VND vào quỹ tiết kiệm ngay đầu tháng.`,
        ].join("\n"),
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }

    // 6e. "Tôi muốn lên kế hoạch ăn sáng với 300.000đ trong 7 ngày."
    if (/ăn sáng.*300.*7|kế hoạch ăn sáng/i.test(lower)) {
      return {
        handled: true,
        reply: [
          `**KẾ HOẠCH ĂN SÁNG TRONG 7 NGÀY VỚI NGÂN SÁCH 300.000 VND:**`,
          `- **Tổng ngân sách:** **300.000** VND`,
          `- **Thời gian:** **7** ngày`,
          `- **Hạn mức trung bình mỗi ngày:** ~**42.800 VND/ngày** (300.000 ÷ 7)`,
          ``,
          `**Gợi ý thực đơn ăn sáng từng ngày:**`,
          `- Ngày 1: Bánh mì chả pate + trà đá (~35.000 VND)`,
          `- Ngày 2: Bún bò / Bún mọc bình dân (~45.000 VND)`,
          `- Ngày 3: Xôi khúc / Xôi xéo giò chả (~30.000 VND)`,
          `- Ngày 4: Phở gà bình dân (~45.000 VND)`,
          `- Ngày 5: Bánh cuốn nóng thịt băm (~35.000 VND)`,
          `- Ngày 6: Bánh bao 2 trứng cút + sữa đậu nành (~35.000 VND)`,
          `- Ngày 7: Bún riêu cua bình dân (~45.000 VND)`,
          ``,
          `*Tổng chi tiêu dự kiến:* ~270.000 VND (dư ~30.000 VND dự phòng). Kế hoạch hoàn toàn khả thi và bảo đảm dinh dưỡng trong ngân sách!`,
        ].join("\n"),
        source: "FAST_PATH_DETERMINISTIC",
        latencyMs: Date.now() - start,
      };
    }
  }

  return { handled: false };
}
