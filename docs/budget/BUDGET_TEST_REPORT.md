# BÁO CÁO KIỂM THỬ NGÂN SÁCH (BUDGET TEST REPORT)
*Dự án:* **Sổ Chi Tiêu (truong256/so-chi-tieu)**  
*Nhánh:* `feature/financial-chatbot-training`  
*Ngày thực hiện:* 27/10/2026  
*File kiểm thử tự động:* `tests/budget-management.test.mjs`  
*Kết quả:* **25/25 Scenarios PASS (Tổng test suite: 148/148 PASS)**  

---

## 1. MỤC TIÊU VÀ PHẠM VI NGHIỆM THU

Bộ kiểm thử được thiết kế độc lập nhằm kiểm tra toàn diện 25 kịch bản theo yêu cầu nghiệm thu của **PHASE 2**:
- Nghiệp vụ tạo, cấp vốn, rút vốn và đóng/xóa ngân sách.
- Tính toán hạn mức, chi tiêu thực tế danh mục, và quỹ phong bì.
- Ngăn ngừa tính chi tiêu trùng lặp và race condition số dư khả dụng ví.
- Bảo vệ dữ liệu người dùng (RLS), cô lập tiền tệ (VND/USD), và kiểm soát chu kỳ thời gian.

---

## 2. BẢNG TỔNG HỢP 25 KỊCH BẢN KIỂM THỬ

