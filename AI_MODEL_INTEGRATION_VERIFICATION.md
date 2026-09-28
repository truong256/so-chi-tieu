# AI MODEL INTEGRATION & OBSERVABILITY VERIFICATION REPORT

**Phase:** Safe Integration & End-to-End Observability of Local AI V3 Models  
**Date:** September 2026  
**Status:** COMPLETED — LOCAL AI V3 INTEGRATED & VERIFIED (NON-PRODUCTION / EXPERIMENTAL STAGING)

---

## 1. Architecture Before

Previously, the AI system suffered from broken integration links and silent fallbacks:

```text
User Input ("ăn phở 50k")
   ↓
Dashboard.tsx (handleAITextParse)
   ↓
fetch("/api/ai/parse-transaction")  ──►  404 NOT FOUND (Route did not exist)
   ↓
catch (err)  ──►  SILENT FALLBACK
   ↓
parseSmartTransaction() (Regex / Keyword heuristic in smart-parser.ts)
   ↓
Transaction Draft filled silently (User has no indication whether AI or regex was used)
```

**Key Architectural Deficiencies Prior to This Phase:**
1. **P0 Missing Route:** `/api/ai/parse-transaction` was never implemented in the Next.js API layer.
2. **Invisible Models:** V3 models (`classify_v3`, `risk_v3`, `forecast_v3`, `model_advisor`) existed as trained artifacts in FastAPI `ai_service` on port 8000, but were severed from real user interaction.
3. **Uncalibrated Confidence:** No confidence gating policy; low-confidence guesses could mislead users.
4. **False Perfection Illusion:** `model_warning_v3` reported $F1 = 1.0000$ due to non-overlapping synthetic feature separation, but lacked real-world robustness.
5. **Silent Heuristics:** Errors or offline states degraded silently into heuristic rules without recording or displaying the prediction source.
6. **Integrity Flaw:** Dynamic evaluation metrics files (`evaluation_report.json`) in `model_advisor` caused SHA-256 checksum mismatches upon every benchmark.

---

## 2. Architecture After

All local AI V3 models are now fully wired, observable, and hardened against silent failures:

```text
User Input (Natural language text / amount)
   ↓
Frontend Components:
├── Dashboard Quick AI Entry (handleAITextParse)
├── Inline Category Suggestion (<AiClassifyHint>)
├── Transaction Form / List Risk Badge (<AiRiskBadge>)
└── Overview Financial Advisory & Forecasting (<AiAdvisorPanel>)
   ↓
Next.js Authenticated API Routes (Bearer JWT Verified):
├── POST /api/ai/parse-transaction
├── POST /api/ai/classify
├── POST /api/ai/risk
├── POST /api/ai/forecast
├── POST /api/ai/advisor
└── GET  /api/ai/health
   ↓
Local AI Client (backend/src/services/ai-local.client.ts):
├── Explicit Version Routing (preferredVersion: "v3")
├── Fallback Mechanism (V3 ──► V2 ──► Heuristic)
├── Circuit Breaker Protection (5 failures ──► OPEN ──► Cooldown 10s)
└── Detailed Health Check (SERVICE_UP vs MODEL_READY vs MODEL_LOAD_FAILED)
   ↓
FastAPI Microservice (ai_service on 127.0.0.1:8000):
├── Classify V3 (TF-IDF + Ridge Classifier, latency ~0.45ms)
├── Risk V3 (XGBoost / LightGBM, latency ~2.6ms)
├── Forecast V3 (Linear Regression + EWMA, latency ~0.8ms)
└── Advisor V3 (MLP Softmax + Deterministic Rules, latency ~1.1ms)
   ↓
Structured Response with Source & Confidence Metadata:
{
  "source": "local_model_v3",
  "confidence": 0.868,
  "fallback": false,
  "category": "ăn uống",
  "data": { ... }
}
   ↓
Frontend UI with Calibrated Confidence & Explicit Source Feedback
```

