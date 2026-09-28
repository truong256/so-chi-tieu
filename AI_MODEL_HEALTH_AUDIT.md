# AI MODEL HEALTH AUDIT — TOÀN DIỆN VÀ ĐỘC LẬP
**Dự án:** Sổ Chi Tiêu (`so-chi-tieu`)  
**Thời gian kiểm định:** 27/09/2026  
**Môi trường kiểm tra:** Windows x64, Python 3.11.9, Node v24.19.0, Vite 8.2.2  
**Branch hiện tại:** `ai/retrain-v3` (commit cơ sở `ce7ca58`)  
**Phương pháp kiểm thử:** Phân tích mã nguồn tĩnh, deserialization artifact thực tế, chạy evaluation gate trên tập dữ liệu chưa qua chỉnh sửa, benchmark độ trễ trực tiếp và kiểm tra luồng runtime toàn diện từ Frontend -> API -> Service -> Model.

---

## 1. EXECUTIVE SUMMARY

Hệ thống AI/ML của dự án **Sổ Chi Tiêu** là một cấu trúc đa tầng kết hợp giữa **mô hình Machine Learning cục bộ (Local ML)** và **AI đám mây bên ngoài (External LLM API)**:

1. **Tổng số mô hình phát hiện:** 12 mô hình/phiên bản (gồm 3 phiên bản V1 kế thừa/teammate, 3 phiên bản V2 baseline, 3 phiên bản V3 retrained, 1 mô hình Advisor độc lập, 2 luồng tích hợp Google Gemini API).
2. **Các mô hình đang THỰC SỰ phục vụ người dùng cuối trên giao diện:**
   - **Financial Copilot (Chatbot):** Gọi trực tiếp Google Gemini API qua `/api/chat` (kèm bộ lọc Regex tiền xử lý từ chối các câu hỏi ngoài lề tài chính).
   - **Receipt Scanner (Quét hóa đơn):** Gọi Google Gemini Vision API qua `/api/receipt/parse`.
   - **Nhập nhanh bằng AI ("Nhập nhanh bằng AI" trên Dashboard):** Hiện **HOÀN TOÀN CHẠY BẰNG BỘ QUY TẮC HEURISTIC/REGEX (`smart-parser.ts`)** do endpoint phía Next.js `/api/ai/parse-transaction` **chưa tồn tại (HTTP 404)**.
3. **Thực trạng 4 mô hình Machine Learning nội bộ (V3 / V2):**
   - Đã được huấn luyện hoàn chỉnh, artifact tồn tại đầy đủ, 100% deserialize và load thành công trong bộ nhớ với tốc độ cực nhanh (~233 ms cho toàn bộ 7 mô hình V3+V2, tiêu tốn chỉ ~44 MB RAM).
   - Đã xây dựng dịch vụ FastAPI (`ai_service/`), client TypeScript (`backend/src/services/ai-local.client.ts`), các route proxy Next.js (`app/api/ai/*`), và các UI component (`ai-classify-hint.tsx`, `ai-risk-badge.tsx`, `ai-advisor-panel.tsx`).
   - **ĐIỂM NGHẼN THEN CHỐT:** Các UI component trên **CHƯA ĐƯỢC MOUNT / NHÚNG VÀO BẤT KỲ MÀN HÌNH NÀO CỦA FRONTEND** (`dashboard.tsx` hay các form giao dịch). Ứng dụng hiện tại chưa hiển thị các gợi ý từ 4 mô hình này đến người dùng.
4. **Chất lượng Dataset & Hiện tượng Metric 1.0000:**
   - Phiên bản V2 cũ bị rò rỉ dữ liệu nghiêm trọng (**222 mẫu trùng lặp giữa Train và Test** ở mô hình phân loại). V3 đã khắc phục triệt để (0 mẫu trùng lặp).
   - Hiện tượng **Metric = 1.0000** ở `model_warning_v3` (Precision=100%, Recall=100%) và `model_advisor` (Accuracy=100%) là do **bản chất của dữ liệu tổng hợp (synthetic dataset)**: hàm sinh dữ liệu tạo ra khoảng cách quá lớn giữa các nhóm nhãn (tỷ lệ chi tiêu/hạn mức giữa gian lận và thông thường cách nhau hàng chục lần; nhãn Advisor sinh bằng quy tắc cứng rồi train mạng nơ-ron học lại quy tắc đó). Do đó, chỉ số 100% này không phản ánh độ chính xác trên dữ liệu ngân hàng thực tế ngoài đời.
   - Khi kiểm thử trên tập dữ liệu tiếng Việt đời sống độc lập (250 mẫu thực tế), mô hình phân loại V3 đạt độ chính xác thực tế **78.80%** (197/250 mẫu), vượt trội hơn V2 (76.40%).

---

## 2. CURRENT ARCHITECTURE

