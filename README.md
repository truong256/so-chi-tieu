# 📒 Sổ Chi Tiêu (Personal Finance Manager)

**Sổ Chi Tiêu** là ứng dụng quản lý tài chính cá nhân toàn diện, tích hợp Trợ lý AI (Google Gemini), hỗ trợ theo dõi thu chi, quản lý ví, ngân sách, mục tiêu tiết kiệm, giao dịch định kỳ, quét hóa đơn bằng camera và xuất báo cáo Excel.

---

## 1. Tính năng Nổi bật

- 💰 **Quản lý Ví đa dạng**: Tiền mặt, Ngân hàng, Thẻ tín dụng, Ví điện tử (MoMo, ZaloPay, VNPay...).
- 🔄 **Theo dõi Thu & Chi**: Ghi nhận, phân loại danh mục, tìm kiếm và lọc nâng cao.
- 📤 **Chuyển tiền liên ví**: Luân chuyển nguồn tiền giữa các tài khoản linh hoạt.
- 📊 **Ngân sách thông minh**: Đặt giới hạn chi tiêu theo danh mục, cảnh báo vượt hạn mức.
- 🎯 **Mục tiêu Tiết kiệm**: Theo dõi tiến độ tích lũy tài chính cho các dự định tương lai.
- 🔁 **Giao dịch Định kỳ**: Tự động nhắc nhở và xử lý các khoản tiền lặp lại (tiền nhà, điện, nước...).
- 🤖 **Financial Copilot (AI Chatbot)**: Tư vấn tài chính, phân tích What-if ("nếu mua X thì sao?").
- 📷 **AI Scan Hóa đơn**: Nhận diện ảnh hóa đơn/biên lai và tự động điền giao dịch.
- 📝 **Nhập liệu Ngôn ngữ Tự nhiên**: Gõ "Ăn sáng 35k tiền mặt" → AI tự động phân tích và điền form.
- 📁 **Báo cáo & Xuất Excel**: Thống kê trực quan, biểu đồ và xuất toàn bộ sổ sách ra file Excel.

---

## 2. Công nghệ Sử dụng (Technology Stack)

| Thành phần | Công nghệ |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, TailwindCSS v4 |
| **Backend / Services** | TypeScript Services, Next.js Route Handlers |
| **Runtime & Edge Deployment** | Cloudflare Workers, Vinext (Vite 8) |
| **Database & Authentication** | Supabase (PostgreSQL, Row-Level Security, Supabase Auth) |
| **AI / NLP / Vision** | Google Gemini API (ưu tiên Gemini 3.7 Flash, có fallback tương thích) |
| **Data Export** | Trình ghi OOXML nội bộ + `fflate` |
| **Testing** | Node.js Test Runner (`node --test`) |

---

## 3. Cấu trúc Dự án (Project Structure)

Dự án được phân chia thành 5 nhóm nền tảng chính:

