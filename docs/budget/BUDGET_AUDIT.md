# BÁO CÁO KIỂM TOÁN HỆ THỐNG NGÂN SÁCH (BUDGET AUDIT)
**Dự án:** Sổ Chi Tiêu (`truong256/so-chi-tieu`)  
**Tác giả:** Senior Fullstack Engineer & Financial Software Architect  
**Ngày:** 27/10/2026  
**Nhánh:** `feature/financial-chatbot-training`

---

## 1. Mục tiêu kiểm toán

Kiểm tra toàn diện hiện trạng hệ thống quản lý Ngân sách (Budget Management) từ Database Schema, Trigger, Stored Procedures (RPC), Data Layer đến Frontend Calculations, UI/UX, AI Financial Context và System RAG.

---

## 2. Các vấn đề cốt lõi phát hiện (Critical Findings)

### 2.1. Đánh đồng 4 khái niệm tài chính (Conflation of Financial Concepts)
Hệ thống hiện tại đang bị nhầm lẫn giữa:
1. **Hạn mức ngân sách (Spending Limit / `amount`):** Số tiền tối đa người dùng dự kiến được chi tiêu cho một danh mục trong một kỳ (tuần/tháng/năm).
2. **Tiền đã phân bổ (Allocated Funds / `allocated_amount`):** Số tiền thực tế được trích từ ví để giữ chỗ (Envelope Budgeting).
3. **Chi tiêu thực tế (Actual Spending):** Tổng tất cả giao dịch chi tiêu (`expense`) thuộc danh mục và kỳ thời gian tương ứng.
4. **Số dư quỹ ngân sách (Funded Remaining Balance / `remaining_amount`):** Tiền đã phân bổ nhưng chưa chi hoặc chưa rút về ví.

*Hậu quả:*
- Trong RPC `adjust_budget_funds` (Migration 006, dòng 336 & 355), mỗi khi nạp hoặc rút tiền phân bổ, hệ thống lại ghi đè `amount = allocated_amount + p_amount`. Điều này làm sai lệch hoặc xóa mất Hạn mức chi tiêu ban đầu của người dùng!
- Trong `dashboard.tsx` (dòng 2419), code tính `totalCapacity = Math.max(budget.amount, budget.allocated_amount)`, và coi việc "Rút tiền về ví" (`withdrawnAmount`) là một khoản "Đã sử dụng" (`totalUsed`), dẫn đến việc người dùng chỉ rút tiền về ví lại bị hiển thị là đã tiêu hết ngân sách!

### 2.2. Lỗi khóa tiền vĩnh viễn trong `close_budget` (Money Locking Bug)
Trong Migration 006 (dòng 565-581):
```sql
IF EXISTS (SELECT 1 FROM public.transactions WHERE budget_id = v_budget.id) THEN
  -- Đóng ngân sách, hoàn lại remaining_amount vào wallets.reserved_amount
  UPDATE public.wallets SET reserved_amount = GREATEST(0, reserved_amount - v_budget.remaining_amount) ...
  ...
  RETURN 'closed';
END IF;

DELETE FROM public.budgets WHERE id = v_budget.id;
RETURN 'deleted';
```
*Lỗ hổng nguy hiểm:*
Nếu một ngân sách **chưa có giao dịch** nhưng **đã được cấp vốn** (`remaining_amount > 0` và có `source_wallet_id`), khi gọi `close_budget`:
Điều kiện `IF EXISTS` trả về `FALSE` $\rightarrow$ Nhánh nhảy thẳng xuống lệnh `DELETE FROM public.budgets WHERE id = v_budget.id` mà **KHÔNG GIẢI PHÓNG** `wallets.reserved_amount`!
$\rightarrow$ Số tiền này bị khóa vĩnh viễn trong cột `reserved_amount` của ví, khiến số dư khả dụng (`available_balance`) của ví bị hụt mãi mãi!

### 2.3. Bỏ sót chi tiêu trực tiếp từ ví (Bypassing Direct Wallet Expenses)
- Khi người dùng chi tiêu trực tiếp từ ví (`payment_source_type = 'wallet'`) cho danh mục ngân sách (ví dụ: "Ăn uống"):
  - Giao dịch được lưu với `budget_id = NULL`.
  - Database trigger không cập nhật ngân sách.
  - Trên Frontend (`dashboard.tsx`), danh sách ngân sách chỉ hiển thị `budget.spent_amount` (vốn chỉ đếm các giao dịch qua phong bì `payment_source_type = 'budget'`).
  - Hậu quả: Người dùng chi 2.500.000đ tiền ăn uống từ thẻ ngân hàng, nhưng thẻ Ngân sách Ăn uống trên Dashboard vẫn báo "Đã chi: 0đ / 3.000.000đ (0%)"!

