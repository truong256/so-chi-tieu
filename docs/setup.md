# Hướng dẫn Cài đặt & Khởi chạy — Sổ Chi Tiêu

Tài liệu hướng dẫn chi tiết cách thiết lập môi trường phát triển và chạy ứng dụng cục bộ.

---

## 1. Yêu cầu Tiên quyết (Prerequisites)

- **Node.js**: Phiên bản `>=22.13.0` (Khuyến nghị dùng Node 22 LTS).
- **Trình quản lý gói**: `npm` (đi kèm Node.js).
- **Tài khoản Supabase**: Đã tạo project và lấy URL + Anon/Publishable Key.
- **Google Gemini API Key**: Lấy từ [Google AI Studio](https://aistudio.google.com/apikey).

---

## 2. Các bước Cài đặt

### Bước 1: Clone repository
```bash
git clone <repo-url>
cd so-chi-tieu
```

### Bước 2: Cài đặt dependencies
```bash
npm install
```

### Bước 3: Thiết lập biến môi trường
Sao chép tệp mẫu `.env.example` thành `.env.local`:
```bash
cp .env.example .env.local
```

Mở tệp `.env.local` và điền các thông tin:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-or-anon-key
GEMINI_API_KEY=your-gemini-api-key
```

### Bước 4: Thiết lập Database trên Supabase
Mở **Supabase Dashboard** → **SQL Editor** và chạy các file migration theo thứ tự:
1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_insufficient_balance_check.sql`
3. `database/migrations/003_recurring_transactions_v2.sql`
4. `database/migrations/004_reserved_money.sql`
5. `database/migrations/005_true_balances_rpc.sql`

Chi tiết xem tại [`docs/database.md`](./database.md).

---

## 3. Khởi chạy Ứng dụng

### Chạy Development Server (Vite + Cloudflare Miniflare runtime)
```bash
npm run dev
```
Truy cập ứng dụng tại: `http://localhost:5173`

### Kiểm tra Kiểu dữ liệu (Typecheck)
```bash
npx tsc --noEmit
```

### Chạy Production Build
```bash
npm run build
```

### Chạy Kiểm thử (Tests)
```bash
npm test
```

### Chạy Linter
```bash
npm run lint
```
