/**
 * tests/ai-crud-and-recurring.test.mjs
 * =====================================
 * Comprehensive Automated Test Suite for:
 * 1. AI Intent Classification (Calculation vs Advice vs Query vs How-To vs Permitted CRUD vs Destructive Refusal)
 * 2. Natural Language CRUD Creation (Category, Budget, Transaction, Recurring Transaction)
 * 3. Missing Mandatory Field Detection & Multi-Turn Conversational Slot Filling (Zero Hallucinations)
 * 4. Confirmation Flow (Pending Proposal -> Confirm / Cancel / Conversational "Xác nhận" & "Hủy")
 * 5. Security, User Ownership (`user_id`), Validation, Duplicate & Idempotency Protection, Truthful API Error Reporting
 * 6. Formal LLM Tool/Function Calling (`FINANCIAL_TOOLS`, `executeFinancialTool`, `processChat` tool loop)
 * 7. Backend Recurring Scheduler (`Asia/Ho_Chi_Minh` timezone, anchor day preservation, leap years, `month_end_mode`, `record_recurring_transaction` RPC, `recurring_occurrences` duplicate prevention, completion conditions)
 */

import http from "node:http";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { routeUserIntent } from "../backend/src/services/ai-router.service.ts";
import {
  CRUD_ACTION_TOOLS,
  detectPermittedCrudIntent,
  executeConfirmedCrudAction,
  handleChatCrudIntent,
  resetAiCrudStoresForTests,
} from "../backend/src/services/ai-crud-tools.service.ts";
import {
  FINANCIAL_TOOLS,
  executeFinancialTool,
} from "../backend/src/services/financial-tools.service.ts";
import { processChat } from "../backend/src/services/ai-chat.service.ts";
import { invalidateTagsCache } from "../backend/src/services/ollama-client.ts";
import {
  computeInitialRecurringSchedule,
  computeNextRunAt,
  fromTimeZonePartsToUtcIso,
  processDueRecurringTransactions,
  toTimeZoneParts,
} from "../backend/src/services/recurring-scheduler.service.ts";
import { advanceRecurring } from "../frontend/utils/finance.utils.ts";

// ---------------------------------------------------------------------------
// Helper to run conversational CRUD intent through router + orchestrator
// ---------------------------------------------------------------------------

async function runCrudTurn(ctx, message, history = []) {
  const detected = detectPermittedCrudIntent(message, history, ctx?.userId);
  assert.ok(detected, `Expected permitted CRUD intent to be detected for: "${message}"`);
  return handleChatCrudIntent(detected, message, history, ctx);
}

// ---------------------------------------------------------------------------
// Realistic Stateful In-Memory Mock Supabase Client (Mirrors PostgreSQL RPCs & RLS)
// ---------------------------------------------------------------------------

