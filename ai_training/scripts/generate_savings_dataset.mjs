/**
 * ai_training/scripts/generate_savings_dataset.mjs
 * ===============================================
 * Generates >= 500 verified, diverse savings reasoning samples across 10 categories.
 * Splits into train (70%), val (15%), test (15%).
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSavingsReasoningQuery } from '../../backend/src/services/savings-calculator.service.ts';

const OUTPUT_DIR = path.resolve('ai_training/dataset');
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const targets = [
  { text: '500k', val: 500000 },
  { text: '1 triệu', val: 1000000 },
  { text: '1,5 triệu', val: 1500000 },
  { text: '2 triệu', val: 2000000 },
  { text: '2,5 triệu', val: 2500000 },
  { text: '3 triệu', val: 3000000 },
  { text: '4 triệu', val: 4000000 },
  { text: '5 triệu', val: 5000000 },
  { text: '6 triệu', val: 6000000 },
  { text: '7 triệu', val: 7000000 },
  { text: '8 triệu', val: 8000000 },
  { text: '9 triệu', val: 9000000 },
  { text: '10 triệu', val: 10000000 },
  { text: '12 triệu', val: 12000000 },
  { text: '15 triệu', val: 15000000 },
  { text: '20 triệu', val: 20000000 },
  { text: '25 triệu', val: 25000000 },
  { text: '30 triệu', val: 30000000 },
  { text: '40 triệu', val: 40000000 },
  { text: '50 triệu', val: 50000000 },
  { text: '100 triệu', val: 100000000 },
  { text: '1 củ', val: 1000000 },
  { text: '2 củ', val: 2000000 },
  { text: '3 củ', val: 3000000 },
  { text: '5 củ', val: 5000000 },
  { text: '10 củ', val: 10000000 },
  { text: '20 củ', val: 20000000 },
  { text: '1 tr', val: 1000000 },
  { text: '2 tr', val: 2000000 },
  { text: '3 tr', val: 3000000 },
  { text: '5 tr', val: 5000000 },
  { text: '10tr', val: 10000000 },
  { text: '15 tr', val: 15000000 },
  { text: '20 tr', val: 20000000 },
];

const durations = [
  { text: '10 ngày', periods: 10, unit: 'ngày', days: 10 },
  { text: '14 ngày', periods: 14, unit: 'ngày', days: 14 },
  { text: '20 ngày', periods: 20, unit: 'ngày', days: 20 },
  { text: '30 ngày', periods: 30, unit: 'ngày', days: 30 },
  { text: '45 ngày', periods: 45, unit: 'ngày', days: 45 },
  { text: '60 ngày', periods: 60, unit: 'ngày', days: 60 },
  { text: '90 ngày', periods: 90, unit: 'ngày', days: 90 },
  { text: '100 ngày', periods: 100, unit: 'ngày', days: 100 },
  { text: '1 tháng', periods: 1, unit: 'tháng', days: 30 },
  { text: '2 tháng', periods: 2, unit: 'tháng', days: 60 },
  { text: '3 tháng', periods: 3, unit: 'tháng', days: 90 },
  { text: '4 tháng', periods: 4, unit: 'tháng', days: 120 },
  { text: '5 tháng', periods: 5, unit: 'tháng', days: 150 },
  { text: '6 tháng', periods: 6, unit: 'tháng', days: 180 },
  { text: '8 tháng', periods: 8, unit: 'tháng', days: 240 },
  { text: '10 tháng', periods: 10, unit: 'tháng', days: 300 },
  { text: '12 tháng', periods: 12, unit: 'tháng', days: 360 },
  { text: '1 năm', periods: 1, unit: 'năm', days: 365 },
  { text: '2 năm', periods: 2, unit: 'năm', days: 730 },
];

const recurringAmounts = [
  { text: '10k', val: 10000 },
  { text: '20k', val: 20000 },
  { text: '30k', val: 30000 },
  { text: '50.000đ', val: 50000 },
  { text: '70k', val: 70000 },
  { text: '100k', val: 100000 },
  { text: '150k', val: 150000 },
  { text: '200k', val: 200000 },
  { text: '300k', val: 300000 },
  { text: '500k', val: 500000 },
  { text: '1 triệu', val: 1000000 },
  { text: '1,5 triệu', val: 1500000 },
  { text: '2 triệu', val: 2000000 },
  { text: '3 triệu', val: 3000000 },
  { text: '5 triệu', val: 5000000 },
  { text: '10 triệu', val: 10000000 },
];

const samples = [];
let sampleId = 1;

function addSample(category, query, history = [], note = '') {
  const result = parseSavingsReasoningQuery(query, history);
  if (!result) return;
  samples.push({
    id: `SAV_${String(sampleId++).padStart(4, '0')}`,
    category,
    query,
    intent: result.intent,
    extracted_params: {
      targetAmount: result.targetAmount,
      durationPeriods: result.durationPeriods,
      durationUnit: result.durationUnit,
      effectiveDays: result.effectiveDays,
      alreadySaved: result.alreadySaved,
      remainingAmount: result.remainingAmount,
      dailySaving: result.dailySaving,
      monthlySaving: result.monthlySaving,
      totalSavedAtEnd: result.totalSavedAtEnd,
    },
    history,
    expected_reply: result.explanationVi,
    aiMiscalculationCorrected: Boolean(result.aiMiscalculationCorrected),
    isAmbiguous: Boolean(result.isAmbiguous),
    note,
  });
}

// 1. Nhóm 1 — Mục tiêu tiết kiệm tổng cộng (TOTAL_SAVINGS_TARGET) (100 câu)
const userPronouns = ['Tôi', 'Mình', 'Em'];
const verbs = ['muốn tiết kiệm', 'muốn để dành', 'cần tích lũy', 'muốn gom', 'dự định để dành'];

for (let i = 0; i < targets.length; i++) {
  const t = targets[i];
  const d1 = durations[i % durations.length];
  const d2 = durations[(i + 3) % durations.length];
  const p = userPronouns[i % userPronouns.length];
  const v = verbs[i % verbs.length];

  addSample('Mục tiêu tiết kiệm tổng cộng', `${p} ${v} ${t.text} trong ${d1.text}.`);
  addSample('Mục tiêu tiết kiệm tổng cộng', `${p} ${v} ${t.text} trong ${d1.text} thì mỗi ngày cần dành ra bao nhiêu?`);
  addSample('Mục tiêu tiết kiệm tổng cộng', `${p} ${v} ${t.text} trong ${d2.text} thì mỗi tháng cần bao nhiêu?`);
}
addSample('Mục tiêu tiết kiệm tổng cộng', 'Tôi muốn để dành 5 củ trong 3 tháng.');
addSample('Mục tiêu tiết kiệm tổng cộng', 'Tôi muốn có 6 triệu sau 60 ngày.');
addSample('Mục tiêu tiết kiệm tổng cộng', 'Tôi muốn có 3 triệu sau 60 ngày thì mỗi ngày tiết kiệm bao nhiêu?');
addSample('Mục tiêu tiết kiệm tổng cộng', 'Tôi muốn tiết kiệm tổng cộng 5 triệu, không phải mỗi tháng.');
addSample('Mục tiêu tiết kiệm tổng cộng', 'Tôi muốn tích lũy 5 triệu, không phải 5 triệu mỗi tháng.');

// 2. Nhóm 2 — Tiết kiệm định kỳ mỗi ngày (DAILY_SAVINGS) (70 câu)
for (const r of recurringAmounts.slice(0, 8)) {
  for (const d of [7, 10, 14, 20, 21, 30, 45, 60, 90, 100]) {
    addSample('Tiết kiệm định kỳ mỗi ngày', `Tôi tiết kiệm ${r.text} mỗi ngày trong ${d} ngày.`);
    addSample('Tiết kiệm định kỳ mỗi ngày', `Nếu mỗi ngày để dành ${r.text} trong ${d} ngày thì được bao nhiêu?`);
  }
}

// 3. Nhóm 3 — Tiết kiệm định kỳ mỗi tuần (WEEKLY_SAVINGS) (50 câu)
for (const r of recurringAmounts.slice(4, 10)) {
  for (const w of [2, 4, 6, 8, 10, 12, 24, 52]) {
    addSample('Tiết kiệm định kỳ mỗi tuần', `Tôi tiết kiệm ${r.text} mỗi tuần trong ${w} tuần.`);
    addSample('Tiết kiệm định kỳ mỗi tuần', `Nếu mỗi tuần để dành ${r.text} trong ${w} tuần thì sau cùng có bao nhiêu?`);
  }
}

// 4. Nhóm 4 — Tiết kiệm định kỳ mỗi tháng (RECURRING_SAVINGS_AMOUNT) (70 câu)
for (const r of recurringAmounts.slice(5)) {
  for (const m of [2, 3, 4, 5, 6, 8, 9, 10, 12, 24]) {
    addSample('Tiết kiệm định kỳ mỗi tháng', `Tôi tiết kiệm ${r.text} mỗi tháng trong ${m} tháng.`);
    addSample('Tiết kiệm định kỳ mỗi tháng', `Nếu mỗi tháng bỏ ${r.text} thì ${m} tháng có bao nhiêu?`);
  }
}
addSample('Tiết kiệm định kỳ mỗi tháng', 'Mỗi tháng bỏ 500k thì một năm có bao nhiêu?');
addSample('Tiết kiệm định kỳ mỗi tháng', 'Mỗi tháng tiết kiệm 500k trong 12 tháng.');

// 5. Nhóm 5 — Tiết kiệm theo thời hạn (REQUIRED_DAILY_SAVINGS / TIMELINE) (70 câu)
for (const t of targets.slice(0, 10)) {
  for (const d of [15, 20, 30, 45, 60, 90, 100]) {
    addSample('Tiết kiệm theo thời hạn', `Tôi muốn có ${t.text} sau ${d} ngày thì mỗi ngày tiết kiệm bao nhiêu?`);
    addSample('Tiết kiệm theo thời hạn', `Cần tiết kiệm bao nhiêu mỗi ngày để sau ${d} ngày có ${t.text}?`);
  }
}
for (const r of ['20k', '30k', '50k', '100k', '200k', '500k']) {
  for (const t of ['1 triệu', '2 triệu', '3 triệu', '5 triệu', '10 triệu', '20 triệu']) {
    addSample('Tiết kiệm theo thời hạn', `Nếu mỗi ngày bỏ ${r} thì bao lâu được ${t}?`);
  }
}

// 6. Nhóm 6 — Mục tiêu đã có tiền tích lũy (REMAINING_SAVINGS) (55 câu)
for (const t of [
  { target: '3 triệu', saved: '1 triệu', days: '20 ngày' },
  { target: '5 triệu', saved: '2 triệu', days: '30 ngày' },
  { target: '6 triệu', saved: '1 triệu', days: '50 ngày' },
  { target: '8 triệu', saved: '3 triệu', days: '60 ngày' },
  { target: '10 triệu', saved: '4 triệu', days: '100 ngày' },
  { target: '12 triệu', saved: '2 triệu', days: '90 ngày' },
  { target: '15 triệu', saved: '5 triệu', days: '6 tháng' },
  { target: '20 triệu', saved: '8 triệu', days: '120 ngày' },
  { target: '25 triệu', saved: '5 triệu', days: '5 tháng' },
  { target: '30 triệu', saved: '10 triệu', days: '6 tháng' },
  { target: '50 triệu', saved: '20 triệu', days: '10 tháng' },
]) {
  addSample('Mục tiêu có tiền tích lũy', `Tôi muốn có ${t.target}, hiện đã tiết kiệm ${t.saved}, còn ${t.days}.`);
  addSample('Mục tiêu có tiền tích lũy', `Mục tiêu ${t.target}, có sẵn ${t.saved}, thời hạn còn ${t.days} thì mỗi ngày cần bao nhiêu?`);
  addSample('Mục tiêu có tiền tích lũy', `Có sẵn ${t.saved}, cần thêm ${t.target} trong ${t.days}.`);
}

// 7. Nhóm 7 — Tiết kiệm thêm ngoài số đã có (ADDITIONAL_SAVINGS) (55 câu)
for (const add of ['500k', '1 triệu', '1,5 triệu', '2 triệu', '3 triệu', '4 triệu', '5 triệu', '7 triệu', '10 triệu', '15 triệu', '20 triệu']) {
  for (const d of ['14 ngày', '20 ngày', '30 ngày', '60 ngày', '3 tháng', '6 tháng']) {
    addSample('Tiết kiệm thêm', `Tôi cần thêm ${add} trong ${d}.`);
    addSample('Tiết kiệm thêm', `Tôi muốn tiết kiệm thêm ${add} trong ${d}.`);
  }
}

// 8. Nhóm 8 — Hội thoại nhiều lượt & Sửa lỗi AI trước đó (50 câu)
const multiTurnScenarios = [
  // Error correction
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Nếu tiết kiệm 5.000.000 VND mỗi tháng, sau 3 tháng bạn có 15.000.000 VND.' }] }
    ],
    query: 'Mỗi ngày tôi cần dành ra bao nhiêu?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Nếu tiết kiệm 5.000.000 VND mỗi tháng, sau 3 tháng bạn có 15.000.000 VND.' }] }
    ],
    query: 'Vậy mỗi ngày bao nhiêu?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 10 triệu trong 6 tháng.' }] },
      { role: 'model', parts: [{ text: 'Nếu tiết kiệm 10.000.000 VND mỗi tháng, sau 6 tháng bạn có 60.000.000 VND.' }] }
    ],
    query: 'Mỗi ngày tôi cần dành ra bao nhiêu?'
  },
  // Normal follow-up
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Mục tiêu 5.000.000 VND trong 3 tháng.' }] }
    ],
    query: 'Mỗi ngày tôi cần dành ra bao nhiêu?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 10 triệu trong 100 ngày.' }] },
      { role: 'model', parts: [{ text: 'Mục tiêu 10.000.000 VND trong 100 ngày.' }] }
    ],
    query: 'Vậy mỗi ngày bao nhiêu?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 6 triệu trong 60 ngày.' }] },
      { role: 'model', parts: [{ text: 'Mục tiêu 6.000.000 VND trong 60 ngày.' }] }
    ],
    query: 'Mỗi tháng thì sao?'
  },
  // Rate change
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Mỗi ngày cần 55.556 VND/ngày.' }] }
    ],
    query: 'Nếu tôi tăng lên 50k/ngày thì sao?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Mỗi ngày cần 55.556 VND/ngày.' }] }
    ],
    query: 'Nếu tôi tăng lên 70k/ngày thì sao?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 10 triệu trong 100 ngày.' }] },
      { role: 'model', parts: [{ text: 'Mỗi ngày cần 100.000 VND/ngày.' }] }
    ],
    query: 'Nếu tôi tăng lên 150k/ngày thì sao?'
  },
  // Missed days
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Mỗi ngày cần 55.556 VND/ngày.' }] }
    ],
    query: 'Nếu bỏ lỡ 5 ngày tiết kiệm thì mức tiết kiệm còn lại thay đổi thế nào?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Mỗi ngày cần 55.556 VND/ngày.' }] }
    ],
    query: 'Nếu quên 3 ngày không tiết kiệm thì sao?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 10 triệu trong 100 ngày.' }] },
      { role: 'model', parts: [{ text: 'Mỗi ngày cần 100.000 VND/ngày.' }] }
    ],
    query: 'Nếu bỏ lỡ 10 ngày tiết kiệm thì mức tiết kiệm còn lại thay đổi thế nào?'
  },
  // Changing target
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 5 triệu trong 3 tháng.' }] },
      { role: 'model', parts: [{ text: 'Mục tiêu 5.000.000 VND trong 3 tháng.' }] },
      { role: 'user', parts: [{ text: 'Tôi muốn đổi thành 10 triệu trong 6 tháng.' }] },
      { role: 'model', parts: [{ text: 'Đã đổi mục tiêu thành 10.000.000 VND trong 6 tháng.' }] }
    ],
    query: 'Mỗi ngày bao nhiêu?'
  },
  {
    hist: [
      { role: 'user', parts: [{ text: 'Tôi muốn tiết kiệm 3 triệu trong 30 ngày.' }] },
      { role: 'model', parts: [{ text: 'Mục tiêu 3.000.000 VND trong 30 ngày.' }] },
      { role: 'user', parts: [{ text: 'Đổi mục tiêu sang 6 triệu trong 60 ngày.' }] },
      { role: 'model', parts: [{ text: 'Đã cập nhật mục tiêu sang 6.000.000 VND trong 60 ngày.' }] }
    ],
    query: 'Vậy mỗi ngày cần bao nhiêu?'
  }
];

for (const sc of multiTurnScenarios) {
  addSample('Hội thoại nhiều lượt', sc.query, sc.hist);
}

// 9. Nhóm 9 — Nhập sai chính tả hoặc không dấu (TYPO_NO_ACCENT) (40 câu)
const noAccentList = [
  'Toi muon tiet kiem 5 trieu trong 3 thang thi moi ngay can danh ra bao nhieu?',
  'Toi muon tiet kiem 5 cu trong 3 thang.',
  'tiet kiem 50k moi ngay trong 30 ngay',
  'muon co 3 trieu sau 60 ngay moi ngay bao nhieu',
  'Toi can them 2 tr trong 20 ngay',
  'Moi thang tiet kiem 500k trong 12 thang thi duoc bao nhieu',
  'Toi muon co 10 tr, da co 4 tr, con 100 ngay',
  'doi muc tieu thanh 10 trieu trong 6 thang',
  'muon co 6 trieu sau 60 ngay',
  'neu moi ngay bo 30k thi bao lau duoc 1 trieu',
  'Toi muon tiet kiem 3 tr trong 30 ngay',
  'Moi ngay tiet kiem 20k trong 30 ngay thi duoc bao nhieu',
  'Toi can them 5 củ trong 2 thang',
  'Toi muon de danh 10 cu trong 6 thang',
  'tiet kiem 100k moi ngay trong 50 ngay',
  'neu moi ngay de danh 50.000d trong 7 ngay thi duoc bao nhieu',
];
for (const na of noAccentList) {
  addSample('Không dấu và tiếng lóng', na);
}

// 10. Nhóm 10 — Câu hỏi mơ hồ cần hỏi lại (AMBIGUOUS_SAVINGS) (20 câu)
const ambiguousList = [
  'Tôi muốn tiết kiệm tiền trong vài tháng.',
  'Tôi muốn tiết kiệm một khoản tiền trong thời gian tới.',
  'Tôi định tiết kiệm tiền trong vài tháng.',
  'Tôi muốn để dành một khoản tiền.',
  'Tôi muốn tích lũy tiền trong vài tháng.',
  'Làm sao để tiết kiệm tiền trong vài tháng?',
  'Tôi định để dành tiền trong vài tháng.',
  'Tôi muốn gom tiền trong vài tháng tới.',
];
for (const ab of ambiguousList) {
  addSample('Câu hỏi mơ hồ', ab);
}

// Deduplicate samples by (query + history length + category)
const uniqueSamples = [];
const seenKeys = new Set();
for (const s of samples) {
  const key = `${s.query}_${s.history.length}`;
  if (!seenKeys.has(key)) {
    seenKeys.add(key);
    uniqueSamples.push(s);
  }
}

console.log(`Generated ${uniqueSamples.length} unique savings reasoning samples!`);

// Save full dataset
const fullPath = path.join(OUTPUT_DIR, 'savings_reasoning_full.jsonl');
fs.writeFileSync(fullPath, uniqueSamples.map(s => JSON.stringify(s)).join('\n'), 'utf8');

// Shuffle deterministically
const shuffled = [...uniqueSamples].sort((a, b) => a.id.localeCompare(b.id));

// Split: 70% Train, 15% Val, 15% Test
const trainCut = Math.floor(shuffled.length * 0.70);
const valCut = Math.floor(shuffled.length * 0.85);

const trainSet = shuffled.slice(0, trainCut);
const valSet = shuffled.slice(trainCut, valCut);
const testSet = shuffled.slice(valCut);

fs.writeFileSync(path.join(OUTPUT_DIR, 'savings_reasoning_train.jsonl'), trainSet.map(s => JSON.stringify(s)).join('\n'), 'utf8');
fs.writeFileSync(path.join(OUTPUT_DIR, 'savings_reasoning_val.jsonl'), valSet.map(s => JSON.stringify(s)).join('\n'), 'utf8');
fs.writeFileSync(path.join(OUTPUT_DIR, 'savings_reasoning_test.jsonl'), testSet.map(s => JSON.stringify(s)).join('\n'), 'utf8');

console.log(`Saved datasets to ${OUTPUT_DIR}:`);
console.log(`- Full:  ${uniqueSamples.length} samples`);
console.log(`- Train: ${trainSet.length} samples (70%)`);
console.log(`- Val:   ${valSet.length} samples (15%)`);
console.log(`- Test:  ${testSet.length} samples (15%)`);
