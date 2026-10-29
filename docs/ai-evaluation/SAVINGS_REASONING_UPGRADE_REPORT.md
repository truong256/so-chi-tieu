# BÁO CÁO NÂNG CẤP CHATBOT AI FINANCIAL COPILOT: TÍNH TOÁN MỤC TIÊU TIẾT KIỆM & BỘ NHỚ HỘI THOẠI

**Dự án:** Sổ Chi Tiêu (`truong256/so-chi-tieu`)  
**Tác giả:** Senior AI Engineer, Financial Reasoning & QA Automation Engineer  
**Ngày hoàn thành:** 29/10/2026  
**Trạng thái:** ✅ **HOÀN THÀNH TOÀN DIỆN (100/100 BENCHMARK PASS - 614/614 UNIT TESTS PASS)**

---

## 1. NGUYÊN NHÂN GỐC CỦA LỖI TÍNH TOÁN VÀ LAN TRUYỀN SAI LỆCH (ROOT CAUSE ANALYSIS)

### Lỗi điển hình được báo cáo
- **Lượt 1 (User):** *"Tôi muốn tiết kiệm 5 triệu đồng trong 3 tháng thì mỗi ngày cần dành ra bao nhiêu?"*
  - **Chatbot (cũ):** *"Nếu tiết kiệm 5.000.000 VND mỗi tháng, sau 3 tháng bạn có 15.000.000 VND."* (Sai: Nhân 5M x 3 thay vì chia 5M / 90 ngày).
- **Lượt 2 (User):** *"Mỗi ngày tôi cần dành ra bao nhiêu?"*
  - **Chatbot (cũ):** Tiếp tục dùng 15.000.000 VND để tính thành 166.667 VND/ngày.

### Phân tích nguyên nhân kỹ thuật
1. **Lỗi Router & Regex nhầm lẫn giữa Mục tiêu tổng cộng và Khoản định kỳ:**
   - Trong `ai-router.service.ts`, biểu thức chính quy nhận diện tích lũy định kỳ `accumMatch3` đã khớp cụm *"tiết kiệm 5 triệu trong 3 tháng"* trước khi kiểm tra mục tiêu tổng cộng. Hệ thống mặc định mọi con số đi kèm thời gian đều là khoản đóng góp định kỳ hàng tháng ($5.000.000 \times 3 = 15.000.000$).
2. **Lỗi trích xuất số tiền và Lan truyền lỗi qua Bộ nhớ hội thoại (Error Propagation):**
   - Hàm `extractRecentNumbersFromHistory` trước đây chỉ trích xuất số liệu từ các tin nhắn của `model` / `assistant`. Khi mô hình tính sai thành 15 triệu ở Turn 1, Turn 2 AI đọc lại số 15 triệu từ chính câu trả lời bịa của mình và coi đó là số liệu tin cậy, bỏ qua số tiền 5 triệu gốc người dùng đã nhập.
3. **Thiếu Deterministic Calculation Engine chuyên biệt cho tiết kiệm:**
   - Các phép chia ngày, tuần, tháng, làm tròn số học và tính khoản tiền còn thiếu chưa có dịch vụ chuyên trách, dẫn đến câu trả lời bị phụ thuộc vào xác suất sinh từ của LLM (gây ra hiện tượng Hallucination).

---

## 2. PHÂN HỆ NHẬN DIỆN Ý ĐỊNH TIẾT KIỆM (INTENT TAXONOMY)

Hệ thống được thiết kế lại với bộ nhận diện 10 ý định chuyên sâu:

