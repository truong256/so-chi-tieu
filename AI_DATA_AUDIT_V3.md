# AI DATA AUDIT REPORT V3
**Dự án Sổ Chi Tiêu — Khảo sát & Đánh giá chất lượng dữ liệu AI Subsystem**  
*Thời gian thực hiện: 2026-09-26*

---

## 1. TỔNG QUAN HỆ THỐNG DỮ LIỆU

Hệ thống AI hiện tại của dự án Sổ Chi Tiêu gồm 4 tác vụ độc lập:
1. **Transaction Classification (`classify`):** Phân loại chuỗi mô tả giao dịch người dùng thành 10 danh mục ứng dụng.
2. **Transaction Risk / Anomaly Assessment (`risk`):** Đánh giá xác suất rủi ro/bất thường từ đặc trưng giao dịch tài chính.
3. **Expense Forecasting (`forecast`):** Dự báo chi tiêu hàng ngày đa kỳ (7, 14, 30 ngày) từ chuỗi thời gian chi tiêu.
4. **Financial Advisory (`advisor`):** Cố vấn tài chính cá nhân toàn diện (xếp hạng sức khỏe tài chính, phân tích thặng dư, phát hiện rủi ro, đưa gợi ý hành động).

---

## 2. NHIỆM VỤ 1: TRANSACTION CLASSIFICATION

### 2.1. Quy mô & Phân chia Dataset v2
- **Tổng số mẫu:** 4,500 mẫu
- **Tập Train:** 3,200 mẫu (71.1%)
- **Tập Validation:** 650 mẫu (14.4%)
- **Tập Test (Untouched):** 650 mẫu (14.4%)
- **Tập Hard Test v2:** 150 mẫu (74 có dấu, 76 không dấu/typo)

### 2.2. Phân bố nhãn (Class Distribution)
Phân loại tuân thủ nghiêm ngặt 10 danh mục tài chính cá nhân chuẩn của ứng dụng:

| Danh mục | Train (N=3,200) | Val (N=650) | Test (N=650) | Tỷ lệ toàn tập |
| :--- | :--- | :--- | :--- | :--- |
| `ăn uống` | 308 (9.6%) | 73 (11.2%) | 69 (10.6%) | 450 (10.0%) |
| `di chuyển` | 324 (10.1%) | 66 (10.2%) | 60 (9.2%) | 450 (10.0%) |
| `mua sắm` | 328 (10.3%) | 67 (10.3%) | 55 (8.5%) | 450 (10.0%) |
| `hóa đơn` | 324 (10.1%) | 59 (9.1%) | 67 (10.3%) | 450 (10.0%) |
| `giải trí` | 312 (9.8%) | 69 (10.6%) | 69 (10.6%) | 450 (10.0%) |
| `sức khỏe` | 310 (9.7%) | 62 (9.5%) | 78 (12.0%) | 450 (10.0%) |
| `giáo dục` | 332 (10.4%) | 55 (8.5%) | 63 (9.7%) | 450 (10.0%) |
| `đầu tư` | 314 (9.8%) | 66 (10.2%) | 70 (10.8%) | 450 (10.0%) |
| `thu nhập` | 323 (10.1%) | 67 (10.3%) | 60 (9.2%) | 450 (10.0%) |
| `khác` | 325 (10.2%) | 66 (10.2%) | 59 (9.1%) | 450 (10.0%) |

### 2.3. Phát hiện rò rỉ dữ liệu (Data Leakage & Duplicate Audit)
- **Kiểm tra trùng lặp văn bản giữa các tập:**
  - `Train` vs `Val`: Có **178 chuỗi trùng lặp** do random sampling sinh ra từ tập từ vựng cố định.
  - `Train` vs `Test`: Có **198 chuỗi trùng lặp**.
  - `Val` vs `Test`: Có **66 chuỗi trùng lặp**.
  - `Hard Test` vs `Train`: Có **68 chuỗi trùng lặp**.
- **Kết luận Audit v3:** Mặc dù v2 đã giải quyết lỗi encoding Unicode và taxonomy, nhưng việc random split sau khi sinh mẫu đã tạo ra sự trùng lặp văn bản giữa Train và Test.
- **Hành động khắc phục bắt buộc cho v3:**
  1. Loại bỏ trùng lặp hoàn toàn: Mỗi chuỗi giao dịch duy nhất chỉ xuất hiện ở đúng một tập.
  2. Thực hiện **Stratified Split theo unique phrases**: Train 70%, Val 15%, Test 15%. Đảm bảo rò rỉ chuỗi giữa Train và Test là **chính xác 0%**.
  3. Xây dựng **Independent Hard Test Set v3** (150 mẫu độc lập hoàn toàn với Train Set), bao gồm các case tiếng Việt phong phú: viết tắt ("cf 50k", "an trua 35"), không dấu, mixed case, typo, đơn vị tiền tệ ("220k", "45k", "35").