```text
so-chi-tieu/
│
├── frontend/                         # [UI & Presentation Layer]
│   ├── components/                   # React components (Dashboard, AuthScreen, FinanceApp, ReceiptScanner)
│   ├── features/                     # Module tính năng (AI Chatbot, Floating Chat, Chat Context)
│   ├── services/                     # Frontend data services (Excel export)
│   ├── styles/                       # CSS & Tailwind styling (globals.css)
│   ├── types/                        # TypeScript types cho UI & DTO (finance.types.ts)
│   └── utils/                        # Frontend utilities & parsers (finance.utils.ts, smart-parser.ts)
│
├── backend/                          # [Server-side Business Logic Layer]
│   └── src/
│       ├── services/                 # Core business services (ai-chat, ai-parser, receipt-parser)
│       └── types/                    # Server-side & shared AI types (ai.types.ts)
│
├── database/                         # [Database & Migrations Layer]
│   ├── migrations/                   # SQL migrations theo thứ tự đánh số
│   │   ├── 000_base_schema.sql
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_insufficient_balance_check.sql
│   │   ├── 003_recurring_transactions_v2.sql
│   │   ├── 004_reserved_money.sql
│   │   ├── 005_true_balances_rpc.sql
│   │   └── 006_finance_integrity_and_security.sql
│   ├── fixes/                        # SQL fixes cho môi trường production
│   │   └── production_fix.sql
│   └── README.md                     # Hướng dẫn chi tiết migration
│
├── config/                           # [Application Configuration Layer]
│   ├── supabase.ts                   # Supabase browser client & connection config
│   └── constants.ts                  # App-wide constants & system limits
│
├── docs/                             # [Documentation Layer]
│   ├── architecture.md               # Sơ đồ và nguyên tắc kiến trúc hệ thống
│   ├── setup.md                      # Hướng dẫn cài đặt và thiết lập môi trường
│   ├── database.md                   # Mô tả cấu trúc bảng, quan hệ & RLS
│   ├── api.md                        # Chi tiết REST API endpoints & payloads
│   ├── frontend.md                   # Hướng dẫn phát triển module Frontend
│   └── backend.md                    # Hướng dẫn phát triển module Backend
│
├── app/                              # [Next.js App Router Thin Adapter Layer]
│   ├── api/                          # HTTP Route Handlers gọi vào backend services
│   │   ├── ai/parse-transaction/
│   │   ├── chat/
│   │   ├── receipt/parse/
│   │   ├── runtime-config/
│   │   └── client-error/
│   ├── layout.tsx                    # Root Layout
│   ├── page.tsx                      # Root Page
│   └── error.tsx                     # Global Error Boundary
│
├── worker/                           # Cloudflare Worker entrypoint cho Edge runtime
│   └── index.ts
│
├── scripts/                          # CI/CD, build & archived patch scripts
│   ├── install-ci.sh
│   ├── build-verified.sh
│   ├── sites-env.sh
│   ├── validate-artifact.sh
│   └── patches/                      # Lịch sử các bản vá trước đó
│
├── public/                           # Static assets (images, icons)
├── tests/                            # Automated integration tests
├── .env.example                      # Biến môi trường mẫu
├── .gitignore                        # Cấu hình Git ignore
├── package.json                      # Danh sách dependencies & scripts
├── tsconfig.json                     # Cấu hình TypeScript & Path Aliases
├── vite.config.ts                    # Cấu hình Vite & Cloudflare plugin
└── next.config.ts                    # Cấu hình Next.js
```

---

## 4. Yêu cầu Hệ thống (Prerequisites)

- **Node.js**: `>=22.13.0`
- **Tài khoản Supabase**: Đã khởi tạo database và kích hoạt Email Auth
- **Google Gemini API Key**: Đăng ký miễn phí tại [Google AI Studio](https://aistudio.google.com/apikey)

---

## 5. Cài đặt (Installation)

### 1. Clone mã nguồn
```bash
git clone <repository-url>
cd so-chi-tieu
```

### 2. Cài đặt thư viện phụ thuộc
```bash
npm ci
```

### 3. Thiết lập biến môi trường
Tạo file `.env.local` từ mẫu `.env.example`:
```bash
cp .env.example .env.local
```
Điền các giá trị thực tế:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-key
GEMINI_API_KEY=your-gemini-api-key
```

### 4. Thiết lập Cơ sở dữ liệu
Chạy tất cả tệp SQL trong `database/migrations/` theo thứ tự từ `000` đến `006` trên **Supabase SQL Editor**. Migration `006` bắt buộc cho xác thực API và các nghiệp vụ tài chính nguyên tử. Chi tiết xem tại [`docs/database.md`](./docs/database.md).

---

## 6. Khởi chạy Ứng dụng (Running the App)

### Chạy Development Server
```bash
npm run dev
```
Truy cập tại `http://localhost:5173`.

### Chạy Kiểm tra Kiểu dữ liệu
```bash
npx tsc --noEmit
```

### Build cho Production
```bash
npm run build
```

### Chạy Automated Tests
```bash
npm test
```

### Chạy Linter
```bash
npm run lint
```

### Kiểm tra artifact và dependency production

```bash
npm run validate:artifact
npm audit --omit=dev
```

---

## 7. Tài liệu Chi tiết (Detailed Docs)

- 📐 [Kiến trúc Hệ thống (`docs/architecture.md`)](./docs/architecture.md)
- 🚀 [Hướng dẫn Cài đặt (`docs/setup.md`)](./docs/setup.md)
- 🗄️ [Cơ sở Dữ liệu & Schema (`docs/database.md`)](./docs/database.md)
- 🔌 [Tài liệu API (`docs/api.md`)](./docs/api.md)
- 💻 [Cấu trúc Frontend (`docs/frontend.md`)](./docs/frontend.md)
- ⚙️ [Cấu trúc Backend (`docs/backend.md`)](./docs/backend.md)
