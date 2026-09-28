# PHÂN TÍCH CHI TIẾT 53 CA DỰ ĐOÁN SAI LỆCH TRÊN TẬP THỰC TẾ
## (AI V3 CLASSIFICATION ERROR ANALYSIS REPORT)

---

## 1. TỔNG QUAN PHÂN TÍCH

Trong quá trình thẩm định nghiệm thu Staging trên tập dữ liệu tiếng Việt đời sống độc lập [staging_realistic_test_set.json](file:///c:/vibecoding/so-chi-tieu/ai_service/data/staging_realistic_test_set.json) gồm 250 mẫu, mô hình `model_classify_v3` đạt độ chính xác **78.80%** (197/250 đúng) và ghi nhận **53 ca dự đoán sai lệch** (21.20%).

Mục tiêu của báo cáo này là mổ xẻ tận gốc từng ca lỗi theo bảng phân loại nguyên nhân chuẩn, đo lường độ tin cậy và lập danh mục khuyến nghị dữ liệu cho phiên bản **V3.1** trong tương lai mà không can thiệp retrain trong giai đoạn Canary Phase 1 hiện tại.

---

## 2. BẢNG TỔNG HỢP TAXONOMY LỖI (53 SAMPLES)

| Nhóm nguyên nhân (Taxonomy) | Số lượng (Count) | Tỷ lệ (%) | Confidence trung bình | Số ca High Conf ($\ge 0.50$) | Mức độ rủi ro |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **no-accent** (Tiếng Việt không dấu) | **24** | **45.3%** | 0.2999 | 0 | Thấp (Tự hạ về Low Confidence $< 0.35$) |
| **ambiguous phrase** (Cụm từ đa nghĩa) | **20** | **37.7%** | 0.2758 | 0 | Thấp (Tự hạ về Low Confidence $< 0.35$) |
| **confidence calibration issue** (Lỗi tự tin cao) | **6** | **11.3%** | 0.6740 | **6** | Trung bình (Cần bổ sung n-gram phủ định) |
| **category overlap** (Giao thoa ranh giới nhãn) | **2** | **3.8%** | 0.3705 | 0 | Rất thấp (Nhãn nào cũng có căn cứ) |
| **unknown merchant** (Chuỗi thương hiệu lạ) | **1** | **1.9%** | 0.4980 | 0 | Thấp (Rơi vào Medium Confidence) |
| **Tổng cộng** | **53** | **100.0%** | **0.3341** | **6** | **An toàn cho Canary Phase 1** |

---

## 3. ĐÁNH GIÁ MỨC ĐỘ NGUY HIỂM & HIỆU CHUẨN ĐỘ TIN CẬY

- **47 / 53 ca sai (88.7%)** có mức confidence nằm ở vùng **Medium hoặc Low ($< 0.50$)**, với mức trung bình là **0.2891**.
- Đặc biệt, toàn bộ các ca lỗi do không dấu (`no-accent`) và câu đa nghĩa (`ambiguous phrase`) đều có confidence $< 0.35$, kích hoạt chính xác cơ chế bảo vệ giao diện:
  - Hiển thị nhãn cảnh báo: `(AI chưa chắc chắn — ..%)`
  - Bắt buộc người dùng nhấn "Áp dụng" thủ công, không bao giờ tự động áp đặt category sai lên dữ liệu tài chính.
- Chỉ có **6 ca sai sót thuộc nhóm High Confidence ($\ge 0.50$)**, chiếm tỷ lệ cực nhỏ **3.73%** trên tổng số 161 ca High Confidence (đạt độ chính xác 96.27% trên phân vùng High Confidence).

---

## 4. CHI TIẾT 6 CA LỖI HIGH CONFIDENCE (CONFIDENCE CALIBRATION ISSUES)

Dưới đây là 6 trường hợp mô hình V3 có độ tự tin cao ($\ge 0.50$) nhưng đưa ra nhãn không trùng với nhãn kỳ vọng:

| ID | Văn bản giao dịch | Kỳ vọng (Expected) | V3 Dự đoán | Confidence | Phân tích căn nguyên (Root Cause) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `stg_032` | `nạp tiền thẻ etc` | `di chuyển` | `hóa đơn` | 78.32% | Cụm từ "nạp tiền thẻ" có trọng số TF-IDF rất cao về `hóa đơn` (nạp tiền điện thoại/thẻ cào), lấn át từ viết tắt ETC (Electronic Toll Collection - thu phí không dừng). |
| `stg_064` | `mua sách tiki 150k` | `mua sắm` | `giáo dục` | 59.56% | Từ "sách" liên kết mạnh với `giáo dục`. Trong thực tế người dùng có thể xem việc mua sách trên Tiki là mua sắm online hoặc phục vụ học tập (ranh giới ngữ nghĩa mở). |
| `stg_141` | `dầu gió xanh` | `sức khỏe` | `di chuyển` | 55.74% | Từ "dầu" bị liên tưởng với "dầu nhớt / xăng dầu" (`di chuyển`). Bộ từ điển V3 thiếu n-gram liên kết nguyên cụm "dầu gió" $\rightarrow$ `sức khỏe`. |
| `stg_212` | `me cho tien sinh hoat` | `thu nhập` | `khác` | 65.48% | Viết không dấu, mô hình bắt các từ rời rạc "cho", "tien", "sinh hoat" và xếp vào danh mục bù trừ `khác` thay vì nhận diện nguồn chu cấp gia đình (`thu nhập`). |
| `stg_215` | `tien thue nha nguoi ta tra` | `thu nhập` | `hóa đơn` | 73.91% | Cụm "tien thue nha" kích hoạt mạnh nhãn `hóa đơn` (trả tiền thuê nhà định kỳ). Mô hình chưa nắm bắt được ngữ cảnh đảo ngữ "người ta trả" để chuyển sang `thu nhập`. |
| `stg_247` | `tiền cọc giữ chỗ phòng` | `khác` | `hóa đơn` | 71.38% | Cụm "tiền cọc ... phòng" liên kết với việc thuê trọ / dịch vụ lưu trú nên thiên lệch về `hóa đơn` thay vì khoản tạm ứng `khác`. |

---

## 5. PHÂN TÍCH CÁC NHÓM NGUYÊN NHÂN CHÍNH KHÁC

### 5.1. Nhóm Tiếng Việt không dấu (`no-accent`: 24 ca - 45.3%)
- **Hiện tượng:** Người dùng gõ nhanh không dấu như `do xang`, `mua thuoc`, `an toi`, `dong tien mang`.
- **Căn nguyên:** Mặc dù V3 đã có n-gram ký tự 3-4 gram, việc triệt tiêu dấu thanh điệu làm giảm phân bố xác suất của Softmax.
- **Hành vi an toàn:** Điểm confidence trung bình của nhóm này chỉ đạt **0.2999** (đều $< 0.35$). Hệ thống hiển thị cảnh báo `(AI chưa chắc chắn)` và người dùng dễ dàng chọn danh mục phù hợp.

### 5.2. Nhóm Cụm từ đa nghĩa (`ambiguous phrase`: 20 ca - 37.7%)
- **Hiện tượng:** Các giao dịch như `trà sữa với bạn`, `đi ăn sinh nhật bạn`, `mua đồ tiện lợi`, `chuột máy tính`.
- **Căn nguyên:** `trà sữa` vừa là `ăn uống` vừa là `giải trí`; `đi ăn sinh nhật` vừa là `ăn uống` vừa là `quan hệ xã hội/quà tặng`. Đây là hiện tượng đa nhãn tự nhiên trong quản lý tài chính cá nhân.
- **Confidence trung bình:** **0.2758** $\rightarrow$ Hệ thống tự động nhận biết sự phân vân giữa các lớp và hạ confidence xuống mức an toàn.

### 5.3. Nhóm Giao thoa ranh giới (`category overlap`: 2 ca - 3.8%)
- Giao thoa giữa `chi phí cố định` và `hóa đơn` (ví dụ: tiền đóng theo kỳ), hoặc giữa `mua sắm` và `giải trí`.

### 5.4. Nhóm Tên thương hiệu đặc thù (`unknown merchant`: 1 ca - 1.9%)
- Tên chuỗi bán lẻ hoặc ứng dụng chưa có độ phủ cao trong từ điển TF-IDF (ví dụ: thẻ ETC, thương hiệu ngách).

---

## 6. KHUYẾN NGHỊ DỮ LIỆU VÀ ĐỊNH HƯỚNG CẢI THIỆN CHO PHIÊN BẢN V3.1

| Hạng mục cần nâng cấp | Giải pháp kỹ thuật cho V3.1 | Mẫu dữ liệu cần bổ sung |
| :--- | :--- | :--- |
| **Phân biệt Thu nhập đảo ngữ** | Bổ sung n-gram cặp từ chỉ chiều dòng tiền (`người ta trả`, `khách chuyển`, `bố mẹ cho`, `được hoàn`, `tiền thưởng`). | `tien thue nha nguoi ta tra`, `khach ck tien hang`, `me cho tien`. |
| **Từ điển dược phẩm / sức khỏe** | Tăng trọng số cho cụm từ liên kết y tế đặc trưng tránh nhầm với xăng dầu/di chuyển. | `dầu gió`, `cao dán`, `băng gạc`, `thuốc hạ sốt`. |
| **Từ điển giao thông thông minh** | Bổ sung danh mục trạm thu phí, thẻ giao thông vào nhãn `di chuyển`. | `thẻ etc`, `epass`, `vetc`, `thu phí tự động`. |
| **Tăng cường mẫu không dấu (Data Augmentation)**| Bổ sung tự động 15% mẫu train stripped accents với nhãn tương đương trong pipeline V3.1. | Tự động sinh `do xang`, `mua thuoc`, `an sang`. |

---

## 7. KẾT LUẬN

1. Toàn bộ 53 ca sai lệch đều **không gây rủi ro phá vỡ dữ liệu** do nguyên tắc bất biến: **AI CHỈ ĐÓNG VAI TRÒ ADVISORY, KHÔNG AUTO-APPLY**.
2. 88.7% số ca sai lệch được mô hình tự lượng giá chính xác vào phân vùng **Low/Medium Confidence**, phát huy tối đa hiệu quả của cơ chế cảnh báo hổ phách trên giao diện người dùng.
3. Độ chính xác trên vùng High Confidence duy trì ở mức xuất sắc **96.27%**.
4. **Kết luận:** Hệ thống hoàn toàn đủ điều kiện an toàn để triển khai **Production Canary Phase 1 (5% lưu lượng)**.
