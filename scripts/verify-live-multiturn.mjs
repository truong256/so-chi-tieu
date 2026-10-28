/**
 * scripts/verify-live-multiturn.mjs
 * =================================
 * Live Multi-Turn E2E Verification of Financial Copilot with Ollama.
 *
 * Runs the exact 5 dialogue turns sequentially, maintaining conversation history,
 * against the real local model (qwen2.5-coder:7b) and authoritative snapshot:
 *
 * Turn 1: "Tôi có đủ tiền mua điện thoại giá 3 triệu không?"
 * Turn 2: "Nếu mua điện thoại đó, tôi sẽ còn bao nhiêu tiền khả dụng?"
 * Turn 3: "Số tiền còn lại đó có đủ cho ngân sách ăn uống không?"
 * Turn 4: "Tóm tắt những điều chúng ta vừa trao đổi."
 * Turn 5: "Ai là người giàu nhất thế giới hiện nay?"
 */

import { processChat } from "../backend/src/services/ai-chat.service.ts";

const OLLAMA_URL = "http://127.0.0.1:11434";

// Authoritative snapshot matching user's real account state:
// Total assets: 4.104.000 VND
// Allocated: 645.000 VND
// Available: 3.459.000 VND
// Wallets: Ví tiền mặt (645k balance, 345k allocated, 300k available)
//          Ví ngân hàng (3.459k balance, 300k allocated, 3.159k available)
// Budgets: Ăn uống (hạn mức 1.000.000 VND, đã chi 655.000 VND, còn lại 345.000 VND)
const baselineSnapshot = {
  totalAssets: 4104000,
  totalAllocated: 645000,
  totalAvailable: 3459000,
  walletBalances: [
    {
      walletId: "w_cash",
      walletName: "Ví tiền mặt",
      type: "cash",
      balance: 645000,
      allocated: 345000,
      available: 300000,
      currency: "VND",
    },
    {
      walletId: "w_bank",
      walletName: "Ví ngân hàng",
      type: "bank",
      balance: 3459000,
      allocated: 300000,
      available: 3159000,
      currency: "VND",
    },
  ],
  currency: "VND",
  asOf: "2026-10-28 05:00:00 (UTC+7)",
};

const serverContext = {
  userId: "user_audit_live",
  asOf: "2026-10-28 05:00:00 (UTC+7)",
  currentPeriod: "Tháng 10/2026",
  previousPeriod: "Tháng 09/2026",
  timezone: "Asia/Ho_Chi_Minh (UTC+7)",
  totalAssets: 4104000,
  totalAllocated: 645000,
  totalAvailable: 3459000,
  snapshot: baselineSnapshot,
  balancesByCurrency: { VND: 4104000 },
  reservedByCurrency: { VND: 645000 },
  availableByCurrency: { VND: 3459000 },
  primaryCurrency: "VND",
  currentMonthIncome: 5000000,
  currentMonthExpense: 1541000,
  currentMonthNetSavings: 3459000,
  currentMonthSavingsRate: 69.18,
  previousMonthIncome: 5000000,
  previousMonthExpense: 2000000,
  expenseChangeVsPreviousMonth: { difference: -459000, percentChange: -22.95 },
  topCategories: [{ category: "Ăn uống", currentAmount: 655000, previousAmount: 1000000, difference: -345000, percentChange: -34.5 }],
  highestSpendingCategory: { category: "Ăn uống", amount: 655000, percentage: 42.5 },
  wallets: [
    { id: "w_cash", name: "Ví tiền mặt", type: "cash", balance: 645000, reservedAmount: 345000, availableBalance: 300000, currency: "VND" },
    { id: "w_bank", name: "Ví ngân hàng", type: "bank", balance: 3459000, reservedAmount: 300000, availableBalance: 3159000, currency: "VND" },
  ],
  budgets: [
    {
      id: "b_food",
      name: "Ăn uống",
      limit: 1000000,
      actualSpent: 655000,
      limitRemaining: 345000,
      allocatedFromWallets: 345000,
      status: "active",
      currency: "VND",
    },
  ],
  savingsGoals: [
    {
      id: "g1",
      title: "Quỹ dự phòng",
      target_amount: 10000000,
      current_amount: 300000,
      percentProgress: 3,
      deadline: "2026-12-31",
    },
  ],
  recentTransactions: [],
  currentMonthTransactionCount: 1,
  currentMonthExpenseCount: 1,
  currentMonthIncomeCount: 0,
  hasSufficientData: true,
  whatIfContext: { sample500kImpacts: [] },
};

