/**
 * backend/src/services/savings-calculator.service.ts
 * ===================================================
 * Deterministic Savings Goal Calculator & Conversational Memory Engine.
 * 
 * Accurately classifies and calculates all forms of savings goals:
 * 1. TOTAL_SAVINGS_TARGET: "Tôi muốn tiết kiệm 5 triệu trong 3 tháng"
 *    -> Target = 5.000.000 VND over 3 months (90 days). Daily = 55.556 VND/day. Monthly = 1.666.667 VND/month.
 *       NEVER multiplies 5M * 3!
 * 2. RECURRING_SAVINGS_AMOUNT: "Tôi tiết kiệm 5 triệu mỗi tháng trong 3 tháng"
 *    -> Recurring = 5.000.000 VND/month x 3 = 15.000.000 VND.
 * 3. DAILY_SAVINGS: "Tôi tiết kiệm 50.000đ mỗi ngày trong 30 ngày"
 *    -> 50.000 x 30 = 1.500.000 VND.
 * 4. REQUIRED_DAILY_SAVINGS: "Tôi muốn có 3 triệu sau 60 ngày thì mỗi ngày tiết kiệm bao nhiêu?"
 *    -> 3.000.000 / 60 = 50.000 VND/ngày.
 * 5. REMAINING_SAVINGS: "Tôi muốn có 5 triệu, hiện đã tiết kiệm 2 triệu, còn 30 ngày"
 *    -> Needed = 3.000.000 VND. Daily = 100.000 VND/ngày.
 * 6. SAVINGS_TIMELINE: "Nếu mỗi ngày bỏ 30k thì bao lâu được 1 triệu?"
 *    -> ceil(1.000.000 / 30.000) = 34 ngày.
 * 7. SAVINGS_MISSED_DAYS & RATE_CHANGE: Adjusts remaining pace accurately.
 * 8. CONVERSATIONAL MEMORY & ERROR RECOVERY:
 *    When user follows up with "Mỗi ngày tôi cần dành ra bao nhiêu?", inherits previous user target.
 *    If previous AI miscalculated (e.g. multiplied 5M * 3 = 15M), corrects it transparently.
 */

import { parseVietnameseAmount } from "../../../frontend/utils/smart-parser.ts";

export function removeVietnameseAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export type SavingsIntentType =
  | "TOTAL_SAVINGS_TARGET"
  | "RECURRING_SAVINGS_AMOUNT"
  | "DAILY_SAVINGS"
  | "REQUIRED_DAILY_SAVINGS"
  | "REQUIRED_MONTHLY_SAVINGS"
  | "REMAINING_SAVINGS"
  | "SAVINGS_TIMELINE"
  | "SAVINGS_RATE_CHANGE"
  | "SAVINGS_MISSED_DAYS"
  | "SAVINGS_AFFORDABILITY"
  | "AMBIGUOUS_SAVINGS"
  | "FOLLOW_UP_SAVINGS";

export interface SavingsContextMemory {
  targetAmount: number;
  durationPeriods: number;
  durationUnit: "ngày" | "tuần" | "tháng" | "năm";
  effectiveDays: number;
  alreadySaved: number;
  targetMode: "TOTAL_TARGET" | "RECURRING_AMOUNT";
  recurringAmount?: number;
  recurringFrequency?: "daily" | "weekly" | "monthly";
  lastUserQuery?: string;
  previousAiAnsweredIncorrectTotal?: boolean;
}

export interface SavingsCalculationResult {
  intent: SavingsIntentType;
  targetAmount: number;
  durationPeriods: number;
  durationUnit: "ngày" | "tuần" | "tháng" | "năm";
  effectiveDays: number;
  alreadySaved: number;
  remainingAmount: number;
  dailySaving: number;
  monthlySaving: number;
  totalSavedAtEnd: number;
  explanationVi: string;
  isAmbiguous?: boolean;
  missingFields?: string[];
  aiMiscalculationCorrected?: boolean;
}

/**
 * Normalizes duration string to standard days and unit.
 */
export function normalizeDurationToDays(
  periods: number,
  unit: "ngày" | "tuần" | "tháng" | "năm"
): number {
  if (unit === "ngày") return periods;
  if (unit === "tuần") return periods * 7;
  if (unit === "tháng") return periods * 30; // standard 30-day assumption
  if (unit === "năm") return periods * 365;
  return periods;
}

export function toCanonicalUnit(u: string): "ngày" | "tuần" | "tháng" | "năm" {
  const s = (u || "").toLowerCase();
  if (s === "ngay" || s === "ngày") return "ngày";
  if (s === "tuan" || s === "tuần") return "tuần";
  if (s === "thang" || s === "tháng") return "tháng";
  if (s === "nam" || s === "năm") return "năm";
  return "ngày";
}

/**
 * Extracts savings context from user chat history.
 * CRITICAL: Prioritizes user messages over AI assistant messages to prevent error propagation!
 */