```
                             [ TRÌNH DUYỆT (FRONTEND) ]
                                          |
          +-------------------------------+-------------------------------+
          |                               |                               |
    [Floating Chat]               [Receipt Scanner]            [Quick Entry Bar]
    (ai-floating-chat)         (receipt-scanner-modal)          (dashboard.tsx)
          |                               |                               |
          v                               v                               v
    POST /api/chat             POST /api/receipt/parse      POST /api/ai/parse-transaction
          |                               |                               |
          v                               v                               v
   [ai-chat.service]          [receipt-parser.service]              [ HTTP 404 ]
          |                               |                               |
    (Regex Filter)                        |                     [ HEURISTIC FALLBACK ]
          |                               |                     smart-parser.ts (Regex)
          +---------------+---------------+                               |
                          |                                               v
                          v                                    [ Cập nhật Form ]
                 [ GOOGLE GEMINI API ]
                 (External Cloud LLM)

===================================================================================
[ KIẾN TRÚC MÔ HÌNH NỘI BỘ V3 - TỒN TẠI NHƯNG CHƯA NỐI VÀO VIEW FRONTEND ]

    [ UI Components - CHƯA NHÚNG VÀO TRANG ]
    - AiClassifyHint (ai-classify-hint.tsx)
    - AiRiskBadge (ai-risk-badge.tsx)
    - AiAdvisorPanel (ai-advisor-panel.tsx)
                          |
                          v
                 [ Next.js API Routes ]
    POST /api/ai/classify | forecast | risk | advisor
                          |
                          v
               [ ai-local.client.ts ]
    - User Canary Routing (SHA-256 Sticky Bucket: 5% V3 / 95% V2)
    - Circuit Breaker (5 failures -> 10s cooldown)
    - V3 -> V2 Fail-safe Fallback
                          |
                          v (HTTP Port 8000)
             [ FastAPI Service (ai_service) ]
             - Classify V3 (Hybrid n-gram LR) / Fallback V2
             - Forecast V3 (Walk-forward Ridge) / Fallback V2
             - Risk V3 (Group-Split RiskMLP) / Fallback V2
             - Advisor V3 (Softmax MLP + Ridge + Calibrated Advice)
```

---

## 3. MODEL INVENTORY

| Model | Nhiệm vụ | Framework / Thuật toán | Artifacts | Có artifact? | Được app sử dụng? | Trạng thái kỹ thuật |
|---|---|---|---|---|---|---|
| **Classify V1** *(Legacy)* | Phân loại danh mục | Scikit-learn (LogisticRegression + TF-IDF) | `model_classify/classifier_model.pkl`<br>`model_classify/vectorizer.pkl` | CÓ (47 KB / 24 KB) | KHÔNG | DEPRECATED (Warning phiên bản scikit-learn 1.7.2) |
| **Prediction V1** *(Legacy)* | Dự báo chi tiêu | XGBoost (`XGBRegressor`) | `model_prediction/forecaster_model.pkl` | CÓ (491 KB) | KHÔNG | LOAD FAIL (Thiếu thư viện `xgboost`) |
| **Warning V1** *(Legacy)* | Phát hiện rủi ro / gian lận | XGBoost (`XGBClassifier`) | `model_warning/warning_model.pkl` | CÓ (1.27 MB) | KHÔNG | LOAD FAIL (Thiếu thư viện `xgboost`) |
| **Classify V2** *(Baseline)* | Phân loại danh mục | NumPy/Python (Word TF-IDF + LogisticRegression) | `model_classify_v2/models/classifier_model.pkl`<br>`vectorizer.pkl` | CÓ (97 KB / 49 KB) | DỰ PHÒNG | TRAINED / FALLBACK (Có 222 mẫu rò rỉ dữ liệu) |
| **Prediction V2** *(Baseline)* | Dự báo chi tiêu | NumPy/Python (Ridge L2 Regressor) | `model_prediction_v2/models/forecaster_model.pkl` | CÓ (931 B) | DỰ PHÒNG | TRAINED / FALLBACK |
| **Warning V2** *(Baseline)* | Phát hiện rủi ro / gian lận | NumPy/Python (RiskMLPClassifier) | `model_warning_v2/models/warning_model.pkl` | CÓ (31 KB) | DỰ PHÒNG | TRAINED / FALLBACK |
| **Classify V3** *(Primary)* | Phân loại danh mục tiếng Việt | Pure NumPy (Softmax LR + Word(1,2)/Char(3,4) TF-IDF) | `model_classify_v3/models/classifier_model.pkl`<br>`vectorizer.pkl` | CÓ (372 KB / 163 KB) | CHƯA MOUNT UI | TRAINED BUT NOT CONNECTED TO VIEW |
| **Prediction V3** *(Primary)* | Dự báo chi tiêu đa chu kỳ (7, 14, 30 ngày) | Pure NumPy (Walk-forward Recursive Ridge) | `model_prediction_v3/models/forecaster_model.pkl` | CÓ (931 B) | CHƯA MOUNT UI | TRAINED BUT NOT CONNECTED TO VIEW |
| **Warning V3** *(Primary)* | Cảnh báo gian lận & bất thường giao dịch | Pure NumPy (Group-Split RiskMLP + Hardened Pipeline) | `model_warning_v3/models/warning_model.pkl` | CÓ (31 KB) | CHƯA MOUNT UI | TRAINED BUT NOT CONNECTED TO VIEW |
| **Advisor V3** *(Primary)* | Cố vấn tài chính cá nhân toàn diện | Pure NumPy (Softmax MLP + Ridge Regressor + Logic tổng hợp) | `model_advisor/models/advisor_model.pkl` | CÓ (7.4 KB) | CHƯA MOUNT UI | TRAINED BUT NOT CONNECTED TO VIEW |
| **Gemini Chat** | Trợ lý hội thoại tài chính (Copilot) | Google Gemini API (REST) | N/A (Đám mây) | CÓ (API) | **CÓ** | EXTERNAL AI PROVIDER ACTIVE |
| **Gemini Vision** | Quét OCR & bóc tách hóa đơn | Google Gemini Vision API (REST) | N/A (Đám mây) | CÓ (API) | **CÓ** | EXTERNAL AI PROVIDER ACTIVE |
| **Smart Parser** | Phân tích nhanh giao dịch từ text | Heuristic Regex & Từ điển từ khóa | `frontend/utils/smart-parser.ts` | CÓ (Code) | **CÓ** | HEURISTIC FALLBACK ACTIVE |