---

## 3. Files Changed

| File Path | Description of Changes |
|---|---|
| `app/api/ai/parse-transaction/route.ts` | **Created P0 endpoint:** Supabase Bearer auth, database category/wallet mapping, `aiClassify` client call, explicit source metadata, zero PII logging. |
| `app/api/ai/health/route.ts` | **Created detailed health route:** Distinguishes `SERVICE_UP`/`SERVICE_DOWN` and `MODEL_READY`/`MODEL_LOAD_FAILED`/`MODEL_MISSING`. |
| `backend/src/services/ai-local.client.ts` | Added `preferredVersion` support in `ClientOptions`, implemented `aiDetailedHealthCheck()`, hardened circuit breaker. |
| `frontend/services/ai.service.ts` | Added `aiParseTransaction()` and `aiGetHealth()` client functions. |
| `app/api/ai/classify/route.ts` | Added `preferredVersion: "v3"` to ensure local V3 model is invoked. |
| `app/api/ai/risk/route.ts` | Added `preferredVersion: "v3"` to target Risk V3 model. |
| `app/api/ai/forecast/route.ts` | Added `preferredVersion: "v3"` to target Forecast V3 model. |
| `app/api/ai/advisor/route.ts` | Added `preferredVersion: "v3"` and transparent rule fallback with source tracking. |
| `frontend/components/ai-risk-badge.tsx` | Hardened wording to **EXPERIMENTAL SIGNAL** ("Dấu hiệu bất thường"), added real-time amount refetching. |
| `frontend/components/dashboard.tsx` | Synced `sessionToken`, updated `handleAITextParse` with source badge feedback & confidence policy, mounted `AiClassifyHint`, `AiRiskBadge`, and `AiAdvisorPanel`. |
| `package.json` | Added dev script `"dev:ai": "python -m uvicorn ai_service.app:app --host 127.0.0.1 --port 8000"`. |
| `ai_service/model_checksums.json` | Removed non-deterministic runtime evaluation reports; verified all 105 static model artifacts. |
| `tests/ai-parse-transaction.test.mjs` | Added end-to-end integration tests for route, health, client, and fallback security. |

---

## 4. Runtime Routing

Runtime routing follows a strict priority chain:

1. **Primary Route:** Next.js API requests `preferredVersion: "v3"` from `ai-local.client.ts`.
2. **FastAPI Inference:** FastAPI loads `classify_v3.joblib` and returns prediction with latency $< 1\text{ms}$.
3. **Soft Degradation (V3 Failure):** If V3 returns 500 or times out, client immediately retries `classify_v2.joblib` and tags `source = "local_model_v2"`, `fallback = true`.
4. **Hard Degradation (AI Service Offline):** If FastAPI is unreachable or circuit breaker is OPEN, client falls back to `parseSmartTransaction()` with `source = "heuristic"`, `fallback = true`.

```text
HTTP POST /api/ai/parse-transaction
 │
 ├── AI Service Online & V3 Ready?
 │     ├── YES ──► Execute Classify V3 ──► source: "local_model_v3", fallback: false
 │     └── FAIL ──► Try Classify V2 ───► source: "local_model_v2", fallback: true
 │
 └── AI Service Offline / Timeout?
       └── Heuristic SmartParser ──────► source: "heuristic", fallback: true
```

---

## 5. Model Source Tracking & Observability

Every prediction returned to the frontend and logged to telemetry carries deterministic source tags:
- `local_model_v3`: Output generated directly by Local AI V3 models in FastAPI.
- `local_model_v2`: Output generated by Local AI V2 fallback models.
- `heuristic`: Output produced by client/server regex rules (`smart-parser.ts`).

### Safe Logging Implementation
Logs strictly record operational metadata without leaking auth tokens, passwords, or PII:
```text
[AI_CLASSIFY] source=local_model_v3 confidence=0.8684 fallback=false endpoint=/api/ai/parse-transaction
[AI_CLASSIFY] source=heuristic fallback=true reason=ai_service_offline endpoint=/api/ai/parse-transaction
```