function createStatefulMockSupabase({
  currentUserId = "user-1",
  seedWallets = null,
  seedCategories = null,
  seedBudgets = [],
  seedTransactions = [],
  seedRecurring = [],
  seedOccurrences = [],
  failTableInsert = null,
  failRpc = null,
  simulateMissingRpcs = false,
  simulateLegacyFrequencyCheck = false,
} = {}) {
  let idSeq = 100;
  const nextId = (prefix) => `${prefix}-${++idSeq}`;

  const db = {
    wallets:
      seedWallets ?? [
        {
          id: "wallet-cash-1",
          user_id: "user-1",
          name: "Tiền mặt",
          type: "cash",
          currency: "VND",
          balance: 2_000_000,
          reserved_amount: 0,
        },
        {
          id: "wallet-bank-1",
          user_id: "user-1",
          name: "Vietcombank",
          type: "bank",
          currency: "VND",
          balance: 10_000_000,
          reserved_amount: 1_000_000,
        },
        {
          id: "wallet-foreign-user",
          user_id: "user-2",
          name: "Ví Người Khác",
          type: "cash",
          currency: "VND",
          balance: 99_000_000,
          reserved_amount: 0,
        },
      ],
    categories:
      seedCategories ?? [
        {
          id: "cat-food-1",
          user_id: "user-1",
          name: "Ăn uống",
          kind: "expense",
          icon: "utensils",
          color: "#EF4444",
          is_default: true,
        },
        {
          id: "cat-shop-1",
          user_id: "user-1",
          name: "Mua sắm",
          kind: "expense",
          icon: "shopping-bag",
          color: "#EC4899",
          is_default: true,
        },
        {
          id: "cat-net-1",
          user_id: "user-1",
          name: "Hóa đơn & Tiện ích",
          kind: "expense",
          icon: "zap",
          color: "#F59E0B",
          is_default: true,
        },
        {
          id: "cat-salary-1",
          user_id: "user-1",
          name: "Lương",
          kind: "income",
          icon: "wallet",
          color: "#10B981",
          is_default: true,
        },
        {
          id: "cat-bonus-1",
          user_id: "user-1",
          name: "Thưởng",
          kind: "income",
          icon: "award",
          color: "#22C55E",
          is_default: true,
        },
      ],
    budgets: [...seedBudgets],
    fund_allocations: [],
    transactions: [...seedTransactions],
    recurring_transactions: [...seedRecurring],
    recurring_occurrences: [...seedOccurrences],
  };

  const rpcCalls = [];

  function buildQueryBuilder(table) {
    const filters = [];
    let pendingInsert = null;
    let pendingUpsert = null;
    let pendingUpsertOpts = null;
    let pendingUpdate = null;
    let sortField = null;
    let sortAsc = true;
    let maxRows = null;

    const applyFilters = (rows) =>
      rows.filter((row) =>
        filters.every(({ col, op, val }) => {
          if (op === "eq") return row[col] === val;
          if (op === "in") return Array.isArray(val) && val.includes(row[col]);
          return true;
        }),
      );

    const executeRead = () => {
      let rows = applyFilters(db[table] || []);
      if (sortField) {
        rows = [...rows].sort((a, b) => {
          const av = String(a[sortField] ?? "");
          const bv = String(b[sortField] ?? "");
          return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (typeof maxRows === "number") {
        rows = rows.slice(0, maxRows);
      }
      return rows.map((r) => ({ ...r }));
    };

    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push({ col, op: "eq", val });
        return builder;
      },
      in(col, vals) {
        filters.push({ col, op: "in", val: vals });
        return builder;
      },
      order(col, opts = {}) {
        sortField = col;
        sortAsc = opts.ascending !== false;
        return builder;
      },
      limit(n) {
        maxRows = n;
        return builder;
      },
      insert(payload) {
        pendingInsert = Array.isArray(payload) ? payload[0] : payload;
        return builder;
      },
      upsert(payload, opts = {}) {
        pendingUpsert = Array.isArray(payload) ? payload[0] : payload;
        pendingUpsertOpts = opts;
        return builder;
      },
      update(payload) {
        pendingUpdate = payload;
        return builder;
      },
      async maybeSingle() {
        const res = await builder._run();
        if (res.error) return res;
        const arr = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
        return { data: arr[0] ?? null, error: null };
      },
      async single() {
        const res = await builder._run();
        if (res.error) return res;
        const arr = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
        if (!arr[0]) {
          return { data: null, error: { message: "Row not found" } };
        }
        return { data: arr[0], error: null };
      },
      async _run() {
        if (pendingUpsert) {
          const conflictCols = String(pendingUpsertOpts?.onConflict || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const existing =
            conflictCols.length > 0
              ? (db[table] || []).find((r) => conflictCols.every((c) => r[c] === pendingUpsert[c]))
              : null;
          if (existing) {
            Object.assign(existing, pendingUpsert);
            return { data: [{ ...existing }], error: null };
          }
          const row = {
            id: pendingUpsert.id || nextId(table.slice(0, 4)),
            created_at: new Date().toISOString(),
            ...pendingUpsert,
          };
          db[table].push(row);
          return { data: [{ ...row }], error: null };
        }

        if (pendingInsert) {
          if (failTableInsert === table) {
            return {
              data: null,
              error: { message: `SIMULATED_DB_ERROR on ${table}` },
            };
          }
          if (table === "recurring_occurrences") {
            const exists = db.recurring_occurrences.find(
              (o) =>
                o.recurring_transaction_id === pendingInsert.recurring_transaction_id &&
                o.scheduled_for === pendingInsert.scheduled_for,
            );
            if (exists) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate key value violates unique constraint" },
              };
            }
          }
          if (table === "transactions") {
            const w = db.wallets.find(
              (item) => item.id === pendingInsert.wallet_id && item.user_id === currentUserId,
            );
            if (!w) {
              return { data: null, error: { message: "WALLET_FORBIDDEN" } };
            }
            const avail = Number(w.balance) - Number(w.reserved_amount || 0);
            if (pendingInsert.type === "expense" && Number(pendingInsert.amount) > avail) {
              return { data: null, error: { message: "INSUFFICIENT_BALANCE" } };
            }
            if (pendingInsert.type === "expense") {
              w.balance = Number(w.balance) - Number(pendingInsert.amount);
            } else if (pendingInsert.type === "income") {
              w.balance = Number(w.balance) + Number(pendingInsert.amount);
            }
          }
          if (table === "budgets" && Number(pendingInsert.amount) > 0 && !simulateMissingRpcs) {
            return { data: null, error: { message: "INVALID_BUDGET_TOTALS" } };
          }
          if (
            table === "recurring_transactions" &&
            simulateLegacyFrequencyCheck &&
            !["daily", "weekly", "monthly", "yearly"].includes(String(pendingInsert.frequency))
          ) {
            return {
              data: null,
              error: {
                code: "23514",
                message:
                  'new row for relation "recurring_transactions" violates check constraint "recurring_transactions_frequency_check"',
              },
            };
          }

          const row = {
            id: pendingInsert.id || nextId(table.slice(0, 4)),
            created_at: new Date().toISOString(),
            ...pendingInsert,
          };
          db[table].push(row);
          return { data: [{ ...row }], error: null };
        }

        if (pendingUpdate) {
          const matched = applyFilters(db[table] || []);
          for (const row of matched) {
            Object.assign(row, pendingUpdate);
          }
          return { data: matched.map((r) => ({ ...r })), error: null };
        }

        return { data: executeRead(), error: null };
      },
      then(onFulfilled, onRejected) {
        return builder._run().then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const client = {
    db,
    rpcCalls,
    from(table) {
      return buildQueryBuilder(table);
    },
    async rpc(fnName, params = {}) {
      rpcCalls.push({ fnName, params });
      if (simulateMissingRpcs) {
        return {
          data: null,
          error: {
            code: "PGRST202",
            message: `Could not find the function public.${fnName} in the schema cache`,
          },
        };
      }
      if (failRpc === fnName) {
        return { data: null, error: { message: `SIMULATED_RPC_ERROR:${fnName}` } };
      }

      if (fnName === "get_true_wallet_balances") {
        // Mirrors exact PostgreSQL `public.get_true_wallet_balances()` -> returns ONLY `(wallet_id, true_balance)`
        const userWallets = db.wallets.filter((w) => w.user_id === currentUserId);
        return {
          data: userWallets.map((w) => ({
            wallet_id: w.id,
            true_balance: Number(w.balance),
          })),
          error: null,
        };
      }

      if (fnName === "create_budget_with_allocation") {
        const alloc = params.p_wallet_id
          ? Number(params.p_initial_allocation ?? params.p_amount)
          : 0;
        if (params.p_wallet_id) {
          const w = db.wallets.find(
            (item) => item.id === params.p_wallet_id && item.user_id === currentUserId,
          );
          if (!w) {
            return { data: null, error: { message: "WALLET_FORBIDDEN" } };
          }
          const avail = Number(w.balance) - Number(w.reserved_amount || 0);
          if (alloc > avail) {
            return { data: null, error: { message: "INSUFFICIENT_FUNDS" } };
          }
          w.reserved_amount = Number(w.reserved_amount || 0) + alloc;
        }
        const budgetId = nextId("budg");
        db.budgets.push({
          id: budgetId,
          user_id: currentUserId,
          name: params.p_name,
          amount: Number(params.p_amount),
          allocated_amount: alloc,
          spent_amount: 0,
          remaining_amount: alloc > 0 ? alloc : Number(params.p_amount),
          source_wallet_id: params.p_wallet_id ?? null,
          category_id: params.p_category_id ?? null,
          period: params.p_period,
          period_start: params.p_period_start,
          alert_percent: params.p_alert_percent ?? 80,
          status: "active",
          created_at: new Date().toISOString(),
        });
        return { data: budgetId, error: null };
      }

      if (fnName === "record_recurring_transaction") {
        const rec = db.recurring_transactions.find(
          (r) => r.id === params.p_recurring_id && r.user_id === currentUserId,
        );
        if (!rec || !rec.active) {
          return { data: null, error: { message: "RECURRING_UNAVAILABLE" } };
        }
        const w = db.wallets.find(
          (item) => item.id === rec.wallet_id && item.user_id === currentUserId,
        );
        if (!w) {
          return { data: null, error: { message: "WALLET_FORBIDDEN" } };
        }
        const avail = Number(w.balance) - Number(w.reserved_amount || 0);
        if (rec.type === "expense" && Number(rec.amount) > avail) {
          return { data: null, error: { message: "INSUFFICIENT_BALANCE" } };
        }
        if (rec.type === "expense") {
          w.balance = Number(w.balance) - Number(rec.amount);
        } else {
          w.balance = Number(w.balance) + Number(rec.amount);
        }
        const txId = nextId("rctx");
        db.transactions.push({
          id: txId,
          user_id: currentUserId,
          wallet_id: rec.wallet_id,
          category_id: rec.category_id ?? null,
          type: rec.type,
          amount: Number(rec.amount),
          currency: w.currency || "VND",
          title: rec.title,
          note: rec.note ?? "",
          occurred_at: params.p_occurred_at,
          payment_source_type: "wallet",
          recurrence_id: params.p_recurring_id,
        });
        rec.next_run_at = params.p_next_run_at;
        rec.last_processed_at = new Date().toISOString();
        return { data: txId, error: null };
      }

      return { data: null, error: { message: `Unknown RPC ${fnName}` } };
    },
  };

  return client;
}

// ===========================================================================
// 1. INTENT CLASSIFICATION TESTS
// ===========================================================================

describe("AI CRUD & Intent Classification", () => {
  beforeEach(() => {
    resetAiCrudStoresForTests();
  });

  it("classifies permitted CRUD creation requests accurately across all 4 entities", () => {
    const catRoute = routeUserIntent("Tạo danh mục chi tiêu Thú cưng", [], "user-1");
    assert.equal(catRoute.canonicalIntent, "ACTION_REQUEST");
    assert.equal(catRoute.crudIntent?.actionType, "create_category");

    const budRoute = routeUserIntent("Tạo ngân sách Ăn uống 3 triệu mỗi tháng", [], "user-1");
    assert.equal(budRoute.canonicalIntent, "ACTION_REQUEST");
    assert.equal(budRoute.crudIntent?.actionType, "create_budget");

    const txRoute = routeUserIntent("Ghi khoản chi ăn trưa 45k bằng ví Tiền mặt", [], "user-1");
    assert.equal(txRoute.canonicalIntent, "ACTION_REQUEST");
    assert.equal(txRoute.crudIntent?.actionType, "create_transaction");

    const recRoute = routeUserIntent(
      "Tạo giao dịch định kỳ tiền Internet 250k hàng tháng từ ví Vietcombank",
      [],
      "user-1",
    );
    assert.equal(recRoute.canonicalIntent, "ACTION_REQUEST");
    assert.equal(recRoute.crudIntent?.actionType, "create_recurring_transaction");
  });

  it("distinguishes calculation, financial advice, data query, and UI how-to questions from CRUD actions", () => {
    const calcRoute = routeUserIntent("Tôi có đủ tiền mua điện thoại giá 3 triệu không?", [], "user-1");
    assert.equal(calcRoute.crudIntent ?? null, null);
    assert.equal(calcRoute.requiresFinancialAnalysis, true);

    const planRoute = routeUserIntent("Với số tiền còn lại thì ăn sáng trong 1 tuần tôi ăn gì?", [], "user-1");
    assert.equal(planRoute.crudIntent ?? null, null);

    const queryRoute = routeUserIntent("Ngân sách ăn uống tháng này của tôi còn bao nhiêu?", [], "user-1");
    assert.equal(queryRoute.crudIntent ?? null, null);

    const howToRoute = routeUserIntent("Làm sao để tạo ngân sách mới trên ứng dụng?", [], "user-1");
    assert.equal(howToRoute.crudIntent ?? null, null);
    assert.equal(howToRoute.canonicalIntent, "SYSTEM_HELP");
  });

  it("blocks destructive/unpermitted commands (delete/update wallet) from permitted CRUD tools", () => {
    const delTx = detectPermittedCrudIntent("Xóa giao dịch ăn trưa 50k vừa rồi cho tôi", []);
    assert.equal(delTx, null, "Destructive delete must NEVER match permitted CRUD tools");

    const routeDel = routeUserIntent("Xóa ví Tiền mặt giúp tôi", [], "user-1");
    assert.equal(routeDel.crudIntent ?? null, null);
    assert.equal(routeDel.canonicalIntent, "ACTION_REQUEST");
  });
});

// ===========================================================================
// 2. MISSING MANDATORY FIELDS & MULTI-TURN CONVERSATIONAL SLOT FILLING
// ===========================================================================

describe("Missing Mandatory Fields & Multi-Turn Slot Filling (Zero Assumed Data)", () => {
  beforeEach(() => {
    resetAiCrudStoresForTests();
  });

  it("asks user for missing category kind (even when name starts with 'Thú') instead of guessing, then creates on follow-up", async () => {
    const supabase = createStatefulMockSupabase();
    const initialCatCount = supabase.db.categories.length;
    const ctx = { userId: "user-1", supabase };

    // Turn 1: Missing kind ("Chi tiêu" vs "Thu nhập")
    const turn1 = await runCrudTurn(ctx, "Tạo danh mục Thú cưng", []);
    assert.equal(turn1.handled, true);
    assert.equal(supabase.db.categories.length, initialCatCount, "Must NOT insert category before kind is clarified");
    assert.match(turn1.reply, /Chi tiêu|Thu nhập/i);

    // Turn 2: User supplies only the missing slot ("Chi tiêu")
    const history = [
      { role: "user", parts: [{ text: "Tạo danh mục Thú cưng" }] },
      { role: "model", parts: [{ text: turn1.reply }] },
    ];
    const turn2 = await runCrudTurn(ctx, "Chi tiêu", history);
    assert.equal(turn2.handled, true);
    assert.ok(turn2.executedAction);
    assert.equal(turn2.executedAction.actionType, "create_category");
    assert.deepEqual(turn2.executedAction.refreshTargets, ["categories"]);
    assert.equal(supabase.db.categories.length, initialCatCount + 1);
    assert.equal(supabase.db.categories.at(-1).name, "Thú cưng");
    assert.equal(supabase.db.categories.at(-1).kind, "expense");
  });

  it("asks user for missing budget amount and period instead of inventing defaults", async () => {
    const supabase = createStatefulMockSupabase();
    const ctx = { userId: "user-1", supabase };

    const turn1 = await runCrudTurn(ctx, "Tạo ngân sách Ăn uống", []);
    assert.equal(turn1.handled, true);
    assert.equal(turn1.pendingAction, undefined);
    assert.equal(supabase.db.budgets.length, 0);
    assert.match(turn1.reply, /Hạn mức|số tiền/i);
    assert.match(turn1.reply, /Chu kỳ/i);

    const history = [
      { role: "user", parts: [{ text: "Tạo ngân sách Ăn uống" }] },
      { role: "model", parts: [{ text: turn1.reply }] },
    ];
    const turn2 = await runCrudTurn(ctx, "3 triệu mỗi tháng", history);
    assert.equal(turn2.handled, true);
    assert.ok(turn2.pendingAction, "Should return confirmation proposal once all mandatory fields are provided");
    assert.equal(turn2.pendingAction.actionType, "create_budget");
    assert.equal(turn2.pendingAction.payload.amount, 3_000_000);
    assert.equal(turn2.pendingAction.payload.period, "monthly");
    assert.equal(supabase.db.budgets.length, 0, "Must NOT write budget before user confirmation");
  });

  it("asks user for missing amount, wallet, or unmapped category instead of inventing them", async () => {
    const supabase = createStatefulMockSupabase();
    const ctx = { userId: "user-1", supabase };

    // Missing amount & wallet
    const turn1 = await runCrudTurn(ctx, "Ghi khoản chi cà phê sáng", []);
    assert.equal(turn1.handled, true);
    assert.equal(turn1.pendingAction, undefined);
    assert.equal(supabase.db.transactions.length, 0);
    assert.match(turn1.reply, /Số tiền/i);
    assert.match(turn1.reply, /Ví/i);

    const history = [
      { role: "user", parts: [{ text: "Ghi khoản chi cà phê sáng" }] },
      { role: "model", parts: [{ text: turn1.reply }] },
    ];
    const turn2 = await runCrudTurn(ctx, "45k bằng ví Tiền mặt", history);
    assert.equal(turn2.handled, true);
    assert.ok(turn2.pendingAction);
    assert.equal(turn2.pendingAction.actionType, "create_transaction");
    assert.equal(turn2.pendingAction.payload.amount, 45_000);
    assert.equal(turn2.pendingAction.payload.wallet_id, "wallet-cash-1");

    // Also verify missing category asks user when title cannot map to any user category
    resetAiCrudStoresForTests();
    const turnUnknownCat = await runCrudTurn(
      ctx,
      "Ghi khoản chi đóng phí câu lạc bộ 120k bằng ví Tiền mặt",
      [],
    );
    assert.equal(turnUnknownCat.pendingAction, undefined);
    assert.match(turnUnknownCat.reply, /danh mục/i);
  });

  it("asks user for missing recurring frequency instead of assuming monthly", async () => {
    const supabase = createStatefulMockSupabase();
    const ctx = { userId: "user-1", supabase };

    const turn1 = await runCrudTurn(
      ctx,
      "Tạo giao dịch định kỳ tiền Internet 250k từ ví Vietcombank",
      [],
    );
    assert.equal(turn1.handled, true);
    assert.equal(turn1.pendingAction, undefined);
    assert.match(turn1.reply, /Tần suất/i);

    const history = [
      { role: "user", parts: [{ text: "Tạo giao dịch định kỳ tiền Internet 250k từ ví Vietcombank" }] },
      { role: "model", parts: [{ text: turn1.reply }] },
    ];
    const turn2 = await runCrudTurn(ctx, "Hàng tháng ngày 15", history);
    assert.equal(turn2.handled, true);
    assert.ok(turn2.pendingAction);
    assert.equal(turn2.pendingAction.actionType, "create_recurring_transaction");
    assert.equal(turn2.pendingAction.payload.frequency, "monthly");
    assert.equal(turn2.pendingAction.payload.amount, 250_000);
    assert.equal(turn2.pendingAction.payload.wallet_id, "wallet-bank-1");
  });
});

// ===========================================================================
// 3. CONFIRMATION FLOW, EXISTING RPC REUSE & LIVE REFRESH TARGETS
// ===========================================================================

describe("CRUD Confirmation Flow & Existing Business Logic Reuse", () => {
  beforeEach(() => {
    resetAiCrudStoresForTests();
  });

  it("creates envelope-funded budget via `create_budget_with_allocation` RPC ONLY after confirmation", async () => {
    const supabase = createStatefulMockSupabase();
    const ctx = { userId: "user-1", supabase };

    const proposalRes = await runCrudTurn(
      ctx,
      "Tạo ngân sách Ăn uống 1.5 triệu mỗi tháng trích từ ví Tiền mặt",
      [],
    );
    assert.equal(proposalRes.handled, true);
    assert.ok(proposalRes.pendingAction);
    assert.equal(supabase.db.budgets.length, 0, "No DB mutation before confirmation");
    assert.equal(supabase.rpcCalls.filter((c) => c.fnName === "create_budget_with_allocation").length, 0);

    // Confirm via executeConfirmedCrudAction (simulating UI Confirm card click)
    const execRes = await executeConfirmedCrudAction(ctx, {
      actionId: proposalRes.pendingAction.actionId,
      idempotencyKey: proposalRes.pendingAction.idempotencyKey,
    });

    assert.equal(execRes.success, true);
    assert.equal(execRes.status, 200);
    assert.ok(execRes.executedAction);
    assert.deepEqual(execRes.executedAction.refreshTargets, ["budgets", "wallets"]);
    assert.equal(supabase.db.budgets.length, 1);
    assert.equal(supabase.db.budgets[0].allocated_amount, 1_500_000);
    const cashWallet = supabase.db.wallets.find((w) => w.id === "wallet-cash-1");
    assert.equal(cashWallet.reserved_amount, 1_500_000);
  });

  it("supports conversational 'Xác nhận' and 'Hủy' for pending CRUD proposals", async () => {
    const supabase = createStatefulMockSupabase();
    const ctx = { userId: "user-1", supabase };

    // 1. Propose transaction -> then Cancel via chat "Hủy"
    const prop1 = await runCrudTurn(
      ctx,
      "Ghi khoản chi ăn trưa 60k bằng ví Tiền mặt",
      [],
    );
    assert.ok(prop1.pendingAction);

    const cancelRes = await runCrudTurn(
      ctx,
      "Hủy",
      [
        { role: "user", parts: [{ text: "Ghi khoản chi ăn trưa 60k bằng ví Tiền mặt" }] },
        { role: "model", parts: [{ text: prop1.reply }] },
      ],
    );
    assert.equal(cancelRes.handled, true);
    assert.equal(supabase.db.transactions.length, 0);
    assert.match(cancelRes.reply, /hủy/i);

    // 2. Propose income transaction -> then Confirm via chat "Xác nhận"
    const prop2 = await runCrudTurn(
      ctx,
      "Ghi khoản thu thưởng dự án 2 triệu danh mục Thưởng vào ví Vietcombank",
      [],
    );
    assert.ok(prop2.pendingAction);
    assert.equal(prop2.pendingAction.payload.type, "income");

    const confirmRes = await runCrudTurn(
      ctx,
      "Xác nhận",
      [
        { role: "user", parts: [{ text: "Ghi khoản thu thưởng dự án 2 triệu danh mục Thưởng vào ví Vietcombank" }] },
        { role: "model", parts: [{ text: prop2.reply }] },
      ],
    );
    assert.equal(confirmRes.handled, true);
    assert.ok(confirmRes.executedAction);
    assert.equal(confirmRes.executedAction.actionType, "create_transaction");
    assert.deepEqual(confirmRes.executedAction.refreshTargets, ["transactions", "wallets", "budgets"]);
    assert.equal(supabase.db.transactions.length, 1);
    assert.equal(supabase.db.transactions[0].amount, 2_000_000);
    assert.equal(supabase.db.transactions[0].type, "income");
    const bankWallet = supabase.db.wallets.find((w) => w.id === "wallet-bank-1");
    assert.equal(bankWallet.balance, 12_000_000);
  });

  it("registers CRUD_ACTION_TOOLS in FINANCIAL_TOOLS and intercepts LLM tool calls safely", async () => {
    const toolNames = FINANCIAL_TOOLS.map((t) => t.function.name);
    for (const expected of [
      "create_category",
      "create_budget",
      "create_transaction",
      "create_recurring_transaction",
    ]) {
      assert.ok(toolNames.includes(expected), `FINANCIAL_TOOLS must include ${expected}`);
    }
    assert.equal(CRUD_ACTION_TOOLS.length, 4);

    const supabase = createStatefulMockSupabase();
    const ctx = { userId: "user-1", supabase };

    // Execute via executeFinancialTool directly
    const toolOut = await executeFinancialTool(
      "create_category",
      {
        name: "Sách & Khóa học",
        kind: "expense",
        raw_message: "Tạo danh mục chi tiêu Sách & Khóa học",
      },
      ctx,
    );
    assert.equal(toolOut.success, true);
    assert.equal(toolOut.data.actionType, "create_category");
    assert.ok(supabase.db.categories.some((c) => c.name === "Sách & Khóa học"));

    // Spin up ephemeral local HTTP server mimicking Ollama returning a `create_budget` tool_call
    invalidateTagsCache();
    let capturedToolsInOllamaReq = null;
    const mockOllamaServer = http.createServer((req, res) => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            models: [{ name: "qwen2.5:7b", model: "qwen2.5:7b" }],
          }),
        );
        return;
      }
      if (req.url === "/api/chat") {
        let rawBody = "";
        req.on("data", (chunk) => {
          rawBody += chunk;
        });
        req.on("end", () => {
          const parsedBody = JSON.parse(rawBody || "{}");
          capturedToolsInOllamaReq = parsedBody.tools || [];
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              model: "qwen2.5:7b",
              done: true,
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    function: {
                      name: "create_budget",
                      arguments: {
                        category_name: "Ăn uống",
                        amount: 2_500_000,
                        period: "monthly",
                      },
                    },
                  },
                ],
              },
            }),
          );
        });
        return;
      }
      res.writeHead(404).end();
    });

    await new Promise((resolve) => mockOllamaServer.listen(0, "127.0.0.1", resolve));
    const port = mockOllamaServer.address().port;
    try {
      const chatRes = await processChat(
        `http://127.0.0.1:${port}`,
        {
          message: "Mình muốn kiểm soát tiền ăn uống mỗi tháng khoảng 2.5 triệu, giúp mình nhé",
          history: [],
          financialContext: null,
        },
        {
          modelOverride: "qwen2.5:7b",
          toolContext: ctx,
        },
      );

      assert.ok(Array.isArray(capturedToolsInOllamaReq) && capturedToolsInOllamaReq.length > 0);
      assert.equal(chatRes.status, 200);
      assert.ok(chatRes.pendingAction, "processChat must intercept LLM CRUD tool call and return pendingAction");
      assert.equal(chatRes.pendingAction.actionType, "create_budget");
      assert.equal(chatRes.pendingAction.payload.amount, 2_500_000);
      assert.equal(supabase.db.budgets.length, 0, "Still requires user confirmation before DB write");
    } finally {
      invalidateTagsCache();
      await new Promise((resolve) => mockOllamaServer.close(resolve));
    }
  });
});

