import { processChat } from "../backend/src/services/ai-chat.service.ts";
import { buildServerFinancialContext } from "../backend/src/services/financial-context.service.ts";
import { getTestAuthToken } from "../tests/ai-evaluation/auth-helper.mjs";

async function runLiveVerification() {
  console.log("=== BẮT ĐẦU KIỂM THỬ LIVE CHATBOT VỚI MODEL OLLAMA ===");
  const token = await getTestAuthToken();
  const userId = "c921b6ee-910f-4d4a-9b55-ec273c04830e";
  const supabaseUrl = "https://xqclhgyrkwaipwokooxe.supabase.co";
  const supabaseKey = "sb_publishable_7A3Jnp28OveJw8Tvg9cY6A_tQ67V5oh";

  const toolContext = {
    supabaseUrl,
    supabaseKey,
    token,
    userId,
  };

  const testCases = [
    {
      label: "1. Kiến thức tổng quát (GENERAL_KNOWLEDGE): Người giàu nhất thế giới",
      query: "Người giàu nhất thế giới bây giờ là ai?",
      history: [],
      check: (reply) => {
        const lower = reply.toLowerCase();
        const hasMuskOrBezos = lower.includes("elon musk") || lower.includes("bezos") || lower.includes("arnault");
        const noPersonalBalance = !lower.includes("980.000") && !lower.includes("335.000") && !lower.includes("báo cáo tài chính");
        return hasMuskOrBezos && noPersonalBalance;
      },
    },
    {
      label: "2. Kiến thức tổng quát (GENERAL_KNOWLEDGE): Ngân sách là gì?",
      query: "Ngân sách là gì?",
      history: [],
      check: (reply) => {
        const lower = reply.toLowerCase();
        const hasConcept = lower.includes("kế hoạch") || lower.includes("phân bổ") || lower.includes("chi tiêu");
        const noPersonalBalance = !lower.includes("980.000") && !lower.includes("335.000");
        return hasConcept && noPersonalBalance;
      },
    },
    {
      label: "3. Thông tin thời gian thực (REALTIME_INFORMATION): Tin tức kinh tế",
      query: "Hôm nay có tin tức kinh tế nổi bật nào?",
      history: [],
      check: (reply) => {
        const lower = reply.toLowerCase();
        return lower.includes("giới hạn") || lower.includes("tỷ giá") || lower.includes("internet") || lower.includes("usd");
      },
    },
    {
      label: "4. Dữ liệu cá nhân (PERSONAL_FINANCE): Tôi có bao nhiêu tiền?",
      query: "Tôi có bao nhiêu tiền?",
      history: [],
      check: (reply) => {
        const lower = reply.toLowerCase();
        return lower.includes("980.000") || lower.includes("335.000") || lower.includes("khả dụng");
      },
    },
    {
      label: "5. Hội thoại thông thường (GENERAL_CHAT): Xin chào, bạn có thể giúp gì?",
      query: "Xin chào, bạn có thể giúp gì?",
      history: [],
      check: (reply) => {
        const lower = reply.toLowerCase();
        const hasGreeting = lower.includes("chào") || lower.includes("trợ lý");
        const noPersonalBalance = !lower.includes("980.000") && !lower.includes("335.000");
        return hasGreeting && noPersonalBalance;
      },
    },
    {
      label: "6. Hội thoại tiếp nối (MULTI_TURN / FINANCIAL_ADVICE): Với số tiền đó, tôi nên tiết kiệm bao nhiêu?",
      query: "Với số tiền đó, tôi nên tiết kiệm bao nhiêu?",
      history: [
        {
          role: "model",
          parts: [{ text: "Tổng tài sản của bạn là 980.000 VND, số dư khả dụng hiện tại là 335.000 VND." }],
        },
      ],
      check: (reply) => {
        const lower = reply.toLowerCase();
        return lower.includes("tiết kiệm") && (lower.includes("335") || lower.includes("20%") || lower.includes("quy tắc") || lower.includes("khoảng"));
      },
    },
  ];

  for (const tc of testCases) {
    console.log(`\n-------------------------------------------------------------`);
    console.log(`TEST: ${tc.label}`);
    console.log(`USER: "${tc.query}"`);

    // Build real server context (simulating actual API route)
    const serverContext = await buildServerFinancialContext(supabaseUrl, supabaseKey, token, userId, tc.query);

    const start = Date.now();
    const result = await processChat(
      "http://127.0.0.1:11434",
      {
        message: tc.query,
        history: tc.history,
      },
      { serverContext, toolContext },
    );
    const duration = Date.now() - start;

    console.log(`BOT [${duration}ms]:`);
    console.log(result.reply);

    const passed = tc.check(result.reply || "");
    console.log(`KẾT QUẢ: ${passed ? "✔ PASS" : "✖ FAIL"}`);
  }

  console.log(`\n=== HOÀN TẤT KIỂM THỬ LIVE ===`);
}

runLiveVerification().catch(console.error);