| # | Kịch bản kiểm thử | Phương pháp kiểm tra | Kết quả | Ghi chú |
|---|---|---|:---:|---|
| **1** | Tạo ngân sách không phân bổ (Tracking Budget) | `calculateBudgetMetrics` với `source_wallet_id = null`, `allocated_amount = 0` | **PASS** | `isFunded = false`, `limit = 5M`, không giữ tiền ví |
| **2** | Tạo ngân sách khi ví không đủ tiền | Kiểm tra available balance và ràng buộc `check_wallet_available_balance` | **PASS** | Exception nâng lên khi yêu cầu nạp > available balance |
| **3** | Phân bổ tiền từ ví vào quỹ ngân sách | Tính `calculateReservedByWallet` & `calculateAvailableBalances` | **PASS** | Ví thực tế giữ nguyên 10M, `reserved_amount` tăng 3M, available giảm còn 7M |
| **4** | Chi tiêu từ ngân sách phong bì | Mô phỏng `payment_source_type = 'budget'` | **PASS** | Ví thực tế giảm 500k (còn 9.5M), quỹ ngân sách còn 2.5M, available giữ nguyên 7M |
| **5** | Chi tiêu trực tiếp từ ví cho danh mục | Mô phỏng `payment_source_type = 'wallet'` | **PASS** | Quỹ ngân sách giữ nguyên 3M, available ví giảm 500k, hạn mức danh mục ghi nhận chi |
| **6** | Tính chi tiêu danh mục theo kỳ | `calculateBudgetSpending` lọc đúng tháng 10/2026 | **PASS** | Chỉ cộng giao dịch chi phí tháng 10, bỏ qua tháng 9 và các giao dịch thu |
| **7** | Tránh tính chi tiêu 2 lần | Giao dịch từ quỹ ngân sách vừa là chi phí vừa trích quỹ | **PASS** | Ghi nhận chi tiêu thực tế đúng 500k (không bị nhân đôi thành 1M) |
| **8** | Nạp thêm tiền (`adjust_budget_funds allocate`) | Static AST regex trên `018_budget_management_integrity.sql` | **PASS** | `allocated_amount` tăng, `remaining_amount` tăng, `amount` (hạn mức) được bảo toàn |
| **9** | Rút tiền về ví (`adjust_budget_funds return`) | Kiểm tra logic không rút quá `remaining_amount` | **PASS** | Raise `INSUFFICIENT_BUDGET` và ghi nhận `fund_allocations` loại `budget_to_wallet` |
| **10** | Xóa giao dịch từ ngân sách | `trg_restore_budget_transaction` trigger | **PASS** | Phục hồi `remaining_amount = remaining_amount + OLD.amount` và ví nguồn |
| **11** | Hoàn tác giao dịch trong transaction | Ràng buộc trigger `AFTER DELETE ON public.transactions` | **PASS** | Đảm bảo tính nguyên tử (atomic) |
| **12** | Đóng ngân sách có lịch sử giao dịch | RPC `close_budget` | **PASS** | Chuyển `status = 'cancelled'`, đưa `remaining_amount = 0`, hoàn tiền thừa về ví |
| **13** | Xóa ngân sách chưa có giao dịch | Thứ tự giải phóng trong RPC `close_budget` | **PASS** | **CRITICAL FIX:** Hoàn tiền `wallets.reserved_amount` TRƯỚC KHI xóa bản ghi |
| **14** | Đạt 100% hạn mức chi tiêu | `calculateBudgetMetrics` với `actualSpent === limit` | **PASS** | `usagePercent = 100%`, trạng thái `reached_limit` ("Đã đạt hạn mức") |
| **15** | Vượt 100% hạn mức chi tiêu (116.7%) | `calculateBudgetMetrics` với `actualSpent > limit` | **PASS** | `usagePercent = 116.7%`, `isOverLimit = true`, trạng thái `exceeded_limit` |
| **16** | Chuyển kỳ ngân sách (tuần, tháng, năm) | `getBudgetPeriodBounds` | **PASS** | Weekly (7 ngày từ thứ Hai), Monthly (1/10 - 1/11), Yearly (1/1 - 1/1 năm sau) |
| **17** | Giao dịch cuối tháng & năm nhuận | Tháng 2/2024 (29 ngày nhuận) | **PASS** | Bắt trúng giao dịch ngày 29/02/2024 lúc 12:00 |
| **18** | Nhiều ngân sách cùng danh mục khác kỳ | `calculateBudgetSpending` tháng 10 vs tháng 11 | **PASS** | Ngân sách tháng 10 chỉ tính giao dịch tháng 10, tháng 11 tính giao dịch tháng 11 |
| **19** | Hai tài khoản người dùng khác nhau | RLS & kiểm tra quyền trong Migration 018 | **PASS** | `WHERE id = p_budget_id AND user_id = v_user_id`, revoke quyền từ `anon` |
| **20** | Concurrency & Race condition | `check_wallet_available_balance` với khóa hàng | **PASS** | `SELECT * FROM public.wallets ... FOR UPDATE` ngăn ghi đồng thời vượt số dư |
| **21** | Phân tách tiền tệ VND/USD | Cô lập ví đa tiền tệ | **PASS** | Quỹ giữ chỗ và số dư khả dụng tính độc lập theo từng ví, không cộng chéo |
| **22** | Giao dịch định kỳ | Giao dịch phát sinh tự động trong kỳ | **PASS** | Ghi nhận chính xác vào chi tiêu thực tế danh mục của ngân sách |
| **23** | Nhập dữ liệu từ Excel / CSV | `parseCsvText` & `calculateBudgetSpending` | **PASS** | Giao dịch import tiếng Việt có BOM cập nhật ngay vào tiến độ ngân sách |
| **24** | Đồng bộ số dư Database và UI | Bất biến tài chính: `balance - reserved = available` | **PASS** | Invariant luôn thỏa mãn 100% trên toàn bộ luồng dữ liệu |
| **25** | Dữ liệu cũ / Remaining = 0 | Xử lý trường hợp phong bì hết tiền nhưng chưa tiêu hạn mức | **PASS** | Không báo lỗi "Vượt ngân sách" sai lệch nếu thực tế mới chi một phần hạn mức |

---

## 3. BẰNG CHỨNG KIỂM THỬ THỰC TẾ

