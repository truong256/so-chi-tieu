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
| **AI Copilot** | Google Gemini API (Flash model fallback) | Xử lý ngôn ngữ tự nhiên (NLP), chatbot tài chính, trích xuất hóa đơn (OCR) |
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

---

## 4. Mô hình Phân quyền Đa Tác nhân (Actor & RBAC Architecture)

Hệ thống hỗ trợ 2 Actor độc lập với vai trò và không gian hoạt động tách biệt:

1. **User (Người dùng cá nhân)**:
   - Quản lý tài chính cá nhân: ví, giao dịch, ngân sách, mục tiêu tiết kiệm, giao dịch định kỳ.
   - Sử dụng các tính năng thông minh: Trợ lý AI hội thoại, phân tích câu nói tự nhiên, quét hóa đơn OCR.
   - Được bảo vệ bởi Row Level Security (RLS): chỉ truy cập và thao tác trên dữ liệu thuộc sở hữu của chính mình (`auth.uid() = user_id`).

2. **Admin (Quản trị viên hệ thống)**:
   - Theo dõi tổng quan quy mô hệ thống, số lượng tài khoản, tình trạng dịch vụ.
   - Quản lý người dùng: tra cứu, tạm khóa (suspend), mở khóa (restore), gửi liên kết đặt lại mật khẩu.
   - Giám sát AI: đo lường lượng request, tỷ lệ thành công, mã lỗi và độ trễ phản hồi.
   - Quản trị cấu hình: bật/tắt cờ tính năng (Feature Flags).
   - Truy vết kiểm toán (Audit Trail): ghi nhận và tra cứu toàn bộ các thao tác quản trị.
   - **Quyền riêng tư**: Quản trị viên chỉ truy cập số liệu tổng hợp (aggregate), tuyệt đối không được cấp quyền đọc dữ liệu tài chính chi tiết của từng cá nhân.

### Sơ đồ Luồng Phân quyền (Authentication & Role Routing)

```text
               Supabase Authentication
                         │
                         ▼
                   Role Routing
                  (public.user_roles)
                   ┌─────┴─────┐
                   │           │
           role = 'user'   role = 'admin'
                   │           │
                   ▼           ▼
             User Dashboard  Admin App
                   │           │
                   ▼           ▼
              User-scoped   Guarded Admin APIs
                 RLS        (/api/admin/*)
                               │
                               ▼
                         Admin Services
                     ┌─────────┼─────────┐
                     ▼         ▼         ▼
                   Users   AI Usage   Settings
                     │
                     ▼
                 Audit Log
```

---

## 5. Nguyên tắc thiết kế (Design Principles)

1. **Separation of Concerns**: Phân tách triệt để UI (`frontend/`), Business Logic (`backend/`), Database (`database/`) và Config (`config/`).
2. **Thin Adapter Routing**: Thư mục `app/` chỉ đóng vai trò adapter định tuyến cho Next.js App Router, toàn bộ logic cốt lõi nằm trong `frontend/` và `backend/`.
3. **Type Safety**: Chia sẻ types rõ ràng qua `@frontend/types` và `@backend/src/types`.
4. **Resilience & Fallback**: Các dịch vụ AI dùng chung danh sách Flash model trong `gemini-models.ts`, ưu tiên Gemini 3.8 Flash và alias `gemini-flash-latest`; lỗi model/quota được xử lý mà không làm hỏng dashboard.
5. **Anti-Self-Escalation**: Bảng `user_roles` áp dụng RLS nghiêm ngặt, chỉ cho phép đọc vai trò của chính mình. Người dùng không thể tự nâng cấp quyền qua API, Supabase REST hay metadata.
6. **Financial Data Privacy**: Dữ liệu tài chính người dùng được cô lập tuyệt đối; giao diện Admin chỉ đọc số liệu tổng hợp.
7. **Unified Minimalist UI**: Giao diện Admin đồng bộ toàn diện với Design System của User, loại bỏ tối đa các icon trang trí không cần thiết, ưu tiên typography và khoảng trắng.
