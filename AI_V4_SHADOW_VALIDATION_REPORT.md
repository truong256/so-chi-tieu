# AI V4 SHADOW VALIDATION & CLEAN INDEPENDENT BENCHMARK REPORT

**Phase:** CLASSIFY V4 SHADOW MODE + CLEAN INDEPENDENT BENCHMARK  
**Author:** Antigravity AI Engineering  
**Date:** September 27, 2026  
**Status:** COMPLETED & VERIFIED  
**Repository Branch:** `ai/retrain-v3`  

---

## 1. Benchmark Contamination Audit

A forensic duplication audit was conducted to identify any evaluation contamination between the evaluation sets and training corpora:

### 1.1 Duplication Findings Breakdown

| Evaluation Dataset | Compared Against | Exact Matches | Normalized / Template Matches | Nature of Overlap | Assessment |
|---|---|---:|---:|---|---|
| `staging_realistic_test_set.json` (250) | `model_classify_v3/data/train.json` (2837) | **4 (1.60%)** | **12 (4.80%)** | Training samples pre-existed before staging evaluation | **EVALUATION CONTAMINATION (Train Leak)** |
| `staging_realistic_test_set.json` (250) | `model_classify_v4/data/new_hard_examples.json` (235) | **0 (0.00%)** | **0 (0.00%)** | Zero overlap | **STRICTLY ZERO LEAKAGE** |
| `staging_realistic_test_set.json` (250) | `model_classify_v3/data/hard_test.json` (160) | 10 (4.00%) | 5 (2.00%) | Shared evaluation holdout phrases | Cross-test overlap (Non-train) |
| `model_classify_v3/data/test.json` (614) | `model_classify_v3/data/train.json` (2837) | 0 (0.00%) | **368 (70.50%)** | Synthetic template variants | **HIGH SYNTHETIC REDUNDANCY** |

### 1.2 Inventory of Contaminated Staging Samples

The 16 contaminated samples found in `staging_realistic_test_set.json` that matched `train.json`:

```
Exact Duplicates (4 samples):
  1. "chè sầu riêng 30k"       (Exp: ăn uống)   == Train: "chè sầu riêng 30k"
  2. "trà đào cam sả"          (Exp: ăn uống)   == Train: "trà đào cam sả"
  3. "bảo dưỡng xe honda"      (Exp: di chuyển) == Train: "BẢO DƯỠNG XE HONDA"
  4. "mua chứng chỉ quỹ vfmvf1" (Exp: đầu tư)    == Train: "mua chứng chỉ quỹ vfmvf1"

Normalized / Template Near-Duplicates (12 samples):
  5. "lẩu haidilao 890k"        (Exp: ăn uống)   ~~ Train: "lẩu haidilao 40k"
  6. "🍔 Gà rán kfc 120k 🍟"    (Exp: ăn uống)   ~~ Train: "gà rán kfc 85k"
  7. "be bike 25k"              (Exp: di chuyển) ~~ Train: "BE BIKE 45K"
  8. "ve xe buyt thang"         (Exp: di chuyển) ~~ Train: "ve xe buyt thang 70k"
  9. "rửa xe máy 25k"           (Exp: di chuyển) ~~ Train: "rửa xe máy 500k"
  10. "taxi mai linh 85k"       (Exp: di chuyển) ~~ Train: "taxi mai linh"
  11. "mua ốp lưng điện thoại 50k" (Exp: mua sắm) ~~ Train: "Mua ốp lưng điện thoại"
  12. "tai nghe bluetooth"      (Exp: mua sắm)   ~~ Train: "tai nghe bluetooth 750k"
  13. "mua thuoc cho me"        (Exp: sức khỏe)  ~~ Train: "mua thuoc cho me 120k"
  14. "gửi tiền kỳ hạn 6 tháng"  (Exp: đầu tư)    ~~ Train: "gửi tiền kỳ hạn 12 tháng 5000k"
  15. "dau tu trai phieu doanh nghiep" (Exp: đầu tư) ~~ Train: "dau tu trai phieu doanh nghiep 2000k"
  16. "lương tháng 9"           (Exp: thu nhập)  ~~ Train: "lương tháng 9 3000k"
```