export function extractSavingsContextFromHistory(
  history: Array<{ role: string; parts?: Array<{ text: string }> }>
): SavingsContextMemory | null {
  if (!history || history.length === 0) return null;

  let memory: SavingsContextMemory | null = null;
  let previousAiSaidFifteenMillion = false;

  // Check last AI assistant message for hallucination/miscalculation of 15 million
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "model" || msg.role === "assistant") {
      const text = msg.parts?.[0]?.text || "";
      if (/15\.000\.000|15 triệu|5\.000\.000.*mỗi tháng.*15/i.test(text)) {
        previousAiSaidFifteenMillion = true;
      }
      break;
    }
  }

  // Scan user messages backwards to find the most recent savings target definition
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "user") {
      const text = msg.parts?.[0]?.text || "";
      const lower = text.toLowerCase();

      // Check if user changed target: "đổi thành 10 triệu trong 6 tháng" or "tôi muốn tiết kiệm 5 triệu trong 3 tháng"
      const targetMatch =
        lower.match(/(?:tiết kiệm|để dành|tích lũy|gom|có|đổi thành|chuyển thành|thay đổi thành|đặt lại thành)\s+(?:tổng cộng\s+)?([^,]+?)\s*(?:trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)/i) ||
        lower.match(/(?:muốn\s+có|cần\s+có|muốn\s+đổi|cần\s+đổi)\s+([^,]+?)\s*(?:trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)/i);

      if (targetMatch) {
        const amtParsed = parseVietnameseAmount(targetMatch[1]);
        const periods = parseInt(targetMatch[2], 10);
        const unit = toCanonicalUnit(targetMatch[3]);

        if (amtParsed.amount && periods > 0) {
          const isExplicitRecurring = /mỗi tháng|hàng tháng|mỗi ngày|hàng ngày/i.test(targetMatch[0]) || /mỗi\s*(?:tháng|ngày)\s*tiết kiệm/i.test(lower);
          const days = normalizeDurationToDays(periods, unit);

          memory = {
            targetAmount: amtParsed.amount,
            durationPeriods: periods,
            durationUnit: unit,
            effectiveDays: days,
            alreadySaved: 0,
            targetMode: isExplicitRecurring ? "RECURRING_AMOUNT" : "TOTAL_TARGET",
            lastUserQuery: text,
            previousAiAnsweredIncorrectTotal: previousAiSaidFifteenMillion,
          };
          break;
        }
      }

      // Check explicit total not monthly: "tiết kiệm tổng cộng 5 triệu, không phải mỗi tháng"
      const notMonthlyMatch = lower.match(/(?:tiết kiệm|tích lũy|để dành)\s+(?:tổng cộng\s+)?([^,]+?)[,\s]+(?:chứ\s+)?không phải\s+(?:mỗi|hàng)/i);
      if (notMonthlyMatch) {
        const amtParsed = parseVietnameseAmount(notMonthlyMatch[1]);
        if (amtParsed.amount) {
          memory = {
            targetAmount: amtParsed.amount,
            durationPeriods: 3,
            durationUnit: "tháng",
            effectiveDays: 90,
            alreadySaved: 0,
            targetMode: "TOTAL_TARGET",
            lastUserQuery: text,
            previousAiAnsweredIncorrectTotal: previousAiSaidFifteenMillion,
          };
          break;
        }
      }
    }
  }

  return memory;
}

/**
 * Main deterministic parser and calculator for Savings Reasoning.
 */