// ===========================================================================
// 4. SECURITY, OWNERSHIP, DUPLICATE / IDEMPOTENCY & API ERROR HANDLING
// ===========================================================================

describe("Security, Ownership, Idempotency & Truthful Error Handling", () => {
  beforeEach(() => {
    resetAiCrudStoresForTests();
  });

  it("rejects unauthenticated execution and cross-user confirmation hijacking (401 / 403)", async () => {
    const supabase = createStatefulMockSupabase();

    // Unauthenticated call
    const unauth = await executeConfirmedCrudAction(
      { userId: "", supabase },
      {
        idempotencyKey: "idem-unauth",
        actionType: "create_category",
        payload: { name: "Test", kind: "expense" },
      },
    );
    assert.equal(unauth.success, false);
    assert.equal(unauth.status, 401);

    // Unauthenticated handleChatCrudIntent
    const unauthChat = await handleChatCrudIntent(
      { kind: "CRUD_CREATE", actionType: "create_category" },
      "Tạo danh mục chi tiêu Test",
      [],
      { userId: "", supabase },
    );
    assert.equal(unauthChat.status, 401);

    // User 1 creates pending action
    const prop = await runCrudTurn(
      { userId: "user-1", supabase },
      "Ghi khoản chi ăn sáng 35k bằng ví Tiền mặt",
      [],
    );
    assert.ok(prop.pendingAction);

    // User 2 attempts to confirm User 1's actionId
    const hijack = await executeConfirmedCrudAction(
      { userId: "user-2", supabase },
      {
        actionId: prop.pendingAction.actionId,
        idempotencyKey: prop.pendingAction.idempotencyKey,
      },
    );
    assert.equal(hijack.success, false);
    assert.equal(hijack.status, 403);
    assert.equal(supabase.db.transactions.length, 0);

    // User 1 attempts to spend from User 2's wallet_id directly
    const foreignWalletAttempt = await executeConfirmedCrudAction(
      { userId: "user-1", supabase },
      {
        idempotencyKey: "idem-foreign-wallet",
        actionType: "create_transaction",
        payload: {
          title: "Hack",
          amount: 50_000,
          type: "expense",
          wallet_id: "wallet-foreign-user",
        },
      },
    );
    assert.equal(foreignWalletAttempt.success, false);
    assert.equal(foreignWalletAttempt.status, 403);
    assert.equal(supabase.db.transactions.length, 0);
  });

  it("prevents duplicate writes on idempotencyKey retry, rapid fingerprint retry, and duplicate categories", async () => {
    const supabase = createStatefulMockSupabase();
    const initialCatCount = supabase.db.categories.length;
    const ctx = { userId: "user-1", supabase };

    const prop = await runCrudTurn(
      ctx,
      "Ghi khoản chi mua nước 25k danh mục Ăn uống bằng ví Tiền mặt",
      [],
    );
    assert.ok(prop.pendingAction);

    // First confirmation succeeds
    const first = await executeConfirmedCrudAction(ctx, {
      actionId: prop.pendingAction.actionId,
      idempotencyKey: prop.pendingAction.idempotencyKey,
    });
    assert.equal(first.success, true);
    assert.equal(supabase.db.transactions.length, 1);

    // Second retry with SAME idempotencyKey -> returns alreadyExecuted without inserting a 2nd row!
    const retrySameKey = await executeConfirmedCrudAction(ctx, {
      actionId: prop.pendingAction.actionId,
      idempotencyKey: prop.pendingAction.idempotencyKey,
    });
    assert.equal(retrySameKey.success, true);
    assert.equal(retrySameKey.executedAction.alreadyExecuted, true);
    assert.equal(supabase.db.transactions.length, 1);

    // Rapid retry with DIFFERENT idempotencyKey & direct payload but identical content fingerprint -> deduplicated!
    const retryFingerprint = await executeConfirmedCrudAction(ctx, {
      idempotencyKey: "idem-different-key-same-payload",
      actionType: "create_transaction",
      payload: prop.pendingAction.payload,
    });
    assert.equal(retryFingerprint.success, true);
    assert.equal(retryFingerprint.executedAction.alreadyExecuted, true);
    assert.equal(supabase.db.transactions.length, 1);

    // Duplicate category creation blocked
    const dupCat = await runCrudTurn(ctx, "Tạo danh mục chi tiêu Ăn uống", []);
    assert.equal(dupCat.handled, true);
    assert.equal(dupCat.executedAction, undefined);
    assert.match(dupCat.reply, /đã tồn tại/i);
    assert.equal(supabase.db.categories.length, initialCatCount);
  });

  it("rejects insufficient wallet available balance (accounting for reserved_amount) and reports DB/RPC errors truthfully", async () => {
    const supabase = createStatefulMockSupabase();
    const ctx = { userId: "user-1", supabase };

    // Vietcombank has balance = 10,000,000 and reserved_amount = 1,000,000 -> available = 9,000,000
    const overSpend = await runCrudTurn(
      ctx,
      "Ghi khoản chi mua laptop 9.5 triệu danh mục Mua sắm bằng ví Vietcombank",
      [],
    );
    assert.equal(overSpend.handled, true);
    assert.equal(overSpend.pendingAction, undefined, "Should block proposal when available balance < expense");
    assert.match(overSpend.reply, /không đủ số dư khả dụng|9\.000\.000/i);

    // Simulated DB/RPC error during budget execution -> MUST report failure, NEVER claim success!
    const failingSupabase = createStatefulMockSupabase({
      failRpc: "create_budget_with_allocation",
    });
    const failCtx = { userId: "user-1", supabase: failingSupabase };
    const budProp = await runCrudTurn(
      failCtx,
      "Tạo ngân sách Ăn uống 2 triệu mỗi tháng",
      [],
    );
    assert.ok(budProp.pendingAction);

    const failedExec = await executeConfirmedCrudAction(failCtx, {
      actionId: budProp.pendingAction.actionId,
      idempotencyKey: budProp.pendingAction.idempotencyKey,
    });
    assert.equal(failedExec.success, false);
    assert.doesNotMatch(failedExec.reply, /Đã tạo thành công/i);
    assert.match(failedExec.reply, /thất bại/i);
    assert.equal(failingSupabase.db.budgets.length, 0);
  });
});