---

## 2. Clean Holdout Construction

To guarantee 100% scientific independence, all 16 contaminated samples were removed from the staging set to form the pristine benchmark:
`ai_service/data/staging_realistic_clean_holdout.json`.

- **Original samples:** 250
- **Removed exact duplicates with train:** 4
- **Removed normalized template duplicates with train:** 12
- **Removed near-duplicates:** 0 (subsumed under normalized template deduplication)
- **Final clean samples:** **234**
- **Total contamination removed:** 16 (6.40%)
- **Data Integrity:** Neither model was retrained or tuned on the removed samples.

### Clean Holdout Class Balance (234 Samples)
- `di chuyển`: 20
- `giáo dục`: 25
- `giải trí`: 25
- `hóa đơn`: 25
- `khác`: 25
- `mua sắm`: 23
- `sức khỏe`: 24
- `thu nhập`: 24
- `ăn uống`: 21
- `đầu tư`: 22

---

## 3. V3 vs V4 Official Clean Evaluation

Both models were evaluated on the **exact same 234 clean holdout samples** with zero contamination:

| Evaluation Metric | Classify V3 Baseline | Classify V4 Candidate | Delta | Acceptance Gate Status |
|---|---:|---:|---:|:---:|
| **Accuracy** | **77.35%** (181/234) | **86.75%** (203/234) | **+9.40%** | **PASS** |
| **Macro Precision** | 0.8010 | **0.8719** | **+0.0710** | **PASS** |
| **Macro Recall** | 0.7808 | **0.8712** | **+0.0905** | **PASS** |
| **Macro F1-Score** | **0.7710** | **0.8656** | **+0.0946** | **PASS** |
| **High-Confidence ($\ge 0.60$) Accuracy** | 96.43% (108/112) | **100.00%** (119/119) | **+3.57%** | **PASS** |
| **High-Confidence ($\ge 0.60$) Coverage** | 47.86% (112/234) | **50.85%** (119/234) | **+2.99%** | - |
| **High-Confidence Wrong Count** | 4 | **0** | **-4** | **PASS** |
| **Medium-Confidence ($0.40 - 0.59$) Acc** | 81.82% (45/55) | **90.00%** (45/50) | **+8.18%** | - |
| **Medium-Confidence Coverage** | 23.50% (55/234) | 21.37% (50/234) | -2.14% | - |

### Per-Class F1 Score Comparison (Clean Holdout)

| Category | Support | V3 F1 | V4 F1 | Delta | Significance |
|---|---:|---:|---:|---:|---|
| `ăn uống` | 21 | 0.8400 | 0.8333 | -0.0067 | Stable (-0.6%) |
| `di chuyển` | 20 | 0.8837 | **0.9091** | +0.0254 | Improved (+2.5%) |
| `mua sắm` | 23 | 0.7692 | **0.8511** | +0.0818 | Major improvement (+8.2%) |
| `hóa đơn` | 25 | 0.6774 | **0.8571** | **+0.1797** | Major improvement (+18.0%) |
| `giải trí` | 25 | 0.9167 | **0.9259** | +0.0093 | Stable (+0.9%) |
| `sức khỏe` | 24 | 0.7727 | **0.9600** | **+0.1873** | Major improvement (+18.7%) |
| `giáo dục` | 25 | 0.7843 | **0.8750** | +0.0907 | Improved (+9.1%) |
| `đầu tư` | 22 | 0.8372 | **0.9268** | +0.0896 | Improved (+9.0%) |
| `thu nhập` | 24 | 0.7027 | **0.7619** | +0.0592 | Improved (+5.9%) |
| `khác` | 25 | 0.5263 | **0.7556** | **+0.2292** | Dramatic improvement (+22.9%) |

---

## 4. Paired Regression Analysis

Because both models were scored on the identical sequence of 234 clean transactions, we construct the paired $2 \times 2$ contingency table:

```
                      V4 Correct      V4 Wrong        Total
V3 Correct               175              6            181
V3 Wrong             28 (FIXES)          25             53
Total                    203             31            234
```

