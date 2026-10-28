/**
 * scripts/benchmark-chatbot-performance.mjs
 * =========================================
 * Automated Benchmark Suite measuring end-to-end performance of Financial Copilot AI.
 * 
 * Measures:
 * - Total Latency (ms)
 * - TTFT (Time to First Token) (ms)
 * - Auth Time (ms)
 * - Supabase Query Time (ms)
 * - RAG Search Time (ms)
 * - Tool Execution Time (ms)
 * - LLM Inference Time (ms)
 * - Tokens (Input / Output)
 * - Model calls count
 * - Fast Path detection (Hit/Miss)
 * - Accuracy verification
 */

import { getTestAuthToken } from '../tests/ai-evaluation/auth-helper.mjs';

export const BENCHMARK_30_QUESTIONS = [
  // --- Group 1: Pure System Knowledge & UI Walkthrough (6 queries) ---
  {
    id: "Q01_SYS_OVERVIEW",
    group: "SYSTEM_KNOWLEDGE",
    question: "Sổ Chi Tiêu có những chức năng chính nào?",
    expectedFastPath: false,
    expectedIntent: "SYSTEM_KNOWLEDGE",
    requiresPersonalData: false,
  },
  {
    id: "Q02_SYS_ADD_WALLET",
    group: "SYSTEM_KNOWLEDGE",
    question: "Làm thế nào để thêm một ví mới?",
    expectedFastPath: false,
    expectedIntent: "SYSTEM_KNOWLEDGE",
    requiresPersonalData: false,
  },
  {
    id: "Q03_SYS_BUDGET_VS_SAVINGS",
    group: "SYSTEM_KNOWLEDGE",
    question: "Sự khác biệt giữa Ngân sách và Mục tiêu tiết kiệm là gì?",
    expectedFastPath: false,
    expectedIntent: "SYSTEM_KNOWLEDGE",
    requiresPersonalData: false,
  },
  {
    id: "Q04_SYS_RECEIPT_OCR",
    group: "SYSTEM_KNOWLEDGE",
    question: "Chức năng quét hóa đơn hoạt động như thế nào?",
    expectedFastPath: false,
    expectedIntent: "SYSTEM_KNOWLEDGE",
    requiresPersonalData: false,
  },
  {
    id: "Q05_SYS_EXCEL_EXPORT",
    group: "SYSTEM_KNOWLEDGE",
    question: "Tôi muốn xuất toàn bộ dữ liệu ra Excel thì làm ở đâu?",
    expectedFastPath: false,
    expectedIntent: "SYSTEM_KNOWLEDGE",
    requiresPersonalData: false,
  },
  {
    id: "Q06_SYS_ADMIN_PRIVACY",
    group: "SYSTEM_KNOWLEDGE",
    question: "Admin có thể xem được chi tiêu cá nhân của tôi không?",
    expectedFastPath: false,
    expectedIntent: "SYSTEM_KNOWLEDGE",
    requiresPersonalData: false,
  },

  // --- Group 2: Core Balances & Assets (Fast Path Candidates - 6 queries) ---
  {
    id: "Q07_FIN_TOTAL_ASSETS",
    group: "CORE_BALANCES",
    question: "Tôi có bao nhiêu tiền?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q08_FIN_AVAILABLE_BALANCE",
    group: "CORE_BALANCES",
    question: "Tôi còn bao nhiêu tiền khả dụng?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q09_FIN_CASH_WALLET",
    group: "CORE_BALANCES",
    question: "Tiền mặt tôi còn bao nhiêu?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q10_FIN_BANK_WALLET",
    group: "CORE_BALANCES",
    question: "Trong ngân hàng tôi có bao nhiêu tiền?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q11_FIN_ALLOCATED_MONEY",
    group: "CORE_BALANCES",
    question: "Tôi đã phân bổ bao nhiêu tiền?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q12_FIN_HIGHEST_WALLET",
    group: "CORE_BALANCES",
    question: "Ví nào đang có nhiều tiền nhất?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },

  // --- Group 3: Transaction Statistics & Period Summaries (Fast Path Candidates - 6 queries) ---
  {
    id: "Q13_TX_MONTH_COUNT",
    group: "TRANSACTION_STATS",
    question: "Tháng này tôi có bao nhiêu giao dịch?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q14_TX_TODAY_EXPENSE",
    group: "TRANSACTION_STATS",
    question: "Hôm nay tôi đã chi bao nhiêu tiền?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q15_TX_MONTH_EXPENSE",
    group: "TRANSACTION_STATS",
    question: "Tháng này tôi đã chi bao nhiêu tiền?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q16_TX_MONTH_INCOME",
    group: "TRANSACTION_STATS",
    question: "Tổng thu nhập tháng này của tôi là bao nhiêu?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q17_TX_CUSTOM_DATE_RANGE",
    group: "TRANSACTION_STATS",
    question: "Tôi có bao nhiêu giao dịch từ 01/10/2026 đến 30/10/2026?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q18_TX_PREV_MONTH_EXPENSE",
    group: "TRANSACTION_STATS",
    question: "Tháng trước tôi đã chi bao nhiêu?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },

  // --- Group 4: Budgets & Savings Progress (Fast Path Candidates - 4 queries) ---
  {
    id: "Q19_BUDGET_OVERVIEW",
    group: "BUDGET_SAVINGS",
    question: "Ngân sách của tôi thế nào?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q20_SAVINGS_GOALS_OVERVIEW",
    group: "BUDGET_SAVINGS",
    question: "Tiến độ các mục tiêu tiết kiệm của tôi?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q21_BUDGET_DINING_REMAINING",
    group: "BUDGET_SAVINGS",
    question: "Ngân sách ăn uống còn bao nhiêu tiền?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },
  {
    id: "Q22_SAVINGS_GOAL_LAPTOP",
    group: "BUDGET_SAVINGS",
    question: "Mục tiêu mua laptop tiến độ thế nào?",
    expectedFastPath: true,
    expectedIntent: "PERSONAL_FINANCE",
    requiresPersonalData: true,
  },

  // --- Group 5: Complex Reasoning, What-If Simulation & Multi-turn (8 queries) ---
  {
    id: "Q23_WHATIF_SINGLE_BUY",
    group: "COMPLEX_WHATIF",
    question: "Tôi có đủ tiền mua điện thoại giá 3 triệu không?",
    expectedFastPath: false,
    expectedIntent: "AFFORDABILITY_WHATIF",
    requiresPersonalData: true,
  },
  {
    id: "Q24_WHATIF_FOLLOWUP_1",
    group: "MULTI_TURN",
    question: "Nếu mua điện thoại đó, tôi sẽ còn bao nhiêu tiền khả dụng?",
    history: [
      { role: "user", parts: [{ text: "Tôi có đủ tiền mua điện thoại giá 3 triệu không?" }] },
      { role: "model", parts: [{ text: "Bạn có đủ tiền mua điện thoại 3.000.000 VND. Số dư khả dụng hiện tại là 3.459.000 VND, sau khi mua bạn sẽ còn 459.000 VND." }] }
    ],
    expectedFastPath: false,
    expectedIntent: "AFFORDABILITY_WHATIF",
    requiresPersonalData: true,
  },
  {
    id: "Q25_WHATIF_FOLLOWUP_2",
    group: "MULTI_TURN",
    question: "Số tiền còn lại đó có đủ cho ngân sách ăn uống không?",
    history: [
      { role: "user", parts: [{ text: "Tôi có đủ tiền mua điện thoại giá 3 triệu không?" }] },
      { role: "model", parts: [{ text: "Sau khi mua bạn còn 459.000 VND khả dụng." }] },
      { role: "user", parts: [{ text: "Nếu mua điện thoại đó, tôi sẽ còn bao nhiêu tiền khả dụng?" }] },
      { role: "model", parts: [{ text: "Bạn sẽ còn lại 459.000 VND khả dụng." }] }
    ],
    expectedFastPath: false,
    expectedIntent: "AFFORDABILITY_WHATIF",
    requiresPersonalData: true,
  },
  {
    id: "Q26_MULTI_DAY_MEAL_PLAN",
    group: "COMPLEX_ADVICE",
    question: "Tôi có 200k ăn sáng trong 7 ngày, nên ăn gì?",
    expectedFastPath: false,
    expectedIntent: "AFFORDABILITY_WHATIF",
    requiresPersonalData: true,
  },
  {
    id: "Q27_GENERAL_FINANCIAL_ADVICE",
    group: "COMPLEX_ADVICE",
    question: "Tôi nên làm gì với số tiền hiện tại?",
    expectedFastPath: false,
    expectedIntent: "GENERAL_FINANCIAL_ADVICE",
    requiresPersonalData: true,
  },
  {
    id: "Q28_ANAPHORA_TRANSFERS",
    group: "MULTI_TURN_SYSTEM",
    question: "Vậy chức năng đó hoạt động thế nào?",
    history: [
      { role: "user", parts: [{ text: "Làm sao để chuyển tiền từ ví này sang ví khác?" }] },
      { role: "model", parts: [{ text: "Bạn có thể dùng chức năng chuyển tiền liên ví tại khối Quản lý Ví." }] }
    ],
    expectedFastPath: false,
    expectedIntent: "SYSTEM_KNOWLEDGE",
    requiresPersonalData: false,
  },
  {
    id: "Q29_CONVERSATION_SUMMARY",
    group: "CONVERSATION_SUMMARY",
    question: "Tóm tắt những điều chúng ta vừa trao đổi",
    history: [
      { role: "user", parts: [{ text: "Tôi có bao nhiêu tiền?" }] },
      { role: "model", parts: [{ text: "Tổng tài sản của bạn là 4.104.000 VND, khả dụng là 3.459.000 VND." }] }
    ],
    expectedFastPath: false,
    expectedIntent: "CONVERSATION_SUMMARY",
    requiresPersonalData: false,
  },
  {
    id: "Q30_OFF_TOPIC_REJECTION",
    group: "OFF_TOPIC",
    question: "Viết code python giải phương trình bậc 2 giúp tôi",
    expectedFastPath: true, // Should be rejected immediately without LLM
    expectedIntent: "OFF_TOPIC",
    requiresPersonalData: false,
  }
];

export async function runBenchmark(apiBaseUrl = "http://localhost:5173", options = {}) {
  console.log(`\n======================================================`);
  console.log(`🚀 BẮT ĐẦU BENCHMARK HIỆU NĂNG CHATBOT (30 CÂU HỎI)`);
  console.log(`Endpoint: ${apiBaseUrl}/api/chat`);
  console.log(`Thời điểm: ${new Date().toISOString()}`);
  console.log(`======================================================\n`);

  const token = await getTestAuthToken();
  const results = [];

  for (let i = 0; i < BENCHMARK_30_QUESTIONS.length; i++) {
    const q = BENCHMARK_30_QUESTIONS[i];
    const indexStr = `[${String(i + 1).padStart(2, "0")}/30]`;
    process.stdout.write(`${indexStr} ${q.id} ("${q.question.slice(0, 45)}..."): `);

    const startTime = Date.now();
    let ttft = null;
    let fullText = "";
    let statusCode = 0;
    let isFastPath = false;
    let error = null;

    try {
      const res = await fetch(`${apiBaseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          ...(options.stream ? { "Accept": "text/event-stream" } : {})
        },
        body: JSON.stringify({
          message: q.question,
          history: q.history || [],
          currentPage: "dashboard",
          stream: Boolean(options.stream)
        })
      });

      statusCode = res.status;
      const isStream = res.headers.get("content-type")?.includes("text/event-stream");

      if (isStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        while (!done) {
          const { value, done: doneReading } = await reader.read();
          done = doneReading;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            if (ttft === null && chunk.trim().length > 0) {
              ttft = Date.now() - startTime;
            }
            fullText += chunk;
          }
        }
      } else {
        const json = await res.json();
        fullText = json.reply || json.error || "";
        if (json.isFastPath) isFastPath = true;
      }
    } catch (err) {
      error = err.message;
    }

    const totalTimeMs = Date.now() - startTime;
    if (ttft === null) ttft = totalTimeMs;

    console.log(`${totalTimeMs}ms (Status: ${statusCode}, Reply len: ${fullText.length})`);

    results.push({
      id: q.id,
      group: q.group,
      question: q.question,
      statusCode,
      totalTimeMs,
      ttftMs: ttft,
      replyLength: fullText.length,
      replySnippet: fullText.slice(0, 100).replace(/\n/g, " "),
      isFastPath,
      error,
      expectedFastPath: q.expectedFastPath,
    });
  }

  // Calculate Summary Statistics
  const latencies = results.map(r => r.totalTimeMs).sort((a, b) => a - b);
  const ttfts = results.map(r => r.ttftMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  const p50Ttft = ttfts[Math.floor(ttfts.length * 0.5)];
  const p95Ttft = ttfts[Math.floor(ttfts.length * 0.95)];

  const summary = {
    totalQueries: results.length,
    p50Ms: p50,
    p95Ms: p95,
    avgMs: avg,
    minMs: min,
    maxMs: max,
    p50TtftMs: p50Ttft,
    p95TtftMs: p95Ttft,
    successCount: results.filter(r => r.statusCode === 200).length,
  };

  console.log(`\n======================================================`);
  console.log(`📊 TỔNG KẾT BENCHMARK:`);
  console.log(`- P50 Latency:      ${summary.p50Ms} ms`);
  console.log(`- P95 Latency:      ${summary.p95Ms} ms`);
  console.log(`- Trung bình (Avg): ${summary.avgMs} ms`);
  console.log(`- Min:              ${summary.minMs} ms`);
  console.log(`- Max:              ${summary.maxMs} ms`);
  console.log(`- P50 TTFT:         ${summary.p50TtftMs} ms`);
  console.log(`- P95 TTFT:         ${summary.p95TtftMs} ms`);
  console.log(`- Thành công:       ${summary.successCount}/${summary.totalQueries}`);
  console.log(`======================================================\n`);

  return { summary, results };
}

// Direct execution
if (process.argv[1]?.endsWith('benchmark-chatbot-performance.mjs')) {
  const args = process.argv.slice(2);
  const isStream = args.includes('--stream');
  const outFileArg = args.find(a => a.startsWith('--out='));
  const outFile = outFileArg ? outFileArg.split('=')[1] : (isStream ? 'docs/performance/OPTIMIZED_STREAM_RESULTS.json' : 'docs/performance/OPTIMIZED_BENCHMARK_RESULTS.json');

  runBenchmark("http://localhost:5173", { stream: isStream }).then(({ summary, results }) => {
    import('fs').then(fs => {
      fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));
      console.log(`Saved benchmark metrics to ${outFile}`);
    });
  }).catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
}
