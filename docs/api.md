# Tài liệu API & Backend Services — Sổ Chi Tiêu

Tài liệu mô tả các API endpoints và dịch vụ xử lý backend của hệ thống.

---

## 1. Danh sách Endpoints

| Endpoint | Method | Mô tả | Authentication | Backend Service |
|---|---|---|---|---|
| `/api/chat` | `POST` | Financial Copilot: Trò chuyện và tư vấn tài chính | Bearer Token (Supabase) | `backend/src/services/ai-chat.service.ts` |
| `/api/ai/parse-transaction` | `POST` | NLP Transaction Parser: Nhận diện giao dịch từ văn bản tự nhiên | Bearer Token (Supabase) | `backend/src/services/ai-parser.service.ts` |
| `/api/receipt/parse` | `POST` | Receipt OCR: Phân tích hóa đơn / biên lai từ hình ảnh | Bearer Token (Supabase) | `backend/src/services/receipt-parser.service.ts` |
| `/api/user/role` | `GET` | Lấy role của tài khoản hiện tại (`user` hoặc `admin`) | Bearer Token (Supabase) | `backend/src/services/supabase-auth.service.ts` |
| `/api/admin/overview` | `GET` | Số liệu thống kê tổng quan (User, AI, Tổng hợp hệ thống) | Bearer Token (Admin) | `backend/src/services/admin-metrics.service.ts` |
| `/api/admin/users` | `GET` | Danh sách người dùng hệ thống (tìm kiếm, phân trang) | Bearer Token (Admin) | `backend/src/services/admin-users.service.ts` |
| `/api/admin/users/:id` | `GET` | Chi tiết tài khoản người dùng | Bearer Token (Admin) | `backend/src/services/admin-users.service.ts` |
| `/api/admin/users/:id/suspend` | `POST` | Khóa tài khoản người dùng (Audit logged) | Bearer Token (Admin) | `backend/src/services/admin-users.service.ts` |
| `/api/admin/users/:id/restore` | `POST` | Mở khóa tài khoản người dùng (Audit logged) | Bearer Token (Admin) | `backend/src/services/admin-users.service.ts` |
| `/api/admin/users/:id/send-password-reset` | `POST` | Gửi link đặt lại mật khẩu an toàn (Audit logged) | Bearer Token (Admin) | `backend/src/services/admin-users.service.ts` |
| `/api/admin/ai-usage` | `GET` | Thống kê số lượng, tỷ lệ lỗi, độ trễ AI theo thời gian | Bearer Token (Admin) | `backend/src/services/admin-ai.service.ts` |
| `/api/admin/audit` | `GET` | Danh sách nhật ký kiểm toán hành động Admin | Bearer Token (Admin) | `backend/src/services/admin-audit.service.ts` |
| `/api/admin/settings` | `GET` / `PUT` | Xem và cập nhật cấu hình hệ thống (Flags) | Bearer Token (Admin) | `backend/src/services/admin-settings.service.ts` |
| `/api/admin/notifications` | `POST` | Phát thông báo hệ thống toàn thể đến người dùng | Bearer Token (Admin) | `backend/src/services/admin-notifications.service.ts` |
| `/api/runtime-config` | `GET` | Cung cấp cấu hình Supabase URL/Key an toàn cho client | Public | Direct Handler |
| `/api/client-error` | `POST` | Thu thập log lỗi client-side để giám sát | Public | Direct Handler |

Ba endpoint AI xác minh access token trực tiếp với Supabase Auth; chỉ có chuỗi `Bearer` là chưa đủ. Body được giới hạn kích thước, ngữ cảnh hội thoại được cắt ngắn, và JSON do model trả về được kiểm tra kiểu/giới hạn trước khi gửi cho client. `GEMINI_API_KEY` chỉ tồn tại ở server/Worker và không được log.

---

## 2. Chi tiết Endpoints

### 1. AI Chatbot (`POST /api/chat`)
- **Headers**: `Authorization: Bearer <supabase_access_token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "message": "Tháng này tôi tiêu hết bao nhiêu rồi?",
    "history": [],
    "financialContext": {
      "totalBalance": 15000000,
      "monthlyIncome": 25000000,
      "monthlyExpense": 10000000,
      "wallets": [],
      "budgets": [],
      "savingsGoals": [],
      "transactions": []
    },
    "currentPage": "overview",
    "clientTime": "2026-08-17T21:00:00.000Z"
  }
  ```
- **Response**:
  ```json
  {
    "reply": "Tháng này bạn đã chi tiêu **10.000.000đ**..."
  }
  ```

---

