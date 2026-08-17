/**
 * AI Chat Service — business logic cho Financial Copilot chatbot.
 * Được dùng bởi cả Next.js route handler và Cloudflare Worker.
 */

import type { ChatMessage, FinancialContext, AiChatRequest, AiChatResult } from "../types/ai.types";

export { type ChatMessage, type FinancialContext, type AiChatRequest, type AiChatResult };

export const FINANCE_SYSTEM_PROMPT = `Bạn là Financial Copilot của hệ thống "Sổ Chi Tiêu" (Trợ lý tài chính AI).

Vai trò của bạn:
1. Trả lời các câu hỏi về tài chính cá nhân, ngân sách, ví, giao dịch, và mục tiêu tiết kiệm.
2. Phân tích sâu dữ liệu (What-if analysis): Nếu người dùng hỏi "Nếu tôi mua X giá Y thì sao?", bạn phải tính toán và cảnh báo ảnh hưởng tới ngân sách và số dư.
3. Nhận diện các khoản chi tiêu bất thường hoặc nguy cơ vượt ngân sách dựa vào dữ liệu được cung cấp.
4. Đưa ra gợi ý Quick Action (ví dụ: "Hãy tạo giao dịch", "Hãy giảm chi tiêu"). 
5. Hiểu được "Ngữ cảnh trang hiện tại" (currentPage) của người dùng để trả lời cho phù hợp nếu họ hỏi "Trang này làm gì?".

Nếu câu hỏi KHÔNG thuộc chủ đề tài chính hoặc Sổ Chi Tiêu (ví dụ: lập trình, thời tiết, giải trí...), hãy từ chối lịch sự:
"Tôi là Financial Copilot chuyên quản lý chi tiêu. Tôi chỉ có thể hỗ trợ các câu hỏi liên quan đến tài chính cá nhân."

QUAN TRỌNG:
- Không tự bịa dữ liệu. Nếu không đủ dữ liệu, nói "Không đủ dữ liệu".
- Bạn chưa được cấp quyền tự động tạo giao dịch/sửa dữ liệu trực tiếp, nhưng bạn có thể phân tích và nói "Để tôi chuẩn bị giao dịch cho bạn xác nhận".
- Trình bày dạng Markdown (bullet points, in đậm số tiền) dễ đọc, ngắn gọn, súc tích.`;

export function buildContextText(ctx: FinancialContext | null, currentPage?: string, clientTime?: string): string {
  if (!ctx) return "";

  const lines: string[] = ["--- DỮ LIỆU TÀI CHÍNH VÀ NGỮ CẢNH ---"];
  
  if (clientTime) {
    lines.push(`Thời gian hiện tại của thiết bị: ${clientTime}`);
  }
  if (currentPage) {
    lines.push(`Người dùng đang thao tác ở màn hình: ${currentPage}`);
  }

  if (ctx.totalBalance !== undefined) {
    lines.push(`Tổng số dư tất cả ví: ${ctx.totalBalance.toLocaleString("vi-VN")}đ`);
  }
  if (ctx.monthlyIncome !== undefined) {
    lines.push(`Thu nhập tháng này: ${ctx.monthlyIncome.toLocaleString("vi-VN")}đ`);
  }
  if (ctx.monthlyExpense !== undefined) {
    lines.push(`Chi tiêu tháng này: ${ctx.monthlyExpense.toLocaleString("vi-VN")}đ`);
  }
  if (ctx.monthlyIncome !== undefined && ctx.monthlyExpense !== undefined) {
    const savings = ctx.monthlyIncome - ctx.monthlyExpense;
    lines.push(`Tiết kiệm ròng tháng này: ${savings.toLocaleString("vi-VN")}đ`);
  }

  if (ctx.wallets && ctx.wallets.length > 0) {
    lines.push("\nDanh sách ví:");
    ctx.wallets.forEach(w => {
      lines.push(`  - ${w.name} (${w.type}): ${w.balance.toLocaleString("vi-VN")}đ`);
    });
  }

  if (ctx.budgets && ctx.budgets.length > 0) {
    lines.push("\nNgân sách:");
    ctx.budgets.forEach(b => {
      const pct = b.amount > 0 ? Math.round(b.spent_amount / b.amount * 100) : 0;
      lines.push(`  - ${b.name} (${b.period}): đã chi ${b.spent_amount.toLocaleString("vi-VN")}đ / ${b.amount.toLocaleString("vi-VN")}đ (${pct}%), còn lại ${b.remaining_amount.toLocaleString("vi-VN")}đ, trạng thái: ${b.status}`);
    });
  }

  if (ctx.savingsGoals && ctx.savingsGoals.length > 0) {
    lines.push("\nMục tiêu tiết kiệm:");
    ctx.savingsGoals.forEach(g => {
      const pct = g.target_amount > 0 ? Math.round(g.current_amount / g.target_amount * 100) : 0;
      lines.push(`  - ${g.title}: ${g.current_amount.toLocaleString("vi-VN")}đ / ${g.target_amount.toLocaleString("vi-VN")}đ (${pct}%)${g.deadline ? `, hạn ${g.deadline}` : ""}`);
    });
  }

  if (ctx.transactions && ctx.transactions.length > 0) {
    lines.push(`\n${ctx.transactions.length} giao dịch gần đây:`);
    ctx.transactions.slice(0, 20).forEach(t => {
      const date = t.occurred_at ? t.occurred_at.slice(0, 10) : "";
      lines.push(`  - [${t.type === "expense" ? "Chi" : "Thu"}] ${t.title}: ${t.amount.toLocaleString("vi-VN")}đ (${t.category}, ${date})`);
    });
  }

  lines.push("--- KẾT THÚC DỮ LIỆU ---");
  return lines.join("\n");
}

