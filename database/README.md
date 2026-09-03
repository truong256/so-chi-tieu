# Database — Sổ Chi Tiêu

Dự án sử dụng **Supabase** (PostgreSQL) làm database chính.

> **Lưu ý**: Các file SQL trong thư mục này cần được chạy thủ công trên Supabase Dashboard (SQL Editor) hoặc qua Supabase CLI theo thứ tự đánh số.

---

## Cấu trúc thư mục

```
database/
├── migrations/        # SQL schema migrations theo thứ tự
│   ├── 000_base_schema.sql
│   ├── 001_initial_schema.sql
│   ├── 002_insufficient_balance_check.sql
│   ├── 003_recurring_transactions_v2.sql
│   ├── 004_reserved_money.sql
│   ├── 005_true_balances_rpc.sql
│   ├── 006_finance_integrity_and_security.sql
│   └── 007_query_performance_indexes.sql
│
└── fixes/             # SQL fixes áp dụng trên production
    └── production_fix.sql
```

---

## Hướng dẫn áp dụng migrations

### Lần đầu cài đặt (new project)

Chạy theo thứ tự trên Supabase SQL Editor:

1. `000_base_schema.sql` — Tạo các bảng lõi cho project mới
2. `001_initial_schema.sql` — RLS, index, notifications và Storage
3. `002_insufficient_balance_check.sql` — Kiểm tra số dư
4. `003_recurring_transactions_v2.sql` — Giao dịch định kỳ v2
5. `004_reserved_money.sql` — Tiền dự trữ và lịch sử phân bổ
6. `005_true_balances_rpc.sql` — RPC tính số dư thực tế
7. `006_finance_integrity_and_security.sql` — Xác thực ownership, RPC nguyên tử, khóa số tổng hợp và vô hiệu hóa email enumeration/auto-confirm
8. `007_query_performance_indexes.sql` — Index cho các truy vấn dashboard theo người dùng, thời gian và loại dữ liệu

### Fixes

- `fixes/production_fix.sql` — Script tương thích cho hệ thống cũ. Ưu tiên chuỗi migration `000`–`007`; luôn sao lưu và đọc script trước khi chạy trên production.

---

## Database Schema (tóm tắt)

| Bảng | Mô tả |
|------|-------|
| `profiles` | Thông tin người dùng (tên, tiền tệ, ngôn ngữ) |
| `wallets` | Ví/tài khoản (tiền mặt, ngân hàng, ví điện tử) |
| `categories` | Danh mục thu/chi |
| `transactions` | Giao dịch thu/chi |
| `transfers` | Chuyển tiền giữa các ví |
| `budgets` | Ngân sách theo danh mục/kỳ |
| `savings_goals` | Mục tiêu tiết kiệm |
| `recurring_transactions` | Cài đặt giao dịch định kỳ |
| `recurring_occurrences` | Lịch sử xử lý giao dịch định kỳ |
| `fund_allocations` | Lịch sử phân bổ tiền vào ngân sách/mục tiêu |

---

## Supabase Auth

Authentication do Supabase Auth quản lý (email + password). Không cần migration thủ công.

Cấu hình cần thiết trong Supabase Dashboard:
- Bật Email/Password Auth
- Giữ bật xác minh email và secure email change
- Cấu hình Email Templates/SMTP riêng khi cần
- Cấu hình URL redirect cho Password Recovery