### 2.4. Kiểm tra Encoding & Chuẩn hóa Unicode
- 100% các mẫu trong v2 tuân thủ chuẩn **Unicode NFC**.
- Giữ nguyên các ký tự đặc thù tiếng Việt: `ă, â, ê, ô, ơ, ư, đ` và 5 dấu thanh (sắc, huyền, hỏi, ngã, nặng).
- Null check: 0 mẫu null hoặc rỗng trong dataset v2.

---

## 3. NHIỆM VỤ 2: TRANSACTION RISK / WARNING

### 3.1. Quy mô & Phân chia Dataset
- **Tổng số giao dịch:** 18,000 giao dịch.
- **Tập Train:** 12,000 giao dịch (350 người dùng, 518 thẻ tín dụng/ghi nợ).
- **Tập Validation:** 3,000 giao dịch (75 người dùng, 109 thẻ).
- **Tập Test (Untouched):** 3,000 giao dịch (75 người dùng, 113 thẻ).

### 3.2. Kiểm tra rò rỉ thực thể (Group Leakage Check)
- **User Group Overlap:** `Train` $\cap$ (`Val` $\cup$ `Test`) = **0 người dùng** (0.0%).
- **Card Group Overlap:** `Train` $\cap$ (`Val` $\cup$ `Test`) = **0 thẻ** (0.0%).
- **Tỷ lệ gian lận (Fraud Prevalence):**
  - Train: 8.29% (995 / 12,000)
  - Val: 7.10% (213 / 3,000)
  - Test: 7.70% (231 / 3,000)

### 3.3. Danh sách đặc trưng & Mục tiêu (Feature & Target Schema)
- **Target:** `is_fraud` (0: Hợp lệ / An toàn, 1: Gian lận / Rủi ro cao).
- **Output tầng cảnh báo:** `risk_score` $\in [0, 1]$, `risk_level` $\in \{\text{"SAFE"}, \text{"WARNING"}, \text{"DANGER"}\}$.
- **22 đặc trưng mô hình:**
  1. `log_transaction_amount`: $\ln(1 + \text{amount})$
  2. `log_credit_limit`: $\ln(1 + \text{credit\_limit})$
  3. `amount_to_limit_ratio`: $\text{amount} / \text{credit\_limit}$
  4. `hour`: Giờ giao dịch (0 - 23)
  5. `is_night`: Cờ đêm (1h - 5h sáng)
  6. `day_of_week`: Ngày trong tuần (0 - 6)
  7. `is_weekend`: Cuối tuần (thứ 7, CN)
  8. `month`: Tháng giao dịch (1 - 12)
  9. `is_high_risk_mcc`: Mã MCC rủi ro cao (5732, 5944, 7995, 6051, 4829)
  10. `use_chip_encoded`: Phương thức (Swipe, Chip, Online)
  11. `card_brand_encoded`: Thương hiệu thẻ (Visa, Mastercard, JCB, Amex)
  12. `card_type_encoded`: Loại thẻ (Debit, Credit, Prepaid)
  13. `has_chip_encoded`: Thẻ vật lý có chip (YES/NO)
  14. `dark_web_encoded`: Cảnh báo rò rỉ Dark Web (YES/NO)
  15. `credit_score`: Điểm tín dụng cá nhân (300 - 850)
  16. `log_yearly_income`: $\ln(1 + \text{yearly\_income})$
  17. `current_age`: Độ tuổi chủ thẻ
  18. `gender_encoded`: Giới tính (Female/Male)
  19. `has_error`: Cờ phát hiện lỗi thử giao dịch
  20. `deviation_from_card_average`: Độ lệch so với chi tiêu trung bình của thẻ
  21. `deviation_from_user_average`: Độ lệch so với chi tiêu trung bình của người dùng
  22. `user_txn_count`: Tổng số giao dịch quá khứ của người dùng

### 3.4. Kiểm tra Null / Zero / Negative Value Resilience (Bug Regression Audit)
- **Vấn đề đã phát hiện trong quá khứ:** Bug `float(None)` khi client gửi `credit_limit: null` hoặc `amount: null`, gây crash 500.
- **Giá trị 0 / Số âm / Outlier:**
  - `credit_limit = 0`: Cần gán tỷ lệ an toàn `ratio = 0.0` để tránh phép chia cho 0 (`ZeroDivisionError`).
  - `credit_limit = null`: Tự động điền giá trị trung vị từ Train (`median_credit_limit`).
  - `amount < 0`: Kẹp giá trị $\ge 0.0$ trước khi tính `log1p` để tránh `ValueError: math domain error`.
  - `yearly_income = null` hoặc `< 0`: Điền `median_yearly_income`.

---

## 4. NHIỆM VỤ 3: EXPENSE FORECASTING

### 4.1. Quy mô & Phân chia Temporal Split
- **Dữ liệu chuỗi thời gian:** 1,277 ngày liên tục từ `2023-01-01` đến `2026-06-30`.
- **Temporal Split (Không random shuffle để tránh data leakage tương lai):**
  - Train: 912 ngày (`2023-01-01` đến `2025-06-30`)
  - Validation: 184 ngày (`2025-07-01` đến `2025-12-31`)
  - Test (Untouched): 181 ngày (`2026-01-01` đến `2026-06-30`)

