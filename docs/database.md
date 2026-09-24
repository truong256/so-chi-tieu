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
│   ├── 006_finance_integrity_and_security.sql      # RPC nguyên tử, ownership guards và hardening
│   ├── 007_query_performance_indexes.sql           # Index theo access pattern của dashboard
│   ├── 008_transactions_transfers_integrity_and_indexes.sql # Ràng buộc xóa và index transactions/transfers
│   ├── 009_admin_rbac.sql                           # Phân quyền RBAC, bảng user_roles, chống tự leo quyền
│   ├── 010_admin_audit_and_ai_usage.sql             # Bảng ai_usage_logs và admin_audit_logs bất biến
│   └── 011_admin_system_settings.sql                # Bảng cấu hình system_settings & trigger chặn khóa bí mật
├── fixes/                                          # Các script vá dữ liệu sản xuất
│   └── production_fix.sql                          # Hotfix dữ liệu production
└── README.md                                       # Hướng dẫn thao tác nhanh
```

---

## 2. Danh mục Bảng dữ liệu chính

### A. Dữ liệu Tài chính Người dùng (User Domain)

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
| `notifications` | Thông báo ngân sách, mục tiêu và thông báo hệ thống | `id` (UUID), `user_id` |

### B. Dữ liệu Quản trị Hệ thống (Admin & Governance Domain)

| Bảng | Mô tả | Khóa chính & RLS |
|---|---|---|
| `user_roles` | Bảng phân quyền người dùng (`user`, `admin`). Chống tự leo quyền | `id` (UUID), `user_id` (Unique FK `auth.users`). User chỉ được `SELECT` role của chính mình. Cấm `INSERT`/`UPDATE`/`DELETE` từ client |
| `ai_usage_logs` | Nhật ký đo lường sử dụng AI (không lưu nội dung chat hay ảnh hóa đơn) | `id` (UUID), `user_id`, `feature`, `model`, `latency_ms`. Chỉ Admin được `SELECT` |
| `admin_audit_logs` | Nhật ký kiểm toán hành động quản trị bất biến (suspend, restore, reset password...) | `id` (UUID), `admin_id`, `action`, `target_type`. Chỉ Admin được `SELECT`, cấm `UPDATE`/`DELETE` |
| `system_settings` | Bảng cờ tính năng hệ thống (`ai_enabled`, `maintenance_mode`...) | `key` (Text PK), `value` (JSONB). Mọi người dùng được đọc; chỉ Admin được ghi. Trigger chặn lưu secrets |

---

## 3. Bảo mật & Phân quyền (Row Level Security & RBAC)

1. **User Row Level Security (RLS)**:
   - Tất cả bảng tài chính đều được bật **RLS**. Mỗi người dùng chỉ có quyền đọc (`SELECT`), thêm (`INSERT`), sửa (`UPDATE`), xóa (`DELETE`) trên các bản ghi có `user_id = auth.uid()`.
   - Quản trị viên (Admin) không có chính sách bypass RLS để đọc trộm tài chính cá nhân. Giao diện Admin chỉ sử dụng các câu truy vấn aggregate ẩn danh.

2. **Chống Tự Leo Quyền (Anti-Self-Promotion)**:
   - Bảng `user_roles` chỉ cấp quyền `SELECT` cho tài khoản sở hữu (`auth.uid() = user_id`).
   - Không có policy `INSERT`, `UPDATE`, hay `DELETE` nào được cấp cho vai trò `anon` hay `authenticated`.
   - Trigger `handle_new_user()` mặc định chỉ gán vai trò `'user'`. Việc phong quyền Admin chỉ được thực hiện bởi hạ tầng backend thông qua Service Role hoặc thao tác SQL trực tiếp.

3. **Bảo vệ Cấu hình & Hàm Thực thi**:
   - Mọi hàm `SECURITY DEFINER` đặt `search_path = public, pg_temp` cố định, kiểm tra quyền gọi và chỉ cấp `EXECUTE` cho `authenticated`.
   - Trigger `trg_protect_system_settings` chủ động ném lỗi nếu phát hiện nỗ lực lưu khóa bảo mật hoặc mật khẩu vào bảng `system_settings`.