---

## 4. RUNTIME MODEL PATH

### Luồng 1: Trợ lý Chat (Financial Copilot)
```text
Frontend: [frontend/features/ai/ai-floating-chat.tsx]
   ↓
API: POST /api/chat [app/api/chat/route.ts] (Auth guard: verifySupabaseAccessToken)
   ↓
Service: processChat [backend/src/services/ai-chat.service.ts]
   ↓
Tiền xử lý Heuristic: Kiểm tra Regex OFF_TOPIC_PATTERNS
   ↓ (Nếu câu hỏi tài chính)
Model: Google Gemini 2.5-flash / 1.5-flash
   ↓
Response: Trả lời Markdown có cấu trúc
```

### Luồng 2: Quét Hóa Đơn (Receipt Scanner)
```text
Frontend: [frontend/components/receipt-scanner-modal.tsx]
   ↓
API: POST /api/receipt/parse [app/api/receipt/parse/route.ts] (Giới hạn ảnh <= 10MB)
   ↓
Service: parseReceiptWithAI [backend/src/services/receipt-parser.service.ts]
   ↓
Model: Google Gemini Vision
   ↓
Response: JSON gồm số tiền, ngày, danh mục, ví gợi ý
```

### Luồng 3: Nhập Nhanh Giao Dịch Bằng Ngôn Ngữ Tự Nhiên
```text
Frontend: [frontend/components/dashboard.tsx] (Ô nhập "NHẬP NHANH BẰNG AI")
   ↓
API: POST /api/ai/parse-transaction  ===> [LỖI HTTP 404 NOT FOUND]
   ↓
Fallback Handler: catch block tại dashboard.tsx (dòng 655)
   ↓
Service Heuristic: parseSmartTransaction [frontend/utils/smart-parser.ts]
   ↓
Heuristic Rules: EXPENSE_RULES (Từ điển ẩm thực, xăng xe, mua sắm, điện nước...)
   ↓
Kết quả: Tự động điền Form giao dịch
```
> [!WARNING]
> Mặc dù giao diện hiển thị nhãn **"GEMINI AI - Nhập nhanh bằng AI"**, trên thực tế người dùng đang nhận kết quả từ **bộ từ điển Heuristic tĩnh** trong `smart-parser.ts` do endpoint backend chưa được cài đặt.

### Luồng 4: Bộ Tứ Mô Hình ML Nội Bộ (V3)
```text
Frontend: Các component [AiClassifyHint, AiRiskBadge, AiAdvisorPanel] chưa được import vào page.
   ↓
API: POST /api/ai/classify, /forecast, /risk, /advisor [Đã hiện thực hoàn chỉnh]
   ↓
Client Service: backend/src/services/ai-local.client.ts (Canary Hash & Circuit Breaker)
   ↓ (HTTP :8000)
AI Service: ai_service/app.py (FastAPI)
   ↓
Model Container: ai_service/loaders/model_loader.py (Scoped namespace isolation)
   ↓
Artifact: model_classify_v3, model_warning_v3, model_prediction_v3, model_advisor
   ↓
Prediction: Độ trễ warm 0.03 - 0.42 ms
   ↓
Fallback: Tự động fallback sang V2 nếu V3 lỗi, hoặc trả về FailSafeResponse nếu cả hai lỗi
```
> **Trạng thái:** `TRAINED BUT NOT CONNECTED TO FRONTEND VIEW`

---

## 5. DATASET AUDIT

### Bảng Kiểm Tra Các Tập Dữ Liệu