- **Net Accuracy Gain:** $+22$ samples ($+9.40\%$)
- **Fixes (V3 Wrong $\rightarrow$ V4 Correct):** **28 samples**
  - E.g.: `nạp tiền thẻ etc` (di chuyển), `tiền cọc giữ chỗ phòng` (khác), `dầu gió xanh` (sức khỏe), `long chau mua panadol` (sức khỏe), `mua dung lượng icloud 19k` (hóa đơn), `chuyen tien qua vi momo` (khác), `rut tien mat atm 2 trieu` (khác), `nhan tien hoan thue tncn` (thu nhập).
- **Regressions (V3 Correct $\rightarrow$ V4 Wrong):** **6 samples**

### Regression Detail & Severity Analysis

| Transaction Input | Ground Truth | V3 Prediction | V4 Prediction | V4 Confidence | Severity Assessment |
|---|---|---|---|---:|---|
| `KOI Thé 60k` | ăn uống | ăn uống | giải trí | 22.8% | **LOW RISK:** Confidence is well below low threshold (0.35/0.40). Product policy marks as uncertain. |
| `shoppe` | mua sắm | mua sắm | ăn uống | 37.3% | **LOW RISK:** Confidence is below suggestion threshold; no auto-selection. |
| `shopee` | mua sắm | mua sắm | ăn uống | 38.1% | **LOW RISK:** Passive suggestion only; user confirmation required. |
| `tiền trọ` | hóa đơn | hóa đơn | thu nhập | 49.4% | **MEDIUM RISK:** Semantic ambiguity (paying rent vs receiving rent). Suggestion level only. |
| `nạp tiền tài khoản vndirect` | đầu tư | đầu tư | giải trí | 19.2% | **LOW RISK:** Confidence < 0.20; product policy rejects auto-select. |
| `trúng thưởng mini game` | thu nhập | thu nhập | giải trí | 37.0% | **LOW RISK:** Passive suggestion only. |

> **Critical Safety Finding:** **0 out of 6 regressions were high-confidence ($\ge 0.60$)**. V4 has **zero high-confidence errors** across the entire clean holdout.

---

## 5. Shadow Runtime Architecture

The production runtime has been structured with strict physical decoupling:

```
                     +---------------------------------------+
                     |         Incoming User Request         |
                     |      POST /api/ai/classify            |
                     +---------------------------------------+
                                         |
                                         v
                     +---------------------------------------+
                     |         AI Classification Service     |
                     |            (FastAPI Backend)          |
                     +---------------------------------------+
                                         |
                     +-------------------+-------------------+
                     |                                       |
                     v (PRIMARY)                             v (SHADOW)
        +-------------------------+             +-------------------------+
        |     Model Classify V3   |             |     Model Classify V4   |
        |      (Production)       |             |    (Shadow Candidate)   |
        +-------------------------+             +-------------------------+
                     |                                       |
                     v                                       v
        +-------------------------+             +-------------------------+
        | User Output Guaranteed  |             | Telemetry & Audit Only  |
        | - Category              |             | - Agreement Rate        |
        | - Confidence            |             | - Confidence Delta      |
        | - Suggestion Level      |             | - Disagreement Matrix   |
        | - HTTP 200 Response     |             | - Latency Overhead      |
        +-------------------------+             +-------------------------+
                     |                                       |
                     v                                       v
             [ Return to User ]                     [ Ring Buffer Log ]
```

### Architectural Guardrails
1. **Output Invariance:** User response is $100\%$ derived from Model Classify V3.
2. **Zero Modification:** V4 cannot change category, alter confidence, trigger fallbacks, or modify UI state.
3. **Graceful Degrade:** If V4 crashes or is disabled, V3 executes with zero degradation.

---

## 6. Telemetry & Privacy Design

Every shadow transaction creates a structured audit record stored in an in-memory ring buffer (up to 2,000 records) and logged via structured JSON:

```json
{
  "request_id": "7f8b9e12-4c3a-4a2b-9e8f-123456789abc",
  "timestamp": "2026-09-27T16:43:35.120000+00:00",
  "v3_category": "di chuyển",
  "v3_confidence": 0.5150,
  "v4_category": "di chuyển",
  "v4_confidence": 0.4510,
  "agreement": true,
  "v3_high_confidence": false,
  "v4_high_confidence": false,
  "v4_shadow_status": "success",
  "v3_latency_ms": 0.22,
  "v4_latency_ms": 0.16
}
```

