import { downloadXlsxFile, type WorkbookRow, type WorkbookSheet } from "./xlsx-writer";
import type {
  Budget,
  Category,
  Profile,
  SavingsGoal,
  Transaction,
  Transfer,
  UserInfo,
  Wallet,
} from "../types/finance.types";

export interface ExportDataPayload {
  user: UserInfo;
  profile: Profile;
  wallets: Wallet[];
  categories: Category[];
  transactions: Transaction[];
  transfers: Transfer[];
  budgets: Budget[];
  goals: SavingsGoal[];
  walletBalances: Map<string, number>;
  availableBalances: Map<string, number>;
  walletReservedMap: Map<string, number>;
  totalBalance: number;
  totalAvailable: number;
  totalReserved: number;
  monthTotals: { income: number; expense: number };
}

/**
 * Sanitize string against Excel Formula Injection (CSV / XLSX formula injection)
 * Any string starting with =, +, -, @, or tab/return will be escaped with a leading single quote.
 */
function sanitizeCell<T>(value: T): T {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[=+\-@\t\r]/.test(trimmed)) {
      return `'${value}` as unknown as T;
    }
  }
  return value;
}

function formatDateVN(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateStr;
  }
}

function formatDateTimeVN(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

function formatTimeVN(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  } catch {
    return "";
  }
}

function addSheet(sheets: WorkbookSheet[], name: string, rows: WorkbookRow[]): void {
  sheets.push({ name, rows });
}

/**
 * Generate and download complete personal financial Excel workbook (.xlsx)
 */