| Dataset | Đường dẫn | Số mẫu | Đặc trưng / Cấu trúc | Số lớp / Nhãn | Train / Val / Test | Đánh giá chất lượng & Rò rỉ |
|---|---|---|---|---|---|---|
| **Classify V3** | `model_classify_v3/data/` | 4,217 | Text giao dịch tiếng Việt | 10 danh mục | Train: 2,837<br>Val: 606<br>Test: 614<br>Hard: 160 | **XUẤT SẮC**. 0 mẫu trùng lặp giữa Train và Test. 85.7% có dấu tiếng Việt chuẩn Unicode NFD/NFC. |
| **Classify V2** | `model_classify_v2/data/` | 4,650 | Text giao dịch tiếng Việt | 10 danh mục | Train: 3,200<br>Val: 650<br>Test: 650 | **CÓ RÒ RỈ DỮ LIỆU**. Phát hiện **222 mẫu trùng lặp nguyên vẹn giữa Train và Test**. |
| **Prediction V3** | `model_prediction_v3/data/` | 1,277 ngày | Chuỗi thời gian chi tiêu (`date`, `amount`, `day_of_week`, ...) | Liên tục | Train: 912 (2023-2025)<br>Val: 184 (2025H2)<br>Test: 181 (2026H1) | **XUẤT SẮC**. Phân chia theo dòng thời gian nghiêm ngặt (Temporal split), không rò rỉ tương lai về quá khứ. |
| **Warning V3** | `model_warning_v3/data/` | 18,000 | Giao dịch thẻ (`amount`, `credit_limit`, `mcc`, `dark_web`, ...) | Nhị phân (Gian lận / An toàn) | Train: 12,000<br>Val: 3,000<br>Test: 3,000 | **PHÂN NHÓM CHUẨN**. 0 người dùng trùng lặp giữa Train và Test (GroupKFold by `client_id`). Tuy nhiên dữ liệu tạo bằng quy tắc tổng hợp quá phân tách. |
| **Advisor** | `model_advisor/data/` | 2,000 | Hồ sơ tài chính (`income`, `expense`, `wallets`, `categories`, ...) | 4 cấp sức khỏe (CRITICAL, CAUTION, HEALTHY, EXCELLENT) | Train: 1,400<br>Val: 300<br>Test: 300 | **DỮ LIỆU TỔNG HỢP THEO QUY TẮC**. Nhãn được gán bằng công thức toán học nội bộ, mô hình học lại chính xác quy tắc này. |
| **Staging Realistic** | `ai_service/data/staging_realistic_test_set.json` | 250 | Mẫu tiếng Việt thực tế đời sống (viết tắt, tiếng lóng, sai chính tả, không dấu) | 10 danh mục | Test độc lập (Out-of-Distribution) | **CHẤT LƯỢNG CAO**. Phản ánh hành vi thực tế của người dùng Việt Nam (Grab, CF, momo, tiền phòng...). |

### Phân Bổ Danh Mục Của Tập Classify V3
- `ăn uống`: 350 train / 75 test (Cân bằng)
- `di chuyển`: 350 train / 75 test (Cân bằng)
- `mua sắm`: 350 train / 75 test (Cân bằng)
- `hóa đơn`: 350 train / 75 test (Cân bằng)
- `giải trí`: 350 train / 75 test (Cân bằng)
- `sức khỏe`: 296 train / 63 test
- `giáo dục`: 265 train / 56 test
- `khác`: 208 train / 44 test
- `đầu tư`: 190 train / 40 test
- `thu nhập`: 178 train / 36 test

---

## 6. TRAINING PIPELINE

### Phân Tích Kỹ Thuật Từng Pipeline Huấn Luyện

#### 1. Model Classify V3 (`model_classify_v3/scripts/train.py`)
- **Điểm vào (Entrypoint):** `python model_classify_v3/scripts/train.py`
- **Thuật toán:** Softmax Multi-Class Logistic Regression thuần NumPy với điều chuẩn L2 và bộ tối ưu hóa Adam.
- **Trích xuất đặc trưng:** Hybrid n-grams: Word n-grams (1, 2) + Character n-grams (3, 4) kết hợp trọng số TF-IDF.
- **Tập từ vựng (Vocabulary):** 5,000 đặc trưng chọn lọc có tần suất xuất hiện tối thiểu.
- **Tính tái lập (Reproducibility):** Cố định seed, hội tụ ổn định sau 150 epochs. Vectorizer và ngưỡng phân loại được lưu đồng bộ trong thư mục `models/`.

#### 2. Model Prediction V3 (`model_prediction_v3/scripts/train.py`)
- **Điểm vào (Entrypoint):** `python model_prediction_v3/scripts/train.py`
- **Thuật toán:** Closed-Form L2-Regularized Ridge Regression thuần NumPy.
- **Dự báo đệ quy (Recursive Walk-Forward):** Sử dụng các lag 1..7, trung bình động 7/14/30 ngày, chỉ số ngày trong tuần và cờ cuối tuần để dự báo đệ quy từng ngày cho đến 30 ngày.
- **Phân tách dữ liệu:** Temporal chronological split (Train kết thúc 30/06/2025, Val kết thúc 31/12/2025, Test bắt đầu 01/01/2026).

#### 3. Model Warning V3 (`model_warning_v3/scripts/train.py`)
- **Điểm vào (Entrypoint):** `python model_warning_v3/scripts/train.py`
- **Thuật toán:** Multi-Layer Perceptron (RiskMLPClassifier) thuần NumPy (In: 18 -> Hidden: 32 -> Out: 1) với hàm kích hoạt ReLU và bộ tối ưu Adam.
- **Phân tách chống rò rỉ:** `GroupKFold` theo `client_id` (350 khách hàng cho train, 75 khách hàng riêng biệt cho val, 75 khách hàng riêng biệt cho test).
- **Bộ tiền xử lý:** `LeakageFreePipelineV3` chỉ fit trên tập Train (trung bình thẻ, trung bình người dùng được đóng băng từ Train).

#### 4. Model Advisor (`model_advisor/scripts/train.py`)
- **Điểm vào (Entrypoint):** `python model_advisor/scripts/train.py`
- **Thuật toán:** Ensemble kết hợp:
  - `SoftmaxMLPClassifier`: Phân loại 4 nhóm sức khỏe tài chính.
  - `RidgeRegressor`: Hồi quy điểm rủi ro liên tục $[0.0, 1.0]$.
  - `_synthesize_advice`: Động cơ sinh văn bản tiếng Việt theo ngữ cảnh thu chi, quỹ dự phòng và mục tiêu tiết kiệm.