### Privacy & Confidentiality Compliance
- **Zero Raw Text Stored:** Telemetry never logs the user's transaction description.
- **Zero PII Stored:** No bank account numbers, card numbers, or personal identifiers.
- **Zero Secret Stored:** Authorization headers, Supabase session tokens, and API keys are strictly excluded.
- **Inspection API:** Metrics are queryable at `GET /telemetry/shadow` for live monitoring.

---

## 7. Runtime Failure Isolation

Failure isolation was verified through targeted test cases:

1. **V4 Inference Exception:**
   - Simulated internal tensor/NumPy runtime exception in V4 engine.
   - Result: V3 executed successfully, user received HTTP 200 with V3 category and metadata. Telemetry logged `"v4_shadow_status": "error: Simulated internal V4 tensor corruption"`.
2. **V4 Artifact Missing:**
   - Simulated missing `classifier_model.pkl` artifact (`classify_engine_v4 = None`).
   - Result: Service started normally; health status reported `"v4_loaded": false`. User requests succeeded with V3.
3. **V4 Timeout Isolation:**
   - V4 execution takes $\approx 0.16$ ms, bound within synchronous execution without thread starvation.

---

## 8. Performance Benchmark

Benchmarking was conducted on the live FastAPI service over 100 consecutive requests:

| Benchmark Dimension | V3 Only (Baseline) | V3 + V4 Shadow | Shadow Overhead |
|---|---:|---:|---:|
| **p50 Latency** | 2.05 ms | **2.22 ms** | **+0.17 ms** |
| **p95 Latency** | 3.42 ms | **3.59 ms** | **+0.17 ms** |
| **p99 Latency** | 4.65 ms | **4.88 ms** | **+0.23 ms** |
| **Model Pure Inference (V3)** | 0.22 ms | 0.23 ms | - |
| **Model Pure Inference (V4)** | - | 0.16 ms | 0.16 ms |
| **CPU Utilization** | $< 1.5\%$ | $< 1.8\%$ | Negligible |
| **RAM Utilization** | 185 MB | 194 MB | $+9$ MB (V4 Vocab & Weights) |

> **Conclusion:** Shadow mode overhead is less than **$0.25$ milliseconds**, which is completely imperceptible to end users.

---

## 9. Shadow Reference Test Cases

Evaluating the reference prompts and mined edge cases against the live REST endpoint:

| Input Text | V3 Prediction | V3 Conf | V4 Shadow Prediction | V4 Conf | Agreement | Fix / Improvement? |
|---|---|---:|---|---:|:---:|---|
| `ăn phở 50k` | ăn uống | 86.8% | ăn uống | 82.6% | **YES** | Parity |
| `đổ xăng 100 nghìn` | di chuyển | 51.5% | di chuyển | 45.1% | **YES** | Parity |
| `mua thuốc 85000` | sức khỏe | 79.9% | sức khỏe | 77.3% | **YES** | Parity |
| `nhận lương 12 triệu` | thu nhập | 68.8% | thu nhập | 70.1% | **YES** | Parity |
| `đóng tiền điện` | hóa đơn | 94.9% | hóa đơn | 91.4% | **YES** | Parity |
| `mua chuột máy tính` | mua sắm | 71.4% | mua sắm | 82.2% | **YES** | V4 higher confidence |
| `chuyển tiền nhà` | hóa đơn | 77.2% | hóa đơn | 67.6% | **YES** | Parity (Taxonomy overlap) |
| `cf 35k` | ăn uống | 69.2% | ăn uống | 73.1% | **YES** | Parity |
| `an sang 30k` | ăn uống | 64.3% | ăn uống | 75.9% | **YES** | Parity |
| `abcxyz` | khác | 10.0% | khác | 10.0% | **YES** | Parity (Uncertain policy) |
| `nạp tiền thẻ etc` | hóa đơn | 78.3% | **di chuyển** | 36.7% | **NO** | **V4 FIX:** hóa đơn $\rightarrow$ di chuyển |
| `qua trạm thu phí bot cao tốc` | di chuyển | 77.3% | di chuyển | 87.6% | **YES** | V4 higher confidence |
| `bố mẹ gửi tiền trợ cấp` | khác | 80.5% | **thu nhập** | 55.2% | **NO** | **V4 FIX:** khác $\rightarrow$ thu nhập |
| `tiền cọc giữ chỗ phòng` | hóa đơn | 71.4% | **khác** | 69.0% | **NO** | **V4 FIX:** hóa đơn $\rightarrow$ khác |
| `mua dung lượng icloud 50gb` | mua sắm | 33.5% | **hóa đơn** | 26.4% | **NO** | **V4 FIX:** mua sắm $\rightarrow$ hóa đơn |
| `xang xe di lam` | di chuyển | 75.7% | di chuyển | 80.4% | **YES** | Parity |

