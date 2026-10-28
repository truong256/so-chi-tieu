/**
 * backend/src/services/system-knowledge-base.ts
 * ==============================================
 * Comprehensive System Feature Knowledge Base for "Sổ Chi Tiêu".
 *
 * Ground Truth extracted directly from verified source code:
 * - Frontend components: finance-app.tsx, dashboard.tsx, modals, services.
 * - Backend services: financial-tools, financial-snapshot, ai-router, admin-auth.
 * - Database schema & migrations: 000_base_schema.sql to 018_budget_management_integrity.sql.
 *
 * Each feature document contains:
 * 1. id & name
 * 2. status (HOÀN THIỆN / CHƯA HOÀN THIỆN / CHỈ CÓ GIAO DIỆN)
 * 3. purpose (Mục đích)
 * 4. uiLocation (Vị trí trên giao diện)
 * 5. workflow (Cách sử dụng - các bước thực hiện cụ thể)
 * 6. inputsOutputs (Dữ liệu đầu vào / đầu ra)
 * 7. validationRules (Ràng buộc & Validation)
 * 8. businessRules (Quy tắc nghiệp vụ & Kế toán)
 * 9. dbTables (Bảng cơ sở dữ liệu liên quan)
 * 10. apiServices (API / Service xử lý)
 * 11. permissions (Phân quyền: user / admin / all)
 * 12. limitations (Lỗi thường gặp & Giới hạn)
 * 13. relationships (Mối quan hệ với các chức năng khác)
 * 14. sourceCodeCitations (Trích dẫn mã nguồn)
 */

export type FeatureImplementationStatus =
  | "HOÀN THIỆN"
  | "CHƯA HOÀN THIỆN"
  | "CHỈ CÓ GIAO DIỆN";

export interface SystemFeatureMetadata {
  id: string;
  name: string;
  status: FeatureImplementationStatus;
  purpose: string;
  uiLocation: string;
  workflow: string[];
  inputsOutputs: {
    inputs: string[];
    outputs: string[];
  };
  validationRules: string[];
  businessRules: string[];
  dbTables: string[];
  apiServices: string[];
  permissions: "user" | "admin" | "all";
  limitations: string[];
  relationships: string[];
  sourceCodeCitations: string[];
  keywords: string[];
}

