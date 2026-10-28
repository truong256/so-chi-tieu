/**
 * backend/src/services/recurring-scheduler.service.ts
 * ====================================================
 * Backend Recurring Transaction Scheduling & Execution Engine.
 *
 * Responsibilities:
 * 1. Timezone-aware date/time decomposition & reconstruction (default: Asia/Ho_Chi_Minh, UTC+7).
 * 2. Accurate `next_run_at` calculation across all supported frequencies (`daily`, `weekly`,
 *    `biweekly`, `monthly`, `bimonthly`, `quarterly`, `semi-annually`, `yearly`, `custom`),
 *    preserving anchor day-of-month from `start_date` (no Feb 28 -> Mar 28 drift) and honoring
 *    `month_end_mode` (`last_day` vs `next_month`).
 * 3. Idempotent backend execution of due recurring schedules via existing PostgreSQL RPC
 *    `public.record_recurring_transaction` + `public.recurring_occurrences` ledger to prevent
 *    duplicate transactions across retries, page reloads, or multi-tab concurrency.
 */

import { createClient } from "@supabase/supabase-js";
import type { Frequency } from "../../../frontend/types/finance.types.ts";
import { invalidateUserFinancialCache } from "./financial-cache.service.ts";
import { buildAuthoritativeFinancialSnapshot } from "./financial-snapshot.service.ts";
import type { ToolExecutionContext } from "./financial-tools.service.ts";

export const DEFAULT_RECURRING_TIMEZONE = "Asia/Ho_Chi_Minh";

export const VALID_FREQUENCIES: readonly Frequency[] = [
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semi-annually",
  "yearly",
  "custom",
] as const;

export interface LocalDateTimeParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
}

const inFlightRecurringLocks = new Set<string>();

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isValidFrequency(value: unknown): value is Frequency {
  return typeof value === "string" && (VALID_FREQUENCIES as readonly string[]).includes(value);
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getLastDayOfMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

/**
 * Decompose an ISO timestamp or Date into wall-clock parts in the target IANA timezone.
 */
export function toTimeZoneParts(
  value: string | Date,
  timeZone: string = DEFAULT_RECURRING_TIMEZONE,
): LocalDateTimeParts {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_RECURRING_TIMEZONE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`INVALID_DATE:Thời gian không hợp lệ (${String(value)}).`);
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = Number.parseInt(part.value, 10);
    }
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute ?? 0,
    second: map.second ?? 0,
  };
}

/**
 * Convert wall-clock parts in `timeZone` back to an exact UTC ISO timestamp.
 */
export function fromTimeZonePartsToUtcIso(
  parts: LocalDateTimeParts,
  timeZone: string = DEFAULT_RECURRING_TIMEZONE,
): string {
  const safeTz = isValidTimeZone(timeZone) ? timeZone : DEFAULT_RECURRING_TIMEZONE;

  // Initial UTC guess assuming 0 offset, then refine iteratively using actual tz offset at that instant
  let utcGuessMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  for (let i = 0; i < 3; i++) {
    const observed = toTimeZoneParts(new Date(utcGuessMs), safeTz);
    const observedAsUtcMs = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const targetAsUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diffMs = targetAsUtcMs - observedAsUtcMs;
    if (diffMs === 0) break;
    utcGuessMs += diffMs;
  }

  return new Date(utcGuessMs).toISOString();
}

