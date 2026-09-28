# AI V3 FROZEN BASELINE SPECIFICATION

**Document Version:** 1.0 (Frozen Baseline)  
**Date:** September 2026  
**Purpose:** Serves as the immutable evaluation benchmark that AI V4 and future models must rigorously outperform on identical, independent validation sets without data leakage.

---

## 1. Classify V3 (`model_classify_v3`)

### 1.1 Model Identity & Architecture
- **Model Type:** Scikit-Learn Pipeline (`TfidfVectorizer` + `RidgeClassifier`)
- **Parameters:** `ngram_range=(1, 2)`, `sublinear_tf=True`, `alpha=1.0`, `solver="auto"`
- **Artifact:** `model_classify_v3/models/classify_v3.joblib` (SHA-256 registered)
- **Classes (10):** `ăn uống`, `di chuyển`, `mua sắm`, `hóa đơn`, `giải trí`, `sức khỏe`, `giáo dục`, `đầu tư`, `thu nhập`, `khác`

### 1.2 Performance Metrics Across Evaluation Sets

| Metric | Clean Test Set (600 samples) | Hard Evaluation Set (300 samples) | Realistic Staging Set (`staging_realistic_test_set.json` - 250 samples) |
|---|---:|---:|---:|
| **Overall Accuracy** | **99.67%** (598/600) | **94.37%** (283/300) | **78.80%** (197/250) |
| **Macro Precision** | 0.9973 | 0.9472 | 0.8119 |
| **Macro Recall** | 0.9950 | 0.9410 | 0.7880 |
| **Macro F1-Score** | **0.9961** | **0.9438** | **0.7816** |
| Diacritics Accuracy | 100.0% | 96.1% | 82.4% |
| Non-Diacritics Accuracy | 93.91% | 88.5% | 71.2% |

### 1.3 Per-Class Performance Comparison

| Category | Clean Test F1 | Clean Support | Realistic Staging Precision | Realistic Staging Recall | Realistic Staging F1 | Realistic Staging Support |
|---|---:|---:|---:|---:|---:|---:|
| **ăn uống** | 1.0000 | 75 | 0.7576 | 1.0000 | **0.8621** | 25 |
| **di chuyển** | 1.0000 | 75 | 0.8571 | 0.9600 | **0.9057** | 25 |
| **mua sắm** | 1.0000 | 75 | 0.7097 | 0.8800 | **0.7857** | 25 |
| **hóa đơn** | 0.9934 | 75 | 0.5676 | 0.8400 | **0.6774** | 25 |
| **giải trí** | 0.9934 | 75 | 0.9565 | 0.8800 | **0.9167** | 25 |
| **sức khỏe** | 1.0000 | 63 | 0.8571 | 0.7200 | **0.7826** | 25 |
| **giáo dục** | 1.0000 | 56 | 0.7692 | 0.8000 | **0.7843** | 25 |
| **đầu tư** | 1.0000 | 40 | 0.8750 | 0.8400 | **0.8571** | 25 |
| **thu nhập** | 0.9859 | 36 | 1.0000 | 0.5600 | **0.7179** | 25 |
| **khác** | 0.9885 | 44 | 0.7692 | 0.4000 | **0.5263** | 25 |

### 1.4 High-Confidence Failure Profile (Staging)
- **High-confidence error count ($c \ge 0.50$):** 6 errors / 250 samples (2.4%)
- **Extreme-confidence error count ($c \ge 0.60$):** 4 errors / 250 samples (1.6%)
- **Weakest categories on realistic text:** `khác` (F1: 0.5263, recall: 40%), `hóa đơn` (precision: 56.76%), `thu nhập` (recall: 56%).

---

## 2. Prediction V3 (`model_prediction_v3`)

### 2.1 Model Identity & Architecture
- **Model Type:** Multi-component Ensemble (Time-decay Linear Trend + Day-of-Week EWMA Seasonality + Residual Moving Average)
- **Artifact:** `model_prediction_v3/models/prediction_v3.joblib`
- **Evaluation Cutoffs:** 11 sliding chronological cutoffs (2026-01-01 to 2026-06-30, zero lookahead)