### 4.2. Đặc tính chuỗi dữ liệu (Data Characteristics)
- **Giá trị chi tiêu hàng ngày (daily_spending):**
  - Min: 50,000 VND
  - Max: 2,850,000 VND
  - Mean: 382,410 VND
  - Số ngày chi tiêu bằng 0: 0 ngày (chuỗi liên tục, người dùng sinh hoạt đều đặn).
  - Đột biến chi tiêu (> 1,500,000 VND): 13 ngày (rơi vào các dịp lễ tết và mua sắm lớn).
- **Chu kỳ hành vi:**
  - Khung thanh toán hóa đơn đầu tháng: Ngày 1 - 5 (`is_bills_window`).
  - Khung nhận lương cuối tháng: Ngày 25 - 30 (`is_payday_window`).
  - Hiệu ứng cuối tuần: Chi tiêu thứ 7 & CN cao hơn ngày thường trung bình 28.4%.
- **Chỉ số đánh giá:**
  - Ưu tiên: **MAE**, **RMSE**, **sMAPE** (Symmetric MAPE), **WAPE** (Weighted Absolute Percentage Error).
  - *Lưu ý về MAPE truyền thống:* Trong thực tế tài chính cá nhân, những ngày chi tiêu rất nhỏ (hoặc 0 VND) sẽ khiến mẫu số của MAPE gần 0 và tỷ lệ phần trăm bùng nổ vô cực. Do đó sMAPE và WAPE là metric khách quan, chuẩn mực và ổn định nhất.

---

## 5. NHIỆM VỤ 4: FINANCIAL ADVISOR

### 5.1. Quy mô & Phân chia Dataset
- **Tổng số hồ sơ tài chính tháng:** 2,000 hồ sơ.
- **Tập Train:** 1,400 hồ sơ (70.0%).
- **Tập Validation:** 300 hồ sơ (15.0%).
- **Tập Test (Untouched):** 300 hồ sơ (15.0%).
- **Tập Out-of-Distribution (OOD):** 100 hồ sơ cực biên (thu nhập siêu cao, nợ nần trầm trọng, chi tiêu vượt 300% thu nhập, thiếu hoàn toàn danh mục).

### 5.2. Phân bố nhãn sức khỏe tài chính (Health Grade Distribution)

| Xếp hạng sức khỏe | Train (N=1,400) | Val (N=300) | Test (N=300) | Định nghĩa ngữ nghĩa |
| :--- | :--- | :--- | :--- | :--- |
| `EXCELLENT` | 339 (24.2%) | 81 (27.0%) | 80 (26.7%) | Tiết kiệm $\ge 35\%$, không nợ xấu, quỹ dự phòng vững |
| `HEALTHY` | 438 (31.3%) | 83 (27.7%) | 79 (26.3%) | Tiết kiệm $20 - 35\%$, chi tiêu có kỷ luật |
| `CAUTION` | 343 (24.5%) | 73 (24.3%) | 84 (28.0%) | Tiết kiệm $< 15\%$, một số danh mục vượt ngân sách |
| `CRITICAL` | 280 (20.0%) | 63 (21.0%) | 57 (19.0%) | Bội chi nghiêm trọng, thâm hụt ròng, áp lực nợ cao |

### 5.3. Tiêu chí kiểm soát chất lượng Advisor (No Hallucination Gate)
- Không được bịa số tiền, ví hoặc mục tiêu tiết kiệm không có trong `financial_summary`.
- Cảnh báo và gợi ý phải ánh xạ trực tiếp từ các dữ liệu định lượng (tỷ lệ tiết kiệm, tỷ lệ chi tiêu cố định, độ vượt ngân sách từng danh mục).

---

## 6. TỔNG KẾT DATA AUDIT & KẾ HOẠCH CHO V3

| Tiêu chí | Trạng thái v2 | Kế hoạch V3 |
| :--- | :--- | :--- |
| **Phân loại tiếng Việt** | Có 198 chuỗi trùng lặp giữa Train & Test | **Tái tạo dataset: Loại bỏ 100% trùng lặp**, Stratified Split chuẩn xác, bổ sung Hard Test độc lập (tiếng Việt có dấu, không dấu, viết tắt, slang). |
| **Đánh giá rủi ro** | Rò rỉ thực thể 0%, nhưng cần kiểm tra kỹ bug `float(None)` | Giữ nguyên Group Split không rò rỉ, **gia cố toàn bộ hàm trích xuất đặc trưng với fallback an toàn cho null, zero, negative và outlier**. |
| **Dự báo chi tiêu** | Temporal split chuẩn, sMAPE 25.17% | Duy trì backtesting walk-forward đa kỳ, đối chiếu trực tiếp với 4 baseline ngây thơ (Naive, MA7, Seasonal Naive, Weekday Avg). |
| **Cố vấn tài chính** | Đạt 100% Macro F1 trên tập kiểm thử | Bổ sung test suite kiểm tra an toàn toàn diện: tháng bình thường, bội chi, dữ liệu rỗng, ít lịch sử. |

*Báo cáo được khởi tạo và xác nhận bởi hệ thống tự động.*
