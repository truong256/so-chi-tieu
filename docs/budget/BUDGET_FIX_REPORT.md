# BÁO CÁO SỬA ĐỔI NGHIỆP VỤ NGÂN SÁCH (BUDGET FIX REPORT)
*Dự án:* **Sổ Chi Tiêu (truong256/so-chi-tieu)**  
*Nhánh:* `feature/financial-chatbot-training`  
*Ngày thực hiện:* 27/10/2026  
*Tác giả:* Senior Fullstack Engineer & Financial Software Architect  

---

## 1. TỔNG QUAN

Trong Phase 1 và Phase 2 của kế hoạch chuẩn hóa tài chính, chúng tôi đã audit và khắc phục toàn diện các vấn đề cốt lõi trong phân hệ **Quản lý Ngân sách (Budget Management)**, bao gồm:
1. **Phân tách rạch ròi 4 khái niệm tài chính:**
   - **A. Hạn mức chi tiêu (Spending Limit - `amount`):** Kế hoạch trần chi tiêu tối đa trong kỳ.
   - **B. Tiền cấp vốn từ ví (Allocated Envelope Funds - `allocated_amount`):** Tiền thực tế trích và giữ chỗ (`wallets.reserved_amount`) từ ví nguồn.
   - **C. Chi tiêu thực tế (Actual Spending):** Tổng tất cả giao dịch chi phí thuộc danh mục trong kỳ (cả chi từ quỹ ngân sách và chi trực tiếp từ ví), không trùng lặp.
   - **D. Số dư quỹ ngân sách (Funded Remaining Balance - `remaining_amount`):** Phần tiền đã phân bổ còn lại chưa chi tiêu.
2. **Khắc phục lỗi giữ chặt tiền trong ví (`close_budget`):**
   - Đảm bảo khi xóa ngân sách (dù chưa có hay đã có giao dịch), số tiền còn lại trong quỹ ngân sách luôn được hoàn trả sòng phẳng về `wallets.reserved_amount` và ghi nhận lịch sử vào `fund_allocations`.
3. **Bảo toàn hạn mức chi tiêu khi nạp/rút tiền (`adjust_budget_funds`):**
   - Loại bỏ câu lệnh cập nhật đè `amount = allocated_amount + p_amount`, giữ nguyên kế hoạch chi tiêu của người dùng.
4. **Hỗ trợ ngân sách theo dõi hạn mức không cần cấp vốn ví (Tracking Budget):**
   - Cho phép người dùng tạo ngân sách kiểm soát chi tiêu cho danh mục mà không bắt buộc phải khoanh vùng giữ tiền trong ví.
5. **Cập nhật hạn mức ngân sách an toàn (`update_budget_limit`):**
   - Bổ sung RPC có phân quyền và bảo vệ bypass trigger `trg_guard_financial_totals`.
6. **Chuẩn hóa công thức tiến độ và nhãn trạng thái:**
   - Phân biệt rõ "Đã đạt hạn mức" (100%), "Vượt hạn mức" (>100%), "Sắp đạt hạn mức" (>= alert_percent), "Bình thường", và "Hết quỹ cấp vốn ví" (`remaining_amount = 0`). Không còn tình trạng báo "Vượt ngân sách" sai lệch.

---

## 2. CHI TIẾT FILE VÀ HÀM ĐÃ SỬA ĐỔI

### 2.1. Database Migration: `database/migrations/018_budget_management_integrity.sql`
- **`close_budget(p_budget_id uuid)`:**
  - Di chuyển lệnh giải phóng tiền giữ chỗ `wallets.reserved_amount` lên trước câu lệnh kiểm tra lịch sử giao dịch.
  - Ghi nhận `fund_allocations` loại `budget_to_wallet`.
  - Nếu ngân sách đã có giao dịch: chuyển `status = 'cancelled'`, đưa `remaining_amount = 0` để lưu vết lịch sử kiểm toán.
  - Nếu ngân sách chưa có giao dịch: xóa bản ghi an toàn.
- **`adjust_budget_funds(p_budget_id uuid, p_wallet_id uuid, p_amount numeric, p_direction text)`:**
  - Sửa logic nạp tiền (`allocate`): chỉ tăng `allocated_amount` và `remaining_amount`, giữ nguyên `amount` (Hạn mức).
  - Sửa logic rút tiền (`return`): kiểm tra không rút quá `remaining_amount`, giảm `allocated_amount` và `remaining_amount`, hoàn trả `wallets.reserved_amount`.
