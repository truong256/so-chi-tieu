"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type {
  Budget,
  Category,
  ModalState,
  Profile,
  RecurringTransaction,
  SavingsGoal,
  Transaction,
  TransactionType,
  Transfer,
  Wallet,
} from "./finance-types";
import { advanceRecurring, formatDate, inRange, localDateTime, parseSmartTransaction, periodBounds, toNumber } from "./finance-utils";

type View = "overview" | "transactions" | "wallets" | "categories" | "planning" | "recurring" | "reports" | "settings";
type UserInfo = { id: string; name: string; email: string };

const defaultCategories = [
  ["Ăn uống", "expense", "🍜", "#FF9466"], ["Di chuyển", "expense", "🛵", "#7C8CFF"],
  ["Nhà ở", "expense", "🏠", "#E5CB54"], ["Mua sắm", "expense", "🛍️", "#FF7898"],
  ["Giải trí", "expense", "🎬", "#A47BE8"], ["Sức khỏe", "expense", "🩺", "#58B999"],
  ["Giáo dục", "expense", "📚", "#4B9BE8"], ["Lương", "income", "💼", "#78B732"],
  ["Thưởng", "income", "🎁", "#8CBF42"], ["Thu khác", "income", "✨", "#69A9D8"],
] as const;

const navItems: { id: View; label: string; en: string; icon: string }[] = [
  { id: "overview", label: "Tổng quan", en: "Overview", icon: "⌂" },
  { id: "transactions", label: "Giao dịch", en: "Transactions", icon: "⇄" },
  { id: "wallets", label: "Ví & tài khoản", en: "Wallets", icon: "▣" },
  { id: "categories", label: "Danh mục", en: "Categories", icon: "◫" },
  { id: "planning", label: "Ngân sách & mục tiêu", en: "Plans & goals", icon: "◎" },
  { id: "recurring", label: "Giao dịch định kỳ", en: "Recurring", icon: "↻" },
  { id: "reports", label: "Báo cáo", en: "Reports", icon: "▥" },
  { id: "settings", label: "Cài đặt", en: "Settings", icon: "⚙" },
];