// Rule-based pre-filter for obvious off-topic questions — avoids wasting Gemini API call
const OFF_TOPIC_PATTERNS = [
  /\b(viết code|lập trình|python|javascript|java|c\+\+|golang|rust|sql query)\b/i,
  /\b(thời tiết|weather|nhiệt độ|mưa|nắng|bão)\b/i,
  /\b(lịch sử|tổng thống|thủ tướng|chính trị|bầu cử|chiến tranh)\b/i,
  /\b(kể chuyện|truyện ngắn|thơ|bài văn|sáng tác)\b/i,
  /\b(giải bài toán toán học|đại số|hình học|calculus|vật lý|hóa học)\b/i,
  /\b(tạo hình ảnh|vẽ|thiết kế đồ họa|photoshop)\b/i,
  /\b(tư vấn game|chơi game|gaming|esport)\b/i,
  /\b(âm nhạc|bài hát|ca sĩ|phim|diễn viên)\b/i,
  /\b(nấu ăn|công thức|recipe|món ăn)\b/i,
];

export function isObviouslyOffTopic(message: string): boolean {
  return OFF_TOPIC_PATTERNS.some(pattern => pattern.test(message));
}

export const OFF_TOPIC_REPLY =
  "Tôi là trợ lý AI chuyên hỗ trợ quản lý chi tiêu cá nhân. Tôi chỉ có thể hỗ trợ các câu hỏi liên quan đến tài chính cá nhân và các chức năng trong hệ thống Sổ Chi Tiêu.";

const CANDIDATE_MODELS = [
  "gemini-2.5-flash",
  "gemini-3.6-flash",
  "gemini-2.5-pro",
  "gemini-3.1-flash-lite-preview",
];

/**
 * Core chat processing function.
 * Accepts geminiApiKey explicitly so it works in both Next.js (process.env) and Cloudflare Worker (env.*).
 */
export async function processChat(
  geminiApiKey: string,
  req: AiChatRequest
): Promise<AiChatResult> {
  const { message, history, financialContext, currentPage, clientTime } = req;

  if (!geminiApiKey || geminiApiKey === "your_gemini_api_key_here") {
    return { error: "AI service is not configured. Please set GEMINI_API_KEY.", status: 503 };
  }

  const userMessage = typeof message === "string" ? message.trim() : "";
  if (!userMessage) {
    return { error: "Empty message", status: 400 };
  }

  if (isObviouslyOffTopic(userMessage)) {
    return { reply: OFF_TOPIC_REPLY, status: 200 };
  }

  const safeHistory: ChatMessage[] = Array.isArray(history) ? history : [];
  const contextText = buildContextText(financialContext ?? null, currentPage, clientTime);

  const systemWithContext = contextText
    ? `${FINANCE_SYSTEM_PROMPT}\n\n${contextText}`
    : FINANCE_SYSTEM_PROMPT;

  const contents: ChatMessage[] = [
    {
      role: "user",
      parts: [{ text: systemWithContext + "\n\nHãy xác nhận bạn hiểu vai trò của mình." }],
    },
    {
      role: "model",
      parts: [{ text: "Tôi đã hiểu. Tôi là Trợ lý AI của hệ thống Sổ Chi Tiêu, chỉ tư vấn về tài chính cá nhân dựa trên dữ liệu của bạn. Tôi sẵn sàng hỗ trợ." }],
    },
    ...safeHistory,
    {
      role: "user",
      parts: [{ text: userMessage }],
    },
  ];

  let geminiRes: Response | null = null;
  let lastErrorText = "";

  for (const modelName of CANDIDATE_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            ],
          }),
          signal: AbortSignal.timeout(25000),
        }
      );

      if (res.ok) {
        geminiRes = res;
        break;
      }

      const errBody = await res.text().catch(() => "");
      console.error(`Gemini API error for model ${modelName}:`, res.status, errBody);
      lastErrorText = errBody;

      if (res.status !== 404) {
        geminiRes = res;
        break;
      }
    } catch (e) {
      console.error(`Failed request for model ${modelName}:`, e);
    }
  }

  if (!geminiRes || !geminiRes.ok) {
    let userErrorMsg = "Không thể kết nối với Trợ lý AI. Vui lòng thử lại.";
    if (lastErrorText.includes("API_KEY_INVALID") || lastErrorText.includes("API key not valid")) {
      userErrorMsg = "API Key không hợp lệ. Vui lòng kiểm tra lại GEMINI_API_KEY trong file .env.local.";
    } else if (geminiRes?.status === 429 || lastErrorText.includes("quota") || lastErrorText.includes("429")) {
      userErrorMsg = "API đã hết hạn mức sử dụng (Quota exceeded). Vui lòng thử lại sau hoặc nâng cấp tài khoản.";
    }
    return { error: userErrorMsg, status: 502 };
  }

  const geminiData = (await geminiRes.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const candidate = geminiData.candidates?.[0];
  const reply = candidate?.content?.parts?.[0]?.text?.trim();

  if (!reply) {
    if (candidate?.finishReason === "SAFETY") {
      return { error: "Nội dung bị chặn bởi bộ lọc an toàn.", status: 400 };
    }
    return { error: "AI trả về phản hồi rỗng. Vui lòng thử lại.", status: 502 };
  }

  return { reply, status: 200 };
}
