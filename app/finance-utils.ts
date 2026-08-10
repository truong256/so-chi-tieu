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
