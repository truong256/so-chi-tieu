/**
 * tests/ai-evaluation/run-savings-100-evaluation.mjs
 * =================================================
 * Automated Benchmark Runner for 100 Savings Goal Reasoning Test Cases.
 *
 * Rules:
 * - Executes LIVE tests against http://localhost:5173/api/chat with seeded test session.
 * - Multi-turn conversation history is passed appropriately.
 * - Telemetry: Latency (ms), HTTP status, word count, pass/fail status, match rate.
 * - Generates structured JSON and CSV reports in docs/ai-evaluation/.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getTestAuthToken } from "./auth-helper.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAT_API_URL = process.env.CHAT_API_URL || "http://localhost:5173/api/chat";
const QUESTIONS_FILE = path.join(__dirname, "savings-reasoning-100-questions.json");
const OUTPUT_DIR = path.resolve(__dirname, "../../docs/ai-evaluation");

// CLI flags
const args = process.argv.slice(2);
const filterFlag = args.find((a) => a.startsWith("--filter="))?.split("=")[1];
const groupFlag = args.find((a) => a.startsWith("--group="))?.split("=")[1];
const limitFlag = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 0;
const delayMs = Number(args.find((a) => a.startsWith("--delay="))?.split("=")[1]) || 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[.,\s]/g, "");
}

function evaluateResponse(q, replyText, httpStatus) {
  if (httpStatus !== 200) {
    return {
      status: "FAIL",
      score: 0,
      reason: `HTTP Status ${httpStatus}`,
      missingKeywords: q.expectedKeywords || [],
    };
  }

  const missingKeywords = [];
  const lowerReply = (replyText || "").toLowerCase();

  // Check expected keywords
  for (const kw of q.expectedKeywords || []) {
    const kwLower = kw.toLowerCase();
    // Match either exact or normalized (without dots/commas)
    const normKw = normalizeText(kw);
    const normReply = normalizeText(replyText);

    if (!lowerReply.includes(kwLower) && !normReply.includes(normKw)) {
      missingKeywords.push(kw);
    }
  }

  // Check critical anti-hallucination:
  // If target is 5M in 3 months, reply must NOT claim 15.000.000 VND as required target
  if (q.id === "SR_001" || q.id === "SR_002" || q.id === "SR_076") {
    if (replyText.includes("15.000.000 VND") && !replyText.includes("đính chính") && !replyText.includes("nhầm lẫn")) {
      return {
        status: "FAIL",
        score: 0,
        reason: "Detected 15M multiplication hallucination on savings target!",
        missingKeywords,
      };
    }
  }

  const score = missingKeywords.length === 0 ? 100 : Math.max(0, 100 - missingKeywords.length * 25);
  const status = missingKeywords.length === 0 ? "PASS" : (score >= 75 ? "PASS" : "FAIL");

  return {
    status,
    score,
    missingKeywords,
    reason: missingKeywords.length > 0 ? `Missing keywords: ${missingKeywords.join(", ")}` : "All criteria met",
  };
}

async function runEvaluation() {
  console.log("================================================================================");
  console.log("       SAVINGS GOAL REASONING & CONVERSATIONAL MEMORY 100-BENCHMARK RUNNER      ");
  console.log("================================================================================");

  if (!fs.existsSync(QUESTIONS_FILE)) {
    console.error(`Error: Questions file not found at ${QUESTIONS_FILE}`);
    process.exit(1);
  }

  let questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, "utf-8"));
  console.log(`Loaded ${questions.length} test cases from ${path.basename(QUESTIONS_FILE)}`);

  if (filterFlag) {
    questions = questions.filter((q) => q.id.includes(filterFlag));
    console.log(`Filtered by id '${filterFlag}': ${questions.length} questions remaining.`);
  }

  if (groupFlag) {
    questions = questions.filter((q) => q.group.toLowerCase().includes(groupFlag.toLowerCase()));
    console.log(`Filtered by group '${groupFlag}': ${questions.length} questions remaining.`);
  }

  if (limitFlag > 0) {
    questions = questions.slice(0, limitFlag);
    console.log(`Limited to first ${limitFlag} questions.`);
  }

  // Auth token
  console.log("\nAcquiring test authentication token...");
  const token = await getTestAuthToken();
  console.log(`Auth token acquired successfully: ${token.slice(0, 15)}...`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results = [];
  let passedCount = 0;
  let failedCount = 0;
  let totalLatency = 0;

  console.log(`\nExecuting ${questions.length} live requests against ${CHAT_API_URL}...\n`);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const startTime = performance.now();

    let httpStatus = 0;
    let replyText = "";
    let errorMsg = null;

    try {
      const response = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: q.question,
          history: q.history || [],
        }),
      });

      httpStatus = response.status;
      const data = await response.json();
      replyText = data.reply || data.token || "";
      if (data.error) errorMsg = data.error;
    } catch (err) {
      httpStatus = 500;
      errorMsg = err.message;
    }

    const latency = Math.round(performance.now() - startTime);
    totalLatency += latency;

    const evalResult = evaluateResponse(q, replyText, httpStatus);

    if (evalResult.status === "PASS") {
      passedCount++;
    } else {
      failedCount++;
    }

    const testRecord = {
      id: q.id,
      group: q.group,
      question: q.question,
      expectedIntent: q.expectedIntent,
      httpStatus,
      latencyMs: latency,
      status: evalResult.status,
      score: evalResult.score,
      reason: evalResult.reason,
      missingKeywords: evalResult.missingKeywords,
      replySample: replyText.slice(0, 160).replace(/\n/g, " "),
    };

    results.push(testRecord);

    const statusBadge = evalResult.status === "PASS" ? " [PASS] " : " [FAIL] ";
    const progress = `[${String(i + 1).padStart(3, " ")}/${questions.length}]`;
    console.log(
      `${progress} ${q.id} ${statusBadge} (${latency}ms) [${q.group}] - ${q.question.slice(0, 45)}...`
    );

    if (evalResult.status === "FAIL") {
      console.log(`       -> REASON: ${evalResult.reason}`);
      console.log(`       -> REPLY:  ${replyText.slice(0, 120)}...`);
    }

    if (delayMs > 0 && i < questions.length - 1) {
      await sleep(delayMs);
    }
  }

  // Summary by Group
  const groupStats = {};
  for (const r of results) {
    if (!groupStats[r.group]) {
      groupStats[r.group] = { total: 0, passed: 0, failed: 0, latencySum: 0 };
    }
    groupStats[r.group].total++;
    if (r.status === "PASS") groupStats[r.group].passed++;
    else groupStats[r.group].failed++;
    groupStats[r.group].latencySum += r.latencyMs;
  }

  const passRate = ((passedCount / results.length) * 100).toFixed(1);
  const avgLatency = Math.round(totalLatency / results.length);

  console.log("\n================================================================================");
  console.log("                           BENCHMARK EXECUTION SUMMARY                          ");
  console.log("================================================================================");
  console.log(`Total Test Cases   : ${results.length}`);
  console.log(`Passed             : ${passedCount} (${passRate}%)`);
  console.log(`Failed             : ${failedCount}`);
  console.log(`Average Latency    : ${avgLatency}ms`);
  console.log("--------------------------------------------------------------------------------");
  console.log("GROUP BREAKDOWN:");
  for (const [grp, st] of Object.entries(groupStats)) {
    const rate = ((st.passed / st.total) * 100).toFixed(1);
    const avgGrpLatency = Math.round(st.latencySum / st.total);
    console.log(`- ${grp.padEnd(30, " ")}: ${st.passed}/${st.total} PASS (${rate}%) - Avg ${avgGrpLatency}ms`);
  }
  console.log("================================================================================");

  // Export JSON Report
  const jsonReportPath = path.join(OUTPUT_DIR, "SAVINGS_100_TEST_RESULTS.json");
  const reportData = {
    timestamp: new Date().toISOString(),
    totalQuestions: results.length,
    passedCount,
    failedCount,
    passRate: `${passRate}%`,
    averageLatencyMs: avgLatency,
    groupBreakdown: groupStats,
    results,
  };
  fs.writeFileSync(jsonReportPath, JSON.stringify(reportData, null, 2), "utf-8");
  console.log(`\nExported JSON report to: ${jsonReportPath}`);

  // Export CSV Report
  const csvReportPath = path.join(OUTPUT_DIR, "SAVINGS_100_TEST_RESULTS.csv");
  const csvHeaders = ["ID", "Group", "Question", "ExpectedIntent", "HTTPStatus", "LatencyMs", "Status", "Score", "Reason", "ReplySample"];
  const csvRows = results.map((r) => [
    r.id,
    `"${r.group.replace(/"/g, '""')}"`,
    `"${r.question.replace(/"/g, '""')}"`,
    r.expectedIntent,
    r.httpStatus,
    r.latencyMs,
    r.status,
    r.score,
    `"${r.reason.replace(/"/g, '""')}"`,
    `"${r.replySample.replace(/"/g, '""')}"`,
  ].join(","));

  fs.writeFileSync(csvReportPath, [csvHeaders.join(","), ...csvRows].join("\n"), "utf-8");
  console.log(`Exported CSV report to : ${csvReportPath}`);

  if (failedCount > 0) {
    console.warn(`\nWarning: ${failedCount} test case(s) did not pass 100% criteria.`);
    process.exit(1);
  } else {
    console.log("\nALL 100 SAVINGS GOAL REASONING TEST CASES PASSED SUCCESSFULLY!");
    process.exit(0);
  }
}

runEvaluation().catch((err) => {
  console.error("Benchmark runner failed:", err);
  process.exit(1);
});
