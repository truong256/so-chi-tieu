# Hướng dẫn Cấu trúc Backend — Sổ Chi Tiêu

Tài liệu mô tả chi tiết tổ chức mã nguồn backend và dịch vụ xử lý máy chủ trong thư mục `backend/`.

---

## 1. Cấu trúc thư mục `backend/`

```text
backend/
└── src/
    ├── services/                         # Business Logic Services
    │   ├── ai-chat.service.ts            # Logic xử lý Financial Copilot, system prompt, context building
    │   ├── ai-parser.service.ts          # Logic phân tích ngôn ngữ tự nhiên thành giao dịch (NLP)
    │   ├── receipt-parser.service.ts     # Logic trích xuất dữ liệu hóa đơn đa phương thức (OCR)
    │   ├── supabase-auth.service.ts      # Xác thực Bearer Token phía máy chủ
    │   ├── admin-auth.service.ts         # Guard phân quyền Admin, server-only Supabase client
    │   ├── admin-users.service.ts        # Quản lý tài khoản: danh sách, tạm khóa, mở khóa, reset password
    │   ├── admin-metrics.service.ts      # Tính toán số liệu tổng quan hệ thống ẩn danh
    │   ├── admin-ai.service.ts           # Ghi nhận và thống kê đo lường AI telemetry
    │   ├── admin-settings.service.ts     # Quản lý cờ tính năng Feature Flags và bảo vệ secrets
    │   ├── admin-audit.service.ts        # Ghi nhận nhật ký kiểm toán hành động quản trị
    │   └── admin-notifications.service.ts # Phát thông báo hệ thống và lọc mã HTML độc hại
    └── types/                            # Server-side & shared AI Types
        └── ai.types.ts                   # ChatMessage, FinancialContext, Request/Result interfaces
```

---

## 2. Kiến trúc Thin Adapter

Các Route Handlers tại `app/api/**` và Cloudflare Worker tại `worker/index.ts` chỉ đóng vai trò **Thin Adapters** nhận HTTP Request và chuyển tiếp đến các **Services** trong `backend/src/services/`.

Mô hình này giúp:
- **Tái sử dụng 100% logic**: Cả Next.js Server và Cloudflare Worker đều dùng chung một bộ services.
- **Dễ dàng mở rộng**: Khi cần thêm kiểm tra validation hoặc đổi model AI, chỉ cần sửa tại 1 nơi trong `backend/src/services/`.
- **Dễ dàng viết unit test**: Các hàm service không phụ thuộc vào `NextRequest`/`NextResponse` mà nhận payload thuần túy.
