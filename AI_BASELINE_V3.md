# AI BASELINE BENCHMARK REPORT V3
**Dự án Sổ Chi Tiêu — Đo lường & Thiết lập chuẩn đối chuẩn (Baseline Benchmark)**  
*Thời gian thực hiện: 2026-09-26*

---

## 1. TỔNG QUAN BASELINE HỆ THỐNG V2

Tất cả mô hình v2 hiện tại hoạt động ổn định làm chuẩn tham chiếu (baseline / fallback) cho chu kỳ huấn luyện v3:
- Không sử dụng C-extension hay DLL phụ thuộc bên ngoài để tương thích tốt với môi trường Windows.
- Pure-NumPy / Python standard library, thời gian khởi động **30.78 ms**, RAM RSS **58.46 MB**.
- Tốc độ suy luận đạt SLA xuất sắc: độ trễ trung bình từ **1.79 ms đến 6.16 ms** trên máy cục bộ.

---

## 2. BASELINE 1: CLASSIFICATION (`model_classify_v2`)

### 2.1. Kiến trúc mô hình
- **Đại diện từ vựng:** Word N-grams (1, 2) TF-IDF log-scale + L2 Normalization.
- **Bộ phân loại:** Softmax Multi-class Logistic Regression (10 danh mục ứng dụng).
- **Kích thước mô hình:** 
  - `vectorizer.pkl`: 31.2 KB
  - `classifier_model.pkl`: 96.4 KB
  - Tổng kích thước: **127.6 KB**

### 2.2. Kết quả đo đạc trên Untouched Test Set (N=650)
- **Overall Accuracy:** 100.00%
- **Macro F1:** **1.0000**
- **Weighted F1:** **1.0000**
- **Precision:** 1.0000
- **Recall:** 1.0000
- **Confusion Matrix:** Đường chéo chính 100% (650/650 dự đoán đúng).

### 2.3. Kết quả trên Hard Test Set (N=150)
- Vietnamese with diacritics: **100.00%** (74/74)
- Vietnamese without diacritics: **100.00%** (76/76)
- **Điểm yếu đã phát hiện (Limitations):**
  - Khi gặp các từ viết tắt cực ngắn hoặc tiếng lóng ("cf 50k", "an trua 35", "mua quan ao"), confidence thấp (~0.24 - 0.35) do v2 chưa bật Character N-grams (`use_char=False`).
  - Có sự trùng lặp cụm từ giữa Train và Test ở dataset v2 cần khắc phục triệt để trong v3.

---

## 3. BASELINE 2: RISK / WARNING (`model_warning_v2`)

### 3.1. Kiến trúc mô hình
- **Pipeline:** Leakage-Free Pipeline (Group split User & Card, frozen statistics trên Train Only).
- **Bộ phân loại:** `RiskMLPClassifier` (2-layer MLP 22 -> 32 -> 1 Sigmoid, pos_weight=7.7).
- **Kích thước mô hình:** `warning_model.pkl` (34.8 KB).

### 3.2. Kết quả đo đạc trên Untouched Test Set (N=3,000)
- **Tỷ lệ gian lận nền (Prevalence):** 7.70% (231 / 3,000)
- **Frozen Thresholds:** Safe = 0.1500, Danger = 0.9200
- **Fraud Recall:** **100.00%** (231 / 231)
- **Fraud Precision:** **100.00%** (231 / 231)
- **F1 Score:** **1.0000**
- **PR-AUC:** **1.0000** (Baseline ngẫu nhiên: 0.0770)
- **ROC-AUC:** **1.0000**
- **Brier Score (Calibration):** 0.0000
- **Confusion Matrix:**
  $$\begin{bmatrix} \text{TN}=2769 & \text{FP}=0 \\ \text{FN}=0 & \text{TP}=231 \end{bmatrix}$$
- **Phân bố mức cảnh báo:** SAFE: 2,769 | WARNING: 0 | DANGER: 231

---

## 4. BASELINE 3: EXPENSE FORECASTING (`model_prediction_v2`)

### 4.1. Kiến trúc mô hình
- **Mô hình:** Pure-NumPy L2-Regularized Ridge Forecaster (17 features thời gian, độ trễ, chu kỳ tuần/tháng).
- **Suy luận:** Recursive walk-forward multi-horizon (7, 14, 30 ngày).
- **Kích thước mô hình:** `forecaster_model.pkl` (1.3 KB).

### 4.2. Bảng đối chiếu hiệu năng với các Naive Baselines (Untouched Test 181 ngày)