### User Interface Observability
In `dashboard.tsx`, feedback messages explicitly display the engine to the user:
- `[Local AI V3 (87%)] Đã nhận diện "Ăn uống" (50.000 ₫). Hãy kiểm tra trước khi lưu.`
- `[Local AI V2 Dự phòng (91%)] Đã nhận diện...`
- `[Fallback Ngoại tuyến] Đã nhận diện bằng quy tắc cục bộ.`

---

## 6. Classification Confidence Policy

Classify V3 metrics on diverse datasets:
- Standard In-Domain Test: **99.67%**
- Hard Test Set: **94.38%**
- Realistic Staging Test (`staging_realistic_test_set.json`): **78.80%**

Because real-world user text exhibits lower accuracy than clean synthetic training data, an empirical 3-tier confidence policy was derived from the confidence distribution:

| Confidence Range | Staging Coverage | Accuracy Above Threshold | Policy & Action |
|---|---|---|---|
| **HIGH** ($\ge 0.60$) | 50.8% | **96.85%** | **Preselect Suggestion:** Automatically preselects category in form. High accuracy ensures low risk of user friction. |
| **MEDIUM** ($0.35 \le c < 0.60$) | 28.4% | **90.40%** (above 0.35) | **Suggestion Only:** Preselects with visual warning chip `(60% tin cậy — hãy kiểm tra)`. User must review. |
| **LOW** ($< 0.35$) | 20.8% | **34.62%** | **No Auto-Select:** Does NOT auto-select category. Displays warning alert: `Độ tin cậy thấp (25%) — vui lòng tự chọn danh mục`. |

```text
Threshold:               0.60 (High) / 0.35 (Medium / Low)
Coverage (High):         50.8%
Accuracy above 0.60:     96.85%
Coverage (High+Med):     79.2%
Accuracy above 0.35:     90.40%
Rejected/Uncertain rate: 20.8% (accuracy in this rejected bucket is only 34.62%)
```

---

## 7. UI Integration

### 1. `AiClassifyHint` Mounted
- **Location:** Inside transaction creation & editing modal, immediately below the Title input field.
- **Behavior:** Debounced at 700ms. Displays inline chip with category suggestion and confidence percentage.
- **User Control:** The user must explicitly click `"Áp dụng"` to apply the suggestion. It never silently overrides existing choices.

### 2. `AiRiskBadge` Mounted
- **Location 1:** Inside transaction creation & editing modal, directly under the Amount input field.
- **Location 2:** In `TransactionTable` rows for significant expense items ($\ge 2,000,000\text{ VND}$).
- **Safety Hardening:** Displays non-alarmist wording:
  - `SAFE`: "Bình thường" (Green)
  - `WARNING`: "Cần lưu ý" (Yellow)
  - `DANGER`: "Dấu hiệu bất thường" (Red — **NOT** "gian lận")
  - Tooltip: `"Tín hiệu phân tích thử nghiệm từ Warning Model V3. Không mang tính khẳng định vi phạm."`

### 3. `AiAdvisorPanel` Mounted
- **Location:** In Dashboard `overview` view, immediately between `financialInsights` and `summary-grid`.
- **Content:** Financial health grade, risk score, tailored recommendations, anomaly notices, and `ForecastMiniChart` (powered by Forecast V3).
- **Graceful Fallback:** Displays `source: "model_advisor"` when online; transparently switches to deterministic heuristic financial rules if AI service is offline.

---

## 8. Fallback Verification

| Case | Scenario | Observed Behavior | Verified Source |
|---|---|---|---|
| **Case A** | AI Service **ONLINE** (Port 8000 up, models ready) | Input parsed via FastAPI V3 model | `source=local_model_v3`, `fallback=false` |
| **Case B** | AI Service **OFFLINE** (Port 8000 terminated) | Application handles network error gracefully without crashing; offline parser activates | `source=heuristic`, `fallback=true` |
| **Case C** | V3 Model Unavailable / Fallback Request | Client catches V3 degradation and routes to V2 model | `source=local_model_v2`, `fallback=true` |

