# Hướng dẫn Cấu trúc Backend — Sổ Chi Tiêu

Tài liệu mô tả chi tiết tổ chức mã nguồn backend và dịch vụ xử lý máy chủ trong thư mục `backend/`.

---

## 1. Cấu trúc thư mục `backend/`

```text
backend/
└── src/
    ├── services/                     # Business Logic Services
    │   ├── ai-chat.service.ts        # Logic xử lý Financial Copilot, system prompt, context building
    │   ├── ai-parser.service.ts      # Logic phân tích ngôn ngữ tự nhiên thành giao dịch (NLP)
    │   └── receipt-parser.service.ts # Logic trích xuất dữ liệu hóa đơn đa phương thức (OCR)
    └── types/                        # Server-side & shared AI Types
        └── ai.types.ts               # ChatMessage, FinancialContext, Request/Result interfaces
```

---

## 2. Kiến trúc Thin Adapter

Các Route Handlers tại `app/api/**` và Cloudflare Worker tại `worker/index.ts` chỉ đóng vai trò **Thin Adapters** nhận HTTP Request và chuyển tiếp đến các **Services** trong `backend/src/services/`.

Mô hình này giúp:
- **Tái sử dụng 100% logic**: Cả Next.js Server và Cloudflare Worker đều dùng chung một bộ services.
- **Dễ dàng mở rộng**: Khi cần thêm kiểm tra validation hoặc đổi model AI, chỉ cần sửa tại 1 nơi trong `backend/src/services/`.
- **Dễ dàng viết unit test**: Các hàm service không phụ thuộc vào `NextRequest`/`NextResponse` mà nhận payload thuần túy.
