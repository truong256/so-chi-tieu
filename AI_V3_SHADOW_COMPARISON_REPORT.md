# BÁO CÁO ĐỐI SÁNH SHADOW MODE: AI V3 (PRIMARY) VS V2 (SHADOW)
## Sổ Chi Tiêu — Staging Verification & Realistic Evaluation

Ngày lập: 26/09/2026  
Môi trường: Staging Testbed (Windows x64, Node 22, Python 3.11.9)  
Tập dữ liệu kiểm định: `ai_service/data/staging_realistic_test_set.json` (250 mẫu tiếng Việt thực tế độc lập, ngoài tập Train/Val/Test V3)  
Cấu hình: `AI_CLASSIFY_MODEL_VERSION=v3`, `AI_SHADOW_MODE=true`, `AI_SHADOW_SAMPLE_RATE=1.0`

---

## 1. Mục Đích & Nguyên Tắc Shadow Mode

Shadow Mode được thiết kế nhằm mục đích:
1. Đưa mô hình V3 vào làm động cơ chính phục vụ người dùng (`Primary`).
2. Chạy ngầm mô hình V2 (`Shadow`) song song trên cùng input để đối sánh độ chính xác, độ tin cậy và độ trễ.
3. Đảm bảo kết quả từ mô hình Shadow (V2) **tuyệt đối không can thiệp** vào phản hồi trả về cho người dùng.
4. Ghi nhận log viễn thám có cấu trúc (`ai_shadow_verification`) không chứa PII hoặc dữ liệu tài chính nhạy cảm.

---

## 2. Thống Kê Tổng Quan Đối Sánh (V3 vs V2)

| Chỉ số | Giá trị | Nhận xét |
| :--- | :---: | :--- |
| **Tổng số mẫu Staging** | **250** | Đầy đủ 10 danh mục, đa dạng tiếng lóng, viết tắt, không dấu, emoji |
| **Độ chính xác V3 (Primary)** | **78.80%** | Cao hơn V2 (+2.40%) |
| **Độ chính xác V2 (Shadow)** | **76.40%** | Baseline |
| **Macro F1 V3** | **0.7816** | Cân bằng tốt trên 10 danh mục |
| **Macro F1 V2** | **0.7623** | Baseline |
| **Tỷ lệ đồng thuận (Same Prediction)** | **83.20%** (208/250) | Độ tương đồng cao giữa 2 thế hệ mô hình |
| **Tỷ lệ bất đồng (Disagreement)** | **16.80%** (42/250) | Phản ánh sự khác biệt về biểu diễn đặc trưng |
| **V3 độ tin cậy cao hơn** | **44.8%** | Phân bố tin cậy được hiệu chuẩn tốt hơn |
| **V2 độ tin cậy cao hơn** | **55.2%** | V2 có xu hướng over-confident trên một số từ khóa đơn lẻ |
| **Độ trễ trung bình V3** | **0.122 ms** | Siêu nhanh, hoàn toàn không gây nghẽn I/O |
| **Độ trễ trung bình V2** | **0.059 ms** | Nhẹ hơn do chỉ có word n-grams (V3 có thêm char n-grams) |

---

## 3. Phân Tích Các Ca Bất Đồng (Disagreement Analysis)

Trong 42 ca có dự đoán khác nhau giữa V3 và V2:
- **V3 sửa lỗi thành công cho V2 (V3 đúng, V2 sai): 19 ca (+7.6%)**
- **V3 dự đoán sai trong khi V2 đúng: 13 ca (-5.2%)**
- **Cả hai cùng sai nhưng chọn nhãn khác nhau: 10 ca**

### A. Các ca V3 vượt trội V2 (Tiêu biểu)

1. **Xử lý từ ngữ đa nghĩa & ngữ cảnh phức tạp:**
   - `grab đi học`: V2 nhầm sang `giáo dục` vì từ khóa "học", V3 nhận diện chính xác `di chuyển` nhờ n-gram ngữ cảnh "grab đi".
   - `tien gui xe thang`: V2 nhầm sang `hóa đơn` vì từ "tháng", V3 nhận diện chính xác `di chuyển`.
   - `mua balo di lam`: V2 nhầm sang `di chuyển` vì "đi làm", V3 nhận diện chính xác `mua sắm`.

2. **Khắc phục lỗi gõ sai thương hiệu (Typos & Slang):**
   - `shoppe`: V2 nhầm sang `ăn uống`, V3 nhận diện chính xác `mua sắm` nhờ Character (3,4)-gram "shop", "oppe".
   - `chuột logitech g102`: V2 nhầm sang `ăn uống`, V3 nhận diện chính xác `mua sắm`.
   - `bàn phím cơ akko 1tr1`: V2 nhầm sang `ăn uống`, V3 nhận diện chính xác `mua sắm`.
   - `nạp data`: V2 nhầm sang `giải trí`, V3 nhận diện chính xác `hóa đơn`.

3. **Món ăn đặc sản không dấu:**
   - `nem nuong nha trang`: V2 nhầm sang `sức khỏe` (do từ "nha" giống "nha khoa"), V3 nhận diện chính xác `ăn uống`.

### B. Các ca V3 nhầm lẫn (Cần lưu ý)

- `vé vào cổng đầm sen`, `vé công viên nước`: V3 xếp vào `mua sắm` hoặc `hóa đơn`, trong khi V2 xếp vào `giải trí`.
- `tra no the tin dung 4tr`: V3 xếp vào `mua sắm` (do dính cụm "thẻ tín dụng"), trong khi V2 xếp vào `khác`.
- `mung cuoi ban dai hoc 500k`: V3 xếp vào `giáo dục` (do dính "đại học"), V2 xếp vào `khác`.

---

## 4. Xác Minh Ngưỡng Tin Cậy (Confidence Calibration on Staging)

Đánh giá V3 trên 3 dải tin cậy thực tế:

| Phân vùng Tin cậy | Số lượng mẫu | Tỷ lệ bao phủ (Coverage) | Độ chính xác thực tế | Tỷ lệ lỗi (Error Rate) |
| :--- | :---: | :---: | :---: | :---: |
| **High Confidence ($\ge 0.50$)** | **161** | **64.4%** | **96.27%** | **3.73%** |
| **Medium Confidence ($0.35 - 0.50$)** | **37** | **14.8%** | **64.86%** | **35.14%** |
| **Low Confidence ($< 0.35$)** | **52** | **20.8%** | **34.62%** | **65.38%** |

### Kết luận quan trọng về UX:
1. Khi mô hình có độ tin cậy $\ge 0.50$ (chiếm ~64.4% giao dịch), độ chính xác thực tế đạt tới **96.27%** trên dữ liệu tiếng Việt đời sống.
2. Khi độ tin cậy $< 0.35$, mô hình thể hiện đúng sự phân vân (tỷ lệ lỗi 65.38%). Do đó, UI hiển thị chip mờ với chú thích `"AI chưa chắc chắn"`, giúp người dùng chủ động chọn lại danh mục và không bao giờ tự động gán nhãn sai.

---

## 5. Kết Luận Shadow Mode

1. **V3 chứng minh sự vượt trội rõ rệt** về độ bền vững trước tiếng lóng, viết tắt, từ mượn tiếng Anh và gõ sai.
2. **Không có bất kỳ sự cố runtime hoặc suy giảm hiệu năng nào** khi kích hoạt Shadow Mode.
3. **Phê duyệt tiếp tục duy trì V3 làm Primary** và sử dụng V2 làm Shadow/Fallback an toàn trong giai đoạn Staging.
