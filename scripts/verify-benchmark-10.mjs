/**
 * scripts/verify-benchmark-10.mjs
 * =================================
 * Live Verification of 10 Benchmark System Questions & Follow-ups.
 */

import { processChat } from "../backend/src/services/ai-chat.service.ts";
import { routeUserIntent } from "../backend/src/services/ai-router.service.ts";
import { searchSystemKnowledge } from "../backend/src/services/system-rag.service.ts";

const OLLAMA_URL = "http://127.0.0.1:11434";

const BENCHMARK_QUESTIONS = [
  {
    id: "Q1",
    question: "Sổ Chi Tiêu có những chức năng chính nào?",
    expectedKeywords: ["Quản lý Ví", "Thu", "Chi", "Ngân sách", "Mục tiêu tiết kiệm"],
  },
  {
    id: "Q2",
    question: "Làm thế nào để thêm một ví mới?",
    expectedKeywords: ["Thêm ví", "Tên ví", "Loại ví", "Tạo ví"],
  },
  {
    id: "Q3",
    question: "Sự khác biệt giữa Ngân sách và Mục tiêu tiết kiệm là gì?",
    expectedKeywords: ["Ngân sách", "Mục tiêu tiết kiệm", "kiểm soát", "tích lũy"],
  },
  {
    id: "Q4",
    question: "Tại sao số dư khả dụng của tôi lại thấp hơn tổng số dư ví?",
    expectedKeywords: ["tiền dự trữ", "phân bổ", "khả dụng"],
  },
  {
    id: "Q5",
    question: "Làm sao để chuyển tiền từ ví này sang ví khác và có mất phí không?",
    expectedKeywords: ["Chuyển tiền", "Ví nguồn", "Ví đích", "phí"],
  },
  {
    id: "Q6",
    question: "Chức năng quét hóa đơn hoạt động như thế nào?",
    expectedKeywords: ["Camera", "LLaVA", "bóc tách", "biên lai"],
  },
  {
    id: "Q7",
    question: "Tôi muốn xuất toàn bộ dữ liệu ra Excel thì làm ở đâu?",
    expectedKeywords: ["Xuất Excel", "Dashboard", "xlsx"],
  },
  {
    id: "Q8",
    question: "Hệ thống có tự động nhận diện giao dịch định kỳ không?",
    expectedKeywords: ["Tự động", "Nhắc nhở", "định kỳ"],
  },
  {
    id: "Q9",
    question: "Admin có thể xem được chi tiêu cá nhân của tôi không?",
    expectedKeywords: ["KHÔNG", "Row-Level Security", "riêng tư"],
  },
  {
    id: "Q10",
    question: "Ứng dụng này sử dụng những công nghệ gì ở frontend và backend?",
    expectedKeywords: ["Next.js", "React", "Supabase", "Ollama"],
  },
];

console.log("=== BẮT ĐẦU KIỂM CHỨNG TRỰC TIẾP 10 BENCHMARK QUESTIONS ===");

for (const b of BENCHMARK_QUESTIONS) {
  const routing = routeUserIntent(b.question);
  const ragResults = searchSystemKnowledge(b.question);
  console.log(`\n[${b.id}] Hỏi: "${b.question}"`);
  console.log(`  -> Primary Intent: ${routing.primaryIntent}`);
  console.log(`  -> Requires Personal Data: ${routing.requiresPersonalData}`);
  console.log(`  -> RAG Chunks Retrieved: ${ragResults.length} (${ragResults.map((r) => r.chunk.id).join(", ")})`);

  let res;
  try {
    res = await processChat(
      OLLAMA_URL,
      { message: b.question, history: [] },
      { totalTimeoutMs: 30000 }
    );
    console.log(`  -> Status: ${res.status}`);
    const preview = res.reply ? res.reply.replace(/\n+/g, " ").slice(0, 150) + "..." : res.error;
    console.log(`  -> Trả lời: "${preview}"`);
  } catch (err) {
    console.log(`  -> Error calling Ollama: ${err.message}`);
  }
}

console.log("\n=== KIỂM CHỨNG HỘI THOẠI NỐI TIẾP (MULTI-TURN ANAPHORA) ===");
const multiTurnHistory = [
  { role: "user", parts: [{ text: "Làm sao để chuyển tiền từ ví này sang ví khác?" }] },
  { role: "model", parts: [{ text: "Bạn nhấn nút 'Chuyển tiền' tại Dashboard, chọn Ví nguồn và Ví đích, nhập số tiền rồi nhấn 'Xác nhận chuyển'." }] },
];

const followUp1 = "Vậy chức năng đó hoạt động thế nào?";
const r1 = routeUserIntent(followUp1, multiTurnHistory);
const rag1 = searchSystemKnowledge(followUp1, { history: multiTurnHistory });
console.log(`\n[Follow-up 1] "${followUp1}"`);
console.log(`  -> Intent: ${r1.primaryIntent}, RAG Chunk: ${rag1[0]?.chunk.id}`);

const followUp2 = "Có tốn phí không?";
const r2 = routeUserIntent(followUp2, multiTurnHistory);
const rag2 = searchSystemKnowledge(followUp2, { history: multiTurnHistory });
console.log(`\n[Follow-up 2] "${followUp2}"`);
console.log(`  -> Intent: ${r2.primaryIntent}, RAG Chunk: ${rag2[0]?.chunk.id}`);

const followUp3 = "Nếu làm vậy thì số dư có bị trừ không?";
const r3 = routeUserIntent(followUp3, multiTurnHistory);
const rag3 = searchSystemKnowledge(followUp3, { history: multiTurnHistory });
console.log(`\n[Follow-up 3] "${followUp3}"`);
console.log(`  -> Intent: ${r3.primaryIntent}, RAG Chunk: ${rag3[0]?.chunk.id}`);

console.log("\n=== HOÀN TẤT KIỂM CHỨNG BENCHMARK ===");

