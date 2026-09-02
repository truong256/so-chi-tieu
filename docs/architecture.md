# Kiến trúc Hệ thống — Sổ Chi Tiêu

Tài liệu mô tả kiến trúc tổng thể, mô hình phân lớp và luồng dữ liệu của ứng dụng **Sổ Chi Tiêu**.

---

## 1. Tổng quan Kiến trúc

Dự án được tổ chức theo kiến trúc phân tách rõ ràng thành **5 nhóm nền tảng**:

```text
so-chi-tieu/
├── frontend/     # Toàn bộ mã nguồn giao diện người dùng (UI components, features, types, utils, styles)
├── backend/      # Business logic xử lý phía server (AI services, parser logic, server-side types)
├── database/     # Cơ sở dữ liệu (SQL migrations, fixes, tài liệu schema)
├── config/       # Cấu hình ứng dụng (Supabase client, constants, environment config)
├── docs/         # Tài liệu hệ thống và hướng dẫn phát triển
├── app/          # Next.js App Router Adapter (Thin routing layer kết nối frontend & backend)
├── worker/       # Cloudflare Worker runtime entrypoint (Vinext / Edge deployment)
├── scripts/      # Automation & CI/CD deployment scripts
├── tests/        # Integration & automated tests
└── public/       # Static assets (favicons, images, icons)
```

---

## 2. Công nghệ sử dụng (Technology Stack)

| Lớp | Công nghệ | Vai trò |
|---|---|---|
| **Frontend Framework** | Next.js 16 (App Router) + React 19 | Giao diện tương tác, SSR/CSR, Responsive UI |
| **Styling** | TailwindCSS v4 + Vanilla CSS | Giao diện hiện đại, Dark/Light theme, Animations |
| **Backend / Edge Runtime** | Cloudflare Workers + Vinext (Vite 8) | Edge API handling, Serverless execution, Image optimization |
| **Database & Auth** | Supabase (PostgreSQL + Supabase Auth) | Lưu trữ dữ liệu tài chính, phân quyền RLS, quản lý phiên đăng nhập |
| **AI Copilot** | Google Gemini API (2.5-flash / Pro) | Xử lý ngôn ngữ tự nhiên (NLP), chatbot tài chính, trích xuất hóa đơn (OCR) |
| **Data Export** | OOXML writer + fflate | Xuất báo cáo tài chính ra định dạng Excel mà không cần parser bảng tính phía client |
| **Language & Tooling** | TypeScript 5.9 + ESLint 9 | Type-safety toàn diện từ frontend tới backend |

---

## 3. Luồng dữ liệu (Data Flow)

### A. Luồng tương tác người dùng thông thường
```text
User Browser
    ↓
frontend/components/ (Dashboard, Auth, Planning...)
    ↓
config/supabase.ts (Supabase Browser Client)
    ↓
Supabase Backend (PostgreSQL với Row-Level Security)
```

### B. Luồng xử lý AI & Phân tích Giao dịch (NLP / Receipt OCR)
```text
User Browser
    ↓
frontend/components/ & frontend/features/ai/
    ↓ fetch('/api/...') (Bearer Token)
app/api/* (Next.js Route Adapter) / worker/index.ts (Cloudflare Worker)
    ↓
backend/src/services/ (ai-chat.service, ai-parser.service, receipt-parser.service)
    ↓
Google Gemini API (Generative Language API)
    ↓ (Structured JSON Sanitization & Validation)
Trả về kết quả có cấu trúc cho Frontend
```

---

## 4. Nguyên tắc thiết kế (Design Principles)

1. **Separation of Concerns**: Phân tách triệt để UI (`frontend/`), Business Logic (`backend/`), Database (`database/`) và Config (`config/`).
2. **Thin Adapter Routing**: Thư mục `app/` chỉ đóng vai trò adapter định tuyến cho Next.js App Router, toàn bộ logic cốt lõi nằm trong `frontend/` và `backend/`.
3. **Type Safety**: Chia sẻ types rõ ràng qua `@frontend/types` và `@backend/src/types`.
4. **Resilience & Fallback**: Các dịch vụ AI hỗ trợ multi-model fallback (Gemini 2.5-flash → 1.5-flash → 2.0-flash → 3.6-flash → 2.5-pro) đảm bảo tính sẵn sàng cao khi gặp rate limit hoặc model deprecation.