- **Tính tái lập:** Cố định `np.random.seed(42)`.

---

## 7. EVALUATION RESULTS

Tất cả các số liệu dưới đây được **tính toán trực tiếp từ quá trình chạy kiểm thử độc lập trên test set untouched**, không sao chép lại báo cáo cũ:

### 1. Phân Loại Giao Dịch — `model_classify_v3`
- **Độ chính xác tổng thể (Accuracy):** **99.67%** (612/614 mẫu)
- **Macro Precision:** 0.9974
- **Macro Recall:** 0.9950
- **Macro F1:** **0.9961**
- **Weighted F1:** 0.9967
- **Chi tiết từng lớp (Per-class F1):**
  - `ăn uống`: F1 = 1.0000 (P=1.0, R=1.0, n=75)
  - `di chuyển`: F1 = 1.0000 (P=1.0, R=1.0, n=75)
  - `mua sắm`: F1 = 1.0000 (P=1.0, R=1.0, n=75)
  - `hóa đơn`: F1 = 0.9934 (P=0.9868, R=1.0, n=75)
  - `giải trí`: F1 = 0.9934 (P=0.9868, R=1.0, n=75)
  - `sức khỏe`: F1 = 1.0000 (P=1.0, R=1.0, n=63)
  - `giáo dục`: F1 = 1.0000 (P=1.0, R=1.0, n=56)
  - `đầu tư`: F1 = 1.0000 (P=1.0, R=1.0, n=40)
  - `thu nhập`: F1 = 0.9859 (P=1.0, R=0.9722, n=36)
  - `khác`: F1 = 0.9885 (P=1.0, R=0.9773, n=44)
- **Đánh giá trên Hard Test (N=160):** **94.38%** (151/160 đúng). Có dấu đạt 100%, không dấu đạt 93.91%.
- **Đánh giá trên Staging Realistic Test (N=250):** **78.80%** (197/250 đúng).

### 2. Dự Báo Chi Tiêu — `model_prediction_v3`
*Đánh giá kiểm thử Walk-forward đệ quy trên 181 ngày độc lập (01/01/2026 - 30/06/2026):*

| Chu kỳ dự báo (Horizon) | Mô hình V3 (Ridge) sMAPE | Baseline (Seasonal Naive) sMAPE | V3 MAE (VND) | V3 RMSE (VND) | Baseline MAE (VND) | Đánh giá |
|---|---:|---:|---:|---:|---:|---|
| **7 ngày** | **24.92%** | 35.88% | 105,760 | 232,833 | 153,078 | Vượt trội baseline (-30.5% lỗi) |
| **14 ngày** | **25.56%** | 39.13% | 107,461 | 226,816 | 162,961 | Ổn định, không suy thoái |
| **30 ngày** | **25.17%** | 37.92% | 108,076 | 234,704 | 159,973 | Không có hiện tượng sụp đổ đệ quy |

### 3. Cảnh Báo Rủi Ro & Gian Lận — `model_warning_v3`
- **Số mẫu Test:** 3,000 mẫu (75 khách hàng mới chưa từng xuất hiện trong Train)
- **Tỷ lệ gian lận trong tập Test:** 7.70% (231 mẫu)
- **Fraud Recall:** 100.00% (231/231)
- **Fraud Precision:** 100.00% (231/231)
- **F1 Score:** 1.0000
- **PR-AUC:** 1.0000 (Đường cơ sở 0.0770)
- **ROC-AUC:** 1.0000
- **False Positive Rate:** 0.00%
- **Brier Score:** 0.0000
*(Xem phân tích chuyên sâu tại Mục 16 để hiểu lý do chỉ số đạt tuyệt đối).*

### 4. Cố Vấn Tài Chính — `model_advisor`
- **Độ chính xác xếp hạng sức khỏe (Health Grade Accuracy):** 100.00%
- **Macro F1:** 1.0000
- **Risk Score MAE:** 0.0654
- **Thử nghiệm Out-of-Distribution Stress (120 ca dị biệt):** Tỷ lệ không sụp đổ (Zero-crash rate) đạt 100%.

---

## 8. SANITY TESTS

Kiểm tra trực tiếp các input đời sống điển hình qua engine `model_classify_v3`:

| Input thực tế | Kết quả dự đoán | Độ tin cậy (Confidence) | Mức độ tin cậy | Kỳ vọng nghiệp vụ | Hợp lý? |
|---|---|---:|---|---|:---:|
| `ăn phở 50k` | ăn uống | 0.8684 | HIGH_CONFIDENCE | ăn uống | **YES** |
| `đổ xăng 100000` | di chuyển | 0.4516 | HIGH_CONFIDENCE | di chuyển | **YES** |
| `mua thuốc 85000` | sức khỏe | 0.7985 | HIGH_CONFIDENCE | sức khỏe | **YES** |
| `nhận lương tháng này 12000000` | thu nhập | 0.7944 | HIGH_CONFIDENCE | thu nhập | **YES** |
| `chuyển khoản tiền nhà 3000000` | thu nhập | 0.3220 | UNCERTAIN_SUGGESTION | hóa đơn | **NO (Có cảnh báo)** |
| `đi xem phim cgv 120k` | giải trí | 0.9471 | HIGH_CONFIDENCE | giải trí | **YES** |
| `mua áo sơ mi shopee` | mua sắm | 0.8136 | HIGH_CONFIDENCE | mua sắm | **YES** |
| `đóng học phí đại học` | giáo dục | 0.9256 | HIGH_CONFIDENCE | giáo dục | **YES** |
| `mua chứng chỉ quỹ vingroup` | đầu tư | 0.9314 | HIGH_CONFIDENCE | đầu tư | **YES** |
| `tiền thưởng tết` | thu nhập | 0.8900 | HIGH_CONFIDENCE | thu nhập | **YES** |