export async function exportFinancialDataToExcel(payload: ExportDataPayload): Promise<string> {
  const {
    user,
    profile,
    wallets,
    categories,
    transactions,
    transfers,
    budgets,
    goals,
    walletBalances,
    availableBalances,
    walletReservedMap,
    totalBalance,
    totalAvailable,
    totalReserved,
    monthTotals,
  } = payload;

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const walletById = new Map(wallets.map((w) => [w.id, w]));
  const budgetById = new Map(budgets.map((b) => [b.id, b]));

  const now = new Date();
  const exportDateStr = formatDateTimeVN(now.toISOString());
  const fileDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const sheets: WorkbookSheet[] = [];

  // ─── Sheet 01: Tổng quan ──────────────────────────────────────────────────
  const netSavings = monthTotals.income - monthTotals.expense;
  const overviewRows = [
    { "Chỉ số tổng hợp": "Họ và tên chủ tài khoản", "Giá trị": sanitizeCell(profile.full_name || user.name), "Đơn vị / Ghi chú": "" },
    { "Chỉ số tổng hợp": "Email đăng ký", "Giá trị": sanitizeCell(user.email), "Đơn vị / Ghi chú": "" },
    { "Chỉ số tổng hợp": "Ngày xuất dữ liệu", "Giá trị": exportDateStr, "Đơn vị / Ghi chú": "Thời gian hệ thống" },
    { "Chỉ số tổng hợp": "Đơn vị tiền tệ chính", "Giá trị": profile.currency, "Đơn vị / Ghi chú": "" },
    { "Chỉ số tổng hợp": "------------------------------", "Giá trị": "------------------------------", "Đơn vị / Ghi chú": "------------------------------" },
    { "Chỉ số tổng hợp": "Tổng tài sản thực tế (Tất cả ví)", "Giá trị": totalBalance, "Đơn vị / Ghi chú": profile.currency },
    { "Chỉ số tổng hợp": "Số dư khả dụng (Có thể chi ngay)", "Giá trị": totalAvailable, "Đơn vị / Ghi chú": profile.currency },
    { "Chỉ số tổng hợp": "Tiền đã phân bổ / khóa (Ngân sách & Mục tiêu)", "Giá trị": totalReserved, "Đơn vị / Ghi chú": profile.currency },
    { "Chỉ số tổng hợp": "Tổng thu nhập tháng này", "Giá trị": monthTotals.income, "Đơn vị / Ghi chú": profile.currency },
    { "Chỉ số tổng hợp": "Tổng chi tiêu tháng này", "Giá trị": monthTotals.expense, "Đơn vị / Ghi chú": profile.currency },
    { "Chỉ số tổng hợp": "Tích lũy / Tiết kiệm ròng tháng này", "Giá trị": netSavings, "Đơn vị / Ghi chú": netSavings >= 0 ? "Thặng dư" : "Thâm hụt chi tiêu" },
    { "Chỉ số tổng hợp": "------------------------------", "Giá trị": "------------------------------", "Đơn vị / Ghi chú": "------------------------------" },
    { "Chỉ số tổng hợp": "Tổng số lượng ví tài khoản", "Giá trị": wallets.length, "Đơn vị / Ghi chú": "Ví" },
    { "Chỉ số tổng hợp": "Tổng số giao dịch đã ghi nhận", "Giá trị": transactions.length, "Đơn vị / Ghi chú": "Giao dịch" },
    { "Chỉ số tổng hợp": "Tổng số ngân sách đang quản lý", "Giá trị": budgets.length, "Đơn vị / Ghi chú": "Ngân sách" },
    { "Chỉ số tổng hợp": "Tổng số mục tiêu tiết kiệm", "Giá trị": goals.length, "Đơn vị / Ghi chú": "Mục tiêu" },
    { "Chỉ số tổng hợp": "Tổng số danh mục thu chi", "Giá trị": categories.length, "Đơn vị / Ghi chú": "Danh mục" },
    { "Chỉ số tổng hợp": "Tổng số lần điều chuyển ví", "Giá trị": transfers.length, "Đơn vị / Ghi chú": "Lần chuyển" },
  ];

  addSheet(sheets, "01_Tong_quan", overviewRows);

  // ─── Sheet 02: Giao dịch ──────────────────────────────────────────────────
  const transactionRows = transactions.map((t, idx) => {
    const categoryObj = categoryById.get(t.category_id ?? "");
    const walletObj = walletById.get(t.wallet_id ?? "");
    const budgetObj = t.budget_id ? budgetById.get(t.budget_id) : null;

    let paymentSourceText = "Không gắn ví";
    if (t.payment_source_type === "budget" && budgetObj) {
      paymentSourceText = `Ngân sách: ${budgetObj.name}`;
    } else if (walletObj) {
      paymentSourceText = `Ví: ${walletObj.name}`;
    }

    return {
      "STT": idx + 1,
      "Mã giao dịch": t.id,
      "Ngày thực hiện": formatDateVN(t.occurred_at),
      "Giờ": formatTimeVN(t.occurred_at),
      "Loại giao dịch": t.type === "expense" ? "Khoản chi" : "Khoản thu",
      "Số tiền": t.amount,
      "Đơn vị tiền": profile.currency,
      "Danh mục": sanitizeCell(categoryObj?.name ?? t.category ?? "Chưa phân loại"),
      "Nguồn thanh toán": sanitizeCell(paymentSourceText),
      "Tiêu đề giao dịch": sanitizeCell(t.title),
      "Ghi chú": sanitizeCell(t.note || ""),
      "Có hóa đơn đính kèm": t.receipt_path ? "Có" : "Không",
    };
  });

  addSheet(sheets, "02_Giao_dich", transactionRows.length ? transactionRows : [{ "Thông báo": "Chưa có giao dịch nào được ghi nhận." }]);

  // ─── Sheet 03: Ví tài khoản ───────────────────────────────────────────────
  const walletRows = wallets.map((w, idx) => {
    const currentBal = walletBalances.get(w.id) ?? w.balance;
    const availBal = availableBalances.get(w.id) ?? w.balance;
    const reservedBal = walletReservedMap.get(w.id) ?? 0;
    const typeLabel = w.type === "cash" ? "Tiền mặt" : w.type === "bank" ? "Ngân hàng" : "Ví điện tử";

    return {
      "STT": idx + 1,
      "Mã ví": w.id,
      "Tên ví": sanitizeCell(w.name),
      "Loại ví": typeLabel,
      "Số dư ban đầu": w.balance,
      "Số dư thực tế hiện tại": currentBal,
      "Số dư khả dụng": availBal,
      "Tiền đã phân bổ / khóa": reservedBal,
      "Đơn vị tiền": w.currency || profile.currency,
      "Màu sắc": w.color || "",
    };
  });

  addSheet(sheets, "03_Vi", walletRows.length ? walletRows : [{ "Thông báo": "Chưa có ví nào được tạo." }]);

  // ─── Sheet 04: Ngân sách ──────────────────────────────────────────────────
  const budgetRows = budgets.map((b, idx) => {
    const categoryObj = categoryById.get(b.category_id ?? "");
    const sourceWallet = walletById.get(b.source_wallet_id ?? "");
    const totalCapacity = Math.max(b.amount, b.allocated_amount);
    const progressPct = totalCapacity > 0 ? Math.round((b.spent_amount / totalCapacity) * 100) : 0;
    const periodLabel = b.period === "weekly" ? "Hàng tuần" : b.period === "yearly" ? "Hàng năm" : "Hàng tháng";
    const isClosed = b.remaining_amount <= 0 || b.status === "completed" || b.status === "cancelled";

    return {
      "STT": idx + 1,
      "Mã ngân sách": b.id,
      "Tên ngân sách": sanitizeCell(b.name),
      "Danh mục áp dụng": sanitizeCell(categoryObj?.name ?? "Tổng chi tiêu"),
      "Ví nguồn cấp vốn": sanitizeCell(sourceWallet?.name ?? "N/A"),
      "Hạn mức phân bổ": totalCapacity,
      "Đã chi": b.spent_amount,
      "Còn lại": b.remaining_amount,
      "Tiến độ chi tiêu (%)": `${progressPct}%`,
      "Chu kỳ": periodLabel,
      "Ngày bắt đầu": formatDateVN(b.period_start),
      "Ngưỡng cảnh báo (%)": `${b.alert_percent}%`,
      "Trạng thái": isClosed ? "Đã chi hết / Hoàn thành" : "Đang hoạt động",
    };
  });

  addSheet(sheets, "04_Ngan_sach", budgetRows.length ? budgetRows : [{ "Thông báo": "Chưa có ngân sách nào được tạo." }]);

  // ─── Sheet 05: Mục tiêu tiết kiệm ─────────────────────────────────────────
  const goalRows = goals.map((g, idx) => {
    const sourceWallet = walletById.get(g.source_wallet_id ?? "");
    const remainingToTarget = Math.max(0, g.target_amount - g.current_amount);
    const progressPct = g.target_amount > 0 ? Math.round((g.current_amount / g.target_amount) * 100) : 0;
    const isCompleted = g.target_amount > 0 && g.current_amount >= g.target_amount;

    return {
      "STT": idx + 1,
      "Mã mục tiêu": g.id,
      "Tên mục tiêu": sanitizeCell(g.title),
      "Số tiền mục tiêu": g.target_amount,
      "Đã tích lũy": g.current_amount,
      "Còn thiếu": remainingToTarget,
      "Tiến độ (%)": `${progressPct}%`,
      "Ví nguồn trích tiền": sanitizeCell(sourceWallet?.name ?? "N/A"),
      "Hạn chót hoàn thành": formatDateVN(g.deadline),
      "Trạng thái": isCompleted ? "Đã hoàn thành mục tiêu" : "Đang tích lũy",
    };
  });

  addSheet(sheets, "05_Muc_tieu", goalRows.length ? goalRows : [{ "Thông báo": "Chưa có mục tiêu tiết kiệm nào được tạo." }]);

  // ─── Sheet 06: Danh mục ───────────────────────────────────────────────────
  const categoryRows = categories.map((c, idx) => {
    const parentObj = c.parent_id ? categoryById.get(c.parent_id) : null;
    return {
      "STT": idx + 1,
      "Mã danh mục": c.id,
      "Tên danh mục": sanitizeCell(c.name),
      "Phân loại": c.kind === "expense" ? "Khoản chi" : "Khoản thu",
      "Danh mục cha": sanitizeCell(parentObj?.name ?? "Không có"),
      "Loại": c.is_default ? "Mặc định hệ thống" : "Người dùng tự tạo",
    };
  });

  addSheet(sheets, "06_Danh_muc", categoryRows.length ? categoryRows : [{ "Thông báo": "Chưa có danh mục nào." }]);

  // ─── Sheet 07: Thông tin tài khoản ────────────────────────────────────────
  const accountRows = [
    { "Thông tin": "Họ và tên", "Chi tiết": sanitizeCell(profile.full_name || user.name) },
    { "Thông tin": "Tên tài khoản (Username)", "Chi tiết": sanitizeCell(profile.username ?? "Chưa đặt") },
    { "Thông tin": "Địa chỉ Email", "Chi tiết": sanitizeCell(user.email) },
    { "Thông tin": "Đơn vị tiền tệ chính", "Chi tiết": profile.currency },
    { "Thông tin": "Ngôn ngữ hiển thị", "Chi tiết": profile.language === "vi" ? "Tiếng Việt" : "English" },
    { "Thông tin": "Thời điểm xuất file", "Chi tiết": exportDateStr },
  ];

  addSheet(sheets, "07_Thong_tin_tai_khoan", accountRows);

  // ─── Sheet 08: Lịch sử chuyển tiền giữa các ví ────────────────────────────
  const transferRows = transfers.map((tr, idx) => {
    const fromW = walletById.get(tr.from_wallet_id);
    const toW = walletById.get(tr.to_wallet_id);
    return {
      "STT": idx + 1,
      "Mã chuyển tiền": tr.id,
      "Thời gian": formatDateTimeVN(tr.occurred_at),
      "Từ ví chuyển": sanitizeCell(fromW?.name ?? "Ví nguồn"),
      "Đến ví nhận": sanitizeCell(toW?.name ?? "Ví đích"),
      "Số tiền chuyển": tr.amount,
      "Đơn vị tiền": profile.currency,
      "Ghi chú": sanitizeCell(tr.note || ""),
    };
  });

  addSheet(sheets, "08_Lich_su_chuyen_tien", transferRows.length ? transferRows : [{ "Thông báo": "Chưa có lịch sử chuyển tiền giữa các ví." }]);

  // ─── Trigger File Download ────────────────────────────────────────────────
  const fileName = `du-lieu-tai-chinh-${fileDateStr}.xlsx`;
  downloadXlsxFile(fileName, sheets);

  return fileName;
}