async function runLiveVerification() {
  console.log("=== BẮT ĐẦU KIỂM CHỨNG TRỰC TIẾP HỘI THOẠI 5 LƯỢT VỚI OLLAMA ===");
  console.log(`Model: qwen2.5-coder:7b tại ${OLLAMA_URL}`);

  const history = [];

  const turns = [
    {
      num: 1,
      query: "Tôi có đủ tiền mua điện thoại giá 3 triệu không?",
      expectedCheck: (reply) => {
        const hasEnough = /đủ tiền|hoàn toàn đủ/i.test(reply);
        const hasAvailable = /3\.459\.000/i.test(reply);
        const hasRemaining = /459\.000/i.test(reply);
        console.log(`[Turn 1 Checks]: hasEnough=${hasEnough}, hasAvailable=${hasAvailable}, hasRemaining=${hasRemaining}`);
        return hasEnough && (hasAvailable || hasRemaining);
      },
    },
    {
      num: 2,
      query: "Nếu mua điện thoại đó, tôi sẽ còn bao nhiêu tiền khả dụng?",
      expectedCheck: (reply) => {
        const has459k = /459\.000/i.test(reply);
        const hasNo500k = !/2\.959\.000|500\.000.*điện thoại/i.test(reply);
        console.log(`[Turn 2 Checks]: has459k=${has459k}, hasNo500k=${hasNo500k}`);
        return has459k && hasNo500k;
      },
    },
    {
      num: 3,
      query: "Số tiền còn lại đó có đủ cho ngân sách ăn uống không?",
      expectedCheck: (reply) => {
        const mentionsFood = /ăn uống/i.test(reply);
        const saysEnough = /đủ|hoàn toàn đủ/i.test(reply);
        const mentions345k = /345\.000/i.test(reply);
        const noFake500kTx = !/giao dịch.*500\.000|đã chi 500\.000 cho điện thoại/i.test(reply);
        console.log(`[Turn 3 Checks]: mentionsFood=${mentionsFood}, saysEnough=${saysEnough}, mentions345k=${mentions345k}, noFake500kTx=${noFake500kTx}`);
        return mentionsFood && saysEnough && noFake500kTx;
      },
    },
    {
      num: 4,
      query: "Tóm tắt những điều chúng ta vừa trao đổi.",
      expectedCheck: (reply) => {
        const mentionsPhone = /điện thoại/i.test(reply);
        const noHallucinatedTrend = !/tài sản.*tăng so với tháng trước|tăng 4\.104\.000/i.test(reply);
        console.log(`[Turn 4 Checks]: mentionsPhone=${mentionsPhone}, noHallucinatedTrend=${noHallucinatedTrend}`);
        return mentionsPhone && noHallucinatedTrend;
      },
    },
    {
      num: 5,
      query: "Ai là người giàu nhất thế giới hiện nay?",
      expectedCheck: (reply) => {
        const mentionsElon = /Elon Musk/i.test(reply);
        const citesSource = /Forbes|Bloomberg/i.test(reply);
        console.log(`[Turn 5 Checks]: mentionsElon=${mentionsElon}, citesSource=${citesSource}`);
        return mentionsElon && citesSource;
      },
    },
  ];

  let allPassed = true;

  for (const turn of turns) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`👉 LƯỢT ${turn.num} - NGƯỜI DÙNG: "${turn.query}"`);
    const start = Date.now();

    const result = await processChat(OLLAMA_URL, {
      message: turn.query,
      history,
    }, {
      serverContext,
      totalTimeoutMs: 60000,
      toolContext: {
        supabaseUrl: "",
        supabaseKey: "",
        token: "",
        userId: "user_audit_live",
      },
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`⏱️ Thời gian phản hồi: ${elapsed}s`);

    if (result.error) {
      console.error(`❌ LỖI: ${result.error}`);
      allPassed = false;
      break;
    }

    console.log(`🤖 AI TRẢ LỜI:\n${result.reply}`);

    const pass = turn.expectedCheck(result.reply);
    if (pass) {
      console.log(`✅ LƯỢT ${turn.num} PASS!`);
    } else {
      console.warn(`⚠️ LƯỢT ${turn.num} CHƯA ĐẠT KỲ VỌNG.`);
      allPassed = false;
    }

    // Append to conversation history for next turn
    history.push({ role: "user", parts: [{ text: turn.query }] });
    history.push({ role: "model", parts: [{ text: result.reply }] });
  }

  console.log(`\n============================================================`);
  if (allPassed) {
    console.log(`🎉 TẤT CẢ 5 LƯỢT HỘI THOẠI E2E ĐỀU PASS XUẤT SẮC!`);
  } else {
    console.log(`⚠️ Có một số lượt chưa đạt kỳ vọng hoàn toàn.`);
  }
}

runLiveVerification().catch(console.error);