---

## 9. End-to-End Verification (10 Mandatory Test Prompts)

All 10 prompts were executed live against the integrated pipeline (`preferredVersion: "v3"`):

| Input | Prediction | Confidence | Source | Fallback | Expected |
|---|---|---:|---|---|---|
| `ăn phở 50k` | ăn uống | 86.8% | local_model_v3 | false | Ăn uống |
| `đổ xăng 100 nghìn` | di chuyển | 51.5% | local_model_v3 | false | Di chuyển |
| `mua thuốc 85000` | sức khỏe | 79.9% | local_model_v3 | false | Sức khỏe |
| `nhận lương 12 triệu` | thu nhập | 68.8% | local_model_v3 | false | Thu nhập / Lương |
| `đóng tiền điện` | hóa đơn | 94.9% | local_model_v3 | false | Hóa đơn / Sinh hoạt / Nhà ở |
| `mua chuột máy tính` | mua sắm | 71.4% | local_model_v3 | false | Mua sắm |
| `chuyển tiền nhà` | hóa đơn | 77.2% | local_model_v3 | false | Nhà ở |
| `cf 35k` | ăn uống | 69.2% | local_model_v3 | false | Ăn uống |
| `an sang 30k` | ăn uống | 64.3% | local_model_v3 | false | Ăn uống |
| `abcxyz` | khác | 10.0% | local_model_v3 | false | Uncertain / Low confidence |

**Observation:**
- All 10 inputs were processed by `local_model_v3` with zero fallbacks.
- Gibberish input `abcxyz` produced `10.0%` confidence ($< 0.35$), triggering low-confidence warnings in the UI rather than false classification.

---

## 10. Realistic Classification Test Results (`staging_realistic_test_set.json`)

Evaluated against 250 realistic, hand-crafted Vietnamese expense descriptions (zero training data overlap):

```text
Total Samples: 250
Accuracy:      78.80% (197 / 250)
Macro P:       0.8119
Macro R:       0.7880
Macro F1:      0.7816
```

### Per-Class Performance
| Category | Precision | Recall | F1-Score | Support |
|---|---:|---:|---:|---:|
| di chuyển | 0.8571 | 0.9600 | 0.9057 | 25 |
| giáo dục | 0.7692 | 0.8000 | 0.7843 | 25 |
| giải trí | 0.9565 | 0.8800 | 0.9167 | 25 |
| hóa đơn | 0.5676 | 0.8400 | 0.6774 | 25 |
| khác | 0.7692 | 0.4000 | 0.5263 | 25 |
| mua sắm | 0.7097 | 0.8800 | 0.7857 | 25 |
| sức khỏe | 0.8571 | 0.7200 | 0.7826 | 25 |
| thu nhập | 1.0000 | 0.5600 | 0.7179 | 25 |
| ăn uống | 0.7576 | 1.0000 | 0.8621 | 25 |
| đầu tư | 0.8750 | 0.8400 | 0.8571 | 25 |

### Confusion Matrix
```text
             di chu giáo d giải t hóa đơ   khác mua sắ sức kh thu nh ăn uốn đầu tư
di chuyển        24      0      0      1      0      0      0      0      0      0
giáo dục          1     20      0      2      0      1      1      0      0      0
giải trí          0      0     22      1      0      1      0      0      1      0
hóa đơn           0      0      1     21      0      2      0      0      0      1
khác              1      2      0      6     10      3      0      0      2      1
mua sắm           0      1      0      0      1     22      1      0      0      0
sức khỏe          1      2      0      1      0      1     18      0      2      0
thu nhập          1      0      0      5      2      0      0     14      2      1
ăn uống           0      0      0      0      0      0      0      0     25      0
đầu tư            0      1      0      0      0      1      1      0      1     21
```

