# Tài liệu Cơ sở dữ liệu — Sổ Chi Tiêu

Dự án sử dụng **Supabase (PostgreSQL)** với cơ chế bảo mật cấp dòng (**Row Level Security - RLS**).

---

## 1. Cấu trúc thư mục `database/`

```text
database/
├── migrations/                                      # Thứ tự migrations chuẩn
│   ├── 001_initial_schema.sql                      # Schema gốc (profiles, wallets, categories, transactions, transfers)
│   ├── 002_insufficient_balance_check.sql          # Ràng buộc số dư không âm
│   ├── 003_recurring_transactions_v2.sql           # Giao dịch định kỳ v2 & occurrences tracking
│   ├── 004_reserved_money.sql                      # Cơ chế khóa/dự trữ tiền cho ngân sách & mục tiêu
│   ├── 005_true_balances_rpc.sql                   # Hàm RPC tính số dư khả dụng thực tế
│   └── 006_finance_integrity_and_security.sql      # RPC nguyên tử, ownership guards và hardening
├── fixes/                                          # Các script vá dữ liệu sản xuất
│   └── production_fix.sql                          # Hotfix dữ liệu production
└── README.md                                       # Hướng dẫn thao tác nhanh
```

---

## 2. Danh mục Bảng dữ liệu chính

| Bảng | Mô tả | Khóa chính & Quan hệ |
|---|---|---|
| `profiles` | Hồ sơ người dùng, tùy chọn tiền tệ, ngôn ngữ | `id` (FK `auth.users`) |
| `wallets` | Ví/tài khoản (Tiền mặt, Ngân hàng, Thẻ tín dụng, Ví điện tử) | `id` (UUID), `user_id` |
| `categories` | Danh mục thu/chi (Ăn uống, Di chuyển, Lương, Thưởng...) | `id` (UUID), `user_id` |
| `transactions` | Bản ghi giao dịch thu hoặc chi | `id` (UUID), `wallet_id`, `category_id`, `user_id` |
| `transfers` | Bản ghi chuyển khoản giữa 2 ví | `id` (UUID), `from_wallet_id`, `to_wallet_id`, `user_id` |
| `budgets` | Ngân sách chi tiêu theo kỳ (tháng/tuần/năm) | `id` (UUID), `category_id`, `user_id` |
| `savings_goals` | Mục tiêu tích lũy & tiết kiệm tài chính | `id` (UUID), `user_id` |
| `recurring_transactions` | Cấu hình lặp lại giao dịch định kỳ | `id` (UUID), `wallet_id`, `category_id`, `user_id` |
| `recurring_occurrences` | Lịch sử các lần thực thi giao dịch định kỳ | `id` (UUID), `recurring_id`, `user_id` |
| `fund_allocations` | Lịch sử phân bổ quỹ vào ngân sách / mục tiêu | `id` (UUID), `user_id` |

---

## 3. Bảo mật & Phân quyền (Row Level Security)

Tất cả bảng đều được bật **RLS**. Mỗi người dùng chỉ có quyền đọc (`SELECT`), thêm (`INSERT`), sửa (`UPDATE`), xóa (`DELETE`) trên các bản ghi có `user_id = auth.uid()`.

Các trường tổng hợp tài chính (`reserved_amount`, số dư ngân sách/mục tiêu) không được sửa trực tiếp. Ứng dụng dùng RPC `create_*_with_allocation`, `adjust_*_funds` và `record_recurring_transaction`; mỗi nghiệp vụ khóa bản ghi liên quan và commit/rollback trong một transaction PostgreSQL.

Mọi hàm `SECURITY DEFINER` đặt `search_path` cố định, kiểm tra `auth.uid()` và chỉ cấp `EXECUTE` cho `authenticated`. Không có RPC công khai đổi username thành email và không có trigger tự xác nhận địa chỉ email.
