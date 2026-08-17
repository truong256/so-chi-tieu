"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/config/supabase";
import type {
  AITransactionParseResult,
  Budget,
  Category,
  FundAllocation,
  ModalState,
  Profile,
  RecurringTransaction,
  SavingsGoal,
  Transaction,
  TransactionType,
  Transfer,
  Wallet,
} from "@/frontend/types/finance.types";
import { advanceRecurring, formatDate, inRange, localDateTime, periodBounds, toNumber } from "@/frontend/utils/finance.utils";
import { parseSmartTransaction } from "@/frontend/utils/smart-parser";
import AiChatView, { MessageContent } from "@/frontend/features/ai/ai-chat";
import { AiChatProvider } from "@/frontend/features/ai/ai-chat-context";
import AiFloatingChat from "@/frontend/features/ai/ai-floating-chat";
import ReceiptScannerModal, { FormattedMoneyInput } from "@/frontend/components/receipt-scanner-modal";
import { exportFinancialDataToExcel } from "@/frontend/services/excel-export";

type View = "overview" | "transactions" | "wallets" | "categories" | "planning" | "recurring" | "reports" | "settings" | "ai-assistant";
type UserInfo = { id: string; name: string; email: string };

const defaultCategories = [
  ["Ăn uống", "expense", "", "#FF9466"], ["Di chuyển", "expense", "", "#7C8CFF"],
  ["Nhà ở", "expense", "", "#E5CB54"], ["Mua sắm", "expense", "", "#FF7898"],
  ["Giải trí", "expense", "", "#A47BE8"], ["Sức khỏe", "expense", "", "#58B999"],
  ["Giáo dục", "expense", "", "#4B9BE8"], ["Lương", "income", "", "#78B732"],
  ["Thưởng", "income", "", "#8CBF42"], ["Trợ cấp", "income", "", "#56B4D3"],
  ["Thu khác", "income", "", "#69A9D8"],
] as const;

const navItems: { id: View; label: string; en: string; icon: string }[] = [
  { id: "overview", label: "Tổng quan", en: "Overview", icon: "⌂" },
  { id: "transactions", label: "Giao dịch", en: "Transactions", icon: "⇄" },
  { id: "wallets", label: "Ví & tài khoản", en: "Wallets", icon: "▣" },
  { id: "categories", label: "Danh mục", en: "Categories", icon: "◫" },
  { id: "planning", label: "Ngân sách & mục tiêu", en: "Plans & goals", icon: "◎" },
  { id: "recurring", label: "Giao dịch định kỳ", en: "Recurring", icon: "↻" },
  { id: "reports", label: "Báo cáo", en: "Reports", icon: "▥" },
  { id: "ai-assistant", label: "Trợ lý AI", en: "AI Assistant", icon: "✦" },
  { id: "settings", label: "Cài đặt", en: "Settings", icon: "⚙" },
];

function mapWallet(row: Record<string, unknown>): Wallet { return { ...row, balance: toNumber(row.balance), reserved_amount: toNumber(row.reserved_amount) } as Wallet; }
function mapTransaction(row: Record<string, unknown>): Transaction { return { ...row, amount: toNumber(row.amount), payment_source_type: (row.payment_source_type as string) ?? "wallet", budget_id: (row.budget_id as string | null) ?? null } as Transaction; }
function mapTransfer(row: Record<string, unknown>): Transfer { return { ...row, amount: toNumber(row.amount) } as Transfer; }
function mapBudget(row: Record<string, unknown>): Budget { return { ...row, amount: toNumber(row.amount), allocated_amount: toNumber(row.allocated_amount), spent_amount: toNumber(row.spent_amount), remaining_amount: toNumber(row.remaining_amount), alert_percent: toNumber(row.alert_percent), status: (row.status as string) ?? "active" } as Budget; }
function mapGoal(row: Record<string, unknown>): SavingsGoal { return { ...row, target_amount: toNumber(row.target_amount), current_amount: toNumber(row.current_amount), reserved_in_wallet: toNumber(row.reserved_in_wallet) } as SavingsGoal; }
function mapRecurring(row: Record<string, unknown>): RecurringTransaction { return { ...row, amount: toNumber(row.amount) } as RecurringTransaction; }
function mapAllocation(row: Record<string, unknown>): FundAllocation { return { ...row, amount: toNumber(row.amount) } as FundAllocation; }

function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button className="modal-backdrop" onClick={onClose} aria-label="Đóng" />
      <section className="transaction-modal finance-modal">
        <div className="modal-head"><div><p>{eyebrow}</p><h2 id="modal-title">{title}</h2></div><button type="button" onClick={onClose}>×</button></div>
        {children}
      </section>
    </div>
  );
}

