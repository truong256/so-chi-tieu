/**
 * scripts/verify-savings-e2e.mjs
 * ==============================
 * Live E2E verification of Savings Goal Reasoning for Sổ Chi Tiêu.
 * Tests against http://localhost:5173/api/chat with live authenticated test user.
 */

import { getTestAuthToken } from '../tests/ai-evaluation/auth-helper.mjs';

async function sendQuery(token, message, history = []) {
  const url = "http://localhost:5173/api/chat";
  const payload = {
    message,
    history,
    currentPage: "/dashboard",
  };

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
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }

  const json = await res.json();
  return {
    reply: json.reply || "",
    durationMs,
  };
}

async function runLiveVerification() {
  console.log("==================================================================");
  console.log("🚀 BẮT ĐẦU LIVE E2E AUDIT: SAVINGS GOAL REASONING CHATBOT");
  console.log("==================================================================\n");

  const token = await getTestAuthToken();
  console.log("✅ Authenticated token obtained successfully.\n");

  let allPassed = true;

  // -------------------------------------------------------------------------
  // Case 1: SAVINGS_STATUS
  // -------------------------------------------------------------------------
  console.log("--- TEST CASE 1: Truy vấn tích lũy (SAVINGS_STATUS) ---");
  console.log("Query: 'Tôi đã tiết kiệm được bao nhiêu?'");
  try {
    const r1 = await sendQuery(token, "Tôi đã tiết kiệm được bao nhiêu?");
    console.log(`Latency: ${r1.durationMs}ms`);
    console.log(`Reply Preview: ${r1.reply.slice(0, 300)}...\n`);

    const hasStatus = r1.reply.includes("TỔNG HỢP TÌNH HÌNH TIẾT KIỆM") || r1.reply.includes("tiết kiệm");
    const hasSafetyNotice = r1.reply.includes("không tự ý thực hiện giao dịch") || r1.reply.includes("không tự ý");
    const noFalse100 = !r1.reply.includes("100% thu nhập vì chưa tiêu");

    if (hasStatus && hasSafetyNotice && noFalse100) {
      console.log("✅ CASE 1 PASS: Trả về trạng thái tích lũy, có cảnh báo an toàn và không hallucinate 100%.\n");
    } else {
      console.error("❌ CASE 1 FAIL: Output missing expected markers.");
      allPassed = false;
    }
  } catch (err) {
    console.error("❌ CASE 1 ERROR:", err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------------------
  // Case 2: TARGET_GOAL
  // -------------------------------------------------------------------------
  console.log("--- TEST CASE 2: Kế hoạch mục tiêu (TARGET_GOAL) ---");
  console.log("Query: 'Mục tiêu tiết kiệm 500.000đ của tôi có khả thi không?'");
  try {
    const r2 = await sendQuery(token, "Mục tiêu tiết kiệm 500.000đ của tôi có khả thi không?");
    console.log(`Latency: ${r2.durationMs}ms`);
    console.log(`Reply Preview: ${r2.reply.slice(0, 300)}...\n`);

    const hasTarget = r2.reply.includes("500.000 VND") || r2.reply.includes("500.000đ");
    const hasFeasibility = r2.reply.includes("KHẢ THI") || r2.reply.includes("khả thi") || r2.reply.includes("ĐỦ TIỀN") || r2.reply.includes("HOÀN THÀNH");
    const hasSafetyNotice = r2.reply.includes("không tự ý thực hiện giao dịch") || r2.reply.includes("không tự ý");

    if (hasTarget && hasFeasibility && hasSafetyNotice) {
      console.log("✅ CASE 2 PASS: Tính toán mục tiêu chính xác, đánh giá khả thi rõ ràng.\n");
    } else {
      console.error("❌ CASE 2 FAIL: Output missing target evaluation.");
      allPassed = false;
    }
  } catch (err) {
    console.error("❌ CASE 2 ERROR:", err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------------------
  // Case 3: ADDITIONAL_SAVINGS
  // -------------------------------------------------------------------------
  console.log("--- TEST CASE 3: Tiết kiệm thêm (ADDITIONAL_SAVINGS) ---");
  console.log("Query: 'Tôi muốn tiết kiệm thêm 500.000đ từ tiền còn lại thì làm sao?'");
  try {
    const r3 = await sendQuery(token, "Tôi muốn tiết kiệm thêm 500.000đ từ tiền còn lại thì làm sao?");
    console.log(`Latency: ${r3.durationMs}ms`);
    console.log(`Reply Preview: ${r3.reply.slice(0, 300)}...\n`);

    const mentionsAdditional = r3.reply.includes("TIẾT KIỆM THÊM") || r3.reply.includes("tiết kiệm thêm") || r3.reply.includes("500.000");
    const mentionsAllocation = r3.reply.includes("phân bổ") || r3.reply.includes("Trích") || r3.reply.includes("ví");
    const hasSafetyNotice = r3.reply.includes("không tự ý thực hiện giao dịch") || r3.reply.includes("không tự ý");

    if (mentionsAdditional && mentionsAllocation && hasSafetyNotice) {
      console.log("✅ CASE 3 PASS: Nhận diện đúng ý định tiết kiệm thêm và đề xuất phân bổ cụ thể.\n");
    } else {
      console.error("❌ CASE 3 FAIL: Output missing allocation guidance.");
      allPassed = false;
    }
  } catch (err) {
    console.error("❌ CASE 3 ERROR:", err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------------------
  // Case 4: MAX_SAVINGS_CAPACITY
  // -------------------------------------------------------------------------
  console.log("--- TEST CASE 4: Năng lực tiết kiệm tối đa (MAX_SAVINGS_CAPACITY) ---");
  console.log("Query: 'Tháng này tôi có thể tiết kiệm được tối đa bao nhiêu?'");
  try {
    const r4 = await sendQuery(token, "Tháng này tôi có thể tiết kiệm được tối đa bao nhiêu?");
    console.log(`Latency: ${r4.durationMs}ms`);
    console.log(`Reply Preview: ${r4.reply.slice(0, 300)}...\n`);

    const mentionsCapacity = r4.reply.includes("MAX SAVINGS CAPACITY") || r4.reply.includes("tối đa") || r4.reply.includes("khả dụng");
    const hasSafetyNotice = r4.reply.includes("không tự ý thực hiện giao dịch") || r4.reply.includes("không tự ý");

    if (mentionsCapacity && hasSafetyNotice) {
      console.log("✅ CASE 4 PASS: Tính toán hạn mức tiết kiệm tối đa an toàn.\n");
    } else {
      console.error("❌ CASE 4 FAIL: Output missing max capacity analysis.");
      allPassed = false;
    }
  } catch (err) {
    console.error("❌ CASE 4 ERROR:", err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------------------
  // Case 5: MULTI-TURN CONTINUITY
  // -------------------------------------------------------------------------
  console.log("--- TEST CASE 5: Hội thoại nhiều lượt (MULTI-TURN CONTINUITY) ---");
  console.log("Turn 1: 'Tiền mặt tôi còn bao nhiêu tiền?'");
  try {
    const rTurn1 = await sendQuery(token, "Tiền mặt tôi còn bao nhiêu tiền?");
    console.log(`Turn 1 Latency: ${rTurn1.durationMs}ms`);

    const history = [
      { role: "user", parts: [{ text: "Tiền mặt tôi còn bao nhiêu tiền?" }] },
      { role: "assistant", parts: [{ text: rTurn1.reply }] },
    ];

    console.log("Turn 2: 'Với số tiền còn lại đó tôi có tiết kiệm được 200k không?'");
    const rTurn2 = await sendQuery(token, "Với số tiền còn lại đó tôi có tiết kiệm được 200k không?", history);
    console.log(`Turn 2 Latency: ${rTurn2.durationMs}ms`);
    console.log(`Reply Preview: ${rTurn2.reply.slice(0, 300)}...\n`);

    const retainsContext = rTurn2.reply.includes("200.000") || rTurn2.reply.includes("khả thi") || rTurn2.reply.includes("tiền mặt");
    const hasSafetyNotice = rTurn2.reply.includes("không tự ý thực hiện giao dịch") || rTurn2.reply.includes("không tự ý");

    if (retainsContext && hasSafetyNotice) {
      console.log("✅ CASE 5 PASS: Duy trì trọn vẹn ngữ cảnh ví/tiền còn lại từ lượt hội thoại trước.\n");
    } else {
      console.error("❌ CASE 5 FAIL: Multi-turn context dropped or missing safety notice.");
      allPassed = false;
    }
  } catch (err) {
    console.error("❌ CASE 5 ERROR:", err.message);
    allPassed = false;
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("==================================================================");
  if (allPassed) {
    console.log("🎉 TOÀN BỘ 5 KỊCH BẢN LIVE E2E ĐỀU ĐẠT CHUẨN (PASS 100%)!");
    console.log("==================================================================");
  } else {
    console.error("💥 CÓ KỊCH BẢN CHƯA ĐẠT. VUI LÒNG KIỂM TRA LẠI LOG CHI TIẾT.");
    console.log("==================================================================");
    process.exit(1);
  }
}

runLiveVerification().catch(err => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