### 2.2 Frozen Error Metrics Across Horizons

| Forecasting Horizon | Model MAE (VND) | Model RMSE (VND) | Model sMAPE (%) | Model WAPE (%) | Seasonal Naive-7 sMAPE | 7-day MA sMAPE | Naive Last sMAPE |
|---|---:|---:|---:|---:|---:|---:|---:|
| **7-Day Horizon** | 105,759.51 | 232,832.69 | **24.92%** | 28.66% | 35.88% | 41.25% | 39.08% |
| **14-Day Horizon** | 107,460.75 | 226,816.20 | **25.56%** | 29.76% | 39.13% | 41.48% | 40.89% |
| **30-Day Horizon** | 108,076.36 | 234,704.46 | **25.17%** | 29.54% | 37.92% | 40.54% | 40.06% |

---

## 3. Warning V3 (`model_warning_v3`)

### 3.1 Model Identity & Architecture
- **Model Type:** Calibrated Ensemble (`HistGradientBoostingClassifier` + `LogisticRegression` with isotonic calibration)
- **Artifact:** `model_warning_v3/models/warning_v3.joblib`
- **Dataset Source:** **100% Synthetic** generated via `generate_dataset.py` (3,000 samples test, 12,000 samples train)
- **Synthetic Separation Artifact:** Fraud samples were generated with amount-to-credit-limit ratio $\mu \approx 0.45$ vs normal transactions $\mu \approx 0.01$, and explicit dark web flags.

### 3.2 Frozen Metrics (Synthetic Test Set)

| Metric | Score | Note |
|---|---:|---|
| **Fraud Recall** | **1.0000** (231/231) | Synthetic test set only |
| **Fraud Precision** | **1.0000** (231/231) | Synthetic test set only |
| **F1-Score** | **1.0000** | Synthetic test set only |
| **PR-AUC / ROC-AUC** | **1.0000** / **1.0000** | Synthetic test set only |
| **Brier Score** | **0.0000** | Synthetic test set only |
| **Production Qualification** | **EXPERIMENTAL** | **NOT Production Ready** due to lack of non-synthetic challenge validation |

---

## 4. Advisor Model (`model_advisor`)

### 4.1 Model Identity & Architecture
- **Model Type:** Multi-Layer Perceptron (`SoftmaxMLPClassifier` with 64-32 hidden units) + Fallback Rule Engine
- **Artifact:** `model_advisor/models/advisor_mlp.joblib`
- **Dataset Source:** **100% Synthetic** (2,000 profiles generated via heuristic formula)

### 4.2 Frozen Metrics (Synthetic Test & OOD Suite)

| Metric | Score | Note |
|---|---:|---|
| **Synthetic Test Accuracy** | **1.0000** (300/300) | Homogeneous with training generator rules |
| **Synthetic Macro F1** | **1.0000** | Homogeneous with training generator rules |
| **Risk Score MAE** | **0.0654** | |
| **OOD Robustness Rate** | **100.0%** (120/120) | Zero crashes on edge cases |
| **Production Qualification** | **EXPERIMENTAL** | **NEEDS Human-Curated Challenge Validation** |

---

## 5. Minimum Acceptance Thresholds for V4 Candidate Promotion

To achieve promotion over V3, any V4 model candidate MUST satisfy:
1. **Classify V4:**
   - Realistic Staging Accuracy $> 78.80\%$
   - Realistic Staging Macro F1 $> 0.7816$
   - High-Confidence Error Count ($c \ge 0.50$) $< 6$
   - Zero test sample leakage
2. **Warning V4:**
   - Must achieve Precision $\ge 70\%$ and Recall $\ge 70\%$ on independent human-curated realistic challenge cases.
3. **Advisor V4:**
   - Must show nuanced, non-contradictory advice on paired edge financial profiles without uniform rule collapse.