export function formatLocalDateKey(
  value: string | Date,
  timeZone: string = DEFAULT_RECURRING_TIMEZONE,
): string {
  const p = toTimeZoneParts(value, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export interface ComputeNextRunOptions {
  currentRunAt: string | Date;
  frequency: Frequency;
  interval?: number;
  startDate?: string | null; // YYYY-MM-DD or ISO string (preserves anchor day e.g. 31st)
  monthEndMode?: "last_day" | "next_month";
  timeZone?: string;
}

/**
 * Compute the next execution timestamp (`next_run_at`) in ISO UTC, accurately respecting
 * local wall-clock date/time in `timeZone`, `interval`, `startDate` anchor day, and `monthEndMode`.
 */
export function computeNextRunAt(options: ComputeNextRunOptions): string {
  const {
    currentRunAt,
    frequency,
    startDate,
    monthEndMode = "last_day",
    timeZone = DEFAULT_RECURRING_TIMEZONE,
  } = options;

  if (!isValidFrequency(frequency)) {
    throw new Error(`INVALID_FREQUENCY:Tần suất định kỳ không hợp lệ (${String(frequency)}).`);
  }

  const rawInterval = options.interval ?? 1;
  if (!Number.isInteger(rawInterval) || rawInterval < 1 || rawInterval > 365) {
    throw new Error(`INVALID_INTERVAL:Khoảng lặp phải là số nguyên dương hợp lệ (${String(rawInterval)}).`);
  }
  const interval = rawInterval;

  const cur = toTimeZoneParts(currentRunAt, timeZone);

  // Extract anchor day-of-month from startDate if available so Jan 31 -> Feb 28 -> Mar 31 does not drift to Mar 28
  let anchorDay = cur.day;
  if (startDate && typeof startDate === "string") {
    const trimmed = startDate.trim();
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
      anchorDay = Number.parseInt(ymdMatch[3], 10);
    } else if (trimmed.includes("T")) {
      anchorDay = toTimeZoneParts(trimmed, timeZone).day;
    }
  }

  let nextYear = cur.year;
  let nextMonth = cur.month;
  let nextDay = cur.day;

  if (frequency === "daily" || frequency === "weekly" || frequency === "biweekly") {
    const daysToAdd =
      frequency === "daily"
        ? interval
        : frequency === "weekly"
          ? 7 * interval
          : 14 * interval;

    const d = new Date(Date.UTC(cur.year, cur.month - 1, cur.day + daysToAdd));
    nextYear = d.getUTCFullYear();
    nextMonth = d.getUTCMonth() + 1;
    nextDay = d.getUTCDate();
  } else if (
    frequency === "monthly" ||
    frequency === "bimonthly" ||
    frequency === "quarterly" ||
    frequency === "semi-annually" ||
    frequency === "custom"
  ) {
    let monthsToAdd = interval;
    if (frequency === "bimonthly") monthsToAdd = 2 * interval;
    else if (frequency === "quarterly") monthsToAdd = 3 * interval;
    else if (frequency === "semi-annually") monthsToAdd = 6 * interval;

    const totalMonths0 = (cur.year * 12 + (cur.month - 1)) + monthsToAdd;
    nextYear = Math.floor(totalMonths0 / 12);
    nextMonth = (totalMonths0 % 12) + 1;

    const lastDay = getLastDayOfMonth(nextYear, nextMonth);
    if (anchorDay > lastDay) {
      if (monthEndMode === "next_month") {
        const overflowMonths0 = totalMonths0 + 1;
        nextYear = Math.floor(overflowMonths0 / 12);
        nextMonth = (overflowMonths0 % 12) + 1;
        nextDay = 1;
      } else {
        nextDay = lastDay;
      }
    } else {
      nextDay = anchorDay;
    }
  } else if (frequency === "yearly") {
    nextYear = cur.year + interval;
    nextMonth = cur.month;
    const lastDay = getLastDayOfMonth(nextYear, nextMonth);
    if (anchorDay > lastDay) {
      if (monthEndMode === "next_month") {
        const overflowMonths0 = nextYear * 12 + (nextMonth - 1) + 1;
        nextYear = Math.floor(overflowMonths0 / 12);
        nextMonth = (overflowMonths0 % 12) + 1;
        nextDay = 1;
      } else {
        nextDay = lastDay;
      }
    } else {
      nextDay = anchorDay;
    }
  }

  const nextIso = fromTimeZonePartsToUtcIso(
    {
      year: nextYear,
      month: nextMonth,
      day: nextDay,
      hour: cur.hour,
      minute: cur.minute,
      second: cur.second,
    },
    timeZone,
  );

  // Guarantee strict forward progress
  const currentMs = currentRunAt instanceof Date ? currentRunAt.getTime() : new Date(currentRunAt).getTime();
  if (new Date(nextIso).getTime() <= currentMs) {
    return new Date(currentMs + 24 * 60 * 60 * 1000).toISOString();
  }

  return nextIso;
}

export interface InitialScheduleInput {
  frequency: Frequency;
  interval?: number;
  dayOfMonth?: number | null; // 1..31
  dayOfWeek?: number | null; // 0 (Sun) .. 6 (Sat)
  startDateStr?: string | null; // YYYY-MM-DD
  timeOfDay?: string | null; // HH:mm
  monthEndMode?: "last_day" | "next_month";
  timeZone?: string;
  now?: Date;
}

export interface InitialScheduleOutput {
  startDate: string; // YYYY-MM-DD (anchor date in local timezone)
  nextRunAt: string; // UTC ISO timestamp
  frequencyLabelVi: string;
  nextRunLabelVi: string;
}

export function getFrequencyLabelVi(frequency: Frequency, interval = 1): string {
  switch (frequency) {
    case "daily":
      return interval > 1 ? `Mỗi ${interval} ngày` : "Hàng ngày";
    case "weekly":
      return interval > 1 ? `Mỗi ${interval} tuần` : "Hàng tuần";
    case "biweekly":
      return "2 tuần / lần";
    case "monthly":
      return interval > 1 ? `Mỗi ${interval} tháng` : "Hàng tháng";
    case "bimonthly":
      return "2 tháng / lần";
    case "quarterly":
      return "Hàng quý (3 tháng / lần)";
    case "semi-annually":
      return "6 tháng / lần";
    case "yearly":
      return interval > 1 ? `Mỗi ${interval} năm` : "Hàng năm";
    case "custom":
      return `Tùy chỉnh (${interval} tháng / lần)`;
  }
}

/**
 * Compute initial `start_date` and `next_run_at` when creating a new recurring schedule.
 */
export function computeInitialRecurringSchedule(input: InitialScheduleInput): InitialScheduleOutput {
  const timeZone = isValidTimeZone(input.timeZone || "")
    ? (input.timeZone as string)
    : DEFAULT_RECURRING_TIMEZONE;
  const now = input.now ?? new Date();
  const nowParts = toTimeZoneParts(now, timeZone);

  let hour = 8;
  let minute = 0;
  if (input.timeOfDay && /^\d{1,2}:\d{2}$/.test(input.timeOfDay.trim())) {
    const [hStr, mStr] = input.timeOfDay.trim().split(":");
    const h = Number.parseInt(hStr, 10);
    const m = Number.parseInt(mStr, 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hour = h;
      minute = m;
    }
  }

  const monthEndMode = input.monthEndMode ?? "last_day";
  let year = nowParts.year;
  let month = nowParts.month;
  let day = nowParts.day;
  let anchorDateStr: string | null = null;

  if (input.startDateStr && /^\d{4}-\d{2}-\d{2}$/.test(input.startDateStr.trim())) {
    const [y, m, d] = input.startDateStr.trim().split("-").map((v) => Number.parseInt(v, 10));
    const maxDay = getLastDayOfMonth(y, m);
    if (m < 1 || m > 12 || d < 1 || d > maxDay) {
      throw new Error(`INVALID_START_DATE:Ngày bắt đầu không hợp lệ (${input.startDateStr}).`);
    }
    year = y;
    month = m;
    day = d;
    anchorDateStr = `${year}-${pad2(month)}-${pad2(day)}`;
  } else if (
    input.dayOfMonth &&
    Number.isInteger(input.dayOfMonth) &&
    input.dayOfMonth >= 1 &&
    input.dayOfMonth <= 31
  ) {
    const requestedDay = input.dayOfMonth;
    const lastDayThisMonth = getLastDayOfMonth(year, month);
    const effectiveDayThisMonth = Math.min(requestedDay, lastDayThisMonth);

    // Build candidate in current month
    const candidateThisMonthIso = fromTimeZonePartsToUtcIso(
      { year, month, day: effectiveDayThisMonth, hour, minute, second: 0 },
      timeZone,
    );

    if (new Date(candidateThisMonthIso).getTime() <= now.getTime()) {
      // Move to next month
      const nextMonth0 = year * 12 + (month - 1) + 1;
      year = Math.floor(nextMonth0 / 12);
      month = (nextMonth0 % 12) + 1;
      const lastDayNextMonth = getLastDayOfMonth(year, month);
      if (requestedDay > lastDayNextMonth) {
        if (monthEndMode === "next_month") {
          const overflow0 = nextMonth0 + 1;
          year = Math.floor(overflow0 / 12);
          month = (overflow0 % 12) + 1;
          day = 1;
        } else {
          day = lastDayNextMonth;
        }
      } else {
        day = requestedDay;
      }
    } else {
      day = effectiveDayThisMonth;
    }
    // Preserve requested anchor day in synthetic anchor if e.g. 31st was requested in a 30-day month
    if (requestedDay > day) {
      // Find a month with 31 days (e.g. January of current year) ONLY for anchor day extraction if needed,
      // while start_date itself must be a valid calendar date:
      anchorDateStr = `${year}-${pad2(month)}-${pad2(day)}`;
    }
  } else if (
    input.dayOfWeek !== undefined &&
    input.dayOfWeek !== null &&
    Number.isInteger(input.dayOfWeek) &&
    input.dayOfWeek >= 0 &&
    input.dayOfWeek <= 6
  ) {
    const currentUtcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    let deltaDays = (input.dayOfWeek - currentUtcDay + 7) % 7;
    if (deltaDays === 0) {
      const candidateTodayIso = fromTimeZonePartsToUtcIso(
        { year, month, day, hour, minute, second: 0 },
        timeZone,
      );
      if (new Date(candidateTodayIso).getTime() <= now.getTime()) {
        deltaDays = 7;
      }
    }
    const targetDate = new Date(Date.UTC(year, month - 1, day + deltaDays));
    year = targetDate.getUTCFullYear();
    month = targetDate.getUTCMonth() + 1;
    day = targetDate.getUTCDate();
  } else {
    // Default to today at timeOfDay if still in future, otherwise advance by 1 period or tomorrow 08:00
    const candidateTodayIso = fromTimeZonePartsToUtcIso(
      { year, month, day, hour, minute, second: 0 },
      timeZone,
    );
    if (new Date(candidateTodayIso).getTime() <= now.getTime() && !input.startDateStr) {
      // Advance to next cycle from today's schedule slot so we don't unexpectedly double-charge the past
      const nextIso = computeNextRunAt({
        currentRunAt: candidateTodayIso,
        frequency: input.frequency,
        interval: input.interval ?? 1,
        monthEndMode,
        timeZone,
      });
      const nextParts = toTimeZoneParts(nextIso, timeZone);
      year = nextParts.year;
      month = nextParts.month;
      day = nextParts.day;
      hour = nextParts.hour;
      minute = nextParts.minute;
    }
  }

  const startDate = anchorDateStr ?? `${year}-${pad2(month)}-${pad2(day)}`;
  const nextRunAt = fromTimeZonePartsToUtcIso(
    { year, month, day, hour, minute, second: 0 },
    timeZone,
  );
  const nextRunLabelVi = `${pad2(day)}/${pad2(month)}/${year} lúc ${pad2(hour)}:${pad2(minute)} (GMT+7)`;

  return {
    startDate,
    nextRunAt,
    frequencyLabelVi: getFrequencyLabelVi(input.frequency, input.interval ?? 1),
    nextRunLabelVi,
  };
}

export interface ProcessRecurringOptions {
  now?: Date;
  timeZone?: string;
  scheduleId?: string;
  maxCatchUpIterations?: number;
}

export interface RecurringExecutionItemResult {
  scheduleId: string;
  title: string;
  scheduledFor: string;
  amount: number;
  type: "income" | "expense";
  status: "executed" | "skipped_duplicate" | "failed_balance" | "failed_validation" | "completed_end_rule";
  transactionId?: string | null;
  nextRunAt?: string;
  reason?: string;
}

export interface ProcessRecurringSummary {
  success: boolean;
  checkedCount: number;
  executedCount: number;
  skippedDuplicateCount: number;
  failedCount: number;
  results: RecurringExecutionItemResult[];
  error?: string;
}

function getSupabaseForContext(ctx: ToolExecutionContext) {
  if (ctx.supabase) return ctx.supabase;
  if (ctx.client) return ctx.client;
  if (!ctx.supabaseUrl || !ctx.supabaseKey || !ctx.token) {
    throw new Error("AUTH_REQUIRED:Thiếu thông tin xác thực kết nối cơ sở dữ liệu.");
  }
  return createClient(ctx.supabaseUrl, ctx.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.token}` } },
  });
}

/**
 * Execute all due active recurring transactions for the authenticated user on the Backend.
 * Guarantees idempotency via in-process lock + `recurring_occurrences` + `transactions.recurrence_id`.
 */
export async function processDueRecurringTransactions(
  ctx: ToolExecutionContext,
  options: ProcessRecurringOptions = {},
): Promise<ProcessRecurringSummary> {
  if (!ctx?.userId) {
    return {
      success: false,
      checkedCount: 0,
      executedCount: 0,
      skippedDuplicateCount: 0,
      failedCount: 0,
      results: [],
      error: "AUTH_REQUIRED:Vui lòng đăng nhập để thực thi lịch định kỳ.",
    };
  }

  const timeZone = isValidTimeZone(options.timeZone || "")
    ? (options.timeZone as string)
    : DEFAULT_RECURRING_TIMEZONE;
  const now = options.now ?? new Date();
  const maxCatchUp = Math.min(Math.max(options.maxCatchUpIterations ?? 12, 1), 36);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: any;
  try {
    supabase = getSupabaseForContext(ctx);
  } catch (err) {
    return {
      success: false,
      checkedCount: 0,
      executedCount: 0,
      skippedDuplicateCount: 0,
      failedCount: 0,
      results: [],
      error: err instanceof Error ? err.message : "Lỗi khởi tạo kết nối cơ sở dữ liệu.",
    };
  }

  const userLockKey = `recurring_user:${ctx.userId}`;
  if (inFlightRecurringLocks.has(userLockKey)) {
    return {
      success: true,
      checkedCount: 0,
      executedCount: 0,
      skippedDuplicateCount: 0,
      failedCount: 0,
      results: [],
    };
  }

  inFlightRecurringLocks.add(userLockKey);

  try {
    let query = supabase
      .from("recurring_transactions")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("active", true);

    if (options.scheduleId) {
      query = query.eq("id", options.scheduleId);
    }

    const { data: schedules, error: schedError } = await query;
    if (schedError) {
      return {
        success: false,
        checkedCount: 0,
        executedCount: 0,
        skippedDuplicateCount: 0,
        failedCount: 0,
        results: [],
        error: `Lỗi truy vấn lịch định kỳ: ${schedError.message}`,
      };
    }

    const activeSchedules = Array.isArray(schedules) ? schedules : [];
    const dueSchedules = activeSchedules.filter((item) => {
      if (item.user_id !== ctx.userId) return false;
      if (item.status && item.status !== "active") return false;
      const isAuto =
        Boolean(options.scheduleId) ||
        item.auto_create === true ||
        item.processing_mode === "auto";
      if (!isAuto) return false;
      const runMs = new Date(item.next_run_at).getTime();
      return Number.isFinite(runMs) && runMs <= now.getTime();
    });

    if (dueSchedules.length === 0) {
      return {
        success: true,
        checkedCount: activeSchedules.length,
        executedCount: 0,
        skippedDuplicateCount: 0,
        failedCount: 0,
        results: [],
      };
    }

    // Load wallet available balances via authoritative RPC (with snapshot fallback)
    const { data: walletRows } = await supabase
      .from("wallets")
      .select("id, balance, reserved_amount")
      .eq("user_id", ctx.userId);
    const reservedByWallet = new Map<string, number>(
      Array.isArray(walletRows)
        ? walletRows.map((w: Record<string, unknown>) => [
            String(w.id),
            Number(w.reserved_amount ?? 0),
          ])
        : [],
    );

    const walletAvailMap = new Map<string, number>();
    if (ctx.snapshot?.enrichedWallets?.length) {
      for (const w of ctx.snapshot.enrichedWallets) {
        walletAvailMap.set(w.id, Number(w.availableBalance ?? 0));
      }
    } else if (ctx.snapshot?.availableBalances instanceof Map && ctx.snapshot.availableBalances.size > 0) {
      for (const [wId, avail] of ctx.snapshot.availableBalances.entries()) {
        walletAvailMap.set(wId, Number(avail ?? 0));
      }
    } else if (typeof supabase.rpc === "function") {
      try {
        const { data: trueBals } = await supabase.rpc("get_true_wallet_balances");
        if (Array.isArray(trueBals)) {
          for (const row of trueBals) {
            const wId = String(row.wallet_id);
            const avail =
              row.available_balance !== undefined
                ? Number(row.available_balance)
                : Number(row.true_balance ?? 0) - (reservedByWallet.get(wId) ?? 0);
            walletAvailMap.set(wId, avail);
          }
        }
      } catch {
        // Fallback to wallets table balance - reserved_amount if RPC unavailable in mock
      }
    }

    if (walletAvailMap.size === 0 && Array.isArray(walletRows)) {
      const [allTxRes, transfersRes, budgetsRes, goalsRes] = await Promise.all([
        supabase
          .from("transactions")
          .select("id, amount, type, wallet_id, budget_id, payment_source_type")
          .eq("user_id", ctx.userId),
        supabase
          .from("transfers")
          .select("id, from_wallet_id, to_wallet_id, amount")
          .eq("user_id", ctx.userId),
        supabase
          .from("budgets")
          .select("id, source_wallet_id, status, remaining_amount, allocated_amount")
          .eq("user_id", ctx.userId),
        supabase
          .from("savings_goals")
          .select("id, source_wallet_id, reserved_in_wallet, current_amount")
          .eq("user_id", ctx.userId),
      ]);
      const snap = buildAuthoritativeFinancialSnapshot(
        walletRows,
        Array.isArray(allTxRes?.data) ? allTxRes.data : [],
        Array.isArray(transfersRes?.data) ? transfersRes.data : [],
        Array.isArray(budgetsRes?.data) ? budgetsRes.data : [],
        Array.isArray(goalsRes?.data) ? goalsRes.data : [],
      );
      for (const [wId, avail] of snap.availableBalances.entries()) {
        walletAvailMap.set(wId, avail);
      }
    }

    const scheduleIds = dueSchedules.map((s) => String(s.id));

    // Fetch existing occurrences and recurring transactions for idempotency verification
    const [{ data: existingOccurrences }, { data: existingRecurringTxs }] = await Promise.all([
      supabase
        .from("recurring_occurrences")
        .select("id, recurring_transaction_id, scheduled_for, status, transaction_id")
        .eq("user_id", ctx.userId)
        .in("recurring_transaction_id", scheduleIds),
      supabase
        .from("transactions")
        .select("id, recurrence_id, occurred_at")
        .eq("user_id", ctx.userId)
        .in("recurrence_id", scheduleIds),
    ]);

    const confirmedOccurrenceKeys = new Set<string>();
    const confirmedCountBySchedule = new Map<string, number>();

    if (Array.isArray(existingOccurrences)) {
      for (const occ of existingOccurrences) {
        if (occ.status === "confirmed") {
          const sid = String(occ.recurring_transaction_id);
          confirmedOccurrenceKeys.add(`${sid}:${String(occ.scheduled_for)}`);
          confirmedCountBySchedule.set(sid, (confirmedCountBySchedule.get(sid) ?? 0) + 1);
        }
      }
    }

    if (Array.isArray(existingRecurringTxs)) {
      for (const tx of existingRecurringTxs) {
        if (tx.recurrence_id && tx.occurred_at) {
          const sid = String(tx.recurrence_id);
          const localDay = formatLocalDateKey(String(tx.occurred_at), timeZone);
          const key = `${sid}:${localDay}`;
          if (!confirmedOccurrenceKeys.has(key)) {
            confirmedOccurrenceKeys.add(key);
            confirmedCountBySchedule.set(sid, (confirmedCountBySchedule.get(sid) ?? 0) + 1);
          }
        }
      }
    }

    const results: RecurringExecutionItemResult[] = [];
    let executedCount = 0;
    let skippedDuplicateCount = 0;
    let failedCount = 0;

    for (const schedule of dueSchedules) {
      const scheduleId = String(schedule.id);
      const amount = Number(schedule.amount ?? 0);
      const txType: "income" | "expense" = schedule.type === "income" ? "income" : "expense";
      const frequency: Frequency = isValidFrequency(schedule.frequency)
        ? schedule.frequency
        : "monthly";
      const interval =
        Number.isInteger(schedule.interval) && schedule.interval >= 1 ? schedule.interval : 1;
      const monthEndMode: "last_day" | "next_month" =
        schedule.month_end_mode === "next_month" ? "next_month" : "last_day";

      if (!amount || amount <= 0) {
        failedCount++;
        results.push({
          scheduleId,
          title: String(schedule.title || ""),
          scheduledFor: formatLocalDateKey(String(schedule.next_run_at), timeZone),
          amount,
          type: txType,
          status: "failed_validation",
          reason: "Số tiền giao dịch định kỳ không hợp lệ.",
        });
        continue;
      }

      if (!schedule.wallet_id) {
        failedCount++;
        results.push({
          scheduleId,
          title: String(schedule.title || ""),
          scheduledFor: formatLocalDateKey(String(schedule.next_run_at), timeZone),
          amount,
          type: txType,
          status: "failed_validation",
          reason: "Lịch định kỳ chưa liên kết ví thanh toán.",
        });
        continue;
      }

      let cursorRunAt = String(schedule.next_run_at);
      let iterations = 0;

      while (new Date(cursorRunAt).getTime() <= now.getTime() && iterations < maxCatchUp) {
        iterations++;
        const scheduledFor = formatLocalDateKey(cursorRunAt, timeZone);

        // 1. Check end rules BEFORE executing
        const confirmedSoFar = confirmedCountBySchedule.get(scheduleId) ?? 0;
        if (
          (schedule.end_type === "date" && schedule.end_date && scheduledFor > String(schedule.end_date)) ||
          (schedule.end_type === "occurrences" &&
            Number(schedule.occurrence_limit) > 0 &&
            confirmedSoFar >= Number(schedule.occurrence_limit))
        ) {
          await supabase
            .from("recurring_transactions")
            .update({ active: false, status: "completed", updated_at: new Date().toISOString() })
            .eq("id", scheduleId)
            .eq("user_id", ctx.userId);
          results.push({
            scheduleId,
            title: String(schedule.title || ""),
            scheduledFor,
            amount,
            type: txType,
            status: "completed_end_rule",
            reason: "Lịch định kỳ đã hoàn tất theo điều kiện kết thúc.",
          });
          break;
        }

        const nextRunIso = computeNextRunAt({
          currentRunAt: cursorRunAt,
          frequency,
          interval,
          startDate: schedule.start_date ? String(schedule.start_date) : null,
          monthEndMode,
          timeZone,
        });

        const occKey = `${scheduleId}:${scheduledFor}`;

        // 2. Duplicate prevention: if already confirmed for this scheduled_for date, advance schedule without re-inserting
        if (confirmedOccurrenceKeys.has(occKey)) {
          await supabase
            .from("recurring_transactions")
            .update({ next_run_at: nextRunIso, updated_at: new Date().toISOString() })
            .eq("id", scheduleId)
            .eq("user_id", ctx.userId);

          skippedDuplicateCount++;
          results.push({
            scheduleId,
            title: String(schedule.title || ""),
            scheduledFor,
            amount,
            type: txType,
            status: "skipped_duplicate",
            nextRunAt: nextRunIso,
            reason: `Kỳ ${scheduledFor} đã được ghi nhận trước đó (chống tạo trùng).`,
          });
          cursorRunAt = nextRunIso;
          continue;
        }

        // 3. Check available balance for expense
        const walletId = String(schedule.wallet_id);
        const currentAvail = walletAvailMap.get(walletId) ?? 0;
        if (txType === "expense" && amount > currentAvail) {
          await supabase.from("recurring_occurrences").upsert(
            {
              user_id: ctx.userId,
              recurring_transaction_id: scheduleId,
              scheduled_for: scheduledFor,
              amount,
              status: "failed",
            },
            { onConflict: "recurring_transaction_id,scheduled_for" },
          );

          failedCount++;
          results.push({
            scheduleId,
            title: String(schedule.title || ""),
            scheduledFor,
            amount,
            type: txType,
            status: "failed_balance",
            reason: `Ví thanh toán không đủ số dư khả dụng (${currentAvail.toLocaleString("vi-VN")} VND < ${amount.toLocaleString("vi-VN")} VND).`,
          });
          break;
        }

        // 4. Execute atomically via PostgreSQL RPC `record_recurring_transaction`
        let { data: createdTxId, error: rpcError } = await supabase.rpc(
          "record_recurring_transaction",
          {
            p_recurring_id: scheduleId,
            p_occurred_at: cursorRunAt,
            p_next_run_at: nextRunIso,
          },
        );

        // Fallback if remote Supabase DB has not applied RPC `record_recurring_transaction` (`PGRST202`)
        const isMissingRecRpc =
          rpcError &&
          ((rpcError as { code?: string }).code === "PGRST202" ||
            /Could not find the function public\.record_recurring_transaction/i.test(
              String(rpcError.message || ""),
            ));

        if (isMissingRecRpc) {
          let categoryName = txType === "income" ? "Thu khác" : "Khác";
          if (schedule.category_id) {
            const { data: catRow } = await supabase
              .from("categories")
              .select("name")
              .eq("id", schedule.category_id)
              .eq("user_id", ctx.userId)
              .maybeSingle();
            if (catRow?.name) categoryName = String(catRow.name);
          }

          const { data: directTx, error: directTxErr } = await supabase
            .from("transactions")
            .insert({
              user_id: ctx.userId,
              title: String(schedule.title || ""),
              amount,
              type: txType,
              category: categoryName,
              category_id: schedule.category_id ?? null,
              wallet_id: walletId,
              occurred_at: cursorRunAt,
              note: schedule.note ? String(schedule.note) : "",
              recurrence_id: scheduleId,
              payment_source_type: "wallet",
            })
            .select("id")
            .single();

          if (!directTxErr && directTx?.id) {
            createdTxId = directTx.id;
            rpcError = null;
            const nowIsoStr = new Date().toISOString();
            await supabase
              .from("recurring_transactions")
              .update({
                next_run_at: nextRunIso,
                last_processed_at: nowIsoStr,
                updated_at: nowIsoStr,
              })
              .eq("id", scheduleId)
              .eq("user_id", ctx.userId);
          } else if (directTxErr) {
            rpcError = directTxErr;
          }
        }

        if (rpcError) {
          failedCount++;
          results.push({
            scheduleId,
            title: String(schedule.title || ""),
            scheduledFor,
            amount,
            type: txType,
            status: "failed_validation",
            reason: rpcError.message || "Không thể ghi nhận giao dịch định kỳ.",
          });
          break;
        }

        // 5. Record confirmed occurrence in `recurring_occurrences`
        await supabase.from("recurring_occurrences").upsert(
          {
            user_id: ctx.userId,
            recurring_transaction_id: scheduleId,
            scheduled_for: scheduledFor,
            amount,
            status: "confirmed",
            transaction_id: typeof createdTxId === "string" ? createdTxId : null,
          },
          { onConflict: "recurring_transaction_id,scheduled_for" },
        );

        confirmedOccurrenceKeys.add(occKey);
        const newConfirmedCount = (confirmedCountBySchedule.get(scheduleId) ?? 0) + 1;
        confirmedCountBySchedule.set(scheduleId, newConfirmedCount);

        if (txType === "expense") {
          walletAvailMap.set(walletId, currentAvail - amount);
        } else {
          walletAvailMap.set(walletId, currentAvail + amount);
        }

        executedCount++;
        results.push({
          scheduleId,
          title: String(schedule.title || ""),
          scheduledFor,
          amount,
          type: txType,
          status: "executed",
          transactionId: typeof createdTxId === "string" ? createdTxId : null,
          nextRunAt: nextRunIso,
        });

        // 6. Mark schedule completed if next run exceeds end_date or occurrence_limit reached
        const nextScheduledDate = formatLocalDateKey(nextRunIso, timeZone);
        const hitLimit =
          (schedule.end_type === "occurrences" &&
            Number(schedule.occurrence_limit) > 0 &&
            newConfirmedCount >= Number(schedule.occurrence_limit)) ||
          (schedule.end_type === "date" &&
            schedule.end_date &&
            nextScheduledDate > String(schedule.end_date));

        if (hitLimit) {
          await supabase
            .from("recurring_transactions")
            .update({ active: false, status: "completed", updated_at: new Date().toISOString() })
            .eq("id", scheduleId)
            .eq("user_id", ctx.userId);
          break;
        }

        cursorRunAt = nextRunIso;
      }
    }

    if (executedCount > 0) {
      invalidateUserFinancialCache(ctx.userId);
    }

    return {
      success: true,
      checkedCount: activeSchedules.length,
      executedCount,
      skippedDuplicateCount,
      failedCount,
      results,
    };
  } finally {
    inFlightRecurringLocks.delete(userLockKey);
  }
}