### 2. AI Parse Transaction (`POST /api/ai/parse-transaction`)
- **Headers**: `Authorization: Bearer <supabase_access_token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "text": "Ăn trưa 50k bằng tiền mặt",
    "client_date": "2026-08-17",
    "client_time": "12:30",
    "timezone": "Asia/Ho_Chi_Minh"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "transaction_type": "expense",
      "amount": 50000,
      "currency": "VND",
      "category_id": "...",
      "category_name": "Ăn uống",
      "wallet_id": "...",
      "wallet_name": "Tiền mặt",
      "description": "Ăn trưa",
      "date": "2026-08-17",
      "time": "12:30",
      "confidence_notes": []
    }
  }
  ```

---

### 3. AI Receipt Parse (`POST /api/receipt/parse`)
- **Headers**: `Authorization: Bearer <supabase_access_token>`
- **Content-Type**: `multipart/form-data` hoặc `application/json` (hỗ trợ Base64 / Data URL)
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "document_type": "receipt",
      "is_receipt": true,
      "merchant": "Circle K",
      "merchant_address": "...",
      "transaction_type": "expense",
      "date": "2026-08-17",
      "time": "18:45",
      "currency": "VND",
      "total": 125000,
      "subtotal": 125000,
      "discount": null,
      "tax": null,
      "payment_method": "MoMo",
      "category": "Mua sắm",
      "description": "Mua hàng tại Circle K",
      "items": [
        { "name": "Bánh mì", "quantity": 1, "unit_price": 25000, "total_price": 25000 }
      ],
      "warnings": []
    }
  }
  ```

---

## 3. Nhóm Endpoint Quản Trị Hệ Thống (`/api/admin/*`)

Tất cả các API route thuộc `/api/admin/*` đều bắt buộc chạy qua cơ chế kiểm duyệt bảo mật đồng nhất `requireAdminUser`:
1. **Trích xuất & Xác thực Bearer Token**: Kiểm tra token người dùng qua `supabase.auth.getUser(token)`. Trả về `401 Unauthorized` nếu thiếu hoặc token không hợp lệ/hết hạn.
2. **Kiểm tra Quyền Admin (RBAC)**: Truy vấn vai trò chính thức trong bảng `public.user_roles` thông qua hàm RPC `is_admin()`. Trả về `403 Forbidden` nếu người dùng chỉ có role `user` hoặc không có quyền quản trị.
3. **Audit Trail**: Mọi thao tác quản trị gây thay đổi trạng thái người dùng hoặc hệ thống (`suspend`, `restore`, `send-password-reset`, `settings`, `notifications`) đều tự động ghi lại lịch sử vào `admin_audit_logs`.
4. **Bảo Mật Dữ Liệu Tài Chính**: Tuyệt đối không mở endpoint truy xuất ví tiền, giao dịch, số dư chi tiết của người dùng. Mọi số liệu trong `/api/admin/overview` đều là dữ liệu thống kê tổng hợp (anonymized/aggregated metrics).

| Endpoint | Method | Input Parameters / Body | Mô tả Phản Hồi |
|---|---|---|---|
| `/api/admin/overview` | `GET` | Không | Trả về tổng user, user hoạt động gần đây, AI requests, AI errors, và tổng số lượng ví/giao dịch/ngân sách toàn hệ thống |
| `/api/admin/users` | `GET` | Query: `query` (search email/name), `page`, `pageSize`, `role`, `status` | Danh sách người dùng phân trang, kèm `total` và `totalPages` |
| `/api/admin/users/:id` | `GET` | Route param: `id` | Chi tiết tài khoản (email, username, role, trạng thái khóa, ngày tạo, xác thực email) |
| `/api/admin/users/:id/suspend` | `POST` | Body: `{ "reason": "..." }` | Khóa tài khoản người dùng, vô hiệu hóa phiên đăng nhập |
| `/api/admin/users/:id/restore` | `POST` | Body: `{ "reason": "..." }` | Mở khóa tài khoản |
| `/api/admin/users/:id/send-password-reset` | `POST` | Không | Tạo liên kết khôi phục mật khẩu gửi đến email người dùng |
| `/api/admin/ai-usage` | `GET` | Query: `period` (`today`, `7d`, `30d`) | Thống kê số lượng gọi theo feature (Chat, Parser, OCR), độ trễ trung bình, lỗi |
| `/api/admin/audit` | `GET` | Query: `limit`, `offset`, `action` | Lịch sử thao tác của các Admin trên hệ thống |
| `/api/admin/settings` | `GET` / `PUT` | PUT Body: `{ "key": "value" }` | Đọc hoặc cập nhật các cờ tính năng (`ai_enabled`, `receipt_scan_enabled`, `maintenance_mode`) |
| `/api/admin/notifications` | `POST` | Body: `{ "title", "content", "target_audience" }` | Phát thông báo hệ thống đã được kiểm duyệt XSS đến người dùng |
