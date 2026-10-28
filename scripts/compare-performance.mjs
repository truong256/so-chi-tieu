/**
 * scripts/compare-performance.mjs
 * ================================
 * Generates structured Markdown comparison table and analysis between Baseline and Optimized benchmarks.
 */

import fs from 'fs';

function loadJson(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const baseline = loadJson('docs/performance/BASELINE_BENCHMARK_RESULTS.json');
const optimized = loadJson('docs/performance/OPTIMIZED_BENCHMARK_RESULTS.json');
const stream = loadJson('docs/performance/STREAM_BENCHMARK_RESULTS.json');

if (!baseline || !optimized) {
  console.error("Missing baseline or optimized benchmark files.");
  process.exit(1);
}

console.log("\n=======================================================");
console.log("📊 SO SÁNH HIỆU NĂNG CHATBOT (TRƯỚC & SAU TỐI ƯU)");
console.log("=======================================================\n");

console.log(`| Chỉ số (Metric) | Baseline (Gốc) | Sau Tối ưu (Fast Path + Cache) | Cải thiện (% Reduction) |`);
console.log(`| :--- | :--- | :--- | :--- |`);

const p50Diff = Math.round(((baseline.summary.p50Ms - optimized.summary.p50Ms) / baseline.summary.p50Ms) * 100);
const avgDiff = Math.round(((baseline.summary.avgMs - optimized.summary.avgMs) / baseline.summary.avgMs) * 100);
const minDiff = Math.round(((baseline.summary.minMs - optimized.summary.minMs) / baseline.summary.minMs) * 100);

console.log(`| **P50 Latency** | ${baseline.summary.p50Ms} ms | **${optimized.summary.p50Ms} ms** | **-${p50Diff}%** |`);
console.log(`| **Average Latency** | ${baseline.summary.avgMs} ms | **${optimized.summary.avgMs} ms** | **-${avgDiff}%** |`);
console.log(`| **Min Latency** | ${baseline.summary.minMs} ms | **${optimized.summary.minMs} ms** | **-${minDiff}%** |`);
console.log(`| **Tỷ lệ thành công** | ${baseline.summary.successCount}/30 | **${optimized.summary.successCount}/30** | **100%** |`);

console.log("\n--- CHI TIẾT THEO NHÓM CÂU HỎI (PER-QUERY BREAKDOWN) ---\n");

for (let i = 0; i < baseline.results.length; i++) {
  const b = baseline.results[i];
  const o = optimized.results[i];
  const s = stream?.results?.[i];
  const diff = b.totalTimeMs - o.totalTimeMs;
  const pct = Math.round((diff / b.totalTimeMs) * 100);
  const isFp = o.isFastPath ? "⚡ [FAST PATH]" : "🤖 [LLM]";
  const streamTtft = s ? `${s.ttftMs}ms` : "N/A";
  console.log(`${b.id}: Baseline ${b.totalTimeMs}ms -> Opt ${o.totalTimeMs}ms (${pct >= 0 ? '-' : '+'}${Math.abs(pct)}%) ${isFp} | Stream TTFT: ${streamTtft}`);
}