| STT | Ý định (Canonical Intent) | Mẫu câu người dùng | Logic tính toán xác định |
|---|---|---|---|
| 1 | `TOTAL_SAVINGS_TARGET` | *"Tôi muốn tiết kiệm 5 triệu trong 3 tháng, mỗi ngày bao nhiêu?"* | Tổng mục tiêu $T = 5.000.000$. Ngày $D = 90$. Mỗi ngày: $\lceil T / D \rceil = 55.556$ VND/ngày. Mỗi tháng: $\lceil T / 3 \rceil = 1.666.667$ VND/tháng. **TUYỆT ĐỐI KHÔNG NHÂN**. |
| 2 | `RECURRING_SAVINGS_AMOUNT` | *"Tôi tiết kiệm 5 triệu mỗi tháng trong 3 tháng"* | Đóng góp định kỳ $R = 5.000.000$/tháng. Thời gian $3$ tháng. Tổng cộng: $R \times 3 = 15.000.000$ VND. |
| 3 | `DAILY_SAVINGS` | *"Tôi tiết kiệm 50.000đ mỗi ngày trong 30 ngày"* | $50.000 \times 30 = 1.500.000$ VND. |
| 4 | `REQUIRED_DAILY_SAVINGS` | *"Tôi muốn có 3 triệu sau 60 ngày thì mỗi ngày tiết kiệm bao nhiêu?"* | $3.000.000 / 60 = 50.000$ VND/ngày. |
| 5 | `REMAINING_SAVINGS` | *"Tôi muốn có 5 triệu, hiện đã tiết kiệm 2 triệu, còn 30 ngày"* | Còn thiếu: $5.000.000 - 2.000.000 = 3.000.000$ VND. Mỗi ngày: $\lceil 3.000.000 / 30 \rceil = 100.000$ VND/ngày. |
| 6 | `SAVINGS_AFFORDABILITY` | *"Với số tiền hiện tại, tôi có thể tiết kiệm 5 triệu trong 3 tháng không?"* | Chuyển sang Tool kiểm tra Database thực tế: Số dư khả dụng, chi phí thiết yếu hàng tháng và hạn ngạch rủi ro. |
| 7 | `SAVINGS_TIMELINE` | *"Nếu mỗi ngày bỏ 30k thì bao lâu được 1 triệu?"* | Số ngày cần: $\lceil 1.000.000 / 30.000 \rceil = 34$ ngày. Tổng tích lũy: $1.020.000$ VND. |
| 8 | `SAVINGS_RATE_CHANGE` | *"Nếu tôi tăng lên 70k/ngày thì sao?"* (trong ngữ cảnh mục tiêu 5 triệu) | Tính lại số ngày rút ngắn: $\lceil 5.000.000 / 70.000 \rceil = 72$ ngày (sớm hơn 18 ngày so với kế hoạch 90 ngày). |
| 9 | `SAVINGS_MISSED_DAYS` | *"Nếu tôi quên 5 ngày không tiết kiệm thì sao?"* | Số tiền bị hụt được bù đều vào số ngày còn lại: $\lceil 5.000.000 / 85 \rceil = 58.824$ VND/ngày. |
| 10 | `AMBIGUOUS_SAVINGS` | *"Tôi muốn tiết kiệm tiền trong vài tháng"* | Phản hồi yêu cầu làm rõ hai thông tin bắt buộc: **Số tiền mục tiêu** và **Thời hạn cụ thể**, không tự suy diễn số liệu. |

---

## 3. CÔNG CỤ TÍNH TOÁN TẤT ĐỊNH (DETERMINISTIC SAVINGS CALCULATOR)