// ===========================================================================
// 5. BACKEND RECURRING SCHEDULER & TIMEZONE / ANCHOR DAY EDGE CASES
// ===========================================================================

describe("Backend Recurring Scheduler (`Asia/Ho_Chi_Minh`, Anchor Day, Idempotency)", () => {
  it("preserves Vietnam wall-clock date across UTC midnight boundary (00:30 GMT+7 = 17:30 UTC prev day)", () => {
    const utcIso = fromTimeZonePartsToUtcIso(
      { year: 2026, month: 1, day: 31, hour: 0, minute: 30, second: 0 },
      "Asia/Ho_Chi_Minh",
    );
    assert.equal(utcIso, "2026-01-30T17:30:00.000Z");

    const parts = toTimeZoneParts(utcIso, "Asia/Ho_Chi_Minh");
    assert.equal(parts.year, 2026);
    assert.equal(parts.month, 1);
    assert.equal(parts.day, 31);
    assert.equal(parts.hour, 0);
    assert.equal(parts.minute, 30);
  });

  it("preserves anchor day-of-month across Feb 28 / Leap Year Feb 29 / Mar 31 without date drift", () => {
    const jan31Vn = fromTimeZonePartsToUtcIso(
      { year: 2026, month: 1, day: 31, hour: 8, minute: 0, second: 0 },
      "Asia/Ho_Chi_Minh",
    );

    const febRun = computeNextRunAt({
      currentRunAt: jan31Vn,
      frequency: "monthly",
      interval: 1,
      monthEndMode: "last_day",
      startDate: "2026-01-31",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const febParts = toTimeZoneParts(febRun, "Asia/Ho_Chi_Minh");
    assert.deepEqual([febParts.year, febParts.month, febParts.day], [2026, 2, 28]);

    const marRun = computeNextRunAt({
      currentRunAt: febRun,
      frequency: "monthly",
      interval: 1,
      monthEndMode: "last_day",
      startDate: "2026-01-31",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const marParts = toTimeZoneParts(marRun, "Asia/Ho_Chi_Minh");
    assert.deepEqual([marParts.year, marParts.month, marParts.day], [2026, 3, 31]);

    const aprRun = computeNextRunAt({
      currentRunAt: marRun,
      frequency: "monthly",
      interval: 1,
      monthEndMode: "last_day",
      startDate: "2026-01-31",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const aprParts = toTimeZoneParts(aprRun, "Asia/Ho_Chi_Minh");
    assert.deepEqual([aprParts.year, aprParts.month, aprParts.day], [2026, 4, 30]);

    const mayRun = computeNextRunAt({
      currentRunAt: aprRun,
      frequency: "monthly",
      interval: 1,
      monthEndMode: "last_day",
      startDate: "2026-01-31",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const mayParts = toTimeZoneParts(mayRun, "Asia/Ho_Chi_Minh");
    assert.deepEqual([mayParts.year, mayParts.month, mayParts.day], [2026, 5, 31]);

    const jan31Leap = fromTimeZonePartsToUtcIso(
      { year: 2028, month: 1, day: 31, hour: 8, minute: 0, second: 0 },
      "Asia/Ho_Chi_Minh",
    );
    const feb29Run = computeNextRunAt({
      currentRunAt: jan31Leap,
      frequency: "monthly",
      interval: 1,
      monthEndMode: "last_day",
      startDate: "2028-01-31",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const feb29Parts = toTimeZoneParts(feb29Run, "Asia/Ho_Chi_Minh");
    assert.deepEqual([feb29Parts.year, feb29Parts.month, feb29Parts.day], [2028, 2, 29]);

    const nextMonthModeRun = computeNextRunAt({
      currentRunAt: jan31Vn,
      frequency: "monthly",
      interval: 1,
      monthEndMode: "next_month",
      startDate: "2026-01-31",
      timeZone: "Asia/Ho_Chi_Minh",
    });
    const nmParts = toTimeZoneParts(nextMonthModeRun, "Asia/Ho_Chi_Minh");
    assert.deepEqual([nmParts.year, nmParts.month, nmParts.day], [2026, 3, 1]);

    const feFeb = advanceRecurring("2026-01-31T08:00:00.000Z", "monthly", 1, "last_day", "2026-01-31");
    const feMar = advanceRecurring(feFeb, "monthly", 1, "last_day", "2026-01-31");
    assert.equal(new Date(feMar).getUTCDate(), 31);
  });

  it("computes accurate initial schedule for future day_of_month in Vietnam timezone", () => {
    const now = new Date("2026-05-10T03:00:00.000Z"); // 2026-05-10 10:00 ICT
    const init = computeInitialRecurringSchedule({
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 25,
      timeOfDay: "08:00",
      timeZone: "Asia/Ho_Chi_Minh",
      now,
    });
    assert.equal(init.startDate, "2026-05-25");
    const parts = toTimeZoneParts(init.nextRunAt, "Asia/Ho_Chi_Minh");
    assert.deepEqual([parts.year, parts.month, parts.day, parts.hour], [2026, 5, 25, 8]);
  });

  it("executes due recurring schedules via RPC, prevents duplicates, and honors occurrence_limit", async () => {
    const scheduledIso = "2026-05-01T01:00:00.000Z"; // 08:00 ICT May 1
    const supabase = createStatefulMockSupabase({
      seedRecurring: [
        {
          id: "rec-net-1",
          user_id: "user-1",
          title: "Internet FPT",
          type: "expense",
          amount: 250_000,
          wallet_id: "wallet-cash-1",
          category_id: "cat-net-1",
          frequency: "monthly",
          interval: 1,
          start_date: "2026-05-01",
          next_run_at: scheduledIso,
          month_end_mode: "last_day",
          processing_mode: "auto",
          auto_create: true,
          active: true,
          status: "active",
          end_type: "occurrences",
          occurrence_limit: 2,
        },
      ],
    });

    const ctx = { userId: "user-1", supabase };
    const run1Now = new Date("2026-05-02T02:00:00.000Z");

    // 1. Execute first due cycle (May 1)
    const summary1 = await processDueRecurringTransactions(ctx, {
      now: run1Now,
      timeZone: "Asia/Ho_Chi_Minh",
    });
    assert.equal(summary1.success, true);
    assert.equal(summary1.executedCount, 1);
    assert.equal(supabase.db.transactions.length, 1);
    assert.equal(supabase.db.recurring_occurrences.length, 1);
    assert.equal(supabase.db.recurring_occurrences[0].status, "confirmed");
    assert.equal(supabase.db.recurring_transactions[0].active, true);

    // 2. Simulate accidental rewind of `next_run_at` to the SAME `scheduledIso` -> MUST skip duplicate!
    supabase.db.recurring_transactions[0].next_run_at = scheduledIso;
    const summaryDup = await processDueRecurringTransactions(ctx, {
      now: run1Now,
      timeZone: "Asia/Ho_Chi_Minh",
    });
    assert.equal(summaryDup.executedCount, 0);
    assert.equal(summaryDup.skippedDuplicateCount, 1);
    assert.equal(supabase.db.transactions.length, 1, "Must NOT create duplicate transaction for same cycle");

    // 3. Advance clock to June 2 -> executes 2nd cycle and marks schedule `completed` (occurrence_limit = 2)
    const summary2 = await processDueRecurringTransactions(ctx, {
      now: new Date("2026-06-02T02:00:00.000Z"),
      timeZone: "Asia/Ho_Chi_Minh",
    });
    assert.equal(summary2.executedCount, 1);
    assert.equal(supabase.db.transactions.length, 2);
    assert.equal(
      supabase.db.recurring_occurrences.filter((o) => o.status === "confirmed").length,
      2,
    );
    assert.equal(supabase.db.recurring_transactions[0].active, false);
    assert.equal(supabase.db.recurring_transactions[0].status, "completed");
  });

  it("handles insufficient wallet balance on due recurring expense gracefully without crashing", async () => {
    const supabase = createStatefulMockSupabase({
      seedWallets: [
        {
          id: "wallet-low",
          user_id: "user-1",
          name: "Ví Ít Tiền",
          type: "cash",
          currency: "VND",
          balance: 100_000,
          reserved_amount: 0,
        },
      ],
      seedRecurring: [
        {
          id: "rec-rent",
          user_id: "user-1",
          title: "Tiền thuê nhà",
          type: "expense",
          amount: 4_000_000,
          wallet_id: "wallet-low",
          category_id: "cat-net-1",
          frequency: "monthly",
          interval: 1,
          start_date: "2026-05-01",
          next_run_at: "2026-05-01T01:00:00.000Z",
          processing_mode: "auto",
          auto_create: true,
          active: true,
          status: "active",
        },
      ],
    });

    const summary = await processDueRecurringTransactions(
      { userId: "user-1", supabase },
      { now: new Date("2026-05-02T01:00:00.000Z") },
    );

    assert.equal(summary.success, true);
    assert.equal(summary.executedCount, 0);
    assert.equal(summary.failedCount, 1);
    assert.equal(supabase.db.transactions.length, 0);
    assert.equal(supabase.db.recurring_occurrences.length, 1);
    assert.equal(supabase.db.recurring_occurrences[0].status, "failed");
    assert.equal(supabase.db.wallets[0].balance, 100_000);
  });

  it("gracefully falls back when remote Supabase PostgREST schema cache lacks optional RPCs (PGRST202)", async () => {
    resetAiCrudStoresForTests();
    const supabase = createStatefulMockSupabase({
      simulateMissingRpcs: true,
      seedRecurring: [
        {
          id: "rec-fallback-1",
          user_id: "user-1",
          title: "Điện nước hàng tháng",
          type: "expense",
          amount: 150_000,
          wallet_id: "wallet-cash-1",
          category_id: "cat-net-1",
          frequency: "monthly",
          interval: 1,
          start_date: "2026-05-01",
          next_run_at: "2026-05-01T01:00:00.000Z",
          processing_mode: "auto",
          auto_create: true,
          active: true,
          status: "active",
        },
      ],
    });
    const ctx = { userId: "user-1", supabase };

    // 1. Budget creation succeeds via verified table fallback when PGRST202 occurs
    const budProp = await runCrudTurn(
      ctx,
      "Tạo ngân sách Ăn uống 500k mỗi tháng trích từ ví Tiền mặt",
      [],
    );
    assert.ok(budProp.pendingAction);
    const budExec = await executeConfirmedCrudAction(ctx, {
      actionId: budProp.pendingAction.actionId,
      idempotencyKey: budProp.pendingAction.idempotencyKey,
    });
    assert.equal(budExec.success, true);
    assert.equal(supabase.db.budgets.length, 1);
    assert.equal(supabase.db.fund_allocations.length, 1);
    assert.equal(supabase.db.wallets[0].reserved_amount, 500_000);

    // 2. Recurring execution succeeds via verified table fallback when PGRST202 occurs
    const recSummary = await processDueRecurringTransactions(ctx, {
      now: new Date("2026-05-02T01:00:00.000Z"),
    });
    assert.equal(recSummary.success, true);
    assert.equal(recSummary.executedCount, 1);
    assert.equal(supabase.db.transactions.length, 1);
    assert.equal(supabase.db.recurring_occurrences.length, 1);
  });

  it("maps biweekly/quarterly recurring frequencies to legacy DB constraint (23514) automatically", async () => {
    resetAiCrudStoresForTests();
    const supabase = createStatefulMockSupabase({
      simulateLegacyFrequencyCheck: true,
    });
    const ctx = { userId: "user-1", supabase };

    const recProp = await runCrudTurn(
      ctx,
      "Tạo chi tiêu định kỳ Tiền internet 300k 2 tuần 1 lần bằng ví Tiền mặt danh mục Hóa đơn & Tiện ích",
      [],
    );
    assert.ok(recProp.pendingAction);
    const recExec = await executeConfirmedCrudAction(ctx, {
      actionId: recProp.pendingAction.actionId,
      idempotencyKey: recProp.pendingAction.idempotencyKey,
    });
    assert.equal(recExec.success, true);
    assert.equal(supabase.db.recurring_transactions.length, 1);
    assert.equal(supabase.db.recurring_transactions[0].frequency, "weekly");
    assert.equal(supabase.db.recurring_transactions[0].interval, 2);
  });
});