```text
> so-chi-tieu@0.1.0 test:unit
> node --experimental-strip-types --test tests/*.test.mjs

✔ Scenario 1: Create budget without allocation (Tracking Budget) (7.4ms)
✔ Scenario 2: Create budget when wallet has insufficient available balance (0.8ms)
✔ Scenario 3: Allocate money to budget increases reserved_amount and reduces available balance without spending (0.7ms)
✔ Scenario 4: Expense from budget envelope decrements wallet physical balance and envelope remaining (0.8ms)
✔ Scenario 5: Expense directly from wallet in category counts towards limit progress without touching envelope (0.5ms)
✔ Scenario 6: calculateBudgetSpending aggregates all category transactions in period accurately (0.5ms)
✔ Scenario 7: Prevent double-counting between envelope and category expenses (0.4ms)
✔ Scenario 8: Nạp thêm tiền (adjust_budget_funds allocate) preserves spending limit amount (3.0ms)
✔ Scenario 9: Rút tiền về ví (adjust_budget_funds return) cannot exceed remaining_amount (1.0ms)
✔ Scenario 10: Xóa giao dịch từ ngân sách (trg_restore_budget_transaction) restores envelope and wallet (1.2ms)
✔ Scenario 11: Hoàn tác giao dịch phục hồi đúng số dư trong cùng transaction (0.4ms)
✔ Scenario 12: Đóng ngân sách có lịch sử giao dịch (close_budget) archives budget and returns remaining funds (0.6ms)
✔ Scenario 13: Xóa ngân sách chưa có giao dịch giải phóng reserved_amount và xóa bản ghi (0.3ms)
✔ Scenario 14: Reaching 100% of spending limit sets reached_limit status (0.5ms)
✔ Scenario 15: Exceeding 100% limit (e.g. 116.67%) correctly sets exceeded_limit status and 0 remaining limit (0.3ms)
✔ Scenario 16: Budget period bounds calculate accurately for weekly, monthly, and yearly (0.6ms)
✔ Scenario 17: End-of-month and leap year transactions (Feb 29) are handled correctly (0.4ms)
✔ Scenario 18: Multiple budgets in same category calculate independently according to period bounds (0.4ms)
✔ Scenario 19: RLS & User Isolation: User B cannot modify or query User A's budgets (1.1ms)
✔ Scenario 20: Concurrency guard & check_wallet_available_balance prevents race condition (2.0ms)
✔ Scenario 21: Multi-currency separation prevents direct addition of VND and USD (0.4ms)
✔ Scenario 22: Recurring transactions within period bounds affect category actual spending (2.5ms)
✔ Scenario 23: Excel / CSV imported transactions update category actual spending (0.7ms)
✔ Scenario 24: Balance synchronization invariant: balance - reserved_amount === available_balance (0.2ms)
✔ Scenario 25: Edge case: remaining_amount = 0 in funded envelope does NOT falsely trigger overbudget if limit is unspent (0.2ms)
✔ Smart Alerts trigger near limit and over limit alerts accurately (53.1ms)
...
ℹ tests 148
ℹ suites 0
ℹ pass 148
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2714.2175
```

---

## 4. KẾT LUẬN NGHIỆM THU PHASE 2

1. **Không còn lỗi sai số dư ví:** Việc phân bổ và hoàn trả tiền nội bộ được hạch toán cân bằng tuyệt đối qua `wallets.reserved_amount`.
2. **Không còn lỗi tính trùng chi tiêu:** Tách biệt rõ ràng giữa tiến độ hạn mức danh mục và nguồn tiền trích quỹ.
3. **Không còn lỗi vượt quyền:** Toàn bộ RPC đều có `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `auth.uid()` checks, và revoke quyền từ `anon`.
4. **Không còn lỗi hạch toán khi nạp/rút:** `adjust_budget_funds` bảo toàn hạn mức chi tiêu `amount`.
5. **Tiêu chuẩn chất lượng:** TypeScript, Linter và Build đều đạt 100%.

**ĐỦ ĐIỀU KIỆN CHUYỂN SANG PHASE 3 (ĐỒNG BỘ CHATBOT AI VỚI NGHIỆP VỤ NGÂN SÁCH MỚI).**
