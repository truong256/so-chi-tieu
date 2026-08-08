import type { Category, Frequency, Transaction, TransactionType, Wallet } from "./finance-types";

export function toNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function localDateTime(value: string | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function formatDate(value: string, language: "vi" | "en" = "vi") {
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function advanceRecurring(value: string, frequency: Frequency) {
  const next = new Date(value);
  const now = new Date();
  do {
    if (frequency === "daily") next.setDate(next.getDate() + 1);
    if (frequency === "weekly") next.setDate(next.getDate() + 7);
    if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
    if (frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
  } while (next <= now);
  return next.toISOString();
}

function parseAmount(text: string) {
  const normalized = text.toLowerCase().replace(/,/g, ".");
  const compact = normalized.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(tr|triệu|k|nghìn|ngàn)(?:\s|$)/i);
  if (compact) {
    const multiplier = compact[2].startsWith("tr") ? 1_000_000 : 1_000;
    return Math.round(Number(compact[1]) * multiplier);
  }
  const values = normalized.match(/\d[\d.\s]*/g) ?? [];
  const candidates = values.map(value => Number(value.replace(/[.\s]/g, ""))).filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : 0;
}

export function parseSmartTransaction(text: string, categories: Category[], wallets: Wallet[]) {
  const source = text.trim();
  const normalized = source.toLocaleLowerCase("vi");
  const incomeWords = ["lương", "thưởng", "thu nhập", "được trả", "nhận tiền", "bán hàng", "lãi"];
  const type: TransactionType = incomeWords.some(word => normalized.includes(word)) ? "income" : "expense";
  const keywordMap: Record<string, string[]> = {
    "Ăn uống": ["ăn", "uống", "cơm", "cà phê", "coffee", "trà sữa", "siêu thị"],
    "Di chuyển": ["xăng", "grab", "taxi", "xe", "bus", "vé"],
    "Nhà ở": ["nhà", "điện", "nước", "internet", "thuê phòng"],
    "Mua sắm": ["mua", "shopping", "quần áo", "đồ dùng"],
    "Giải trí": ["phim", "game", "du lịch", "giải trí"],
    "Sức khỏe": ["thuốc", "khám", "bệnh viện", "sức khỏe"],
    "Giáo dục": ["học", "sách", "khóa học", "học phí"],
    "Lương": ["lương"],
    "Thưởng": ["thưởng"],
  };
  let category = categories.find(item => item.kind === type && normalized.includes(item.name.toLocaleLowerCase("vi")));
  if (!category) {
    const guessedName = Object.entries(keywordMap).find(([, words]) => words.some(word => normalized.includes(word)))?.[0];
    category = categories.find(item => item.kind === type && item.name === guessedName);
  }
  category ??= categories.find(item => item.kind === type);
  const wallet = wallets.find(item => normalized.includes(item.name.toLocaleLowerCase("vi"))) ?? wallets[0];
  const occurredAt = new Date();
  if (normalized.includes("hôm qua")) occurredAt.setDate(occurredAt.getDate() - 1);
  const amount = parseAmount(source);
  const title = source
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:tr|triệu|k|nghìn|ngàn)\b/gi, "")
    .replace(/\d[\d.\s]*/g, "")
    .replace(/\b(hôm nay|hôm qua)\b/gi, "")
    .trim()
    .replace(/^./, character => character.toUpperCase()) || (type === "income" ? "Khoản thu" : "Khoản chi");
  return { title, amount, type, categoryId: category?.id ?? "", walletId: wallet?.id ?? "", occurredAt: localDateTime(occurredAt) };
}

export function periodBounds(period: "day" | "week" | "month" | "year", offset = 0) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);
  if (period === "day") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1);
  }
  if (period === "week") {
    const mondayDistance = (now.getDay() + 6) % 7;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayDistance + offset * 7);
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  }
  if (period === "month") {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
  }
  if (period === "year") {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(now.getFullYear() + offset + 1, 0, 1);
  }
  return { start, end };
}

export function inRange(transaction: Transaction, start: Date, end: Date) {
  const value = new Date(transaction.occurred_at);
  return value >= start && value < end;
}