- **`create_budget_with_allocation(...)`:**
  - Thêm tham số `p_wallet_id DEFAULT NULL` và `p_initial_allocation DEFAULT NULL`.
  - Hỗ trợ tạo ngân sách chỉ đặt hạn mức theo dõi (không giữ tiền ví) hoặc cấp vốn phong bì (Envelope Budgeting).
- **`update_budget_limit(p_budget_id uuid, p_amount numeric)`:**
  - Tạo mới RPC bảo mật cho phép người dùng điều chỉnh hạn mức chi tiêu mà không vi phạm tính toàn vẹn dữ liệu.
- **Phân quyền và bảo mật (RLS & Grants):**
  - Revoke quyền thực thi từ `PUBLIC, anon` trên tất cả 4 hàm RPC tài chính.
  - Chỉ cấp quyền cho role `authenticated`, kiểm tra `user_id = auth.uid()` nghiêm ngặt.

### 2.2. Frontend Calculations: `frontend/utils/budget-calculations.ts` (Mới)
- **`getBudgetPeriodBounds(budget, referenceDate)`:**
  - Tính toán khoảng thời gian bắt đầu (`start`) và kết thúc (`end`) chính xác cho từng loại chu kỳ: `weekly` (7 ngày từ thứ Hai), `monthly` (ngày 1 đến ngày 1 tháng sau), `yearly` (ngày 1/1 đến ngày 1/1 năm sau).
  - Parse an toàn theo giờ địa phương tránh sai lệch múi giờ UTC+7.
- **`calculateBudgetSpending(budget, transactions, referenceDate)`:**
  - Tính tổng chi tiêu thực tế thuộc danh mục ngân sách trong kỳ xét duyệt.
  - Bao quát cả giao dịch trích quỹ ngân sách (`payment_source_type = 'budget'`) và giao dịch chi trực tiếp từ ví (`payment_source_type = 'wallet'`).
  - Đảm bảo tính đúng 1 lần cho mỗi khoản chi.
- **`calculateBudgetMetrics(budget, transactions, referenceDate)`:**
  - Cung cấp toàn bộ chỉ số tài chính: `limit`, `allocated`, `fundedRemaining`, `actualSpent`, `limitRemaining`, `usagePercent`, `isOverLimit`, `isNearLimit`, `isReachedLimit`, `isFunded`, `isOutOfFunds`, `statusVariant`, `statusLabelVi`, `statusLabelEn`.
- Re-export toàn diện qua `frontend/utils/finance-calculations.ts`.

### 2.3. Frontend Dashboard: `frontend/components/dashboard.tsx`
- **`saveBudget`:**
  - Hỗ trợ gọi `update_budget_limit` khi sửa hạn mức chi tiêu trên ngân sách có sẵn.
  - Hỗ trợ tạo ngân sách không cấp vốn ví khi người dùng không chọn ví nguồn.
- **Giao diện thẻ ngân sách (Overview & Planning):**
  - Hiển thị rõ ràng Hạn mức kỳ, Chi tiêu thực tế, Còn được chi theo hạn mức.
  - Đối với ngân sách có cấp vốn: hiển thị riêng Tiền cấp vốn từ ví và Quỹ ví còn lại.
  - Hiển thị nhãn trạng thái chuẩn hóa (`status-pill`).
- **Modal Ngân sách:**
  - Cho phép sửa hạn mức chi tiêu trên ngân sách hiện hữu.
  - Thêm lựa chọn: *"-- Không cấp vốn (chỉ đặt hạn mức theo dõi) --"*.

### 2.4. Styles: `frontend/styles/globals.css`
- Bổ sung định dạng CSS cho `.status-pill`:
  - `.status-pill.normal`: Xanh ngọc dịu nhẹ.
  - `.status-pill.near_limit`: Vàng cam cảnh báo.
  - `.status-pill.reached_limit`: Đỏ cam chạm trần.
  - `.status-pill.exceeded_limit`: Đỏ đậm có viền cảnh báo vượt hạn mức.
  - `.status-pill.out_of_funds`: Xám trung tính hết quỹ phong bì.
  - `.status-pill.closed`: Xám nhạt lưu trữ.

---

## 3. KẾT QUẢ KIỂM TRA TỰ ĐỘNG
- **TypeScript:** Không có lỗi kiểu dữ liệu (`npx tsc --noEmit` -> 0 errors).
- **Linter:** Hoàn toàn sạch (`node scripts/run-lint.mjs` -> 0 errors, 0 warnings).
- **Vite & Worker Build:** Thành công (`npm run build:worker` -> 0 errors).
- **Unit Test Suite:** **148/148 tests passed** (Bao gồm 25 scenario test mới tại `tests/budget-management.test.mjs`).