### High-Confidence Wrong Predictions (Danger Cases, $c \ge 0.50$)
Identified 6 edge cases where the model had high confidence but guessed incorrectly:
1. `"nạp tiền thẻ etc"` $\rightarrow$ Pred: `hóa đơn` (78.3%) | Expected: `di chuyển`
2. `"tien thue nha nguoi ta tra"` $\rightarrow$ Pred: `hóa đơn` (73.9%) | Expected: `thu nhập`
3. `"tiền cọc giữ chỗ phòng"` $\rightarrow$ Pred: `hóa đơn` (71.4%) | Expected: `khác`
4. `"me cho tien sinh hoat"` $\rightarrow$ Pred: `khác` (65.5%) | Expected: `thu nhập`
5. `"mua sách tiki 150k"` $\rightarrow$ Pred: `giáo dục` (59.6%) | Expected: `mua sắm`
6. `"dầu gió xanh"` $\rightarrow$ Pred: `di chuyển` (55.7%) | Expected: `sức khỏe`

*Recommendation for next training phase: Expand training vocabulary for informal Vietnamese money transfers, toll tags (ETC), and multi-domain items.*

---

## 11. Test Suite Results

All test suites passed 100% without modification of test assertions:

1. **Python Regression & Staging Suite (`pytest`):**
   ```text
   python -m pytest ai_service/tests model_advisor/tests -v
   ======================= 99 passed in 1.61s ========================
   ```
2. **Canary & Routing Tests (`node`):**
   ```text
   node --experimental-strip-types tests/ai-canary-routing.test.mjs
   ℹ pass 7, fail 0
   ```
3. **V3 Integration Tests (`node`):**
   ```text
   node --experimental-strip-types tests/ai-integration-v3.test.mjs
   ℹ pass 8, fail 0
   ```
4. **Parse Transaction & Health Tests (`node`):**
   ```text
   node --experimental-strip-types tests/ai-parse-transaction.test.mjs
   ℹ pass 5, fail 0
   ```
5. **Deterministic Checksum Verification:**
   ```text
   python -c "verify_checksums"
   TOTAL: 105, VERIFIED: 105, MISSING: 0, MISMATCH: 0
   CHECKSUM VALIDATION: ALL PASS
   ```

---

## 12. Remaining Risks

1. **Synthetic Data Artifact in Risk V3:** Risk V3 achieved $F1 = 1.0000$ solely due to synthetic data separation (credit limit ratio threshold). In wild transactions, fraud patterns are significantly subtler.
2. **Advisor Model Homogeneity:** Advisor model rules and dataset were authored by the same heuristic schema. True user utility must be evaluated with human qualitative feedback.
3. **Single FastAPI Process:** FastAPI runs locally on port 8000. Under production container workloads, it should be fronted by an ASGI supervisor (gunicorn/uvicorn workers) with process monitoring.

---

## 13. Production Blockers

Before declaring full production readiness:
- [ ] **Realistic Fraud Dataset:** Must collect anonymized anomalous transactions to evaluate Risk V3 without synthetic leakage.
- [ ] **Real User Feedback Loop:** Log user accepted vs. overridden categories into product telemetry to build an active learning set.
- [ ] **Docker Compose / Supervisor Orchestration:** Auto-start AI service alongside Next.js in production deployment.

---

## 14. Next Recommended Phase

1. **Phase: Active Learning & Telemetry Ingestion**
   - Accumulate anonymized user category corrections via `recordClassificationProductEvent`.
   - Re-train Classify V3 on the 6 identified high-confidence edge cases (`"nạp tiền thẻ etc"`, `"me cho tien sinh hoat"`).
2. **Phase: Risk Model Real-World Hardening**
   - Inject realistic noise and overlapping credit distributions into `model_warning_v3` training pipeline.
