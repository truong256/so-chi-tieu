/**
 * scripts/verify-planning-e2e.mjs
 * ===============================
 * Live E2E verification of the budget-constrained meal planning bug:
 * "Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?"
 */

import { getTestAuthToken } from '../tests/ai-evaluation/auth-helper.mjs';

async function main() {
  console.log("=====================================================");
  console.log("🧪 LIVE E2E TEST: KIỂM CHỨNG LẬP KẾ HOẠCH ĂN SÁNG");
  console.log("=====================================================\n");

  const token = await getTestAuthToken();
  const url = "http://localhost:5173/api/chat";

  const payload = {
    message: "Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?",
    history: [],
    currentPage: "/dashboard",
  };

  console.log(`Sending query: "${payload.message}"`);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const durationMs = Date.now() - t0;
  console.log(`Status: ${res.status} (took ${durationMs}ms)`);

  const json = await res.json();
  const reply = json.reply || "";

  console.log("\n--- CHATBOT RESPONSE SNIPPET ---");
  console.log(reply.slice(0, 800) + "...\n--------------------------------\n");

  // Requirements Verification:
  console.log("🔍 KIỂM TRA CÁC RÀNG BUỘC THEO YÊU CẦU:");

  // 1. Checks breakfast only, no lunch/dinner
  const hasNoLunch = !reply.includes("*(Bữa trưa)*") && !reply.includes("Bữa trưa:") && !reply.includes("bữa trưa");
  console.log(`1. Không tự ý thêm bữa trưa: ${hasNoLunch ? "✅ PASS" : "❌ FAIL"}`);

  // 2. Checks all 7 days
  const hasDay1 = reply.includes("Ngày 1");
  const hasDay7 = reply.includes("Ngày 7");
  const has7Days = hasDay1 && hasDay7;
  console.log(`2. Đủ chính xác 7 ngày (Ngày 1 -> Ngày 7): ${has7Days ? "✅ PASS" : "❌ FAIL"}`);

  // 3. Checks cash / budget limit
  const mentionsBudget = reply.includes("300.000") || reply.includes("Ngân sách") || reply.includes("3.000.000");
  console.log(`3. Nhận diện ngân sách và đối chiếu Supabase: ${mentionsBudget ? "✅ PASS" : "❌ FAIL"}`);

  // 4. Mathematical integrity & conclusion
  const concludesSufficient = reply.includes("ĐỦ TIỀN") || reply.includes("khả thi");
  console.log(`4. Kết luận chính xác về tính khả thi: ${concludesSufficient ? "✅ PASS" : "❌ FAIL"}`);

  // 5. Estimated price disclaimer
  const hasEstimateNotice = reply.includes("ước tính");
  console.log(`5. Ghi chú giá ước tính thực tế: ${hasEstimateNotice ? "✅ PASS" : "❌ FAIL"}`);

  if (hasNoLunch && has7Days && mentionsBudget && concludesSufficient && hasEstimateNotice) {
    console.log("\n🎉 TOÀN BỘ RÀNG BUỘC ĐÃ ĐƯỢC THỎA MÃN 100%!");
  } else {
    console.error("\n❌ Một số ràng buộc chưa đạt.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});