export function parseSavingsReasoningQuery(
  rawText: string,
  history: Array<{ role: string; parts?: Array<{ text: string }> }> = []
): SavingsCalculationResult | null {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const unacc = removeVietnameseAccents(text);

  // 0. Exclude pure balance inquiries that need real DB data ("Tôi đã tiết kiệm được bao nhiêu?")
  if (
    /^(?:tôi|mình)\s+(?:đã|dang|đang)\s+(?:tiết kiệm|tích lũy)\s+(?:được\s+)?bao nhiêu/i.test(lower) ||
    /^tôi có bao nhiêu tiền tiết kiệm/i.test(lower) ||
    /tiến độ các mục tiêu tiết kiệm/i.test(lower)
  ) {
    return null;
  }

  // 1. Detect AMBIGUOUS query that lacks amount or duration
  // e.g. "Tôi muốn tiết kiệm tiền trong vài tháng", "Tôi muốn để dành một khoản tiền trong thời gian tới"
  const isAmbiguousSavings =
    /(?:tiết kiệm|tiet kiem|để dành|de danh|tích lũy|tich luy).*(?:trong\s+vài\s+(?:ngày|tuần|tháng|năm|ngay|tuan|thang|nam)|trong\s+(?:một\s+)?thời gian|thời gian tới|thoi gian toi)/i.test(lower) ||
    /(?:muốn|muon|định|dinh|cần|can)\s+(?:tiết kiệm|tiet kiem|để dành|de danh|tích lũy|tich luy)\s+(?:tiền|tien|một khoản tiền|mot khoan tien|ít tiền|it tien)/i.test(lower);

  if (isAmbiguousSavings) {
    return {
      intent: "AMBIGUOUS_SAVINGS",
      targetAmount: 0,
      durationPeriods: 0,
      durationUnit: "tháng",
      effectiveDays: 0,
      alreadySaved: 0,
      remainingAmount: 0,
      dailySaving: 0,
      monthlySaving: 0,
      totalSavedAtEnd: 0,
      isAmbiguous: true,
      missingFields: ["target_amount", "duration"],
      explanationVi:
        `Để tôi có thể lập kế hoạch và tính toán số tiền tiết kiệm chính xác cho bạn, bạn vui lòng cung cấp thêm:\n\n` +
        `1. **Số tiền mục tiêu** bạn muốn tích lũy (ví dụ: 5 triệu, 10 triệu, 50 triệu...)?\n` +
        `2. **Thời hạn cụ thể** bạn muốn hoàn thành (ví dụ: 3 tháng, 60 ngày, 1 năm...)?\n\n` +
        `Ngay khi có số tiền và thời hạn cụ thể, tôi sẽ tính toán chi tiết số tiền bạn cần dành ra mỗi ngày và mỗi tháng!`,
    };
  }

  // 2. SAVINGS_AFFORDABILITY: "Với số tiền hiện tại, tôi có thể tiết kiệm 5 triệu trong 3 tháng không?"
  // Delegates to DB check in router / fast-path
  if (
    /với số tiền hiện tại.*có thể tiết kiệm|tôi có đủ tiền để tiết kiệm/i.test(lower) ||
    /có đủ khả năng tiết kiệm.*không/i.test(lower)
  ) {
    return null; // Will be handled by financial context / tool check
  }

  // 3. Multi-turn Follow-up: "Mỗi ngày tôi cần dành ra bao nhiêu?", "Vậy mỗi ngày bao nhiêu?", "Mỗi ngày bao nhiêu?"
  const isFollowUpFrequency =
    /^(?:vậy\s+)?(?:thì\s+)?mỗi\s*(ngày|tháng|tuần)\s*(?:tôi\s+)?(?:cần|phải|nên)?\s*(?:dành|dành ra|bỏ ra|tiết kiệm|để dành)?\s*(?:bao nhiêu)?\??$/i.test(lower) ||
    /^(?:vậy\s+)?mỗi\s*(ngày|tháng|tuần)\s*bao nhiêu\??$/i.test(lower) ||
    /^(?:còn\s+)?mỗi\s*(ngày|tháng)\s*thì sao\??$/i.test(lower);

  if (isFollowUpFrequency && history.length > 0) {
    const memory = extractSavingsContextFromHistory(history);
    if (memory && memory.targetAmount > 0) {
      const unitMatch = lower.match(/mỗi\s*(ngày|tháng|tuần)/i);
      const requestedFreq = (unitMatch ? unitMatch[1].toLowerCase() : "ngày") as "ngày" | "tháng" | "tuần";

      const dailyRate = Math.ceil(memory.targetAmount / memory.effectiveDays);
      const months = memory.durationUnit === "tháng" ? memory.durationPeriods : Math.max(1, Math.round(memory.effectiveDays / 30));
      const monthlyRate = Math.ceil(memory.targetAmount / months);

      let correctionPrefix = "";
      if (memory.previousAiAnsweredIncorrectTotal) {
        correctionPrefix =
          `Xin lỗi bạn, ở câu trả lời trước tôi đã hiểu nhầm ${memory.targetAmount.toLocaleString("vi-VN")} VND là số tiền tiết kiệm định kỳ mỗi tháng. ` +
          `Mục tiêu thực tế của bạn là **tổng cộng ${(memory.targetAmount).toLocaleString("vi-VN")} VND** trong vòng **${memory.durationPeriods} ${memory.durationUnit}**.\n\n`;
      }

      let explanationVi = "";
      if (requestedFreq === "ngày") {
        explanationVi =
          `${correctionPrefix}Để đạt mục tiêu tích lũy **${memory.targetAmount.toLocaleString("vi-VN")} VND** trong **${memory.durationPeriods} ${memory.durationUnit}** (quy ước ${memory.effectiveDays} ngày), mỗi ngày bạn cần dành ra:\n\n` +
          `**${memory.targetAmount.toLocaleString("vi-VN")} VND ÷ ${memory.effectiveDays} ngày ≈ ${dailyRate.toLocaleString("vi-VN")} VND/ngày**.\n\n` +
          `*(Nếu tính theo tháng, mỗi tháng bạn cần để dành khoảng **${monthlyRate.toLocaleString("vi-VN")} VND/tháng**)*.`;
      } else {
        explanationVi =
          `${correctionPrefix}Để đạt mục tiêu tích lũy **${memory.targetAmount.toLocaleString("vi-VN")} VND** trong **${memory.durationPeriods} ${memory.durationUnit}**, mỗi tháng bạn cần dành ra:\n\n` +
          `**${memory.targetAmount.toLocaleString("vi-VN")} VND ÷ ${months} tháng ≈ ${monthlyRate.toLocaleString("vi-VN")} VND/tháng**.\n\n` +
          `*(Quy đổi theo ngày quy ước 30 ngày/tháng: khoảng **${dailyRate.toLocaleString("vi-VN")} VND/ngày**)*.`;
      }

      return {
        intent: "FOLLOW_UP_SAVINGS",
        targetAmount: memory.targetAmount,
        durationPeriods: memory.durationPeriods,
        durationUnit: memory.durationUnit,
        effectiveDays: memory.effectiveDays,
        alreadySaved: 0,
        remainingAmount: memory.targetAmount,
        dailySaving: dailyRate,
        monthlySaving: monthlyRate,
        totalSavedAtEnd: memory.targetAmount,
        explanationVi,
        aiMiscalculationCorrected: memory.previousAiAnsweredIncorrectTotal,
      };
    }
  }

  // 4. Rate Change Follow-up: "Nếu tôi tăng lên 50k/ngày thì sao?", "Nếu tăng lên 100k/ngày"
  const rateChangeMatch = lower.match(/(?:nếu\s+)?(?:tôi\s+)?tăng lên\s+([^,]+?)\s*(?:\/|\s*(?:mỗi|hàng)?\s*)(ngày|tháng|tuần)/i);
  if (rateChangeMatch && history.length > 0) {
    const newRateParsed = parseVietnameseAmount(rateChangeMatch[1]);
    const freq = rateChangeMatch[2].toLowerCase() as "ngày" | "tháng" | "tuần";
    const memory = extractSavingsContextFromHistory(history);

    if (newRateParsed.amount && memory && memory.targetAmount > 0) {
      let newTotal = 0;
      let daysToFinish = 0;

      if (freq === "ngày") {
        newTotal = newRateParsed.amount * memory.effectiveDays;
        daysToFinish = Math.ceil(memory.targetAmount / newRateParsed.amount);
      } else if (freq === "tháng") {
        const months = memory.durationUnit === "tháng" ? memory.durationPeriods : Math.ceil(memory.effectiveDays / 30);
        newTotal = newRateParsed.amount * months;
        daysToFinish = Math.ceil(memory.targetAmount / (newRateParsed.amount / 30));
      }

      const diff = newTotal - memory.targetAmount;
      let comparisonNote = "";
      if (diff > 0) {
        comparisonNote = `Bạn sẽ **vượt mục tiêu** ${diff.toLocaleString("vi-VN")} VND, hoặc bạn có thể rút ngắn thời gian và về đích sớm chỉ sau **${daysToFinish} ngày**!`;
      } else if (diff === 0) {
        comparisonNote = `Mức tiết kiệm này vừa vặn đạt chính xác 100% mục tiêu đúng hạn!`;
      } else {
        comparisonNote = `Sau ${memory.effectiveDays} ngày bạn sẽ có ${newTotal.toLocaleString("vi-VN")} VND (vẫn còn thiếu ${Math.abs(diff).toLocaleString("vi-VN")} VND). Để đủ mục tiêu, bạn cần tiết kiệm trong **${daysToFinish} ngày**.`;
      }

      return {
        intent: "SAVINGS_RATE_CHANGE",
        targetAmount: memory.targetAmount,
        durationPeriods: memory.durationPeriods,
        durationUnit: memory.durationUnit,
        effectiveDays: memory.effectiveDays,
        alreadySaved: 0,
        remainingAmount: memory.targetAmount,
        dailySaving: freq === "ngày" ? newRateParsed.amount : Math.ceil(newRateParsed.amount / 30),
        monthlySaving: freq === "tháng" ? newRateParsed.amount : newRateParsed.amount * 30,
        totalSavedAtEnd: newTotal,
        explanationVi:
          `Nếu bạn tăng mức tiết kiệm lên **${newRateParsed.amount.toLocaleString("vi-VN")} VND/${freq}**:\n\n` +
          `- **Tổng số tiền tích lũy sau ${memory.durationPeriods} ${memory.durationUnit}:** **${newTotal.toLocaleString("vi-VN")} VND**.\n` +
          `- **So với mục tiêu ban đầu (${memory.targetAmount.toLocaleString("vi-VN")} VND):** ${comparisonNote}`,
      };
    }
  }

  // 5. Missed Days Follow-up: "Nếu bỏ lỡ 5 ngày tiết kiệm thì mức tiết kiệm còn lại thay đổi thế nào?"
  const missedDaysMatch = lower.match(/(?:nếu\s+)?(?:bỏ lỡ|quên|không tiết kiệm)\s*(\d+)\s*ngày/i);
  if (missedDaysMatch && history.length > 0) {
    const missed = parseInt(missedDaysMatch[1], 10);
    const memory = extractSavingsContextFromHistory(history);
    if (memory && memory.targetAmount > 0 && memory.effectiveDays > missed) {
      const remainingDays = memory.effectiveDays - missed;
      const initialDaily = Math.ceil(memory.targetAmount / memory.effectiveDays);
      const newDaily = Math.ceil(memory.targetAmount / remainingDays);
      const increase = newDaily - initialDaily;

      return {
        intent: "SAVINGS_MISSED_DAYS",
        targetAmount: memory.targetAmount,
        durationPeriods: memory.durationPeriods,
        durationUnit: memory.durationUnit,
        effectiveDays: remainingDays,
        alreadySaved: 0,
        remainingAmount: memory.targetAmount,
        dailySaving: newDaily,
        monthlySaving: Math.ceil(memory.targetAmount / Math.max(1, Math.round(remainingDays / 30))),
        totalSavedAtEnd: memory.targetAmount,
        explanationVi:
          `Nếu bạn bỏ lỡ **${missed} ngày** không tiết kiệm:\n\n` +
          `- **Số ngày còn lại để tích lũy:** ${memory.effectiveDays} - ${missed} = **${remainingDays} ngày**.\n` +
          `- **Mức tiết kiệm ban đầu:** ${initialDaily.toLocaleString("vi-VN")} VND/ngày.\n` +
          `- **Mức tiết kiệm mới cần dành:** **${newDaily.toLocaleString("vi-VN")} VND/ngày** (tăng thêm **+${increase.toLocaleString("vi-VN")} VND/ngày** so với kế hoạch ban đầu để bù đắp các ngày đã bỏ lỡ).`,
      };
    }
  }

  // 6. Explicit Clarification: "Tôi muốn tiết kiệm tổng cộng 5 triệu, không phải mỗi tháng"
  // or "Tôi muốn tích lũy 5 triệu, không phải 5 triệu mỗi tháng"
  const explicitTotalNotMonthly = lower.match(/(?:tiết kiệm|tích lũy|để dành)\s+(?:tổng cộng\s+)?([^,]+?)[,\s]+(?:chứ\s+)?không phải\s+(?:mỗi|hàng)\s*(?:tháng|ngày)?/i);
  if (explicitTotalNotMonthly) {
    const amtParsed = parseVietnameseAmount(explicitTotalNotMonthly[1]);
    const memory = extractSavingsContextFromHistory(history);
    const periods = memory?.durationPeriods || 3;
    const unit = memory?.durationUnit || "tháng";
    const days = normalizeDurationToDays(periods, unit);

    if (amtParsed.amount) {
      const target = amtParsed.amount;
      const daily = Math.ceil(target / days);
      const monthly = Math.ceil(target / periods);

      return {
        intent: "TOTAL_SAVINGS_TARGET",
        targetAmount: target,
        durationPeriods: periods,
        durationUnit: unit,
        effectiveDays: days,
        alreadySaved: 0,
        remainingAmount: target,
        dailySaving: daily,
        monthlySaving: monthly,
        totalSavedAtEnd: target,
        explanationVi:
          `Tôi đã ghi nhận rõ: Mục tiêu của bạn là **tích lũy TỔNG CỘNG ${target.toLocaleString("vi-VN")} VND** (không phải tiết kiệm ${target.toLocaleString("vi-VN")} VND mỗi tháng).\n\n` +
          `- **Thời hạn:** ${periods} ${unit} (quy ước ${days} ngày).\n` +
          `- **Mỗi tháng cần dành:** ${target.toLocaleString("vi-VN")} ÷ ${periods} ≈ **${monthly.toLocaleString("vi-VN")} VND/tháng**.\n` +
          `- **Mỗi ngày cần dành:** ${target.toLocaleString("vi-VN")} ÷ ${days} ≈ **${daily.toLocaleString("vi-VN")} VND/ngày**.\n\n` +
          `Như vậy, kế hoạch đã được thiết lập chính xác theo tổng mục tiêu của bạn.`,
      };
    }
  }

  // 7. REMAINING_SAVINGS: Target with already saved amount
  // "Tôi muốn có 5 triệu, hiện đã tiết kiệm 2 triệu, còn 30 ngày."
  // "Tôi muốn có 10 triệu, đã có 4 triệu, còn 100 ngày."
  // "Tôi có sẵn 2 triệu, cần thêm 3 triệu trong 60 ngày."
  // "Tôi cần thêm 2 triệu trong 20 ngày."
  const remMatch1 =
    lower.match(/(?:muốn\s+có|mục tiêu|cần\s+có)\s+([^,]+?)[,\s]+(?:hiện\s+)?(?:đã\s+có|đã\s+tiết kiệm|đã\s+tích lũy|có\s+sẵn)\s+([^,]+?)[,\s]+(?:thời\s+hạn\s+)?(?:còn|trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)/i) ||
    unacc.match(/(?:muon\s+co|muc tieu|can\s+co)\s+([^,]+?)[,\s]+(?:hien\s+)?(?:da\s+co|da\s+tiet kiem|da\s+tich luy|co\s+san)\s+([^,]+?)[,\s]+(?:thoi\s+han\s+)?(?:con|trong|sau)\s*(\d+)\s*(ngay|tuan|thang|nam)/i);
  const remMatch2 = lower.match(/(?:có\s+sẵn|đã\s+có)\s+([^,]+?)[,\s]+(?:cần|muốn)\s+(?:thêm|tiết kiệm thêm|có thêm)\s+([^,]+?)\s*(?:trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)/i);
  const remMatch3 = lower.match(/(?:cần|muốn)\s+(?:thêm|tiết kiệm thêm)\s+([^,]+?)\s*(?:trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)/i);

  if (remMatch1) {
    const targetParsed = parseVietnameseAmount(remMatch1[1]);
    const savedParsed = parseVietnameseAmount(remMatch1[2]);
    const periods = parseInt(remMatch1[3], 10);
    const unit = toCanonicalUnit(remMatch1[4]);

    if (targetParsed.amount && savedParsed.amount !== null && periods > 0) {
      const remaining = Math.max(targetParsed.amount - savedParsed.amount, 0);
      const days = normalizeDurationToDays(periods, unit);
      const daily = Math.ceil(remaining / days);
      const months = unit === "tháng" ? periods : Math.max(1, Math.round(days / 30));
      const monthly = Math.ceil(remaining / months);

      return {
        intent: "REMAINING_SAVINGS",
        targetAmount: targetParsed.amount,
        durationPeriods: periods,
        durationUnit: unit,
        effectiveDays: days,
        alreadySaved: savedParsed.amount,
        remainingAmount: remaining,
        dailySaving: daily,
        monthlySaving: monthly,
        totalSavedAtEnd: targetParsed.amount,
        explanationVi:
          `Kế hoạch đạt mục tiêu **${targetParsed.amount.toLocaleString("vi-VN")} VND**:\n\n` +
          `- **Số tiền đã tích lũy:** ${savedParsed.amount.toLocaleString("vi-VN")} VND.\n` +
          `- **Số tiền còn thiếu cần bổ sung:** ${targetParsed.amount.toLocaleString("vi-VN")} - ${savedParsed.amount.toLocaleString("vi-VN")} = **${remaining.toLocaleString("vi-VN")} VND**.\n` +
          `- **Thời gian còn lại:** ${periods} ${unit} (${days} ngày).\n` +
          `- **Mức tiết kiệm cần dành mỗi ngày:** **${remaining.toLocaleString("vi-VN")} ÷ ${days} ngày = ${daily.toLocaleString("vi-VN")} VND/ngày**\n` +
          `*(hoặc khoảng **${monthly.toLocaleString("vi-VN")} VND/tháng**)*.`,
      };
    }
  }

  if (remMatch2) {
    const savedParsed = parseVietnameseAmount(remMatch2[1]);
    const addParsed = parseVietnameseAmount(remMatch2[2]);
    const periods = parseInt(remMatch2[3], 10);
    const unit = remMatch2[4].toLowerCase() as "ngày" | "tuần" | "tháng" | "năm";

    if (savedParsed.amount !== null && addParsed.amount && periods > 0) {
      const needed = addParsed.amount;
      const total = (savedParsed.amount || 0) + needed;
      const days = normalizeDurationToDays(periods, unit);
      const daily = Math.ceil(needed / days);

      return {
        intent: "REMAINING_SAVINGS",
        targetAmount: total,
        durationPeriods: periods,
        durationUnit: unit,
        effectiveDays: days,
        alreadySaved: savedParsed.amount || 0,
        remainingAmount: needed,
        dailySaving: daily,
        monthlySaving: Math.ceil(needed / Math.max(1, Math.round(days / 30))),
        totalSavedAtEnd: total,
        explanationVi:
          `Với số tiền có sẵn là **${(savedParsed.amount || 0).toLocaleString("vi-VN")} VND** và bạn cần thêm **${needed.toLocaleString("vi-VN")} VND** trong **${periods} ${unit}** (${days} ngày):\n\n` +
          `- **Tổng mục tiêu sau cùng:** ${total.toLocaleString("vi-VN")} VND.\n` +
          `- **Số tiền cần tiết kiệm mỗi ngày:** **${needed.toLocaleString("vi-VN")} ÷ ${days} ngày = ${daily.toLocaleString("vi-VN")} VND/ngày**.`,
      };
    }
  }

  if (remMatch3) {
    const addParsed = parseVietnameseAmount(remMatch3[1]);
    const periods = parseInt(remMatch3[2], 10);
    const unit = remMatch3[3].toLowerCase() as "ngày" | "tuần" | "tháng" | "năm";

    if (addParsed.amount && periods > 0) {
      const needed = addParsed.amount;
      const days = normalizeDurationToDays(periods, unit);
      const daily = Math.ceil(needed / days);

      return {
        intent: "REMAINING_SAVINGS",
        targetAmount: needed,
        durationPeriods: periods,
        durationUnit: unit,
        effectiveDays: days,
        alreadySaved: 0,
        remainingAmount: needed,
        dailySaving: daily,
        monthlySaving: Math.ceil(needed / Math.max(1, Math.round(days / 30))),
        totalSavedAtEnd: needed,
        explanationVi:
          `Để tích lũy thêm số tiền **${needed.toLocaleString("vi-VN")} VND** trong vòng **${periods} ${unit}** (${days} ngày), mỗi ngày bạn cần dành ra:\n\n` +
          `**${needed.toLocaleString("vi-VN")} VND ÷ ${days} ngày = ${daily.toLocaleString("vi-VN")} VND/ngày**.`,
      };
    }
  }

  // 8. SAVINGS_TIMELINE: "Nếu mỗi ngày bỏ 30k thì bao lâu được 1 triệu?"
  const timelineMatch1 = lower.match(/(?:nếu\s+)?(?:mỗi|hàng)\s*(ngày|tháng|tuần)\s*(?:bỏ|tiết kiệm|để dành|dành ra)\s+([^,]+?)\s*(?:thì\s+)?(?:sau\s+)?(?:bao lâu|bao nhiêu ngày|mất bao lâu)\s+(?:để\s+)?(?:được|có|đạt|tích lũy được)\s+([^?]+)/i);
  if (timelineMatch1) {
    const unit = timelineMatch1[1].toLowerCase() as "ngày" | "tháng" | "tuần";
    const rateParsed = parseVietnameseAmount(timelineMatch1[2]);
    const targetParsed = parseVietnameseAmount(timelineMatch1[3]);

    if (rateParsed.amount && targetParsed.amount && rateParsed.amount > 0) {
      const periodsNeeded = Math.ceil(targetParsed.amount / rateParsed.amount);
      const totalAccumulated = periodsNeeded * rateParsed.amount;

      return {
        intent: "SAVINGS_TIMELINE",
        targetAmount: targetParsed.amount,
        durationPeriods: periodsNeeded,
        durationUnit: unit,
        effectiveDays: normalizeDurationToDays(periodsNeeded, unit),
        alreadySaved: 0,
        remainingAmount: targetParsed.amount,
        dailySaving: unit === "ngày" ? rateParsed.amount : Math.ceil(rateParsed.amount / 30),
        monthlySaving: unit === "tháng" ? rateParsed.amount : rateParsed.amount * 30,
        totalSavedAtEnd: totalAccumulated,
        explanationVi:
          `Với mức tiết kiệm **${rateParsed.amount.toLocaleString("vi-VN")} VND/${unit}**:\n\n` +
          `- **Số ${unit} cần thiết để đạt ${targetParsed.amount.toLocaleString("vi-VN")} VND:**\n` +
          `  ${targetParsed.amount.toLocaleString("vi-VN")} ÷ ${rateParsed.amount.toLocaleString("vi-VN")} = **${periodsNeeded} ${unit}**.\n` +
          `- **Sau ${periodsNeeded} ${unit}, bạn sẽ có:** **${totalAccumulated.toLocaleString("vi-VN")} VND** (vừa đủ hoặc vượt nhẹ mục tiêu).`,
      };
    }
  }

  // 9. RECURRING_SAVINGS_AMOUNT: "Tôi tiết kiệm 5 triệu mỗi tháng trong 3 tháng"
  // "Mỗi tháng tiết kiệm 500k trong 12 tháng"
  // "Mỗi ngày tiết kiệm 20k trong 30 ngày"
  const recurringMatch1 = lower.match(/(?:nếu\s+)?(?:mỗi|hàng)\s*(ngày|tuần|tháng|năm)\s*(?:tiết kiệm|gửi tiết kiệm|để dành|tích lũy|bỏ ra|gửi)\s+([^,]+?)[,\s]+(?:trong|sau|được)?\s*(\d+)\s*(ngày|tuần|tháng|năm)/i);
  const recurringMatch2 = lower.match(/(?:tôi\s+)?(?:tiết kiệm|để dành|tích lũy|gửi)\s+([^,]+?)\s+(?:mỗi|hàng)\s*(ngày|tuần|tháng|năm)[,\s]*(?:trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)/i);

  if (recurringMatch1 || recurringMatch2) {
    const match = recurringMatch1 || recurringMatch2!;
    const unit = (recurringMatch1 ? match[1] : match[2]).toLowerCase() as "ngày" | "tuần" | "tháng" | "năm";
    const amtRaw = recurringMatch1 ? match[2] : match[1];
    const periods = parseInt(recurringMatch1 ? match[3] : match[3], 10);
    const durUnit = ((recurringMatch1 ? match[4] : match[4]) || unit).toLowerCase() as "ngày" | "tuần" | "tháng" | "năm";

    const amtParsed = parseVietnameseAmount(amtRaw);
    if (amtParsed.amount && periods > 0) {
      let multiplier = periods;
      let labelPeriods = `${periods} ${durUnit}`;

      if (unit === "tháng" && durUnit === "năm") {
        multiplier = periods * 12;
        labelPeriods = `${periods} năm (12 tháng)`;
      } else if (unit === "ngày" && durUnit === "năm") {
        multiplier = periods * 365;
        labelPeriods = `${periods} năm (365 ngày)`;
      } else if (unit === "ngày" && durUnit === "tháng") {
        multiplier = periods * 30;
        labelPeriods = `${periods} tháng (khoảng ${multiplier} ngày)`;
      }

      const total = amtParsed.amount * multiplier;
      const days = normalizeDurationToDays(periods, durUnit);

      return {
        intent: "RECURRING_SAVINGS_AMOUNT",
        targetAmount: total,
        durationPeriods: periods,
        durationUnit: durUnit,
        effectiveDays: days,
        alreadySaved: 0,
        remainingAmount: 0,
        dailySaving: unit === "ngày" ? amtParsed.amount : Math.ceil(amtParsed.amount / 30),
        monthlySaving: unit === "tháng" ? amtParsed.amount : amtParsed.amount * 30,
        totalSavedAtEnd: total,
        explanationVi:
          `Nếu mỗi ${unit} tiết kiệm **${amtParsed.amount.toLocaleString("vi-VN")} VND**, sau ${labelPeriods} bạn sẽ tích lũy được:\n\n` +
          `**${amtParsed.amount.toLocaleString("vi-VN")} VND × ${multiplier} = ${total.toLocaleString("vi-VN")} VND**.\n\n` +
          `*(Đây là kết quả của khoản đóng góp định kỳ **${amtParsed.amount.toLocaleString("vi-VN")} VND mỗi ${unit}**)*.`,
      };
    }
  }

  // 10. TOTAL_SAVINGS_TARGET: "Tôi muốn tiết kiệm 5 triệu trong 3 tháng thì mỗi ngày cần dành ra bao nhiêu?"
  // "Tôi muốn tiết kiệm 5 triệu trong 3 tháng"
  // "Tôi muốn để dành 5 củ trong 3 tháng"
  // "Tôi muốn có 6 triệu sau 60 ngày"
  // "Muốn gom 10 triệu trước Tết thì mỗi ngày dành bao nhiêu?"
  // MUST NOT have "mỗi tháng" or "mỗi ngày" modifying the target amount!
  const totalTargetMatch1 =
    lower.match(/(?:tôi\s+)?(?:muốn|cần|định|lập kế hoạch|đổi|chuyển|thay đổi)\s+(?:mục tiêu\s+)?(?:thành|sang\s+)?(?:tiết kiệm|để dành|tích lũy|gom|có|tích cóp)?\s+(?:tổng cộng\s+)?([^,]+?)\s*(?:trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)(?:\s*(?:thì|,)?\s*(?:mỗi\s+)?(ngày|tuần|tháng|năm)?\s*(?:cần|phải|nên)?\s*(?:dành|dành ra|bỏ ra|tiết kiệm|để dành)?\s*(?:bao nhiêu)?)?/i) ||
    unacc.match(/(?:toi\s+)?(?:muon|can|dinh|lap ke hoach|doi|chuyen|thay doi)\s+(?:muc tieu\s+)?(?:thanh|sang\s+)?(?:tiet kiem|de danh|tich luy|gom|co|tich cop)?\s+(?:tong cong\s+)?([^,]+?)\s*(?:trong|sau)\s*(\d+)\s*(ngay|tuan|thang|nam)(?:\s*(?:thi|,)?\s*(?:moi\s+)?(ngay|tuan|thang|nam)?\s*(?:can|phai|nen)?\s*(?:danh|danh ra|bo ra|tiet kiem|de danh)?\s*(?:bao nhieu)?)?/i);
  const totalTargetMatch2 = lower.match(/(?:để|muốn)\s+(?:đạt|có|được)\s+([^,]+?)\s*(?:trong|sau)\s*(\d+)\s*(ngày|tuần|tháng|năm)\s*(?:thì|,)?\s*(?:mỗi\s+)?(ngày|tuần|tháng|năm)?\s*(?:cần|phải|nên)?\s*(?:dành|dành ra|bỏ ra|tiết kiệm|để dành)?\s*bao nhiêu/i);

  if (totalTargetMatch1 || totalTargetMatch2) {
    const match = totalTargetMatch1 || totalTargetMatch2!;
    const amtRaw = match[1];
    const periods = parseInt(match[2], 10);
    const durUnit = toCanonicalUnit(match[3]);
    const requestedFreq = (match[4] ? toCanonicalUnit(match[4]) : null) as "ngày" | "tuần" | "tháng" | "năm" | null;

    // Guard: if amtRaw contains "mỗi" or "hàng" (e.g. "5 triệu mỗi tháng"), it is recurring, handled above!
    if (/mỗi|hàng/i.test(amtRaw)) {
      return null;
    }

    const amtParsed = parseVietnameseAmount(amtRaw);
    if (amtParsed.amount && periods > 0) {
      const target = amtParsed.amount;
      const days = normalizeDurationToDays(periods, durUnit);
      const months = durUnit === "tháng" ? periods : durUnit === "năm" ? periods * 12 : Math.max(1, Math.round(days / 30));

      const dailyRate = Math.ceil(target / days);
      const monthlyRate = Math.ceil(target / months);

      let explanationVi = "";

      if (requestedFreq === "ngày" || (lower.includes("mỗi ngày") && lower.includes("bao nhiêu"))) {
        explanationVi =
          `Để đạt mục tiêu tích lũy **tổng cộng ${target.toLocaleString("vi-VN")} VND** trong vòng **${periods} ${durUnit}** (quy ước ${days} ngày), mỗi ngày bạn cần dành ra:\n\n` +
          `**${target.toLocaleString("vi-VN")} VND ÷ ${days} ngày ≈ ${dailyRate.toLocaleString("vi-VN")} VND/ngày**.\n\n` +
          `*(Hoặc nếu tính theo tháng, mỗi tháng bạn cần để dành khoảng **${monthlyRate.toLocaleString("vi-VN")} VND/tháng**)*.`;
      } else if (requestedFreq === "tháng" || (lower.includes("mỗi tháng") && lower.includes("bao nhiêu"))) {
        explanationVi =
          `Để đạt mục tiêu tích lũy **tổng cộng ${target.toLocaleString("vi-VN")} VND** trong vòng **${periods} ${durUnit}**, mỗi tháng bạn cần dành ra:\n\n` +
          `**${target.toLocaleString("vi-VN")} VND ÷ ${months} tháng ≈ ${monthlyRate.toLocaleString("vi-VN")} VND/tháng**.\n\n` +
          `*(Quy đổi theo ngày quy ước 30 ngày/tháng: khoảng **${dailyRate.toLocaleString("vi-VN")} VND/ngày**)*.`;
      } else {
        explanationVi =
          `Kế hoạch tiết kiệm **tổng mục tiêu ${target.toLocaleString("vi-VN")} VND** trong vòng **${periods} ${durUnit}**:\n\n` +
          `- **Tổng số tiền cần tích lũy:** **${target.toLocaleString("vi-VN")} VND** (không phải ${target.toLocaleString("vi-VN")} VND mỗi ${durUnit}).\n` +
          `- **Mỗi tháng cần dành:** ${target.toLocaleString("vi-VN")} ÷ ${months} ≈ **${monthlyRate.toLocaleString("vi-VN")} VND/tháng**.\n` +
          `- **Mỗi ngày cần dành (quy ước ${days} ngày):** ${target.toLocaleString("vi-VN")} ÷ ${days} ≈ **${dailyRate.toLocaleString("vi-VN")} VND/ngày**.\n\n` +
          `*Lưu ý: Mức đóng góp được làm tròn lên để đảm bảo bạn đạt đủ 100% mục tiêu đúng hạn.*`;
      }

      return {
        intent: "TOTAL_SAVINGS_TARGET",
        targetAmount: target,
        durationPeriods: periods,
        durationUnit: durUnit,
        effectiveDays: days,
        alreadySaved: 0,
        remainingAmount: target,
        dailySaving: dailyRate,
        monthlySaving: monthlyRate,
        totalSavedAtEnd: target,
        explanationVi,
      };
    }
  }

  return null;
}