### 2.4. Báo "Vượt ngân sách" sai logic (False Overbudget Alerts)
Trong `dashboard.tsx` dòng 2424-2444:
```tsx
const isClosed = budget.remaining_amount <= 0 || budget.status === "completed" || budget.status === "cancelled";
const isOver = isClosed;
...
{isClosed && <em>{t("budgets.overbudget", undefined, language)} ({pct}%)</em>}
```
*Hậu quả:*
Bất cứ khi nào `remaining_amount <= 0` (kể cả khi người dùng chưa cấp vốn hoặc đã rút tiền về ví, hoặc ngân sách không dùng cơ chế cấp vốn), giao diện lập tức dán nhãn màu đỏ cảnh báo **"Vượt ngân sách" (Overbudget)**!
Đây là lỗi trải nghiệm nghiêm trọng gây hoang mang cho người dùng.

### 2.5. Không thể tạo Ngân sách thuần túy (Unallocated Budget)
Trong Migration 006, `create_budget_with_allocation` bắt buộc phải có `p_wallet_id` và thực hiện rút tiền giữ chỗ bằng đúng `p_amount`.
Nếu ví không đủ tiền, hệ thống ném lỗi `INSUFFICIENT_BALANCE:Ví không đủ số dư khả dụng`.
Người dùng không thể thiết lập hạn mức kế hoạch chi tiêu nếu trong ví hiện tại chưa có đủ tiền, hoặc nếu người dùng chỉ muốn đặt hạn mức theo dõi chi tiêu mà không muốn khóa tiền trong ví.

### 2.6. Chatbot AI & Financial Context không đồng bộ
Trong `backend/src/services/financial-context.service.ts`:
- Hàm tổng hợp dữ liệu cho AI chỉ lấy `b.spent_amount` từ bảng `budgets` mà không tính tổng chi tiêu thực tế của danh mục trong tháng.
- Do đó, khi người dùng hỏi: *"Tháng này tôi còn bao nhiêu hạn mức Ăn uống?"*, AI trả lời sai thực tế nếu người dùng thanh toán trực tiếp từ ví.
- Phân tích What-If (`sample500kImpacts`) lấy `b.remaining_amount` làm căn cứ vượt hạn mức thay vì căn cứ vào hạn mức thực tế.

---

## 3. Kế hoạch chuẩn hóa & khắc phục (Phase 1 Execution Plan)

1. **Migration mới (`018_budget_management_integrity.sql`):**
   - Sửa `close_budget`: Khi xóa ngân sách chưa có giao dịch, giải phóng toàn bộ `remaining_amount` khỏi `wallets.reserved_amount` và ghi nhận bản ghi `fund_allocations`.
   - Sửa `adjust_budget_funds`: Giữ nguyên hạn mức `amount`, chỉ cập nhật `allocated_amount` và `remaining_amount`.
   - Nâng cấp `create_budget_with_allocation`: Hỗ trợ tạo ngân sách không cấp vốn (`source_wallet_id = NULL`) hoặc cấp vốn một phần (`p_initial_allocation`).
   - Bổ sung RPC `update_budget_limit`: Cho phép chỉnh sửa hạn mức chi tiêu mà không làm ảnh hưởng tiền đang phân bổ.
2. **Frontend Calculations (`frontend/utils/budget-calculations.ts`):**
   - Xây dựng module tính toán ngân sách độc lập, chuẩn hóa:
     - Hạn mức (`limit`).
     - Tiền đã phân bổ (`allocated`).
     - Chi tiêu thực tế trong kỳ (`actualSpending`).
     - Quỹ cấp vốn còn lại (`fundedRemaining`).
     - Hạn mức chi tiêu còn lại (`limitRemaining = Math.max(0, limit - actualSpending)`).
     - Tiến độ hạn mức (`percent = actualSpending / limit * 100`).
     - Trạng thái chuẩn: `normal` (< 80%), `near_limit` (>= alert_percent), `reached_limit` (= 100%), `exceeded_limit` (> 100%), `out_of_funds` (hết quỹ cấp vốn), `closed`.
3. **Cập nhật Giao diện Dashboard & Modal Ngân sách:**
   - Phân biệt rõ ràng nhãn Hạn mức và Quỹ tiền cấp vốn.
   - Hiển thị đúng tỷ lệ chi tiêu thực tế (không bị chặn ở 100% khi chi vượt).
   - Xóa bỏ cảnh báo "Vượt ngân sách" giả khi `remaining_amount = 0`.
4. **Đồng bộ Smart Alerts & Financial Context Service:**
   - Đảm bảo AI và hệ thống cảnh báo đưa ra câu trả lời chính xác dựa trên cùng một công thức.