- **Live Prompt Agreement Rate:** **85.71%** (36/42 recorded events)
- **Live Prompt Disagreement Rate:** **14.29%** (6/42 recorded events)

---

## 10. Security & Privacy Audit

The shadow runtime was evaluated against data privacy standards:
1. **Header Inspection:** No Supabase JWT tokens or API secrets are forwarded to model inference or telemetry buffers.
2. **PII Sanitization:** The telemetry endpoint `GET /telemetry/shadow` exposes only statistical summaries (`agreement_rate`, `transitions`, `latencies`).
3. **Security Test Verification:** All 8 security assertions in `tests/ai-integration-v3.test.mjs` passed without regression.

---

## 11. Remaining Model Risks

1. **Warning V3 (P1):** False positive rate remains at $40\%$ on legitimate high-value transactions. Retains **EXPERIMENTAL / ADVISORY ONLY** status.
2. **Advisor (P1):** Single-month cashflow deficit bias persists when evaluating one-off health spikes. Retains **EXPERIMENTAL / ADVISORY ONLY** status.
3. **Taxonomy Divergence (P2):** The 10-class model merges rent into `hóa đơn`. Frontend UI mapping must maintain this semantic compatibility.

---

## 12. V4 Canary Acceptance Gate Status

| Acceptance Criterion | Target Requirement | Empirical Result | Gate Status |
|---|---|---|:---:|
| **Clean Holdout Accuracy** | V4 > V3 (77.35%) | **86.75%** (+9.40%) | **PASS** |
| **Clean Holdout Macro F1** | V4 > V3 (0.7710) | **0.8656** (+0.0946) | **PASS** |
| **Severe Regressions** | 0 high-confidence regressions | **0 high-confidence regressions** | **PASS** |
| **High-Confidence Errors** | V4 $\le$ V3 (4 errors) | **0 errors** (-4) | **PASS** |
| **Failure Isolation** | V4 error cannot impact V3 | Verified via mock exception tests | **PASS** |
| **Latency Overhead** | $< 2.0$ ms | **$0.17$ ms** | **PASS** |
| **Security & Privacy** | Zero secret / text leakage | Verified via string pattern scan | **PASS** |
| **Telemetry Operational** | Structured telemetry API | Active at `/telemetry/shadow` | **PASS** |
| **Regression Test Suite** | 100% pass on all suites | **109/109 Pytest + 20/20 Node PASSED** | **PASS** |
| **User Correction Telemetry** | 14-day production observation | Pending runtime accumulation | **IN PROGRESS** |

---

## 13. Recommendation

### Formal Status: `READY FOR CANARY (Pending 14-day Shadow Observation)`

1. **Keep V3 as Primary:** For the current phase, keep Model Classify V3 as the active primary model serving 100% of user traffic.
2. **Maintain V4 in Shadow Mode:** Allow Model Classify V4 to continue running in shadow mode (`AI_CLASSIFY_V4_SHADOW_ENABLED=true`) across real user sessions to accumulate production telemetry.
3. **Future Promotion Path:** When 14 days of shadow telemetry confirm an agreement rate $\ge 85\%$ and zero critical regressions against user-corrected transactions, initiate Phase 1 Canary ($5\%$ traffic to V4 for non-critical accounts).