> [!NOTE]
> Ca `chuyển khoản tiền nhà 3000000`: Từ "chuyển khoản" kích hoạt nhãn `thu nhập`. Tuy nhiên, cơ chế **Confidence Calibration** đã phát hiện độ tin cậy chỉ đạt 0.3220 (< ngưỡng an toàn 0.35), tự động hạ nhãn xuống `UNCERTAIN_SUGGESTION` để giao diện hiển thị cảnh báo người dùng tự xác nhận.

---

## 9. HARD / EDGE TESTS

Kiểm tra khả năng chịu lỗi và hành vi ngoài phân phối:

| Input đầu vào | Phân loại | Kết quả dự đoán | Độ tin cậy | Crash? | Phân tích hành vi |
|---|---|---|---:|:---:|---|
| `""` | Rỗng tuyệt đối | khác | 0.0000 | **KHÔNG** | Bắt lỗi chuỗi rỗng an toàn, trả nhãn fallback |
| `" "` | Chỉ có khoảng trắng | khác | 0.0000 | **KHÔNG** | Bắt lỗi chuỗi rỗng sau khi trim |
| `"a"` | 1 ký tự duy nhất | khác | 0.1000 | **KHÔNG** | Từ vựng chưa từng thấy -> Trả về `khác` (Low Conf) |
| `"123456789"` | Toàn bộ là chữ số | ăn uống | 0.2191 | **KHÔNG** | Nhãn không chắc chắn (<0.35), không crash |
| `"!@#$%^&*()_+"` | Toàn ký tự đặc biệt | khác | 0.1000 | **KHÔNG** | Nhận diện token ngoại lai an toàn |
| `"cf"` | Viết tắt tiếng lóng | ăn uống | 0.6048 | **KHÔNG** | Nhận diện chính xác cà phê / quán nước |
| `"do xang"` | Tiếng Việt không dấu | di chuyển | 0.2548 | **KHÔNG** | Nhận diện đúng nhóm di chuyển (Low Conf) |
| `"an trua"` | Tiếng Việt không dấu | ăn uống | 0.7226 | **KHÔNG** | Nhận diện chính xác ăn trưa |
| `"mua banh my ba lan"` | Sai chính tả / viết lệch | ăn uống | 0.4318 | **KHÔNG** | Nhận diện bánh mì/bánh ngọt |
| `"netflix hàng tháng gói gia đình..."` | Câu văn dài | giải trí | 0.7780 | **KHÔNG** | Nhận diện chuẩn xác dịch vụ giải trí |
| `"tôi muốn học lái máy bay trực thăng..."` | Ngoài domain tài chính | giáo dục | 0.3532 | **KHÔNG** | Nhận diện theo từ khóa "học", conf thấp |
| `"bitcoin ethereum binance dogecoin"` | Thuật ngữ crypto lạ | di chuyển | 0.1757 | **KHÔNG** | Confidence rất thấp (0.1757), gắn cờ cảnh báo |
| `"hôm nay trời đẹp quá bạn ơi"` | Tán gẫu không liên quan | giải trí | 0.2780 | **KHÔNG** | Confidence rất thấp (0.2780), gắn cờ cảnh báo |

---

## 10. PERFORMANCE

Đo lường trực tiếp trên CPU máy trạm (Intel/AMD x64, Python 3.11.9, không dùng GPU):

| Thành phần | Thời gian khởi động / Load | Cold Inference | Warm Inference (Mean) | Warm Inference (P95) | Bộ nhớ RAM (RSS) | VRAM / GPU |
|---|---:|---:|---:|---:|---:|---:|
| **Toàn bộ AI Container** *(7 models)* | **232.77 ms** | — | — | — | **43.54 MB** | 0 MB (Pure CPU) |
| `model_classify_v3` | ~45 ms | 0.409 ms | **0.091 ms** | 0.114 ms | Trong tổng RAM | 0 MB |
| `model_warning_v3` | ~30 ms | 0.176 ms | **0.035 ms** | 0.076 ms | Trong tổng RAM | 0 MB |
| `model_prediction_v3` | ~25 ms | 1.963 ms | **0.418 ms** | 0.458 ms | Trong tổng RAM | 0 MB |
| `model_advisor` | ~35 ms | 0.200 ms | **0.097 ms** | 0.118 ms | Trong tổng RAM | 0 MB |

> [!TIP]
> Tất cả các mô hình đạt độ trễ suy luận dưới **0.5 ms** trên môi trường CPU tiêu chuẩn, đáp ứng hoàn hảo yêu cầu thời gian thực (SLA < 100 ms).

---

## 11. TEST SUITE

Kết quả chạy thực tế hai bộ kiểm thử của dự án:

