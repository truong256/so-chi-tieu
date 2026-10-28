/**
 * backend/src/services/financial-simulation.service.ts
 * ====================================================
 * Dedicated Deterministic Financial Simulation & Multi-turn What-If Engine.
 *
 * Guarantees:
 * 1. Strict Isolation: Simulations NEVER mutate the database or modify real balances.
 * 2. Anaphora & Context Retention: Resolves pronouns ("điện thoại đó", "khoản chi vừa nói",
 *    "số tiền còn lại đó", "nếu không mua") to active conversational entities.
 * 3. Deterministic Math: Computes remaining available funds, budget headroom, and affordability
 *    using pure backend mathematics. LLMs never calculate or invent numbers.
 * 4. Anti-hallucination Guardrails: Prevents injecting fake transactions (e.g. 500k templates).
 */

import { parsePurchaseQuery } from "./financial-tools.service.ts";
import type { AuthoritativeFinancialSnapshot } from "./financial-snapshot.service.ts";
import type { ServerFinancialContext } from "./financial-context.service.ts";

export interface HypotheticalPurchase {
  itemName: string;
  price: number;
  category?: string;
  sourceWalletName?: string;
}

export interface SimulationBudgetComparison {
  budgetName: string;
  budgetLimit: number;
  budgetSpent: number;
  budgetRemaining: number;
  isRemainingFundsSufficient: boolean;
  surplusOrDeficit: number;
  explanation: string;
}

export type SimulationScenarioType =
  | "PURCHASE_WHATIF"
  | "PURCHASE_FOLLOWUP"
  | "REMAINING_AVAILABLE"
  | "REMAINING_FUNDS"
  | "BUDGET_COMPARISON"
  | "REVERSAL"
  | "PURCHASE_REVERSAL"
  | "PLANNING_WITH_REMAINING";

export interface SimulationResult {
  isSimulated: true;
  scenarioType: SimulationScenarioType;
  hypotheticalPurchase: HypotheticalPurchase;
  baselineAssets: number;
  baselineAllocated: number;
  baselineAvailable: number;
  remainingAvailable: number;
  remainingAssets: number;
  isAffordable: boolean;
  shortfall: number;
  targetBudgetComparison?: SimulationBudgetComparison | null;
  summaryVi: string;
}

/**
 * Scan chat history in reverse to find the most recent hypothetical purchase scenario.
 */
export function extractActivePurchaseFromHistory(
  history: Array<{ role: string; parts?: Array<{ text: string }> }>,
): HypotheticalPurchase | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const text = msg.parts?.[0]?.text || "";

    // 1. Check user query in history
    if (msg.role === "user") {
      const parsed = parsePurchaseQuery(text);
      if (parsed && parsed.price > 0) {
        return {
          itemName: parsed.itemName,
          price: parsed.price,
          category: parsed.category,
        };
      }

      // Regex matching pattern e.g. "mua điện thoại giá 3 triệu" or "mua xe 20tr"
      const match = text.match(
        /(?:mua|sắm|chi|đầu tư)\s+([^0-9,.]+?)(?:\s+(?:giá|hết|mất|\d)|$|[?.,!])/i,
      );
      if (match) {
        const item = match[1].trim();
        const priceMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(triệu|tr|nghìn|ngàn|k|vnd|đ)/i);
        if (priceMatch) {
          let price = parseFloat(priceMatch[1].replace(",", "."));
          const unit = priceMatch[2].toLowerCase();
          if (unit === "triệu" || unit === "tr") price *= 1_000_000;
          else if (unit === "nghìn" || unit === "ngàn" || unit === "k") price *= 1_000;
          if (price > 0) {
            return {
              itemName: item,
              price,
            };
          }
        }
      }
    }

    // 2. Check model's response if it acknowledged a specific item and price
    if (msg.role === "model" || msg.role === "assistant") {
      const itemMatch = text.match(/ĐÁNH GIÁ KHẢ NĂNG CHI TRẢ "([^"]+)"\s*\(GIÁ\s*([\d.]+)\s*VND\)/i);
      if (itemMatch) {
        const item = itemMatch[1];
        const price = parseFloat(itemMatch[2].replace(/\./g, ""));
        if (price > 0) {
          return { itemName: item, price };
        }
      }
    }
  }

  return null;
}

export interface MultiTurnReferenceResult {
  hasReference: boolean;
  referenceType?:
    | "PURCHASE_FOLLOWUP"
    | "REMAINING_FUNDS"
    | "BUDGET_COMPARISON"
    | "REVERSAL"
    | "PLANNING_WITH_REMAINING";
  targetBudgetName?: string;
  referencedPurchase?: HypotheticalPurchase | null;
}

function stripAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Detect whether the incoming user message contains anaphoric pronouns or follow-up references.
 */
export function detectMultiTurnReference(
  message: string,
  history: Array<{ role: string; parts?: Array<{ text: string }> }>,
): MultiTurnReferenceResult {
  if (!history || history.length === 0) {
    return { hasReference: false };
  }

  const text = message.toLowerCase().trim();
  const unaccented = stripAccents(message);

  // 1. Reversal: "Còn nếu tôi không mua?", "Nếu không mua thì sao?"
  const isReversal =
    /(?:còn nếu|nếu)\s+(?:tôi\s+)?(?:không mua|hủy mua|không chi|bỏ qua|không lấy)/i.test(text) ||
    /(?:con neu|neu)\s+(?:toi\s+)?(?:khong mua|huy mua|khong chi|bo qua|khong lay)/i.test(unaccented);
  if (isReversal) {
    const purchase = extractActivePurchaseFromHistory(history);
    return {
      hasReference: true,
      referenceType: "REVERSAL",
      referencedPurchase: purchase,
    };
  }

  // 2. Budget comparison: "Số tiền còn lại đó có đủ cho ngân sách ăn uống không?", "Ngân sách ăn uống có đủ không?"
  const isBudgetComparison =
    /(?:số tiền còn lại|tiền còn lại|tiền đó|khoản còn lại).*(?:có đủ|đủ cho|đủ chi|dùng cho).*(?:ngân sách|hạn mức)/i.test(
      text,
    ) ||
    /(?:so tien con lai|tien con lai|tien do).*(?:co du|du cho|du chi).*(?:ngan sach|han muc)/i.test(
      unaccented,
    ) ||
    /(?:ngân sách|hạn mức)\s+([^?.,!]+?)(?:\s+(?:có đủ|thế nào|còn được|được không|không))/i.test(
      text,
    );

  if (isBudgetComparison) {
    const purchase = extractActivePurchaseFromHistory(history);
    // Extract target budget keyword (e.g. "ăn uống", "mua sắm", "tiêu vặt")
    let targetBudgetName: string | undefined;
    const bMatch = text.match(/(?:ngân sách|hạn mức)\s+([^?.,!]+?)(?:\s+(?:có đủ|thế nào|còn|được|không|$))/i);
    if (bMatch && bMatch[1]) {
      targetBudgetName = bMatch[1].trim();
    }

    return {
      hasReference: true,
      referenceType: "BUDGET_COMPARISON",
      targetBudgetName,
      referencedPurchase: purchase,
    };
  }

  // 3. Remaining funds query: "Nếu mua điện thoại đó, tôi sẽ còn bao nhiêu tiền khả dụng?", "Còn bao nhiêu tiền sau khi mua?"
  const isRemainingQuery =
    /(?:nếu mua|sau khi mua|mua xong|chi xong).*(?:còn bao nhiêu|khả dụng|sẽ còn|còn được)/i.test(text) ||
    /(?:neu mua|sau khi mua|mua xong|chi xong).*(?:con bao nhieu|kha dung|se con)/i.test(unaccented) ||
    /(?:số tiền còn lại|tiền còn lại|tiền thừa|khoản còn lại)\s*(?:đó|này)?\s*(?:là bao nhiêu|còn bao nhiêu|thế nào|có đủ|đủ không)/i.test(
      text,
    ) ||
    /(?:so tien con lai|tien con lai|tien thua)\s*(?:do|nay)?\s*(?:la bao nhieu|con bao nhieu|the nao|co du|du khong)/i.test(
      unaccented,
    );

  if (isRemainingQuery) {
    const purchase = extractActivePurchaseFromHistory(history);
    return {
      hasReference: true,
      referenceType: "REMAINING_FUNDS",
      referencedPurchase: purchase,
    };
  }

  // 4. Anaphora item reference: "điện thoại đó", "món đồ đó", "cái đó", "khoản chi vừa nói"
  const hasItemPronoun =
    /(?:điện thoại|món đồ|sản phẩm|xe|laptop|thứ|khoản chi|cái)\s+(?:đó|này|kia|vừa nói|vừa hỏi)/i.test(
      text,
    ) ||
    /(?:dien thoai|mon do|san pham|xe|laptop|thu|khoan chi|cai)\s+(?:do|nay|kia|vua noi|vua hoi)/i.test(
      unaccented,
    );
  if (hasItemPronoun) {
    const purchase = extractActivePurchaseFromHistory(history);
    return {
      hasReference: true,
      referenceType: "PURCHASE_FOLLOWUP",
      referencedPurchase: purchase,
    };
  }

  // 5. Planning with remaining funds: "Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?" or "Với số tiền còn lại đó tôi có tiết kiệm được 500k không?"
  const isPlanningWithRemaining =
    /(?:với|bằng)?\s*(?:số tiền còn lại|tiền còn lại|tiền thừa|khoản còn lại|số tiền đó|tiền đó).*(?:thì\s+)?(?:ăn gì|ăn sáng|ăn trưa|ăn tối|mua gì|làm gì|kế hoạch|chi tiêu|sắm gì|tiêu gì|tiết kiệm|để dành|tích lũy|bỏ vào)/i.test(
      text,
    ) ||
    /(?:voi|bang)?\s*(?:so tien con lai|tien con lai|tien thua|khoan con lai|so tien do|tien do).*(?:thi\s+)?(?:an gi|an sang|an trua|an toi|mua gi|lam gi|ke hoach|chi tieu|sam gi|tieu gi|tiet kiem|de danh|tich luy|bo vao)/i.test(
      unaccented,
    );

  if (isPlanningWithRemaining) {
    const purchase = extractActivePurchaseFromHistory(history);
    return {
      hasReference: true,
      referenceType: "PLANNING_WITH_REMAINING",
      referencedPurchase: purchase,
    };
  }

  return { hasReference: false };
}

