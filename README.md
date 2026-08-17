# 📒 Sổ Chi Tiêu

**Ứng dụng quản lý tài chính cá nhân** — theo dõi thu chi, ngân sách, mục tiêu tiết kiệm và giao dịch định kỳ, tích hợp AI assistant.

---

## Tính năng

- 💰 **Ví & Tài khoản** — quản lý tiền mặt, ngân hàng, ví điện tử
- 🔄 **Giao dịch** — ghi nhận thu/chi với danh mục, lọc và tìm kiếm nâng cao
- 📤 **Chuyển khoản** — chuyển tiền giữa các ví
- 📊 **Ngân sách** — phân bổ ngân sách theo danh mục/kỳ
- 🎯 **Mục tiêu tiết kiệm** — đặt và theo dõi mục tiêu tài chính
- 🔁 **Giao dịch định kỳ** — tự động nhắc nhở/xử lý các khoản định kỳ
- 📈 **Báo cáo** — biểu đồ tổng quan thu chi theo ngày/tuần/tháng/năm
- 🤖 **AI Assistant** — trợ lý tài chính AI (Gemini), phân tích dữ liệu, chat tư vấn
- 📷 **Scan hóa đơn** — chụp ảnh hóa đơn, AI tự động nhận diện và tạo giao dịch
- 📝 **Nhập bằng ngôn ngữ tự nhiên** — gõ "ăn trưa 50k" → tự động điền thông tin
- 📁 **Xuất Excel** — xuất toàn bộ dữ liệu tài chính sang file Excel

---

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|------------|-----------|
| Framework | Next.js 16 (App Router) + Vinext |
| Runtime | Cloudflare Workers |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (Email/Password) |
| AI | Google Gemini API |
| Styling | TailwindCSS v4 |
| Language | TypeScript, React 19 |
| Build Tool | Vite 8 |
| ORM | Drizzle ORM (Cloudflare D1 — optional) |

---

## Cấu trúc thư mục

```
so-chi-tieu/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes (server-side)
│   │   ├── ai/parse-transaction/ # AI: phân tích văn bản → giao dịch
│   │   ├── chat/                 # AI: chatbot tài chính (Gemini)
│   │   ├── receipt/parse/        # AI: phân tích ảnh hóa đơn
│   │   ├── runtime-config/       # Expose cấu hình Supabase cho client
│   │   └── client-error/         # Log lỗi client-side
│   ├── services/
│   │   └── excel-export.ts       # Xuất dữ liệu ra Excel
│   ├── ai-chat-context.tsx       # React Context: AI chat state + FinancialContext types
│   ├── ai-chat.tsx               # Component: AI chat full-page
│   ├── ai-floating-chat.tsx      # Component: AI chat bubble nổi
│   ├── auth-screen.tsx           # Component: Login / Register / Forgot password
│   ├── dashboard.tsx             # Component: Dashboard chính
│   ├── error.tsx                 # Next.js error boundary
│   ├── finance-app.tsx           # Root: Auth wrapper + loading states
│   ├── finance-types.ts          # TypeScript types toàn cục
│   ├── finance-utils.ts          # Utility functions (format, tính toán)
│   ├── globals.css               # Styles toàn cục
│   ├── layout.tsx                # Next.js root layout
│   ├── page.tsx                  # Next.js root page
│   ├── receipt-scanner-modal.tsx # Component: Modal scan hóa đơn
│   └── smart-parser.ts           # Parser offline: nhận diện giao dịch từ text
│
├── database/                     # SQL migrations và scripts
│   ├── migrations/               # Migrations theo thứ tự
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_insufficient_balance_check.sql
│   │   ├── 003_recurring_transactions_v2.sql
│   │   ├── 004_reserved_money.sql
│   │   └── 005_true_balances_rpc.sql
│   ├── fixes/                    # Fixes áp dụng trên production
│   │   └── production_fix.sql
│   └── README.md                 # Hướng dẫn migrations
│
├── lib/
│   └── supabase/
│       └── client.ts             # Supabase browser client
│
├── worker/
│   └── index.ts                  # Cloudflare Worker entry point
│
├── scripts/                      # CI/CD và build scripts
│   ├── install-ci.sh
│   ├── build-verified.sh
│   ├── sites-env.sh
│   ├── validate-artifact.sh
│   └── patches/                  # Archived patch scripts (đã apply)
│
├── public/                       # Static assets
├── tests/                        # Integration tests
├── drizzle/                      # Drizzle migration metadata
├── examples/d1/                  # D1 examples (Cloudflare D1 optional)
│
├── .env.example                  # Template biến môi trường
├── .gitignore
├── README.md
├── package.json
├── next.config.ts
├── vite.config.ts
├── tsconfig.json
├── drizzle.config.ts
└── postcss.config.mjs
```

---

## Yêu cầu môi trường

- **Node.js** `>=22.13.0`
- **Linux** (với `flock`, `curl`, GNU `timeout`) — cho CI/CD scripts
- Tài khoản **Supabase** (database + auth)
- **Google Gemini API key** (cho AI features)

---

## Hướng dẫn cài đặt

### 1. Clone repository

```bash
git clone <repository-url>
cd so-chi-tieu
```

### 2. Cài đặt dependencies

```bash
npm install
```

### 3. Cấu hình biến môi trường

```bash
cp .env.example .env.local
```

Mở `.env.local` và điền các giá trị:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
GEMINI_API_KEY=your-gemini-api-key
```

### 4. Thiết lập Database (Supabase)

Chạy migrations theo thứ tự trong Supabase Dashboard → SQL Editor:

```
database/migrations/001_initial_schema.sql
database/migrations/002_insufficient_balance_check.sql
database/migrations/003_recurring_transactions_v2.sql
database/migrations/004_reserved_money.sql
database/migrations/005_true_balances_rpc.sql
```

Chi tiết xem: [`database/README.md`](./database/README.md)

---

## Hướng dẫn chạy Development

```bash
npm run dev
```

Ứng dụng sẽ chạy tại `http://localhost:5173` (Vite dev server).

---

## Hướng dẫn Build

```bash
npm run build
```

Build sẽ tạo artifact cho Cloudflare Workers deployment.

---

## Hướng dẫn Test

```bash
npm test
```

Lệnh này sẽ build project trước, sau đó chạy integration test kiểm tra HTML output.

---

## Database

Xem chi tiết tại [`database/README.md`](./database/README.md).

---

## Deployment

Dự án được deploy lên **Cloudflare Workers** thông qua platform **Vinext** / OpenAI Sites.

Workflow:
1. Push code lên repository
2. Platform tự động chạy `npm run build`
3. Artifact được deploy lên Cloudflare edge network

### Biến môi trường trên server

Cần cấu hình các biến sau trong Cloudflare Workers / deployment platform:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
GEMINI_API_KEY
```

---

## Scripts

| Script | Mô tả |
|--------|-------|
| `npm run dev` | Chạy Vite dev server |
| `npm run build` | Build production artifact |
| `npm run start` | Chạy built application |
| `npm test` | Build + chạy integration tests |
| `npm run lint` | Chạy ESLint |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run install:ci` | CI-friendly install |
| `npm run validate:artifact` | Kiểm tra build artifact |