### 1. Python Pytest (`ai_service/tests` & `model_advisor/tests`)
```bash
python -m pytest ai_service/tests model_advisor/tests -v
```
- **Passed:** **99 tests**
- **Failed:** 0
- **Skipped:** 0
- **Warnings:** 5 (Cảnh báo không dùng httpx2 trong Starlette testclient cũ và mã HTTP 422 deprecation name)
- **Thời gian thực thi:** 1.29 giây

### 2. Node.js Native Test Runner (`tests/ai-*.test.mjs`)
```bash
node tests/ai-canary-routing.test.mjs; node tests/ai-integration-v3.test.mjs
```
- **Passed:** **15 tests** (7 canary routing tests + 8 integration security tests)
- **Failed:** 0
- **Thời gian thực thi:** 129 ms

---

## 12. LOCAL READINESS

Phân loại khả năng vận hành cục bộ khi hoàn toàn ngắt kết nối Internet:

| Chức năng AI | Mô hình đảm nhiệm | Phụ thuộc Internet | Phụ thuộc GPU | Trạng thái Local Readiness | Hành vi khi ngắt Internet |
|---|---|:---:|:---:|---|---|
| **Phân loại giao dịch** | `model_classify_v3` | KHÔNG | KHÔNG | **LOCAL READY** | Hoạt động bình thường 100% |
| **Dự báo chi tiêu** | `model_prediction_v3` | KHÔNG | KHÔNG | **LOCAL READY** | Hoạt động bình thường 100% |
| **Cảnh báo rủi ro thẻ** | `model_warning_v3` | KHÔNG | KHÔNG | **LOCAL READY** | Hoạt động bình thường 100% |
| **Cố vấn tài chính** | `model_advisor` | KHÔNG | KHÔNG | **LOCAL READY** | Hoạt động bình thường 100% |
| **Nhập nhanh Dashboard** | `smart-parser.ts` (Heuristic) | KHÔNG | KHÔNG | **LOCAL READY** | Hoạt động bình thường 100% |
| **Trợ lý Copilot Chat** | Google Gemini API | **CÓ** | KHÔNG | **NOT LOCAL READY** | Báo lỗi không thể kết nối trợ lý AI |
| **Quét hóa đơn OCR** | Google Gemini Vision | **CÓ** | KHÔNG | **NOT LOCAL READY** | Báo lỗi không thể tải lên hình ảnh |

---

## 13. PRODUCTION READINESS

Đánh giá mức độ sẵn sàng sản phẩm cho từng mô hình:

| Model | Trạng thái hiện tại | Độ ổn định Artifact | Xử lý lỗi & Timeout | Khả năng giám sát | Đánh giá Production Readiness |
|---|---|:---:|:---:|:---:|---|
| **Classify V3** | INTEGRATED / CANARY READY | Tuyệt đối (SHA-256) | Cực tốt (Fallback V2, FailSafe) | Sẵn sàng (Product events log) | **STAGING READY / CANARY READY** *(Chặn bởi việc chưa nhúng UI)* |
| **Prediction V3** | INTEGRATED / CANARY READY | Tuyệt đối (SHA-256) | Cực tốt (Horizon guard) | Sẵn sàng (Observability) | **STAGING READY / CANARY READY** *(Chặn bởi việc chưa nhúng UI)* |
| **Warning V3** | INTEGRATED / CANARY READY | Tuyệt đối (SHA-256) | Cực tốt (Defense null/zero) | Sẵn sàng (Observability) | **STAGING READY / CANARY READY** *(Chặn bởi dữ liệu test tổng hợp quá dễ)* |
| **Advisor V3** | INTEGRATED / CANARY READY | Tuyệt đối (SHA-256) | Cực tốt (Rule fallback) | Sẵn sàng (Observability) | **STAGING READY / CANARY READY** *(Chặn bởi việc chưa nhúng UI)* |
| **Gemini Chat** | PRODUCTION READY | N/A | Có timeout 15s | Có lưu log admin telemetry | **PRODUCTION READY** |
| **Gemini Receipt** | PRODUCTION READY | N/A | Có timeout 35s | Có lưu log admin telemetry | **PRODUCTION READY** |
| **Quick Entry AI** | HEURISTIC FALLBACK | N/A | Rơi vào Heuristic | Chưa đo lường | **EXPERIMENTAL / BROKEN API ROUTE** |

---

## 14. RISKS

1. **Rủi ro trải nghiệm người dùng (UX Gap):** Nhãn trên Dashboard ghi "GEMINI AI - Nhập nhanh bằng AI" nhưng thực tế đang chạy parser Regex cục bộ do route API thiếu. Người dùng có thể cảm thấy chức năng AI bị "giả tạo" nếu gõ các câu phức tạp không khớp từ khóa.
2. **Rủi ro sai số dữ liệu thực tế (Generalization Risk):** Mô hình `model_warning_v3` đạt F1 = 1.0000 trên dữ liệu tổng hợp nhưng chưa bao giờ được kiểm nghiệm trên tập log giao dịch ngân hàng thật. Có nguy cơ cao báo động giả (False Alarm) hoặc bỏ lọt gian lận tinh vi khi đưa vào thực tế.
3. **Rủi ro khởi động tiến trình AI độc lập:** Dịch vụ `ai_service` viết bằng Python/FastAPI chạy độc lập trên cổng 8000. Trong quy trình `npm run dev` thông thường của Node/Vite, tiến trình Python không tự khởi động. Nếu không bật `docker-compose.ai.yml` hoặc chạy `uvicorn`, Next.js client sẽ chuyển toàn bộ sang trạng thái lỗi mềm hoặc ngắt mạch (Circuit Breaker OPEN).
4. **Sai lệch Checksum tệp Metrics động:** Script `model_advisor/scripts/evaluate.py` mỗi lần chạy đều ghi đè tệp `evaluation_report.json` với số mili-giây độ trễ đo lường mới. Điều này làm thay đổi chuỗi băm SHA-256 so với `model_checksums.json`.

