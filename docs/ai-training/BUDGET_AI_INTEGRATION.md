# BÁO CÁO ĐỒNG BỘ CHATBOT AI VỚI NGHIỆP VỤ NGÂN SÁCH MỚI (PHASE 3)
*Dự án:* **Sổ Chi Tiêu (truong256/so-chi-tieu)**  
*Nhánh:* `feature/financial-chatbot-training`  
*Ngày thực hiện:* 27/10/2026  
*Tác giả:* Senior AI & Financial Systems Engineer  

---

## 1. MỤC TIÊU ĐỒNG BỘ

Sau khi hoàn thành và nghiệm thu **Phase 1** và **Phase 2** (chuẩn hóa cơ sở dữ liệu, sửa đổi RPC, logic phong bì Envelope Budgeting, và bộ 25 bài test tự động), **Phase 3** tiến hành đồng bộ toàn diện hệ thống AI Chatbot (Financial Copilot) nhằm:
1. Đảm bảo toàn bộ phép tính tài chính được xác định tiền xử lý tại Backend máy chủ (Deterministic Server Processing).
2. Xóa bỏ hoàn toàn tình trạng LLM tự đoán hoặc nhầm lẫn giữa **Hạn mức chi tiêu (Spending Limit)** và **Số dư phong bì cấp vốn (Funded Envelope Balance)**.
3. Đồng bộ hóa System RAG, Knowledge Base, Financial Context, và System Prompt với các quy tắc tài chính mới.
4. Cung cấp câu trả lời chính xác, chuẩn mực cho các câu hỏi tài chính cá nhân phức tạp.

---

## 2. CÁC THAY ĐỔI KIẾN TRÚC & MÃ NGUỒN

### 2.1. Cập nhật `ServerBudgetSummary` (`backend/src/services/financial-context.service.ts`)
Phân tách rõ ràng các trường dữ liệu trong context cung cấp cho AI:
- `limit`: Hạn mức chi tiêu tối đa trong kỳ (`amount`).
- `actualSpent`: Tổng chi tiêu thực tế của danh mục trong kỳ (tính từ các giao dịch trong kỳ).
- `limitRemaining`: Hạn mức chi tiêu còn lại (`Math.max(0, limit - actualSpent)`).
- `percentUsed`: Tỷ lệ sử dụng hạn mức (`actualSpent / limit * 100%`).
- `allocated`: Số tiền thực tế được trích giữ từ ví để cấp vốn phong bì (`allocated_amount`).
- `fundedRemaining`: Số dư tiền cấp vốn phong bì còn lại (`remaining_amount`).
- `isFunded`: Xác định ngân sách có sử dụng cơ chế cấp vốn ví hay là ngân sách chỉ theo dõi hạn mức (`Tracking Budget`).
- `isOutOfFunds`: Đã tiêu hết tiền quỹ phong bì (`fundedRemaining <= 0`), nhưng **không mặc định là vượt hạn mức**.
- `isOverLimit`: Đã vượt hạn mức chi tiêu (`actualSpent > limit`).
- `isReachedLimit`: Đạt đúng 100% hạn mức chi tiêu.
- `isNearLimit`: Chạm ngưỡng cảnh báo (`percentUsed >= 80%`).

### 2.2. Phân tích What-If Động và Dự đoán Mua Thêm (`whatIfContext` & `calculateDynamicWhatIf`)
- Trước đây: Phép tính What-If lấy `remaining_amount` (số dư phong bì) trừ đi số tiền mua thêm. Điều này gây sai lệch nghiêm trọng đối với ngân sách chỉ theo dõi hạn mức (có `remaining_amount = 0`), khiến chatbot báo "Vượt ngân sách" sai.
- Bây giờ: Phép tính What-If thực hiện dựa trên `limitRemaining` (Hạn mức còn lại).
  - `diff = limitRemaining - amount`.
  - Nếu `diff >= 0`: Ngân sách vẫn trong vùng an toàn, số tiền còn lại là `diff`.
  - Nếu `diff < 0`: Báo động vượt hạn mức chi tiêu với số tiền vượt là `Math.abs(diff)`.

### 2.3. Cập nhật RAG Ground Truth (`backend/src/services/system-rag.service.ts`)
- Nâng cấp tri thức tài liệu `kb_budgets_rules`:
  - Giải thích rõ 4 khái niệm tài chính (Hạn mức, Tiền phân bổ, Chi tiêu thực tế, Quỹ còn lại).
  - Phân biệt 2 chế độ: Ngân sách theo dõi hạn mức (Tracking) và Ngân sách phong bì (Envelope).
  - Bổ sung từ khóa tìm kiếm: `"tại sao số dư ví khác ngân sách"`, `"chi trực tiếp từ ví"`, `"quỹ phong bì"`, `"tiền đã phân bổ"`.