function mapWallet(row: Record<string, unknown>): Wallet { return { ...row, balance: toNumber(row.balance) } as Wallet; }
function mapTransaction(row: Record<string, unknown>): Transaction { return { ...row, amount: toNumber(row.amount) } as Transaction; }
function mapTransfer(row: Record<string, unknown>): Transfer { return { ...row, amount: toNumber(row.amount) } as Transfer; }
function mapBudget(row: Record<string, unknown>): Budget { return { ...row, amount: toNumber(row.amount), alert_percent: toNumber(row.alert_percent) } as Budget; }
function mapGoal(row: Record<string, unknown>): SavingsGoal { return { ...row, target_amount: toNumber(row.target_amount), current_amount: toNumber(row.current_amount) } as SavingsGoal; }
function mapRecurring(row: Record<string, unknown>): RecurringTransaction { return { ...row, amount: toNumber(row.amount) } as RecurringTransaction; }

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
  const [recurringType, setRecurringType] = useState<TransactionType>("expense");
  const [transactionDraft, setTransactionDraft] = useState({ title: "", amount: "", type: "expense" as TransactionType, categoryId: "", walletId: "", occurredAt: localDateTime(), note: "" });

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }, []);

  const loadData = useCallback(async (runAutomation = true) => {
    setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session?.access_token || sessionData.session.user.id !== user.id) {
        throw new Error("Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.");
      }

      const [profileResult, walletResult, categoryResult, transactionResult, transferResult, budgetResult, goalResult, recurringResult] = await Promise.all([
        supabase.from("profiles").select("id,username,full_name,currency,language").eq("id", user.id).maybeSingle(),
        supabase.from("wallets").select("id,user_id,name,type,balance,currency,color,icon").order("created_at"),
        supabase.from("categories").select("id,user_id,name,kind,parent_id,icon,color,is_default").order("kind").order("name"),
        supabase.from("transactions").select("id,user_id,title,amount,type,category,category_id,wallet_id,occurred_at,note,receipt_path,recurrence_id").order("occurred_at", { ascending: false }).limit(500),
        supabase.from("transfers").select("id,user_id,from_wallet_id,to_wallet_id,amount,occurred_at,note").order("occurred_at", { ascending: false }).limit(300),
        supabase.from("budgets").select("id,user_id,category_id,name,amount,period,period_start,alert_percent").order("created_at"),
        supabase.from("savings_goals").select("id,user_id,title,target_amount,current_amount,deadline,color").order("deadline", { ascending: true }),
        supabase.from("recurring_transactions").select("id,user_id,wallet_id,category_id,title,amount,type,frequency,next_run_at,active,auto_create,note").order("next_run_at"),
      ]);
      const firstError = [profileResult, walletResult, categoryResult, transactionResult, transferResult, budgetResult, goalResult, recurringResult].find(result => result.error)?.error;
      if (firstError) throw firstError;

      let loadedProfile = profileResult.data as Profile | null;
      let loadedWallets = (walletResult.data ?? []).map(row => mapWallet(row as Record<string, unknown>));
      let loadedCategories = (categoryResult.data ?? []) as Category[];
      let loadedTransactions = (transactionResult.data ?? []).map(row => mapTransaction(row as Record<string, unknown>));
      let loadedRecurring = (recurringResult.data ?? []).map(row => mapRecurring(row as Record<string, unknown>));

      if (!loadedProfile) {
        const { data, error } = await supabase.from("profiles").insert({ id: user.id, full_name: user.name, currency: "VND", language: "vi" }).select("id,username,full_name,currency,language").single();
        if (error) throw error;
        loadedProfile = data as Profile;
      }
      if (!loadedWallets.length) {
        const { data, error } = await supabase.from("wallets").insert({ user_id: user.id, name: "Tiền mặt", type: "cash", balance: 0, currency: loadedProfile.currency, color: "#D9F45F", icon: "💵" }).select("id,user_id,name,type,balance,currency,color,icon").single();
        if (error) throw error;
        loadedWallets = [mapWallet(data as Record<string, unknown>)];
      }
      if (!loadedCategories.length) {
        const payload = defaultCategories.map(([name, kind, icon, color]) => ({ user_id: user.id, name, kind, icon, color, is_default: true }));
        const { data, error } = await supabase.from("categories").insert(payload).select("id,user_id,name,kind,parent_id,icon,color,is_default");
        if (error) throw error;
        loadedCategories = (data ?? []) as Category[];
      }

      if (runAutomation) {
        let automated = false;
        for (const schedule of loadedRecurring.filter(item => item.active && item.auto_create && new Date(item.next_run_at) <= new Date())) {
          const category = loadedCategories.find(item => item.id === schedule.category_id);
          const { error } = await supabase.from("transactions").insert({
            user_id: user.id, title: schedule.title, amount: schedule.amount, type: schedule.type,
            category: category?.name ?? (schedule.type === "income" ? "Thu khác" : "Khác"), category_id: schedule.category_id,
            wallet_id: schedule.wallet_id, occurred_at: schedule.next_run_at, note: schedule.note, recurrence_id: schedule.id,
          });
          if (!error) {
            await supabase.from("recurring_transactions").update({ next_run_at: advanceRecurring(schedule.next_run_at, schedule.frequency) }).eq("id", schedule.id);
            automated = true;
          }
        }
        if (automated) {
          const [freshTransactions, freshRecurring] = await Promise.all([
            supabase.from("transactions").select("id,user_id,title,amount,type,category,category_id,wallet_id,occurred_at,note,receipt_path,recurrence_id").order("occurred_at", { ascending: false }).limit(500),
            supabase.from("recurring_transactions").select("id,user_id,wallet_id,category_id,title,amount,type,frequency,next_run_at,active,auto_create,note").order("next_run_at"),
          ]);
          loadedTransactions = (freshTransactions.data ?? []).map(row => mapTransaction(row as Record<string, unknown>));
          loadedRecurring = (freshRecurring.data ?? []).map(row => mapRecurring(row as Record<string, unknown>));
          showNotice("Đã tự động ghi nhận giao dịch định kỳ đến hạn.");
        }
      }

      setProfile(loadedProfile);
      setWallets(loadedWallets);
      setCategories(loadedCategories);
      setTransactions(loadedTransactions);
      setTransfers((transferResult.data ?? []).map(row => mapTransfer(row as Record<string, unknown>)));
      setBudgets((budgetResult.data ?? []).map(row => mapBudget(row as Record<string, unknown>)));
      setGoals((goalResult.data ?? []).map(row => mapGoal(row as Record<string, unknown>)));
      setRecurring(loadedRecurring);
    } catch (error) {
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
    const values = new Map(wallets.map(item => [item.id, item.balance]));
    transactions.forEach(item => { if (item.wallet_id) values.set(item.wallet_id, (values.get(item.wallet_id) ?? 0) + (item.type === "income" ? item.amount : -item.amount)); });
    transfers.forEach(item => {
      values.set(item.from_wallet_id, (values.get(item.from_wallet_id) ?? 0) - item.amount);
      values.set(item.to_wallet_id, (values.get(item.to_wallet_id) ?? 0) + item.amount);
    });
    return values;
  }, [transactions, transfers, wallets]);
  const totalBalance = useMemo(() => [...walletBalances.values()].reduce((sum, value) => sum + value, 0), [walletBalances]);
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

  function openModal(next: NonNullable<ModalState>) {
    setModal(next);
    if (next.kind === "transaction") {
      const item = next.item;
      setTransactionDraft(item ? { title: item.title, amount: String(item.amount), type: item.type, categoryId: item.category_id ?? "", walletId: item.wallet_id ?? "", occurredAt: localDateTime(item.occurred_at), note: item.note } : { title: "", amount: "", type: "expense", categoryId: categories.find(value => value.kind === "expense")?.id ?? "", walletId: wallets[0]?.id ?? "", occurredAt: localDateTime(), note: "" });
      setSmartInput("");
    }
    if (next.kind === "recurring") setRecurringType(next.item?.type ?? "expense");
  }

  async function saveTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transactionDraft.walletId || !transactionDraft.categoryId) return showNotice("Hãy chọn ví và danh mục.");
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
      const payload = {
        user_id: user.id, title: transactionDraft.title.trim(), amount: Number(transactionDraft.amount), type: transactionDraft.type,
        category: category?.name ?? "Khác", category_id: transactionDraft.categoryId, wallet_id: transactionDraft.walletId,
        occurred_at: new Date(transactionDraft.occurredAt).toISOString(), note: transactionDraft.note.trim(), receipt_path: receiptPath,
      };
      if (modal?.kind === "transaction" && modal.item) {
        const oldReceipt = modal.item.receipt_path;
        const { error } = await supabase.from("transactions").update(payload).eq("id", modal.item.id);
        if (error) throw error;
        if (uploadedPath && oldReceipt) await supabase.storage.from("receipts").remove([oldReceipt]);
      } else {
        const { error } = await supabase.from("transactions").insert(payload);
        if (error) throw error;
      }
      setModal(null); showNotice("Giao dịch đã được lưu."); await loadData(false);
    } catch (error) {
      if (uploadedPath) await supabase.storage.from("receipts").remove([uploadedPath]);
      showNotice(error instanceof Error ? error.message : "Không thể lưu giao dịch.");
    } finally { setSaving(false); }
  }

  async function saveSimple(event: FormEvent<HTMLFormElement>, kind: Exclude<NonNullable<ModalState>["kind"], "transaction" | "transfer">) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      let table = ""; let payload: Record<string, unknown> = { user_id: user.id };
      if (kind === "wallet") { table = "wallets"; payload = { ...payload, name: String(form.get("name") || "").trim(), type: form.get("type"), balance: Number(form.get("balance")), currency: profile.currency, color: form.get("color"), icon: form.get("icon") }; }
      if (kind === "category") { table = "categories"; payload = { ...payload, name: String(form.get("name") || "").trim(), kind: form.get("type"), parent_id: form.get("parentId") || null, icon: form.get("icon"), color: form.get("color"), is_default: false }; }
      if (kind === "budget") { table = "budgets"; payload = { ...payload, name: String(form.get("name") || "").trim(), amount: Number(form.get("amount")), category_id: form.get("categoryId") || null, period: form.get("period"), period_start: form.get("periodStart"), alert_percent: Number(form.get("alertPercent")) }; }
      if (kind === "goal") { table = "savings_goals"; payload = { ...payload, title: String(form.get("title") || "").trim(), target_amount: Number(form.get("targetAmount")), current_amount: Number(form.get("currentAmount")), deadline: form.get("deadline") || null, color: form.get("color") }; }
      if (kind === "recurring") { table = "recurring_transactions"; payload = { ...payload, title: String(form.get("title") || "").trim(), amount: Number(form.get("amount")), type: recurringType, wallet_id: form.get("walletId") || null, category_id: form.get("categoryId") || null, frequency: form.get("frequency"), next_run_at: new Date(String(form.get("nextRun"))).toISOString(), active: form.get("active") === "on", auto_create: form.get("autoCreate") === "on", note: String(form.get("note") || "").trim() }; }
      const current = modal && modal.kind === kind ? modal.item : undefined;
      const result = current ? await supabase.from(table).update(payload).eq("id", current.id) : await supabase.from(table).insert(payload);
      if (result.error) throw result.error;
      setModal(null); showNotice("Đã lưu thay đổi."); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể lưu dữ liệu."); }
    finally { setSaving(false); }
  }

  async function saveTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true);
    const form = new FormData(event.currentTarget);
    const from = String(form.get("fromWalletId")); const to = String(form.get("toWalletId"));
    try {
      if (from === to) throw new Error("Ví nhận phải khác ví chuyển.");
      const { error } = await supabase.from("transfers").insert({ user_id: user.id, from_wallet_id: from, to_wallet_id: to, amount: Number(form.get("amount")), occurred_at: new Date(String(form.get("occurredAt"))).toISOString(), note: String(form.get("note") || "").trim() });
      if (error) throw error;
      setModal(null); showNotice("Đã chuyển tiền giữa hai ví."); await loadData(false);
    } catch (error) { showNotice(error instanceof Error ? error.message : "Không thể chuyển tiền."); }
    finally { setSaving(false); }
  }

  async function remove(table: string, id: string, label: string, receiptPath?: string | null) {
    if (!window.confirm(`Xóa ${label}? Thao tác này không thể hoàn tác.`)) return;
    if (table === "categories") await supabase.from("categories").update({ parent_id: null }).eq("parent_id", id);
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
    const category = categoryById.get(item.category_id ?? "");
    const { error } = await supabase.from("transactions").insert({ user_id: user.id, title: item.title, amount: item.amount, type: item.type, category: category?.name ?? "Khác", category_id: item.category_id, wallet_id: item.wallet_id, occurred_at: item.next_run_at, note: item.note, recurrence_id: item.id });
    if (error) return showNotice(error.message);
    await supabase.from("recurring_transactions").update({ next_run_at: advanceRecurring(item.next_run_at, item.frequency) }).eq("id", item.id);
    showNotice("Đã ghi nhận giao dịch đến hạn."); await loadData(false);
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
    const confirmation = window.prompt("Nhập XÓA để xóa toàn bộ dữ liệu tài chính cá nhân. Tài khoản đăng nhập vẫn được giữ.");
    if (confirmation !== "XÓA") return;
    setSaving(true);
    try {
      const { data: files } = await supabase.storage.from("receipts").list(user.id, { limit: 1000 });
      if (files?.length) await supabase.storage.from("receipts").remove(files.map(file => `${user.id}/${file.name}`));
      for (const table of ["transactions", "transfers", "budgets", "savings_goals", "recurring_transactions", "categories", "wallets", "profiles"]) {
        const column = table === "profiles" ? "id" : "user_id";
        const { error } = await supabase.from(table).delete().eq(column, user.id);
        if (error) throw error;
      }
      await onSignOut();
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Không thể xóa dữ liệu.");
    } finally {
      setSaving(false);
    }
  }

  function downloadData() {
    const exportData = {
      profile,
      wallets,
      categories,
      transactions,
      transfers,
      budgets,
      goals,
      recurring,
      exported_at: new Date().toISOString(),
    };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `so-chi-tieu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice("Đã tải xuống tệp dữ liệu cá nhân.");
  }

  const firstName = profile.full_name.trim().split(" ").pop() || user.name;
  const language = profile.language;
  const maxReportBar = Math.max(1, ...report.buckets.flatMap(item => [item.income, item.expense]));
  const reportExpense = report.current.expense || 1;
  let pieCursor = 0;
  const pie = report.categories.length ? `conic-gradient(${report.categories.map(item => { const start = pieCursor; pieCursor += item.amount / reportExpense * 100; return `${item.color} ${start}% ${pieCursor}%`; }).join(",")})` : "#e8e9e1";
  const comparison = (current: number, previous: number) => previous ? Math.round((current - previous) / previous * 100) : current ? 100 : 0;

  return (
    <main className="dashboard-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>SỔ CHI TIÊU</span></div>
        <button className="close-nav" onClick={() => setMobileNav(false)} aria-label="Đóng menu">×</button>
        <nav aria-label="Điều hướng chính"><p className="nav-section-title">{language === "vi" ? "KHÔNG GIAN CỦA BẠN" : "YOUR WORKSPACE"}</p>{navItems.map(item => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setMobileNav(false); }}><span className="nav-glyph">{item.icon}</span>{language === "vi" ? item.label : item.en}{item.id === "transactions" && <span className="count">{transactions.length}</span>}</button>)}</nav>
        <div className="sidebar-total-card"><small>{language === "vi" ? "TỔNG SỐ DƯ" : "TOTAL BALANCE"}</small><strong>{money(totalBalance)}</strong><span>{wallets.length} {language === "vi" ? "ví đang hoạt động" : "active wallets"}</span></div>
        <button type="button" onClick={onSignOut} className="user-profile-card" title="Đăng xuất"><span className="avatar-circle">{profile.full_name.charAt(0).toUpperCase()}</span><span className="user-info"><b>{profile.full_name}</b><small>{user.email}</small></span><em className="logout-icon">↗</em></button>
      </aside>
      {mobileNav && <button className="nav-backdrop" aria-label="Đóng menu" onClick={() => setMobileNav(false)} />}

      <section className="dashboard-main">
        <div className="dashboard-container">
          <header className="topbar">
            <button className="menu-button" onClick={() => setMobileNav(true)} aria-label="Mở menu">☰</button>
            <div><p className="top-date">{new Date().toLocaleDateString(locale, { weekday: "long", day: "2-digit", month: "long" }).toUpperCase()}</p><h1 className="top-greeting">{view === "overview" ? (language === "vi" ? `Chào bạn, ${firstName}.` : `Welcome, ${firstName}.`) : (language === "vi" ? navItems.find(item => item.id === view)?.label : navItems.find(item => item.id === view)?.en)}</h1></div>
            <div className="top-actions"><button className="ghost-action" onClick={() => openModal({ kind: "transfer" })} disabled={wallets.length < 2}>⇄ {language === "vi" ? "Chuyển tiền" : "Transfer"}</button><button className="add-button" onClick={() => openModal({ kind: "transaction" })}><b>＋</b> {language === "vi" ? "Thêm giao dịch" : "Add transaction"}</button></div>
          </header>

          {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
          {loading && <div className="loading-banner"><i /> Đang đồng bộ dữ liệu an toàn…</div>}

          {view === "overview" && <>
            <section className="summary-grid">
              <article className="balance-card">
                <div className="card-top-row">
                  <p>TỔNG SỐ DƯ KHẢ DỤNG</p>
                  <span className="wallet-badge">{wallets.length} VÍ</span>
                </div>
                <h2>{money(totalBalance)}</h2>
                <div className="card-sub-row">
                  <span className="trend-badge">↗ {monthTotals.income ? Math.round((monthTotals.income - monthTotals.expense) / monthTotals.income * 100) : 0}%</span>
                  <small>tỷ lệ giữ lại trong tháng</small>
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
                  {wallets.slice(0, 4).map(wallet => (
                    <div key={wallet.id} className="wallet-mini-item">
                      <span className="wallet-dot-box" style={{ background: `${wallet.color}25`, color: wallet.color }}>{wallet.icon}</span>
                      <span className="wallet-info">
                        <b>{wallet.name}</b>
                        <small>{wallet.type === "cash" ? "Tiền mặt" : wallet.type === "bank" ? "Ngân hàng" : "Ví điện tử"}</small>
                      </span>
                      <strong>{money(walletBalances.get(wallet.id) ?? 0)}</strong>
                    </div>
                  ))}
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
                    const spent = monthTransactions.filter(item => item.type === "expense" && (!budget.category_id || item.category_id === budget.category_id)).reduce((sum, item) => sum + item.amount, 0);
                    const percent = Math.round(spent / budget.amount * 100);
                    return (
                      <div key={budget.id} className="budget-item">
                        <div className="budget-item-head">
                          <b>{budget.name}</b>
                          <span className={percent >= 100 ? "danger" : percent >= budget.alert_percent ? "warning" : ""}>{percent}%</span>
                        </div>
                        <div className="meter"><i style={{ width: `${Math.min(100, percent)}%` }} /></div>
                        <small>{money(spent)} / {money(budget.amount)}</small>
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
          <section className="section-toolbar"><div><p>TOÀN BỘ DÒNG TIỀN</p><h2>{filteredTransactions.length} giao dịch</h2></div><button className="add-button" onClick={() => openModal({ kind: "transaction" })}>＋ Thêm khoản thu / chi</button></section>
          <section className="panel filter-panel"><label className="search-field">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên, ghi chú, danh mục hoặc ví…" /></label><div className="filter-grid"><select value={kindFilter} onChange={event => setKindFilter(event.target.value as typeof kindFilter)}><option value="all">Tất cả loại</option><option value="expense">Khoản chi</option><option value="income">Khoản thu</option></select><select value={walletFilter} onChange={event => setWalletFilter(event.target.value)}><option value="all">Tất cả ví</option>{wallets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">Tất cả danh mục</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} aria-label="Từ ngày" /><input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} aria-label="Đến ngày" /><input type="number" value={minAmount} onChange={event => setMinAmount(event.target.value)} placeholder="Từ số tiền" /><input type="number" value={maxAmount} onChange={event => setMaxAmount(event.target.value)} placeholder="Đến số tiền" /><select value={sort} onChange={event => setSort(event.target.value)}><option value="date-desc">Mới nhất</option><option value="date-asc">Cũ nhất</option><option value="amount-desc">Số tiền giảm dần</option><option value="amount-asc">Số tiền tăng dần</option></select></div></section>
          <article className="panel transaction-panel full-table"><TransactionTable items={filteredTransactions} money={money} language={language} categoryById={categoryById} walletById={walletById} onEdit={item => openModal({ kind: "transaction", item })} onDelete={item => remove("transactions", item.id, item.title, item.receipt_path)} onReceipt={openReceipt} /></article>
        </>}

        {view === "wallets" && <>
          <section className="section-toolbar"><div><p>TÀI SẢN & NGUỒN TIỀN</p><h2>{money(totalBalance)} tổng số dư</h2></div><div><button className="ghost-action" onClick={() => openModal({ kind: "transfer" })} disabled={wallets.length < 2}>⇄ Chuyển tiền</button><button className="add-button" onClick={() => openModal({ kind: "wallet" })}>＋ Tạo ví</button></div></section>
          <section className="wallet-grid">{wallets.map(wallet => <article className="wallet-card" key={wallet.id} style={{ "--wallet-color": wallet.color } as React.CSSProperties}><div><span>{wallet.icon}</span><small>{wallet.type === "cash" ? "TIỀN MẶT" : wallet.type === "bank" ? "NGÂN HÀNG" : "VÍ ĐIỆN TỬ"}</small></div><h3>{wallet.name}</h3><strong>{money(walletBalances.get(wallet.id) ?? 0)}</strong><p>Số dư ban đầu {money(wallet.balance)}</p><footer><button onClick={() => openModal({ kind: "wallet", item: wallet })}>Chỉnh sửa</button><button onClick={() => remove("wallets", wallet.id, wallet.name)}>Xóa</button></footer></article>)}</section>
          <article className="panel"><div className="panel-head"><div><p>LỊCH SỬ CHUYỂN TIỀN</p><h3>Điều chuyển giữa các ví</h3></div></div><div className="compact-list">{transfers.map(item => <div key={item.id}><span className="round-icon">⇄</span><span><b>{walletById.get(item.from_wallet_id)?.name} → {walletById.get(item.to_wallet_id)?.name}</b><small>{formatDate(item.occurred_at, language)} · {item.note || "Không có ghi chú"}</small></span><strong>{money(item.amount)}</strong><button onClick={() => remove("transfers", item.id, "lệnh chuyển tiền")}>×</button></div>)}{!transfers.length && <Empty text="Chưa có giao dịch chuyển tiền." />}</div></article>
        </>}

        {view === "categories" && (
          <section className="category-main-card">
            <div className="category-main-head">
              <div>
                <p>CẤU TRÚC DÒNG TIỀN</p>
                <h2>Danh mục thu & chi</h2>
              </div>
              <button className="category-create-button" onClick={() => openModal({ kind: "category" })}>
                <b>＋</b> Tạo danh mục
              </button>
            </div>

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
                          <span className="drag-dots-handle" title="Kéo để sắp xếp">
                            <i>::</i>
                          </span>
                          <span className="category-item-icon">{item.icon}</span>
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
          <section className="section-toolbar"><div><p>KẾ HOẠCH TÀI CHÍNH</p><h2>Ngân sách & mục tiêu tiết kiệm</h2></div><div><button className="ghost-action" onClick={() => openModal({ kind: "goal" })}>＋ Mục tiêu</button><button className="add-button" onClick={() => openModal({ kind: "budget" })}>＋ Ngân sách</button></div></section>
          <section className="planning-grid"><article className="panel"><div className="panel-head"><div><p>HẠN MỨC CHI TIÊU</p><h3>Ngân sách đang theo dõi</h3></div></div><div className="plan-list">{budgets.map(budget => { const bounds = periodBounds(budget.period === "weekly" ? "week" : budget.period === "yearly" ? "year" : "month"); const spent = transactions.filter(item => item.type === "expense" && inRange(item, bounds.start, bounds.end) && (!budget.category_id || item.category_id === budget.category_id)).reduce((sum, item) => sum + item.amount, 0); const percent = Math.round(spent / budget.amount * 100); return <div className={`plan-card ${percent >= 100 ? "over" : percent >= budget.alert_percent ? "near" : ""}`} key={budget.id}><header><span><b>{budget.name}</b><small>{budget.category_id ? categoryById.get(budget.category_id)?.name : "Tổng chi tiêu"} · {budget.period === "weekly" ? "Tuần" : budget.period === "yearly" ? "Năm" : "Tháng"}</small></span><strong>{percent}%</strong></header><div className="meter"><i style={{ width: `${Math.min(100, percent)}%` }} /></div><p><b>{money(spent)}</b> / {money(budget.amount)}</p>{percent >= budget.alert_percent && <em>{percent >= 100 ? "Đã vượt hạn mức" : "Sắp chạm hạn mức"}</em>}<footer><button onClick={() => openModal({ kind: "budget", item: budget })}>Sửa</button><button onClick={() => remove("budgets", budget.id, budget.name)}>Xóa</button></footer></div>; })}{!budgets.length && <Empty text="Tạo ngân sách tổng hoặc theo danh mục để kiểm soát chi tiêu." />}</div></article>
          <article className="panel"><div className="panel-head"><div><p>TÍCH LŨY TƯƠNG LAI</p><h3>Mục tiêu tiết kiệm</h3></div></div><div className="plan-list">{goals.map(goal => { const percent = Math.round(goal.current_amount / goal.target_amount * 100); return <div className="goal-plan" key={goal.id}><header><span style={{ background: `${goal.color}25`, color: goal.color }}>◎</span><div><b>{goal.title}</b><small>{goal.deadline ? `Hạn ${new Date(`${goal.deadline}T00:00:00`).toLocaleDateString(locale)}` : "Không có thời hạn"}</small></div><strong>{Math.min(100, percent)}%</strong></header><div className="meter"><i style={{ width: `${Math.min(100, percent)}%`, background: goal.color }} /></div><p>{money(goal.current_amount)} / {money(goal.target_amount)}</p><footer><button onClick={() => openModal({ kind: "goal", item: goal })}>Cập nhật</button><button onClick={() => remove("savings_goals", goal.id, goal.title)}>Xóa</button></footer></div>; })}{!goals.length && <Empty text="Chưa có mục tiêu tiết kiệm nào." />}</div></article></section>
        </>}

        {view === "recurring" && (
          <section className="recurring-main-card">
            <div className="recurring-main-head">
              <div>
                <p>DÒNG TIỀN LẶP LẠI</p>
                <h2>Lịch giao dịch định kỳ</h2>
              </div>
              <button className="recurring-create-btn" onClick={() => openModal({ kind: "recurring" })}>
                <b>＋</b> Tạo lịch
              </button>
            </div>

            <div className="automation-note">
              <div className="automation-note-icon">🪄</div>
              <div className="automation-note-content">
                <b>Tự động khi bạn mở ứng dụng</b>
                <p>Các lịch bật "Tự động ghi nhận" sẽ được tạo thành giao dịch ngay khi đến hạn; lịch còn lại sẽ hiển thị nút nhắc.</p>
              </div>
            </div>

            {recurring.length > 0 ? (
              <section className="recurring-grid">
                {recurring.map(item => {
                  const due = item.active && new Date(item.next_run_at) <= new Date();
                  const category = categoryById.get(item.category_id ?? "");
                  const wallet = walletById.get(item.wallet_id ?? "");
                  return (
                    <article className={`recurring-card ${due ? "due" : ""}`} key={item.id}>
                      <div>
                        <div className="recurring-card-header">
                          <span className={`recurring-card-type-icon ${item.type}`}>
                            {category?.icon ?? (item.type === "income" ? "↙" : "↗")}
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
                      </div>

                      <footer className="recurring-card-footer">
                        {due && !item.auto_create && (
                          <button type="button" className="recurring-due-btn" onClick={() => createDueTransaction(item)}>
                            Ghi nhận ngay
                          </button>
                        )}
                        <button type="button" className="recurring-action-btn" onClick={() => openModal({ kind: "recurring", item })}>
                          ✎ Sửa
                        </button>
                        <button type="button" className="recurring-action-btn" onClick={() => remove("recurring_transactions", item.id, item.title)}>
                          🗑 Xóa
                        </button>
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
            <section className="section-toolbar">
              <div>
                <p>PHÂN TÍCH DÒNG TIỀN</p>
                <h2>Báo cáo & thống kê</h2>
              </div>
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
            </section>

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

        {view === "settings" && (
          <div className="settings-container">
            <section className="section-toolbar">
              <div>
                <p>TÀI KHOẢN CÁ NHÂN</p>
                <h2>Hồ sơ & tùy chọn</h2>
              </div>
            </section>

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

            {/* Card 2: Quyền riêng tư */}
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
                <button type="button" className="download-data-btn" onClick={downloadData}>
                  <span>⤓</span> Tải xuống dữ liệu của bạn
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

      {modal?.kind === "transaction" && <Modal title={modal.item ? "Chỉnh sửa giao dịch" : "Thêm giao dịch mới"} eyebrow="GHI NHẬN DÒNG TIỀN" onClose={() => setModal(null)}><form onSubmit={saveTransaction}>
        {!modal.item && <div className="smart-entry"><label>✦ NHẬP NHANH THÔNG MINH</label><div><input value={smartInput} onChange={event => setSmartInput(event.target.value)} placeholder="Ví dụ: Ăn trưa 50k tiền mặt hôm nay" /><button type="button" onClick={() => { const parsed = parseSmartTransaction(smartInput, categories, wallets); setTransactionDraft(current => ({ ...current, ...parsed, amount: parsed.amount ? String(parsed.amount) : current.amount })); showNotice("Đã nhận diện nội dung. Hãy kiểm tra lại trước khi lưu."); }}>Nhận diện</button></div><small>Xử lý trực tiếp trên thiết bị: nhận diện số tiền, khoản thu/chi, danh mục, ví và ngày.</small></div>}
        <div className="type-toggle"><button type="button" className={transactionDraft.type === "expense" ? "active" : ""} onClick={() => setTransactionDraft(current => ({ ...current, type: "expense", categoryId: categories.find(item => item.kind === "expense")?.id ?? "" }))}>Khoản chi</button><button type="button" className={transactionDraft.type === "income" ? "active" : ""} onClick={() => setTransactionDraft(current => ({ ...current, type: "income", categoryId: categories.find(item => item.kind === "income")?.id ?? "" }))}>Khoản thu</button></div>
        <label>Tên giao dịch<input required autoFocus value={transactionDraft.title} onChange={event => setTransactionDraft(current => ({ ...current, title: event.target.value }))} placeholder="Ví dụ: Ăn trưa" /></label><label>Số tiền<input required min="0.01" step="0.01" type="number" inputMode="decimal" value={transactionDraft.amount} onChange={event => setTransactionDraft(current => ({ ...current, amount: event.target.value }))} /></label><div className="form-grid"><label>Danh mục<select required value={transactionDraft.categoryId} onChange={event => setTransactionDraft(current => ({ ...current, categoryId: event.target.value }))}>{categories.filter(item => item.kind === transactionDraft.type).map(item => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}</select></label><label>Ví thanh toán<select required value={transactionDraft.walletId} onChange={event => setTransactionDraft(current => ({ ...current, walletId: event.target.value }))}>{wallets.map(item => <option key={item.id} value={item.id}>{item.icon} {item.name}</option>)}</select></label></div><label>Ngày & giờ<input required type="datetime-local" value={transactionDraft.occurredAt} onChange={event => setTransactionDraft(current => ({ ...current, occurredAt: event.target.value }))} /></label><label>Ghi chú<textarea value={transactionDraft.note} onChange={event => setTransactionDraft(current => ({ ...current, note: event.target.value }))} placeholder="Mô tả ngắn…" /></label><label>Hóa đơn <span>(JPG, PNG, WebP hoặc PDF · tối đa 8 MB)</span><input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></label>{modal.item?.receipt_path && <p className="existing-file">✓ Giao dịch đang có hóa đơn. Chọn tệp mới để thay thế.</p>}<button className="save-button" disabled={saving}>{saving ? "Đang lưu…" : "Lưu giao dịch →"}</button>
      </form></Modal>}

      {modal?.kind === "wallet" && <Modal title={modal.item ? "Chỉnh sửa ví" : "Tạo ví mới"} eyebrow="VÍ & TÀI KHOẢN" onClose={() => setModal(null)}><form onSubmit={event => saveSimple(event, "wallet")}><label>Tên ví<input name="name" defaultValue={modal.item?.name} required placeholder="Ví dụ: Techcombank" /></label><div className="form-grid"><label>Loại ví<select name="type" defaultValue={modal.item?.type ?? "cash"}><option value="cash">Tiền mặt</option><option value="bank">Ngân hàng</option><option value="ewallet">Ví điện tử</option></select></label><label>Số dư ban đầu<input name="balance" type="number" step="0.01" defaultValue={modal.item?.balance ?? 0} required /></label></div><div className="form-grid"><label>Biểu tượng<select name="icon" defaultValue={modal.item?.icon ?? "💵"}><option>💵</option><option>🏦</option><option>💳</option><option>📱</option><option>💰</option></select></label><label>Màu sắc<input name="color" type="color" defaultValue={modal.item?.color ?? "#D9F45F"} /></label></div><button className="save-button" disabled={saving}>Lưu ví →</button></form></Modal>}

      {modal?.kind === "transfer" && <Modal title="Chuyển tiền giữa các ví" eyebrow="ĐIỀU CHUYỂN NỘI BỘ" onClose={() => setModal(null)}><form onSubmit={saveTransfer}><div className="form-grid"><label>Từ ví<select name="fromWalletId">{wallets.map(item => <option key={item.id} value={item.id}>{item.name} · {money(walletBalances.get(item.id) ?? 0)}</option>)}</select></label><label>Đến ví<select name="toWalletId" defaultValue={wallets[1]?.id}>{wallets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>Số tiền<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Ngày & giờ<input name="occurredAt" type="datetime-local" defaultValue={localDateTime()} required /></label><label>Ghi chú<textarea name="note" /></label><button className="save-button" disabled={saving}>Xác nhận chuyển tiền →</button></form></Modal>}

      {modal?.kind === "category" && <Modal title={modal.item ? "Chỉnh sửa danh mục" : "Tạo danh mục"} eyebrow="PHÂN LOẠI DÒNG TIỀN" onClose={() => setModal(null)}><form onSubmit={event => saveSimple(event, "category")}><label>Tên danh mục<input name="name" defaultValue={modal.item?.name} required /></label><div className="form-grid"><label>Loại<select name="type" defaultValue={modal.item?.kind ?? "expense"}><option value="expense">Khoản chi</option><option value="income">Khoản thu</option></select></label><label>Danh mục cha<select name="parentId" defaultValue={modal.item?.parent_id ?? ""}><option value="">Không có</option>{categories.filter(item => item.id !== modal.item?.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="form-grid"><label>Biểu tượng<select name="icon" defaultValue={modal.item?.icon ?? "✨"}><option>✨</option><option>🍜</option><option>🛵</option><option>🏠</option><option>🛍️</option><option>🎬</option><option>🩺</option><option>📚</option><option>💼</option><option>🎁</option></select></label><label>Màu sắc<input name="color" type="color" defaultValue={modal.item?.color ?? "#7C8CFF"} /></label></div><button className="save-button" disabled={saving}>Lưu danh mục →</button></form></Modal>}

      {modal?.kind === "budget" && <Modal title={modal.item ? "Chỉnh sửa ngân sách" : "Đặt ngân sách mới"} eyebrow="KIỂM SOÁT HẠN MỨC" onClose={() => setModal(null)}><form onSubmit={event => saveSimple(event, "budget")}><label>Tên ngân sách<input name="name" defaultValue={modal.item?.name} required placeholder="Ví dụ: Chi tiêu tháng" /></label><label>Số tiền giới hạn<input name="amount" type="number" min="0.01" step="0.01" defaultValue={modal.item?.amount} required /></label><div className="form-grid"><label>Danh mục<select name="categoryId" defaultValue={modal.item?.category_id ?? ""}><option value="">Tổng chi tiêu</option>{categories.filter(item => item.kind === "expense").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Chu kỳ<select name="period" defaultValue={modal.item?.period ?? "monthly"}><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option><option value="yearly">Hàng năm</option></select></label></div><div className="form-grid"><label>Ngày bắt đầu<input name="periodStart" type="date" defaultValue={modal.item?.period_start ?? new Date().toISOString().slice(0, 10)} required /></label><label>Cảnh báo khi (%)<input name="alertPercent" type="number" min="1" max="100" defaultValue={modal.item?.alert_percent ?? 80} required /></label></div><button className="save-button" disabled={saving}>Lưu ngân sách →</button></form></Modal>}

      {modal?.kind === "goal" && <Modal title={modal.item ? "Cập nhật mục tiêu" : "Tạo mục tiêu tiết kiệm"} eyebrow="TÍCH LŨY TƯƠNG LAI" onClose={() => setModal(null)}><form onSubmit={event => saveSimple(event, "goal")}><label>Tên mục tiêu<input name="title" defaultValue={modal.item?.title} required placeholder="Ví dụ: Quỹ du lịch" /></label><div className="form-grid"><label>Số tiền mục tiêu<input name="targetAmount" type="number" min="0.01" step="0.01" defaultValue={modal.item?.target_amount} required /></label><label>Đã tiết kiệm<input name="currentAmount" type="number" min="0" step="0.01" defaultValue={modal.item?.current_amount ?? 0} required /></label></div><div className="form-grid"><label>Thời hạn<input name="deadline" type="date" defaultValue={modal.item?.deadline ?? ""} /></label><label>Màu sắc<input name="color" type="color" defaultValue={modal.item?.color ?? "#D9F45F"} /></label></div><button className="save-button" disabled={saving}>Lưu mục tiêu →</button></form></Modal>}

      {modal?.kind === "recurring" && <Modal title={modal.item ? "Chỉnh sửa lịch định kỳ" : "Tạo giao dịch định kỳ"} eyebrow="DÒNG TIỀN LẶP LẠI" onClose={() => setModal(null)}><form onSubmit={event => saveSimple(event, "recurring")}><div className="type-toggle"><button type="button" className={recurringType === "expense" ? "active" : ""} onClick={() => setRecurringType("expense")}>Khoản chi</button><button type="button" className={recurringType === "income" ? "active" : ""} onClick={() => setRecurringType("income")}>Khoản thu</button></div><label>Tên giao dịch<input name="title" defaultValue={modal.item?.title} required /></label><label>Số tiền<input name="amount" type="number" min="0.01" step="0.01" defaultValue={modal.item?.amount} required /></label><div className="form-grid"><label>Danh mục<select name="categoryId" defaultValue={modal.item?.category_id ?? categories.find(item => item.kind === recurringType)?.id}>{categories.filter(item => item.kind === recurringType).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Ví<select name="walletId" defaultValue={modal.item?.wallet_id ?? wallets[0]?.id}>{wallets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><div className="form-grid"><label>Tần suất<select name="frequency" defaultValue={modal.item?.frequency ?? "monthly"}><option value="daily">Hàng ngày</option><option value="weekly">Hàng tuần</option><option value="monthly">Hàng tháng</option><option value="yearly">Hàng năm</option></select></label><label>Kỳ tiếp theo<input name="nextRun" type="datetime-local" defaultValue={localDateTime(modal.item?.next_run_at ?? new Date())} required /></label></div><label>Ghi chú<textarea name="note" defaultValue={modal.item?.note} /></label><div className="check-grid"><label><input name="active" type="checkbox" defaultChecked={modal.item?.active ?? true} /> Kích hoạt lịch</label><label><input name="autoCreate" type="checkbox" defaultChecked={modal.item?.auto_create ?? false} /> Tự động ghi nhận khi mở ứng dụng</label></div><button className="save-button" disabled={saving}>Lưu lịch định kỳ →</button></form></Modal>}
    </main>
  );
}

function Empty({ text }: { text: string }) { return <div className="empty-state"><span>＋</span><p>{text}</p></div>; }

function TransactionTable({ items, money, language, categoryById, walletById, onEdit, onDelete, onReceipt }: { items: Transaction[]; money: (value: number) => string; language: "vi" | "en"; categoryById: Map<string, Category>; walletById: Map<string, Wallet>; onEdit: (item: Transaction) => void; onDelete: (item: Transaction) => void; onReceipt: (path: string) => void }) {
  if (!items.length) return <Empty text="Chưa có giao dịch phù hợp." />;
  return <div className="transaction-table"><div className="table-head"><span>GIAO DỊCH</span><span>DANH MỤC / VÍ</span><span>NGÀY & GIỜ</span><span>SỐ TIỀN</span><span /></div>{items.map(item => { const category = categoryById.get(item.category_id ?? ""); const wallet = walletById.get(item.wallet_id ?? ""); return <div className="transaction-row" key={item.id}><span className="transaction-title"><i style={{ background: `${category?.color ?? "#98A1A5"}22`, color: category?.color ?? "#687273" }}>{category?.icon ?? (item.type === "income" ? "↙" : "↗")}</i><span><b>{item.title}</b><small>{item.note || "Không có ghi chú"}</small></span></span><span><b>{category?.name ?? item.category}</b><small>{wallet?.name ?? "Không gắn ví"}</small></span><span>{formatDate(item.occurred_at, language)}</span><strong className={item.type}>{item.type === "expense" ? "−" : "+"}{money(item.amount)}</strong><span className="row-actions">{item.receipt_path && <button onClick={() => onReceipt(item.receipt_path!)} title="Mở hóa đơn">▱</button>}<button onClick={() => onEdit(item)} title="Chỉnh sửa">✎</button><button onClick={() => onDelete(item)} title="Xóa">×</button></span></div>; })}</div>;
}