export const SYSTEM_FEATURES: Record<string, SystemFeatureMetadata> = {
  system_overview: {
    id: "system_overview",
    name: "Tổng quan Hệ thống & Kiến trúc Sổ Chi Tiêu",
    status: "HOÀN THIỆN",
    purpose:
      "Ứng dụng quản lý tài chính cá nhân thông minh tích hợp Trợ lý AI (Financial Copilot), giúp người dùng theo dõi toàn diện ví tiền, thu chi, ngân sách, mục tiêu tiết kiệm, và phân tích dòng tiền.",
    uiLocation: "Toàn bộ thanh điều hướng Header, Navigation Tabs, và Chatbot Widget góc dưới màn hình.",
    workflow: [
      "1. Truy cập ứng dụng và đăng nhập qua hệ thống Supabase Auth.",
      "2. Màn hình Dashboard hiển thị Tổng quan tài sản, Ví tiền, Giao dịch gần đây, Ngân sách và Mục tiêu.",
      "3. Chuyển đổi giữa các phân hệ qua Navigation Tabs: Tổng quan, Giao dịch, Ngân sách, Mục tiêu, Báo cáo, Cài đặt.",
      "4. Nhấn biểu tượng Chatbot nổi ở góc dưới phải để tương tác với Financial Copilot.",
      "5. Người dùng có quyền Admin truy cập Bảng quản trị qua route /admin.",
    ],
    inputsOutputs: {
      inputs: ["Tương tác người dùng qua giao diện Web, ảnh hóa đơn, tệp dữ liệu Excel/CSV, tin nhắn hội thoại AI."],
      outputs: ["Giao diện Dashboard trực quan, biểu đồ dòng tiền, tệp báo cáo Excel (.xlsx), lời khuyên tài chính cá nhân hóa."],
    },
    validationRules: [
      "Mọi truy vấn dữ liệu tài chính bắt buộc có JWT Access Token hợp lệ.",
      "PostgreSQL Row-Level Security (RLS) đảm bảo phân lập dữ liệu tuyệt đối giữa các tài khoản.",
    ],
    businessRules: [
      "Tài sản độc lập theo từng tài khoản người dùng (user_id).",
      "Cô lập đa tiền tệ (Multi-currency isolation): Tuyệt đối không cộng gộp chéo VND và USD.",
      "Nguyên tắc kế toán kép trong chuyển tiền liên ví bảo toàn tổng tài sản trừ phí chuyển.",
      "Trợ lý AI là cố vấn ĐỌC (Read-Only Guardrail), không có quyền tự ý sửa đổi cơ sở dữ liệu qua lời nói.",
    ],
    dbTables: [
      "public.wallets",
      "public.categories",
      "public.transactions",
      "public.transfers",
      "public.budgets",
      "public.savings_goals",
      "public.recurring_transactions",
      "public.recurring_occurrences",
      "public.user_roles",
      "public.admin_audit_logs",
    ],
    apiServices: [
      "Next.js 16 App Router Route Handlers (/api/chat, /api/receipt/parse, /api/admin/*)",
      "Cloudflare Workers + Vinext runtime",
      "Supabase PostgreSQL + RLS",
      "Ollama Local LLM + FastAPI Vision Container",
    ],
    permissions: "all",
    limitations: [
      "Yêu cầu kết nối Internet hoặc mạng nội bộ tới Supabase và cụm dịch vụ AI.",
      "Trình duyệt cần hỗ trợ Web Crypto và Blob API cho các tính năng bảo mật và xuất Excel client-side.",
    ],
    relationships: [
      "Trung tâm điều phối liên kết toàn bộ các phân hệ tài chính và quản trị của ứng dụng.",
    ],
    sourceCodeCitations: [
      "frontend/components/finance-app.tsx (Main Application Shell)",
      "frontend/components/dashboard.tsx (Core Financial Dashboard)",
      "backend/src/services/financial-snapshot.service.ts (Authoritative Financial Snapshot Engine)",
      "docs/architecture.md (System Architecture & Security Model)",
    ],
    keywords: [
      "tổng quan", "hệ thống", "chức năng", "tính năng", "sổ chi tiêu", "app", "kiến trúc",
      "tech stack", "nextjs", "react", "supabase", "cloudflare", "vite", "ollama", "overview",
    ],
  },

  wallets: {
    id: "wallets",
    name: "Quản lý Ví & Tài khoản (Wallets)",
    status: "HOÀN THIỆN",
    purpose:
      "Quản lý danh sách các tài khoản tài chính, ví tiền mặt, thẻ ngân hàng, thẻ tín dụng và ví điện tử; theo dõi số dư thực tế, tiền đã phân bổ và số dư khả dụng.",
    uiLocation: "Tab 'Ví & Tài khoản' hoặc khối 'Danh sách Ví' trên Dashboard. Nút '+ Thêm ví' ở góc trên danh sách.",
    workflow: [
      "1. Nhấn nút '+ Thêm ví' tại Dashboard hoặc trang Quản lý Ví để mở Modal tạo ví.",
      "2. Nhập Tên ví (ví dụ: 'Tiền mặt', 'MB Bank', 'MoMo').",
      "3. Chọn Loại ví: Tiền mặt (cash), Ngân hàng (bank), Thẻ tín dụng (credit), Ví điện tử (e_wallet).",
      "4. Nhập Số dư ban đầu (hỗ trợ nhập số tự nhiên và định dạng tiền tệ thông minh).",
      "5. Chọn Đơn vị tiền tệ (mặc định VND, hỗ trợ USD) và Màu sắc nhận diện thẻ ví.",
      "6. Nhấn 'Tạo ví' để hoàn tất.",
      "7. Người dùng có thể bấm vào ví để xem chi tiết lịch sử, sửa thông tin, hoặc xóa ví.",
    ],
    inputsOutputs: {
      inputs: ["name: string (1-50 ký tự)", "type: 'cash'|'bank'|'credit'|'e_wallet'", "balance: number (>= 0)", "currency: 'VND'|'USD'", "color: string"],
      outputs: ["Bản ghi ví mới trong bảng public.wallets, cập nhật tức thời vào Tổng tài sản."],
    },
    validationRules: [
      "Tên ví không được để trống.",
      "Loại ví phải thuộc một trong 4 loại hợp lệ: cash, bank, credit, e_wallet.",
      "Số dư ban đầu phải >= 0.",
      "Không được xóa ví đang có giao dịch phát sinh trừ khi đã chuyển hoặc xóa các giao dịch liên kết.",
      "Không được xóa ví đang có tiền cấp vốn quỹ phong bì ngân sách ràng buộc.",
    ],
    businessRules: [
      "Số dư thực tế (balance) = Số dư ban đầu + Tổng thu nhập - Tổng chi tiêu ± Chuyển tiền liên ví.",
      "Tiền dự trữ / đã phân bổ (reserved_amount / allocated) = Tiền nạp vào Mục tiêu tiết kiệm + Tiền cấp vốn Quỹ phong bì ngân sách từ ví này.",
      "Số dư khả dụng (available balance) = Số dư thực tế - Tiền dự trữ (balance - reserved_amount).",
      "Tiền dự trữ vẫn là tài sản của người dùng, không bị mất đi nhưng bị khoanh giữ để tránh chi tiêu thâm lạm.",
      "Cô lập tiền tệ: Không cộng gộp số dư ví VND vào ví USD.",
    ],
    dbTables: ["public.wallets", "public.savings_goals", "public.budgets"],
    apiServices: [
      "Supabase client RLS trực tiếp trên bảng wallets",
      "backend/src/services/financial-snapshot.service.ts",
      "backend/src/services/financial-tools.service.ts (get_wallet_balances)",
    ],
    permissions: "user",
    limitations: [
      "Hiện chưa tích hợp Open Banking API trực tiếp với ngân hàng tại Việt Nam; số dư cập nhật qua ghi chép giao dịch hoặc nhập sao kê.",
    ],
    relationships: [
      "Liên kết trực tiếp với Giao dịch Thu Chi (chọn ví thanh toán).",
      "Liên kết với Chuyển tiền liên ví (Ví nguồn & Ví đích).",
      "Liên kết với Mục tiêu tiết kiệm (trích giữ reserved_amount).",
      "Liên kết với Ngân sách phong bì (cấp vốn allocated_amount).",
    ],
    sourceCodeCitations: [
      "frontend/components/wallet-modal.tsx (Wallet Form Modal)",
      "frontend/components/dashboard.tsx#renderWallets (Wallet Cards Grid)",
      "database/migrations/004_reserved_money.sql (Reserved Money Schema & Constraints)",
      "backend/src/services/financial-snapshot.service.ts (Wallet Balances & Available Logic)",
    ],
    keywords: [
      "ví", "tài khoản", "thêm ví", "tạo ví", "tiền mặt", "ngân hàng", "thẻ tín dụng",
      "ví điện tử", "số dư", "tiền dự trữ", "khả dụng", "reserved money", "wallet",
    ],
  },

  transactions: {
    id: "transactions",
    name: "Giao dịch Thu & Chi (Transactions)",
    status: "HOÀN THIỆN",
    purpose:
      "Ghi nhận, phân loại và quản lý các khoản thu nhập và chi tiêu hàng ngày; tự động cập nhật số dư ví và đối soát với ngân sách.",
    uiLocation: "Nút '+ Thêm giao dịch' trên Header hoặc Dashboard, Tab 'Giao dịch', thanh nhập nhanh tự nhiên, hoặc nút quét hóa đơn Camera.",
    workflow: [
      "1. Nhấn '+ Thêm giao dịch' để mở form ghi chép.",
      "2. Chọn Phân loại: Chi tiêu (Expense) hoặc Thu nhập (Income).",
      "3. Nhập Số tiền (sử dụng FormattedMoneyInput tự động phân cách hàng nghìn).",
      "4. Chọn Danh mục chi tiêu/thu nhập tương ứng.",
      "5. Chọn Ví thanh toán / nhận tiền.",
      "6. Chọn Ngày thực hiện giao dịch (mặc định hôm nay trong múi giờ Asia/Ho_Chi_Minh).",
      "7. Nhập Ghi chú hoặc đính kèm ảnh biên lai (nếu có).",
      "8. Nhấn 'Lưu giao dịch' để ghi nhận vào hệ thống.",
      "9. Có thể sửa, xóa giao dịch từ bảng danh sách.",
    ],
    inputsOutputs: {
      inputs: ["amount: number (> 0)", "type: 'income'|'expense'", "category_id: uuid", "wallet_id: uuid", "transaction_date: string (ISO/Date)", "note?: string", "receipt_url?: string"],
      outputs: ["Bản ghi transaction mới, tự động kích hoạt trigger/logic cập nhật số dư ví."],
    },
    validationRules: [
      "Số tiền phải lớn hơn 0.",
      "Danh mục và ví được chọn bắt buộc phải thuộc sở hữu của người dùng hiện tại.",
      "Ngày giao dịch không được vượt quá tương lai xa.",
    ],
    businessRules: [
      "Giao dịch Chi tiêu (Expense) làm giảm số dư thực tế của ví được chọn.",
      "Giao dịch Thu nhập (Income) làm tăng số dư thực tế của ví được chọn.",
      "Giao dịch chi tiêu thuộc danh mục có Ngân sách sẽ tự động cộng dồn vào Chi tiêu thực tế của ngân sách trong kỳ.",
      "Xóa hoặc sửa giao dịch: Số dư ví được hoàn nguyên và tính toán lại chính xác.",
      "Giao dịch chuyển tiền liên ví KHÔNG tính vào tổng thu hay tổng chi của kỳ.",
      "Trợ lý AI TUYỆT ĐỐI KHÔNG có quyền tự tạo hay xóa giao dịch thay người dùng.",
    ],
    dbTables: ["public.transactions", "public.wallets", "public.categories", "public.budgets"],
    apiServices: [
      "Supabase client RLS",
      "backend/src/services/financial-tools.service.ts (get_transaction_statistics, get_recent_transactions)",
      "backend/src/services/financial-snapshot.service.ts",
    ],
    permissions: "user",
    limitations: [
      "Bảng giao dịch trên giao diện phân trang hiển thị 20-30 dòng/trang; cần phân biệt rõ số dòng trên một trang với tổng số giao dịch thực tế trong kỳ.",
    ],
    relationships: [
      "Tác động trực tiếp đến Ví tiền (cộng/trừ số dư).",
      "Tác động đến Ngân sách (tính chi tiêu thực tế danh mục).",
      "Là dữ liệu nguồn cho Biểu đồ báo cáo dòng tiền, Đánh giá tháng và Xuất Excel.",
    ],
    sourceCodeCitations: [
      "frontend/components/transaction-modal.tsx (Transaction Create/Edit Modal)",
      "frontend/components/dashboard.tsx#renderTransactions (Transaction Table & Filters)",
      "database/migrations/000_base_schema.sql (Transactions Table & Indexes)",
      "backend/src/services/financial-tools.service.ts#get_transaction_statistics",
    ],
    keywords: [
      "giao dịch", "thu chi", "chi tiêu", "thu nhập", "thêm giao dịch", "ghi chép",
      "khoản chi", "khoản thu", "hóa đơn", "transaction", "expense", "income",
    ],
  },

  transfers: {
    id: "transfers",
    name: "Chuyển tiền liên ví (Inter-wallet Transfers)",
    status: "HOÀN THIỆN",
    purpose:
      "Thực hiện luân chuyển nguồn tiền giữa hai ví thuộc sở hữu của người dùng (ví dụ: rút tiền từ ngân hàng về tiền mặt hoặc nạp vào ví MoMo), có hỗ trợ phí chuyển tiền.",
    uiLocation: "Nút 'Chuyển tiền' tại khối Quản lý Ví hoặc Dashboard.",
    workflow: [
      "1. Nhấn nút 'Chuyển tiền' để mở Transfer Modal.",
      "2. Chọn Ví nguồn (Ví trích tiền chuyển đi).",
      "3. Chọn Ví đích (Ví nhận tiền đến).",
      "4. Nhập Số tiền cần chuyển.",
      "5. Nhập Phí giao dịch (nếu có, ví dụ 1.100 VND hoặc 0 VND).",
      "6. Nhập Ghi chú (tùy chọn) và kiểm tra ngày thực hiện.",
      "7. Nhấn 'Xác nhận chuyển'. Hệ thống thực thi chuyển tiền nguyên tử.",
    ],
    inputsOutputs: {
      inputs: ["from_wallet_id: uuid", "to_wallet_id: uuid", "amount: number (> 0)", "fee: number (>= 0)", "transfer_date: string", "note?: string"],
      outputs: ["Bản ghi trong public.transfers, trừ ví nguồn (amount + fee), cộng ví đích (amount)."],
    },
    validationRules: [
      "Ví nguồn và ví đích bắt buộc phải khác nhau.",
      "Cả hai ví phải thuộc sở hữu của cùng một người dùng.",
      "Ví nguồn phải có Số dư khả dụng >= (Số tiền chuyển + Phí chuyển).",
      "Hai ví phải có cùng đơn vị tiền tệ (không chuyển chéo giữa VND và USD).",
    ],
    businessRules: [
      "Tính nguyên tử (Atomicity): Trừ tiền ví nguồn và cộng tiền ví đích diễn ra đồng thời trong một giao dịch an toàn.",
      "Bảo toàn tài sản: Chuyển tiền không làm tăng hay giảm tổng tài sản người dùng, ngoại trừ khoản phí giao dịch (Fee) bị trừ ra khỏi tài sản.",
      "Không tính là Thu/Chi sinh hoạt: Giao dịch chuyển tiền không bị tính nhầm vào thu nhập lương hay chi tiêu sinh hoạt khi tính tỷ lệ tiết kiệm.",
    ],
    dbTables: ["public.transfers", "public.wallets", "public.transactions"],
    apiServices: [
      "Supabase RPC / Client Transaction",
      "backend/src/services/financial-snapshot.service.ts",
    ],
    permissions: "user",
    limitations: [
      "Không hỗ trợ chuyển đổi ngoại tệ trực tiếp giữa 2 ví khác loại tiền tệ (ví dụ VND sang USD) trong cùng một thao tác chuyển.",
    ],
    relationships: [
      "Tác động đến 2 ví cùng lúc (Ví nguồn và Ví đích).",
      "Được ghi nhận trong lịch sử giao dịch liên ví.",
    ],
    sourceCodeCitations: [
      "frontend/components/transfer-modal.tsx (Transfer Form Modal)",
      "database/migrations/001_initial_schema.sql (Transfers Table & RLS)",
      "backend/src/services/financial-snapshot.service.ts (Transfer Handling Logic)",
    ],
    keywords: [
      "chuyển tiền", "chuyển khoản", "liên ví", "phí giao dịch", "transfer",
      "rút tiền mặt", "nạp ví", "luân chuyển tiền",
    ],
  },

  categories: {
    id: "categories",
    name: "Quản lý Danh mục Thu Chi (Categories)",
    status: "HOÀN THIỆN",
    purpose:
      "Phân nhóm và cấu trúc các khoản thu chi khoa học (Ăn uống, Nhà ở, Mua sắm, Di chuyển...), phục vụ thống kê ngân sách và phân tích dòng tiền.",
    uiLocation: "Tab 'Cài đặt' / 'Danh mục' hoặc trực tiếp từ menu chọn danh mục trong modal Giao dịch/Ngân sách.",
    workflow: [
      "1. Truy cập phần Quản lý Danh mục.",
      "2. Xem danh sách danh mục mặc định của hệ thống (11 danh mục chi tiêu phổ biến) và danh mục tùy chỉnh cá nhân.",
      "3. Nhấn '+ Thêm danh mục' để tạo danh mục mới.",
      "4. Chọn Phân loại: Chi tiêu (Expense) hoặc Thu nhập (Income).",
      "5. Nhập Tên danh mục, chọn Biểu tượng (Icon) và Màu sắc đại diện.",
      "6. Nhấn 'Lưu danh mục'.",
    ],
    inputsOutputs: {
      inputs: ["name: string", "type: 'income'|'expense'", "icon: string", "color: string"],
      outputs: ["Bản ghi category trong public.categories."],
    },
    validationRules: [
      "Tên danh mục không được để trống.",
      "Phân loại phải là 'income' hoặc 'expense'.",
      "Không thể xóa các danh mục mặc định của hệ thống.",
      "Xóa danh mục tùy chỉnh yêu cầu chuyển các giao dịch hiện có sang danh mục khác hoặc xác nhận an toàn.",
    ],
    businessRules: [
      "Mỗi giao dịch chi tiêu bắt buộc gắn với một danh mục chi tiêu.",
      "Mỗi hạn mức ngân sách được thiết lập theo một danh mục chi tiêu cụ thể.",
    ],
    dbTables: ["public.categories", "public.transactions", "public.budgets"],
    apiServices: ["Supabase client RLS"],
    permissions: "user",
    limitations: [
      "Hệ thống chưa hỗ trợ danh mục con nhiều tầng (sub-categories); hiện tại là mô hình danh mục phẳng 1 cấp tối ưu độ nhanh.",
    ],
    relationships: [
      "Là tiêu chí phân loại cho Giao dịch.",
      "Là đối tượng định mức cho Ngân sách.",
      "Là nhóm phân bổ cho Biểu đồ hình tròn cơ cấu chi tiêu.",
    ],
    sourceCodeCitations: [
      "frontend/components/category-modal.tsx (Category Management Modal)",
      "database/migrations/000_base_schema.sql (Categories Table & Default Seed Data)",
    ],
    keywords: [
      "danh mục", "ăn uống", "mua sắm", "tiền nhà", "thêm danh mục",
      "phân loại", "category", "icon", "màu sắc",
    ],
  },

  budgets_tracking: {
    id: "budgets_tracking",
    name: "Ngân sách Kiểm soát Hạn mức (Tracking Budgets)",
    status: "HOÀN THIỆN",
    purpose:
      "Thiết lập trần chi tiêu tối đa cho từng danh mục trong một kỳ (tuần, tháng) để chủ động kiểm soát chi tiêu mà không giữ tiền trong ví.",
    uiLocation: "Tab 'Ngân sách' trên thanh điều hướng. Nút '+ Thiết lập ngân sách'.",
    workflow: [
      "1. Truy cập Tab 'Ngân sách', nhấn '+ Thiết lập ngân sách'.",
      "2. Chọn Danh mục chi tiêu cần đặt giới hạn (ví dụ: Ăn uống).",
      "3. Nhập Hạn mức chi tiêu tối đa (Limit amount).",
      "4. Chọn Chu kỳ: Hàng tháng (Monthly - mặc định), Hàng tuần (Weekly), hoặc Tùy chọn.",
      "5. Chọn chế độ: 'Theo dõi hạn mức' (Tracking mode).",
      "6. Thiết lập Ngưỡng cảnh báo chi tiêu (mặc định 80%).",
      "7. Nhấn 'Lưu ngân sách'. Thanh tiến độ hiển thị phần trăm đã chi tiêu và cảnh báo màu sắc.",
    ],
    inputsOutputs: {
      inputs: ["category_id: uuid", "amount: number (> 0)", "period: 'monthly'|'weekly'|'custom'", "alert_threshold: number (mặc định 80)"],
      outputs: ["Bản ghi ngân sách trong public.budgets kèm trạng thái SAFE / WARNING / EXCEEDED."],
    },
    validationRules: [
      "Hạn mức chi tiêu phải lớn hơn 0.",
      "Mỗi danh mục chi tiêu chỉ có tối đa một ngân sách kích hoạt trong cùng một chu kỳ.",
    ],
    businessRules: [
      "Chi tiêu thực tế = Tổng số tiền các giao dịch chi tiêu thuộc danh mục trong kỳ hiện tại.",
      "Hạn mức còn lại = Hạn mức - Chi tiêu thực tế.",
      "Chế độ Theo dõi hạn mức KHÔNG giữ tiền trong ví, không làm giảm số dư khả dụng của ví.",
      "Cảnh báo: Khi chi tiêu >= 80% hạn mức chuyển sang trạng thái Cảnh báo (vàng); vượt 100% chuyển sang trạng thái Vượt hạn mức (đỏ).",
      "Chuyển kỳ: Sang chu kỳ mới, hạn mức tự động làm mới cho kỳ mới, không cộng dồn thâm hụt âm.",
    ],
    dbTables: ["public.budgets", "public.transactions", "public.categories"],
    apiServices: [
      "backend/src/services/financial-snapshot.service.ts",
      "backend/src/services/financial-tools.service.ts (get_budget_status)",
    ],
    permissions: "user",
    limitations: [
      "Không tự động khóa quyền chi tiêu khi vượt hạn mức; hệ thống hoạt động theo nguyên tắc cảnh báo nâng cao nhận thức tài chính.",
    ],
    relationships: [
      "Liên kết với Danh mục chi tiêu.",
      "Theo dõi các Giao dịch chi tiêu phát sinh.",
      "Là tiêu chí đánh giá trong Báo cáo tháng và What-If Simulation.",
    ],
    sourceCodeCitations: [
      "frontend/components/budget-modal.tsx (Budget Form Modal)",
      "database/migrations/000_base_schema.sql (Budgets Table)",
      "backend/src/services/financial-snapshot.service.ts#buildAuthoritativeFinancialSnapshot",
    ],
    keywords: [
      "ngân sách", "hạn mức", "giới hạn chi tiêu", "theo dõi hạn mức", "80%",
      "vượt ngân sách", "cảnh báo ngân sách", "budget", "tracking budget",
    ],
  },

  budgets_envelope: {
    id: "budgets_envelope",
    name: "Ngân sách Quỹ Phong bì (Envelope Funding Budgets)",
    status: "HOÀN THIỆN",
    purpose:
      "Phương pháp quản lý ngân sách kỷ luật cao (Zero-based budgeting): Trích giữ trực tiếp tiền từ ví cấp vào 'phong bì' danh mục; tiền trong phong bì chỉ được dùng cho mục đích đó.",
    uiLocation: "Tab 'Ngân sách' -> Chế độ 'Quỹ phong bì' hoặc chọn 'Cấp vốn từ ví' trong modal Ngân sách.",
    workflow: [
      "1. Tạo hoặc chỉnh sửa ngân sách, bật tùy chọn 'Cấp vốn từ ví (Envelope Funding)'.",
      "2. Chọn Ví nguồn cấp vốn (Funding Wallet).",
      "3. Nhập Số tiền trích giữ từ ví để cấp vào quỹ phong bì.",
      "4. Nhấn lưu: Hệ thống tự động tăng `reserved_amount` của ví nguồn và gán vốn cho quỹ phong bì.",
      "5. Khi chi tiêu: Giao dịch có thể trừ trực tiếp từ quỹ phong bì hoặc chi từ ví thông thường.",
      "6. Nạp thêm vốn: Nhấn 'Nạp thêm' (Top-up) để trích thêm tiền từ ví vào phong bì.",
      "7. Hoàn tiền: Nhấn 'Hoàn trả ví' hoặc khi Đóng/Xóa ngân sách, số tiền phong bì thừa lập tức được giải phóng về số dư khả dụng của ví nguồn.",
    ],
    inputsOutputs: {
      inputs: ["budget_id: uuid", "funding_wallet_id: uuid", "allocated_amount: number (> 0)"],
      outputs: ["Cập nhật reserved_amount trong ví nguồn, tạo hạn mức cấp vốn trong ngân sách."],
    },
    validationRules: [
      "Số tiền cấp vốn không được vượt quá Số dư khả dụng của ví nguồn tại thời điểm cấp vốn.",
      "Không thể xóa ví nguồn khi đang có ngân sách phong bì ràng buộc chưa được hoàn trả.",
    ],
    businessRules: [
      "Tiền cấp vốn từ ví được tính vào 'Tiền đã phân bổ' (allocated/reserved_amount) của ví nguồn.",
      "Số dư ví và Số dư quỹ phong bì khác nhau: Ví phản ánh tổng tài sản vật lý; phong bì phản ánh số tiền đã được khoanh vùng cho mục đích cụ thể.",
      "Chi trực tiếp từ ví vẫn tính vào Chi tiêu thực tế và trừ Hạn mức còn lại, nhưng KHÔNG trừ quỹ phong bì.",
      "Quỹ phong bì hết tiền (0đ) KHÔNG ĐỒNG NGHĨA VỚI VƯỢT HẠN MỨC nếu chi thực tế chưa vượt trần hạn mức.",
      "Đóng hoặc xóa ngân sách: Tiền thừa trong phong bì luôn được giải phóng và hoàn trả về số dư khả dụng của ví nguồn.",
    ],
    dbTables: ["public.budgets", "public.wallets", "public.transactions"],
    apiServices: [
      "database/migrations/018_budget_management_integrity.sql",
      "backend/src/services/financial-snapshot.service.ts",
      "backend/src/services/financial-tools.service.ts",
    ],
    permissions: "user",
    limitations: [
      "Một phong bì chỉ liên kết với một ví nguồn cấp vốn duy nhất tại một thời điểm.",
    ],
    relationships: [
      "Ví nguồn cấp vốn (khóa reserved_amount).",
      "Số dư khả dụng của ví nguồn.",
      "Giao dịch chi tiêu được chỉ định trừ quỹ.",
    ],
    sourceCodeCitations: [
      "database/migrations/018_budget_management_integrity.sql (Envelope Integrity Rules & RLS)",
      "frontend/components/budget-modal.tsx (Envelope UI & Top-up/Return Buttons)",
      "backend/src/services/financial-snapshot.service.ts (Authoritative Balance & Allocated Math)",
    ],
    keywords: [
      "quỹ phong bì", "phong bì", "cấp vốn", "envelope", "nạp thêm", "hoàn trả ví",
      "tiền đã phân bổ", "giữ chỗ", "zero based budgeting", "tại sao số dư ví khác ngân sách",
    ],
  },

  savings_goals: {
    id: "savings_goals",
    name: "Mục tiêu Tiết kiệm (Savings Goals)",
    status: "HOÀN THIỆN",
    purpose:
      "Tích lũy tài chính có kế hoạch cho các mục tiêu dài hạn (mua nhà, mua xe máy, laptop, du lịch, quỹ khẩn cấp) bằng cách trích khóa tiền dự trữ an toàn trong ví.",
    uiLocation: "Tab 'Mục tiêu' trên thanh điều hướng hoặc khối 'Mục tiêu tiết kiệm' trên Dashboard. Nút '+ Tạo mục tiêu'.",
    workflow: [
      "1. Nhấn '+ Tạo mục tiêu' để mở modal tạo mục tiêu tiết kiệm.",
      "2. Nhập Tên mục tiêu (ví dụ: 'Mua xe máy Honda', 'Quỹ dự phòng khẩn cấp').",
      "3. Nhập Số tiền cần đạt (Target Amount).",
      "4. Chọn Ngày hạn chót (Deadline) và Icon/Màu sắc biểu trưng.",
      "5. Chọn Ví liên kết mặc định và nhấn 'Tạo mục tiêu'.",
      "6. Nạp tiền (Deposit): Nhấn nút 'Nạp tiền' trên thẻ mục tiêu, chọn ví nguồn và nhập số tiền nạp.",
      "7. Rút tiền (Withdraw): Nhấn nút 'Rút tiền', nhập số tiền cần giải phóng về lại số dư khả dụng của ví.",
    ],
    inputsOutputs: {
      inputs: ["name: string", "target_amount: number (> 0)", "deadline: string (ISO/Date)", "wallet_id: uuid", "deposit_amount?: number", "withdraw_amount?: number"],
      outputs: ["Bản ghi savings_goal, thanh tiến độ %, số tiền còn thiếu, thời gian còn lại."],
    },
    validationRules: [
      "Số tiền mục tiêu phải lớn hơn 0.",
      "Ngày hạn chót phải ở tương lai.",
      "Số tiền nạp vào mục tiêu không được vượt quá Số dư khả dụng của ví nguồn.",
      "Số tiền rút ra không được vượt quá số tiền hiện đang tích lũy trong mục tiêu.",
    ],
    businessRules: [
      "Cơ chế khóa tiền dự trữ: Số tiền nạp vào mục tiêu tiết kiệm được cộng vào `reserved_amount` của ví nguồn.",
      "Tiền nạp vào mục tiêu VẪN THUỘC TỔNG TÀI SẢN của người dùng, không bị mất đi, nhưng bị khóa khỏi Số dư khả dụng để ngăn chi tiêu ngoài dự tính.",
      "Khác biệt cốt lõi với Ngân sách: Ngân sách là trần giới hạn chi tiêu (tiền ra khỏi tài sản); Mục tiêu tiết kiệm là gom tích lũy tài sản (tiền giữ lại trong tài sản).",
      "Xóa mục tiêu: Toàn bộ số tiền đã nạp lập tức được giải phóng hoàn trả về số dư khả dụng của ví nguồn.",
    ],
    dbTables: ["public.savings_goals", "public.wallets"],
    apiServices: [
      "backend/src/services/financial-snapshot.service.ts",
      "backend/src/services/financial-tools.service.ts (get_savings_goals)",
    ],
    permissions: "user",
    limitations: [
      "Không tính lãi suất ngân hàng tự động cho mục tiêu; số dư tích lũy phản ánh số tiền thực tế được trích giữ trong ví.",
    ],
    relationships: [
      "Ví nguồn (khóa và mở khóa reserved_amount).",
      "Tổng tài sản (tính trong tổng tài sản, trừ khỏi khả dụng).",
      "Dashboard và Tư vấn tài chính của Copilot.",
    ],
    sourceCodeCitations: [
      "frontend/components/savings-goal-modal.tsx (Savings Goal Modal)",
      "database/migrations/004_reserved_money.sql (Reserved Money Trigger & Constraints)",
      "backend/src/services/financial-tools.service.ts#get_savings_goals",
    ],
    keywords: [
      "mục tiêu tiết kiệm", "tiết kiệm", "tích lũy", "nạp tiền mục tiêu", "rút tiền mục tiêu",
      "hạn chót", "mua xe", "mua laptop", "quỹ khẩn cấp", "savings goal",
    ],
  },

  recurring_transactions: {
    id: "recurring_transactions",
    name: "Giao dịch Định kỳ (Recurring Transactions)",
    status: "HOÀN THIỆN",
    purpose:
      "Tự động hóa hoặc nhắc nhở các khoản chi thu lặp lại theo chu kỳ cố định (tiền thuê nhà, tiền mạng, học phí, tiền lương) để không bao giờ quên thanh toán.",
    uiLocation: "Tab 'Giao dịch' -> Tab phụ 'Giao dịch định kỳ' hoặc nút 'Thiết lập định kỳ'.",
    workflow: [
      "1. Truy cập trang Giao dịch định kỳ, nhấn '+ Tạo giao dịch định kỳ'.",
      "2. Chọn Phân loại: Chi tiêu hoặc Thu nhập.",
      "3. Nhập Số tiền, Danh mục, Ví thanh toán và Ghi chú.",
      "4. Chọn Chu kỳ lặp: Hàng ngày (daily), Hàng tuần (weekly), Hai tuần một lần (bi-weekly), Hàng tháng (monthly - có hỗ trợ ngày cuối tháng), Hàng năm (yearly).",
      "5. Chọn Ngày bắt đầu và Ngày kết thúc (tùy chọn).",
      "6. Chọn Chế độ xử lý: Tự động (Auto) hoặc Nhắc nhở (Reminder).",
      "7. Nhấn 'Lưu định kỳ'.",
    ],
    inputsOutputs: {
      inputs: ["type: 'income'|'expense'", "amount: number", "category_id: uuid", "wallet_id: uuid", "frequency: string", "processing_mode: 'auto'|'reminder'", "start_date: string"],
      outputs: ["Bản ghi mẫu định kỳ trong recurring_transactions và lịch sử chạy trong recurring_occurrences."],
    },
    validationRules: [
      "Số tiền phải lớn hơn 0.",
      "Ngày bắt đầu hợp lệ.",
      "Tần suất lặp phải thuộc danh sách hỗ trợ: daily, weekly, bi-weekly, monthly, yearly.",
    ],
    businessRules: [
      "Tính Idempotent: Mọi lần chạy đều được ghi nhận vào bảng `recurring_occurrences` để đảm bảo tuyệt đối không sinh trùng giao dịch.",
      "Phân biệt rõ ràng: Cấu hình định kỳ chỉ là MẪU LÊN LỊCH; chỉ khi giao dịch được tạo trong bảng `transactions` thì mới ảnh hưởng đến số dư ví.",
      "Chế độ Nhắc nhở gửi thông báo đến người dùng trước N ngày để người dùng duyệt số tiền thực tế trước khi ghi sổ.",
    ],
    dbTables: ["public.recurring_transactions", "public.recurring_occurrences", "public.transactions"],
    apiServices: [
      "database/migrations/003_recurring_transactions_v2.sql",
      "Worker Cron Job Service",
    ],
    permissions: "user",
    limitations: [
      "Chế độ tự động phụ thuộc vào cron worker kích hoạt định kỳ của hệ thống máy chủ.",
    ],
    relationships: [
      "Tự động tạo bản ghi trong bảng Transactions khi đến hạn.",
      "Ảnh hưởng đến Ví tiền và Ngân sách khi giao dịch được sinh ra.",
      "Hiển thị thông báo trong Notification Center.",
    ],
    sourceCodeCitations: [
      "database/migrations/003_recurring_transactions_v2.sql (Recurring Engine Schema & Functions)",
      "frontend/components/dashboard.tsx (Recurring UI Tab)",
    ],
    keywords: [
      "giao dịch định kỳ", "lặp lại", "tiền nhà", "hóa đơn định kỳ", "tiền mạng",
      "hàng tháng", "tự động", "nhắc nhở", "recurring",
    ],
  },

  smart_input: {
    id: "smart_input",
    name: "Nhập nhanh Thông minh bằng Ngôn ngữ Tự nhiên (Smart Natural Language Input)",
    status: "HOÀN THIỆN",
    purpose:
      "Cho phép người dùng gõ câu văn tiếng Việt tự nhiên để ghi chép nhanh một hoặc nhiều giao dịch mà không cần mở form điền từng trường thủ công.",
    uiLocation: "Thanh nhập nhanh (Input Bar) đặt nổi bật ở đầu trang Dashboard hoặc đầu Bảng giao dịch.",
    workflow: [
      "1. Nhấp chuột vào ô nhập nhanh 'Nhập nhanh chi tiêu: Ăn sáng 35k tiền mặt, Đổ xăng 70k...'.",
      "2. Gõ câu tự nhiên tiếng Việt, ví dụ: 'Ăn sáng 35k tiền mặt' hoặc 'Nhận lương 15 triệu ngân hàng' hoặc 'Ăn trưa 50k, Cà phê 30k'.",
      "3. Nhấn phím Enter hoặc nút Phân tích.",
      "4. Hệ thống trích xuất tức thì các trường: Số tiền, Danh mục gợi ý, Ví nguồn, Loại thu/chi, Ngày.",
      "5. Hộp thoại xem trước (Draft Preview) hiển thị để người dùng kiểm tra nhanh và bấm 'Xác nhận lưu'.",
    ],
    inputsOutputs: {
      inputs: ["text: string (câu tiếng Việt tự nhiên)"],
      outputs: ["Mảng TransactionDraft (amount, category, wallet, type, currency, note)."],
    },
    validationRules: [
      "Câu nhập phải chứa số tiền nhận diện được (hỗ trợ các hậu tố k, nghìn, ngàn, tr, triệu, usd).",
      "Bộ lọc làm sạch (Sanitizer) tự động khử các mẫu câu tiêm nhiễm mã độc (Prompt Injection).",
    ],
    businessRules: [
      "Hỗ trợ phân tách nhiều giao dịch bằng dấu phẩy trong cùng một câu lệnh.",
      "Nhận diện đúng đơn vị tiền tệ ngoại tệ (ví dụ '15 USD' không bị ép về VND).",
      "Người dùng luôn là người xác nhận cuối cùng (Human-in-the-loop) trước khi ghi vào database.",
    ],
    dbTables: ["public.transactions", "public.categories", "public.wallets"],
    apiServices: [
      "backend/src/services/ai-parser.service.ts (Rule-based & Regex NLP Engine)",
      "/api/ai/classify",
    ],
    permissions: "user",
    limitations: [
      "Nếu câu quá mơ hồ hoặc không nêu tên ví, hệ thống sẽ gán ví mặc định (hoặc ví đầu tiên) để người dùng chọn lại trên preview.",
    ],
    relationships: [
      "Tạo nhanh giao dịch vào hệ thống Transactions.",
      "Tự động khớp tên Ví và Danh mục hiện có của người dùng.",
    ],
    sourceCodeCitations: [
      "backend/src/services/ai-parser.service.ts (NLP Pattern Matcher & Multi-item Splitter)",
      "frontend/components/dashboard.tsx (Smart Input Component & Handlers)",
      "tests/ai-parse-transaction.test.mjs (Unit Tests for Smart NLP Input)",
    ],
    keywords: [
      "nhập nhanh", "ngôn ngữ tự nhiên", "cú pháp", "ăn sáng 35k", "đổ xăng 70k",
      "nhập thông minh", "smart input", "nlp parser",
    ],
  },

  receipt_ocr: {
    id: "receipt_ocr",
    name: "AI Quét Hóa đơn & Biên lai (Receipt Scanner OCR)",
    status: "HOÀN THIỆN",
    purpose:
      "Tự động trích xuất thông tin chi tiêu từ ảnh chụp hóa đơn mua hàng, biên lai siêu thị, phiếu thanh toán qua mô hình Vision AI để điền form tự động.",
    uiLocation: "Biểu tượng Camera trên thanh nhập liệu hoặc nút 'Quét hóa đơn' trên giao diện.",
    workflow: [
      "1. Nhấn biểu tượng Camera để mở Receipt Scanner Modal.",
      "2. Chọn Chụp ảnh trực tiếp từ webcam/camera hoặc Tải tệp ảnh từ máy (JPEG, PNG, WEBP).",
      "3. Hệ thống gửi ảnh tới dịch vụ AI OCR (LLaVA Vision Model / FastAPI).",
      "4. AI tự động bóc tách: Tổng số tiền thanh toán, Tên cửa hàng/địa điểm, Ngày hóa đơn, Danh mục đề xuất và Danh sách chi tiết các món hàng.",
      "5. Người dùng rà soát lại thông tin trên giao diện Preview và nhấn 'Lưu vào sổ chi tiêu'.",
      "6. Ảnh biên lai được lưu trữ an toàn trong Supabase Storage bucket.",
    ],
    inputsOutputs: {
      inputs: ["file: File (image/jpeg, image/png, image/webp <= 10MB)"],
      outputs: ["JSON bóc tách (total, merchant, date, category, items) và receipt_url đính kèm giao dịch."],
    },
    validationRules: [
      "Dung lượng tệp ảnh không vượt quá 10MB.",
      "Định dạng tệp phải là hình ảnh hợp lệ.",
      "Nếu AI không đọc được số tiền do ảnh quá mờ, modal yêu cầu người dùng xác nhận hoặc nhập tay số tiền.",
    ],
    businessRules: [
      "Bảo mật quyền riêng tư: Ảnh biên lai chỉ thuộc quyền xem của người tải lên qua RLS storage bucket.",
      "Luôn có bước người dùng xác nhận lại trước khi tạo giao dịch chính thức.",
    ],
    dbTables: ["public.transactions (receipt_url)", "storage.objects (receipts bucket)"],
    apiServices: [
      "/api/receipt/parse (Next.js Proxy API)",
      "ai_service/app.py (FastAPI Vision OCR Endpoint)",
      "Supabase Storage",
    ],
    permissions: "user",
    limitations: [
      "Chất lượng nhận diện phụ thuộc vào độ sắc nét của ảnh chụp (ảnh quá mờ, nhăn hoặc thiếu sáng có thể cần chỉnh lại tay).",
      "Yêu cầu container AI Vision hoặc mô hình LLaVA đang hoạt động.",
    ],
    relationships: [
      "Tạo bản ghi giao dịch trong Transactions kèm link ảnh hóa đơn.",
      "Tự động khớp vào Danh mục và Ngân sách tương ứng.",
    ],
    sourceCodeCitations: [
      "frontend/components/receipt-scanner-modal.tsx (Receipt Scanner Modal Component)",
      "ai_service/app.py (Vision AI LLaVA OCR Handler)",
      "frontend/components/finance-app.tsx (Modal Integration)",
    ],
    keywords: [
      "quét hóa đơn", "chụp hóa đơn", "biên lai", "ocr", "camera", "llava",
      "vision ai", "receipt scanner", "bóc tách hóa đơn",
    ],
  },

  excel_csv_import: {
    id: "excel_csv_import",
    name: "Nhập Dữ liệu từ Excel & CSV (Data Import)",
    status: "HOÀN THIỆN",
    purpose:
      "Cho phép người dùng nhập hàng loạt lịch sử chi tiêu từ file Excel hoặc CSV (sao kê ngân hàng, sổ tay tài chính cũ) vào ứng dụng với tính năng tự động phát hiện trùng lặp.",
    uiLocation: "Nút 'Nhập Excel/CSV' trên thanh công cụ trang Giao dịch.",
    workflow: [
      "1. Nhấn nút 'Nhập Excel/CSV' để mở Import Modal.",
      "2. Tải file mẫu (Template .xlsx/.csv) nếu cần định dạng chuẩn.",
      "3. Kéo thả hoặc chọn tệp Excel (.xlsx, .xls) hoặc .csv từ máy tính.",
      "4. Trình duyệt phân tích tệp cục bộ và hiển thị màn hình Ánh xạ cột (Column Mapping): Cột Ngày, Cột Số tiền, Cột Danh mục, Cột Ví, Cột Ghi chú.",
      "5. Hệ thống chạy thuật toán phát hiện trùng lặp (Duplicate Detection Hash) để cảnh báo các giao dịch đã tồn tại.",
      "6. Chọn các dòng cần nhập và nhấn 'Tiến hành nhập'. Giao dịch được lưu hàng loạt.",
    ],
    inputsOutputs: {
      inputs: ["file: .xlsx, .xls, .csv (< 10MB, tối đa 5.000 dòng/lần)"],
      outputs: ["Danh sách giao dịch được tạo hàng loạt trong public.transactions."],
    },
    validationRules: [
      "Cột Số tiền bắt buộc phải parse được ra số dương.",
      "Cột Ngày phải đúng định dạng ngày tháng hợp lệ (DD/MM/YYYY hoặc YYYY-MM-DD).",
      "Cột Ví và Danh mục được tự động ánh xạ hoặc gán mặc định nếu không khớp.",
    ],
    businessRules: [
      "Xử lý hoàn toàn phía Client (Client-Side Parsing): Dữ liệu file không gửi lên server trung gian của bên thứ ba, bảo mật tuyệt đối.",
      "Thuật toán chống trùng lặp tạo chữ ký hash dựa trên: Ngày + Số tiền + Danh mục + Ghi chú để ngăn nhập trùng.",
    ],
    dbTables: ["public.transactions", "public.categories", "public.wallets"],
    apiServices: [
      "frontend/components/import-modal.tsx",
      "frontend/services/excel-import.ts",
    ],
    permissions: "user",
    limitations: [
      "Giới hạn 5.000 dòng mỗi lần nhập để đảm bảo hiệu năng mượt mà của trình duyệt.",
    ],
    relationships: [
      "Tạo hàng loạt giao dịch vào phân hệ Transactions.",
      "Khớp nối tự động với Danh mục và Ví.",
    ],
    sourceCodeCitations: [
      "frontend/components/import-modal.tsx (Import Modal Component)",
      "frontend/services/excel-import.ts (Client-side Excel/CSV Parser & Mapping)",
      "tests/excel-csv-import.test.mjs (Unit Tests for Import & Duplicate Detection)",
    ],
    keywords: [
      "nhập excel", "nhập csv", "import", "sao kê", "tải lên sổ sách",
      "trùng lặp", "duplicate detection", "column mapping",
    ],
  },

  excel_export: {
    id: "excel_export",
    name: "Xuất Báo cáo Tài chính Excel (.xlsx)",
    status: "HOÀN THIỆN",
    purpose:
      "Xuất toàn bộ sổ sách tài chính cá nhân ra file Excel (.xlsx) tiêu chuẩn đa trang tính (Multi-sheet) để lưu trữ, sao lưu hoặc tự phân tích nâng cao.",
    uiLocation: "Nút 'Xuất Excel' đặt trên Dashboard (phần Lịch sử giao dịch hoặc Báo cáo).",
    workflow: [
      "1. Nhấn nút 'Xuất Excel' trên giao diện Dashboard.",
      "2. Trình duyệt kích hoạt trình ghi OOXML nội bộ kết hợp thư viện nén `fflate` tốc độ cao.",
      "3. Hệ thống tạo file Excel tiêu chuẩn với 4 trang tính riêng biệt:",
      "   - Sheet 1: Danh sách Ví & Số dư (Số dư thực tế, Tiền dự trữ, Khả dụng).",
      "   - Sheet 2: Lịch sử Giao dịch chi tiết (Ngày, Loại, Số tiền, Danh mục, Ví, Ghi chú).",
      "   - Sheet 3: Bảng Ngân sách (Hạn mức, Chi thực tế, Còn lại, Quỹ phong bì).",
      "   - Sheet 4: Mục tiêu Tiết kiệm (Mục tiêu, Đã tích lũy, Còn thiếu, Hạn chót).",
      "4. Tệp tự động tải về máy người dùng với định dạng: `so-chi-tieu-YYYY-MM-DD.xlsx`.",
    ],
    inputsOutputs: {
      inputs: ["Dữ liệu tài chính hiện có của người dùng từ bộ nhớ client."],
      outputs: ["Tệp nhị phân .xlsx chuẩn OpenXML tải trực tiếp về máy."],
    },
    validationRules: [
      "Chỉ xuất dữ liệu thuộc quyền sở hữu của người dùng hiện tại.",
    ],
    businessRules: [
      "Tạo file 100% Client-side bằng JavaScript tinh gọn, không chạy qua bất kỳ server trung gian nào, bảo vệ quyền riêng tư tài chính tuyệt đối.",
      "Dữ liệu số tiền được định dạng số chuẩn trong Excel, hỗ trợ công thức tính toán tiếp.",
    ],
    dbTables: ["public.wallets", "public.transactions", "public.budgets", "public.savings_goals"],
    apiServices: [
      "frontend/services/excel-export.ts (In-house OOXML Generator via fflate)",
    ],
    permissions: "user",
    limitations: [
      "Yêu cầu trình duyệt hỗ trợ Blob API và quyền tải tệp tin.",
    ],
    relationships: [
      "Tổng hợp dữ liệu từ Ví, Giao dịch, Ngân sách và Mục tiêu tiết kiệm.",
    ],
    sourceCodeCitations: [
      "frontend/services/excel-export.ts (OOXML Workbook Builder & fflate Compression)",
      "frontend/components/dashboard.tsx (Export Button Trigger)",
    ],
    keywords: [
      "xuất excel", "file excel", "báo cáo excel", "export", "tải sổ sách",
      "sao lưu dữ liệu", "xlsx", "fflate", "ooxml",
    ],
  },

  monthly_review: {
    id: "monthly_review",
    name: "Đánh giá & Tổng kết Tháng (Monthly Review)",
    status: "HOÀN THIỆN",
    purpose:
      "Cung cấp bức tranh toàn cảnh về sức khỏe tài chính sau mỗi tháng: tổng kết thu chi, tính toán tỷ lệ tiết kiệm ròng, đối chiếu với tháng trước và đưa ra định hướng tháng tiếp theo.",
    uiLocation: "Nút 'Đánh giá tháng' hoặc banner nhắc nhở tổng kết trên Dashboard.",
    workflow: [
      "1. Nhấn nút 'Đánh giá tháng' trên Dashboard để mở Monthly Review Modal.",
      "2. Chọn Tháng và Năm cần đánh giá.",
      "3. Xem các chỉ số tài chính cốt lõi:",
      "   - Tổng thu nhập trong tháng.",
      "   - Tổng chi tiêu trong tháng.",
      "   - Tiết kiệm ròng = Tổng thu - Tổng chi.",
      "   - Tỷ lệ tiết kiệm = (Tiết kiệm ròng / Tổng thu) * 100%.",
      "4. Xem phân tích so sánh với tháng liền kề (mức tăng/giảm chi tiêu, danh mục biến động).",
      "5. Nhấn 'Tải báo cáo tháng này (.xlsx)' nếu muốn xuất riêng báo cáo của tháng đó.",
    ],
    inputsOutputs: {
      inputs: ["month: number (1-12)", "year: number"],
      outputs: ["Báo cáo phân tích tháng, tỷ lệ tiết kiệm %, biểu đồ so sánh."],
    },
    validationRules: [
      "Tháng từ 1 đến 12, năm hợp lệ.",
    ],
    businessRules: [
      "Tiết kiệm ròng = Tổng thu nhập - Tổng chi tiêu.",
      "Tỷ lệ tiết kiệm (%) = (Tiết kiệm ròng / Tổng thu nhập) * 100% (nếu thu nhập > 0).",
      "Loại trừ các giao dịch chuyển tiền liên ví khỏi phép tính thu chi sinh hoạt.",
    ],
    dbTables: ["public.transactions", "public.budgets"],
    apiServices: [
      "frontend/components/monthly-review-modal.tsx",
      "backend/src/services/financial-context.service.ts",
    ],
    permissions: "user",
    limitations: [
      "Độ chính xác của báo cáo phản ánh trung thực mức độ đầy đủ của các giao dịch người dùng đã ghi nhận.",
    ],
    relationships: [
      "Tổng hợp từ Giao dịch và Ngân sách trong tháng.",
      "Liên kết với Xuất Excel cho tháng cụ thể.",
    ],
    sourceCodeCitations: [
      "frontend/components/monthly-review-modal.tsx (Monthly Review Modal Component)",
      "backend/src/services/financial-context.service.ts (Monthly Comparison Math)",
    ],
    keywords: [
      "đánh giá tháng", "tổng kết tháng", "monthly review", "tiết kiệm ròng",
      "tỷ lệ tiết kiệm", "so sánh tháng trước", "sức khỏe tài chính",
    ],
  },

  reports_charts: {
    id: "reports_charts",
    name: "Báo cáo Dòng tiền & Biểu đồ (Reports & Analytics)",
    status: "HOÀN THIỆN",
    purpose:
      "Trực quan hóa diễn biến tài chính qua biểu đồ cột dòng tiền Thu - Chi theo thời gian và biểu đồ hình tròn cơ cấu phân bổ chi tiêu theo từng danh mục.",
    uiLocation: "Tab 'Báo cáo' trên thanh điều hướng chính.",
    workflow: [
      "1. Chuyển sang Tab 'Báo cáo'.",
      "2. Chọn khoảng thời gian phân tích: Hôm nay, Tuần này, Tháng này, Năm nay, hoặc Tùy chọn ngày.",
      "3. Chọn bộ lọc Ví (tất cả ví hoặc một ví cụ thể).",
      "4. Quan sát Biểu đồ Dòng tiền (Cash Flow Chart): So sánh cột Thu và Chi theo từng ngày hoặc từng tháng.",
      "5. Quan sát Biểu đồ Cơ cấu Chi tiêu (Expense Donut Chart): Tỷ lệ % chi tiêu của từng danh mục.",
      "6. Xem danh sách chi tiết các danh mục chi nhiều nhất kèm số tiền cụ thể.",
    ],
    inputsOutputs: {
      inputs: ["period: string", "wallet_id?: uuid", "date_range?: { start, end }"],
      outputs: ["Biểu đồ SVG tương tác, số liệu tổng hợp dòng tiền và cơ cấu chi tiêu."],
    },
    validationRules: [
      "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.",
      "Tách biệt hiển thị theo từng loại tiền tệ (VND, USD).",
    ],
    businessRules: [
      "Không gộp giao dịch chuyển tiền liên ví vào dòng tiền thu chi để tránh tạo số liệu ảo.",
      "Phần trăm cơ cấu chi tiêu được tính trên tổng chi tiêu thực tế của kỳ đã chọn.",
    ],
    dbTables: ["public.transactions", "public.categories"],
    apiServices: [
      "Frontend Chart Rendering Components",
      "backend/src/services/financial-snapshot.service.ts",
    ],
    permissions: "user",
    limitations: [
      "Hiện tại tập trung vào phân tích trong năm; chưa có biểu đồ dự báo tài chính đa năm (multi-year projection) trong tab Reports.",
    ],
    relationships: [
      "Lấy dữ liệu từ Transactions và Categories.",
      "Đồng bộ với bộ lọc thời gian trên Dashboard.",
    ],
    sourceCodeCitations: [
      "frontend/components/dashboard.tsx#renderReports (Reports & Analytics Views)",
      "frontend/services/financial-insights.ts (Trend Analytics)",
    ],
    keywords: [
      "báo cáo", "biểu đồ", "dòng tiền", "cơ cấu chi tiêu", "cash flow",
      "donut chart", "phân tích", "chi nhiều nhất",
    ],
  },

  admin_rbac: {
    id: "admin_rbac",
    name: "Phân quyền Người dùng & Cổng Quản trị (Admin RBAC & Portal)",
    status: "HOÀN THIỆN",
    purpose:
      "Cung cấp hệ thống phân quyền hai cấp độ (User và Admin), bảng điều khiển quản trị tập trung để quản lý tài khoản người dùng, xem audit logs bất biến và kiểm soát truy cập.",
    uiLocation: "Đường dẫn `/admin` (chỉ hiển thị và truy cập được với tài khoản có role `admin` trong bảng `user_roles`).",
    workflow: [
      "1. Quản trị viên đăng nhập với tài khoản có quyền Admin trong cơ sở dữ liệu.",
      "2. Hệ thống hiển thị nút 'Trang quản trị' trên Header hoặc truy cập trực tiếp URL `/admin`.",
      "3. Tab 'Quản lý người dùng': Xem danh sách tài khoản, trạng thái, đình chỉ (Suspend) hoặc khôi phục (Restore) tài khoản.",
      "4. Tab 'Nhật ký kiểm toán (Audit Logs)': Tra cứu các thao tác quản trị viên đã thực hiện theo thời gian thực.",
      "5. Người dùng bình thường khi cố tình truy cập `/admin` sẽ bị chuyển hướng hoặc từ chối truy cập (403 Forbidden).",
    ],
    inputsOutputs: {
      inputs: ["Admin actions: suspend_user, restore_user, filter_audit_logs."],
      outputs: ["Danh sách người dùng, trạng thái kích hoạt, bản ghi nhật ký kiểm toán."],
    },
    validationRules: [
      "Xác thực phân quyền nghiêm ngặt phía server qua `getUserRole(token)` đối chiếu bảng `public.user_roles`.",
      "Chặn đứng hành vi tự thăng quyền (Anti-self-promotion): Không có API cho phép người dùng tự đổi role của mình.",
    ],
    businessRules: [
      "Nguyên tắc Riêng tư Tuyệt đối: Quản trị viên CHỈ xem các chỉ số thống kê tổng hợp (tổng user, trạng thái hoạt động, audit logs); TUYỆT ĐỐI KHÔNG CÓ QUYỀN xem giao dịch chi tiêu, số dư ví riêng tư của người dùng.",
      "Mọi thao tác quản trị đều được ghi vết tự động vào bảng bất biến `admin_audit_logs` (Append-only).",
    ],
    dbTables: ["public.user_roles", "public.profiles", "public.admin_audit_logs"],
    apiServices: [
      "backend/src/services/admin-auth.service.ts",
      "/api/admin/users",
      "/api/admin/audit-logs",
    ],
    permissions: "admin",
    limitations: [
      "Quyền Admin chỉ được cấp trực tiếp qua backend hoặc database migration; không cấp qua giao diện thông thường.",
    ],
    relationships: [
      "Kiểm soát quyền truy cập toàn bộ các API `/api/admin/*`.",
      "Bảo vệ dữ liệu người dùng trước các truy cập trái phép.",
    ],
    sourceCodeCitations: [
      "frontend/features/admin/admin-app.tsx (Admin Application Shell)",
      "frontend/features/admin/views/users.tsx (User Management View)",
      "database/migrations/013_admin_rbac.sql (RBAC Schema & Functions)",
      "tests/admin-rbac.test.mjs (Unit Tests for RBAC Protection)",
    ],
    keywords: [
      "admin", "quản trị", "phân quyền", "rbac", "user_roles", "khóa tài khoản",
      "đình chỉ", "audit logs", "nhật ký kiểm toán", "admin portal",
    ],
  },

  admin_monitoring: {
    id: "admin_monitoring",
    name: "Giám sát AI, Cờ Tính năng & Cài đặt Hệ thống (AI Monitoring & Settings)",
    status: "HOÀN THIỆN",
    purpose:
      "Cho phép quản trị viên theo dõi hiệu năng hệ thống AI (độ trễ, lỗi, prompt injection), quản lý cờ tính năng (Feature Flags), điều hướng Canary Deployment và gửi thông báo toàn hệ thống.",
    uiLocation: "Bảng điều khiển Admin -> Tab 'Giám sát AI', 'Cấu hình hệ thống' và 'Thông báo'.",
    workflow: [
      "1. Truy cập `/admin`, mở Tab 'Giám sát AI' để xem: Tổng số lượt gọi AI, Độ trễ trung bình (ms), Số lượt can thiệp bảo mật, Tỷ lệ lỗi.",
      "2. Mở Tab 'Cấu hình hệ thống' để điều chỉnh tỷ lệ Canary Routing (0% đến 100%), bật/tắt các cờ tính năng thử nghiệm.",
      "3. Mở Tab 'Thông báo' để soạn và phát sóng thông báo (Broadcast Notification) tới người dùng hệ thống.",
    ],
    inputsOutputs: {
      inputs: ["canary_percentage: number (0-100)", "feature_flags: Record<string, boolean>", "broadcast_message: string"],
      outputs: ["Cập nhật cấu hình bảng system_settings, gửi thông báo hệ thống làm sạch XSS."],
    },
    validationRules: [
      "Tỷ lệ Canary phải nằm trong khoảng từ 0 đến 100.",
      "Nội dung thông báo phát sóng tự động được lọc và làm sạch mã độc HTML/Script (XSS Sanitizer).",
      "Tuyệt đối không lưu trữ khóa bí mật (Secrets, Service Role Key) trong bảng cài đặt giao diện.",
    ],
    businessRules: [
      "Canary Routing có tính gắn kết (Stickiness) theo user_id: Cùng một người dùng luôn nhận cùng một nhóm trải nghiệm (cohort).",
      "Bảo mật Secrets: Không cho phép sửa đổi hoặc lộ connection string, service role key qua giao diện web.",
    ],
    dbTables: ["public.system_settings", "public.ai_usage_logs", "public.system_notifications", "public.feedback_moderation"],
    apiServices: [
      "/api/admin/system-settings",
      "/api/admin/ai-monitoring",
      "/api/admin/notifications",
      "backend/src/services/ai-canary.service.ts",
    ],
    permissions: "admin",
    limitations: [
      "Chỉ thay đổi cấu hình runtime vận hành, không sửa đổi trực tiếp schema cơ sở dữ liệu từ giao diện.",
    ],
    relationships: [
      "Điều phối phiên bản dịch vụ AI gửi tới người dùng.",
      "Ghi nhận telemetry và phản hồi chất lượng từ người dùng.",
    ],
    sourceCodeCitations: [
      "frontend/features/admin/views/ai-monitoring.tsx (AI Telemetry View)",
      "frontend/features/admin/views/system-settings.tsx (Settings & Feature Flags)",
      "database/migrations/014_system_settings_and_audit.sql",
      "tests/ai-canary-routing.test.mjs (Canary Routing & Stickiness Tests)",
    ],
    keywords: [
      "giám sát ai", "canary routing", "cờ tính năng", "feature flags",
      "cấu hình hệ thống", "thông báo hệ thống", "ai monitoring", "telemetry",
    ],
  },

  ai_financial_copilot: {
    id: "ai_financial_copilot",
    name: "Trợ lý AI Tài chính Thông minh (Financial Copilot & Agentic System)",
    status: "HOÀN THIỆN",
    purpose:
      "Trợ lý AI đồng hành thông minh, có khả năng phân tích số dư thực tế, ngân sách, mục tiêu, mô phỏng mua sắm What-If, tư vấn tài chính cá nhân hóa, tra cứu tri thức hệ thống và hỗ trợ hội thoại nhiều lượt.",
    uiLocation: "Hộp thoại Chatbot nổi ở góc dưới bên phải màn hình (Floating Widget) hoặc Tab Trợ lý AI.",
    workflow: [
      "1. Nhấn vào biểu tượng Chatbot ở góc dưới phải để mở cửa sổ trò chuyện.",
      "2. Đặt câu hỏi bằng tiếng Việt tự nhiên (hỏi số dư, hỏi cách sử dụng ứng dụng, hỏi tư vấn chi tiêu hoặc mô phỏng mua sắm).",
      "3. Intent Router phân tích ý định, kích hoạt các công cụ tính toán xác định (Deterministic Tools) hoặc tra cứu tri thức RAG.",
      "4. AI phản hồi với số liệu chuẩn xác, in đậm các số tiền quan trọng, kèm định dạng Markdown rõ ràng.",
      "5. Người dùng có thể hỏi tiếp nối (follow-up) và AI tự động ghi nhớ ngữ cảnh lượt trước.",
    ],
    inputsOutputs: {
      inputs: ["message: string (tối đa 2.000 ký tự)", "history: ChatMessage[]"],
      outputs: ["reply: string (tiếng Việt, Markdown chuẩn)"],
    },
    validationRules: [
      "Độ dài tin nhắn không vượt quá 2.000 ký tự.",
      "Tự động chặn các câu hỏi lạc đề ngoài phạm vi tài chính (Off-topic filter).",
      "Khử độc và vô hiệu hóa các câu lệnh Prompt Injection.",
    ],
    businessRules: [
      "Cơ chế Cố vấn Đọc (Read-Only Guardrail): Tuyệt đối KHÔNG có quyền tự tạo, xóa hay sửa giao dịch qua hội thoại.",
      "Tính toán Xác định (Deterministic Computation): Mọi số dư ví, tiền đã phân bổ, khả dụng, ngân sách và mô phỏng What-If được tính toán bằng mã nguồn máy chủ, không để AI suy đoán hay tính nhẩm.",
      "Cô lập Dữ liệu: Tuyệt đối KHÔNG đưa số dư hay dữ liệu tài chính cá nhân vào câu trả lời khi người dùng chỉ hỏi về chức năng hệ thống hoặc kiến thức kinh tế tổng quát.",
      "Hội thoại nhiều lượt (Multi-turn Memory): Tự động kế thừa món đồ, giá tiền và chủ đề ở lượt trước khi người dùng hỏi các câu tiếp nối ('Nếu mua món đó thì còn bao nhiêu?', 'Với số tiền đó nên làm gì?').",
      "Xử lý khi lỗi kết nối DB: Thông báo rõ ràng dữ liệu tài chính tạm thời không khả dụng, tuyệt đối không mặc định số dư bằng 0 VND.",
    ],
    dbTables: ["Truy vấn dữ liệu tài chính người dùng qua RLS server context"],
    apiServices: [
      "/api/chat (Chat API Route)",
      "backend/src/services/ai-chat.service.ts",
      "backend/src/services/financial-tools.service.ts",
      "backend/src/services/financial-simulation.service.ts",
      "backend/src/services/system-rag.service.ts",
    ],
    permissions: "user",
    limitations: [
      "Cần kết nối tới dịch vụ AI (Ollama trên localhost hoặc AI Service container).",
    ],
    relationships: [
      "Kết nối và hiểu toàn bộ các phân hệ dữ liệu trong Sổ Chi Tiêu.",
    ],
    sourceCodeCitations: [
      "backend/src/services/ai-chat.service.ts (Core AI Chat Orchestration)",
      "backend/src/services/financial-tools.service.ts (Deterministic Financial Tools)",
      "backend/src/services/financial-simulation.service.ts (What-If Simulation Engine)",
      "backend/src/services/ai-router.service.ts (Intent Router & Multi-turn Resolver)",
    ],
    keywords: [
      "trợ lý ai", "chatbot", "financial copilot", "tư vấn tài chính", "hỏi số dư",
      "what if", "mô phỏng mua sắm", "lời khuyên tài chính", "hội thoại",
    ],
  },

  currency_isolation: {
    id: "currency_isolation",
    name: "Nguyên tắc Cô lập Đa Tiền tệ (Multi-Currency Isolation)",
    status: "HOÀN THIỆN",
    purpose:
      "Bảo đảm tính toàn vẹn toán học và kế toán: Tách biệt tuyệt đối các đơn vị tiền tệ khác nhau (VND, USD), ngăn chặn triệt để việc cộng dồn sai lệch.",
    uiLocation: "Áp dụng xuyên suốt trên toàn bộ giao diện Dashboard, danh sách Ví, Báo cáo và lời thoại của AI Copilot.",
    workflow: [
      "1. Khi tạo ví, người dùng chọn loại tiền tệ (VND hoặc USD).",
      "2. Mọi giao dịch gắn với ví đều thừa hưởng đơn vị tiền tệ của ví đó.",
      "3. Hệ thống nhóm riêng số dư, tổng thu, tổng chi và hạn mức theo từng loại tiền tệ.",
      "4. AI Copilot luôn kèm ký hiệu tiền tệ rõ ràng khi báo cáo số liệu.",
    ],
    inputsOutputs: {
      inputs: ["Ví và giao dịch với các loại tiền tệ VND, USD."],
      outputs: ["Báo cáo số dư và dòng tiền được tách thành các nhóm tiền tệ độc lập."],
    },
    validationRules: [
      "Tuyệt đối không cộng gộp trực tiếp số tiền VND và USD (ví dụ: 1.000.000 VND và 50 USD báo cáo riêng, không bao giờ cộng thành 1.000.050).",
    ],
    businessRules: [
      "Mỗi đơn vị tiền tệ có một bức tranh tài chính độc lập.",
      "Tỷ giá ngoại tệ thời gian thực chỉ dùng cho mục đích tra cứu tham chiếu, không tự ý quy đổi ngầm số dư thực tế.",
    ],
    dbTables: ["public.wallets (currency)", "public.transactions (currency)"],
    apiServices: [
      "backend/src/services/financial-context.service.ts",
      "backend/src/services/exchange-rate.service.ts",
    ],
    permissions: "all",
    limitations: [
      "Chưa có tính năng tự động quy đổi số dư ví USD sang VND theo tỷ giá thị trường thời gian thực trên giao diện chính.",
    ],
    relationships: [
      "Áp dụng cho Ví, Giao dịch, Ngân sách và AI Copilot.",
    ],
    sourceCodeCitations: [
      "backend/src/services/financial-context.service.ts (Currency Isolation Logic)",
      "database/migrations/004_reserved_money.sql",
      "tests/currency-and-i18n.test.mjs",
    ],
    keywords: [
      "đa tiền tệ", "usd", "vnd", "cộng gộp", "tỷ giá", "currency isolation", "ngoại tệ",
    ],
  },

  security_data_privacy: {
    id: "security_data_privacy",
    name: "Bảo mật Dữ liệu & An toàn Riêng tư (Security, RLS & Data Privacy)",
    status: "HOÀN THIỆN",
    purpose:
      "Bảo vệ toàn vẹn thông tin tài chính cá nhân của người dùng, ngăn chặn rò rỉ dữ liệu, phòng chống tấn công mạng và tiêm nhiễm prompt injection.",
    uiLocation: "Kiến trúc nền tảng áp dụng trên toàn bộ ứng dụng và cơ sở dữ liệu.",
    workflow: [
      "1. Người dùng xác thực an toàn qua Supabase Auth.",
      "2. Mọi truy vấn database được kiểm soát bởi PostgreSQL Row-Level Security (RLS) gắn chặt với `auth.uid()`.",
      "3. Dữ liệu tài chính không lưu trữ trên máy chủ trung gian của bên thứ ba.",
      "4. Nhập và xuất file Excel chạy hoàn toàn cục bộ phía client.",
      "5. Khóa dịch vụ `service_role` chỉ tồn tại trong môi trường backend được bảo vệ, tuyệt đối không lộ ra trình duyệt.",
    ],
    inputsOutputs: {
      inputs: ["JWT Token xác thực, truy vấn bảo vệ."],
      outputs: ["Dữ liệu được mã hóa và cô lập hoàn toàn giữa các người dùng."],
    },
    validationRules: [
      "Không một người dùng nào có thể đọc hoặc ghi đè dữ liệu tài chính của người dùng khác.",
      "Admin không có quyền xem các giao dịch chi tiêu riêng tư của người dùng.",
      "Khử toàn bộ thẻ HTML/Script nguy hiểm trong dữ liệu nhập vào.",
    ],
    businessRules: [
      "Chính sách bảo mật RLS được kích hoạt trên 100% các bảng tài chính.",
      "Mọi thao tác quản trị đều được lưu vết vào nhật ký kiểm toán không thể xóa (Immutable Audit Log).",
      "Trợ lý AI hoạt động theo cơ chế Read-Only, không nhận các lệnh ghi hoặc thay đổi cấu hình bảo mật.",
    ],
    dbTables: ["100% các bảng trong schema public"],
    apiServices: [
      "backend/src/services/admin-auth.service.ts",
      "Supabase Row-Level Security",
    ],
    permissions: "all",
    limitations: [
      "Người dùng cần bảo vệ an toàn thông tin tài khoản và mật khẩu đăng nhập cá nhân.",
    ],
    relationships: [
      "Bao bọc và bảo vệ toàn bộ các phân hệ của Sổ Chi Tiêu.",
    ],
    sourceCodeCitations: [
      "database/migrations/000_base_schema.sql (Initial RLS Policies)",
      "database/migrations/013_admin_rbac.sql (RBAC & Separation of Privileges)",
      "backend/src/services/admin-auth.service.ts (Server-side Auth Guard)",
      "tests/database-security.test.mjs",
    ],
    keywords: [
      "bảo mật", "an toàn", "rls", "row level security", "quyền riêng tư",
      "prompt injection", "privacy", "service role key", "phân quyền",
    ],
  },
};

/**
 * Helper to get a feature by ID or alias.
 */
export function getFeatureMetadata(featureId: string): SystemFeatureMetadata | null {
  if (!featureId) return null;
  const cleanId = featureId.toLowerCase().trim();
  if (SYSTEM_FEATURES[cleanId]) return SYSTEM_FEATURES[cleanId];

  // Try alias match
  for (const feat of Object.values(SYSTEM_FEATURES)) {
    if (feat.id.includes(cleanId) || cleanId.includes(feat.id)) {
      return feat;
    }
  }
  return null;
}

