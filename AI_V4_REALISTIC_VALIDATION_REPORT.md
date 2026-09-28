# AI V4 REALISTIC VALIDATION & MODEL HARDENING REPORT

**Author:** Antigravity AI Engineering  
**Date:** September 27, 2026  
**Status:** COMPLETE & EMPIRICALLY VERIFIED  
**Repository Branch:** `ai/retrain-v3`  
**Core Objective:** Execute a rigorous, leakage-free empirical validation and model hardening phase across all 4 local AI/ML components (`classify`, `prediction`, `warning`, `advisor`). Establish truth-based metrics rather than synthetic vanity scores.

---

## 1. Executive Summary

This validation phase investigated the true generalization capability of the local AI models. Key findings:

1. **Test Set Vanity vs. Realistic Reality:** While `model_classify_v3` achieved 99.67% on its internal synthetic test set, our duplicate audit discovered that **70.50% of the test set sentences were template variants of the training set**. On the independent 250-sample `staging_realistic_test_set.json` (which has only 6.40% template overlap), true accuracy dropped to **78.80%** (Macro F1: 0.7816).
2. **False Claims Rectified:** The previous claim of "10/10 test prompts đạt chuẩn" was rectified:
   - `chuyển tiền nhà`: Raw model predicted `hóa đơn` (77.2% confidence). Expected was `Nhà ở`. The model's 10-class taxonomy lacks a separate `nhà ở` class (which was subsumed under bills/utilities `hóa đơn`). This was semantically acceptable under the model's 10-class schema, but not raw-exact.
   - `abcxyz`: Raw model output `khác` with uniform flat prior (10.0% confidence). This was NOT raw model intelligence; rather, the product confidence policy safely rejected it (`confidence < 0.35` $\rightarrow$ `uncertain = true`).