export default function Dashboard({ user, onSignOut }: { user: UserInfo; onSignOut: () => Promise<void> }) {
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<View>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [profile, setProfile] = useState<Profile>({ id: user.id, username: null, full_name: user.name, currency: "VND", language: "vi" });
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | TransactionType>("all");
  const [walletFilter, setWalletFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sort, setSort] = useState("date-desc");
  const [reportPeriod, setReportPeriod] = useState<"day" | "week" | "month" | "year">("month");
  const [smartInput, setSmartInput] = useState("");
  const [aiParsing, setAiParsing] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{ type: "success" | "warning" | "error"; message: string } | null>(null);
  const [recurringType, setRecurringType] = useState<TransactionType>("expense");
  const [transactionDraft, setTransactionDraft] = useState({ title: "", amount: "", type: "expense" as TransactionType, categoryId: "", walletId: "", budgetId: "", paymentSourceType: "wallet" as "wallet" | "budget", occurredAt: localDateTime(), note: "" });
  const [showNotifications, setShowNotifications] = useState(false);
  const [insufficientBalanceAlert, setInsufficientBalanceAlert] = useState<{
    type: "wallet" | "budget";
    id: string;
    name: string;
    availableBalance: number;
    expenseAmount: number;
    missingAmount: number;
  } | null>(null);
  const [quickTopupModal, setQuickTopupModal] = useState<{
    walletId: string;
    walletName: string;
    missingAmount: number;
  } | null>(null);
  const [highlightWalletSelect, setHighlightWalletSelect] = useState(false);
  const [focusAmountInput, setFocusAmountInput] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [appAccentColor, setAppAccentColor] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("app_accent_color") || "#D2F544";
    }
    return "#D2F544";
  });

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("app_accent_color") || "#D2F544";
      applyThemeAccent(saved);
    }
  }, []);

  function handleSelectAppAccent(color: string) {
    setAppAccentColor(color);
    if (typeof window !== "undefined") {
      localStorage.setItem("app_accent_color", color);
    }
    applyThemeAccent(color);
    showNotice(`Đã áp dụng màu chủ đạo mới: ${color.toUpperCase()}`);
  }

  const loadData = useCallback(async (runAutomation = true) => {
    setLoading(true);
    try {
      // Fetch core tables with resilient handling
      const [
        profileResult,
        walletResult,
        categoryResult,
        transactionResult,
        transferResult,
        budgetResult,
        goalResult,
        recurringResult
      ] = await Promise.allSettled([
        supabase.from("profiles").select("id,username,full_name,currency,language").eq("id", user.id).maybeSingle(),
        supabase.from("wallets").select("id,user_id,name,type,balance,reserved_amount,currency,color,icon").eq("user_id", user.id).order("created_at"),
        supabase.from("categories").select("id,user_id,name,kind,parent_id,icon,color,is_default").eq("user_id", user.id).order("kind").order("name"),
        supabase.from("transactions").select("id,user_id,title,amount,type,category,category_id,wallet_id,occurred_at,note,receipt_path,recurrence_id,budget_id,payment_source_type").eq("user_id", user.id).order("occurred_at", { ascending: false }).limit(500),
        supabase.from("transfers").select("id,user_id,from_wallet_id,to_wallet_id,amount,occurred_at,note").eq("user_id", user.id).order("occurred_at", { ascending: false }).limit(300),
        supabase.from("budgets").select("id,user_id,category_id,name,amount,allocated_amount,spent_amount,remaining_amount,source_wallet_id,period,period_start,start_date,end_date,alert_percent,status").eq("user_id", user.id).order("created_at"),
        supabase.from("savings_goals").select("id,user_id,title,target_amount,current_amount,reserved_in_wallet,source_wallet_id,deadline,color").eq("user_id", user.id).order("deadline", { ascending: true }),
        supabase.from("recurring_transactions").select("id,user_id,wallet_id,category_id,title,amount,type,frequency,next_run_at,active,auto_create,note").eq("user_id", user.id).order("next_run_at"),
      ]);

      let loadedProfile: Profile | null = profileResult.status === "fulfilled" && !profileResult.value.error ? (profileResult.value.data as Profile | null) : null;
      let loadedWallets: Wallet[] = walletResult.status === "fulfilled" && !walletResult.value.error ? ((walletResult.value.data ?? []).map((row: Record<string, unknown>) => mapWallet(row))) : [];
      let loadedCategories: Category[] = categoryResult.status === "fulfilled" && !categoryResult.value.error ? ((categoryResult.value.data ?? []) as Category[]) : [];
      let loadedTransactions: Transaction[] = transactionResult.status === "fulfilled" && !transactionResult.value.error ? ((transactionResult.value.data ?? []).map((row: Record<string, unknown>) => mapTransaction(row))) : [];
      let loadedTransfers: Transfer[] = transferResult.status === "fulfilled" && !transferResult.value.error ? ((transferResult.value.data ?? []).map((row: Record<string, unknown>) => mapTransfer(row))) : [];
      let loadedBudgets: Budget[] = budgetResult.status === "fulfilled" && !budgetResult.value.error ? ((budgetResult.value.data ?? []).map((row: Record<string, unknown>) => mapBudget(row))) : [];
      let loadedGoals: SavingsGoal[] = goalResult.status === "fulfilled" && !goalResult.value.error ? ((goalResult.value.data ?? []).map((row: Record<string, unknown>) => mapGoal(row))) : [];
      let loadedRecurring: RecurringTransaction[] = recurringResult.status === "fulfilled" && !recurringResult.value.error ? ((recurringResult.value.data ?? []).map((row: Record<string, unknown>) => mapRecurring(row))) : [];

      // Auto-provision profile if missing
      if (!loadedProfile) {
        try {
          const { data, error } = await supabase.from("profiles").upsert({ id: user.id, full_name: user.name, currency: "VND", language: "vi" }, { onConflict: "id" }).select("id,username,full_name,currency,language").single();
          if (!error && data) loadedProfile = data as Profile;
          else loadedProfile = { id: user.id, username: null, full_name: user.name, currency: "VND", language: "vi" };
        } catch {
          loadedProfile = { id: user.id, username: null, full_name: user.name, currency: "VND", language: "vi" };
        }
      }

      // Auto-provision initial wallet if explicitly empty (and query succeeded)
      const walletsQuerySucceeded = walletResult.status === "fulfilled" && !walletResult.value.error;
      if (walletsQuerySucceeded && !loadedWallets.length) {
        try {
          const { data, error } = await supabase.from("wallets").insert({ user_id: user.id, name: "Tiền mặt", type: "cash", balance: 0, currency: loadedProfile.currency, color: "#D9F45F", icon: "💵" }).select("id,user_id,name,type,balance,currency,color,icon").single();
          if (!error && data) loadedWallets = [mapWallet(data as Record<string, unknown>)];
        } catch (e) {
          console.warn("Could not auto-insert default wallet:", e);
        }
      }

      // Auto-provision default categories if explicitly empty (and query succeeded)
      const categoriesQuerySucceeded = categoryResult.status === "fulfilled" && !categoryResult.value.error;
      if (categoriesQuerySucceeded && !loadedCategories.length) {
        try {
          const payload = defaultCategories.map(([name, kind, icon, color]) => ({ user_id: user.id, name, kind, icon, color, is_default: true }));
          const { data, error } = await supabase.from("categories").insert(payload).select("id,user_id,name,kind,parent_id,icon,color,is_default");
          if (!error && data) loadedCategories = (data ?? []) as Category[];
        } catch (e) {
          console.warn("Could not auto-insert default categories:", e);
        }
      }

      if (runAutomation && loadedRecurring.length) {
        let automated = false;
        let skippedDueToBalance = 0;

        const getDynamicAvail = (wId: string) => {
          const w = loadedWallets.find(x => x.id === wId);
          if (!w) return 0;
          let bal = w.balance;
          loadedTransactions.forEach(t => {
            let act = t.wallet_id;
            if (!act && t.payment_source_type === "budget" && t.budget_id) {
              act = loadedBudgets.find(b => b.id === t.budget_id)?.source_wallet_id ?? null;
            }
            if (act === wId) bal += (t.type === "income" ? t.amount : -t.amount);
          });
          loadedTransfers.forEach(t => {
            if (t.from_wallet_id === wId) bal -= t.amount;
            if (t.to_wallet_id === wId) bal += t.amount;
          });
          let res = 0;
          loadedBudgets.forEach(b => {
            if (b.source_wallet_id === wId && b.remaining_amount > 0 && b.status === "active") res += b.remaining_amount;
          });
          loadedGoals.forEach(g => {
            if (g.source_wallet_id === wId && g.reserved_in_wallet > 0) res += g.reserved_in_wallet;
          });
          return bal - res;
        };

        for (const schedule of loadedRecurring.filter((item: any) => item.active && item.auto_create && new Date(item.next_run_at) <= new Date())) {
          if (schedule.type === "expense" && schedule.wallet_id) {
            const avail = getDynamicAvail(schedule.wallet_id);
            if (avail < schedule.amount) {
              skippedDueToBalance++;
              continue;
            }
          }

          const category = loadedCategories.find(item => item.id === schedule.category_id);
          const { data: newTx, error } = await supabase.from("transactions").insert({
            user_id: user.id, title: schedule.title, amount: schedule.amount, type: schedule.type,
            category: category?.name ?? (schedule.type === "income" ? "Thu khác" : "Khác"), category_id: schedule.category_id,
            wallet_id: schedule.wallet_id, occurred_at: schedule.next_run_at, note: schedule.note, recurrence_id: schedule.id,
          }).select().single();
          if (!error && newTx) {
            loadedTransactions.unshift(mapTransaction(newTx));
            await supabase.from("recurring_transactions").update({ next_run_at: advanceRecurring(schedule.next_run_at, schedule.frequency) }).eq("id", schedule.id);
            automated = true;
          }
        }
        if (automated) {
          const [freshTransactions, freshRecurring] = await Promise.allSettled([
            supabase.from("transactions").select("id,user_id,title,amount,type,category,category_id,wallet_id,occurred_at,note,receipt_path,recurrence_id,budget_id,payment_source_type").eq("user_id", user.id).order("occurred_at", { ascending: false }).limit(500),
            supabase.from("recurring_transactions").select("id,user_id,wallet_id,category_id,title,amount,type,frequency,next_run_at,active,auto_create,note").eq("user_id", user.id).order("next_run_at"),
          ]);
          if (freshTransactions.status === "fulfilled" && !freshTransactions.value.error) {
            loadedTransactions = (freshTransactions.value.data ?? []).map((row: Record<string, unknown>) => mapTransaction(row));
          }
          if (freshRecurring.status === "fulfilled" && !freshRecurring.value.error) {
            loadedRecurring = (freshRecurring.value.data ?? []).map((row: Record<string, unknown>) => mapRecurring(row));
          }
          showNotice("Đã tự động ghi nhận giao dịch định kỳ đến hạn.");
        }
        if (skippedDueToBalance > 0) {
          showNotice(`⚠ Có ${skippedDueToBalance} giao dịch định kỳ chưa thể ghi nhận tự động do ví không đủ số dư.`);
        }
      }

      setProfile(loadedProfile);
      setWallets(loadedWallets);
      setCategories(loadedCategories);
      setTransactions(loadedTransactions);
      setTransfers(loadedTransfers);
      setBudgets(loadedBudgets);
      setGoals(loadedGoals);
      setRecurring(loadedRecurring);
    } catch (error) {
      console.error("loadData error:", error);
      showNotice(error instanceof Error ? error.message : "Không thể tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }, [showNotice, supabase, user.id, user.name]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(true), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const locale = profile.language === "vi" ? "vi-VN" : "en-SG";
  const money = useCallback((amount: number) => new Intl.NumberFormat(locale, { style: "currency", currency: profile.currency, maximumFractionDigits: profile.currency === "VND" ? 0 : 2 }).format(amount), [locale, profile.currency]);
  const categoryById = useMemo(() => new Map(categories.map(item => [item.id, item])), [categories]);
  const walletById = useMemo(() => new Map(wallets.map(item => [item.id, item])), [wallets]);

  const walletBalances = useMemo(() => {
    // Base balance + income transactions - all expense transactions (including budget-sourced)
    const values = new Map(wallets.map(item => [item.id, item.balance]));
    transactions.forEach(item => {
      let actualWalletId = item.wallet_id;
      // Backward compatibility: if transaction is budget-sourced but lacks wallet_id, resolve it via budget
      if (!actualWalletId && item.payment_source_type === "budget" && item.budget_id) {
        actualWalletId = budgets.find(b => b.id === item.budget_id)?.source_wallet_id ?? null;
      }
      if (!actualWalletId) return;

      if (item.type === "income") {
        values.set(actualWalletId, (values.get(actualWalletId) ?? 0) + item.amount);
      } else {
        // All expenses subtract from the physical wallet
        values.set(actualWalletId, (values.get(actualWalletId) ?? 0) - item.amount);
      }
    });
    transfers.forEach(item => {
      values.set(item.from_wallet_id, (values.get(item.from_wallet_id) ?? 0) - item.amount);
      values.set(item.to_wallet_id, (values.get(item.to_wallet_id) ?? 0) + item.amount);
    });
    return values;
  }, [transactions, transfers, wallets, budgets]);

  // Dynamically compute reserved amounts per wallet based on ACTIVE budgets and goals
  const walletReservedMap = useMemo(() => {
    const map = new Map<string, number>();
    wallets.forEach(w => map.set(w.id, 0));
    budgets.forEach(b => {
      if (b.source_wallet_id && b.remaining_amount > 0 && b.status === "active") {
        map.set(b.source_wallet_id, (map.get(b.source_wallet_id) ?? 0) + b.remaining_amount);
      }
    });
    goals.forEach(g => {
      if (g.source_wallet_id && g.reserved_in_wallet > 0) {
        map.set(g.source_wallet_id, (map.get(g.source_wallet_id) ?? 0) + g.reserved_in_wallet);
      }
    });
    return map;
  }, [wallets, budgets, goals]);

  // Available balance = total balance - reserved (locked in budgets/goals)
  const availableBalances = useMemo(() => {
    const avail = new Map(walletBalances);
    wallets.forEach(w => {
      const reserved = walletReservedMap.get(w.id) ?? 0;
      avail.set(w.id, (avail.get(w.id) ?? 0) - reserved);
    });
    return avail;
  }, [walletBalances, wallets, walletReservedMap]);

  const totalBalance = useMemo(() => [...walletBalances.values()].reduce((sum, v) => sum + v, 0), [walletBalances]);
  const totalReserved = useMemo(() => [...walletReservedMap.values()].reduce((sum, v) => sum + v, 0), [walletReservedMap]);
  const totalAvailable = useMemo(() => totalBalance - totalReserved, [totalBalance, totalReserved]);
  const totalAssets = totalBalance; // walletBalances already includes all money (available + reserved)
  const currentMonth = periodBounds("month");
  const monthTransactions = useMemo(() => transactions.filter(item => inRange(item, currentMonth.start, currentMonth.end)), [currentMonth.end, currentMonth.start, transactions]);
  const monthTotals = useMemo(() => monthTransactions.reduce((total, item) => ({ ...total, [item.type]: total[item.type] + item.amount }), { income: 0, expense: 0 }), [monthTransactions]);

  const filteredTransactions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return [...transactions].filter(item => {
      const category = categoryById.get(item.category_id ?? "")?.name ?? item.category;
      const wallet = walletById.get(item.wallet_id ?? "")?.name ?? "";
      const haystack = `${item.title} ${item.note} ${category} ${wallet}`.toLocaleLowerCase("vi");
      return (!normalized || haystack.includes(normalized))
        && (kindFilter === "all" || item.type === kindFilter)
        && (walletFilter === "all" || item.wallet_id === walletFilter)
        && (categoryFilter === "all" || item.category_id === categoryFilter)
        && (!dateFrom || new Date(item.occurred_at) >= new Date(`${dateFrom}T00:00:00`))
        && (!dateTo || new Date(item.occurred_at) <= new Date(`${dateTo}T23:59:59`))
        && (!minAmount || item.amount >= Number(minAmount))
        && (!maxAmount || item.amount <= Number(maxAmount));
    }).sort((a, b) => {
      if (sort === "date-asc") return +new Date(a.occurred_at) - +new Date(b.occurred_at);
      if (sort === "amount-desc") return b.amount - a.amount;
      if (sort === "amount-asc") return a.amount - b.amount;
      return +new Date(b.occurred_at) - +new Date(a.occurred_at);
    });
  }, [categoryById, categoryFilter, dateFrom, dateTo, kindFilter, maxAmount, minAmount, query, sort, transactions, walletById, walletFilter]);

  const report = useMemo(() => {
    const bounds = periodBounds(reportPeriod);
    const previous = periodBounds(reportPeriod, -1);
    const current = transactions.filter(item => inRange(item, bounds.start, bounds.end));
    const old = transactions.filter(item => inRange(item, previous.start, previous.end));
    const totals = (items: Transaction[]) => items.reduce((value, item) => ({ ...value, [item.type]: value[item.type] + item.amount }), { income: 0, expense: 0 });
    const categoryTotals = new Map<string, number>();
    current.filter(item => item.type === "expense").forEach(item => categoryTotals.set(item.category_id ?? item.category, (categoryTotals.get(item.category_id ?? item.category) ?? 0) + item.amount));
    const categoryRows = [...categoryTotals.entries()].map(([id, amount]) => ({ id, name: categoryById.get(id)?.name ?? id, color: categoryById.get(id)?.color ?? "#98A1A5", amount })).sort((a, b) => b.amount - a.amount);
    const bucketCount = reportPeriod === "day" ? 6 : reportPeriod === "week" ? 7 : reportPeriod === "month" ? 5 : 12;
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({ index, income: 0, expense: 0, label: reportPeriod === "year" ? `T${index + 1}` : reportPeriod === "week" ? ["T2", "T3", "T4", "T5", "T6", "T7", "CN"][index] : reportPeriod === "day" ? `${index * 4}h` : `T${index + 1}` }));
    current.forEach(item => {
      const date = new Date(item.occurred_at);
      let index = 0;
      if (reportPeriod === "day") index = Math.min(5, Math.floor(date.getHours() / 4));
      if (reportPeriod === "week") index = (date.getDay() + 6) % 7;
      if (reportPeriod === "month") index = Math.min(4, Math.floor((date.getDate() - 1) / 7));
      if (reportPeriod === "year") index = date.getMonth();
      buckets[index][item.type] += item.amount;
    });
    return { current: totals(current), previous: totals(old), categories: categoryRows, buckets };
  }, [categoryById, reportPeriod, transactions]);

  const budgetAlerts = useMemo(() => {
    const alerts: Array<{ id: string; kind: "over" | "near" | "done"; title: string; body: string }> = [];
    budgets.forEach(budget => {
      const bounds = periodBounds(budget.period === "weekly" ? "week" : budget.period === "yearly" ? "year" : "month");
      const spent = transactions.filter(item =>
        item.type === "expense" && inRange(item, bounds.start, bounds.end) &&
        (!budget.category_id || item.category_id === budget.category_id)
      ).reduce((sum, item) => sum + item.amount, 0);
      const percent = Math.round(spent / budget.amount * 100);
      if (percent >= 100) {
        alerts.push({ id: budget.id, kind: "over", title: `Vượt ngân sách: ${budget.name}`, body: `Đã chi ${percent}% — vượt ${money(spent - budget.amount)}` });
      } else if (percent >= budget.alert_percent) {
        alerts.push({ id: budget.id, kind: "near", title: `Sắp đạt hạn mức: ${budget.name}`, body: `Đã chi ${percent}% / ${money(budget.amount)}` });
      }
    });
    goals.forEach(goal => {
      if (goal.target_amount > 0 && goal.current_amount >= goal.target_amount) {
        alerts.push({ id: goal.id, kind: "done", title: `Mục tiêu hoàn thành: ${goal.title}`, body: `Đã tích lũy đủ ${money(goal.target_amount)} 🎉` });
      }
    });
    return alerts;
  }, [budgets, goals, transactions, money]);

  function openModal(next: NonNullable<ModalState>) {
    setModal(next);
    if (next.kind === "transaction") {
      const item = next.item;
      setTransactionDraft(item
        ? { title: item.title, amount: String(item.amount), type: item.type, categoryId: item.category_id ?? "", walletId: item.wallet_id ?? "", budgetId: item.budget_id ?? "", paymentSourceType: item.payment_source_type ?? "wallet", occurredAt: localDateTime(item.occurred_at), note: item.note }
        : { title: "", amount: "", type: "expense", categoryId: categories.find(v => v.kind === "expense")?.id ?? "", walletId: wallets[0]?.id ?? "", budgetId: "", paymentSourceType: "wallet", occurredAt: localDateTime(), note: "" });
      setSmartInput("");
      setAiFeedback(null);
      setAiParsing(false);
    }
    if (next.kind === "recurring") setRecurringType(next.item?.type ?? "expense");
  }

  function handleGlobalSearch(value: string) {
    setQuery(value);
    if (value.trim()) {
      setView("transactions");
      setKindFilter("all");
      setWalletFilter("all");
      setCategoryFilter("all");
      setDateFrom("");
      setDateTo("");
    }
  }

  function handleChooseAnotherWallet() {
    setInsufficientBalanceAlert(null);
    setHighlightWalletSelect(true);
    setTimeout(() => {
      const el = document.querySelector(".payment-source-group");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  const applyParsedTransaction = (parsed: any, mode: "local" | "fallback", customMsg?: string) => {
    setTransactionDraft((cur) => {
      const nextType = parsed.type || cur.type;
      let nextCategoryId = parsed.categoryId;
      if (!nextCategoryId) {
        const curCat = categories.find((c) => c.id === cur.categoryId);
        if (curCat && curCat.kind === nextType) {
          nextCategoryId = cur.categoryId;
        } else {
          nextCategoryId = categories.find((c) => c.kind === nextType)?.id ?? "";
        }
      }
      return {
        ...cur,
        title: parsed.name || cur.title,
        type: nextType,
        amount: parsed.amount ? String(parsed.amount) : cur.amount,
        categoryId: nextCategoryId,
        walletId: parsed.walletId || cur.walletId || wallets[0]?.id || "",
        occurredAt: parsed.date ? localDateTime(parsed.date) : cur.occurredAt,
      };
    });

    if (customMsg) {
      setAiFeedback({ type: "warning", message: customMsg });
      showNotice(customMsg);
    } else if (!parsed.type || !parsed.amount) {
      setAiFeedback({
        type: "warning",
        message: "⚠ Đã nhận diện một phần — vui lòng kiểm tra lại các trường còn thiếu.",
      });
      showNotice("⚠ Đã nhận diện một phần — vui lòng kiểm tra lại các trường còn thiếu.");
    } else {
      setAiFeedback({
        type: "success",
        message: `✓ Đã nhận diện: ${parsed.summaryText}`,
      });
      showNotice(`✓ Đã nhận diện: ${parsed.summaryText}`);
    }
  };

  const handleAITextParse = async (inputText?: string) => {
    const textToParse = (typeof inputText === "string" ? inputText : smartInput).trim();
    if (!textToParse) {
      showNotice("Vui lòng nhập nội dung giao dịch.");
      return;
    }
    if (aiParsing) return;

    setAiParsing(true);
    setAiFeedback(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        // Fallback to local parser if not logged in
        const parsed = parseSmartTransaction(textToParse, categories, wallets);
        applyParsedTransaction(parsed, "local");
        return;
      }

      const res = await fetch("/api/ai/parse-transaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: textToParse,
          client_date: new Date().toISOString().slice(0, 10),
        }),
      });

      const resJson = await res.json();

      if (!res.ok || !resJson.success) {
        const errMsg = resJson.error || "Không thể phân tích bằng AI. Đang chuyển sang nhận diện ngoại tuyến.";
        console.warn("AI parse API error, falling back:", errMsg);
        const parsed = parseSmartTransaction(textToParse, categories, wallets);
        applyParsedTransaction(parsed, "fallback", errMsg);
        return;
      }

      const aiData: AITransactionParseResult = resJson.data;

      // Apply AI structured output to transaction draft
      setTransactionDraft((cur) => {
        const nextType = aiData.transaction_type || cur.type;

        let nextCategoryId = cur.categoryId;
        if (aiData.category_id) {
          nextCategoryId = aiData.category_id;
        } else {
          const curCat = categories.find((c) => c.id === cur.categoryId);
          if (curCat && curCat.kind === nextType) {
            nextCategoryId = cur.categoryId;
          } else {
            nextCategoryId = categories.find((c) => c.kind === nextType)?.id ?? "";
          }
        }

        let nextWalletId = cur.walletId;
        if (aiData.wallet_id) {
          nextWalletId = aiData.wallet_id;
        }

        let nextOccurredAt = cur.occurredAt;
        if (aiData.date) {
          const timePart = aiData.time || new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
          nextOccurredAt = `${aiData.date}T${timePart}`;
        }

        return {
          ...cur,
          title: aiData.description || cur.title || textToParse,
          type: nextType,
          amount: aiData.amount ? String(aiData.amount) : cur.amount,
          categoryId: nextCategoryId,
          walletId: nextWalletId,
          paymentSourceType: "wallet",
          budgetId: "",
          occurredAt: nextOccurredAt,
        };
      });

      // Show friendly feedback
      const missingFields: string[] = [];
      if (!aiData.amount) missingFields.push("số tiền");
      if (!aiData.wallet_id) missingFields.push("ví/tài khoản thanh toán");
      if (!aiData.category_id) missingFields.push("danh mục");

      if (missingFields.length > 0) {
        setAiFeedback({
          type: "warning",
          message: `✓ AI đã điền form. Vui lòng chọn thêm: ${missingFields.join(", ")}.`,
        });
        showNotice(`⚠ AI đã điền một phần — vui lòng chọn thêm: ${missingFields.join(", ")}.`);
      } else {
        setAiFeedback({
          type: "success",
          message: "✓ AI đã nhận diện và điền thông tin vào form. Hãy kiểm tra trước khi lưu.",
        });
        showNotice(`✓ AI đã nhận diện: ${aiData.description || textToParse} (${money(aiData.amount || 0)})`);
      }
    } catch (err: any) {
      console.error("AI parse exception:", err);
      const parsed = parseSmartTransaction(textToParse, categories, wallets);
      applyParsedTransaction(parsed, "fallback", "Lỗi kết nối AI. Đã nhận diện ngoại tuyến.");
    } finally {
      setAiParsing(false);
    }
  };

  function handleReduceAmount() {
    setInsufficientBalanceAlert(null);
    setFocusAmountInput(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(".amount-input-wrapper input");
      input?.focus();
      input?.select();
    }, 100);
  }

  function handleOpenTopup() {
    if (!insufficientBalanceAlert) return;
    if (insufficientBalanceAlert.type === "wallet") {
      const targetWallet = wallets.find(w => w.id === insufficientBalanceAlert.id);
      setQuickTopupModal({
        walletId: insufficientBalanceAlert.id,
        walletName: targetWallet?.name ?? "Ví",
        missingAmount: insufficientBalanceAlert.missingAmount,
      });
      setInsufficientBalanceAlert(null);
    } else {
      const targetBudget = budgets.find(b => b.id === insufficientBalanceAlert.id);
      if (targetBudget) {
        setModal({ kind: "budget-topup", budget: targetBudget });
        setInsufficientBalanceAlert(null);
      }
    }
  }

  async function handleSaveQuickTopup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quickTopupModal) return;
    setSaving(true);
    try {
      const form = new FormData(event.currentTarget);
      const topupAmount = Number(form.get("amount"));
      const categoryId = String(form.get("categoryId") || "");
      const note = String(form.get("note") || "").trim();

      if (topupAmount <= 0) throw new Error("Số tiền bổ sung phải lớn hơn 0.");

      const category = categoryById.get(categoryId);
      const targetWallet = wallets.find(w => w.id === quickTopupModal.walletId);

      const { error } = await supabase.from("transactions").insert({
        user_id: user.id,
        title: `Bổ sung số dư: ${transactionDraft.title.trim() || targetWallet?.name || "Ví"}`,
        amount: topupAmount,
        type: "income",
        category: category?.name ?? "Thu khác",
        category_id: categoryId || null,
        wallet_id: quickTopupModal.walletId,
        occurred_at: new Date().toISOString(),
        note: note || `Bổ sung số dư cho khoản chi "${transactionDraft.title}"`,
      });

      if (error) throw error;

      showNotice(`✓ Đã bổ sung ${money(topupAmount)} vào ví "${targetWallet?.name ?? "Ví"}".`);
      setQuickTopupModal(null);
      await loadData(false);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : "Không thể bổ sung số dư.");
    } finally {
      setSaving(false);
    }
  }

  async function saveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transactionDraft.title.trim()) return showNotice("Hãy nhập tên giao dịch.");
    if (!transactionDraft.amount || Number(transactionDraft.amount) <= 0) return showNotice("Số tiền phải lớn hơn 0.");
    if (!transactionDraft.categoryId) return showNotice("Hãy chọn danh mục.");
    // If paying from budget, walletId is not required
    if (transactionDraft.paymentSourceType === "wallet" && !transactionDraft.walletId) return showNotice("Hãy chọn ví thanh toán.");
    if (transactionDraft.paymentSourceType === "budget" && !transactionDraft.budgetId) return showNotice("Hãy chọn ngân sách.");

    const isEditing = modal?.kind === "transaction" && modal.item;
    const amount = Number(transactionDraft.amount);
    if (isNaN(amount) || amount <= 0) {
      return showNotice("Số tiền phải lớn hơn 0.");
    }

    // Validate available balance for ANY expense transaction
    if (transactionDraft.type === "expense") {
      if (transactionDraft.paymentSourceType === "budget" && transactionDraft.budgetId) {
        const matchedBudget = budgets.find(b => b.id === transactionDraft.budgetId);
        if (!matchedBudget) return showNotice("Hãy chọn ngân sách.");
        const avail = matchedBudget.remaining_amount;
        if (amount > avail) {
          setInsufficientBalanceAlert({
            type: "budget",
            id: matchedBudget.id,
            name: matchedBudget.name,
            availableBalance: avail,
            expenseAmount: amount,
            missingAmount: amount - avail,
          });
          return;
        }
      } else {
        const selectedWallet = wallets.find(w => w.id === transactionDraft.walletId);
        if (!selectedWallet) return showNotice("Hãy chọn ví thanh toán.");
        
        let avail = availableBalances.get(selectedWallet.id) ?? 0;
        if (isEditing && modal.item?.type === "expense" && modal.item?.wallet_id === selectedWallet.id) {
          avail += modal.item.amount;
        }

        if (amount > avail) {
          setInsufficientBalanceAlert({
            type: "wallet",
            id: selectedWallet.id,
            name: selectedWallet.name,
            availableBalance: avail,
            expenseAmount: amount,
            missingAmount: amount - avail,
          });
          return;
        }
      }
    }

    setSaving(true);
    let receiptPath = modal?.kind === "transaction" ? modal.item?.receipt_path ?? null : null;
    let uploadedPath: string | null = null;
    try {
      const form = new FormData(event.currentTarget);
      const file = form.get("receipt");
      if (file instanceof File && file.size > 0) {
        if (file.size > 8 * 1024 * 1024) throw new Error("Hóa đơn cần nhỏ hơn 8 MB.");
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        uploadedPath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage.from("receipts").upload(uploadedPath, file, { upsert: false });
        if (error) throw error;
        receiptPath = uploadedPath;
      }
      const category = categoryById.get(transactionDraft.categoryId);
      const isBudgetSource = transactionDraft.type === "expense" && transactionDraft.paymentSourceType === "budget" && transactionDraft.budgetId;
      let actualWalletId = transactionDraft.walletId || wallets[0]?.id || null;
      if (isBudgetSource) {
        actualWalletId = budgets.find(b => b.id === transactionDraft.budgetId)?.source_wallet_id ?? actualWalletId;
      }

      const payload: Record<string, unknown> = {
        user_id: user.id,
        title: transactionDraft.title.trim(),
        amount,
        type: transactionDraft.type,
        category: category?.name ?? "Khác",
        category_id: transactionDraft.categoryId,
        wallet_id: isBudgetSource ? null : actualWalletId,
        occurred_at: new Date(transactionDraft.occurredAt).toISOString(),
        note: transactionDraft.note.trim(),
        receipt_path: receiptPath,
        budget_id: isBudgetSource ? transactionDraft.budgetId : null,
        payment_source_type: transactionDraft.paymentSourceType,
      };

      if (isEditing) {
        const oldTx = transactions.find(t => t.id === modal.item!.id);
        if (oldTx && (oldTx.payment_source_type === "budget" || isBudgetSource)) {
          if (oldTx.payment_source_type !== transactionDraft.paymentSourceType || oldTx.budget_id !== transactionDraft.budgetId) {
            throw new Error("Không thể thay đổi nguồn thanh toán của giao dịch ngân sách. Vui lòng xóa và tạo lại.");
          }
          if (oldTx.amount !== amount) {
            throw new Error("Không thể sửa số tiền của giao dịch từ ngân sách. Vui lòng xóa và tạo lại.");
          }
        }

        const oldReceipt = modal.item!.receipt_path;
        const { error } = await supabase.from("transactions").update(payload).eq("id", modal.item!.id);
        if (error) throw error;
        if (uploadedPath && oldReceipt) await supabase.storage.from("receipts").remove([oldReceipt]);
      } else {
        // Insert transaction first
        const { error } = await supabase.from("transactions").insert(payload);
        if (error) throw error;

        // If budget-sourced: update budget spent/remaining
        if (isBudgetSource) {
          const budget = budgets.find(b => b.id === transactionDraft.budgetId);
          if (budget) {
            if (budget.status !== "active" || budget.remaining_amount <= 0) {
              throw new Error(`Ngân sách “${budget.name}” đã rút hết hoặc đã kết thúc, không thể chi thêm.`);
            }
            if (amount > budget.remaining_amount) {
              throw new Error(`Ngân sách này không đủ số dư. Thiếu ${money(amount - budget.remaining_amount)}`);
            }
            const newRemaining = Math.max(0, budget.remaining_amount - amount);
            const newSpent = budget.spent_amount + amount;
            const newStatus = newRemaining <= 0 ? "completed" : budget.status;

            const { error: budgetErr } = await supabase.from("budgets").update({
              spent_amount: newSpent,
              remaining_amount: newRemaining,
              status: newStatus,
            }).eq("id", budget.id);
            if (budgetErr) throw budgetErr;
            // Also reduce reserved_amount in source wallet
            if (budget.source_wallet_id) {
              const sourceWallet = wallets.find(w => w.id === budget.source_wallet_id);
              if (sourceWallet) {
                await supabase.from("wallets").update({
                  reserved_amount: Math.max(0, sourceWallet.reserved_amount - amount),
                }).eq("id", sourceWallet.id);
              }
            }
          }
        }
      }

      setModal(null);
      showNotice("Giao dịch đã được lưu.");
      await loadData(false);
    } catch (error) {
      if (uploadedPath) await supabase.storage.from("receipts").remove([uploadedPath]);
      const errMsg = error instanceof Error ? error.message : "Không thể lưu giao dịch.";
      if (errMsg.includes("INSUFFICIENT_BALANCE")) {
        if (transactionDraft.paymentSourceType === "budget" && transactionDraft.budgetId) {
          const budget = budgets.find(b => b.id === transactionDraft.budgetId);
          if (budget) {
            setInsufficientBalanceAlert({
              type: "budget", id: budget.id, name: budget.name,
              availableBalance: budget.remaining_amount,
              expenseAmount: amount,
              missingAmount: Math.max(0, amount - budget.remaining_amount),
            });
          }
        } else {
          const wallet = wallets.find(w => w.id === (transactionDraft.walletId || wallets[0]?.id)) ?? wallets[0];
          const avail = availableBalances.get(wallet?.id ?? "") ?? 0;
          setInsufficientBalanceAlert({
            type: "wallet", id: wallet?.id ?? "", name: wallet?.name ?? "Ví",
            availableBalance: avail,
            expenseAmount: amount,
            missingAmount: Math.max(0, amount - avail),
          });
        }
      } else {
        showNotice(errMsg);
      }
    } finally { setSaving(false); }
  }

  async function handleConfirmReceiptTransaction(data: {
    title: string;
    amount: number;
    type: TransactionType;
    categoryId: string;
    walletId: string;
    budgetId: string;
    paymentSourceType: "wallet" | "budget";
    occurredAt: string;
    note: string;
    receiptFile: File | null;
  }) {
    const { title, amount, type, categoryId, walletId, budgetId, paymentSourceType, occurredAt, note, receiptFile } = data;

    if (!title.trim()) return showNotice("Hãy nhập tên giao dịch.");
    if (amount <= 0 || isNaN(amount)) return showNotice("Số tiền phải lớn hơn 0.");
    if (!categoryId) return showNotice("Hãy chọn danh mục.");
    if (paymentSourceType === "wallet" && !walletId) return showNotice("Hãy chọn ví thanh toán.");
    if (paymentSourceType === "budget" && !budgetId) return showNotice("Hãy chọn ngân sách.");

    // Validate available balance for expense transaction
    if (type === "expense") {
      if (paymentSourceType === "budget" && budgetId) {
        const matchedBudget = budgets.find(b => b.id === budgetId);
        if (!matchedBudget) return showNotice("Hãy chọn ngân sách.");
        const avail = matchedBudget.remaining_amount;
        if (amount > avail) {
          setInsufficientBalanceAlert({
            type: "budget",
            id: matchedBudget.id,
            name: matchedBudget.name,
            availableBalance: avail,
            expenseAmount: amount,
            missingAmount: amount - avail,
          });
          return;
        }
      } else {
        const selectedWallet = wallets.find(w => w.id === walletId);
        if (!selectedWallet) return showNotice("Hãy chọn ví thanh toán.");
        const avail = availableBalances.get(selectedWallet.id) ?? 0;
        if (amount > avail) {
          setInsufficientBalanceAlert({
            type: "wallet",
            id: selectedWallet.id,
            name: selectedWallet.name,
            availableBalance: avail,
            expenseAmount: amount,
            missingAmount: amount - avail,
          });
          return;
        }
      }
    }

    setSaving(true);
    let receiptPath: string | null = null;
    let uploadedPath: string | null = null;

    try {
      if (receiptFile instanceof File && receiptFile.size > 0) {
        if (receiptFile.size > 10 * 1024 * 1024) throw new Error("Hóa đơn cần nhỏ hơn 10 MB.");
        const safeName = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        uploadedPath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadErr } = await supabase.storage.from("receipts").upload(uploadedPath, receiptFile, { upsert: false });
        if (uploadErr) {
          console.warn("Storage upload notice:", uploadErr);
        } else {
          receiptPath = uploadedPath;
        }
      }

      const category = categoryById.get(categoryId);
      const isBudgetSource = type === "expense" && paymentSourceType === "budget" && budgetId;
      let actualWalletId = walletId || wallets[0]?.id || null;
      if (isBudgetSource) {
        actualWalletId = budgets.find(b => b.id === budgetId)?.source_wallet_id ?? actualWalletId;
      }

      const payload: Record<string, unknown> = {
        user_id: user.id,
        title: title.trim(),
        amount,
        type,
        category: category?.name ?? "Khác",
        category_id: categoryId,
        wallet_id: isBudgetSource ? null : actualWalletId,
        occurred_at: new Date(occurredAt).toISOString(),
        note: note.trim(),
        receipt_path: receiptPath,
        budget_id: isBudgetSource ? budgetId : null,
        payment_source_type: paymentSourceType,
      };

      const { error: insertErr } = await supabase.from("transactions").insert(payload);
      if (insertErr) throw insertErr;

      if (isBudgetSource) {
        const budget = budgets.find(b => b.id === budgetId);
        if (budget) {
          const newRemaining = Math.max(0, budget.remaining_amount - amount);
          const newSpent = budget.spent_amount + amount;
          const newStatus = newRemaining <= 0 ? "completed" : budget.status;
          await supabase.from("budgets").update({
            spent_amount: newSpent,
            remaining_amount: newRemaining,
            status: newStatus,
          }).eq("id", budget.id);
          if (budget.source_wallet_id) {
            const sourceWallet = wallets.find(w => w.id === budget.source_wallet_id);
            if (sourceWallet) {
              await supabase.from("wallets").update({
                reserved_amount: Math.max(0, sourceWallet.reserved_amount - amount),
              }).eq("id", sourceWallet.id);
            }
          }
        }
      }

      setModal(null);
      showNotice("✓ Đã tạo giao dịch thành công từ hóa đơn.");
      await loadData(false);
    } catch (error) {
      if (uploadedPath) {
        await supabase.storage.from("receipts").remove([uploadedPath]).catch(() => {});
      }
      const errMsg = error instanceof Error ? error.message : "Không thể lưu giao dịch từ hóa đơn.";
      showNotice(errMsg);
    } finally {
      setSaving(false);
    }
  }

  // ─── BUDGET: Phân bổ tiền từ ví vào ngân sách ────────────────
  async function allocateToBudget(walletId: string, budgetId: string, amount: number): Promise<void> {
    const wallet = wallets.find(w => w.id === walletId);
    if (!wallet) throw new Error("Không tìm thấy ví.");
    const available = (availableBalances.get(walletId) ?? 0);
    if (amount > available) throw new Error(`Ví “${wallet.name}” chỉ có ${money(available)} khả dụng.`);
    // Step 1: Increase reserved_amount in wallet
    const { error: wErr } = await supabase.from("wallets").update({ reserved_amount: wallet.reserved_amount + amount }).eq("id", walletId);
    if (wErr) throw wErr;
    // Step 2: Update budget allocation
    const budget = budgets.find(b => b.id === budgetId);
    const newAllocated = (budget?.allocated_amount ?? 0) + amount;
    const newRemaining = (budget?.remaining_amount ?? 0) + amount;
    const newAmount = Math.max(budget?.amount ?? 0, newAllocated + (budget?.spent_amount ?? 0));
    const { error: bErr } = await supabase.from("budgets").update({
      allocated_amount: newAllocated,
      remaining_amount: newRemaining,
      source_wallet_id: walletId,
      amount: newAmount,
      status: "active",
    }).eq("id", budgetId);
    if (bErr) {
      // Rollback wallet
      await supabase.from("wallets").update({ reserved_amount: wallet.reserved_amount }).eq("id", walletId);
      throw bErr;
    }
    // Step 3: Log fund allocation
    await supabase.from("fund_allocations").insert({ user_id: user.id, type: "wallet_to_budget", wallet_id: walletId, budget_id: budgetId, amount, note: "Phân bổ ngân sách" });
  }

  async function returnBudgetToWallet(budget: Budget, amount: number): Promise<void> {
    if (amount <= 0) return;
    if (!budget.source_wallet_id) throw new Error("Ngân sách không liên kết ví nguồn.");
    if (amount > budget.remaining_amount) throw new Error(`Chỉ có thể rút tối đa ${money(budget.remaining_amount)}.`);
    const wallet = wallets.find(w => w.id === budget.source_wallet_id);
    if (!wallet) throw new Error("Không tìm thấy ví nguồn.");
    
    const newRemaining = Math.max(0, budget.remaining_amount - amount);
    const newAllocated = Math.max(0, budget.allocated_amount - amount);
    const newStatus = newRemaining <= 0 ? "completed" : budget.status;

    // Update budget
    const { error: bErr } = await supabase.from("budgets").update({
      remaining_amount: newRemaining,
      allocated_amount: newAllocated,
      status: newStatus,
    }).eq("id", budget.id);
    if (bErr) throw bErr;
    // Update wallet reserved
    await supabase.from("wallets").update({ reserved_amount: Math.max(0, wallet.reserved_amount - amount) }).eq("id", wallet.id);
    await supabase.from("fund_allocations").insert({ user_id: user.id, type: "budget_to_wallet", wallet_id: wallet.id, budget_id: budget.id, amount, note: "Rút tiền khỏi ngân sách" });
  }

  async function saveBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const name = String(form.get("name") || "").trim();
      const amount = Number(form.get("amount"));
      const walletId = String(form.get("sourceWalletId") || "");
      const categoryId = String(form.get("categoryId") || "") || null;
      const period = String(form.get("period") || "monthly");
      const periodStart = String(form.get("periodStart") || new Date().toISOString().slice(0, 10));
      const alertPercent = Number(form.get("alertPercent") || 80);
      const existingBudget = modal?.kind === "budget" ? modal.item : undefined;

      if (!name) throw new Error("Hãy nhập tên ngân sách.");
      if (!existingBudget) {
        if (amount <= 0 || isNaN(amount)) throw new Error("Số tiền phải lớn hơn 0.");
        if (!walletId) throw new Error("Hãy chọn ví nguồn.");
        const sourceWallet = wallets.find(w => w.id === walletId);
        const avail = availableBalances.get(walletId) ?? 0;
        if (amount > avail) {
          throw new Error(`Ví “${sourceWallet?.name ?? "Ví"}” không đủ số dư khả dụng (${money(avail)}) để cấp vốn ${money(amount)} cho ngân sách.`);
        }
      }
      if (existingBudget) {
        // Editing: just update metadata, don't change allocation
        const { error } = await supabase.from("budgets").update({
          name, category_id: categoryId, period, period_start: periodStart, alert_percent: alertPercent,
        }).eq("id", existingBudget.id);
        if (error) throw error;
      } else {
        // Creating: insert budget with zero allocation, then allocate
        const { data, error } = await supabase.from("budgets").insert({
          user_id: user.id, name, amount: amount, allocated_amount: 0, spent_amount: 0, remaining_amount: 0,
          category_id: categoryId, source_wallet_id: walletId, period, period_start: periodStart, alert_percent: alertPercent, status: "active",
        }).select("id").single();
        if (error) throw error;
        // Load budgets into state first so allocateToBudget sees the new budget
        const { data: freshBudgets } = await supabase.from("budgets").select("id,user_id,category_id,name,amount,allocated_amount,spent_amount,remaining_amount,source_wallet_id,period,period_start,start_date,end_date,alert_percent,status").order("created_at");
        setBudgets((freshBudgets ?? []).map((r: any) => mapBudget(r as Record<string, unknown>)));
        await allocateToBudget(walletId, data.id, amount);
      }
      setModal(null); showNotice("Đã lưu ngân sách."); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể lưu ngân sách."); }
    finally { setSaving(false); }
  }

  async function deleteBudget(budget: Budget) {
    if (!window.confirm(`Xóa ngân sách “${budget.name}”?`)) return;
    setSaving(true);
    try {
      // Return remaining to wallet first
      if (budget.remaining_amount > 0 && budget.source_wallet_id) {
        const confirmed = window.confirm(`Hoàn ${money(budget.remaining_amount)} còn lại về ví?`);
        if (confirmed) await returnBudgetToWallet(budget, budget.remaining_amount);
      }
      const { error } = await supabase.from("budgets").delete().eq("id", budget.id);
      if (error) throw error;
      showNotice("Đã xóa ngân sách."); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể xóa."); }
    finally { setSaving(false); }
  }

  async function handleBudgetTopup(event: FormEvent<HTMLFormElement>, budget: Budget) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const amount = Number(form.get("amount") || 0);
      const walletId = String(form.get("walletId") || budget.source_wallet_id || "");
      if (amount <= 0) throw new Error("Số tiền phải lớn hơn 0.");
      await allocateToBudget(walletId, budget.id, amount);
      setModal(null); showNotice(`Đã nạp thêm ${money(amount)} vào ngân sách.`); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể nạp tiền."); }
    finally { setSaving(false); }
  }

  async function handleBudgetReturn(event: FormEvent<HTMLFormElement>, budget: Budget) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const amount = Number(form.get("amount") || 0);
      if (amount <= 0) throw new Error("Số tiền phải lớn hơn 0.");
      await returnBudgetToWallet(budget, amount);
      setModal(null); showNotice(`Đã rút ${money(amount)} về ví.`); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể rút tiền."); }
    finally { setSaving(false); }
  }

  // ─── GOAL: Phân bổ tiền từ ví vào mục tiêu ───────────────────
  async function allocateToGoal(walletId: string, goalId: string, amount: number): Promise<void> {
    const wallet = wallets.find(w => w.id === walletId);
    if (!wallet) throw new Error("Không tìm thấy ví.");
    const available = availableBalances.get(walletId) ?? 0;
    if (amount > available) throw new Error(`Ví “${wallet.name}” chỉ có ${money(available)} khả dụng.`);
    const { error: wErr } = await supabase.from("wallets").update({ reserved_amount: wallet.reserved_amount + amount }).eq("id", walletId);
    if (wErr) throw wErr;
    const goal = goals.find(g => g.id === goalId);
    const { error: gErr } = await supabase.from("savings_goals").update({
      current_amount: (goal?.current_amount ?? 0) + amount,
      reserved_in_wallet: (goal?.reserved_in_wallet ?? 0) + amount,
      source_wallet_id: walletId,
    }).eq("id", goalId);
    if (gErr) {
      await supabase.from("wallets").update({ reserved_amount: wallet.reserved_amount }).eq("id", walletId);
      throw gErr;
    }
    await supabase.from("fund_allocations").insert({ user_id: user.id, type: "wallet_to_goal", wallet_id: walletId, goal_id: goalId, amount, note: "Phân bổ mục tiêu" });
  }

  async function returnGoalToWallet(goal: SavingsGoal, amount: number): Promise<void> {
    if (amount <= 0) return;
    if (!goal.source_wallet_id) throw new Error("Mục tiêu không liên kết ví.");
    if (amount > goal.current_amount) throw new Error(`Chỉ có ${money(goal.current_amount)} trong mục tiêu.`);
    const wallet = wallets.find(w => w.id === goal.source_wallet_id);
    if (!wallet) throw new Error("Không tìm thấy ví.");
    const { error: gErr } = await supabase.from("savings_goals").update({
      current_amount: goal.current_amount - amount,
      reserved_in_wallet: Math.max(0, goal.reserved_in_wallet - amount),
    }).eq("id", goal.id);
    if (gErr) throw gErr;
    await supabase.from("wallets").update({ reserved_amount: Math.max(0, wallet.reserved_amount - amount) }).eq("id", wallet.id);
    await supabase.from("fund_allocations").insert({ user_id: user.id, type: "goal_to_wallet", wallet_id: wallet.id, goal_id: goal.id, amount, note: "Rút tiền khỏi mục tiêu" });
  }

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const title = String(form.get("title") || "").trim();
      const targetAmount = Number(form.get("targetAmount"));
      const initialDeposit = Number(form.get("initialDeposit") || 0);
      const walletId = String(form.get("sourceWalletId") || "");
      const deadline = String(form.get("deadline") || "") || null;
      const color = String(form.get("color") || "#D9F45F");
      if (!title) throw new Error("Hãy nhập tên mục tiêu.");
      if (targetAmount <= 0) throw new Error("Số tiền mục tiêu phải lớn hơn 0.");
      const existingGoal = modal?.kind === "goal" ? modal.item : undefined;
      if (existingGoal) {
        const { error } = await supabase.from("savings_goals").update({ title, target_amount: targetAmount, deadline, color }).eq("id", existingGoal.id);
        if (error) throw error;
      } else {
        if (initialDeposit > 0 && walletId) {
          const sourceWallet = wallets.find(w => w.id === walletId);
          const avail = availableBalances.get(walletId) ?? 0;
          if (initialDeposit > avail) {
            throw new Error(`Ví “${sourceWallet?.name ?? "Ví"}” không đủ số dư khả dụng (${money(avail)}) để gửi ${money(initialDeposit)} vào mục tiêu.`);
          }
        }
        const { data, error } = await supabase.from("savings_goals").insert({
          user_id: user.id, title, target_amount: targetAmount, current_amount: 0, reserved_in_wallet: 0,
          source_wallet_id: walletId || null, deadline, color,
        }).select("id").single();
        if (error) throw error;
        if (initialDeposit > 0 && walletId) {
          const { data: freshGoals } = await supabase.from("savings_goals").select("id,user_id,title,target_amount,current_amount,reserved_in_wallet,source_wallet_id,deadline,color").order("deadline", { ascending: true });
          setGoals((freshGoals ?? []).map((r: any) => mapGoal(r as Record<string, unknown>)));
          await allocateToGoal(walletId, data.id, initialDeposit);
        }
      }
      setModal(null); showNotice("Đã lưu mục tiêu."); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể lưu mục tiêu."); }
    finally { setSaving(false); }
  }

  async function handleGoalTopup(event: FormEvent<HTMLFormElement>, goal: SavingsGoal) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const amount = Number(form.get("amount") || 0);
      const walletId = String(form.get("walletId") || goal.source_wallet_id || "");
      if (amount <= 0) throw new Error("Số tiền phải lớn hơn 0.");
      await allocateToGoal(walletId, goal.id, amount);
      setModal(null); showNotice(`Đã gửi ${money(amount)} vào mục tiêu.`); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể nạp tiền."); }
    finally { setSaving(false); }
  }

  async function handleGoalReturn(event: FormEvent<HTMLFormElement>, goal: SavingsGoal) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const amount = Number(form.get("amount") || 0);
      if (amount <= 0) throw new Error("Số tiền phải lớn hơn 0.");
      await returnGoalToWallet(goal, amount);
      setModal(null); showNotice(`Đã rút ${money(amount)} về ví.`); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể rút tiền."); }
    finally { setSaving(false); }
  }

  async function saveSimple(event: FormEvent<HTMLFormElement>, kind: Exclude<NonNullable<ModalState>["kind"], "transaction" | "transfer" | "budget" | "goal" | "budget-topup" | "budget-return" | "goal-topup" | "goal-return">) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      let table = ""; let payload: Record<string, unknown> = { user_id: user.id };
      if (kind === "wallet") { table = "wallets"; payload = { ...payload, name: String(form.get("name") || "").trim(), type: form.get("type"), balance: Number(form.get("balance")), currency: profile.currency, color: form.get("color"), icon: form.get("icon") }; }
      if (kind === "category") { table = "categories"; payload = { ...payload, name: String(form.get("name") || "").trim(), kind: form.get("type"), parent_id: form.get("parentId") || null, icon: form.get("icon"), color: form.get("color"), is_default: false }; }
      if (kind === "recurring") { table = "recurring_transactions"; payload = { ...payload, title: String(form.get("title") || "").trim(), amount: Number(form.get("amount")), type: recurringType, wallet_id: form.get("walletId") || null, category_id: form.get("categoryId") || null, frequency: form.get("frequency"), next_run_at: new Date(String(form.get("nextRun"))).toISOString(), active: form.get("active") === "on", auto_create: form.get("autoCreate") === "on", note: String(form.get("note") || "").trim() }; }
      const current = modal && (modal.kind === kind) ? (modal as { kind: string; item?: Record<string, unknown> }).item : undefined;
      const result = current ? await supabase.from(table).update(payload).eq("id", (current as { id: string }).id) : await supabase.from(table).insert(payload);
      if (result.error) throw result.error;
      setModal(null); showNotice("Đã lưu thay đổi."); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể lưu dữ liệu."); }
    finally { setSaving(false); }
  }

  async function saveTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const from = String(form.get("fromWalletId")); const to = String(form.get("toWalletId"));
    const amount = Number(form.get("amount"));
    try {
      if (from === to) throw new Error("Ví nhận phải khác ví chuyển.");
      if (amount <= 0 || isNaN(amount)) throw new Error("Số tiền chuyển phải lớn hơn 0.");
      const fromWallet = wallets.find(w => w.id === from);
      const avail = availableBalances.get(from) ?? 0;
      if (amount > avail) {
        throw new Error(`Ví chuyển “${fromWallet?.name ?? "Ví"}” không đủ số dư khả dụng (${money(avail)}). Vui lòng nạp thêm tiền hoặc chuyển số tiền nhỏ hơn.`);
      }
      const { error } = await supabase.from("transfers").insert({
        user_id: user.id,
        from_wallet_id: from,
        to_wallet_id: to,
        amount,
        occurred_at: new Date(String(form.get("occurredAt"))).toISOString(),
        note: String(form.get("note") || "").trim()
      });
      if (error) throw error;
      setModal(null); showNotice("Đã chuyển tiền giữa hai ví."); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể chuyển tiền."); }
    finally { setSaving(false); }
  }

  async function remove(table: string, id: string, label: string, receiptPath?: string | null) {
    if (table === "wallets") {
      const walletTxs = transactions.filter(t => t.wallet_id === id);
      const walletTransfers = transfers.filter(t => t.from_wallet_id === id || t.to_wallet_id === id);
      const walletBudgets = budgets.filter(b => b.source_wallet_id === id);
      const walletGoals = goals.filter(g => g.source_wallet_id === id);
      const currentBal = walletBalances.get(id) ?? 0;

      let confirmMsg = `Bạn có chắc muốn xóa ví "${label}"?\n\nVí này hiện có:\n• ${walletTxs.length} giao dịch ghi nhận\n• ${walletTransfers.length} lịch sử chuyển tiền\n• Số dư hiện tại: ${money(currentBal)}`;

      if (walletBudgets.length > 0 || walletGoals.length > 0) {
        confirmMsg += `\n• Đang liên kết với ${walletBudgets.length} ngân sách và ${walletGoals.length} mục tiêu tiết kiệm`;
      }

      confirmMsg += `\n\nHành động này không thể hoàn tác. Bạn có chắc chắn muốn xóa?`;
      if (!window.confirm(confirmMsg)) return;

      // An toàn: Gỡ liên kết wallet_id trên các giao dịch thay vì làm mất lịch sử
      if (walletTxs.length > 0) {
        await supabase.from("transactions").update({ wallet_id: null }).eq("wallet_id", id);
      }
    } else {
      if (!window.confirm(`Xóa ${label}? Thao tác này không thể hoàn tác.`)) return;
    }

    if (table === "categories") await supabase.from("categories").update({ parent_id: null }).eq("parent_id", id);

    if (table === "transactions") {
      const tx = transactions.find(t => t.id === id);
      if (tx && tx.payment_source_type === "budget" && tx.budget_id) {
        const budget = budgets.find(b => b.id === tx.budget_id);
        if (budget) {
          await supabase.from("budgets").update({
            spent_amount: Math.max(0, budget.spent_amount - tx.amount),
            remaining_amount: budget.remaining_amount + tx.amount,
          }).eq("id", budget.id);
          if (budget.source_wallet_id) {
            const wallet = wallets.find(w => w.id === budget.source_wallet_id);
            if (wallet) {
              await supabase.from("wallets").update({
                reserved_amount: wallet.reserved_amount + tx.amount
              }).eq("id", wallet.id);
            }
          }
        }
      }
    }

    if (table === "budgets") {
      const budget = budgets.find(b => b.id === id);
      if (budget && budget.source_wallet_id) {
        const wallet = wallets.find(w => w.id === budget.source_wallet_id);
        if (wallet) {
          await supabase.from("wallets").update({
            reserved_amount: Math.max(0, wallet.reserved_amount - budget.remaining_amount)
          }).eq("id", wallet.id);
        }
      }
    }

    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) return showNotice(error.message);
    if (receiptPath) await supabase.storage.from("receipts").remove([receiptPath]);
    showNotice("Đã xóa dữ liệu."); await loadData(false);
  }

  async function openReceipt(path: string) {
    const { data, error } = await supabase.storage.from("receipts").createSignedUrl(path, 120);
    if (error) return showNotice(error.message);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function createDueTransaction(item: RecurringTransaction) {
    if (item.type === "expense" && item.wallet_id) {
      const avail = availableBalances.get(item.wallet_id) ?? 0;
      if (item.amount > avail) {
        const targetWallet = wallets.find(w => w.id === item.wallet_id);
        setInsufficientBalanceAlert({
          type: "wallet",
          id: item.wallet_id,
          name: targetWallet?.name ?? "Ví",
          availableBalance: avail,
          expenseAmount: item.amount,
          missingAmount: item.amount - avail,
        });
        return;
      }
    }
    const category = categoryById.get(item.category_id ?? "");
    const { error } = await supabase.from("transactions").insert({
      user_id: user.id,
      title: item.title,
      amount: item.amount,
      type: item.type,
      category: category?.name ?? (item.type === "income" ? "Thu khác" : "Khác"),
      category_id: item.category_id,
      wallet_id: item.wallet_id,
      occurred_at: new Date().toISOString(),
      note: item.note,
      recurrence_id: item.id
    });
    if (error) return showNotice(error.message);
    await supabase.from("recurring_transactions").update({ next_run_at: advanceRecurring(item.next_run_at, item.frequency) }).eq("id", item.id);
    showNotice(`✓ Đã ghi nhận giao dịch "${item.title}" (${money(item.amount)}).`);
    await loadData(false);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      const fullName = String(form.get("fullName") || "").trim();
      const username = String(form.get("username") || "").trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Tên tài khoản phải có 3–24 ký tự, chỉ gồm chữ cái, số hoặc dấu gạch dưới.");
      const payload = { id: user.id, username, full_name: fullName, currency: String(form.get("currency")), language: String(form.get("language")) };
      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" });
      if (error) throw error;
      const authResult = await supabase.auth.updateUser({ data: { full_name: fullName, username } });
      if (authResult.error) throw authResult.error;
      setProfile(payload as Profile); showNotice("Hồ sơ và tùy chọn đã được cập nhật.");
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể cập nhật hồ sơ."); }
    finally { setSaving(false); }
  }

  async function deletePersonalData() {
    const confirmation = window.prompt("⚠️ CẢNH BÁO: Nhập 'XÓA' để xác nhận XÓA VĨNH VIỄN toàn bộ ví, giao dịch, ngân sách, mục tiêu và hóa đơn khỏi Database.\n\nTài khoản đăng nhập vẫn được giữ. Thao tác này không thể hoàn tác!");
    if (confirmation !== "XÓA") return;
    setSaving(true);
    try {
      // 1. Storage receipts files
      const { data: files } = await supabase.storage.from("receipts").list(user.id, { limit: 1000 });
      if (files?.length) {
        await supabase.storage.from("receipts").remove(files.map((file: any) => `${user.id}/${file.name}`));
      }

      // 2. Clear parent_id in custom categories first to avoid FK constraint issues
      await supabase.from("categories").update({ parent_id: null }).eq("user_id", user.id);

      // 3. Delete in exact FK dependency order:
      const tablesToDelete = [
        "fund_allocations",
        "transactions",
        "transfers",
        "recurring_transactions",
        "budgets",
        "savings_goals",
        "categories",
        "wallets",
      ];

      for (const table of tablesToDelete) {
        const { error } = await supabase.from(table).delete().eq("user_id", user.id);
        if (error) {
          console.warn(`Deleting ${table}:`, error.message);
        }
      }

      // Reset local states
      setTransactions([]);
      setWallets([]);
      setBudgets([]);
      setGoals([]);
      setTransfers([]);
      setRecurring([]);

      showNotice("✓ Đã xóa vĩnh viễn toàn bộ dữ liệu tài chính trong Database.");
      await loadData(false);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Không thể xóa dữ liệu.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadData() {
    if (isExporting) return;
    setIsExporting(true);
    try {
      showNotice("Đang thu thập và chuẩn bị dữ liệu xuất Excel…");
      const fileName = await exportFinancialDataToExcel({
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
      });
      showNotice(`✓ Dữ liệu của bạn đã được xuất thành công sang tệp "${fileName}".`);
    } catch (err) {
      console.error("Export Excel error:", err);
      showNotice("Không thể xuất file Excel: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExporting(false);
    }
  }

  const firstName = profile.full_name.trim().split(" ").pop() || user.name;
  const language = profile.language;
  const maxReportBar = Math.max(1, ...report.buckets.flatMap(item => [item.income, item.expense]));
  const reportExpense = report.current.expense || 1;
  let pieCursor = 0;
  const pie = report.categories.length ? `conic-gradient(${report.categories.map(item => { const start = pieCursor; pieCursor += item.amount / reportExpense * 100; return `${item.color} ${start}% ${pieCursor}%`; }).join(",")})` : "#e8e9e1";
  const comparison = (current: number, previous: number) => previous ? Math.round((current - previous) / previous * 100) : current ? 100 : 0;

  return (
    <AiChatProvider>
    <main className="dashboard-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>SỔ CHI TIÊU</span></div>
        <button className="close-nav" onClick={() => setMobileNav(false)} aria-label="Đóng menu">×</button>
        <nav aria-label="Điều hướng chính"><p className="nav-section-title">{language === "vi" ? "KHÔNG GIAN CỦA BẠN" : "YOUR WORKSPACE"}</p>{navItems.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}><span className="nav-glyph">{item.icon}</span>{language === "vi" ? item.label : item.en}{item.id === "transactions" && <span className="count">{transactions.length}</span>}</button>)}</nav>
        <div className="sidebar-total-card"><small>{language === "vi" ? "TỔNG TÀI SẢN" : "TOTAL ASSETS"}</small><strong>{money(totalAssets)}</strong><span className="sidebar-total-sub">{language === "vi" ? "Khả dụng:" : "Available:"} {money(totalBalance)}</span><span>{wallets.length} {language === "vi" ? "ví đang hoạt động" : "active wallets"}</span></div>
        <button type="button" onClick={onSignOut} className="user-profile-card" title="Đăng xuất"><span className="avatar-circle">{profile.full_name.charAt(0).toUpperCase()}</span><span className="user-info"><b>{profile.full_name}</b><small>{user.email}</small></span><em className="logout-icon">↗</em></button>
      </aside>
      {mobileNav && <button className="nav-backdrop" aria-label="Đóng menu" onClick={() => setMobileNav(false)} />}

      <section className="dashboard-main">
        <div className="dashboard-container">
          <header className="topbar">
            <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Mở menu">☰</button>
            <div className="topbar-left-info">
              <p className="top-date">{new Date().toLocaleDateString(locale, { weekday: "long", day: "2-digit", month: "long" }).toUpperCase()}</p>
              <div className="topbar-title-row">
                <h1 className="top-greeting">
                  {view === "overview" && (language === "vi" ? `Chào bạn, ${firstName}.` : `Welcome, ${firstName}.`)}
                  {view === "transactions" && (language === "vi" ? "Giao dịch" : "Transactions")}
                  {view === "wallets" && (language === "vi" ? "Ví & tài khoản" : "Wallets")}
                  {view === "categories" && (language === "vi" ? "Danh mục thu & chi" : "Categories")}
                  {view === "planning" && (language === "vi" ? "Ngân sách & mục tiêu" : "Planning & Goals")}
                  {view === "recurring" && (language === "vi" ? "Giao dịch định kỳ" : "Recurring")}
                  {view === "reports" && (language === "vi" ? "Báo cáo & thống kê" : "Reports")}
                  {view === "ai-assistant" && (language === "vi" ? "Trợ lý tài chính AI" : "AI Assistant")}
                  {view === "settings" && (language === "vi" ? "Hồ sơ & tùy chọn" : "Settings")}
                </h1>

                {view === "transactions" && (
                  <span className="header-stat-pill">
                    <b>{filteredTransactions.length}</b> {language === "vi" ? "giao dịch" : "transactions"}
                  </span>
                )}
                {view === "wallets" && (
                  <span className="header-stat-pill">
                    <b>{money(totalAssets)}</b> {language === "vi" ? "tổng tài sản" : "total assets"}
                  </span>
                )}
                {view === "categories" && (
                  <span className="header-stat-pill">
                    <b>{categories.length}</b> {language === "vi" ? "danh mục" : "categories"}
                  </span>
                )}
                {view === "planning" && (
                  <span className="header-stat-pill">
                    <b>{budgets.length}</b> {language === "vi" ? "ngân sách" : "budgets"}
                  </span>
                )}
                {view === "recurring" && (
                  <span className="header-stat-pill">
                    <b>{recurring.length}</b> {language === "vi" ? "lịch định kỳ" : "recurring"}
                  </span>
                )}
              </div>
            </div>

            <div className="top-actions">
              <label className="topbar-search" aria-label="Tìm kiếm toàn cục">
                <span aria-hidden="true">⌕</span>
                <input
                  value={query}
                  onChange={e => handleGlobalSearch(e.target.value)}
                  placeholder={language === "vi" ? "Tìm giao dịch…" : "Search…"}
                  aria-label="Tìm kiếm giao dịch"
                />
                {query && <button type="button" className="topbar-search-clear" onClick={() => setQuery("")} aria-label="Xóa tìm kiếm">×</button>}
              </label>

              <div className="notification-wrap">
                <button id="notification-bell" className="notification-bell" onClick={() => setShowNotifications(v => !v)} aria-label="Thông báo" aria-expanded={showNotifications}>
                  🔔{budgetAlerts.length > 0 && <span className="notif-badge">{budgetAlerts.length}</span>}
                </button>
                {showNotifications && <>
                  <button className="notif-backdrop" onClick={() => setShowNotifications(false)} aria-label="Đóng" />
                  <div className="notification-panel" role="dialog" aria-labelledby="notif-panel-title">
                    <div className="notif-panel-head"><p>THÔNG BÁO</p><h3 id="notif-panel-title">Cảnh báo tài chính</h3></div>
                    {budgetAlerts.length ? budgetAlerts.map(alert => (
                      <div key={alert.id} className={`notif-item ${alert.kind}`}>
                        <span className="notif-icon">{alert.kind === "over" ? "⚠" : alert.kind === "done" ? "✓" : "●"}</span>
                        <div><b>{alert.title}</b><p>{alert.body}</p></div>
                      </div>
                    )) : <div className="notif-empty"><span>✓</span><p>Không có cảnh báo nào. Tài chính đang ổn định.</p></div>}
                  </div>
                </>}
              </div>

              {(view === "overview" || view === "wallets") && (
                <button className="ghost-action" onClick={() => openModal({ kind: "transfer" })} disabled={wallets.length < 2}>
                  ⇄ {language === "vi" ? "Chuyển tiền" : "Transfer"}
                </button>
              )}
              {(view === "overview" || view === "transactions") && (
                <div className="tx-action-btn-group">
                  <button
                    type="button"
                    className="ghost-action ai-scan-quick-btn"
                    onClick={() => setModal({ kind: "receipt-scan" })}
                    title="Quét hóa đơn bằng AI"
                  >
                    <span>📷</span> {language === "vi" ? "Quét hóa đơn AI" : "Scan receipt"}
                  </button>
                  <button className="add-button" onClick={() => openModal({ kind: "transaction" })}>
                    <b>＋</b> {language === "vi" ? "Thêm giao dịch" : "Add transaction"}
                  </button>
                </div>
              )}
              {view === "wallets" && (
                <button className="add-button" onClick={() => openModal({ kind: "wallet" })}>
                  <b>＋</b> {language === "vi" ? "Tạo ví" : "Add wallet"}
                </button>
              )}
              {view === "categories" && (
                <button className="category-create-button" onClick={() => openModal({ kind: "category" })}>
                  <b>＋</b> {language === "vi" ? "Tạo danh mục" : "Add category"}
                </button>
              )}
              {view === "planning" && (
                <>
                  <button className="ghost-action" onClick={() => openModal({ kind: "goal" })}>
                    ＋ {language === "vi" ? "Mục tiêu" : "Goal"}
                  </button>
                  <button className="add-button" onClick={() => openModal({ kind: "budget" })}>
                    <b>＋</b> {language === "vi" ? "Ngân sách" : "Budget"}
                  </button>
                </>
              )}
              {view === "recurring" && (
                <button className="recurring-create-btn" onClick={() => openModal({ kind: "recurring" })}>
                  <b>＋</b> {language === "vi" ? "Tạo lịch" : "Add recurring"}
                </button>
              )}
              {view === "reports" && (
                <div className="report-period-pill">
                  {(["day", "week", "month", "year"] as const).map(item => (
                    <button
                      key={item}
                      type="button"
                      className={reportPeriod === item ? "active" : ""}
                      onClick={() => setReportPeriod(item)}
                    >
                      {item === "day" ? "Ngày" : item === "week" ? "Tuần" : item === "month" ? "Tháng" : "Năm"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </header>

          {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
          {loading && <div className="loading-banner"><i /> Đang đồng bộ dữ liệu an toàn…</div>}

          {view === "overview" && <>
            <section className="summary-grid">
              <article className="balance-card">
                <div className="card-top-row">
                  <p>TỔNG TÀI SẢN</p>
                  <span className="wallet-badge">{wallets.length} VÍ</span>
                </div>
                <h2>{money(totalAssets)}</h2>
                <div className="card-sub-row">
                  <span className="trend-badge">Khả dụng: {money(totalAvailable)}</span>
                  <small>đã phân bổ: {money(totalReserved)}</small>
                </div>
                <div className="sparkline">
                  <svg viewBox="0 0 300 70">
                    <path d="M0 59 C25 51,35 60,58 48 S97 39,115 44 S144 54,164 31 S198 20,214 30 S249 42,267 15 S292 12,300 6" fill="none" stroke="#D2F544" strokeWidth="3.5" strokeLinecap="round" />
                  </svg>
                </div>
              </article>
              <article className="stat-card">
                <div className="stat-icon-wrapper income">✓</div>
                <p>THU NHẬP THÁNG</p>
                <h3>{money(monthTotals.income)}</h3>
                <small>{monthTransactions.filter(item => item.type === "income").length} khoản thu đã ghi nhận</small>
              </article>
              <article className="stat-card">
                <div className="stat-icon-wrapper expense">↗</div>
                <p>CHI TIÊU THÁNG</p>
                <h3>{money(monthTotals.expense)}</h3>
                <small>{monthTransactions.filter(item => item.type === "expense").length} khoản chi đã ghi nhận</small>
              </article>
              <article className="stat-card">
                <div className={`stat-icon-wrapper ${monthTotals.income >= monthTotals.expense ? "income" : "expense"}`}>
                  {monthTotals.income >= monthTotals.expense ? "✦" : "−"}
                </div>
                <p>TIẾT KIỆM THÁNG</p>
                <h3 style={{ color: monthTotals.income >= monthTotals.expense ? "var(--income-green-text)" : "var(--expense-red-text)" }}>
                  {money(monthTotals.income - monthTotals.expense)}
                </h3>
                <small>
                  {monthTotals.income > 0
                    ? `Tích lũy ${Math.round(((monthTotals.income - monthTotals.expense) / monthTotals.income) * 100)}% thu nhập`
                    : monthTotals.expense > 0 ? "Thâm hụt chi tiêu" : "Chưa có biến động"}
                </small>
              </article>
            </section>
            <section className="overview-grid">
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <p>VÍ CỦA BẠN</p>
                    <h3>Số dư theo tài khoản</h3>
                  </div>
                  <button className="pill-button" onClick={() => setView("wallets")}>Quản lý →</button>
                </div>
                <div className="wallet-mini-list">
                  {wallets.slice(0, 4).map(wallet => {
                    const wBal = walletBalances.get(wallet.id) ?? 0;
                    const wAvail = availableBalances.get(wallet.id) ?? 0;
                    const isNegAvail = wAvail < 0;
                    const isNegBal = wBal < 0;
                    return (
                      <div key={wallet.id} className="wallet-mini-item">
                        <span className="wallet-dot-box" style={{ background: `${wallet.color}25`, color: wallet.color }}>{wallet.icon}</span>
                        <span className="wallet-info">
                          <b>{wallet.name}</b>
                          <small>{wallet.type === "cash" ? "Tiền mặt" : wallet.type === "bank" ? "Ngân hàng" : "Ví điện tử"}</small>
                        </span>
                        <div className="wallet-mini-balances">
                          <strong style={isNegBal ? { color: "#dc2626" } : undefined}>{money(wBal)}</strong>
                          <small style={isNegAvail ? { color: "#dc2626", fontWeight: 700 } : undefined}>
                            {isNegAvail ? `Khả dụng ${money(wAvail)} (Âm tiền)` : `Khả dụng ${money(wAvail)}`}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
              <article className="panel">
                <div className="panel-head">
                  <div>
                    <p>CẢNH BÁO NGÂN SÁCH</p>
                    <h3>Tiến độ tháng này</h3>
                  </div>
                  <button className="pill-button" onClick={() => setView("planning")}>Xem hết →</button>
                </div>
                <div className="budget-stack">
                  {budgets.length ? budgets.slice(0, 3).map(budget => {
                    const totalCapacity = Math.max(budget.amount, budget.allocated_amount + budget.spent_amount);
                    const withdrawnAmount = Math.max(0, totalCapacity - budget.remaining_amount - budget.spent_amount);
                    const totalUsed = budget.spent_amount + withdrawnAmount;
                    const pct = totalCapacity > 0 ? Math.min(100, Math.round((totalUsed / totalCapacity) * 100)) : 0;
                    const isClosed = budget.remaining_amount <= 0 || budget.status === "completed" || budget.status === "cancelled";
                    return (
                      <div key={budget.id} className="budget-item">
                        <div className="budget-item-head">
                          <b>{budget.name}</b>
                          <span className={pct >= 100 ? "danger" : pct >= budget.alert_percent ? "warning" : ""}>{pct}%</span>
                        </div>
                        <div className="meter"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
                        <small>
                          {isClosed
                            ? `Đã rút/chi hết (${money(totalUsed)} / ${money(totalCapacity)})`
                            : `${money(totalUsed)} / ${money(totalCapacity)}`
                          }
                        </small>
                      </div>
                    );
                  }) : <Empty text="Chưa có ngân sách. Hãy đặt hạn mức đầu tiên." />}
                </div>
              </article>
            </section>
            <article className="panel transaction-panel">
              <div className="panel-head">
                <div>
                  <p>GIAO DỊCH GẦN ĐÂY</p>
                  <h3>Dòng tiền mới nhất</h3>
                </div>
                <button className="pill-button" onClick={() => setView("transactions")}>Xem tất cả →</button>
              </div>
              <TransactionTable items={transactions.slice(0, 6)} money={money} language={language} categoryById={categoryById} walletById={walletById} onEdit={item => openModal({ kind: "transaction", item })} onDelete={item => remove("transactions", item.id, item.title, item.receipt_path)} onReceipt={openReceipt} />
            </article>
          </>}

        {view === "transactions" && <>
          <section className="panel filter-panel"><label className="search-field">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên, ghi chú, danh mục hoặc ví…" /></label><div className="filter-grid"><select value={kindFilter} onChange={event => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">Tất cả loại</option><option value="expense">Khoản chi</option><option value="income">Khoản thu</option></select><select value={walletFilter} onChange={event => setWalletFilter(event.target.value)}><option value="all">Tất cả ví</option>{wallets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">Tất cả danh mục</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><div className="date-filter-wrap"><span>Từ</span><input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} aria-label="Từ ngày" /></div><div className="date-filter-wrap"><span>Đến</span><input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} aria-label="Đến ngày" /></div><input type="number" value={minAmount} onChange={event => setMinAmount(event.target.value)} placeholder="Từ số tiền" /><input type="number" value={maxAmount} onChange={event => setMaxAmount(event.target.value)} placeholder="Đến số tiền" /><select value={sort} onChange={event => setSort(event.target.value)}><option value="date-desc">Mới nhất</option><option value="date-asc">Cũ nhất</option><option value="amount-desc">Số tiền giảm dần</option><option value="amount-asc">Số tiền tăng dần</option></select></div></section>
          <article className="panel transaction-panel full-table"><TransactionTable items={filteredTransactions} money={money} language={language} categoryById={categoryById} walletById={walletById} onEdit={item => openModal({ kind: "transaction", item })} onDelete={item => remove("transactions", item.id, item.title, item.receipt_path)} onReceipt={openReceipt} /></article>
        </>}

        {view === "wallets" && <>
          <section className="wallet-grid">
            {wallets.map(wallet => {
              const wBal = walletBalances.get(wallet.id) ?? 0;
              const wAvail = availableBalances.get(wallet.id) ?? 0;
              const wRes = walletReservedMap.get(wallet.id) ?? 0;
              const isNegAvail = wAvail < 0;
              const isNegBal = wBal < 0;
              return (
                <article className="wallet-card" key={wallet.id} style={{ "--wallet-color": wallet.color } as React.CSSProperties}>
                  <div>
                    <span>{wallet.icon}</span>
                    <small>{wallet.type === "cash" ? "TIỀN MẶT" : wallet.type === "bank" ? "NGÂN HÀNG" : "VÍ ĐIỆN TỬ"}</small>
                  </div>
                  <h3>{wallet.name}</h3>
                  <strong style={isNegBal ? { color: "#dc2626" } : undefined}>{money(wBal)}</strong>
                  <p style={isNegAvail ? { color: "#dc2626", fontWeight: 700 } : undefined}>
                    Khả dụng: {money(wAvail)} {isNegAvail ? "⚠ Đã phân bổ vượt số dư" : ""}
                  </p>
                  <p>Đã phân bổ: {money(wRes)}</p>
                  <footer>
                    <button onClick={() => openModal({ kind: "wallet", item: wallet })}>Chỉnh sửa</button>
                    <button onClick={() => remove("wallets", wallet.id, wallet.name)}>Xóa</button>
                  </footer>
                </article>
              );
            })}
          </section>
          <article className="panel"><div className="panel-head"><div><p>LỊCH SỬ CHUYỂN TIỀN</p><h3>Điều chuyển giữa các ví</h3></div></div><div className="compact-list">{transfers.map(item => <div key={item.id}><span className="round-icon">⇄</span><span><b>{walletById.get(item.from_wallet_id)?.name} → {walletById.get(item.to_wallet_id)?.name}</b><small>{formatDate(item.occurred_at, language)} · {item.note || "Không có ghi chú"}</small></span><strong>{money(item.amount)}</strong><button onClick={() => remove("transfers", item.id, "lệnh chuyển tiền")}>×</button></div>)}{!transfers.length && <Empty text="Chưa có giao dịch chuyển tiền." />}</div></article>
        </>}

        {view === "categories" && (
          <section className="category-main-card">

            {(["expense", "income"] as TransactionType[]).map(kind => {
              const items = categories.filter(item => item.kind === kind);
              return (
                <article className="category-section-card" key={kind}>
                  <div className="category-section-head">
                    <div>
                      <p>{kind === "expense" ? "KHOẢN CHI" : "KHOẢN THU"}</p>
                      <h3>{kind === "expense" ? "Danh mục chi tiêu" : "Nguồn thu nhập"}</h3>
                    </div>
                    <span className="category-section-count">{items.length}</span>
                  </div>

                  <div className="category-row-list">
                    {items.map(item => (
                      <div className="category-item-row" key={item.id}>
                        <div className="category-item-left">
                          <span className="category-item-dot" style={{ backgroundColor: item.color || "#84cc16" }} />
                          <span className="category-item-name">{item.name}</span>
                        </div>

                        <div className="category-item-right">
                          <button
                            type="button"
                            className="category-action-btn"
                            onClick={() => openModal({ kind: "category", item })}
                            title="Chỉnh sửa danh mục"
                          >
                            <span>✎</span> Sửa
                          </button>
                          <button
                            type="button"
                            className="category-action-btn delete"
                            onClick={() => remove("categories", item.id, item.name)}
                            title="Xóa danh mục"
                          >
                            <span>🗑</span> Xóa
                          </button>
                          <span className="drag-handle-icon" title="Kéo để di chuyển">⇗</span>
                        </div>
                      </div>
                    ))}
                    {!items.length && <Empty text={kind === "expense" ? "Chưa có danh mục chi tiêu." : "Chưa có danh mục thu nhập."} />}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {view === "planning" && <>
          <section className="planning-grid">
            <article className="panel">
              <div className="panel-head"><div><p>HẠN MỨC CHI TIÊU</p><h3>Ngân sách đang theo dõi</h3></div></div>
              <div className="plan-list">
                {budgets.map(budget => {
                  const totalCapacity = Math.max(budget.amount, budget.allocated_amount + budget.spent_amount);
                  const withdrawnAmount = Math.max(0, totalCapacity - budget.remaining_amount - budget.spent_amount);
                  const totalUsed = budget.spent_amount + withdrawnAmount;
                  const pct = totalCapacity > 0 ? Math.min(100, Math.round((totalUsed / totalCapacity) * 100)) : 0;
                  const sourceWallet = walletById.get(budget.source_wallet_id ?? "");
                  const isClosed = budget.remaining_amount <= 0 || budget.status === "completed" || budget.status === "cancelled";
                  const isOver = isClosed;
                  const isNear = !isOver && pct >= budget.alert_percent;
                  return (
                    <div className={`plan-card ${isOver ? "over" : isNear ? "near" : ""}`} key={budget.id}>
                      <header>
                        <span>
                          <b>{budget.name}</b>
                          <small>{budget.category_id ? categoryById.get(budget.category_id)?.name : "Tổng chi tiêu"} · {budget.period === "weekly" ? "Tuần" : budget.period === "yearly" ? "Năm" : "Tháng"}</small>
                        </span>
                        <strong>{pct}%</strong>
                      </header>
                      <div className="meter"><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      <div className="budget-detail-rows">
                        <div className="budget-detail-row"><span>Tổng phân bổ</span><b>{money(totalCapacity)}</b></div>
                        <div className="budget-detail-row"><span>Đã chi</span><b className="expense">{money(budget.spent_amount)}</b></div>
                        {withdrawnAmount > 0 && <div className="budget-detail-row"><span>Đã rút về ví</span><b>{money(withdrawnAmount)}</b></div>}
                        <div className="budget-detail-row highlight"><span>Còn lại</span><b className={isOver ? "expense" : "income"}>{money(budget.remaining_amount)}</b></div>
                        {sourceWallet && <div className="budget-detail-row"><span>Nguồn tiền</span><b>{sourceWallet.name}</b></div>}
                      </div>
                      {isClosed && <em>🔴 Đã hết tiền/rút hết ({pct}%) — Ngân sách đã kết thúc, không thể chi thêm.</em>}
                      {isNear && !isClosed && <em>Sắp chạm hạn mức {budget.alert_percent}%</em>}
                      <footer>
                        <button type="button" onClick={() => openModal({ kind: "budget-topup", budget })} title="Nạp thêm tiền vào ngân sách">⊕ Nạp thêm</button>
                        <button type="button" onClick={() => openModal({ kind: "budget-return", budget })} title="Rút tiền về ví" disabled={budget.remaining_amount <= 0}>⊖ Rút tiền</button>
                        <button type="button" onClick={() => openModal({ kind: "budget", item: budget })}>✎ Sửa</button>
                        <button type="button" onClick={() => deleteBudget(budget)}>🗑 Xóa</button>
                      </footer>
                    </div>
                  );
                })}
                {!budgets.length && <Empty text="Tạo ngân sách để phân bổ tiền và kiểm soát chi tiêu." />}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head"><div><p>TÍCH LŨY TƯƠNG LAI</p><h3>Mục tiêu tiết kiệm</h3></div></div>
              <div className="plan-list">
                {goals.map(goal => {
                  const percent = goal.target_amount > 0 ? Math.round(goal.current_amount / goal.target_amount * 100) : 0;
                  const sourceWallet = walletById.get(goal.source_wallet_id ?? "");
                  return (
                    <div className="goal-plan" key={goal.id}>
                      <header>
                        <span style={{ background: `${goal.color}25`, color: goal.color }}>◎</span>
                        <div>
                          <b>{goal.title}</b>
                          <small>{goal.deadline ? `Hạn ${new Date(`${goal.deadline}T00:00:00`).toLocaleDateString(locale)}` : "Không có thời hạn"}</small>
                        </div>
                        <strong>{Math.min(100, percent)}%</strong>
                      </header>
                      <div className="meter"><i style={{ width: `${Math.min(100, percent)}%`, background: goal.color }} /></div>
                      <div className="budget-detail-rows">
                        <div className="budget-detail-row"><span>Đã dành</span><b className="income">{money(goal.current_amount)}</b></div>
                        <div className="budget-detail-row"><span>Mục tiêu</span><b>{money(goal.target_amount)}</b></div>
                        <div className="budget-detail-row highlight"><span>Còn thiếu</span><b>{money(Math.max(0, goal.target_amount - goal.current_amount))}</b></div>
                        {sourceWallet && <div className="budget-detail-row"><span>Ví đang giữ</span><b>{sourceWallet.name}</b></div>}
                      </div>
                      <footer>
                        <button type="button" onClick={() => openModal({ kind: "goal-topup", goal })} title="Nạp thêm vào mục tiêu">⊕ Gửi tiền</button>
                        <button type="button" onClick={() => openModal({ kind: "goal-return", goal })} title="Rút tiền về ví" disabled={goal.current_amount <= 0}>⊖ Rút tiền</button>
                        <button type="button" onClick={() => openModal({ kind: "goal", item: goal })}>✎ Sửa</button>
                        <button type="button" onClick={() => { if (window.confirm(`Xóa mục tiêu "${goal.title}"?`)) { if (goal.current_amount > 0 && goal.source_wallet_id) { returnGoalToWallet(goal, goal.current_amount).then(() => remove("savings_goals", goal.id, goal.title)).catch(e => showNotice(e.message)); } else { remove("savings_goals", goal.id, goal.title); } } }}>🗑 Xóa</button>
                      </footer>
                    </div>
                  );
                })}
                {!goals.length && <Empty text="Chưa có mục tiêu tiết kiệm nào." />}
              </div>
            </article>
          </section>
        </>}

        {view === "recurring" && (
          <section className="recurring-main-card">

            <div className="automation-banner">
              <div className="automation-banner-glow" aria-hidden="true" />
              <div className="automation-banner-icon-wrap">
                <span className="automation-banner-sparkle">✨</span>
                <div className="automation-banner-icon">
                  <span>🪄</span>
                </div>
              </div>
              <div className="automation-banner-body">
                <div className="automation-banner-header">
                  <h3 className="automation-banner-title">
                    Tự động hóa dòng tiền định kỳ
                    <span className="automation-live-badge">
                      <span className="automation-live-dot" />
                      Đang hoạt động
                    </span>
                  </h3>
                </div>
                <p className="automation-banner-desc">
                  Hệ thống sẽ <b>tự động ghi nhận giao dịch</b> khi đến hạn mỗi lần bạn mở ứng dụng, đồng thời <b>kiểm tra an toàn số dư ví</b> trước khi thực hiện.
                </p>
                <div className="automation-banner-features">
                  <span className="automation-feature-pill">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7"/></svg>
                    Tự động ghi nhận
                  </span>
                  <span className="automation-feature-pill">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    Nhắc nhở đến hạn
                  </span>
                  <span className="automation-feature-pill">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    Bảo vệ chống số dư âm
                  </span>
                </div>
              </div>
            </div>

            {recurring.length > 0 ? (
              <section className="recurring-grid">
                {recurring.map(item => {
                  const due = item.active && new Date(item.next_run_at) <= new Date();
                  const category = categoryById.get(item.category_id ?? "");
                  const wallet = walletById.get(item.wallet_id ?? "");
                  const walletAvail = availableBalances.get(item.wallet_id ?? "") ?? 0;
                  const isInsufficient = item.type === "expense" && item.amount > walletAvail;
                  return (
                    <article className={`recurring-card ${due ? "due" : ""} ${isInsufficient ? "insufficient" : ""}`} key={item.id}>
                      <div>
                        <div className="recurring-card-header">
                          <span className={`recurring-card-type-icon ${item.type}`}>
                            {item.type === "income" ? "↙" : "↗"}
                          </span>
                          <div className="recurring-card-info">
                            <b>{item.title}</b>
                            <small>{category?.name ?? "Chưa chọn danh mục"} · {wallet?.name ?? "Chưa chọn ví"}</small>
                          </div>
                          <span className={`recurring-status-badge ${item.active ? "on" : "off"}`}>
                            {item.active ? "Đang bật" : "Đã tắt"}
                          </span>
                        </div>

                        <div className="recurring-card-amount">
                          {item.type === "expense" ? "−" : "+"}{money(item.amount)}
                        </div>

                        <div className="recurring-card-next">
                          Kỳ tiếp theo: <b>{formatDate(item.next_run_at, language)}</b>
                        </div>

                        <div className="recurring-card-tags">
                          <span className="recurring-tag">
                            {item.frequency === "daily" ? "Hàng ngày" : item.frequency === "weekly" ? "Hàng tuần" : item.frequency === "monthly" ? "Hàng tháng" : "Hàng năm"}
                          </span>
                          <span className="recurring-tag">
                            {item.auto_create ? "Tự động ghi nhận" : "Chỉ nhắc nhở"}
                          </span>
                        </div>

                        {isInsufficient && (
                          <div className="insufficient-warning" title={`Khả dụng: ${money(walletAvail)}`}>
                            <span>⚠️</span>
                            <span>Số dư ví không đủ (Khả dụng: {money(walletAvail)})</span>
                          </div>
                        )}
                      </div>

                      <footer className="recurring-card-footer">
                        {due && !item.auto_create && (
                          <button
                            type="button"
                            className={`recurring-due-btn ${isInsufficient ? "danger" : ""}`}
                            onClick={() => createDueTransaction(item)}
                          >
                            {isInsufficient ? "⚠️ Thiếu số dư — Bổ sung ví" : "Ghi nhận ngay"}
                          </button>
                        )}
                        <div className="recurring-actions">
                          <button type="button" onClick={() => openModal({ kind: "recurring", item })}>
                            ✎ Sửa
                          </button>
                          <button type="button" onClick={() => remove("recurring_transactions", item.id, item.title)}>
                            🗑 Xóa
                          </button>
                        </div>
                      </footer>
                    </article>
                  );
                })}
              </section>
            ) : (
              <div className="recurring-empty-box">
                <div className="recurring-empty-illustration">
                  <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="25" y="30" width="70" height="65" rx="14" fill="#F4F8F6" stroke="#D0DCD6" strokeWidth="2.5" />
                    <path d="M25 45 H95" stroke="#D0DCD6" strokeWidth="2.5" />
                    <circle cx="45" cy="24" r="5" fill="#161E1F" />
                    <circle cx="75" cy="24" r="5" fill="#161E1F" />
                    <rect x="37" y="55" width="10" height="10" rx="3" fill="#D2F544" />
                    <rect x="55" y="55" width="10" height="10" rx="3" fill="#E2EAE6" />
                    <rect x="73" y="55" width="10" height="10" rx="3" fill="#E2EAE6" />
                    <rect x="37" y="72" width="10" height="10" rx="3" fill="#E2EAE6" />
                    <rect x="55" y="72" width="10" height="10" rx="3" fill="#E2EAE6" />
                    <circle cx="78" cy="77" r="18" fill="#FFFFFF" stroke="#161E1F" strokeWidth="2.5" />
                    <path d="M78 68 V77 L83 80" stroke="#161E1F" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="empty-plus-circle">＋</div>
                <p className="recurring-empty-text">Tạo lịch cho tiền thuê nhà, lương, hóa đơn hoặc khoản đăng ký định kỳ.</p>
                <button type="button" className="recurring-create-btn" onClick={() => openModal({ kind: "recurring" })}>
                  <b>＋</b> Tạo lịch
                </button>
              </div>
            )}
          </section>
        )}

        {view === "reports" && (
          <>

            {/* Top 3 Stat Cards */}
            <section className="report-stat-grid">
              <article className="report-stat-card">
                <div>
                  <div className="report-stat-card-top">
                    <span className="report-stat-icon-box income">📊</span>
                    <p>THU NHẬP</p>
                  </div>
                  <h3 className="report-stat-amount">{money(report.current.income)}</h3>
                </div>
                <div className={`report-stat-trend ${comparison(report.current.income, report.previous.income) >= 0 ? "positive" : "negative"}`}>
                  <span>{comparison(report.current.income, report.previous.income) >= 0 ? "+" : ""}{comparison(report.current.income, report.previous.income)}%</span>
                  <span>↑</span>
                </div>
              </article>

              <article className="report-stat-card">
                <div>
                  <div className="report-stat-card-top">
                    <span className="report-stat-icon-box expense">💸</span>
                    <p>CHI TIÊU</p>
                  </div>
                  <h3 className="report-stat-amount">{money(report.current.expense)}</h3>
                </div>
                <div className={`report-stat-trend ${comparison(report.current.expense, report.previous.expense) <= 0 ? "positive" : "negative"}`}>
                  <span>{comparison(report.current.expense, report.previous.expense) >= 0 ? "+" : ""}{comparison(report.current.expense, report.previous.expense)}%</span>
                  <span>↑</span>
                </div>
              </article>

              <article className="report-stat-card">
                <div>
                  <div className="report-stat-card-top">
                    <span className="report-stat-icon-box saving">🪙</span>
                    <p>TIẾT KIỆM RÒNG</p>
                  </div>
                  <h3 className="report-stat-amount">{money(report.current.income - report.current.expense)}</h3>
                </div>
                <div className="report-stat-trend positive">
                  <span>+{report.current.income ? Math.round((report.current.income - report.current.expense) / report.current.income * 100) : 0}%</span>
                  <span>↑</span>
                </div>
              </article>
            </section>

            {/* Bottom 2 Charts Grid */}
            <section className="report-charts-grid">
              {/* Bar Chart */}
              <article className="report-chart-card">
                <div className="panel-head">
                  <div>
                    <p>BIỂU ĐỒ CỘT</p>
                    <h3>Thu và chi theo thời gian</h3>
                  </div>
                  <div className="report-chart-legend">
                    <span><i className="legend-dot income" /> Thu nhập</span>
                    <span><i className="legend-dot expense" /> Chi tiêu</span>
                  </div>
                </div>

                <div className="bar-chart-container">
                  {report.buckets.map(bucket => (
                    <div className="bar-column-group" key={bucket.index}>
                      <div className="bar-bars-wrapper">
                        {bucket.income > 0 && (
                          <div
                            className="single-bar income"
                            style={{ height: `${Math.max(4, Math.min(100, bucket.income / maxReportBar * 100))}%` }}
                            title={`Thu nhập: ${money(bucket.income)}`}
                          >
                            <span className="bar-val-label">{bucket.income > 1000 ? `${Math.round(bucket.income / 1000)}k` : bucket.income}</span>
                          </div>
                        )}
                        {bucket.expense > 0 && (
                          <div
                            className="single-bar expense"
                            style={{ height: `${Math.max(4, Math.min(100, bucket.expense / maxReportBar * 100))}%` }}
                            title={`Chi tiêu: ${money(bucket.expense)}`}
                          >
                            <span className="bar-val-label">{bucket.expense > 1000 ? `${Math.round(bucket.expense / 1000)}k` : bucket.expense}</span>
                          </div>
                        )}
                      </div>
                      <span className="bar-x-label">{bucket.label}</span>
                    </div>
                  ))}
                </div>
              </article>

              {/* Donut Chart */}
              <article className="report-chart-card">
                <div className="panel-head">
                  <div>
                    <p>BIỂU ĐỒ TRÒN</p>
                    <h3>Chi tiêu theo danh mục</h3>
                  </div>
                </div>

                <div className="donut-wrap-box">
                  <div className="donut-circle-ring" style={{ background: pie }}>
                    <div className="donut-center-label">
                      <small>TỔNG CHI</small>
                      <b>{money(report.current.expense)}</b>
                    </div>
                  </div>

                  <div className="donut-legend-list">
                    {report.categories.slice(0, 6).map(item => (
                      <div className="donut-legend-item" key={item.id}>
                        <div className="donut-legend-left">
                          <i style={{ background: item.color }} />
                          <span>{item.name}</span>
                        </div>
                        <div className="donut-legend-right">
                          <b>{Math.round(item.amount / reportExpense * 100)}%</b>
                          <small>({money(item.amount)})</small>
                        </div>
                      </div>
                    ))}
                    {!report.categories.length && <Empty text="Chưa có khoản chi trong kỳ này." />}
                  </div>
                </div>
              </article>
            </section>
          </>
        )}

        {view === "ai-assistant" && (
          <AiChatView
            financialContext={{
              totalBalance,
              monthlyIncome: monthTotals.income,
              monthlyExpense: monthTotals.expense,
              wallets,
              transactions,
              budgets,
              savingsGoals: goals,
            }}
          />
        )}

        {view === "settings" && (
          <div className="settings-container">

            {/* Card 1: Thông tin cơ bản */}
            <form className="settings-card" onSubmit={saveProfile}>
              <div className="settings-card-head">
                <p>THÔNG TIN CƠ BẢN</p>
                <h3>Hồ sơ của bạn</h3>
              </div>

              <div className="form-grid">
                <label>
                  <span>Tên tài khoản</span>
                  <input
                    name="username"
                    defaultValue={profile.username ?? ""}
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]+"
                    autoCapitalize="none"
                    required
                    placeholder="Username"
                  />
                </label>
                <label>
                  <span>
                    Số điện thoại <small style={{ fontWeight: 400, color: "#8B989B", fontSize: "12px", marginLeft: 4 }}>(optional)</small>
                  </span>
                  <div className="phone-input-group">
                    <span className="phone-prefix">+84</span>
                    <input name="phone" placeholder="Nhập số điện thoại…" />
                  </div>
                </label>
              </div>

              <label>
                Họ và tên
                <input name="fullName" defaultValue={profile.full_name} required placeholder="Họ và tên hiển thị" />
              </label>

              <label>
                Email
                <input value={user.email} disabled style={{ background: "#F4F7F5", color: "#788689", cursor: "not-allowed" }} />
              </label>

              <div className="form-grid" style={{ marginTop: 24 }}>
                <label>
                  Đơn vị tiền tệ
                  <select name="currency" defaultValue={profile.currency}>
                    <option>VND</option>
                    <option>USD</option>
                    <option>SGD</option>
                    <option>EUR</option>
                    <option>JPY</option>
                    <option>THB</option>
                  </select>
                </label>
                <label>
                  Ngôn ngữ
                  <select name="language" defaultValue={profile.language}>
                    <option value="vi">Tiếng Việt</option>
                    <option value="en">English</option>
                  </select>
                </label>
              </div>

              <button className="save-button" disabled={saving}>
                {saving ? "Đang lưu…" : "Lưu hồ sơ & tùy chọn"}
              </button>
            </form>

            {/* Card 2: Giao diện & Bảng màu chủ đạo */}
            <article className="settings-card theme-settings-card">
              <div className="settings-card-head">
                <p>CÁ NHÂN HÓA GIAO DIỆN</p>
                <h3>Màu sắc chủ đạo (Accent Theme)</h3>
              </div>

              <p className="theme-card-intro">
                Chọn gam màu nhận diện cho toàn bộ hệ thống (nút bấm, thanh điều hướng, huy hiệu phân loại và điểm nhấn nổi bật).
              </p>

              <div className="theme-presets-grid">
                {APP_THEME_PRESETS.map((preset) => {
                  const isSelected = appAccentColor.toLowerCase() === preset.hex.toLowerCase();
                  return (
                    <button
                      key={preset.hex}
                      type="button"
                      className={`theme-preset-card ${isSelected ? "active" : ""}`}
                      onClick={() => handleSelectAppAccent(preset.hex)}
                    >
                      <div className="theme-preset-color-badge" style={{ backgroundColor: preset.hex }}>
                        {isSelected && <span className="theme-check-icon" style={{ color: getContrastColor(preset.hex) }}>✓</span>}
                      </div>
                      <div className="theme-preset-info">
                        <strong>{preset.name}</strong>
                        <small>{preset.desc}</small>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="theme-custom-row">
                <div className="theme-custom-left">
                  <label className="theme-custom-picker-label">
                    <span>Màu tùy chọn tự do:</span>
                    <div className="theme-custom-picker-btn">
                      <span className="theme-custom-preview-dot" style={{ backgroundColor: appAccentColor }} />
                      <span className="theme-custom-hex-code">{appAccentColor.toUpperCase()}</span>
                      <input
                        type="color"
                        value={appAccentColor}
                        onChange={(e) => handleSelectAppAccent(e.target.value)}
                        className="modern-native-color-hidden"
                      />
                    </div>
                  </label>
                </div>
                <button
                  type="button"
                  className="theme-reset-btn"
                  onClick={() => handleSelectAppAccent("#D2F544")}
                  title="Đặt lại màu mặc định Neon Lime"
                >
                  ↺ Mặc định (#D2F544)
                </button>
              </div>

              <div className="theme-live-preview-box">
                <span className="preview-heading">XEM TRƯỚC HIỆU ỨNG GIAO DIỆN</span>
                <div className="preview-elements-row">
                  <span className="preview-pill preview-pill--active">Tab đang chọn</span>
                  <button type="button" className="preview-action-btn">Nút thao tác chính →</button>
                  <span className="preview-badge-accent">+15.8% Tăng trưởng</span>
                </div>
              </div>
            </article>

            {/* Card 3: Quyền riêng tư */}
            <article className="settings-card">
              <div className="settings-card-head">
                <p>QUYỀN RIÊNG TƯ</p>
                <h3>Dữ liệu cá nhân</h3>
              </div>

              <div className="privacy-rows-list">
                <div className="privacy-row-item">
                  <div className="privacy-row-left">
                    <span className="privacy-check-icon">✓</span>
                    <div className="privacy-row-content">
                      <b>Dữ liệu riêng theo tài khoản</b>
                      <p>Thông tin được bảo vệ bằng phân quyền ở cơ sở dữ liệu.</p>
                    </div>
                  </div>
                  <span className="privacy-row-more">Tìm hiểu thêm ∨</span>
                </div>

                <div className="privacy-row-item">
                  <div className="privacy-row-left">
                    <span className="privacy-check-icon">✓</span>
                    <div className="privacy-row-content">
                      <b>Hóa đơn riêng tư</b>
                      <p>Tệp đính kèm chỉ được mở bằng liên kết tạm thời của chính bạn.</p>
                    </div>
                  </div>
                  <span className="privacy-row-more">Tìm hiểu thêm ∨</span>
                </div>

                <div className="privacy-row-item">
                  <div className="privacy-row-left">
                    <span className="privacy-check-icon">✓</span>
                    <div className="privacy-row-content">
                      <b>Xóa dữ liệu tài chính</b>
                      <p>Xóa vĩnh viễn ví, giao dịch, hóa đơn, ngân sách, mục tiêu và tùy chọn. Tài khoản đăng nhập vẫn được giữ.</p>
                    </div>
                  </div>
                  <span className="privacy-row-more">Tìm hiểu thêm ∨</span>
                </div>
              </div>

              <div className="settings-action-row">
                <button type="button" className="download-data-btn" onClick={downloadData} disabled={isExporting}>
                  <span>⤓</span> {isExporting ? "Đang chuẩn bị dữ liệu…" : "Tải xuống dữ liệu của bạn"}
                </button>
                <button type="button" className="danger-data-btn" onClick={deletePersonalData} disabled={saving}>
                  <span>⚠</span> Xóa dữ liệu tài khoản
                </button>
              </div>
            </article>
          </div>
        )}
        </div>
      </section>

      {modal?.kind === "transaction" && (
        <Modal title={modal.item ? "Chỉnh sửa giao dịch" : "Thêm giao dịch mới"} eyebrow="GHI NHẬN DÒNG TIỀN" onClose={() => setModal(null)}>
          <form onSubmit={saveTransaction}>
            {!modal.item && (
              <div className="transaction-mode-switch">
                <button type="button" className="mode-btn active">
                  Nhập thủ công
                </button>
                <button
                  type="button"
                  className="mode-btn ai-scan-tab"
                  onClick={() => setModal({ kind: "receipt-scan" })}
                >
                  Quét hóa đơn bằng AI
                  <span className="mode-ai-tag">MỚI</span>
                </button>
              </div>
            )}
            {!modal.item && (
              <div className="smart-entry ai-quick-entry">
                <div className="ai-entry-header">
                  <label className="ai-entry-label">NHẬP NHANH BẰNG AI</label>
                  <span className="ai-live-tag">GEMINI AI</span>
                </div>
                <p className="ai-entry-desc">
                  Nhập giao dịch bằng ngôn ngữ tự nhiên. AI sẽ nhận diện số tiền, khoản thu/chi, danh mục, ví và thời gian.
                </p>
                <div className="ai-entry-input-group">
                  <input
                    value={smartInput}
                    onChange={(event) => setSmartInput(event.target.value)}
                    placeholder="Ví dụ: Ăn trưa 50k tiền mặt hôm nay"
                    disabled={aiParsing}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAITextParse();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="ai-recognize-btn"
                    disabled={aiParsing || !smartInput.trim()}
                    onClick={() => handleAITextParse()}
                  >
                    {aiParsing ? (
                      <>
                        <span className="ai-btn-spinner" />
                        Đang nhận diện...
                      </>
                    ) : (
                      "Nhận diện"
                    )}
                  </button>
                </div>

                {/* Example chips */}
                <div className="ai-example-chips">
                  <span className="chips-label">Gợi ý:</span>
                  <button
                    type="button"
                    className="ai-chip"
                    onClick={() => {
                      setSmartInput("Ăn trưa 50k tiền mặt hôm nay");
                      setAiFeedback(null);
                    }}
                  >
                    Ăn trưa 50k tiền mặt
                  </button>
                  <button
                    type="button"
                    className="ai-chip"
                    onClick={() => {
                      setSmartInput("Đổ xăng 100k Momo");
                      setAiFeedback(null);
                    }}
                  >
                    Đổ xăng 100k Momo
                  </button>
                  <button
                    type="button"
                    className="ai-chip"
                    onClick={() => {
                      setSmartInput("Lương tháng này 12 triệu Techcombank");
                      setAiFeedback(null);
                    }}
                  >
                    Lương 12 triệu Techcombank
                  </button>
                  <button
                    type="button"
                    className="ai-chip"
                    onClick={() => {
                      setSmartInput("Mua áo 350k");
                      setAiFeedback(null);
                    }}
                  >
                    Mua áo 350k
                  </button>
                </div>

                {/* Feedback alert */}
                {aiFeedback && (
                  <div className={`ai-parse-feedback ${aiFeedback.type}`}>
                    {aiFeedback.message}
                  </div>
                )}
              </div>
            )}
        <div className="type-toggle"><button type="button" className={transactionDraft.type === "expense" ? "active" : ""} onClick={() => setTransactionDraft(current => ({ ...current, type: "expense", categoryId: categories.find(item => item.kind === "expense")?.id ?? "", paymentSourceType: "wallet", budgetId: "" }))}>Khoản chi</button><button type="button" className={transactionDraft.type === "income" ? "active" : ""} onClick={() => setTransactionDraft(current => ({ ...current, type: "income", categoryId: categories.find(item => item.kind === "income")?.id ?? "", paymentSourceType: "wallet", budgetId: "" }))}>Khoản thu</button></div>
        <label>Tên giao dịch<input required autoFocus value={transactionDraft.title} onChange={event => setTransactionDraft(current => ({ ...current, title: event.target.value }))} placeholder="Ví dụ: Ăn trưa" /></label>
        <label>Số tiền<FormattedMoneyInput required autoFocus={focusAmountInput} value={transactionDraft.amount} onChangeValue={val => setTransactionDraft(current => ({ ...current, amount: val }))} /></label>
        <label>Danh mục<select required value={transactionDraft.categoryId} onChange={event => setTransactionDraft(current => ({ ...current, categoryId: event.target.value, budgetId: "", paymentSourceType: "wallet" }))}>{categories.filter(item => item.kind === transactionDraft.type).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {transactionDraft.type === "expense" && (() => {
          const matchingBudgets = budgets.filter(b => b.status === "active" && b.remaining_amount > 0 && (!b.category_id || b.category_id === transactionDraft.categoryId));
          return (
            <div className={`payment-source-group ${highlightWalletSelect ? "highlight-pulse" : ""}`}>
              <label className="payment-source-label">⎨ Nguồn thanh toán</label>
              <div className="payment-source-options">
                {matchingBudgets.length > 0 && (
                  <div className="payment-source-section">
                    <div className="ps-section-title">NGÂN SÁCH</div>
                    {matchingBudgets.map(b => {
                      const avail = b.remaining_amount;
                      const currentExpenseVal = Number(transactionDraft.amount) || 0;
                      const isInsufficient = currentExpenseVal > 0 && currentExpenseVal > avail;
                      const isSelected = transactionDraft.paymentSourceType === "budget" && transactionDraft.budgetId === b.id;

                      return (
                        <label key={b.id} className={`payment-source-option ${isSelected ? "selected" : ""} ${isInsufficient ? "insufficient" : ""}`}>
                          <input type="radio" name="paymentSource" value={b.id} checked={isSelected}
                            onChange={() => {
                              setHighlightWalletSelect(false);
                              setTransactionDraft(c => ({ ...c, paymentSourceType: "budget", budgetId: b.id, walletId: "" }));
                            }} />
                          <div className="ps-left">
                            <div className="ps-radio-indicator">
                              <span className="ps-radio-dot" />
                            </div>
                            <div className="ps-info">
                              <span className="ps-badge budget">◉ {b.name}</span>
                              {isInsufficient && <span className="insufficient-badge">Không đủ số dư</span>}
                            </div>
                          </div>
                          <div className="ps-right">
                            <span className={`ps-balance ${isInsufficient ? "insufficient-text" : ""}`}>{money(avail)} còn lại</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
                
                <div className="payment-source-section">
                  <div className="ps-section-title">VÍ / TÀI KHOẢN</div>
                  {wallets.map(w => {
                    let avail = availableBalances.get(w.id) ?? 0;
                    if (modal.item?.type === "expense" && modal.item?.wallet_id === w.id) {
                      avail += modal.item.amount;
                    }
                    const currentExpenseVal = Number(transactionDraft.amount) || 0;
                    const isInsufficient = currentExpenseVal > 0 && currentExpenseVal > avail;
                    const isSelected = transactionDraft.paymentSourceType === "wallet" && transactionDraft.walletId === w.id;

                    return (
                      <label key={w.id} className={`payment-source-option ${isSelected ? "selected" : ""} ${isInsufficient ? "insufficient" : ""}`}>
                        <input type="radio" name="paymentSource" value={w.id} checked={isSelected}
                          onChange={() => {
                            setHighlightWalletSelect(false);
                            setTransactionDraft(c => ({ ...c, paymentSourceType: "wallet", walletId: w.id, budgetId: "" }));
                          }} />
                        <div className="ps-left">
                          <div className="ps-radio-indicator">
                            <span className="ps-radio-dot" />
                          </div>
                          <div className="ps-info">
                            <span className="ps-badge wallet">{w.icon} {w.name}</span>
                            {isInsufficient && <span className="insufficient-badge">Không đủ số dư</span>}
                          </div>
                        </div>
                        <div className="ps-right">
                          <span className={`ps-balance ${isInsufficient ? "insufficient-text" : ""}`}>{money(avail)} khả dụng</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}
        {transactionDraft.type === "income" && <label>Ví nhận tiền<select required value={transactionDraft.walletId} onChange={event => setTransactionDraft(current => ({ ...current, walletId: event.target.value }))}>{wallets.map(item => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}</select></label>}
        <label>Ngày &amp; giờ<input required type="datetime-local" value={transactionDraft.occurredAt} onChange={event => setTransactionDraft(current => ({ ...current, occurredAt: event.target.value }))} /></label>
        <label>Ghi chú<textarea value={transactionDraft.note} onChange={event => setTransactionDraft(current => ({ ...current, note: event.target.value }))} placeholder="Mô tả ngắn…" /></label>
        <label>Hóa đơn <span>(JPG, PNG, WebP hoặc PDF · tối đa 8 MB)</span><input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>
        {modal.item?.receipt_path && <p className="existing-file">✓ Giao dịch đang có hóa đơn. Chọn tệp mới để thay thế.</p>}
        <button className="save-button" disabled={saving}>{saving ? "Đang lưu…" : "Lưu giao dịch →"}</button>
      </form></Modal>)}

      {modal?.kind === "wallet" && (
        <Modal title={modal.item ? "Chỉnh sửa ví" : "Tạo ví mới"} eyebrow="VÍ & TÀI KHOẢN" onClose={() => setModal(null)}>
          <WalletModalForm modalItem={modal.item} saving={saving} onSubmit={event => saveSimple(event, "wallet")} />
        </Modal>
      )}

      {modal?.kind === "transfer" && <Modal title="Chuyển tiền giữa các ví" eyebrow="ĐIỀU CHUYỂN NỘI BỘ" onClose={() => setModal(null)}><form onSubmit={saveTransfer}><div className="form-grid"><label>Từ ví<select name="fromWalletId">{wallets.map(item => <option key={item.id} value={item.id}>{item.name} · {money(walletBalances.get(item.id) ?? 0)}</option>)}</select></label><label>Đến ví<select name="toWalletId" defaultValue={wallets[1]?.id}>{wallets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>Số tiền<FormattedMoneyInput name="amount" required /></label><label>Ngày & giờ<input name="occurredAt" type="datetime-local" defaultValue={localDateTime()} required /></label><label>Ghi chú<textarea name="note" /></label><button className="save-button" disabled={saving}>Xác nhận chuyển tiền →</button></form></Modal>}

      {modal?.kind === "category" && (
        <Modal title={modal.item ? "Chỉnh sửa danh mục" : "Tạo danh mục"} eyebrow="PHÂN LOẠI DÒNG TIỀN" onClose={() => setModal(null)}>
          <form onSubmit={event => saveSimple(event, "category")}>
            <label>Tên danh mục<input name="name" defaultValue={modal.item?.name} required placeholder="Ví dụ: Ăn uống, Tiền điện…" /></label>
            <div className="form-grid">
              <label>Loại<select name="type" defaultValue={modal.item?.kind ?? "expense"}><option value="expense">Khoản chi</option><option value="income">Khoản thu</option></select></label>
              <label>Danh mục cha<select name="parentId" defaultValue={modal.item?.parent_id ?? ""}><option value="">Không có</option>{categories.filter(item => item.id !== modal.item?.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            <input name="icon" type="hidden" value="" />
            <ModernColorPicker name="color" defaultValue={modal.item?.color ?? "#7C8CFF"} label="Màu sắc đại diện danh mục" />
            <button className="save-button" disabled={saving}>{saving ? "Đang lưu…" : (modal.item ? "Cập nhật danh mục →" : "Lưu danh mục →")}</button>
          </form>
        </Modal>
      )}

      {modal?.kind === "budget" && <Modal title={modal.item ? "Chỉnh sửa ngân sách" : "Tạo ngân sách mới"} eyebrow="KIỂM SOÁT HẠN MỨC" onClose={() => setModal(null)}><form onSubmit={saveBudget}>
        <label>Tên ngân sách<input name="name" defaultValue={modal.item?.name} required placeholder="Ví dụ: Tiền đổ xăng" /></label>
        {!modal.item && <label>Số tiền phân bổ<FormattedMoneyInput name="amount" required placeholder="0" /></label>}
        {!modal.item && <label>Ví nguồn<select name="sourceWalletId" required><option value="">Chọn ví…</option>{wallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name} · khả dụng {money(availableBalances.get(w.id) ?? 0)}</option>)}</select></label>}
        <div className="form-grid">
          <label>Danh mục<select name="categoryId" defaultValue={modal.item?.category_id ?? ""}><option value="">Tổng chi tiêu</option>{categories.filter(item => item.kind === "expense").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Chu kỳ<select name="period" defaultValue={modal.item?.period ?? "monthly"}><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option><option value="yearly">Hàng năm</option></select></label>
        </div>
        <div className="form-grid">
          <label>Ngày bắt đầu<input name="periodStart" type="date" defaultValue={modal.item?.period_start ?? new Date().toISOString().slice(0, 10)} required /></label>
          <label>Cảnh báo khi (%)<input name="alertPercent" type="number" min="1" max="100" defaultValue={modal.item?.alert_percent ?? 80} required /></label>
        </div>
        {modal.item && <div className="allocation-info-box"><span>ⓘ Chỉnh sửa không thay đổi số tiền phân bổ. Dùng nút Nạp thêm / Rút tiền để điều chỉnh ngân sách.</span></div>}
        <button className="save-button" disabled={saving}>{saving ? "Đang lưu…" : (modal.item ? "Cập nhật ngân sách →" : "Tạo ngân sách →")}</button>
      </form></Modal>}

      {modal?.kind === "budget-topup" && <Modal title={`Nạp thêm vào: ${modal.budget.name}`} eyebrow="TĂNG NGÂN SÁCH" onClose={() => setModal(null)}><form onSubmit={e => handleBudgetTopup(e, modal.budget)}>
        <p className="allocation-info-box">Ngân sách hiện còn <b>{money(modal.budget.remaining_amount)}</b>. Chọn ví và nhập số tiền muốn bổ sung.</p>
        <label>Ví nguồn<select name="walletId" defaultValue={modal.budget.source_wallet_id ?? wallets[0]?.id}>{wallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name} · khả dụng {money(availableBalances.get(w.id) ?? 0)}</option>)}</select></label>
        <label>Số tiền nạp thêm<FormattedMoneyInput name="amount" required autoFocus /></label>
        <button className="save-button" disabled={saving}>{saving ? "Đang xử lý…" : "⊕ Nạp vào ngân sách →"}</button>
      </form></Modal>}

      {modal?.kind === "budget-return" && <Modal title={`Rút tiền khỏi: ${modal.budget.name}`} eyebrow="HOÀN TRẢ VỀ VÍ" onClose={() => setModal(null)}><form onSubmit={e => handleBudgetReturn(e, modal.budget)}>
        <p className="allocation-info-box">Có thể rút tối đa <b>{money(modal.budget.remaining_amount)}</b> về ví nguồn.</p>
        <label>Số tiền rút<FormattedMoneyInput name="amount" defaultValue={modal.budget.remaining_amount} required autoFocus /></label>
        <button className="save-button" disabled={saving}>{saving ? "Đang xử lý…" : "⊖ Rút về ví →"}</button>
      </form></Modal>}

      {modal?.kind === "goal" && (
        <Modal title={modal.item ? "Cập nhật mục tiêu" : "Tạo mục tiêu tiết kiệm"} eyebrow="TÍCH LŨY TƯƠNG LAI" onClose={() => setModal(null)}>
          <form onSubmit={saveGoal}>
            <label>Tên mục tiêu<input name="title" defaultValue={modal.item?.title} required placeholder="Ví dụ: Mua laptop, Quỹ du lịch…" /></label>
            <label>Số tiền mục tiêu<FormattedMoneyInput name="targetAmount" defaultValue={modal.item?.target_amount} required /></label>
            {!modal.item && (
              <>
                <label>Gửi vào ngay bây giờ (tùy chọn)<FormattedMoneyInput name="initialDeposit" defaultValue={0} placeholder="0 = chưa gửi" /></label>
                <label>Ví nguồn<select name="sourceWalletId"><option value="">Chọn ví (nếu gửi ngay)</option>{wallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name} · khả dụng {money(availableBalances.get(w.id) ?? 0)}</option>)}</select></label>
              </>
            )}
            <div className="form-grid" style={{ marginTop: 14 }}>
              <label>Thời hạn<input name="deadline" type="date" defaultValue={modal.item?.deadline ?? ""} /></label>
            </div>
            <ModernColorPicker name="color" defaultValue={modal.item?.color ?? "#D9F45F"} label="Màu đại diện mục tiêu" />
            <button className="save-button" disabled={saving}>{saving ? "Đang lưu…" : (modal.item ? "Cập nhật mục tiêu →" : "Tạo mục tiêu →")}</button>
          </form>
        </Modal>
      )}

      {modal?.kind === "goal-topup" && <Modal title={`Gửi tiền vào: ${modal.goal.title}`} eyebrow="NẠP TIỀT KIỆM" onClose={() => setModal(null)}><form onSubmit={e => handleGoalTopup(e, modal.goal)}>
        <p className="allocation-info-box">Mục tiêu hiện có <b>{money(modal.goal.current_amount)}</b> / {money(modal.goal.target_amount)}.</p>
        <label>Ví nguồn<select name="walletId" defaultValue={modal.goal.source_wallet_id ?? wallets[0]?.id}>{wallets.map(w => <option key={w.id} value={w.id}>{w.icon} {w.name} · khả dụng {money(availableBalances.get(w.id) ?? 0)}</option>)}</select></label>
        <label>Số tiền gửi<FormattedMoneyInput name="amount" required autoFocus /></label>
        <button className="save-button" disabled={saving}>{saving ? "Đang xử lý…" : "⊕ Gửi vào mục tiêu →"}</button>
      </form></Modal>}

      {modal?.kind === "goal-return" && <Modal title={`Rút tiền khỏi: ${modal.goal.title}`} eyebrow="HOÀN TRẢ VỀ VÍ" onClose={() => setModal(null)}><form onSubmit={e => handleGoalReturn(e, modal.goal)}>
        <p className="allocation-info-box">Có thể rút tối đa <b>{money(modal.goal.current_amount)}</b>.</p>
        <label>Số tiền rút<FormattedMoneyInput name="amount" defaultValue={modal.goal.current_amount} required autoFocus /></label>
        <button className="save-button" disabled={saving}>{saving ? "Đang xử lý…" : "⊖ Rút về ví →"}</button>
      </form></Modal>}

      {modal?.kind === "recurring" && <Modal title={modal.item ? "Chỉnh sửa lịch định kỳ" : "Tạo giao dịch định kỳ"} eyebrow="DÒNG TIỀN LẶP LẠI" onClose={() => setModal(null)}><form onSubmit={event => saveSimple(event, "recurring")}><div className="type-toggle"><button type="button" className={recurringType === "expense" ? "active" : ""} onClick={() => setRecurringType("expense")}>Khoản chi</button><button type="button" className={recurringType === "income" ? "active" : ""} onClick={() => setRecurringType("income")}>Khoản thu</button></div><label>Tên giao dịch<input name="title" defaultValue={modal.item?.title} required /></label><label>Số tiền<FormattedMoneyInput name="amount" defaultValue={modal.item?.amount} required /></label><div className="form-grid"><label>Danh mục<select name="categoryId" defaultValue={modal.item?.category_id ?? categories.find(item => item.kind === recurringType)?.id}>{categories.filter(item => item.kind === recurringType).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Ví<select name="walletId" defaultValue={modal.item?.wallet_id ?? wallets[0]?.id}>{wallets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="form-grid"><label>Tần suất<select name="frequency" defaultValue={modal.item?.frequency ?? "monthly"}><option value="daily">Hàng ngày</option><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option><option value="yearly">Hàng năm</option></select></label><label>Kỳ tiếp theo<input name="nextRun" type="datetime-local" defaultValue={localDateTime(modal.item?.next_run_at ?? new Date())} required /></label></div><label>Ghi chú<textarea name="note" defaultValue={modal.item?.note} /></label><div className="check-grid"><label><input name="active" type="checkbox" defaultChecked={modal.item?.active ?? true} /> Kích hoạt lịch</label><label><input name="autoCreate" type="checkbox" defaultChecked={modal.item?.auto_create ?? false} /> Tự động ghi nhận khi mở ứng dụng</label></div><button className="save-button" disabled={saving}>Lưu lịch định kỳ →</button></form></Modal>}

      {modal?.kind === "receipt-scan" && (
        <ReceiptScannerModal
          categories={categories}
          wallets={wallets}
          budgets={budgets}
          availableBalances={availableBalances}
          onClose={() => setModal(null)}
          onSwitchToManual={() => openModal({ kind: "transaction" })}
          onConfirmTransaction={handleConfirmReceiptTransaction}
          saving={saving}
          money={money}
        />
      )}

      {insufficientBalanceAlert && (
        <div className="modal-wrap insufficient-alert-wrap" role="dialog" aria-modal="true" aria-labelledby="insufficient-modal-title">
          <button className="modal-backdrop" onClick={() => setInsufficientBalanceAlert(null)} aria-label="Đóng" />
          <section className="insufficient-modal-card">
            <div className="insufficient-head">
              <span className="insufficient-icon">⚠️</span>
              <div>
                <p className="insufficient-eyebrow">CẢNH BÁO TÀI CHÍNH</p>
                <h2 id="insufficient-modal-title">Số dư không đủ</h2>
              </div>
            </div>

            <div className="insufficient-body">
              <p className="insufficient-main-text">
                {insufficientBalanceAlert.type === "budget" ? "Ngân sách" : "Ví"} <strong>&quot;{insufficientBalanceAlert.name}&quot;</strong> hiện chỉ có{" "}
                <strong className="avail-text">{money(insufficientBalanceAlert.availableBalance)}</strong>, trong khi khoản chi là{" "}
                <strong className="expense-text">{money(insufficientBalanceAlert.expenseAmount)}</strong>.
              </p>
              <div className="missing-notice-box">
                <span>Bạn còn thiếu:</span>
                <strong>{money(insufficientBalanceAlert.missingAmount)}</strong>
              </div>
            </div>

            <div className="insufficient-actions">
              <button type="button" className="insufficient-btn change-wallet" onClick={handleChooseAnotherWallet}>
                <span>🔄</span> Đổi nguồn thanh toán
              </button>
              <button type="button" className="insufficient-btn reduce-amount" onClick={handleReduceAmount}>
                <span>✏️</span> Giảm số tiền
              </button>
              {insufficientBalanceAlert.type === "wallet" && (
                <button type="button" className="insufficient-btn add-funds" onClick={handleOpenTopup}>
                  <span>➕</span> Bổ sung số dư
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {quickTopupModal && (
        <Modal title="Bổ sung số dư ví" eyebrow="NẠP TIỀN VÀO VÍ" onClose={() => setQuickTopupModal(null)}>
          <form onSubmit={handleSaveQuickTopup}>
            <div className="topup-alert-banner">
              <span className="topup-info-icon">💡</span>
              <p>
                Bạn cần bổ sung ít nhất <strong>{money(quickTopupModal.missingAmount)}</strong> vào ví{" "}
                <strong>&quot;{quickTopupModal.walletName}&quot;</strong> để thực hiện khoản chi.
              </p>
            </div>

            <label>
              Ví nhận tiền
              <input type="text" disabled value={quickTopupModal.walletName} className="disabled-input" />
            </label>

            <label>
              Số tiền bổ sung
              <FormattedMoneyInput name="amount" defaultValue={quickTopupModal.missingAmount} required autoFocus />
            </label>

            <label>
              Danh mục thu nhập
              <select name="categoryId" defaultValue={categories.find(c => c.kind === "income")?.id ?? ""}>
                {categories.filter(c => c.kind === "income").map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Ghi chú
              <textarea name="note" defaultValue={`Bổ sung số dư cho khoản chi "${transactionDraft.title}"`} />
            </label>

            <button className="save-button" disabled={saving}>
              {saving ? "Đang xử lý…" : "✓ Xác nhận bổ sung tiền →"}
            </button>
          </form>
        </Modal>
      )}

      <AiFloatingChat
        view={view}
        financialContext={{
          totalBalance,
          monthlyIncome: monthTotals.income,
          monthlyExpense: monthTotals.expense,
          wallets,
          transactions,
          budgets,
          savingsGoals: goals,
        }}
      />
    </main>
    </AiChatProvider>
  );
}

const WALLET_PRESET_COLORS = [
  "#D9F45F", "#22C55E", "#10B981", "#06B6D4", "#3B82F6",
  "#6366F1", "#8B5CF6", "#EC4899", "#F97316", "#EF4444", "#64748B"
];



const CURATED_PRESET_COLORS = [
  "#D9F45F", // Neon Lime (Mặc định)
  "#10B981", // Emerald Mint
  "#22C55E", // Vibrant Green
  "#06B6D4", // Ocean Cyan
  "#3B82F6", // Electric Blue
  "#6366F1", // Royal Indigo
  "#8B5CF6", // Cyber Violet
  "#A855F7", // Lavender Purple
  "#EC4899", // Sakura Pink
  "#F43F5E", // Coral Rose
  "#EF4444", // Ruby Red
  "#F97316", // Sunset Orange
  "#F59E0B", // Amber Gold
  "#EAB308", // Sun Yellow
  "#14B8A6", // Teal Aqua
  "#64748B", // Slate Neutral
];

const APP_THEME_PRESETS = [
  { name: "Neon Lime", hex: "#D2F544", desc: "Năng động & Trực quan (Mặc định)" },
  { name: "Ocean Cyan", hex: "#06B6D4", desc: "Tươi mát & Hiện đại" },
  { name: "Emerald Wealth", hex: "#10B981", desc: "Tài lộc & Thịnh vượng" },
  { name: "Vibrant Green", hex: "#22C55E", desc: "Tươi sáng & Tích cực" },
  { name: "Cyber Violet", hex: "#8B5CF6", desc: "Sáng tạo & Độc đáo" },
  { name: "Electric Blue", hex: "#3B82F6", desc: "Công nghệ & Đẳng cấp" },
  { name: "Sunset Amber", hex: "#F59E0B", desc: "Ấm áp & Nổi bật" },
  { name: "Coral Rose", hex: "#F43F5E", desc: "Thanh lịch & Tinh tế" },
  { name: "Sakura Pink", hex: "#EC4899", desc: "Ngọt ngào & Năng lượng" },
  { name: "Deep Indigo", hex: "#6366F1", desc: "Chuyên nghiệp & Điềm tĩnh" },
];

function getContrastColor(hexColor: string): string {
  const clean = hexColor.replace("#", "");
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? "#141c1e" : "#ffffff";
  }
  return "#141c1e";
}

function adjustColorBrightness(hex: string, percent: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  if (isNaN(num)) return hex;
  let r = (num >> 16) + percent;
  let g = ((num >> 8) & 0x00ff) + percent;
  let b = (num & 0x0000ff) + percent;
  r = Math.min(255, Math.max(0, r));
  g = Math.min(255, Math.max(0, g));
  b = Math.min(255, Math.max(0, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`;
}

function applyThemeAccent(hexColor: string) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--lime-accent", hexColor);
  document.documentElement.style.setProperty("--lime-hover", adjustColorBrightness(hexColor, -16));
}

function ModernColorPicker({
  name = "color",
  defaultValue = "#D9F45F",
  value,
  onChange,
  label = "Màu sắc đại diện",
  presets = CURATED_PRESET_COLORS,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (color: string) => void;
  label?: string;
  presets?: string[];
}) {
  const [selectedColor, setSelectedColor] = useState<string>(() => value || defaultValue || "#D9F45F");
  const [hexInput, setHexInput] = useState(() => (value || defaultValue || "#D9F45F").toUpperCase());

  useEffect(() => {
    if (value && value !== selectedColor) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedColor(value);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHexInput(value.toUpperCase());
    }
  }, [value, selectedColor]);

  function handleColorChange(newColor: string) {
    setSelectedColor(newColor);
    setHexInput(newColor.toUpperCase());
    onChange?.(newColor);
  }

  function handleHexInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    let val = e.target.value.toUpperCase();
    if (!val.startsWith("#")) val = "#" + val;
    setHexInput(val);
    if (/^#[0-9A-F]{6}$/i.test(val)) {
      setSelectedColor(val);
      onChange?.(val);
    }
  }

  return (
    <div className="modern-color-picker-wrapper">
      <div className="modern-color-picker-header">
        <span className="modern-color-picker-label">{label}</span>
        <div className="modern-color-preview-badge">
          <span className="modern-color-preview-dot" style={{ backgroundColor: selectedColor }} />
          <span className="modern-color-hex-tag">{selectedColor.toUpperCase()}</span>
        </div>
      </div>

      <div className="modern-color-swatches-grid">
        {presets.map((hex) => {
          const isSelected = selectedColor.toLowerCase() === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              className={`modern-color-swatch-btn ${isSelected ? "active" : ""}`}
              style={{ backgroundColor: hex }}
              onClick={() => handleColorChange(hex)}
              title={hex}
              aria-label={`Chọn màu ${hex}`}
            >
              {isSelected && (
                <span className="modern-swatch-check" style={{ color: getContrastColor(hex) }}>✓</span>
              )}
            </button>
          );
        })}

        {/* Nút mở Color Wheel picker tự do */}
        <label className="modern-color-custom-btn" title="Chọn màu tự do qua bảng màu">
          <span className="modern-color-custom-icon">🎨</span>
          <input
            type="color"
            value={selectedColor}
            onChange={(e) => handleColorChange(e.target.value)}
            className="modern-native-color-hidden"
          />
        </label>
      </div>

      <div className="modern-color-hex-row">
        <label className="modern-color-hex-label">
          <span>Mã màu HEX:</span>
          <div className="modern-color-hex-input-box">
            <span className="hex-prefix">#</span>
            <input
              type="text"
              value={hexInput.replace(/^#/, "")}
              onChange={handleHexInputChange}
              maxLength={6}
              placeholder="D9F45F"
              className="modern-color-hex-input"
            />
          </div>
        </label>
      </div>

      <input name={name} type="hidden" value={selectedColor} />
    </div>
  );
}

function WalletModalForm({ modalItem, saving, onSubmit }: { modalItem?: Wallet | null; saving: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const initialBalance = modalItem?.balance ?? 0;

  return (
    <form onSubmit={onSubmit}>
      <label>
        Tên ví
        <input name="name" defaultValue={modalItem?.name} required placeholder="Ví dụ: Techcombank, Tiền mặt…" />
      </label>

      <div className="form-grid">
        <label>
          Loại ví
          <select name="type" defaultValue={modalItem?.type ?? "cash"}>
            <option value="cash">Tiền mặt</option>
            <option value="bank">Ngân hàng</option>
            <option value="ewallet">Ví điện tử</option>
          </select>
        </label>

        <label>
          Số dư ban đầu
          <FormattedMoneyInput name="balance" defaultValue={initialBalance} required placeholder="0" />
        </label>
      </div>

      <div className="form-grid" style={{ marginTop: 14 }}>
        <label>
          Biểu tượng
          <select name="icon" defaultValue={modalItem?.icon ?? "💵"}>
            <option value="💵">💵 Tiền mặt</option>
            <option value="🏦">🏦 Ngân hàng</option>
            <option value="💳">💳 Thẻ tín dụng/ATM</option>
            <option value="📱">📱 Ví điện tử (Momo, ZaloPay...)</option>
            <option value="💰">💰 Tiết kiệm / Quỹ</option>
          </select>
        </label>
      </div>

      <ModernColorPicker name="color" defaultValue={modalItem?.color ?? "#D9F45F"} label="Màu sắc đại diện ví" />

      <button className="save-button" disabled={saving}>
        {saving ? "Đang lưu…" : (modalItem ? "Cập nhật ví →" : "Tạo ví mới →")}
      </button>
    </form>
  );
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><span>＋</span><p>{text}</p></div>; }

function TransactionTable({ items, money, language, categoryById, walletById, onEdit, onDelete, onReceipt }: { items: Transaction[]; money: (value: number) => string; language: "vi" | "en"; categoryById: Map<string, Category>; walletById: Map<string, Wallet>; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void; onReceipt: (path: string) => void }) {
  if (!items.length) return <Empty text="Chưa có giao dịch phù hợp." />;
  return <div className="transaction-table"><div className="table-head"><span>GIAO DỊCH</span><span>DANH MỤC / VÍ</span><span>NGÀY & GIỜ</span><span>SỐ TIỀN</span><span /></div>{items.map(item => { const category = categoryById.get(item.category_id ?? ""); const wallet = walletById.get(item.wallet_id ?? ""); return <div className="transaction-row" key={item.id}><span className="transaction-title"><i style={{ background: `${category?.color ?? "#98A1A5"}22`, color: category?.color ?? "#687273" }}>{item.type === "income" ? "↙" : "↗"}</i><span><b>{item.title}</b><small>{item.note || "Không có ghi chú"}</small></span></span><span><b>{category?.name ?? item.category}</b><small>{wallet?.name ?? "Không gắn ví"}</small></span><span>{formatDate(item.occurred_at, language)}</span><strong className={item.type}>{item.type === "expense" ? "−" : "+"}{money(item.amount)}</strong><span className="row-actions">{item.receipt_path && <button onClick={() => onReceipt(item.receipt_path!)} title="Mở hóa đơn">▱</button>}<button onClick={() => onEdit(item)} title="Chỉnh sửa">✎</button><button onClick={() => onDelete(item)} title="Xóa">×</button></span></div>; })}</div>;
}
