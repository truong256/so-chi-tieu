# Database — Sổ Chi Tiêu

Dự án sử dụng **Supabase** (PostgreSQL) làm database chính.

> **Lưu ý**: Các file SQL trong thư mục này cần được chạy thủ công trên Supabase Dashboard (SQL Editor) hoặc qua Supabase CLI theo thứ tự đánh số.

---

## Cấu trúc thư mục

```
database/
├── migrations/        # SQL schema migrations theo thứ tự
│   ├── 001_initial_schema.sql
│   ├── 002_insufficient_balance_check.sql
│   ├── 003_recurring_transactions_v2.sql
│   ├── 004_reserved_money.sql
│   └── 005_true_balances_rpc.sql
│
└── fixes/             # SQL fixes áp dụng trên production
    └── production_fix.sql
```

---

## Hướng dẫn áp dụng migrations

### Lần đầu cài đặt (new project)

Chạy theo thứ tự trên Supabase SQL Editor:

1. `001_initial_schema.sql` — Schema ban đầu: bảng profiles, wallets, categories, transactions, transfers
2. `002_insufficient_balance_check.sql` — Thêm kiểm tra số dư không đủ
3. `003_recurring_transactions_v2.sql` — Giao dịch định kỳ v2 (status, occurrences)
4. `004_reserved_money.sql` — Tiền dự trữ cho budgets và savings goals
5. `005_true_balances_rpc.sql` — RPC functions tính số dư thực tế

### Fixes

- `fixes/production_fix.sql` — Sửa lỗi dữ liệu trên production (chỉ chạy khi cần thiết)

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
- Cấu hình Email Templates (tùy chọn)
- Cấu hình URL redirect cho Password Recovery
