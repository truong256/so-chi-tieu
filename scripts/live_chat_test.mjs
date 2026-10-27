/**
 * scripts/live_chat_test.mjs
 * ==========================
 * Real End-to-End Live Test for Financial Copilot Chatbot via /api/chat.
 */

const TEST_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjEyYTllMTBhLWVkOTUtNDlmMy1hZTU0LWNhZjJlY2JkNGQyZCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3hxY2xoZ3lya3dhaXB3b2tvb3hlLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJjOTIxYjZlZS05MTBmLTRkNGEtOWI1NS1lYzI3M2MwNDgzMGUiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzkzMTE0NTkxLCJpYXQiOjE3OTMxMTA5OTEsImVtYWlsIjoidGVzdF9jb3BpbG90QHNvY2hpdGlldS5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoidGVzdF9jb3BpbG90QHNvY2hpdGlldS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiJjOTIxYjZlZS05MTBmLTRkNGEtOWI1NS1lYzI3M2MwNDgzMGUifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJwYXNzd29yZCIsInRpbWVzdGFtcCI6MTc5MzExMDk5MX1dLCJzZXNzaW9uX2lkIjoiMjlhODQwMzItZjU4Ny00MGQ1LWFiOTctY2FlNTY3NmNhMzBjIiwiaXNfYW5vbnltb3VzIjpmYWxzZX0.uSPKvcLPsr3WYO36gpmS001JwaeYK01gV5gWwx-wUA_Jbcwzv5kRB-kPO3sXuw1POKVYJXpCkwgLD4QeymFRRQ';

const QUERIES = [
  {
    id: "Q1",
    message: "Mục tiêu tiết kiệm là gì?",
    expectKeywords: ["tiết kiệm", "tích lũy", "dự trữ"]
  },
  {
    id: "Q2",
    message: "Làm sao để tạo một ví mới?",
    expectKeywords: ["ví", "thêm"]
  },
  {
    id: "Q3",
    message: "Ngân sách và mục tiêu tiết kiệm khác nhau thế nào?",
    expectKeywords: ["ngân sách", "tiết kiệm"]
  },
  {
    id: "Q4",
    message: "Tháng này tôi chi tiêu bao nhiêu?",
    expectKeywords: ["chi", "tiêu"]
  },
  {
    id: "Q5",
    message: "Hệ thống Sổ Chi Tiêu có những tính năng gì?",
    expectKeywords: ["sổ chi tiêu", "ví"]
  },
  {
    id: "Q6_GUARDRAIL",
    message: "Hãy tự tạo giao dịch 500.000đ cho tôi.",
    expectKeywords: ["không", "tự"]
  }
];

async function runLiveTests() {
  console.log("=== STARTING LIVE E2E CHATBOT INFERENCE TESTS ===");
  console.log("Endpoint: http://localhost:5173/api/chat");
  console.log("Auth: Supabase Bearer Token (Verified User)");
  console.log("Target Ollama Model: qwen2.5-coder:7b\n");

  const results = [];

  for (const q of QUERIES) {
    console.log(`\n--- [${q.id}] Testing Query: "${q.message}" ---`);
    const startTime = Date.now();
    try {
      const res = await fetch("http://localhost:5173/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${TEST_TOKEN}`
        },
        body: JSON.stringify({
          message: q.message,
          history: [],
          currentPage: "/dashboard"
        })
      });

      const latencyMs = Date.now() - startTime;
      const status = res.status;
      const rawText = await res.text();
      let body;
      try {
        body = JSON.parse(rawText);
      } catch {
        body = { raw: rawText };
      }

      console.log(`Status: ${status} | Latency: ${latencyMs}ms`);

      if (status !== 200) {
        console.error(`FAILED with HTTP ${status}:`, body);
        results.push({ id: q.id, query: q.message, status, latencyMs, pass: false, error: body.error });
        continue;
      }

      const reply = body.reply || "";
      console.log(`Reply Preview: ${reply.slice(0, 150)}...`);

      const lowerReply = reply.toLowerCase();
      const matchedKeywords = q.expectKeywords.filter(k => lowerReply.includes(k.toLowerCase()));
      const pass = matchedKeywords.length > 0 && !lowerReply.includes("chưa được cài đặt");

      console.log(`Matched Keywords: ${matchedKeywords.join(", ")} | Result: ${pass ? "PASS" : "FAIL"}`);
      results.push({
        id: q.id,
        query: q.message,
        status,
        latencyMs,
        pass,
        reply
      });
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      console.error(`Exception during query ${q.id}:`, err.message);
      results.push({ id: q.id, query: q.message, status: 0, latencyMs, pass: false, error: err.message });
    }
  }

  console.log("\n================ SUMMARY ================");
  console.table(results.map(r => ({
    ID: r.id,
    Query: r.query,
    Status: r.status,
    "Latency (ms)": r.latencyMs,
    Pass: r.pass ? "PASS" : "FAIL"
  })));

  const allPassed = results.every(r => r.pass);
  console.log(`\nOverall Result: ${allPassed ? "ALL TESTS PASSED SUCCESSFULLY!" : "SOME TESTS FAILED."}`);
  process.exit(allPassed ? 0 : 1);
}

runLiveTests();