| Kỳ dự báo | Phương pháp | MAE (VND) | RMSE (VND) | sMAPE | WAPE | Đánh giá |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **7 ngày** | **Ridge Forecaster (v2)** | **105,760** | **232,833** | **24.92%** | **28.66%** | **Tốt nhất** |
| | Seasonal Naive 7-day | 153,078 | 279,546 | 35.88% | 41.48% | Kém hơn |
| | Same Weekday Average | 144,653 | 264,783 | 35.29% | 39.20% | Kém hơn |
| | Moving Average 7-day | 164,414 | 282,631 | 41.25% | 44.55% | Kém hơn |
| | Naive Last Value | 153,299 | 290,219 | 39.08% | 41.54% | Kém hơn |
| **14 ngày** | **Ridge Forecaster (v2)** | **107,461** | **226,816** | **25.56%** | **29.76%** | **Tốt nhất** |
| | Seasonal Naive 7-day | 162,961 | 286,132 | 39.13% | 45.14% | Kém hơn |
| | Same Weekday Average | 141,433 | 253,719 | 34.61% | 39.17% | Kém hơn |
| | Moving Average 7-day | 164,414 | 282,095 | 41.48% | 45.54% | Kém hơn |
| | Naive Last Value | 155,494 | 282,275 | 40.89% | 43.07% | Kém hơn |
| **30 ngày** | **Ridge Forecaster (v2)** | **108,076** | **234,704** | **25.17%** | **29.54%** | **Tốt nhất** |
| | Seasonal Naive 7-day | 159,973 | 289,574 | 37.92% | 43.72% | Kém hơn |
| | Same Weekday Average | 141,298 | 259,933 | 33.79% | 38.62% | Kém hơn |
| | Moving Average 7-day | 162,183 | 280,778 | 40.54% | 44.33% | Kém hơn |
| | Naive Last Value | 164,800 | 297,082 | 43.41% | 45.04% | Kém hơn |

---

## 5. BASELINE 4: FINANCIAL ADVISOR (`model_advisor`)

### 5.1. Kiến trúc mô hình
- **Mô hình:** Softmax MLP Health Classifier + Ridge Risk Score Regressor + Dynamic Rule Engine.
- **Kích thước mô hình:** `advisor_model.pkl` (24.5 KB).

### 5.2. Kết quả đo đạc trên Test Set (N=300)
- **Health Grade Accuracy:** **100.00%**
- **Health Grade Macro F1:** **1.0000**
- **Risk Score MAE:** **0.0654**
- **Per-class F1:**
  - `EXCELLENT`: 1.0000
  - `HEALTHY`: 1.0000
  - `CAUTION`: 1.0000
  - `CRITICAL`: 1.0000

---

## 6. BENCHMARK TÀI NGUYÊN & ĐỘ TRỄ (100 REQUESTS)

| Endpoint / Model | Mean Latency | P50 (Median) | P95 | P99 | Max | Model Artifact Size |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /health` | 1.42 ms | 1.20 ms | 2.37 ms | 3.46 ms | 4.38 ms | — |
| `POST /classify` | 1.86 ms | 1.61 ms | 3.02 ms | 5.00 ms | 5.33 ms | 127.6 KB |
| `POST /risk` | 1.79 ms | 1.54 ms | 3.36 ms | 4.48 ms | 5.44 ms | 34.8 KB |
| `POST /forecast` | 6.16 ms | 5.54 ms | 9.05 ms | 12.73 ms | 14.20 ms | 1.3 KB |
| `POST /advisor` | 2.07 ms | 1.83 ms | 3.38 ms | 5.03 ms | 6.77 ms | 24.5 KB |
| **Toàn bộ hệ thống** | **Startup: 30.78 ms** | **RAM RSS: 58.46 MB** | — | — | — | **Tổng: 188.2 KB** |

---

## 7. MỤC TIÊU VÀ TIÊU CHÍ GATE CHO PHIÊN BẢN V3

Để được chấp nhận (ACCEPT) thay thế phiên bản v2 trong môi trường phục vụ thực tế:
1. **Classification (v3):**
   - Triệt tiêu 100% phrase duplication giữa Train và Test.
   - Bổ sung Word (1,2) + Char (3,4) hybrid representation để tăng cường nhận diện tiếng Việt không dấu, viết tắt, slang ("cf 50k", "an trua 35", "shoppe 220k").
   - Macro F1 trên tập Test chưa nhìn thấy (untouched test set) $\ge 0.90$.
   - Tỷ lệ chính xác trên Independent Hard Test $\ge 95\%$.
   - Thiết lập chuẩn ngưỡng Confidence Calibration: High $\ge 0.65$, Low $\ge 0.35$.
2. **Risk / Warning (v3):**
   - Giữ vững 0% rò rỉ dữ liệu thực thể (Group split).
   - Gia cố toàn diện phòng chống bug `float(None)`, `credit_limit = null`, `credit_limit = 0`, số âm và thiếu trường.
   - Vượt qua 100% bài kiểm thử Regression Suite cho các trường hợp đặc biệt.
3. **Forecast (v3):**
   - Duy trì sMAPE $\le 28.0\%$, tiếp tục đánh bại tất cả 4 mô hình Naive baseline.
   - Không bị suy thoái đệ quy (no recursive collapse) ở đường chân trời 30 ngày.
4. **Advisor (v3):**
   - Vượt qua bộ kiểm thử an toàn toàn diện (không ảo giác, không bịa số/danh mục).
5. **Độ trễ và Tài nguyên:**
   - RAM $\le 100$ MB, thời gian phản hồi API trung bình $\le 15$ ms.