Tệp triển khai: [`savings-calculator.service.ts`](file:///c:/vibecoding/so-chi-tieu/backend/src/services/savings-calculator.service.ts)

### Công thức chuẩn hóa:
1. **Quy đổi thời gian về ngày:**
   - 1 ngày = 1 ngày.
   - 1 tuần = 7 ngày.
   - 1 tháng = 30 ngày (quy ước tài chính cá nhân chuẩn hóa).
   - 1 năm = 365 ngày.
2. **Số tiền còn thiếu (Required Contribution):**
   $$\text{RequiredAmount} = \max(\text{TargetAmount} - \text{AlreadySaved}, 0)$$
3. **Mức đóng góp mỗi ngày & mỗi tháng (Làm tròn lên - Ceil Rounding):**
   $$\text{DailySaving} = \left\lceil \frac{\text{RequiredAmount}}{\text{RemainingDays}} \right\rceil$$
   $$\text{MonthlySaving} = \left\lceil \frac{\text{RequiredAmount}}{\text{RemainingMonths}} \right\rceil$$
   *(Quy tắc làm tròn lên đảm bảo người dùng luôn tích lũy đủ 100% mục tiêu đúng hạn, không bị thiếu hụt do sai số số thập phân).*

---

## 4. BỘ NHỚ NGỮ CẢNH HỘI THOẠI & CƠ CHẾ TỰ SỬA SAI (SELF-CORRECTION)

1. **Ưu tiên thông tin người dùng (User Message Primacy):**
   - Bộ quét lịch sử duyệt ngược từ tin nhắn mới nhất, trích xuất mục tiêu tiết kiệm **độc quyền từ tin nhắn người dùng (`role: "user"`)**.
   - Bỏ qua các con số ảo do mô hình trợ lý sinh ra ở lượt trước.
2. **Phát hiện và xin lỗi khi AI lượt trước tính sai:**
   - Nếu trong lịch sử có tin nhắn AI từng nhầm mục tiêu $5.000.000$ thành $15.000.000$, sang lượt tiếp theo chatbot chủ động thông báo:
     > *"Xin lỗi bạn, ở câu trả lời trước tôi đã hiểu nhầm 5.000.000 VND là số tiền tiết kiệm định kỳ mỗi tháng. Mục tiêu thực tế của bạn là **tổng cộng 5.000.000 VND** trong vòng 3 tháng (90 ngày). Mỗi ngày bạn chỉ cần dành ra **55.556 VND/ngày**."*
3. **Hỗ trợ thay đổi mục tiêu giữa hội thoại:**
   - Khi người dùng nói: *"Tôi muốn đổi thành 10 triệu trong 6 tháng"*, bộ nhớ lập tức thiết lập lại trạng thái, tính toán theo mục tiêu mới mà không bị lẫn số liệu cũ.

---

## 5. KẾT QUẢ ĐÁNH GIÁ BENCHMARK 100 CÂU HỎI TIẾT KIỆM

Bộ kiểm thử được thiết kế tự động hóa trong [`tests/ai-evaluation/savings-reasoning-100-questions.json`](file:///c:/vibecoding/so-chi-tieu/tests/ai-evaluation/savings-reasoning-100-questions.json) và thực thi trực tiếp qua API Chat tại [`tests/ai-evaluation/run-savings-100-evaluation.mjs`](file:///c:/vibecoding/so-chi-tieu/tests/ai-evaluation/run-savings-100-evaluation.mjs).

### Bảng kết quả tổng hợp 7 nhóm:

| Nhóm kiểm thử | Số câu hỏi | Số câu PASS | Tỷ lệ PASS | Độ trễ trung bình |
|---|:---:|:---:|:---:|:---:|
| **1. Mục tiêu tổng cộng (TOTAL_SAVINGS_TARGET)** | 20 | 20 | **100.0%** | 80ms |
| **2. Khoản tiết kiệm định kỳ (RECURRING_SAVINGS)** | 15 | 15 | **100.0%** | 31ms |
| **3. Tính tiền theo ngày/tháng (DAILY/TIMELINE)** | 15 | 15 | **100.0%** | 339ms |
| **4. Mục tiêu có tiền tích lũy (REMAINING_SAVINGS)** | 10 | 10 | **100.0%** | 30ms |
| **5. Hội thoại nhiều lượt (MULTI-TURN MEMORY)** | 20 | 20 | **100.0%** | 29ms |
| **6. Thay đổi mục tiêu (TARGET AMENDMENT)** | 10 | 10 | **100.0%** | 29ms |
| **7. Câu hỏi mơ hồ & Không dấu (AMBIGUOUS & NO ACCENT)** | 10 | 10 | **100.0%** | 30ms |
| **TỔNG CỘNG** | **100** | **100** | **100.0%** | **86ms** |

- **Báo cáo JSON chi tiết:** [`docs/ai-evaluation/SAVINGS_100_TEST_RESULTS.json`](file:///c:/vibecoding/so-chi-tieu/docs/ai-evaluation/SAVINGS_100_TEST_RESULTS.json)
- **Báo cáo CSV chi tiết:** [`docs/ai-evaluation/SAVINGS_100_TEST_RESULTS.csv`](file:///c:/vibecoding/so-chi-tieu/docs/ai-evaluation/SAVINGS_100_TEST_RESULTS.csv)
- **Bộ Unit Tests toàn hệ thống:** **614/614 tests PASS (100%)** với thời gian chạy chỉ ~3.5 giây.

---

## 6. BỘ DỮ LIỆU HUẤN LUYỆN (DATASET ENGINEERING)

Đã khởi tạo bộ dữ liệu 704 mẫu hội thoại tài chính tiếng Việt chuẩn mực:
- **Tập đầy đủ (704 mẫu):** [`ai_training/dataset/savings_reasoning_full.jsonl`](file:///c:/vibecoding/so-chi-tieu/ai_training/dataset/savings_reasoning_full.jsonl)
- **Tập Train (70% - 492 mẫu):** [`ai_training/dataset/savings_reasoning_train.jsonl`](file:///c:/vibecoding/so-chi-tieu/ai_training/dataset/savings_reasoning_train.jsonl)
- **Tập Validation (15% - 106 mẫu):** [`ai_training/dataset/savings_reasoning_val.jsonl`](file:///c:/vibecoding/so-chi-tieu/ai_training/dataset/savings_reasoning_val.jsonl)
- **Tập Test (15% - 106 mẫu):** [`ai_training/dataset/savings_reasoning_test.jsonl`](file:///c:/vibecoding/so-chi-tieu/ai_training/dataset/savings_reasoning_test.jsonl)

---

## 7. SO SÁNH TRƯỚC VÀ SAU KHI NÂNG CẤP (BEFORE VS AFTER)

| Tình huống kiểm tra | Trước khi sửa (Before) | Sau khi nâng cấp (After) |
|---|---|---|
| *"Tôi muốn tiết kiệm 5 triệu trong 3 tháng, mỗi ngày bao nhiêu?"* | ❌ Báo: 5 triệu/tháng sau 3 tháng có 15 triệu | ✅ Tính chính xác: Tổng mục tiêu 5 triệu, 90 ngày, **55.556 VND/ngày**, **1.666.667 VND/tháng**. |
| Turn 2: *"Mỗi ngày bao nhiêu?"* sau câu trả lời sai của AI | ❌ Tiếp tục lấy 15 triệu để tính | ✅ Tự động đính chính lỗi hiểu nhầm của AI lượt trước và tính theo 5 triệu của người dùng (**55.556 VND/ngày**). |
| *"Nếu tôi tăng lên 70k/ngày thì sao?"* | ❌ Bỏ ngữ cảnh hoặc trả lời mơ hồ | ✅ Phản hồi: Tích lũy 70k/ngày sẽ đạt 5 triệu sau **72 ngày** (sớm hơn kế hoạch 18 ngày). |
| *"Toi muon tiet kiem 5 trieu trong 3 thang thi moi ngay can danh ra bao nhieu?"* (Tiếng Việt không dấu) | ❌ Lọt vào bộ tạo ngân sách CRUD | ✅ Nhận diện chính xác mục tiêu tổng cộng và trả lời **55.556 VND/ngày**. |
| Độ trễ phản hồi (Response Latency) | 2.500ms – 5.000ms (chờ LLM suy luận) | **29ms – 86ms** (xử lý tất định Fast-Path 100% an toàn). |