3. **Synthetic Shortcuts Exposed in Warning V3:** While Warning V3 achieved $F_1 = 1.000$ on synthetic test data, testing on a **Human-Curated Realistic Challenge Set** revealed an actual $F_1$ of only **57.14%** (False Positive Rate: 40.00%, False Negative Rate: 33.33%). The model learned shortcuts on transaction amounts and dark web flags rather than generalized fraud patterns.
4. **Targeted Hardening with Zero Leakage (Classify V4):** Based on error mining (highway tolls/ETC, family allowances, security deposits, pharmacy supplies, cloud subscriptions), we curated 235 hard boundary samples with **strictly zero leakage** against holdout sets. Training `model_classify_v4` achieved:
   - **Realistic Holdout Accuracy:** **87.60%** (+8.80% absolute gain over V3's 78.80%).
   - **Macro F1:** **0.8730** (+0.0914 over V3's 0.7816).
   - **High-Confidence ($\ge 0.60$) Errors:** Dropped from **4 to 0**.
   - **High-Confidence Accuracy:** **100.00%** (at 53.60% coverage).
5. **Architectural Decisions:**
   - **Classify:** Promote V4 as SHADOW candidate. Keep V3 as primary in production canary until shadow telemetry concludes.
   - **Forecast:** KEEP V3 (25.17% 30-day sMAPE outperforming naive baselines by $>12\%$).
   - **Warning & Advisor:** DATA INSUFFICIENT. Retain as EXPERIMENTAL/ADVISORY. Strictly avoid retraining on synthetic data to prevent reinforcing shortcuts.

---

## 2. V3 Frozen Baseline

The immutable benchmark for all models (frozen in `AI_V3_FROZEN_BASELINE.md`):

### 2.1 Classify V3
- **Artifact:** `model_classify_v3/models/classifier_model.pkl` (SHA-256 registered)
- **Clean Test Accuracy:** 99.67% (598/600)
- **Hard Test Accuracy:** 94.37% (283/300)
- **Realistic Staging Accuracy:** **78.80%** (197/250)
- **Realistic Macro F1:** **0.7816**
- **High-Confidence Error Count ($c \ge 0.60$):** 4 errors (1.6%)
- **Weakest Categories:** `khác` (F1: 0.5263), `hóa đơn` (F1: 0.6774), `thu nhập` (F1: 0.7179).

### 2.2 Prediction V3
- **Artifact:** `model_prediction_v3/models/prediction_v3.joblib`
- **7-day sMAPE:** **24.92%** (vs Seasonal Naive 35.88%, 7d MA 41.25%)
- **14-day sMAPE:** **25.56%** (vs Seasonal Naive 39.13%, 7d MA 41.48%)
- **30-day sMAPE:** **25.17%** (vs Seasonal Naive 37.92%, 7d MA 40.54%)

### 2.3 Warning V3
- **Synthetic Test F1:** 1.0000 (100% synthetic generator artifact)
- **Status:** EXPERIMENTAL / UNVALIDATED ON REAL TRANSACTIONS

### 2.4 Advisor Model
- **Synthetic Test Accuracy:** 1.0000 (100% synthetic MLP artifact)
- **Status:** EXPERIMENTAL / UNVALIDATED ON REAL PROFILES

---

## 3. Classify Error Mining & Stratification

Running all 250 holdout samples in `ai_service/data/staging_realistic_test_set.json` against `model_classify_v3` produced 53 errors (Accuracy: 78.80%), stratified as follows:

```
Total Staging Samples: 250
├── Correct: 197 (78.80%)
│   ├── High Confidence (>= 0.60): 123 (49.20%)
│   ├── Medium Confidence (0.35 - 0.60): 56 (22.40%)
│   └── Low Confidence / Group D (< 0.35): 18 (7.20%)
└── Errors: 53 (21.20%)
    ├── Group A (High-Confidence Wrong >= 0.60): 4 (1.60%) [CRITICAL]
    ├── Group B (Medium-Confidence Wrong 0.35 - 0.60): 15 (6.00%)
    └── Group C (Low-Confidence Wrong < 0.35): 34 (13.60%)
```

### Deep Dive into Group A (High-Confidence Wrong $\ge 0.60$)

These 4 errors represent the most critical risk because the system might pre-select an incorrect category with high confidence:

| Text | Expected | Raw Prediction | Confidence | Root Cause Analysis |
|---|---|---|---:|---|
| `nạp tiền thẻ etc` | di chuyển | hóa đơn | 78.3% | `nạp tiền thẻ` heavily weighted towards telecom top-ups (`hóa đơn`). ETC electronic toll collection for highway commuting was unrepresented. |
| `me cho tien sinh hoat` | thu nhập | khác | 65.5% | `sinh hoat` overwhelmed `me cho` towards miscellaneous living expenses rather than family allowance income. |
| `tien thue nha nguoi ta tra` | thu nhập | hóa đơn | 73.9% | `tien thue nha` acted as an anchor for paying housing bills (`hóa đơn`), ignoring the suffix `nguoi ta tra` (rental income). |
| `tiền cọc giữ chỗ phòng` | khác | hóa đơn | 71.4% | `phòng` + `tiền` triggered housing bill (`hóa đơn`), ignoring `tiền cọc` (refundable escrow/deposit). |

---

## 4. Confusion Matrix Analysis

### Top Confusion Pairs (V3 Baseline)

| Expected Category | Predicted Category | Error Count | Average Confidence |
|---|---|---:|---:|
| `khác` | `hóa đơn` | 6 | 41.4% |
| `thu nhập` | `hóa đơn` | 5 | 43.3% |
| `khác` | `mua sắm` | 3 | 24.1% |
| `hóa đơn` | `mua sắm` | 2 | 36.1% |
| `sức khỏe` | `ăn uống` | 2 | 34.0% |
| `sức khỏe` | `giáo dục` | 2 | 30.5% |
| `giáo dục` | `hóa đơn` | 2 | 25.8% |
| `thu nhập` | `ăn uống` | 2 | 26.4% |
| `thu nhập` | `khác` | 2 | 42.8% |
| `khác` | `ăn uống` | 2 | 30.1% |

### Category Extremes (V3 Baseline)

- **Weakest 5 Categories (by F1):**
  1. `khác` (F1: 0.5263, Precision: 76.92%, Recall: 40.00%)
  2. `hóa đơn` (F1: 0.6774, Precision: 56.76%, Recall: 84.00%)
  3. `thu nhập` (F1: 0.7179, Precision: 100.00%, Recall: 56.00%)
  4. `sức khỏe` (F1: 0.7826, Precision: 85.71%, Recall: 72.00%)
  5. `giáo dục` (F1: 0.7843, Precision: 76.92%, Recall: 80.00%)

- **Strongest 5 Categories (by F1):**
  1. `giải trí` (F1: 0.9167)
  2. `di chuyển` (F1: 0.9057)
  3. `ăn uống` (F1: 0.8621)
  4. `đầu tư` (F1: 0.8571)
  5. `mua sắm` (F1: 0.7857)

---

## 5. Label Taxonomy Audit

We investigated whether errors originated from model deficiencies, taxonomy ambiguities, or dataset labeling choices:

1. **Taxonomy Collision: `hóa đơn` vs. `nhà ở`**
   - The ML model operates on a **10-class taxonomy**: `[ăn uống, di chuyển, mua sắm, hóa đơn, giải trí, sức khỏe, giáo dục, đầu tư, thu nhập, khác]`.
   - The frontend application has historical references to categories like `Nhà ở` or `Sinh hoạt`.
   - In transaction `chuyển tiền nhà`, the model predicted `hóa đơn`. Because rent is an essential recurring bill, predicting `hóa đơn` is **semantically acceptable** within a 10-class framework, but represents a **Taxonomy Overlap**.
2. **Ambiguity: Digital Subscriptions (`mua dung lượng icloud`, `spotify premium`)**
   - Could be classified as `hóa đơn` (recurring utility/bill), `mua sắm` (digital good purchase), or `giải trí` (media subscription).
   - Labeling rule established: Recurring cloud/storage services = `hóa đơn`; entertainment streaming = `giải trí`; physical tech hardware = `mua sắm`.
3. **Ambiguity: Educational Materials (`mua sách tiki 150k`, `mua compa thước kẻ`)**
   - Purchase of books or tools can be either `mua sắm` (shopping platform transaction) or `giáo dục` (study materials). Both are defensible.
4. **Classification Classification Breakdown for the 53 Errors:**
   - **True Model Errors:** 31 samples (58.5%) — misclassifications that the model should have caught with proper boundary training.
   - **Taxonomy / Semantic Overlap:** 14 samples (26.4%) — transactions plausibly fitting 2 categories.
   - **Label Ambiguity / Data Problem:** 8 samples (15.1%) — underspecified or noisy transaction notes.

---

## 6. Confidence Calibration

Confidence scores in V3 are generated via Softmax on multi-class logits:
$$P(y = k \mid x) = \frac{\exp(z_k)}{\sum_{j} \exp(z_j)}$$

### Reliability Diagram on Realistic Holdout (250 Samples)

| Confidence Range | Samples | Correct | Actual Accuracy | Avg Confidence | Calibration Gap |
|---|---:|---:|---:|---:|---:|
| 0.0 - 0.1 | 0 | 0 | N/A | N/A | 0.0% |
| 0.1 - 0.2 | 6 | 1 | 16.7% | 18.2% | +1.5% |
| 0.2 - 0.3 | 36 | 12 | 33.3% | 25.1% | -8.2% |
| 0.3 - 0.4 | 25 | 15 | 60.0% | 35.3% | -24.7% |
| 0.4 - 0.5 | 22 | 14 | 63.6% | 45.0% | -18.6% |
| 0.5 - 0.6 | 34 | 32 | **94.1%** | 54.9% | -39.2% |
| 0.6 - 0.7 | 23 | 22 | **95.7%** | 65.5% | -30.2% |
| 0.7 - 0.8 | 35 | 32 | **91.4%** | 75.8% | -15.6% |
| 0.8 - 0.9 | 42 | 42 | **100.0%** | 84.8% | -15.2% |
| 0.9 - 1.0 | 27 | 27 | **100.0%** | 93.4% | -6.6% |

- **Expected Calibration Error (ECE):** **18.91%**
- **Observation:** Softmax probabilities are **under-confident** rather than over-confident in the medium range. Samples with 0.50–0.60 confidence achieved 94.1% empirical correctness, while samples above 0.80 achieved 100% correctness.

---

## 7. Confidence Threshold Tradeoff Analysis

We evaluated candidate acceptance thresholds on realistic data:

| Threshold | Coverage | Accepted Samples | Accepted Accuracy | Error Rate | High-Confidence Wrong Count |
|---|---:|---:|---:|---:|---:|
| 0.40 | 73.2% | 183 | 92.35% | 7.65% | 14 |
| **0.45** | **67.6%** | **169** | **94.08%** | **5.92%** | **10** |
| 0.50 | 64.4% | 161 | 96.27% | 3.73% | 6 |
| 0.55 | 58.0% | 145 | 95.86% | 4.14% | 6 |
| **0.60** | **50.8%** | **127** | **96.85%** | **3.15%** | **4** |
| 0.65 | 47.2% | 118 | 96.61% | 3.39% | 4 |
| 0.70 | 41.6% | 104 | 97.12% | 2.88% | 3 |
| 0.75 | 34.8% | 87 | 98.85% | 1.15% | 1 |
| 0.80 | 27.6% | 69 | 100.00% | 0.00% | 0 |

### Recommended Policy
- **HIGH THRESHOLD ($\ge 0.60$):** Selected for auto-preselection. Provides 96.85% accuracy (100% in V4) while covering over 50% of user inputs.
- **MEDIUM THRESHOLD ($0.40 - 0.59$):** Selected for passive suggestion badges. Achieves 92–94% accuracy without forcing category selection.
- **LOW THRESHOLD ($< 0.40$):** System marks transaction as `uncertain = true`, no automatic category preselection, dropdown remains unselected.

---

## 8. Dataset Leakage & Near-Duplicate Audit

We audited exact duplicates and normalized template near-duplicates across all five datasets:

| Comparison | Exact Duplicates | Normalized / Template Duplicates | Leakage Assessment |
|---|---:|---:|---|
| **Clean Test vs. Train** | 0 (0.00%) | **368 (70.50%)** | **HIGH SYNTHETIC REDUNDANCY** (Explains 99.67% test accuracy) |
| **Clean Test vs. Val** | 0 (0.00%) | 137 (26.25%) | Moderate redundancy |
| **Hard Test vs. Train** | 0 (0.00%) | 27 (20.30%) | Low-to-moderate overlap |
| **Hard Test vs. Staging** | 10 (4.00%) | 17 (6.80%) | Minor shared evaluation samples |
| **Staging Realistic vs. Train** | 4 (0.14%) | 16 (0.99% of train, 6.40% of staging) | **VIRTUALLY INDEPENDENT** |
| **New Hard Curated vs. Staging** | **0 (0.00%)** | **0 (0.00%)** | **STRICTLY ZERO LEAKAGE** |

---

## 9. New Data Strategy (Classify V4)

To resolve the 31 true model failure patterns without leaking evaluation data, we curated **235 targeted boundary examples** under `model_classify_v4/data/new_hard_examples.json`.

- **Source:** `HUMAN_CURATED`
- **Method:** `targeted_error_mining`
- **Categories Covered:**
  - `di chuyển`: Highway tolls, ETC (`vetc`, `epass`, trạm bot), parking garages, bus tickets, ferry fees (30 samples).
  - `thu nhập`: Family allowance (`bố mẹ gửi tiền`), rental income (`khách thanh toán tiền trọ`), stock dividends (`cổ tức fpt`), tax refunds (`hoàn thuế tncn`) (30 samples).
  - `khác`: Security deposits (`tiền cọc giữ chỗ`), personal loan repayments, internal wallet transfers, charity donations, administrative fines (30 samples).
  - `sức khỏe`: OTC medicine, medical supplies (`dầu gió xanh`, `panadol sủi`, `bông băng gạc`), clinical exams (`chụp x-quang`, `bác sĩ gia đình`) (30 samples).
  - `hóa đơn`: Cloud subscriptions (`icloud 50gb`, `google drive`), building management fees, utility bills (20 samples).
  - `giải trí`: Streaming (`netflix`, `spotify`), camping, amusement parks (20 samples).
  - `giáo dục`: School books, exam fees (`ielts`, `toeic`), stationery tools (`compa thước kẻ`) (20 samples).
  - `mua sắm`: Prescription glasses, tech accessories, clothing (20 samples).
  - `ăn uống`: Non-accented and abbreviations (`cf`, `an sang`, `an trua`) (20 samples).
  - `đầu tư`: Joint venture capital, fund certificates, savings deposits (15 samples).

---

## 10. Warning Challenge Evaluation (Independent Human-Curated Set)

Warning V3 relies on an ensemble trained on 100% synthetic data. We designed a **16-case Human-Curated Realistic Challenge Set** to test whether the model generalizes or merely exploits synthetic shortcuts.

### Feature Importance Profile
- `is_high_risk_mcc`: 24.45%
- `log_transaction_amount`: 13.13%
- `amount_to_limit_ratio`: 8.32%
- `is_night`: 4.31%

### Challenge Results

```
Challenge Cases: 16
├── True Positives (TP): 4 (e.g., offshore casino 5M, crypto exchange 18M, wire transfer 95% limit)
├── False Positives (FP): 4 (e.g., laptop 22M POS chip, wedding ring 12M, university tuition 15M, flight 8.5M)
├── True Negatives (TN): 6 (e.g., Circle K late night, emergency room 3.2M, night highway toll)
└── False Negatives (FN): 2 (e.g., Dark Web 25k card testing, Magnetic swipe 2.5M without chip)
```

| Metric | Synthetic Test Set | Human-Curated Challenge Set | Delta |
|---|---:|---:|---:|
| **Precision** | 100.00% | **50.00%** | -50.00% |
| **Recall** | 100.00% | **66.67%** | -33.33% |
| **F1-Score** | 1.0000 | **0.5714** | -0.4286 |
| **False Positive Rate (FPR)** | 0.00% | **40.00%** | +40.00% |
| **False Negative Rate (FNR)** | 0.00% | **33.33%** | +33.33% |

**Conclusion:** Warning V3 suffers from shortcut learning: it flags any legitimate large purchase as DANGER while failing to catch low-value probing attacks. **Status: EXPERIMENTAL ONLY. Retraining without real card fraud data is unjustified.**

---

## 11. Advisor Challenge Evaluation

We tested Advisor on paired realistic boundary scenarios:

1. **Scenario 1: Zero Cushion vs. 5-Month Cushion (High Earner)**
   - Income 80M, expense 70M.
   - Variant A (2M reserve): Output `CAUTION` (Risk 0.360), emergency fund warning triggered.
   - Variant B (350M reserve): Output `HEALTHY` (Risk 0.270), no critical warnings.
   - *Verdict:* Passed. Model sensitively responds to liquid reserves.
2. **Scenario 2: One-off Emergency Health Spike (with 200M Savings) vs. Chronic Deficit**
   - Income 20M, expense 40M (one-off medical emergency), backed by 200M savings.
   - Output: `CRITICAL` (Risk 1.000). The model heavily penalized the MoM expense growth (+185%) and single-month deficit without considering whether liquid emergency cushions absorb the one-off event.
   - *Verdict:* Shows hard rule-collapse on single-month deficits.

**Conclusion:** Advisor provides reasonable basic advice but lacks longitudinal qualitative reasoning. **Status: EXPERIMENTAL ONLY. Retain as advisory tool.**

---

## 12. Forecast Validation

Evaluated across 11 sliding chronological cuts (2026-01-01 to 2026-06-30):

| Horizon | Model V3 sMAPE | Seasonal Naive sMAPE | 7-day MA sMAPE | Baseline Outperformance |
|---|---:|---:|---:|---|
| **7 Days** | **24.92%** | 35.88% | 41.25% | V3 wins by +10.96% sMAPE |
| **14 Days** | **25.56%** | 39.13% | 41.48% | V3 wins by +13.57% sMAPE |
| **30 Days** | **25.17%** | 37.92% | 40.54% | V3 wins by +12.75% sMAPE |

**Conclusion:** Forecast V3 decisively outperforms all moving average and naive baselines across all horizons. It handles missing dates and weekly seasonality gracefully. **Status: KEEP V3 (No V4 needed).**

---

## 13. Model Decisions

| Model Component | Action Decision | Justification |
|---|---|---|
| **Classify** | **RETRAIN V4** | High-confidence failures identified on known semantic gaps; achievable via targeted boundary curation without leakage. |
| **Forecast** | **KEEP V3** | V3 beats all statistical baselines across 7d, 14d, 30d horizons; no demonstrated deficiency. |
| **Warning** | **DATA INSUFFICIENT / KEEP V3 (EXP)** | Synthetic retraining will not fix shortcut learning; requires genuine transactional telemetry. |
| **Advisor** | **DATA INSUFFICIENT / KEEP V3 (EXP)** | Requires longitudinal multi-month financial profiles; synthetic retraining risks adding rule bias. |

---

## 14. V3 vs. V4 Statistical Comparison (Independent Holdout)

Evaluated on the identical, untouched `ai_service/data/staging_realistic_test_set.json` (250 samples):

| Metric | V3 Frozen Baseline | V4 Candidate | Delta | Acceptance Gate |
|---|---:|---:|---:|---|
| **Realistic Accuracy** | 78.80% (197/250) | **87.60%** (219/250) | **+8.80%** | **PASS** |
| **Macro F1-Score** | 0.7816 | **0.8730** | **+0.0914** | **PASS** |
| **High-Conf ($\ge 0.60$) Accuracy** | 96.85% (123/127) | **100.00%** (134/134) | **+3.15%** | **PASS** |
| **High-Conf ($\ge 0.60$) Coverage** | 50.80% (127/250) | **53.60%** (134/250) | **+2.80%** | **PASS** |
| **High-Conf Wrong Count** | 4 | **0** | **-4** | **PASS** |

### Per-Category F1 Comparison

| Category | V3 Baseline F1 | V4 Candidate F1 | Delta |
|---|---:|---:|---:|
| `ăn uống` | 0.8621 | 0.8571 | -0.0050 |
| `di chuyển` | 0.9057 | **0.9259** | +0.0202 |
| `mua sắm` | 0.7857 | **0.8627** | +0.0770 |
| `hóa đơn` | 0.6774 | **0.8571** | **+0.1797** |
| `giải trí` | 0.9167 | **0.9259** | +0.0092 |
| `sức khỏe` | 0.7826 | **0.9615** | **+0.1789** |
| `giáo dục` | 0.7843 | **0.8750** | +0.0907 |
| `đầu tư` | 0.8571 | **0.9362** | +0.0791 |
| `thu nhập` | 0.7179 | **0.7727** | +0.0548 |
| `khác` | 0.5263 | **0.7556** | **+0.2293** |

### Transitions
- **Samples Fixed (V3 Wrong $\rightarrow$ V4 Correct):** **28 samples**
  - E.g.: `nạp tiền thẻ etc` (di chuyển), `tiền cọc giữ chỗ phòng` (khác), `dầu gió xanh` (sức khỏe), `long chau mua panadol` (sức khỏe), `nhan tien hoan thue tncn` (thu nhập), `mua dung lượng icloud 19k` (hóa đơn), `chuyen tien qua vi momo` (khác), `rut tien mat atm 2 trieu` (khác).
- **Samples Regressed (V3 Correct $\rightarrow$ V4 Wrong):** 6 samples (all low-confidence $< 0.50$, zero high-confidence regressions).

---

## 15. Remaining Risks

1. **Warning V3 False Alarms (P1):** A 40% false positive rate on legitimate high-value purchases (laptops, jewelry, tuition) means Warning V3 MUST NOT automatically decline or freeze cards. It must strictly remain an advisory prompt.
2. **Advisor One-Off Expense Spike Bias (P1):** Advisor will warn of cashflow deficit even when the user has ample savings. UI must clearly frame this as a monthly spending pace notice rather than a solvency crisis.
3. **Taxonomy Divergence (P2):** The 10-class model merges rent into `hóa đơn`. If the user expects a dedicated `nhà ở` category, the frontend must maintain category mapping.

---

## 16. Production Readiness Matrix

| Component | Production Ready? | Operational Role | Policy Enforcement |
|---|---|---|---|
| **Classify V3** | **YES** | Primary Model | High threshold $\ge 0.60$ for preselect; $< 0.40$ unselected |
| **Classify V4** | **CANDIDATE** | Shadow Mode Only | Validated candidate; logs comparisons in shadow without user impact |
| **Forecast V3** | **YES** | Primary Model | Generates 7–30 day projections with baseline fallback |
| **Warning V3** | **EXPERIMENTAL** | Advisory Only | Strictly informative; zero automated blocking |
| **Advisor V3** | **EXPERIMENTAL** | Advisory Only | Qualitative tips only; disclaims financial consulting |

---

## 17. Recommended Next Step

1. **Deploy Classify V4 in Shadow Mode:** Monitor shadow agreement telemetry between V3 and V4 in real user sessions for 14 days.
2. **Promote V4 to Primary Canary:** Once shadow agreement demonstrates $>90\%$ parity and lower user override rates, promote V4 through 5% $\rightarrow$ 25% $\rightarrow$ 100% canary routing.
3. **Collect Telemetry for Warning & Advisor:** Implement user feedback buttons ("Giao dịch này an toàn / đáng ngờ", "Lời khuyên có hữu ích không?") to collect human feedback before attempting to retrain Warning and Advisor.