---

## 15. GAP ANALYSIS

| Priority | Vấn đề kỹ thuật | Model ảnh hưởng | Tác động | Nguyên nhân gốc rễ | Cách xử lý khuyến nghị |
|---|---|---|---|---|---|
| **P0** | Thiếu API route `/api/ai/parse-transaction` | Quick Entry / Dashboard | Tính năng "Nhập nhanh bằng AI" luôn trả về 404 và âm thầm lùi về Regex | Giao diện frontend gọi một route chưa từng được tạo trong `app/api/` | Viết bổ sung `app/api/ai/parse-transaction/route.ts` nối vào `aiClassify` hoặc Gemini API |
| **P1** | 4 UI Component AI chưa được mount vào Dashboard | Classify V3, Warning V3, Advisor V3 | Toàn bộ 4 mô hình ML V3 không đến được mắt người dùng cuối | Component đã được viết (`frontend/components/ai-*`) nhưng chưa được import vào `dashboard.tsx` | Nhúng `AiClassifyHint` vào modal tạo giao dịch, `AiRiskBadge` vào bảng giao dịch, `AiAdvisorPanel` vào tab Tổng quan |
| **P1** | Dữ liệu `model_warning_v3` có độ phân tách giả tạo (F1=1.0) | Warning V3 | Nguy cơ dự báo sai lệch khi gặp dữ liệu thực tế | Tập synthetic data chèn nhãn gian lận dựa trên chênh lệch số tiền quá lớn và dark web card cố định | Thu thập hoặc tổng hợp dữ liệu nhiễu (noise), giảm độ chênh lệch số tiền, bổ sung các mẫu gian lận tinh vi |
| **P2** | Checksum tệp `evaluation_report.json` bị lệch sau mỗi lần evaluate | Model Advisor / Checksum Registry | Gây cảnh báo FATAL Checksum mismatch khi khởi động ModelContainer | Script `evaluate.py` ghi đè thời gian thực thi (latency ms) vào tệp json nằm trong danh sách giám sát checksum | Loại bỏ các tệp báo cáo động ra khỏi `model_checksums.json`, chỉ giám sát `.pkl`, `.py`, `.json` data cố định |
| **P2** | Thiếu tự động hóa khởi động `ai_service` trong local development | Tất cả 4 local models | Dev chạy `npm run dev` sẽ thấy tính năng AI cục bộ báo offline | Hệ sinh thái Node.js (Vite/Next.js) và Python (FastAPI) chưa có script start đồng thời | Viết npm script `dev:all` sử dụng `concurrently` để chạy song song Vite và Uvicorn AI Service |
| **P3** | Cảnh báo phiên bản thư viện cũ (InconsistentVersionWarning) | Classify V1, Prediction V1, Warning V1 | V1 không thể load hoặc sinh warning | V1 được sinh bằng scikit-learn 1.7.2 và xgboost | Lưu trữ V1 vào thư mục archive/backup, hoàn tất chuyển đổi 100% sang kiến trúc thuần V3 |

---

## 16. RECOMMENDED NEXT STEPS

Theo đúng thứ tự ưu tiên kỹ thuật:

1. **Khắc phục Endpoint `/api/ai/parse-transaction` (P0):**
   Xây dựng route handler `app/api/ai/parse-transaction/route.ts` kết hợp `aiClassify` (V3) và bộ bóc tách số tiền/ví để chấm dứt tình trạng trả về 404 và che giấu bằng heuristic fallback.
2. **Mount các AI Component vào Giao Diện Người Dùng (P1):**
   - Đưa `AiClassifyHint` vào form tạo giao dịch (`dashboard.tsx`) để gợi ý danh mục tự động.
   - Nhúng `AiRiskBadge` vào chi tiết giao dịch thẻ.
   - Nhúng `AiAdvisorPanel` vào màn hình Tổng quan / Kế hoạch tài chính.
3. **Chuẩn Hóa Danh Sách Checksum Model (P2):**
   Chỉnh sửa `ai_service/model_checksums.json` để chỉ lưu vết các tệp bất biến (artifact weights, vectorizer, script nguồn), loại trừ các tệp báo cáo metric sinh động (`evaluation_report.json`).
4. **Tích Hợp Script Khởi Động Đồng Thì (P2):**
   Bổ sung script khởi động `dev:with-ai` trong `package.json` để tự động kích hoạt `uvicorn ai_service.app:app --port 8000` song song với frontend server.
5. **Cải Tiến Tập Dữ Liệu `model_warning_v3` (P2/P3):**
   Cập nhật kịch bản sinh dữ liệu rủi ro để đưa vào các ca ranh giới mờ (edge cases, chi tiêu tiệm cận hạn mức, giao dịch đêm bình thường) nhằm hạ tỷ lệ phân tách tuyệt đối và phản ánh đúng thế giới thực.
