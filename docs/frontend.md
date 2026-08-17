# Hướng dẫn Cấu trúc Frontend — Sổ Chi Tiêu

Tài liệu mô tả chi tiết tổ chức mã nguồn giao diện người dùng trong thư mục `frontend/`.

---

## 1. Cấu trúc thư mục `frontend/`

```text
frontend/
├── components/                       # Các component giao diện React chính
│   ├── auth-screen.tsx              # Giao diện Đăng nhập / Đăng ký / Quên mật khẩu
│   ├── dashboard.tsx                # Giao diện Dashboard quản lý chi tiêu chính
│   ├── finance-app.tsx              # Component Root quản lý phiên làm việc & Auth State
│   └── receipt-scanner-modal.tsx    # Modal chụp và quét hóa đơn thông minh
│
├── features/                        # Các module tính năng chuyên sâu
│   └── ai/                          # Tính năng AI Financial Copilot
│       ├── ai-chat-context.tsx      # React Context quản lý tin nhắn, loading & state chat
│       ├── ai-chat.tsx              # Giao diện Chat AI toàn màn hình
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
    ├── finance.utils.ts             # Định dạng tiền tệ, ngày tháng, tính chu kỳ
    └── smart-parser.ts              # Parser offline nhận diện cú pháp nhanh
```

---

## 2. Đường dẫn Alias (Path Aliases)

Hệ thống hỗ trợ import thông qua alias `@frontend/*`:
```typescript
import { formatMoney } from "@frontend/utils/finance.utils";
import type { Wallet } from "@frontend/types/finance.types";
import { createClient } from "@config/supabase";
```