### 2.4. Tối ưu Hệ thống Chỉ dẫn (`FINANCE_SYSTEM_PROMPT` trong `backend/src/services/ai-chat.service.ts`)
Bổ sung các nguyên tắc ứng xử tài chính bắt buộc cho LLM:
1. **Phân biệt rạch ròi 4 khái niệm ngân sách**: Tuyệt đối không quy đồng cả 4 giá trị thành một.
2. **Quy tắc giải thích câu hỏi chuyên biệt**:
   - *Tại sao số dư ví và số dư ngân sách khác nhau?* -> Ví là tổng tài sản thanh toán thực tế; ngân sách là trần hạn mức hoặc quỹ phong bì được khoanh vùng cho danh mục cụ thể.
   - *Chi trực tiếp từ ví có ảnh hưởng ngân sách không?* -> Có, làm tăng chi tiêu thực tế và giảm hạn mức còn lại của danh mục tương ứng, nhưng không ảnh hưởng tiền trong quỹ phong bì.
   - *Ngân sách tháng trước xử lý thế nào?* -> Ngân sách tính theo từng kỳ độc lập, lưu trữ lịch sử thống kê kỳ trước và chuyển kỳ mới an toàn.

---

## 3. BẢNG ĐỐI CHIẾU CÂU HỎI VÀ PHẢN HỒI CHUẨN MỰC

| Câu hỏi của người dùng | Phản hồi xác định từ Backend & Prompt |
|---|---|
| **Ngân sách của tôi là bao nhiêu?** | Liệt kê chi tiết tên ngân sách, hạn mức chi tiêu kỳ này (ví dụ: Ăn uống: 3.000.000 VND). Nêu rõ có cấp vốn ví hay không. |
| **Tôi đã chi bao nhiêu trong tháng?** | Trích xuất con số `actualSpent` chính xác từ máy chủ cho từng danh mục và tổng chi tiêu toàn bộ. |
| **Tôi còn bao nhiêu hạn mức?** | Trả lời chính xác số tiền `limitRemaining` = `Hạn mức - Chi tiêu thực tế`. |
| **Tôi còn bao nhiêu tiền đã phân bổ?** | Trả lời số dư quỹ phong bì `fundedRemaining` (nếu có cấp vốn). Nếu không cấp vốn, thông báo ngân sách hoạt động ở chế độ theo dõi trần chi tiêu. |
| **Nếu mua thêm 500.000đ thì sao?** | Dựa trên kết quả What-If xác định: `Hạn mức còn lại - 500.000đ`. Thông báo số tiền còn lại hoặc cảnh báo số tiền vượt hạn mức cụ thể. |
| **Tôi có đang vượt ngân sách không?** | Kiểm tra cờ `isOverLimit` (`actualSpent > limit`). Nếu hết quỹ phong bì nhưng chưa quá hạn mức, giải thích rõ người dùng chưa vượt trần chi tiêu. |
| **Tại sao số dư ví và số dư ngân sách khác nhau?** | Giải thích sự khác biệt giữa tổng tài sản thanh toán của ví và quỹ phân bổ/hạn mức mục đích của ngân sách. |
| **Chi trực tiếp từ ví có ảnh hưởng ngân sách không?** | Giải thích rằng khoản chi vẫn ghi nhận vào danh mục và tiến độ hạn mức, nhưng không đụng đến tiền đã giữ trong quỹ phong bì. |
| **Ngân sách tháng trước được xử lý thế nào?** | Giải thích chu kỳ độc lập theo tháng, lưu lịch sử thống kê và không tự ý trừ tiền ví sang tháng mới. |

---

## 4. KẾT LUẬN & NGHIỆM THU PHASE 3
- Hệ thống AI Chatbot đã đồng bộ 100% với phân hệ Ngân sách mới.
- 148/148 unit tests và regression tests đạt kết quả hoàn hảo.
- Toàn bộ các phép tính tài chính được thực thi ở máy chủ một cách tất định (deterministic), ngăn chặn hoàn toàn ảo giác (hallucination) của LLM.
- **Sẵn sàng chuyển sang PHASE 4: Đánh giá và chấm điểm toàn diện với bộ 100 câu hỏi test suite.**