/**
 * Execute deterministic What-If simulation without modifying database.
 */
export function runFinancialSimulation(
  snapshot: AuthoritativeFinancialSnapshot,
  purchase: HypotheticalPurchase,
  options?: {
    scenarioType?: SimulationResult["scenarioType"];
    targetBudgetQuery?: string;
    serverContext?: ServerFinancialContext | null;
  },
): SimulationResult {
  const baselineAssets = snapshot.totalAssets;
  const baselineAllocated = snapshot.totalAllocated;
  const baselineAvailable = snapshot.totalAvailable;

  const price = Math.max(0, purchase.price);
  const isAffordable = baselineAvailable >= price;
  const remainingAvailable = baselineAvailable - price;
  const remainingAssets = baselineAssets - price;
  const shortfall = isAffordable ? 0 : price - baselineAvailable;

  const scenarioType = options?.scenarioType || "PURCHASE_WHATIF";

  // Evaluate target budget if user asked e.g. "ngân sách ăn uống"
  let targetBudgetComparison: SimulationBudgetComparison | null = null;
  if (options?.targetBudgetQuery && options?.serverContext?.budgets) {
    const queryLower = options.targetBudgetQuery.toLowerCase();
    const matchedBudget = options.serverContext.budgets.find((b) =>
      b.name.toLowerCase().includes(queryLower),
    );

    if (matchedBudget) {
      const budgetRemaining = matchedBudget.limitRemaining ?? matchedBudget.remaining_amount ?? 0;
      // Compare hypothetical remaining available funds with the remaining budget requirement
      const isSufficient = remainingAvailable >= budgetRemaining;
      const surplusOrDeficit = remainingAvailable - budgetRemaining;

      let explanation = "";
      if (isSufficient) {
        explanation = `Số tiền khả dụng còn lại (${remainingAvailable.toLocaleString("vi-VN")} VND) HOÀN TOÀN ĐỦ để chi trả phần hạn mức còn lại của ngân sách "${matchedBudget.name}" (${budgetRemaining.toLocaleString("vi-VN")} VND), bạn vẫn còn dư ${surplusOrDeficit.toLocaleString("vi-VN")} VND tự do.`;
      } else {
        explanation = `Số tiền khả dụng còn lại (${remainingAvailable.toLocaleString("vi-VN")} VND) KHÔNG ĐỦ để bao quát hết hạn mức còn lại của ngân sách "${matchedBudget.name}" (${budgetRemaining.toLocaleString("vi-VN")} VND, thiếu ${Math.abs(surplusOrDeficit).toLocaleString("vi-VN")} VND).`;
      }

      targetBudgetComparison = {
        budgetName: matchedBudget.name,
        budgetLimit: matchedBudget.limit ?? matchedBudget.amount ?? 0,
        budgetSpent: matchedBudget.actualSpent ?? matchedBudget.spent_amount ?? 0,
        budgetRemaining,
        isRemainingFundsSufficient: isSufficient,
        surplusOrDeficit,
        explanation,
      };
    }
  }

  // Format crystal-clear deterministic instructions
  const lines: string[] = [
    `=== KỊCH BẢN GIẢ LẬP TÀI CHÍNH (WHAT-IF SIMULATION - DỮ LIỆU ĐƯỢC BẢO TOÀN TỪ LỊCH SỬ) ===`,
    `- Món đồ giả định đang xem xét: "${purchase.itemName}" (Giá: ${price.toLocaleString("vi-VN")} VND).`,
    `- Dữ liệu tài chính thực tế hiện tại (từ Supabase):`,
    `  + Tổng tài sản: ${baselineAssets.toLocaleString("vi-VN")} VND`,
    `  + Đã phân bổ: ${baselineAllocated.toLocaleString("vi-VN")} VND`,
    `  + Số dư khả dụng thực tế: ${baselineAvailable.toLocaleString("vi-VN")} VND`,
  ];

  if (scenarioType === "REVERSAL") {
    lines.push(`\n[KỊCH BẢN NẾU KHÔNG MUA]:`);
    lines.push(
      `- Nếu người dùng quyết định KHÔNG MUA "${purchase.itemName}", toàn bộ số tiền khả dụng ${baselineAvailable.toLocaleString("vi-VN")} VND và tổng tài sản ${baselineAssets.toLocaleString("vi-VN")} VND vẫn được BẢO TOÀN NGUYÊN VẸN.`,
    );
    lines.push(`- CHỈ THỊ BẮT BUỘC: Khẳng định số dư khả dụng giữ nguyên ${baselineAvailable.toLocaleString("vi-VN")} VND.`);
  } else {
    lines.push(`\n[KẾT QUẢ TÍNH TOÁN GIẢ LẬP TOÁN HỌC]:`);
    lines.push(
      `- Công thức: Số dư khả dụng sau khi mua = ${baselineAvailable.toLocaleString("vi-VN")} - ${price.toLocaleString("vi-VN")} = ${remainingAvailable.toLocaleString("vi-VN")} VND.`,
    );
    lines.push(
      `- Đánh giá khả năng chi trả: ${isAffordable ? "HOÀN TOÀN ĐỦ TIỀN KHẢ DỤNG ĐỂ CHI TRẢ" : "KHÔNG ĐỦ TIỀN KHẢ DỤNG (Thiếu " + shortfall.toLocaleString("vi-VN") + " VND)"}.`,
    );

    if (targetBudgetComparison) {
      lines.push(`\n[ĐÁNH GIÁ VỚI NGÂN SÁCH "${targetBudgetComparison.budgetName.toUpperCase()}"]:`);
      lines.push(
        `- Hạn mức ngân sách "${targetBudgetComparison.budgetName}" còn lại trong tháng: ${targetBudgetComparison.budgetRemaining.toLocaleString("vi-VN")} VND (Đã chi ${targetBudgetComparison.budgetSpent.toLocaleString("vi-VN")} / ${targetBudgetComparison.budgetLimit.toLocaleString("vi-VN")} VND).`,
      );
      lines.push(`- So sánh: ${targetBudgetComparison.explanation}`);
    }

    lines.push(`\nQUY TẮC BẮT BUỘC CHO AI:`);
    lines.push(`1. Trả lời chính xác số dư khả dụng sau khi mua "${purchase.itemName}" là ${remainingAvailable.toLocaleString("vi-VN")} VND.`);
    lines.push(`2. TUYỆT ĐỐI KHÔNG tự đổi giá món đồ thành 500.000 VND hay bất kỳ con số nào khác!`);
    lines.push(`3. TUYỆT ĐỐI KHÔNG tự bịa ra giao dịch mua sắm 500.000 VND không có thực.`);
    if (targetBudgetComparison) {
      lines.push(
        `4. Khi hỏi về ngân sách "${targetBudgetComparison.budgetName}": Báo cáo rõ số tiền còn lại (${remainingAvailable.toLocaleString("vi-VN")} VND) ${targetBudgetComparison.isRemainingFundsSufficient ? "HOÀN TOÀN ĐỦ" : "KHÔNG ĐỦ"} cho hạn mức còn lại (${targetBudgetComparison.budgetRemaining.toLocaleString("vi-VN")} VND).`,
      );
    }
    lines.push(`5. Nhấn mạnh đây là kịch bản giả lập What-If, số dư thật trong tài khoản KHÔNG hề bị trừ.`);
  }

  lines.push(`=== HẾT DỮ LIỆU KỊCH BẢN GIẢ LẬP ===`);

  return {
    isSimulated: true,
    scenarioType,
    hypotheticalPurchase: purchase,
    baselineAssets,
    baselineAllocated,
    baselineAvailable,
    remainingAvailable,
    remainingAssets,
    isAffordable,
    shortfall,
    targetBudgetComparison,
    summaryVi: lines.join("\n"),
  };
}
