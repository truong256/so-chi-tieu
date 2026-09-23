# Hướng dẫn Cấu trúc Frontend — Sổ Chi Tiêu

Tài liệu mô tả chi tiết tổ chức mã nguồn giao diện người dùng trong thư mục `frontend/`.

---

## 1. Cấu trúc thư mục `frontend/`

```text
frontend/
├── components/                       # Các component giao diện React chính
│   ├── auth-screen.tsx              # Giao diện Đăng nhập / Đăng ký / Quên mật khẩu
│   ├── dashboard.tsx                # Giao diện Dashboard người dùng chi tiêu chính (User)
│   ├── finance-app.tsx              # Component Root quản lý Auth State, Role Routing & Fallback
│   ├── formatted-money-input.tsx    # Input tiền dùng chung, không kéo scanner vào bundle đầu
│   └── receipt-scanner-modal.tsx    # Modal chụp và quét hóa đơn thông minh
│
├── features/                        # Các module tính năng chuyên sâu
│   ├── admin/                       # Module Admin Dashboard (độc lập với User Dashboard)
│   │   ├── admin-app.tsx            # Entry point của module Admin (quản lý active tab)
│   │   ├── admin-layout.tsx         # Layout chuẩn: Sidebar + Header + Container
│   │   ├── admin-sidebar.tsx        # Thanh điều hướng Admin (không dùng icon trang trí)
│   │   ├── admin-header.tsx         # Header hiển thị tiêu đề tab, trạng thái admin & email
│   │   ├── admin.types.ts           # Types chuyên biệt cho Admin (Metrics, Users, AI, Audit...)
│   │   ├── components/              # Các component dùng chung cho Admin UI
│   │   │   ├── admin-stat-card.tsx  # Thẻ thống kê (số liệu, nhãn, tỷ lệ)
│   │   │   ├── admin-table.tsx     # Bảng dữ liệu hỗ trợ responsive scroll
│   │   │   ├── status-badge.tsx     # Huy hiệu trạng thái dạng text/màu sắc
│   │   │   ├── confirmation-dialog.tsx # Hộp thoại xác nhận thao tác quan trọng
│   │   │   └── empty-state.tsx      # Trạng thái rỗng chuẩn
│   │   └── views/                   # Các màn hình chức năng Admin
│   │       ├── overview.tsx         # Tổng quan hệ thống, người dùng & AI
│   │       ├── users.tsx            # Quản lý danh sách người dùng, tìm kiếm & phân trang
│   │       ├── user-detail.tsx      # Chi tiết tài khoản, khóa/mở khóa, gửi đặt lại mật khẩu
│   │       ├── ai-monitoring.tsx    # Giám sát AI requests, độ trễ, tỷ lệ thành công
│   │       ├── notifications.tsx    # Soạn và phát thông báo hệ thống toàn thể
│   │       ├── system-settings.tsx  # Cấu hình cờ tính năng (AI, OCR, Maintenance)
│   │       └── audit-logs.tsx       # Nhật ký kiểm toán thao tác quản trị
│   └── ai/                          # Tính năng AI Financial Copilot
│       ├── ai-chat-context.tsx      # React Context quản lý tin nhắn, loading & state chat
│       ├── ai-chat.tsx              # Giao diện Chat AI toàn màn hình
│       ├── ai-message-content.tsx   # Renderer nội dung dùng chung
│       └── ai-floating-chat.tsx     # Nút bóng nổi (Floating Bubble) Chat AI
│
├── services/                        # Các dịch vụ xử lý dữ liệu phía Frontend
│   └── excel-export.ts              # Trích xuất toàn bộ dữ liệu tài chính ra file Excel
│
├── styles/                          # Tệp định dạng CSS toàn cục
│   └── globals.css                  # Toàn bộ CSS, variables, themes, utilities
│
├── types/                           # Định nghĩa TypeScript types toàn cục cho Frontend
│   └── finance.types.ts             # Wallet, Transaction, Budget, SavingsGoal, Profile...
│
└── utils/                           # Hàm tiện ích tính toán và phân tích
    ├── finance-calculations.ts      # Phép tính số dư/tổng hợp thu chi có regression test
    ├── finance.utils.ts             # Ngày tháng và tính chu kỳ
    └── smart-parser.ts              # Parser offline nhận diện cú pháp nhanh
```

---

## 2. Phân Quyền & Điều Hướng (Role Routing)

`frontend/components/finance-app.tsx` đảm nhiệm quản lý vòng đời Auth và Role Routing:
1. Khi có phiên đăng nhập Supabase (`session`), hệ thống gọi `/api/user/role` để xác định role (`user` hoặc `admin`).
2. Trong lúc đang xác định role, hiển thị màn hình chờ tải an toàn (`Role Loading State`), tuyệt đối không render trước Dashboard của User.
3. Nếu role là `admin`, dynamic import module `AdminApp` (`@frontend/features/admin/admin-app`).
4. Nếu role là `user` hoặc tài khoản cũ chưa có bản ghi role, tự động fallback an toàn về `user` và nạp `Dashboard`.
5. Khi người dùng bấm đăng xuất, hệ thống hủy session và đưa về `AuthScreen`.

---

## 3. Nguyên Tắc Thiết Kế Giao Diện Admin

- **Tái sử dụng Design System**: Dùng cùng tông màu nền (`#151d1f`, `#1b2628`, `#0e1516`), màu chữ, màu thẻ card, font chữ `Be Vietnam Pro`, khoảng cách (spacing), và border radius với User Dashboard.
- **Loại bỏ Icon Không Cần Thiết**: Tối giản hóa tối đa, không dùng emoji hoặc icon trang trí tràn lan. Ưu tiên nhãn text, typography, active indicators (border-bottom, background highlight), bảng thẻ và badge màu.
- **Tách Biệt Module**: Toàn bộ logic và view của Admin nằm trong `frontend/features/admin/`, không nhét mã nguồn Admin vào `dashboard.tsx`.
- **Code Splitting**: Cả `Dashboard` và `AdminApp` đều được tải lười (lazy load) qua dynamic import để tối ưu bundle size và tách biệt hoàn toàn giữa hai actor.

---

## 4. Đường dẫn Alias (Path Aliases)

Hệ thống hỗ trợ import thông qua alias `@frontend/*`:
```typescript
import { formatMoney } from "@frontend/utils/finance.utils";
import type { Wallet } from "@frontend/types/finance.types";
import { createClient } from "@config/supabase";
```

Dashboard, AdminApp, trình quét hóa đơn, màn hình AI đầy đủ và module xuất Excel được code-split. Excel chỉ tải khi người dùng bấm xuất; không import tĩnh lại các module này vào entry component.
