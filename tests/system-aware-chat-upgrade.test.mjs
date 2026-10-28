/**
 * tests/system-aware-chat-upgrade.test.mjs
 * =========================================
 * Verification Test Suite for Upgraded Financial Copilot & System-Aware Assistant.
 *
 * Covers:
 * 1. 6 Canonical Intents Classification (SYSTEM_HELP, FINANCIAL_QUERY, FINANCIAL_ANALYSIS, FINANCIAL_ADVICE, ACTION_REQUEST, GENERAL_CHAT)
 * 2. 6 Core Real-world Test Scenarios:
 *    - Scenario 1: "Hệ thống có hỗ trợ nhập Excel không?"
 *    - Scenario 2: "Tôi có thể chỉnh sửa giao dịch không?"
 *    - Scenario 3: "Nếu xóa giao dịch, số dư thay đổi như thế nào?"
 *    - Scenario 4: "Xem giao dịch trong tháng này"
 *    - Scenario 5: "Tìm khoản chi tiêu trong một tháng"
 *    - Scenario 6: "Xóa giao dịch này cho tôi"
 * 3. 8 Upgraded Financial & System Tools Registration and Execution
 * 4. Read-Only Guardrails on ACTION_REQUEST
 * 5. Dynamic System Prompt Generation for System Help, List Transactions, and Action Requests
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  routeUserIntent,
  parseTransactionListQuery,
  parseTransactionStatisticsQuery,
} from "../backend/src/services/ai-router.service.ts";

import {
  searchSystemKnowledge,
  SYSTEM_KNOWLEDGE_CHUNKS,
} from "../backend/src/services/system-rag.service.ts";

import {
  FINANCIAL_TOOLS,
  executeFinancialTool,
} from "../backend/src/services/financial-tools.service.ts";

import {
  buildAuthoritativeFinancialSnapshot,
} from "../backend/src/services/financial-snapshot.service.ts";

import {
  buildDynamicSystemPrompt,
} from "../backend/src/services/ai-chat.service.ts";

// =============================================================================
// SUITE 1: 6 CORE REAL-WORLD SCENARIOS
// =============================================================================

test("Scenario 1: 'Hệ thống có hỗ trợ nhập Excel không?' routes to SYSTEM_HELP and retrieves 6-step import guide", () => {
  const query = "Hệ thống có hỗ trợ nhập Excel không?";
  const routing = routeUserIntent(query);

  assert.equal(routing.canonicalIntent, "SYSTEM_HELP");
  assert.equal(routing.primaryIntent, "SYSTEM_KNOWLEDGE");
  assert.equal(routing.requiresPersonalData, false);
  assert.equal(routing.requiresSystemRag, true);

  const rag = searchSystemKnowledge(query);
  assert.ok(rag.length > 0, "Must return at least 1 RAG chunk");
  const topChunk = rag[0];
  assert.equal(topChunk.chunk.id, "kb_excel_csv_import");
  assert.ok(topChunk.chunk.content.toLowerCase().includes("hỗ trợ đầy đủ"), "Must affirm feature support");
  assert.ok(topChunk.chunk.content.includes(".xlsx"), "Must mention xlsx");
  assert.ok(topChunk.chunk.content.includes("Bước 1"), "Must provide step-by-step guide");
});

test("Scenario 2: 'Tôi có thể chỉnh sửa giao dịch không?' routes to SYSTEM_HELP and explains UI edit workflow", () => {
  const query = "Tôi có thể chỉnh sửa giao dịch không?";
  const routing = routeUserIntent(query);

  assert.equal(routing.canonicalIntent, "SYSTEM_HELP");
  assert.equal(routing.primaryIntent, "SYSTEM_KNOWLEDGE");
  assert.equal(routing.requiresPersonalData, false);
  assert.equal(routing.requiresSystemRag, true);

  const rag = searchSystemKnowledge(query);
  assert.ok(rag.length > 0);
  const found = rag.some((r) => r.chunk.id === "kb_transactions_edit_delete");
  assert.ok(found, "Must retrieve kb_transactions_edit_delete chunk");

  const chunk = SYSTEM_KNOWLEDGE_CHUNKS.find((c) => c.id === "kb_transactions_edit_delete");
  assert.ok(chunk);
  assert.ok(chunk.content.includes("Quy trình thao tác trên giao diện") || chunk.content.includes("chỉnh sửa"));
  assert.ok(chunk.content.includes("Trợ lý AI") || chunk.content.includes("CHỈ ĐỌC"));
});

test("Scenario 3: 'Nếu xóa giao dịch, số dư thay đổi như thế nào?' routes to SYSTEM_HELP and explains double-entry ledger rules", () => {
  const query = "Nếu xóa giao dịch, số dư thay đổi như thế nào?";
  const routing = routeUserIntent(query);

  assert.equal(routing.canonicalIntent, "SYSTEM_HELP");
  assert.equal(routing.primaryIntent, "SYSTEM_KNOWLEDGE");
  assert.equal(routing.requiresPersonalData, false);
  assert.equal(routing.requiresSystemRag, true);

  const rag = searchSystemKnowledge(query);
  assert.ok(rag.length > 0);
  const found = rag.some((r) => r.chunk.id === "kb_transactions_edit_delete");
  assert.ok(found, "Must retrieve kb_transactions_edit_delete chunk");

  const chunk = SYSTEM_KNOWLEDGE_CHUNKS.find((c) => c.id === "kb_transactions_edit_delete");
  assert.ok(chunk);
  assert.ok(chunk.content.includes("hoàn tác (revert) số dư ví") || chunk.content.includes("kế toán kép"));
  assert.ok(chunk.content.includes("Nếu xóa khoản CHI (Expense): Số dư của ví thanh toán sẽ TĂNG LẠI"));
  assert.ok(chunk.content.includes("Nếu xóa khoản THU (Income): Số dư của ví nhận tiền sẽ GIẢM ĐI"));
  assert.ok(chunk.content.includes("Nếu xóa giao dịch CHUYỂN TIỀN (Transfer): Hệ thống sẽ hoàn tác cả hai ví"));
});

test("Scenario 4: 'Xem giao dịch trong tháng này' routes to FINANCIAL_QUERY with LIST_TRANSACTIONS category", () => {
  const query = "Xem giao dịch trong tháng này";
  const routing = routeUserIntent(query);

  assert.equal(routing.canonicalIntent, "FINANCIAL_QUERY");
  assert.equal(routing.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(routing.category, "LIST_TRANSACTIONS");
  assert.ok(routing.transactionListQuery);
  assert.equal(routing.transactionListQuery.period, "current_month");
  assert.equal(routing.transactionStatisticsQuery, null, "Must NOT be hijacked by statistics");
});

test("Scenario 5: 'Tìm khoản chi tiêu trong một tháng' routes to FINANCIAL_QUERY with LIST_TRANSACTIONS & type=expense", () => {
  const query = "Tìm khoản chi tiêu trong một tháng";
  const routing = routeUserIntent(query);

  assert.equal(routing.canonicalIntent, "FINANCIAL_QUERY");
  assert.equal(routing.primaryIntent, "PERSONAL_FINANCE");
  assert.equal(routing.category, "LIST_TRANSACTIONS");
  assert.ok(routing.transactionListQuery);
  assert.equal(routing.transactionListQuery.type, "expense");
  assert.equal(routing.extractedAffordability, null, "Must NOT be hijacked by affordability");
  assert.equal(routing.extractedBudgetPlan, null, "Must NOT be hijacked by budget planning");
});

test("Scenario 6: 'Xóa giao dịch này cho tôi' routes to ACTION_REQUEST and enforces read-only guardrails", () => {
  const query = "Xóa giao dịch này cho tôi";
  const routing = routeUserIntent(query);

  assert.equal(routing.canonicalIntent, "ACTION_REQUEST");
  assert.equal(routing.primaryIntent, "ACTION_REQUEST");
  assert.equal(routing.requiresPersonalData, false, "ACTION_REQUEST must not expose user balances");
  assert.equal(routing.requiresSystemRag, true, "ACTION_REQUEST must provide UI steps");

  const prompt = buildDynamicSystemPrompt(routing);
  assert.ok(prompt.includes("CHỈ ĐỌC (Read-Only)"), "Prompt must instruct AI about read-only boundary");
  assert.ok(prompt.includes("TUYỆT ĐỐI KHÔNG tự ý thực hiện"), "Prompt must prohibit direct DB mutations");
  assert.ok(prompt.includes("Hướng dẫn chi tiết từng bước"), "Prompt must guide user to perform on UI");
});

// =============================================================================
// SUITE 2: SYSTEM CAPABILITY AWARENESS & CURRENCY ISOLATION
// =============================================================================

test("System Capability: 'Hệ thống có chuyển đổi VND/USD không?' explains currency isolation rules", () => {
  const query = "Hệ thống có chuyển đổi VND/USD không?";
  const routing = routeUserIntent(query);

  assert.equal(routing.canonicalIntent, "SYSTEM_HELP");
  assert.equal(routing.primaryIntent, "SYSTEM_KNOWLEDGE");

  const rag = searchSystemKnowledge(query);
  assert.ok(rag.length > 0);
  const found = rag.some((r) => r.chunk.id === "kb_currency_isolation");
  assert.ok(found, "Must retrieve kb_currency_isolation chunk");

  const chunk = SYSTEM_KNOWLEDGE_CHUNKS.find((c) => c.id === "kb_currency_isolation");
  assert.ok(chunk);
  assert.ok(chunk.content.includes("CÔ LẬP TIỀN TỆ"));
  assert.ok(chunk.content.includes("Mỗi ví có đơn vị tiền tệ riêng"));
});

// =============================================================================
// SUITE 3: FINANCIAL TOOLS REGISTRY AND DEFINITIONS
// =============================================================================

test("Financial Tools Registry contains all 8 required tools", () => {
  const requiredTools = [
    "get_wallets",
    "get_wallet_balance",
    "list_transactions",
    "get_financial_summary",
    "get_budgets",
    "get_categories",
    "get_system_capabilities",
    "get_feature_instructions",
  ];

  for (const toolName of requiredTools) {
    const tool = FINANCIAL_TOOLS.find((t) => t.function.name === toolName);
    assert.ok(tool, `Tool ${toolName} must be defined in FINANCIAL_TOOLS`);
    assert.ok(tool.function.description.length > 10, `Tool ${toolName} must have description`);
    assert.ok(tool.function.parameters.type === "object", `Tool ${toolName} parameters must be object`);
  }
});

// =============================================================================
// SUITE 4: MOCK EXECUTION OF UPGRADED TOOLS WITH USER ISOLATION
// =============================================================================

test("Tool get_system_capabilities returns overview of system features", async () => {
  const res = await executeFinancialTool("get_system_capabilities", {}, {
    userId: "test-user-123",
  });

  assert.equal(res.success, true);
  assert.ok(res.summaryVi.includes("TỔNG HỢP DANH MỤC CHỨC NĂNG HỆ THỐNG SỔ CHI TIÊU"));
  assert.ok(res.summaryVi.includes("Quản lý Ví"));
  assert.ok(res.summaryVi.includes("Nhập Dữ liệu từ Excel & CSV"));
});

test("Tool get_feature_instructions returns detailed instructions for excel_csv_import", async () => {
  const res = await executeFinancialTool("get_feature_instructions", {
    feature_id: "excel_csv_import",
  }, {
    userId: "test-user-123",
  });

  assert.equal(res.success, true);
  assert.ok(res.summaryVi.includes("HƯỚNG DẪN THAO TÁC: Nhập Dữ liệu từ Excel & CSV"));
  assert.ok(res.summaryVi.includes(".xlsx, .xls") && res.summaryVi.includes(".csv"));
});

test("Tool get_wallets with mock snapshot returns formatted wallet list", async () => {
  const wallets = [
    {
      id: "w1",
      name: "Ví Tiền Mặt",
      type: "cash",
      balance: 1000000,
      reserved_amount: 200000,
      currency: "VND",
    },
    {
      id: "w2",
      name: "Tài khoản Techcombank",
      type: "bank",
      balance: 5000000,
      reserved_amount: 0,
      currency: "VND",
    },
  ];
  const mockSnapshot = buildAuthoritativeFinancialSnapshot(wallets, [], [], [], []);

  const res = await executeFinancialTool("get_wallets", {}, {
    userId: "user-456",
    snapshot: mockSnapshot,
  });

  assert.equal(res.success, true);
  assert.ok(res.summaryVi.includes("Ví Tiền Mặt"));
  assert.ok(res.summaryVi.includes("800.000 VND")); // available balance
  assert.ok(res.summaryVi.includes("Tài khoản Techcombank"));
});

test("Tool list_transactions with mock Supabase formats transaction records properly", async () => {
  const mockTx = [
    {
      id: "tx-1",
      type: "expense",
      amount: 45000,
      title: "Ăn sáng phở bò",
      occurred_at: "2026-10-28T08:00:00.000Z",
      wallet_id: "w1",
      category: "Ăn uống",
      note: "Ăn sáng",
    },
    {
      id: "tx-2",
      type: "expense",
      amount: 150000,
      title: "Mua sách kỹ năng",
      occurred_at: "2026-10-27T14:30:00.000Z",
      wallet_id: "w2",
      category: "Phát triển bản thân",
      note: "Sách",
    },
  ];

  function createMockChain(data) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: () => chain,
      lt: () => chain,
      ilike: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data, error: null }),
      then: (resolve) => resolve({ data, error: null }),
    };
    return chain;
  }

  const mockSupabase = {
    from: (table) => {
      if (table === "wallets") {
        return createMockChain([
          { id: "w1", name: "Ví Tiền Mặt", currency: "VND" },
          { id: "w2", name: "Tài khoản Techcombank", currency: "VND" },
        ]);
      }
      return createMockChain(mockTx);
    },
  };

  const res = await executeFinancialTool("list_transactions", {
    period: "current_month",
    type: "expense",
  }, {
    userId: "user-789",
    client: mockSupabase,
  });

  assert.equal(res.success, true);
  assert.ok(res.summaryVi.includes("DANH SÁCH GIAO DỊCH"));
  assert.ok(res.summaryVi.includes("Ăn sáng phở bò"));
  assert.ok(res.summaryVi.includes("45.000 VND"));
  assert.ok(res.summaryVi.includes("Mua sách kỹ năng"));
});

// =============================================================================
// SUITE 5: PARSER BEHAVIOR VERIFICATION
// =============================================================================

test("parseTransactionListQuery correctly distinguishes listing from counting", () => {
  // Queries asking for count or stats must return null (handled by statistics parser)
  assert.equal(parseTransactionListQuery("Tháng này tôi có bao nhiêu giao dịch?"), null);
  assert.equal(parseTransactionListQuery("Đếm số giao dịch ăn uống"), null);
  assert.equal(parseTransactionListQuery("Tổng số khoản chi tháng này"), null);

  // Queries asking to view or list must return query params
  const q1 = parseTransactionListQuery("Xem các giao dịch trong tháng này");
  assert.ok(q1);
  assert.equal(q1.period, "current_month");

  const q2 = parseTransactionListQuery("Liệt kê các khoản chi tiêu tháng trước");
  assert.ok(q2);
  assert.equal(q2.period, "previous_month");
  assert.equal(q2.type, "expense");

  const q3 = parseTransactionListQuery("Cho tôi xem danh sách khoản thu nhập");
  assert.ok(q3);
  assert.equal(q3.type, "income");
});

test("parseTransactionStatisticsQuery does NOT hijack listing queries without count words", () => {
  const stats1 = parseTransactionStatisticsQuery("Xem giao dịch trong tháng này");
  assert.equal(stats1, null, "Should NOT match pure list query");

  const stats2 = parseTransactionStatisticsQuery("Có bao nhiêu giao dịch trong tháng này?");
  assert.ok(stats2, "Should match query with explicit count keyword");
});
