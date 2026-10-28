/**
 * backend/src/services/ai-crud-tools.service.ts
 * ==============================================
 * Authorized AI CRUD Tooling, Validation, Confirmation & Idempotency Service.
 *
 * Supports natural language & tool/function-calling creation of:
 * 1. Categories (`categories` — income / expense)
 * 2. Budgets (`budgets` via existing RPC `public.create_budget_with_allocation`)
 * 3. Transactions (`transactions` — income / expense with wallet balance & currency guards)
 * 4. Recurring Transactions (`recurring_transactions` with Asia/Ho_Chi_Minh scheduling)
 *
 * Safety & Integrity Guarantees:
 * - Reuses existing DB RPCs, triggers, `parseSmartTransaction`, `parseVietnameseAmount`,
 *   and `detectDuplicateTransaction`.
 * - Never invents missing mandatory fields: asks clarifying questions instead.
 * - Requires user confirmation BEFORE writing financial/recurring mutations (`create_budget`,
 *   `create_transaction`, `create_recurring_transaction`).
 * - Enforces authentication, `user_id` ownership, input validation, and multi-layer idempotency.
 * - Reports creation success ONLY after Supabase confirms persistence.
 */

import { createClient } from "@supabase/supabase-js";
import type {
  ActionSummaryField,
  ChatMessage,
  CrudActionType,
  ExecutedCrudActionResult,
  PendingCrudActionProposal,
  RefreshTarget,
} from "../types/ai.types.ts";
import type {
  Category,
  Frequency,
  Transaction,
  TransactionType,
  Wallet,
} from "../../../frontend/types/finance.types.ts";
import {
  parseSmartTransaction,
  parseVietnameseAmount,
  removeAccents,
} from "../../../frontend/utils/smart-parser.ts";
import { detectDuplicateTransaction } from "../../../frontend/services/duplicate-detection.service.ts";
import type { OllamaToolDefinition, OllamaToolCall } from "./ollama-client.ts";
import type { ToolExecutionContext } from "./financial-tools.service.ts";
import { invalidateUserFinancialCache } from "./financial-cache.service.ts";
import { buildAuthoritativeFinancialSnapshot } from "./financial-snapshot.service.ts";
import {
  computeInitialRecurringSchedule,
  DEFAULT_RECURRING_TIMEZONE,
  formatLocalDateKey,
  getFrequencyLabelVi,
  isValidFrequency,
  processDueRecurringTransactions,
} from "./recurring-scheduler.service.ts";

const MAX_SAFE_MONEY = 1_000_000_000_000_000;
const PENDING_ACTION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SLOT_DRAFT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour
const FINGERPRINT_DEDUP_MS = 60 * 1000; // 60 seconds rapid-retry window

// ---------------------------------------------------------------------------
// Formal Tool / Function Calling Schemas for LLM Integration
// ---------------------------------------------------------------------------

export const CRUD_ACTION_TOOLS: OllamaToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "create_category",
      description:
        "Tạo danh mục thu nhập (income) hoặc chi tiêu (expense) mới cho người dùng khi đã có đủ tên danh mục và loại thu/chi.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên danh mục cụ thể do người dùng cung cấp (1-80 ký tự).",
          },
          kind: {
            type: "string",
            description: "Loại danh mục: 'expense' (Chi tiêu) hoặc 'income' (Thu nhập).",
            enum: ["expense", "income"],
          },
          color: {
            type: "string",
            description: "Mã màu HEX tùy chọn (ví dụ: #3B82F6).",
          },
          icon: {
            type: "string",
            description: "Biểu tượng danh mục tùy chọn.",
          },
          parent_category_name: {
            type: "string",
            description: "Tên danh mục cha nếu tạo danh mục con.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_budget",
      description:
        "Đề xuất tạo ngân sách mới (theo dõi hạn mức hoặc cấp vốn phong bì từ ví) qua RPC create_budget_with_allocation. Yêu cầu xác nhận từ người dùng trước khi ghi DB.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên ngân sách (nếu người dùng đặt tên riêng).",
          },
          category_name: {
            type: "string",
            description: "Tên danh mục chi tiêu áp dụng ngân sách (ví dụ: 'Ăn uống', 'Di chuyển').",
          },
          amount: {
            type: "number",
            description: "Hạn mức số tiền ngân sách (> 0) do người dùng nêu rõ.",
          },
          period: {
            type: "string",
            description: "Chu kỳ ngân sách: 'weekly' (tuần), 'monthly' (tháng), hoặc 'yearly' (năm).",
            enum: ["weekly", "monthly", "yearly"],
          },
          source_wallet_name: {
            type: "string",
            description: "Tên ví nguồn nếu người dùng yêu cầu trích quỹ phong bì từ ví.",
          },
          alert_percent: {
            type: "number",
            description: "Ngưỡng phần trăm cảnh báo (1-100, mặc định 80).",
          },
          period_start: {
            type: "string",
            description: "Ngày bắt đầu chu kỳ (YYYY-MM-DD).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_transaction",
      description:
        "Đề xuất tạo giao dịch thu nhập hoặc chi tiêu mới. Yêu cầu xác nhận từ người dùng trước khi ghi DB.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Tên / mô tả giao dịch (ví dụ: 'Ăn trưa phở bò', 'Nhận lương tháng 10').",
          },
          amount: {
            type: "number",
            description: "Số tiền giao dịch (> 0) do người dùng cung cấp.",
          },
          type: {
            type: "string",
            description: "Loại giao dịch: 'expense' (Chi tiêu) hoặc 'income' (Thu nhập).",
            enum: ["expense", "income"],
          },
          currency: {
            type: "string",
            description: "Đơn vị tiền tệ ('VND' hoặc 'USD').",
          },
          category_name: {
            type: "string",
            description: "Tên danh mục thu/chi.",
          },
          wallet_name: {
            type: "string",
            description: "Tên ví thanh toán hoặc nhận tiền.",
          },
          occurred_at: {
            type: "string",
            description: "Ngày phát sinh giao dịch (YYYY-MM-DD).",
          },
          note: {
            type: "string",
            description: "Ghi chú bổ sung nếu có.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_recurring_transaction",
      description:
        "Đề xuất tạo lịch giao dịch định kỳ tự động hoặc nhắc nhở (hàng ngày, tuần, tháng, quý, năm). Yêu cầu xác nhận từ người dùng trước khi ghi DB.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Tên khoản thu/chi định kỳ (ví dụ: 'Tiền thuê nhà', 'Tiền Internet').",
          },
          amount: {
            type: "number",
            description: "Số tiền mỗi kỳ (> 0) do người dùng cung cấp.",
          },
          type: {
            type: "string",
            description: "Loại giao dịch: 'expense' (Chi tiêu) hoặc 'income' (Thu nhập).",
            enum: ["expense", "income"],
          },
          frequency: {
            type: "string",
            description:
              "Tần suất lặp: 'daily', 'weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'semi-annually', 'yearly'.",
            enum: [
              "daily",
              "weekly",
              "biweekly",
              "monthly",
              "bimonthly",
              "quarterly",
              "semi-annually",
              "yearly",
            ],
          },
          interval: {
            type: "number",
            description: "Khoảng cách chu kỳ (mặc định 1).",
          },
          day_of_month: {
            type: "number",
            description: "Ngày chạy trong tháng (1-31) nếu lặp theo tháng.",
          },
          day_of_week: {
            type: "number",
            description: "Thứ trong tuần (0=CN, 1=Thứ 2 ... 6=Thứ 7) nếu lặp theo tuần.",
          },
          start_date: {
            type: "string",
            description: "Ngày bắt đầu (YYYY-MM-DD).",
          },
          wallet_name: {
            type: "string",
            description: "Tên ví thanh toán hoặc nhận tiền định kỳ.",
          },
          category_name: {
            type: "string",
            description: "Tên danh mục thu/chi.",
          },
          processing_mode: {
            type: "string",
            description: "'auto' (tự động ghi nhận khi đến hạn) hoặc 'remind' (chỉ nhắc nhở).",
            enum: ["auto", "remind"],
          },
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Per-User Stores: Pending Confirmations, Multi-Turn Slot Drafts, Idempotency
// ---------------------------------------------------------------------------

interface StoredPendingAction {
  userId: string;
  proposal: PendingCrudActionProposal;
  fingerprint: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: "pending" | "confirmed" | "cancelled";
  executedResult?: ExecutedCrudActionResult;
  executedReply?: string;
}

interface StoredSlotDraft {
  userId: string;
  actionType: CrudActionType;
  slots: Record<string, unknown>;
  missingFields: string[];
  rawTexts: string[];
  updatedAtMs: number;
  expiresAtMs: number;
}

interface StoredIdempotencyRecord {
  userId: string;
  idempotencyKey: string;
  fingerprint: string;
  result: ExecutedCrudActionResult;
  reply: string;
  createdAtMs: number;
  expiresAtMs: number;
}

const pendingActionsById = new Map<string, StoredPendingAction>();
const latestPendingActionByUser = new Map<string, string>();
const slotDraftByUser = new Map<string, StoredSlotDraft>();
const idempotencyStore = new Map<string, StoredIdempotencyRecord>();
const fingerprintStore = new Map<string, StoredIdempotencyRecord>();
const inFlightExecutionKeys = new Set<string>();

function pruneExpiredStores(nowMs = Date.now()): void {
  for (const [id, entry] of pendingActionsById.entries()) {
    if (nowMs > entry.expiresAtMs) {
      pendingActionsById.delete(id);
      if (latestPendingActionByUser.get(entry.userId) === id) {
        latestPendingActionByUser.delete(entry.userId);
      }
    }
  }
  for (const [uid, draft] of slotDraftByUser.entries()) {
    if (nowMs > draft.expiresAtMs) {
      slotDraftByUser.delete(uid);
    }
  }
  for (const [key, rec] of idempotencyStore.entries()) {
    if (nowMs > rec.expiresAtMs) {
      idempotencyStore.delete(key);
    }
  }
  for (const [fp, rec] of fingerprintStore.entries()) {
    if (nowMs - rec.createdAtMs > FINGERPRINT_DEDUP_MS) {
      fingerprintStore.delete(fp);
    }
  }
}

export function clearCrudActionStateForTesting(userId?: string): void {
  if (!userId) {
    pendingActionsById.clear();
    latestPendingActionByUser.clear();
    slotDraftByUser.clear();
    idempotencyStore.clear();
    fingerprintStore.clear();
    inFlightExecutionKeys.clear();
    return;
  }
  const latestId = latestPendingActionByUser.get(userId);
  if (latestId) pendingActionsById.delete(latestId);
  latestPendingActionByUser.delete(userId);
  slotDraftByUser.delete(userId);
}

export function getLatestPendingActionForUser(userId: string): PendingCrudActionProposal | null {
  pruneExpiredStores();
  const id = latestPendingActionByUser.get(userId);
  if (!id) return null;
  const stored = pendingActionsById.get(id);
  if (!stored || stored.userId !== userId || stored.status !== "pending") return null;
  return stored.proposal;
}

function generateId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function normalizeLookup(text: string): string {
  return removeAccents(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMoneyVi(amount: number, currency = "VND"): string {
  if (currency === "USD") {
    return `${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD`;
  }
  return `${Math.round(amount).toLocaleString("vi-VN")} ${currency}`;
}

function getSupabaseForContext(ctx: ToolExecutionContext) {
  if (ctx.supabase) return ctx.supabase;
  if (ctx.client) return ctx.client;
  if (!ctx.supabaseUrl || !ctx.supabaseKey || !ctx.token) {
    throw new Error("AUTH_REQUIRED:Vui lòng đăng nhập để thực hiện thao tác này.");
  }
  return createClient(ctx.supabaseUrl, ctx.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${ctx.token}` } },
  });
}

// ---------------------------------------------------------------------------
// Intent Detection for Permitted CRUD Actions vs Confirmations vs Questions
// ---------------------------------------------------------------------------

export type CrudIntentKind =
  | "CRUD_CREATE"
  | "CONFIRM_PENDING"
  | "CANCEL_PENDING"
  | "SLOT_FILL_FOLLOWUP";

export interface DetectedCrudIntent {
  kind: CrudIntentKind;
  actionType?: CrudActionType;
  actionIdFromText?: string;
}

const HOW_TO_OR_QUESTION_EXCLUSIONS = [
  /(?:làm sao|làm thế nào|hướng dẫn|cách|quy trình)\s+(?:để\s+)?(?:tạo|thêm|lập|ghi|cài|thiết lập)/i,
  /(?:lam sao|lam the nao|huong dan|cach|quy trinh)\s+(?:de\s+)?(?:tao|them|lap|ghi|cai|thiet lap)/i,
  /(?:tạo|thêm|lập)\s+(?:danh mục|ngân sách|giao dịch|lịch định kỳ).*(?:ở đâu|như thế nào|ra sao|thế nào)/i,
  /(?:hệ thống|app|ứng dụng|bạn)\s+có\s+(?:hỗ trợ|cho phép|thể)\s+(?:tạo|thêm|lập)/i,
  /(?:tôi\s+)?có\s+(?:nên|đủ\s+tiền)\s+/i,
  /(?:nếu|giả sử)\s+(?:tôi\s+)?(?:mua|chi|tiêu|tạo|xóa)/i,
  /(?:xem|liệt kê|danh sách|tìm|lọc|thống kê|đếm|bao nhiêu)\s+(?:các\s+)?(?:giao dịch|danh mục|ngân sách)/i,
];

const DESTRUCTIVE_ACTION_EXCLUSIONS = [
  /(?:^|\s)(?:xóa|xoá|delete|gỡ bỏ|xóa bỏ)\s+(?:giao dịch|khoản chi|khoản thu|ví|ngân sách|danh mục|dữ liệu|lịch định kỳ)/i,
  /(?:^|\s)(?:xoa|go bo|xoa bo)\s+(?:giao dich|khoan chi|khoan thu|vi|ngan sach|danh muc|du lieu)/i,
  /(?:^|\s)(?:sửa|chỉnh sửa|cập nhật|đổi)\s+(?:số dư\s+ví|giao dịch|ngân sách)/i,
];

function extractActionIdFromHistory(history: ChatMessage[]): {
  actionId?: string;
  actionType?: CrudActionType;
  isAwaitingSlotFill?: CrudActionType;
} {
  for (let i = history.length - 1; i >= Math.max(0, history.length - 4); i--) {
    const rawMsg = history[i] as unknown as {
      role?: string;
      parts?: Array<{ text?: string }>;
      content?: string;
    };
    if (rawMsg.role !== "model" && rawMsg.role !== "assistant") continue;
    const text = rawMsg.parts?.[0]?.text || rawMsg.content || "";

    const confirmMatch = text.match(/\[Mã xác nhận:\s*(act_[a-z0-9_]+)\s*\|\s*(create_[a-z_]+)\]/i);
    if (confirmMatch) {
      return {
        actionId: confirmMatch[1],
        actionType: confirmMatch[2] as CrudActionType,
      };
    }

    const slotMarker = text.match(/\[Đang bổ sung thông tin:\s*(create_[a-z_]+)\]/i);
    if (slotMarker) {
      return {
        isAwaitingSlotFill: slotMarker[1] as CrudActionType,
      };
    }

    if (/vui lòng cho biết thêm|bạn muốn đặt hạn mức|thuộc nhóm \*\*Chi tiêu\*\* hay \*\*Thu nhập\*\*/i.test(text)) {
      if (/danh mục/i.test(text)) return { isAwaitingSlotFill: "create_category" };
      if (/ngân sách/i.test(text)) return { isAwaitingSlotFill: "create_budget" };
      if (/định kỳ/i.test(text)) return { isAwaitingSlotFill: "create_recurring_transaction" };
      if (/giao dịch|khoản chi|khoản thu/i.test(text)) return { isAwaitingSlotFill: "create_transaction" };
    }
  }
  return {};
}

export function detectPermittedCrudIntent(
  rawMessage: string,
  history: ChatMessage[] = [],
  userId?: string,
): DetectedCrudIntent | null {
  pruneExpiredStores();
  const text = rawMessage.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const unaccented = removeAccents(lower);

  // Exclude explicit system how-to questions, hypothetical questions, or destructive commands
  if (DESTRUCTIVE_ACTION_EXCLUSIONS.some((p) => p.test(lower) || p.test(unaccented))) {
    return null;
  }
  if (HOW_TO_OR_QUESTION_EXCLUSIONS.some((p) => p.test(lower) || p.test(unaccented))) {
    return null;
  }

  const historyMeta = extractActionIdFromHistory(history);
  const activePending = userId ? getLatestPendingActionForUser(userId) : null;
  const activeSlotDraft = userId ? slotDraftByUser.get(userId) : undefined;

  // 1. Check Confirmation / Cancellation against active pending action
  const isConfirmPhrase =
    /^(?:xác nhận|xac nhan|đồng ý|dong y|ok|oke|okay|đồng ý tạo|xác nhận tạo|xác nhận thực hiện|thực hiện đi|tạo đi|tao di|lưu đi|luu di|chốt|đúng rồi|yes|confirm)(?:[.!,\s].*)?$/i.test(
      lower,
    ) ||
    /^(?:xac nhan|dong y|xac nhan tao|xac nhan thuc hien|thuc hien di|tao di|luu di|dung roi)$/i.test(
      unaccented,
    );

  const isCancelPhrase =
    /^(?:hủy|huỷ|hủy bỏ|huy bo|huy|không tạo nữa|khong tao nua|thôi|bỏ qua|cancel|không đồng ý)(?:[.!,\s].*)?$/i.test(
      lower,
    );

  if (isCancelPhrase && (activePending || historyMeta.actionId || activeSlotDraft || historyMeta.isAwaitingSlotFill)) {
    return {
      kind: "CANCEL_PENDING",
      actionIdFromText: activePending?.actionId || historyMeta.actionId,
      actionType:
        activePending?.actionType ||
        historyMeta.actionType ||
        activeSlotDraft?.actionType ||
        historyMeta.isAwaitingSlotFill,
    };
  }

  if (isConfirmPhrase && (activePending || historyMeta.actionId)) {
    return {
      kind: "CONFIRM_PENDING",
      actionIdFromText: activePending?.actionId || historyMeta.actionId,
      actionType: activePending?.actionType || historyMeta.actionType,
    };
  }

  // 2. Explicit Create Category
  const isCreateCategory =
    /(?:tạo|thêm|lập|mở)\s+(?:mới\s+)?(?:một\s+)?(?:danh mục|nhóm\s+chi\s+tiêu|nhóm\s+thu\s+nhập|phân\s+loại\s+thu\s+chi)/i.test(
      lower,
    ) ||
    /(?:tao|them|lap)\s+(?:moi\s+)?(?:mot\s+)?(?:danh muc|nhom chi tieu|nhom thu nhap)/i.test(
      unaccented,
    );
  if (isCreateCategory) {
    return { kind: "CRUD_CREATE", actionType: "create_category" };
  }

  // 3. Explicit Create Recurring Transaction (check BEFORE regular transaction & budget!)
  const hasRecurringKeyword =
    /định kỳ|lặp lại|tự động\s+hàng\s+(?:ngày|tuần|tháng|quý|năm)|mỗi\s+(?:ngày|tuần|tháng|quý|năm)\s+vào\s+ngày|vào\s+ngày\s+\d{1,2}\s+(?:hàng|mỗi)\s+tháng/i.test(
      lower,
    ) ||
    /dinh ky|lap lai|vao ngay \d{1,2} (?:hang|moi) thang/i.test(unaccented);

  const hasCreateVerb =
    /(?:tạo|thêm|lập|đặt|cài|cài đặt|thiết lập|ghi|ghi nhận|lưu)\b/i.test(lower) ||
    /(?:tao|them|lap|dat|cai|cai dat|thiet lap|ghi|ghi nhan|luu)\b/i.test(unaccented);

  if (
    /(?:tạo|thêm|lập|đặt|cài|thiết lập|ghi nhận)\s+(?:mới\s+)?(?:một\s+)?(?:giao dịch|khoản chi|khoản thu|lịch|chi tiêu|thu nhập)?\s*định kỳ/i.test(
      lower,
    ) ||
    /(?:tao|them|lap|dat|cai|thiet lap|ghi nhan)\s+(?:moi\s+)?(?:mot\s+)?(?:giao dich|khoan chi|khoan thu|lich|chi tieu|thu nhap)?\s*dinh ky/i.test(
      unaccented,
    ) ||
    (hasCreateVerb &&
      hasRecurringKeyword &&
      !/ngân sách|ngan sach|danh mục|danh muc/i.test(lower))
  ) {
    return { kind: "CRUD_CREATE", actionType: "create_recurring_transaction" };
  }

  // 4. Explicit Create Budget
  const isCreateBudget =
    /(?:tạo|thêm|lập|đặt|cài|thiết lập)\s+(?:mới\s+)?(?:một\s+)?(?:hạn mức\s+)?ngân sách/i.test(
      lower,
    ) ||
    /(?:tao|them|lap|dat|cai|thiet lap)\s+(?:moi\s+)?(?:mot\s+)?(?:han muc\s+)?ngan sach/i.test(
      unaccented,
    );
  if (isCreateBudget) {
    return { kind: "CRUD_CREATE", actionType: "create_budget" };
  }

  // 5. Explicit Create Transaction
  const isCreateTransaction =
    /(?:tạo|thêm|ghi|ghi nhận|lưu|nhập)\s+(?:giúp\s+tôi\s+|cho\s+tôi\s+|mới\s+|một\s+)*(?:giao dịch|khoản chi|khoản thu|chi tiêu|thu nhập)\b/i.test(
      lower,
    ) ||
    /(?:tao|them|ghi|ghi nhan|luu)\s+(?:giup\s+toi\s+|cho\s+toi\s+|moi\s+|mot\s+)*(?:giao dich|khoan chi|khoan thu|chi tieu|thu nhap)\b/i.test(
      unaccented,
    );
  if (isCreateTransaction) {
    return { kind: "CRUD_CREATE", actionType: "create_transaction" };
  }

  // 6. Multi-turn Slot-Filling Follow-up (only if awaiting slots AND user message is not a question)
  const pendingDraftType = activeSlotDraft?.actionType || historyMeta.isAwaitingSlotFill;
  const looksLikeQuestion =
    /\?$/.test(text) ||
    /^(?:tôi có|cho tôi biết|hãy cho biết|tổng|số dư|ai là|ngân sách của tôi|tháng này tôi|làm sao|hệ thống)/i.test(
      lower,
    );

  if (pendingDraftType && !looksLikeQuestion) {
    return {
      kind: "SLOT_FILL_FOLLOWUP",
      actionType: pendingDraftType,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Deterministic Vietnamese Slot Extractors + Anti-Hallucination Validators
// ---------------------------------------------------------------------------

function pickCategoryIconAndColor(name: string, kind: "expense" | "income"): { icon: string; color: string } {
  const norm = normalizeLookup(name);
  if (kind === "income") {
    if (/luong|salary/.test(norm)) return { icon: "briefcase", color: "#10B981" };
    if (/thuong|bonus|hoa hong/.test(norm)) return { icon: "award", color: "#22C55E" };
    if (/dau tu|co tuc|lai/.test(norm)) return { icon: "trending-up", color: "#06B6D4" };
    return { icon: "wallet", color: "#10B981" };
  }
  if (/an|uong|ca phe|cafe|tra sua|nha hang/.test(norm)) return { icon: "utensils", color: "#F59E0B" };
  if (/di chuyen|xang|xe|grab|taxi|du lich/.test(norm)) return { icon: "car", color: "#3B82F6" };
  if (/mua sam|quan ao|my pham|shopping/.test(norm)) return { icon: "shopping-bag", color: "#EC4899" };
  if (/nha|dien|nuoc|internet|wifi|hoa don/.test(norm)) return { icon: "home", color: "#6366F1" };
  if (/suc khoe|thuoc|y te|gym|the thao/.test(norm)) return { icon: "heart", color: "#EF4444" };
  if (/hoc|sach|giao duc|khoa hoc/.test(norm)) return { icon: "book", color: "#8B5CF6" };
  if (/thu cung|cho|meo|pet/.test(norm)) return { icon: "smile", color: "#F97316" };
  return { icon: "tag", color: "#3B82F6" };
}

export function extractCategorySlotsFromText(rawText: string): {
  name?: string;
  kind?: "expense" | "income";
  color?: string;
  parentCategoryName?: string;
} {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const unaccented = removeAccents(lower);

  let kind: "expense" | "income" | undefined;
  const hasExplicitShortKindPrefix = /\b(?:danh\s+mục|nhóm|loại)\s+(?:chi|thu)\s+/i.test(lower);
  const hasExpenseKw =
    /\b(?:chi tiêu|khoản chi|loại chi|nhóm chi|danh mục chi|chi phí|expense)\b/i.test(lower) ||
    /\b(?:chi tieu|khoan chi|chi phi|expense)\b/i.test(unaccented) ||
    /^(?:chi|chi tiêu|khoản chi|chi tieu|khoan chi)$/i.test(lower);
  const hasIncomeKw =
    /\b(?:thu nhập|khoản thu|loại thu|nhóm thu|danh mục thu|income)\b/i.test(lower) ||
    /\b(?:thu nhap|khoan thu|income)\b/i.test(unaccented) ||
    /^(?:thu|thu nhập|khoản thu|thu nhap|khoan thu)$/i.test(lower);

  if (hasExpenseKw && !hasIncomeKw) kind = "expense";
  else if (hasIncomeKw && !hasExpenseKw) kind = "income";

  const colorMatch = text.match(/#[0-9a-fA-F]{6}\b/);
  const color = colorMatch ? colorMatch[0].toUpperCase() : undefined;

  let parentCategoryName: string | undefined;
  const parentMatch = text.match(/(?:thuộc\s+danh\s+mục\s+cha|danh\s+mục\s+con\s+của)\s+["“']?([^"”',.?!]+)["”']?/i);
  if (parentMatch) {
    parentCategoryName = parentMatch[1].trim();
  }

  // Extract explicit quoted name first
  let name: string | undefined;
  const quotedMatch = text.match(/["“'«]([^"”'»]{1,80})["”'»]/);
  if (quotedMatch) {
    name = quotedMatch[1].trim();
  } else {
    // Pattern: "... tên là <X>" or "tạo danh mục [chi tiêu|thu nhập|chi|thu] <X>"
    const namedMatch = text.match(/(?:tên\s+là|có\s+tên\s+là|tên)\s+([^,.?!]+)$/i);
    if (namedMatch) {
      name = namedMatch[1].trim();
    } else {
      let cleaned = text
        .replace(/^(?:hãy\s+|vui lòng\s+|giúp\s+tôi\s+|cho\s+tôi\s+|bạn\s+hãy\s+)*/i, "")
        .replace(
          /^(?:tạo|thêm|lập|mở|tao|them|lap)\s+(?:giúp\s+tôi\s+|cho\s+tôi\s+)?(?:mới\s+)?(?:một\s+)?(?:danh\s+mục|danh\s+muc|nhóm|nhom|phân\s+loại)\s*/i,
          "",
        )
        .replace(/^(?:chi\s+tiêu|thu\s+nhập|chi\s+tieu|thu\s+nhap|khoản\s+chi|khoản\s+thu)\s+/i, "");
      if (hasExplicitShortKindPrefix) {
        cleaned = cleaned.replace(/^(?:chi|thu)\s+/i, "");
      }
      cleaned = cleaned
        .replace(/^(?:mới\s+|tên\s+là\s+|là\s+|cho\s+(?!tôi\b))*/i, "")
        .replace(/(?:\s+thuộc\s+(?:loại|nhóm)\s+(?:chi\s+tiêu|thu\s+nhập|chi|thu)).*$/i, "")
        .replace(/(?:\s+loại\s+(?:chi\s+tiêu|thu\s+nhập|chi|thu)).*$/i, "")
        .replace(/(?:\s+thuộc\s+danh\s+mục\s+cha\s+.*)$/i, "")
        .replace(/(?:\s+danh\s+mục\s+con\s+của\s+.*)$/i, "")
        .replace(/\s+màu\s+#[0-9a-fA-F]{6}\b/i, "")
        .replace(/\s+(?:cho\s+tôi|giúp\s+tôi|hộ\s+tôi|nhé|nha|đi|với)\s*[.?!]*$/i, "")
        .replace(/[.?!]+$/, "")
        .trim();

      // Reject generic non-names
      const genericReject =
        /^(?:mới|moi|chi|thu|chi tiêu|thu nhập|chi tieu|thu nhap|cho tôi|giúp tôi|danh mục|danh muc|khác)$/i.test(
          cleaned,
        );
      if (cleaned && !genericReject && cleaned.length <= 80) {
        name = cleaned;
      }
    }
  }

  if (name) {
    name = name.replace(/\s+(?:cho\s+tôi|giúp\s+tôi|hộ\s+tôi|nhé|nha)\s*$/i, "").trim();
    if (name.length > 0) {
      name = name.charAt(0).toUpperCase() + name.slice(1);
    }
  }

  return { name: name || undefined, kind, color, parentCategoryName };
}

export function extractBudgetSlotsFromText(rawText: string): {
  amount?: number;
  currency?: string;
  period?: "weekly" | "monthly" | "yearly";
  categoryHint?: string;
  explicitName?: string;
  sourceWalletHint?: string;
  alertPercent?: number;
  periodStart?: string;
} {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const unaccented = removeAccents(lower);

  // Extract alert percent first so it doesn't confuse amount parsing
  let alertPercent: number | undefined;
  const alertMatch = text.match(/(?:cảnh báo|canh bao|ngưỡng)\s*(?:ở mức\s*|khi đạt\s*)?(\d{1,3})\s*%/i);
  if (alertMatch) {
    const pct = Number.parseInt(alertMatch[1], 10);
    if (pct >= 1 && pct <= 100) alertPercent = pct;
  }

  const textWithoutPercent = text.replace(/\d{1,3}\s*%/g, " ");
  const amtParsed = parseVietnameseAmount(textWithoutPercent);
  let amount = amtParsed.amount && amtParsed.amount > 0 ? amtParsed.amount : undefined;
  // Also accept raw digits >= 1000 when user replies in slot-filling e.g. "3000000"
  if (!amount) {
    const plainNum = textWithoutPercent.match(/\b(\d{4,12})\b/);
    if (plainNum) {
      const n = Number(plainNum[1]);
      if (n > 0) amount = n;
    }
  }

  let period: "weekly" | "monthly" | "yearly" | undefined;
  if (
    /\b(?:hàng tuần|mỗi tuần|tuần này|theo tuần|1 tuần|một tuần|weekly)\b|\/\s*tuần\b/i.test(lower) ||
    /\b(?:hang tuan|moi tuan|tuan nay|theo tuan|weekly)\b|\/\s*tuan\b/i.test(unaccented) ||
    /^tuần$/i.test(lower) ||
    /^tuan$/i.test(unaccented)
  ) {
    period = "weekly";
  } else if (
    /\b(?:hàng tháng|mỗi tháng|tháng này|theo tháng|trong tháng|1 tháng|một tháng|tháng\s+\d{1,2}|monthly)\b|\/\s*tháng\b/i.test(
      lower,
    ) ||
    /\b(?:hang thang|moi thang|thang nay|theo thang|trong thang|thang\s+\d{1,2}|monthly)\b|\/\s*thang\b/i.test(
      unaccented,
    ) ||
    /^tháng$/i.test(lower) ||
    /^thang$/i.test(unaccented)
  ) {
    period = "monthly";
  } else if (
    /\b(?:hàng năm|mỗi năm|năm nay|theo năm|1 năm|một năm|yearly)\b|\/\s*năm\b/i.test(lower) ||
    /\b(?:hang nam|moi nam|nam nay|theo nam|yearly)\b|\/\s*nam\b/i.test(unaccented) ||
    /^năm$/i.test(lower) ||
    /^nam$/i.test(unaccented)
  ) {
    period = "yearly";
  }

  // Envelope funding wallet hint ONLY if user explicitly mentions funding/extracting from a wallet
  let sourceWalletHint: string | undefined;
  const walletMatch = text.match(
    /(?:trích\s+(?:quỹ\s+)?từ(?:\s+ví)?|cấp\s+vốn\s+từ(?:\s+ví)?|nguồn\s+từ(?:\s+ví)?|lấy\s+từ(?:\s+ví)?|từ\s+ví|bằng\s+ví)\s+([^,.?!]+?)(?=\s+(?:theo|hàng|mỗi|chu kỳ|cảnh báo|bắt đầu)|[.?!]|$)/i,
  );
  if (walletMatch) {
    sourceWalletHint = walletMatch[1].replace(/^ví\s+/i, "").trim();
  }

  // Extract explicit quoted name if present
  let explicitName: string | undefined;
  const quoted = text.match(/["“']([^"”']{2,100})["”']/);
  if (quoted) {
    explicitName = quoted[1].trim();
  }

  // Extract category / subject hint
  let categoryHint = text;
  if (amtParsed.matchedStr) {
    categoryHint = categoryHint.replace(amtParsed.matchedStr, " ");
  }
  categoryHint = categoryHint
    .replace(/^(?:hãy\s+|vui lòng\s+|giúp\s+tôi\s+|cho\s+tôi\s+)*/i, "")
    .replace(
      /^(?:tạo|thêm|lập|đặt|cài|thiết lập|tao|them|lap|dat|cai|thiet lap)\s+(?:mới\s+)?(?:một\s+)?(?:hạn\s+mức\s+)?(?:ngân\s+sách|ngan\s+sach)\s*/i,
      "",
    )
    .replace(/^(?:cho\s+danh\s+mục|danh\s+mục|cho\s+việc|cho|mục)\s+/i, "")
    .replace(/(?:trích\s+(?:quỹ\s+)?từ\s+ví|trích\s+từ|cấp\s+vốn\s+từ|nguồn\s+từ\s+ví|lấy\s+từ\s+ví|từ\s+ví|bằng\s+ví)\s+[^,.?!]+/gi, " ")
    .replace(/(?:hạn\s+mức|với\s+số\s+tiền|số\s+tiền|là|ở\s+mức)\b/gi, " ")
    .replace(
      /\b(?:hàng\s+tuần|mỗi\s+tuần|tuần\s+này|theo\s+tuần|hàng\s+tháng|mỗi\s+tháng|tháng\s+này|theo\s+tháng|trong\s+tháng|hàng\s+năm|mỗi\s+năm|năm\s+nay|theo\s+năm|weekly|monthly|yearly)\b/gi,
      " ",
    )
    .replace(/\/\s*(?:tuần|tháng|năm|tuan|thang|nam)\b/gi, " ")
    .replace(/(?:cảnh báo|ngưỡng)\s*(?:ở mức\s*|khi đạt\s*)?\d{1,3}\s*%/gi, " ")
    .replace(/\b\d{4,12}\b/g, " ")
    .replace(/\b(?:vnd|đồng|đ)\b/gi, " ")
    .replace(/\s+(?:cho\s+tôi|giúp\s+tôi|nhé|nha|đi)\s*$/i, " ")
    .replace(/[,.?!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:mới|moi|cho tôi|giúp tôi|của tôi|tháng|tuần|năm)$/i.test(categoryHint)) {
    categoryHint = "";
  }

  return {
    amount,
    currency: amtParsed.currency || "VND",
    period,
    categoryHint: categoryHint || undefined,
    explicitName,
    sourceWalletHint,
    alertPercent,
  };
}

export function extractRecurringSlotsFromText(rawText: string): {
  title?: string;
  amount?: number;
  currency?: string;
  type?: "expense" | "income";
  frequency?: Frequency;
  interval?: number;
  dayOfMonth?: number;
  dayOfWeek?: number;
  startDateStr?: string;
  timeOfDay?: string;
  monthEndMode?: "last_day" | "next_month";
  walletHint?: string;
  categoryHint?: string;
  processingMode?: "auto" | "remind";
} {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const unaccented = removeAccents(lower);

  // Extract day_of_month / date patterns FIRST so "ngày 5" doesn't interfere with amount
  let dayOfMonth: number | undefined;
  let monthEndMode: "last_day" | "next_month" | undefined;

  if (/cuối\s+tháng|cuoi\s+thang/i.test(lower)) {
    dayOfMonth = 31;
    monthEndMode = "last_day";
  } else {
    const domMatch =
      lower.match(/(?:vào\s+)?(?:ngày|mùng)\s+(\d{1,2})(?!\s*[/-]\d{1,2})/i) ||
      unaccented.match(/(?:vao\s+)?(?:ngay|mung)\s+(\d{1,2})(?!\s*[/-]\d{1,2})/i);
    if (domMatch) {
      const d = Number.parseInt(domMatch[1], 10);
      if (d >= 1 && d <= 31) dayOfMonth = d;
    }
  }

  if (/chuyển\s+sang\s+đầu\s+tháng\s+sau|next_month/i.test(lower)) {
    monthEndMode = "next_month";
  }

  // Extract explicit start date DD/MM/YYYY or YYYY-MM-DD
  let startDateStr: string | undefined;
  const isoDateMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoDateMatch) {
    startDateStr = `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;
  } else {
    const vnDateMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    if (vnDateMatch) {
      startDateStr = `${vnDateMatch[3]}-${vnDateMatch[2].padStart(2, "0")}-${vnDateMatch[1].padStart(2, "0")}`;
    } else if (/bắt đầu (?:từ )?hôm nay|chạy ngay hôm nay/i.test(lower)) {
      startDateStr = formatLocalDateKey(new Date(), DEFAULT_RECURRING_TIMEZONE);
    }
  }

  // Extract day of week
  let dayOfWeek: number | undefined;
  const dowMatch = lower.match(/thứ\s*([2-7]|hai|ba|tư|năm|sáu|bảy)|chủ\s*nhật/i);
  if (dowMatch) {
    const token = (dowMatch[1] || "cn").toLowerCase();
    const map: Record<string, number> = {
      "2": 1,
      hai: 1,
      "3": 2,
      ba: 2,
      "4": 3,
      "tư": 3,
      "5": 4,
      "năm": 4,
      "6": 5,
      "sáu": 5,
      "7": 6,
      "bảy": 6,
      cn: 0,
    };
    dayOfWeek = map[token] ?? 0;
  }

  // Extract time of day
  let timeOfDay: string | undefined;
  const timeMatch = lower.match(/lúc\s*(\d{1,2})(?:[:h](\d{2}))?/i);
  if (timeMatch) {
    const hh = Number.parseInt(timeMatch[1], 10);
    const mm = timeMatch[2] ? Number.parseInt(timeMatch[2], 10) : 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      timeOfDay = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }

  // Strip day-of-month/date tokens before parsing monetary amount
  const textForAmount = text
    .replace(/(?:vào\s+)?(?:ngày|mùng)\s+\d{1,2}(?!\s*[/-]\d)/gi, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/thứ\s*[2-7]/gi, " ")
    .replace(/lúc\s*\d{1,2}(?:[:h]\d{2})?/gi, " ")
    .replace(/mỗi\s+\d+\s*(?:ngày|tuần|tháng|năm)/gi, " ");

  const amtParsed = parseVietnameseAmount(textForAmount);
  let amount = amtParsed.amount && amtParsed.amount > 0 ? amtParsed.amount : undefined;
  if (!amount) {
    const plainNum = textForAmount.match(/\b(\d{4,12})\b/);
    if (plainNum) amount = Number(plainNum[1]);
  }

  // Frequency & interval
  let frequency: Frequency | undefined;
  let interval = 1;

  const customIntervalMatch =
    lower.match(/(?:mỗi|cách)\s+(\d{1,2})\s*(ngày|tuần|tháng|năm)/i) ||
    unaccented.match(/(?:moi|cach)\s+(\d{1,2})\s*(ngay|tuan|thang|nam)/i);

  if (customIntervalMatch) {
    const n = Number.parseInt(customIntervalMatch[1], 10);
    const unit = removeAccents(customIntervalMatch[2].toLowerCase());
    if (n === 2 && unit === "tuan") {
      frequency = "biweekly";
    } else if (n === 2 && unit === "thang") {
      frequency = "bimonthly";
    } else if (n === 3 && unit === "thang") {
      frequency = "quarterly";
    } else if (n === 6 && unit === "thang") {
      frequency = "semi-annually";
    } else {
      interval = Math.max(1, n);
      if (unit === "ngay") frequency = "daily";
      else if (unit === "tuan") frequency = "weekly";
      else if (unit === "thang") frequency = "monthly";
      else if (unit === "nam") frequency = "yearly";
    }
  } else if (/\b(?:hàng ngày|mỗi ngày|mỗi hôm|daily)\b|\/\s*ngày\b/i.test(lower) || /\b(?:hang ngay|moi ngay|daily)\b/i.test(unaccented)) {
    frequency = "daily";
  } else if (/\b(?:2 tuần 1 lần|hai tuần một lần|biweekly)\b/i.test(lower)) {
    frequency = "biweekly";
  } else if (
    /\b(?:hàng tuần|mỗi tuần|weekly)\b|\/\s*tuần\b/i.test(lower) ||
    /\b(?:hang tuan|moi tuan|weekly)\b/i.test(unaccented) ||
    dayOfWeek !== undefined
  ) {
    frequency = "weekly";
  } else if (/\b(?:hàng quý|mỗi quý|quarterly)\b/i.test(lower) || /\b(?:hang quy|moi quy)\b/i.test(unaccented)) {
    frequency = "quarterly";
  } else if (
    /\b(?:hàng tháng|mỗi tháng|monthly)\b|\/\s*tháng\b/i.test(lower) ||
    /\b(?:hang thang|moi thang|monthly)\b/i.test(unaccented)
  ) {
    frequency = "monthly";
  } else if (/\b(?:hàng năm|mỗi năm|yearly)\b|\/\s*năm\b/i.test(lower) || /\b(?:hang nam|moi nam|yearly)\b/i.test(unaccented)) {
    frequency = "yearly";
  }

  // Transaction type inference
  let type: "expense" | "income" | undefined;
  const isIncome =
    /\b(?:khoản thu|thu nhập|thu định kỳ|nhận lương|tiền lương|lương|thưởng|cổ tức|cho thuê nhà|income)\b/i.test(
      lower,
    ) ||
    /\b(?:khoan thu|thu nhap|thu dinh ky|nhan luong|tien luong|luong|co tuc)\b/i.test(unaccented);
  const isExpense =
    /\b(?:khoản chi|chi tiêu|chi định kỳ|tiền nhà|tiền thuê nhà|thuê nhà|tiền phòng|tiền điện|tiền nước|tiền mạng|internet|wifi|điện thoại|học phí|netflix|spotify|youtube|icloud|bảo hiểm|trả góp|phí quản lý|gửi xe|expense)\b/i.test(
      lower,
    ) ||
    /\b(?:khoan chi|chi tieu|chi dinh ky|tien nha|thue nha|tien phong|tien dien|tien nuoc|tien mang|hoc phi|bao hiem|tra gop)\b/i.test(
      unaccented,
    );

  if (isIncome && !isExpense) type = "income";
  else if (isExpense && !isIncome) type = "expense";

  // Wallet hint
  let walletHint: string | undefined;
  const walletMatch = text.match(
    /(?:từ\s+ví|bằng\s+ví|vào\s+ví|qua\s+ví|từ\s+tài\s+khoản|vào\s+tài\s+khoản|qua\s+tài\s+khoản|ví)\s+([^,.?!]+?)(?=\s+(?:vào\s+ngày|mỗi|hàng|bắt\s+đầu|lúc|định\s+kỳ)|[.?!]|$)/i,
  );
  if (walletMatch) {
    walletHint = walletMatch[1].trim();
  }

  // Processing mode
  const processingMode: "auto" | "remind" =
    /\b(?:chỉ nhắc|nhắc nhở|nhắc tôi|remind)\b/i.test(lower) ? "remind" : "auto";

  // Extract clean title
  let title = text;
  if (amtParsed.matchedStr) title = title.replace(amtParsed.matchedStr, " ");
  title = title
    .replace(/^(?:hãy\s+|vui lòng\s+|giúp\s+tôi\s+|cho\s+tôi\s+)*/i, "")
    .replace(
      /^(?:tạo|thêm|lập|đặt|cài|cài đặt|thiết lập|ghi nhận|tao|them|lap|dat|cai|thiet lap|ghi nhan)\s+(?:mới\s+)?(?:một\s+)?(?:giao\s+dịch|khoản\s+chi|khoản\s+thu|chi\s+tiêu|thu\s+nhập|lịch)?\s*(?:định\s+kỳ|dinh\s+ky|lặp\s+lại)?\s*/i,
      "",
    )
    .replace(/(?:từ\s+ví|bằng\s+ví|vào\s+ví|qua\s+ví|từ\s+tài\s+khoản|vào\s+tài\s+khoản)\s+[^,.?!]+/gi, " ")
    .replace(/(?:vào\s+)?(?:ngày|mùng)\s+\d{1,2}/gi, " ")
    .replace(/cuối\s+tháng|chuyển\s+sang\s+đầu\s+tháng\s+sau/gi, " ")
    .replace(/bắt\s+đầu\s+(?:từ\s+)?(?:\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2}|hôm\s+nay)/gi, " ")
    .replace(/(?:mỗi|cách)\s+\d{1,2}\s*(?:ngày|tuần|tháng|năm)/gi, " ")
    .replace(/\b(?:hàng|mỗi)\s+(?:ngày|tuần|tháng|quý|năm)\b/gi, " ")
    .replace(/\b(?:2 tuần 1 lần|hai tuần một lần|định kỳ|lặp lại|tự động|nhắc nhở|chỉ nhắc)\b/gi, " ")
    .replace(/thứ\s*(?:[2-7]|hai|ba|tư|năm|sáu|bảy)|chủ\s*nhật/gi, " ")
    .replace(/lúc\s*\d{1,2}(?:[:h]\d{2})?/gi, " ")
    .replace(/\/\s*(?:ngày|tuần|tháng|năm)\b/gi, " ")
    .replace(/\b\d{4,12}\b/g, " ")
    .replace(/\b(?:vnd|đồng|đ)\b/gi, " ")
    .replace(/\s+(?:cho\s+tôi|giúp\s+tôi|nhé|nha|đi)\s*$/i, " ")
    .replace(/[,.?!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:mới|moi|cho tôi|giúp tôi|của tôi)$/i.test(title)) {
    title = "";
  }
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return {
    title: title || undefined,
    amount,
    currency: amtParsed.currency || "VND",
    type,
    frequency,
    interval,
    dayOfMonth,
    dayOfWeek,
    startDateStr,
    timeOfDay,
    monthEndMode,
    walletHint,
    categoryHint: title || undefined,
    processingMode,
  };
}

export function extractTransactionSlotsFromText(
  rawText: string,
  categories: Category[],
  wallets: Wallet[],
): {
  title?: string;
  amount?: number;
  currency?: string;
  type?: "expense" | "income";
  categoryId?: string;
  categoryHint?: string;
  walletId?: string;
  walletHint?: string;
  explicitlyMentionedWallet: boolean;
  occurredAtIso?: string;
  note?: string;
} {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const unaccented = removeAccents(lower);

  // Strip leading command verb so smart-parser gets clean phrase (e.g. "Ghi khoản chi ăn trưa 50k bằng ví tiền mặt" -> "ăn trưa 50k bằng ví tiền mặt")
  const strippedCommand = text
    .replace(/^(?:hãy\s+|vui lòng\s+|giúp\s+tôi\s+|cho\s+tôi\s+)*/i, "")
    .replace(
      /^(?:tạo|thêm|ghi|ghi nhận|lưu|nhập|tao|them|ghi|ghi nhan|luu)\s+(?:giúp\s+tôi\s+|cho\s+tôi\s+|mới\s+|một\s+)*(?:giao\s+dịch|khoản\s+chi|khoản\s+thu|chi\s+tiêu|thu\s+nhập|giao\s+dich|khoan\s+chi|khoan\s+thu|chi\s+tieu|thu\s+nhap)\s*/i,
      "",
    )
    .trim();

  const smart = parseSmartTransaction(strippedCommand || text, categories, wallets);
  const amtParsed = parseVietnameseAmount(text);

  let amount = smart.amount ?? amtParsed.amount ?? undefined;
  if (!amount) {
    const plainNum = text.match(/\b(\d{4,12})\b/);
    if (plainNum) amount = Number(plainNum[1]);
  }
  if (amount !== undefined && amount <= 0) amount = undefined;

  let type: "expense" | "income" | undefined = smart.type ?? undefined;
  if (!type) {
    if (/\b(?:khoản chi|chi tiêu|giao dịch chi|chi|mua|trả tiền|thanh toán)\b/i.test(lower) || /\b(?:khoan chi|chi tieu)\b/i.test(unaccented)) {
      type = "expense";
    } else if (/\b(?:khoản thu|thu nhập|giao dịch thu|nhận tiền|nhận lương|lương|thưởng)\b/i.test(lower) || /\b(?:khoan thu|thu nhap|nhan luong)\b/i.test(unaccented)) {
      type = "income";
    }
  }

  // Check if user explicitly mentioned a wallet in text
  let explicitlyMentionedWallet = false;
  let walletHint: string | undefined;

  for (const w of wallets) {
    const wNorm = normalizeLookup(w.name);
    if (wNorm && normalizeLookup(text).includes(wNorm)) {
      explicitlyMentionedWallet = true;
      walletHint = w.name;
      break;
    }
  }
  if (!explicitlyMentionedWallet) {
    const wm = text.match(
      /(?:bằng\s+ví|từ\s+ví|vào\s+ví|qua\s+ví|ví|tài\s+khoản|ngân\s+hàng|tiền\s+mặt|momo|zalopay)\s*([^,.?!]*)/i,
    );
    if (wm) {
      explicitlyMentionedWallet = true;
      walletHint = wm[0].replace(/^(?:bằng|từ|vào|qua)\s+/i, "").trim();
    }
  }

  // Clean title
  let title = smart.name || strippedCommand;
  title = title
    .replace(/(?:bằng\s+ví|từ\s+ví|vào\s+ví|qua\s+ví)\s+[^,.?!]+/gi, " ")
    .replace(/\s+(?:cho\s+tôi|giúp\s+tôi|hộ\s+tôi|nhé|nha|đi)\s*$/i, " ")
    .replace(/[,.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !title ||
    /^(?:giao dịch|khoản chi|khoản thu|chi tiêu|thu nhập|mới|cho tôi|giúp tôi|\d+)$/i.test(title)
  ) {
    title = "";
  }

  // Category hint if user explicitly wrote "danh mục X"
  let categoryHint: string | undefined;
  const catExplicit = text.match(/danh\s+mục\s+["“']?([^"”',.?!]+)["”']?/i);
  if (catExplicit) {
    categoryHint = catExplicit[1].trim();
  }

  const occurredAtIso = smart.date ? smart.date.toISOString() : undefined;

  return {
    title: title || undefined,
    amount,
    currency: smart.currency || amtParsed.currency || "VND",
    type,
    categoryId: smart.categoryId || undefined,
    categoryHint,
    walletId: explicitlyMentionedWallet ? smart.walletId || undefined : undefined,
    walletHint,
    explicitlyMentionedWallet,
    occurredAtIso,
  };
}

// ---------------------------------------------------------------------------
// Entity Matching Helpers (Wallets & Categories)
// ---------------------------------------------------------------------------

function matchUserWallet(
  wallets: Wallet[],
  hint?: string | null,
  requiredCurrency = "VND",
): Wallet | null {
  if (!wallets.length) return null;

  if (hint && hint.trim()) {
    const normHint = normalizeLookup(hint);
    // 1. Direct or substring name match
    const exact = wallets.find((w) => normalizeLookup(w.name) === normHint);
    if (exact) return exact;

    const partial = wallets.find(
      (w) =>
        normalizeLookup(w.name).includes(normHint) ||
        normHint.includes(normalizeLookup(w.name)),
    );
    if (partial) return partial;

    // 2. Type synonym match ("tiền mặt" -> cash, "ngân hàng" -> bank, "ví điện tử" -> ewallet)
    if (/tien mat|cash/.test(normHint)) {
      const cashW = wallets.find((w) => w.type === "cash" && (w.currency || "VND") === requiredCurrency);
      if (cashW) return cashW;
    }
    if (/ngan hang|bank|chuyen khoan/.test(normHint)) {
      const bankW = wallets.find((w) => w.type === "bank" && (w.currency || "VND") === requiredCurrency);
      if (bankW) return bankW;
    }
    if (/vi dien tu|momo|zalopay|ewallet/.test(normHint)) {
      const ew = wallets.find((w) => w.type === "ewallet" && (w.currency || "VND") === requiredCurrency);
      if (ew) return ew;
    }
    return null;
  }

  // If no hint provided, ONLY auto-select if the user has exactly 1 wallet in the target currency
  const matchingCurrencyWallets = wallets.filter(
    (w) => (w.currency || "VND").toUpperCase() === requiredCurrency.toUpperCase(),
  );
  if (matchingCurrencyWallets.length === 1) {
    return matchingCurrencyWallets[0];
  }
  return null;
}

function matchUserCategory(
  categories: Category[],
  kind: TransactionType,
  hint?: string | null,
  fallbackSmartText?: string,
  wallets: Wallet[] = [],
): Category | null {
  const kindCategories = categories.filter((c) => c.kind === kind);
  if (!kindCategories.length) return null;

  if (hint && hint.trim()) {
    const normHint = normalizeLookup(hint);
    const exact = kindCategories.find((c) => normalizeLookup(c.name) === normHint);
    if (exact) return exact;

    const partial = kindCategories.find(
      (c) =>
        normalizeLookup(c.name).includes(normHint) ||
        (normHint.length >= 3 && normHint.includes(normalizeLookup(c.name))),
    );
    if (partial) return partial;
  }

  if (fallbackSmartText) {
    const parsed = parseSmartTransaction(fallbackSmartText, kindCategories, wallets);
    if (parsed.categoryId) {
      const matched = kindCategories.find((c) => c.id === parsed.categoryId);
      if (matched) return matched;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Load User Entities & Authoritative Available Balances
// ---------------------------------------------------------------------------

interface LoadedUserCrudData {
  wallets: Wallet[];
  availableByWallet: Map<string, number>;
  categories: Category[];
  budgets: Array<Record<string, unknown>>;
  recentTransactions: Transaction[];
  recurringSchedules: Array<Record<string, unknown>>;
}

async function loadUserCrudData(ctx: ToolExecutionContext): Promise<LoadedUserCrudData> {
  const supabase = getSupabaseForContext(ctx);

  const [
    { data: walletsData, error: wErr },
    { data: categoriesData, error: cErr },
    { data: budgetsData, error: bErr },
    { data: txData },
    { data: recData },
  ] = await Promise.all([
    supabase.from("wallets").select("*").eq("user_id", ctx.userId),
    supabase.from("categories").select("*").eq("user_id", ctx.userId),
    supabase.from("budgets").select("*").eq("user_id", ctx.userId),
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", ctx.userId)
      .order("occurred_at", { ascending: false })
      .limit(30),
    supabase.from("recurring_transactions").select("*").eq("user_id", ctx.userId),
  ]);

  if (wErr) throw new Error(`DB_ERROR:Không thể tải danh sách ví (${wErr.message}).`);
  if (cErr) throw new Error(`DB_ERROR:Không thể tải danh mục (${cErr.message}).`);
  if (bErr) throw new Error(`DB_ERROR:Không thể tải ngân sách (${bErr.message}).`);

  const wallets = (Array.isArray(walletsData) ? walletsData : []) as Wallet[];
  const categories = (Array.isArray(categoriesData) ? categoriesData : []) as Category[];
  const budgets = (Array.isArray(budgetsData) ? budgetsData : []) as Array<Record<string, unknown>>;
  const recentTransactions = (Array.isArray(txData) ? txData : []) as Transaction[];
  const recurringSchedules = (Array.isArray(recData) ? recData : []) as Array<Record<string, unknown>>;

  const reservedByWallet = new Map<string, number>(
    wallets.map((w) => [String(w.id), Number(w.reserved_amount ?? 0)]),
  );

  const availableByWallet = new Map<string, number>();
  if (ctx.snapshot?.enrichedWallets?.length) {
    for (const sw of ctx.snapshot.enrichedWallets) {
      availableByWallet.set(sw.id, Number(sw.availableBalance ?? 0));
    }
  } else if (ctx.snapshot?.availableBalances instanceof Map && ctx.snapshot.availableBalances.size > 0) {
    for (const [wId, avail] of ctx.snapshot.availableBalances.entries()) {
      availableByWallet.set(wId, Number(avail ?? 0));
    }
  } else if (typeof supabase.rpc === "function") {
    try {
      const { data: rpcBals } = await supabase.rpc("get_true_wallet_balances");
      if (Array.isArray(rpcBals)) {
        for (const r of rpcBals) {
          const wId = String(r.wallet_id);
          const avail =
            r.available_balance !== undefined
              ? Number(r.available_balance)
              : Number(r.true_balance ?? 0) - (reservedByWallet.get(wId) ?? 0);
          availableByWallet.set(wId, avail);
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (availableByWallet.size === 0) {
    // Use canonical AuthoritativeFinancialSnapshot when RPC `get_true_wallet_balances` is unavailable on remote DB
    const [allTxRes, transfersRes, goalsRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("id, amount, type, wallet_id, budget_id, payment_source_type")
        .eq("user_id", ctx.userId),
      supabase
        .from("transfers")
        .select("id, from_wallet_id, to_wallet_id, amount")
        .eq("user_id", ctx.userId),
      supabase
        .from("savings_goals")
        .select("id, source_wallet_id, reserved_in_wallet, current_amount")
        .eq("user_id", ctx.userId),
    ]);
    const allTx = Array.isArray(allTxRes?.data) ? allTxRes.data : [];
    const transfers = Array.isArray(transfersRes?.data) ? transfersRes.data : [];
    const goals = Array.isArray(goalsRes?.data) ? goalsRes.data : [];
    const computedSnap = buildAuthoritativeFinancialSnapshot(
      wallets,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      allTx as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transfers as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      budgets as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      goals as any,
    );
    for (const [wId, avail] of computedSnap.availableBalances.entries()) {
      availableByWallet.set(wId, avail);
    }
  }

  return {
    wallets,
    availableByWallet,
    categories,
    budgets,
    recentTransactions,
    recurringSchedules,
  };
}

// ---------------------------------------------------------------------------
// Direct & Confirmed Execution Engine (Single Source of Truth for Writes)
// ---------------------------------------------------------------------------

export interface ExecuteActionRequest {
  actionId?: string;
  idempotencyKey: string;
  actionType?: CrudActionType;
  payload?: Record<string, unknown>;
  cancel?: boolean;
}

export interface ExecuteActionResponse {
  success: boolean;
  status: number;
  reply: string;
  error?: string;
  executedAction?: ExecutedCrudActionResult;
  cancelled?: boolean;
}

function computePayloadFingerprint(
  userId: string,
  actionType: CrudActionType,
  payload: Record<string, unknown>,
): string {
  const orderedKeys = Object.keys(payload).sort();
  const normalized: Record<string, unknown> = {};
  for (const k of orderedKeys) {
    normalized[k] = payload[k];
  }
  return `${userId}:${actionType}:${JSON.stringify(normalized)}`;
}

function translateDbErrorVi(rawMessage: string): string {
  if (!rawMessage) return "Không thể lưu dữ liệu vào cơ sở dữ liệu.";
  if (rawMessage.includes("INSUFFICIENT_BALANCE")) {
    const parts = rawMessage.split(":");
    return parts.slice(1).join(":").trim() || "Số dư khả dụng trong ví không đủ để thực hiện giao dịch này.";
  }
  if (rawMessage.includes("WALLET_FORBIDDEN")) {
    return "Ví thanh toán không hợp lệ hoặc không thuộc quyền sở hữu của bạn.";
  }
  if (rawMessage.includes("CATEGORY_FORBIDDEN")) {
    return "Danh mục không hợp lệ hoặc không thuộc quyền sở hữu của bạn.";
  }
  if (rawMessage.includes("AUTH_REQUIRED") || rawMessage.includes("JWT")) {
    return "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.";
  }
  if (rawMessage.includes("23505") || /duplicate key|unique constraint/i.test(rawMessage)) {
    return "Dữ liệu này đã tồn tại trong tài khoản của bạn (chống tạo trùng).";
  }
  const colonIdx = rawMessage.indexOf(":");
  if (colonIdx > 0 && /^[A-Z0-9_]+$/.test(rawMessage.slice(0, colonIdx))) {
    return rawMessage.slice(colonIdx + 1).trim();
  }
  return rawMessage;
}

/**
 * Execute a validated CRUD write against Supabase with auth, ownership, and idempotency guards.
 * Truthfully reports success ONLY after Supabase returns the persisted record.
 */
export async function executeConfirmedCrudAction(
  ctx: ToolExecutionContext,
  req: ExecuteActionRequest,
): Promise<ExecuteActionResponse> {
  pruneExpiredStores();

  if (!ctx?.userId) {
    return {
      success: false,
      status: 401,
      reply: "Bạn cần đăng nhập để thực hiện thao tác này.",
      error: "Bạn cần đăng nhập để thực hiện thao tác này.",
    };
  }

  if (!req.idempotencyKey && !req.actionId) {
    return {
      success: false,
      status: 400,
      reply: "Thiếu mã định danh thao tác (idempotencyKey / actionId).",
      error: "Thiếu mã định danh thao tác (idempotencyKey / actionId).",
    };
  }

  // Resolve stored pending action if actionId is given
  let storedAction: StoredPendingAction | undefined;
  if (req.actionId) {
    storedAction = pendingActionsById.get(req.actionId);
    if (storedAction && storedAction.userId !== ctx.userId) {
      return {
        success: false,
        status: 403,
        reply: "Bạn không có quyền thực hiện thao tác của tài khoản khác.",
        error: "FORBIDDEN:Không có quyền sở hữu thao tác này.",
      };
    }
  }

  // Handle explicit cancellation
  if (req.cancel) {
    if (storedAction) {
      storedAction.status = "cancelled";
      if (latestPendingActionByUser.get(ctx.userId) === storedAction.proposal.actionId) {
        latestPendingActionByUser.delete(ctx.userId);
      }
    }
    slotDraftByUser.delete(ctx.userId);
    return {
      success: true,
      status: 200,
      cancelled: true,
      reply: "Đã hủy thao tác theo yêu cầu của bạn. Không có dữ liệu nào bị thay đổi.",
    };
  }

  const effectiveIdemKey = req.idempotencyKey || storedAction?.proposal.idempotencyKey || "";
  const idemLookupKey = `${ctx.userId}:${effectiveIdemKey}`;

  // 1. Idempotency check by key
  const existingByKey = idempotencyStore.get(idemLookupKey);
  if (existingByKey) {
    return {
      success: true,
      status: 200,
      reply: existingByKey.reply,
      executedAction: {
        ...existingByKey.result,
        alreadyExecuted: true,
      },
    };
  }

  if (storedAction?.status === "confirmed" && storedAction.executedResult) {
    return {
      success: true,
      status: 200,
      reply: storedAction.executedReply || "Thao tác này đã được thực hiện thành công trước đó.",
      executedAction: {
        ...storedAction.executedResult,
        alreadyExecuted: true,
      },
    };
  }

  if (storedAction?.status === "cancelled") {
    return {
      success: false,
      status: 409,
      reply: "Thao tác này đã bị hủy trước đó. Vui lòng gửi yêu cầu mới nếu bạn muốn tạo lại.",
      error: "Thao tác đã bị hủy.",
    };
  }

  const actionType = storedAction?.proposal.actionType ?? req.actionType;
  const payload = storedAction?.proposal.payload ?? req.payload;

  if (!actionType || !payload) {
    return {
      success: false,
      status: 404,
      reply: "Yêu cầu xác nhận đã hết hạn hoặc không tồn tại. Vui lòng yêu cầu tạo lại.",
      error: "Không tìm thấy thông tin thao tác chờ xác nhận.",
    };
  }

  const fingerprint =
    storedAction?.fingerprint ?? computePayloadFingerprint(ctx.userId, actionType, payload);

  // 2. Rapid duplicate retry check by content fingerprint
  const existingByFp = fingerprintStore.get(fingerprint);
  if (existingByFp && Date.now() - existingByFp.createdAtMs <= FINGERPRINT_DEDUP_MS) {
    return {
      success: true,
      status: 200,
      reply: existingByFp.reply,
      executedAction: {
        ...existingByFp.result,
        alreadyExecuted: true,
      },
    };
  }

  // 3. In-flight concurrency lock
  if (inFlightExecutionKeys.has(idemLookupKey) || inFlightExecutionKeys.has(fingerprint)) {
    return {
      success: false,
      status: 409,
      reply: "Yêu cầu đang được xử lý, vui lòng không gửi trùng lặp.",
      error: "CONCURRENT_DUPLICATE_REQUEST",
    };
  }

  inFlightExecutionKeys.add(idemLookupKey);
  inFlightExecutionKeys.add(fingerprint);

  try {
    const supabase = getSupabaseForContext(ctx);
    let record: Record<string, unknown> | null = null;
    let recordId = "";
    let refreshTargets: RefreshTarget[] = [];
    let successReply = "";

    if (actionType === "create_category") {
      const name = String(payload.name || "").trim();
      const kind = payload.kind === "income" ? "income" : payload.kind === "expense" ? "expense" : null;
      const color = String(payload.color || "#3B82F6").trim();
      const icon = String(payload.icon || "tag").trim();
      const parentId = payload.parent_id ? String(payload.parent_id) : null;

      if (!name || name.length > 80 || !kind) {
        return {
          success: false,
          status: 400,
          reply: "Thông tin danh mục không hợp lệ (cần tên danh mục từ 1-80 ký tự và loại Thu/Chi).",
          error: "INVALID_CATEGORY_INPUT",
        };
      }

      // Check ownership of parent_id if provided & duplicate category name
      const { data: existingCats, error: checkErr } = await supabase
        .from("categories")
        .select("id, name, kind")
        .eq("user_id", ctx.userId);
      if (checkErr) {
        const msg = translateDbErrorVi(checkErr.message);
        return { success: false, status: 500, reply: `Không thể kiểm tra danh mục hiện có: ${msg}`, error: msg };
      }

      const normNewName = normalizeLookup(name);
      const dupCat = (existingCats || []).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c.kind === kind && normalizeLookup(String(c.name)) === normNewName,
      );
      if (dupCat) {
        const kindVi = kind === "income" ? "Thu nhập" : "Chi tiêu";
        const errMsg = `Danh mục "${dupCat.name}" (${kindVi}) đã tồn tại trong tài khoản của bạn.`;
        return { success: false, status: 409, reply: errMsg, error: errMsg };
      }

      if (parentId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parentCat = (existingCats || []).find((c: any) => c.id === parentId && c.kind === kind);
        if (!parentCat) {
          return {
            success: false,
            status: 403,
            reply: "Danh mục cha không hợp lệ hoặc không thuộc tài khoản của bạn.",
            error: "CATEGORY_FORBIDDEN",
          };
        }
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("categories")
        .insert({
          user_id: ctx.userId,
          name,
          kind,
          parent_id: parentId,
          icon,
          color,
          is_default: false,
        })
        .select("*")
        .single();

      if (insertErr || !inserted?.id) {
        const msg = translateDbErrorVi(insertErr?.message || "Không nhận được xác nhận từ cơ sở dữ liệu.");
        return {
          success: false,
          status: 400,
          reply: `Tạo danh mục thất bại: ${msg}`,
          error: msg,
        };
      }

      record = inserted as Record<string, unknown>;
      recordId = String(inserted.id);
      refreshTargets = ["categories"];
      const kindLabel = kind === "income" ? "Thu nhập" : "Chi tiêu";
      successReply =
        `Đã tạo thành công danh mục **${name}**!\n\n` +
        `- **Tên danh mục:** ${name}\n` +
        `- **Phân loại:** ${kindLabel}\n` +
        `- **Mã màu:** \`${color}\`\n\n` +
        `Danh sách danh mục trên giao diện đã được cập nhật.`;
    } else if (actionType === "create_budget") {
      const name = String(payload.name || "").trim();
      const amount = Number(payload.amount);
      const period = String(payload.period || "");
      const walletId = payload.wallet_id ? String(payload.wallet_id) : null;
      const categoryId = payload.category_id ? String(payload.category_id) : null;
      const periodStart = String(
        payload.period_start || formatLocalDateKey(new Date(), DEFAULT_RECURRING_TIMEZONE),
      );
      const alertPercent = Number(payload.alert_percent ?? 80);
      const initialAllocation = walletId ? Number(payload.initial_allocation ?? amount) : 0;

      if (
        !name ||
        name.length > 100 ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > MAX_SAFE_MONEY ||
        !["weekly", "monthly", "yearly"].includes(period)
      ) {
        return {
          success: false,
          status: 400,
          reply: "Thông tin ngân sách không hợp lệ (cần tên, số tiền > 0 và chu kỳ hợp lệ).",
          error: "INVALID_BUDGET_INPUT",
        };
      }

      // Ownership & duplicate checks
      const userData = await loadUserCrudData(ctx);
      if (categoryId && !userData.categories.some((c) => c.id === categoryId)) {
        return {
          success: false,
          status: 403,
          reply: "Danh mục liên kết không thuộc quyền sở hữu của tài khoản bạn.",
          error: "CATEGORY_FORBIDDEN",
        };
      }
      if (walletId) {
        const wallet = userData.wallets.find((w) => w.id === walletId);
        if (!wallet) {
          return {
            success: false,
            status: 403,
            reply: "Ví cấp vốn không thuộc quyền sở hữu của tài khoản bạn.",
            error: "WALLET_FORBIDDEN",
          };
        }
        const avail = userData.availableByWallet.get(walletId) ?? 0;
        if (initialAllocation > avail) {
          const msg = `Ví "${wallet.name}" không đủ số dư khả dụng (${formatMoneyVi(avail, wallet.currency)}) để cấp vốn ${formatMoneyVi(initialAllocation, wallet.currency)} cho ngân sách.`;
          return { success: false, status: 400, reply: `Tạo ngân sách thất bại: ${msg}`, error: msg };
        }
      }

      const duplicateBudget = userData.budgets.find((b) => {
        if (b.status && b.status !== "active") return false;
        if (String(b.period) !== period) return false;
        if (categoryId && b.category_id && String(b.category_id) === categoryId) return true;
        return normalizeLookup(String(b.name || "")) === normalizeLookup(name);
      });
      if (duplicateBudget) {
        const msg = `Ngân sách đang hoạt động "${duplicateBudget.name}" cho cùng chu kỳ đã tồn tại.`;
        return { success: false, status: 409, reply: `Không tạo trùng ngân sách: ${msg}`, error: msg };
      }

      // Reuse existing PostgreSQL RPC `create_budget_with_allocation`
      // Calling with the 7 core arguments works natively across BOTH migration 006 (7-arg)
      // and migration 018 (`p_initial_allocation DEFAULT NULL` -> `COALESCE(NULL, p_amount)`).
      const baseRpcArgs: Record<string, unknown> = {
        p_name: name,
        p_amount: amount,
        p_wallet_id: walletId,
        p_category_id: categoryId,
        p_period: period,
        p_period_start: periodStart,
        p_alert_percent: alertPercent,
      };

      const needsCustomInitialAlloc =
        Boolean(walletId) && initialAllocation > 0 && initialAllocation !== amount;

      let { data: createdBudgetId, error: rpcErr } = await supabase.rpc(
        "create_budget_with_allocation",
        needsCustomInitialAlloc
          ? { ...baseRpcArgs, p_initial_allocation: initialAllocation }
          : baseRpcArgs,
      );

      // Fallback if DB is on migration 006 without 8th param `p_initial_allocation`
      if (rpcErr && String(rpcErr.message || "").includes("p_initial_allocation")) {
        const fallback = await supabase.rpc("create_budget_with_allocation", baseRpcArgs);
        createdBudgetId = fallback.data;
        rpcErr = fallback.error;
      }

      // Fallback if remote Supabase DB has not applied RPC `create_budget_with_allocation` (`PGRST202`)
      const isMissingRpcInSchemaCache =
        rpcErr &&
        ((rpcErr as { code?: string }).code === "PGRST202" ||
          /Could not find the function public\.create_budget_with_allocation/i.test(
            String(rpcErr.message || ""),
          ));

      if (isMissingRpcInSchemaCache) {
        const allocAmount = walletId ? initialAllocation : 0;
        const { data: directBudget, error: directInsertErr } = await supabase
          .from("budgets")
          .insert({
            user_id: ctx.userId,
            name,
            amount,
            allocated_amount: allocAmount,
            spent_amount: 0,
            remaining_amount: allocAmount,
            category_id: categoryId,
            source_wallet_id: walletId,
            period,
            period_start: periodStart,
            alert_percent: alertPercent,
            status: "active",
          })
          .select("id")
          .single();

        if (!directInsertErr && directBudget?.id) {
          createdBudgetId = directBudget.id;
          rpcErr = null;
          if (walletId && allocAmount > 0) {
            const targetWallet = userData.wallets.find((w) => w.id === walletId);
            const nextReserved = Number(targetWallet?.reserved_amount ?? 0) + allocAmount;
            await supabase
              .from("wallets")
              .update({ reserved_amount: nextReserved, updated_at: new Date().toISOString() })
              .eq("id", walletId)
              .eq("user_id", ctx.userId);
            try {
              await supabase.from("fund_allocations").insert({
                user_id: ctx.userId,
                type: "wallet_to_budget",
                wallet_id: walletId,
                budget_id: directBudget.id,
                amount: allocAmount,
                note: "Phân bổ ngân sách qua Trợ lý AI",
              });
            } catch {
              // Best-effort audit entry; do not fail an already-created budget
            }
          }
        } else if (directInsertErr) {
          rpcErr = directInsertErr;
        }
      }

      if (rpcErr || !createdBudgetId) {
        const rawErrMsg = rpcErr?.message || "RPC không trả về mã ngân sách.";
        const msg =
          !walletId && rawErrMsg.includes("WALLET_FORBIDDEN")
            ? "Phiên bản cơ sở dữ liệu hiện tại yêu cầu chọn Ví nguồn cấp vốn cho ngân sách. Vui lòng tạo lại kèm tên ví (ví dụ: \"trích từ ví Tiền mặt\")."
            : translateDbErrorVi(rawErrMsg);
        return {
          success: false,
          status: 400,
          reply: `Tạo ngân sách thất bại: ${msg}`,
          error: msg,
        };
      }

      recordId = String(createdBudgetId);
      const { data: verifiedBudget } = await supabase
        .from("budgets")
        .select("*")
        .eq("id", recordId)
        .eq("user_id", ctx.userId)
        .single();

      record = (verifiedBudget as Record<string, unknown>) || {
        id: recordId,
        name,
        amount,
        period,
        category_id: categoryId,
        source_wallet_id: walletId,
        allocated_amount: initialAllocation,
      };
      refreshTargets = walletId ? ["budgets", "wallets"] : ["budgets"];

      const periodVi = period === "weekly" ? "Hàng tuần" : period === "yearly" ? "Hàng năm" : "Hàng tháng";
      const modeVi = walletId
        ? `Quỹ phong bì (đã trích ${formatMoneyVi(initialAllocation)} từ ví)`
        : "Theo dõi hạn mức chi tiêu";
      successReply =
        `Đã tạo thành công ngân sách **${name}**!\n\n` +
        `- **Hạn mức:** **${formatMoneyVi(amount)}**\n` +
        `- **Chu kỳ:** ${periodVi} (từ ${periodStart})\n` +
        `- **Chế độ:** ${modeVi}\n` +
        `- **Cảnh báo:** Khi đạt ${alertPercent}% hạn mức\n\n` +
        `Dữ liệu ngân sách trên giao diện đã được cập nhật.`;
    } else if (actionType === "create_transaction") {
      const title = String(payload.title || "").trim();
      const amount = Number(payload.amount);
      const type: TransactionType | null =
        payload.type === "income" ? "income" : payload.type === "expense" ? "expense" : null;
      const walletId = payload.wallet_id ? String(payload.wallet_id) : null;
      const categoryId = payload.category_id ? String(payload.category_id) : null;
      const categoryName = String(payload.category || (type === "income" ? "Thu khác" : "Khác"));
      const currency = String(payload.currency || "VND").toUpperCase();
      const occurredAt = String(payload.occurred_at || new Date().toISOString());
      const note = String(payload.note || "").trim();

      if (
        !title ||
        title.length > 120 ||
        !type ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > MAX_SAFE_MONEY ||
        !walletId
      ) {
        return {
          success: false,
          status: 400,
          reply: "Thông tin giao dịch không hợp lệ (cần tên giao dịch, loại thu/chi, số tiền > 0 và ví thanh toán).",
          error: "INVALID_TRANSACTION_INPUT",
        };
      }

      const userData = await loadUserCrudData(ctx);
      const wallet = userData.wallets.find((w) => w.id === walletId);
      if (!wallet) {
        return {
          success: false,
          status: 403,
          reply: "Ví thanh toán không tồn tại hoặc không thuộc quyền sở hữu của bạn.",
          error: "WALLET_FORBIDDEN",
        };
      }

      const walletCurrency = (wallet.currency || "VND").toUpperCase();
      if (currency !== walletCurrency) {
        const msg = `Giao dịch đơn vị ${currency} không thể ghi trực tiếp vào ví "${wallet.name}" (${walletCurrency}).`;
        return { success: false, status: 400, reply: `Tạo giao dịch thất bại: ${msg}`, error: msg };
      }

      if (categoryId && !userData.categories.some((c) => c.id === categoryId)) {
        return {
          success: false,
          status: 403,
          reply: "Danh mục không thuộc quyền sở hữu của tài khoản bạn.",
          error: "CATEGORY_FORBIDDEN",
        };
      }

      const avail = userData.availableByWallet.get(walletId) ?? 0;
      if (type === "expense" && amount > avail) {
        const msg = `Ví "${wallet.name}" chỉ còn ${formatMoneyVi(avail, walletCurrency)} khả dụng, không đủ để chi ${formatMoneyVi(amount, walletCurrency)}.`;
        return { success: false, status: 400, reply: `Tạo giao dịch thất bại: ${msg}`, error: msg };
      }

      const { data: insertedTx, error: txErr } = await supabase
        .from("transactions")
        .insert({
          user_id: ctx.userId,
          title: title.slice(0, 120),
          amount,
          type,
          category: categoryName.slice(0, 60),
          category_id: categoryId,
          wallet_id: walletId,
          occurred_at: occurredAt,
          note: note.slice(0, 500),
          payment_source_type: "wallet",
          budget_id: null,
          receipt_path: null,
        })
        .select("*")
        .single();

      if (txErr || !insertedTx?.id) {
        const msg = translateDbErrorVi(txErr?.message || "Không nhận được xác nhận lưu giao dịch từ cơ sở dữ liệu.");
        return {
          success: false,
          status: 400,
          reply: `Tạo giao dịch thất bại: ${msg}`,
          error: msg,
        };
      }

      record = insertedTx as Record<string, unknown>;
      recordId = String(insertedTx.id);
      refreshTargets = ["transactions", "wallets", "budgets"];
      const newAvail = type === "expense" ? avail - amount : avail + amount;
      const typeVi = type === "income" ? "Thu nhập" : "Chi tiêu";

      successReply =
        `Đã ghi nhận thành công giao dịch **${title}**!\n\n` +
        `- **Loại giao dịch:** ${typeVi}\n` +
        `- **Số tiền:** **${formatMoneyVi(amount, walletCurrency)}**\n` +
        `- **Danh mục:** ${categoryName}\n` +
        `- **Ví:** ${wallet.name} (Khả dụng sau giao dịch: **${formatMoneyVi(newAvail, walletCurrency)}**)\n\n` +
        `Danh sách giao dịch và số dư ví trên giao diện đã được cập nhật.`;
    } else if (actionType === "create_recurring_transaction") {
      const title = String(payload.title || "").trim();
      const amount = Number(payload.amount);
      const type: TransactionType | null =
        payload.type === "income" ? "income" : payload.type === "expense" ? "expense" : null;
      const frequency = String(payload.frequency || "") as Frequency;
      const interval = Number(payload.interval ?? 1);
      const walletId = payload.wallet_id ? String(payload.wallet_id) : null;
      const categoryId = payload.category_id ? String(payload.category_id) : null;
      const startDate = String(payload.start_date || "");
      const nextRunAt = String(payload.next_run_at || "");
      const processingMode = payload.processing_mode === "remind" ? "remind" : "auto";
      const autoCreate = processingMode === "auto";
      const monthEndMode = payload.month_end_mode === "next_month" ? "next_month" : "last_day";
      const note = String(payload.note || "").trim();

      if (
        !title ||
        title.length > 120 ||
        !type ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        amount > MAX_SAFE_MONEY ||
        !isValidFrequency(frequency) ||
        !walletId ||
        !nextRunAt ||
        Number.isNaN(new Date(nextRunAt).getTime())
      ) {
        return {
          success: false,
          status: 400,
          reply: "Thông tin lịch giao dịch định kỳ không hợp lệ.",
          error: "INVALID_RECURRING_INPUT",
        };
      }

      const userData = await loadUserCrudData(ctx);
      const wallet = userData.wallets.find((w) => w.id === walletId);
      if (!wallet) {
        return {
          success: false,
          status: 403,
          reply: "Ví liên kết không tồn tại hoặc không thuộc quyền sở hữu của bạn.",
          error: "WALLET_FORBIDDEN",
        };
      }
      if (categoryId && !userData.categories.some((c) => c.id === categoryId)) {
        return {
          success: false,
          status: 403,
          reply: "Danh mục không thuộc quyền sở hữu của tài khoản bạn.",
          error: "CATEGORY_FORBIDDEN",
        };
      }

      const dupRecurring = userData.recurringSchedules.find((r) => {
        if (!r.active) return false;
        return (
          normalizeLookup(String(r.title || "")) === normalizeLookup(title) &&
          String(r.type) === type &&
          String(r.frequency) === frequency &&
          Math.abs(Number(r.amount) - amount) < 0.01
        );
      });
      if (dupRecurring) {
        const msg = `Lịch định kỳ "${dupRecurring.title}" (${formatMoneyVi(amount, wallet.currency)}) đã tồn tại và đang hoạt động.`;
        return { success: false, status: 409, reply: `Không tạo trùng lịch định kỳ: ${msg}`, error: msg };
      }

      const insertPayload: Record<string, unknown> = {
        user_id: ctx.userId,
        title,
        amount,
        type,
        wallet_id: walletId,
        category_id: categoryId,
        frequency,
        interval,
        start_date: startDate || formatLocalDateKey(nextRunAt, DEFAULT_RECURRING_TIMEZONE),
        next_run_at: nextRunAt,
        active: true,
        auto_create: autoCreate,
        processing_mode: processingMode,
        status: "active",
        amount_type: "fixed",
        end_type: payload.end_type || "never",
        end_date: payload.end_date || null,
        occurrence_limit: payload.occurrence_limit || null,
        month_end_mode: monthEndMode,
        note,
      };

      let { data: insertedRec, error: recErr } = await supabase
        .from("recurring_transactions")
        .insert({ ...insertPayload, note: note.slice(0, 500) })
        .select("*")
        .single();

      // Fallback if DB has legacy recurring_transactions_frequency_check allowing only daily/weekly/monthly/yearly
      if (
        recErr &&
        /recurring_transactions_frequency_check/i.test(String(recErr.message || ""))
      ) {
        const mappedFreq =
          frequency === "biweekly"
            ? { frequency: "weekly", interval: Math.max(1, interval) * 2 }
            : frequency === "bimonthly"
              ? { frequency: "monthly", interval: Math.max(1, interval) * 2 }
              : frequency === "quarterly"
                ? { frequency: "monthly", interval: Math.max(1, interval) * 3 }
                : frequency === "semi-annually"
                  ? { frequency: "monthly", interval: Math.max(1, interval) * 6 }
                  : null;
        if (mappedFreq) {
          const retry = await supabase
            .from("recurring_transactions")
            .insert({
              ...insertPayload,
              frequency: mappedFreq.frequency,
              interval: mappedFreq.interval,
              note: note.slice(0, 500),
            })
            .select("*")
            .single();
          insertedRec = retry.data;
          recErr = retry.error;
        }
      }

      if (recErr || !insertedRec?.id) {
        const msg = translateDbErrorVi(recErr?.message || "Không nhận được xác nhận tạo lịch định kỳ từ cơ sở dữ liệu.");
        return {
          success: false,
          status: 400,
          reply: `Tạo giao dịch định kỳ thất bại: ${msg}`,
          error: msg,
        };
      }

      record = insertedRec as Record<string, unknown>;
      recordId = String(insertedRec.id);
      refreshTargets = ["recurring"];

      // If start_date/next_run_at is already due right now and autoCreate is true, execute first due run via Backend Scheduler
      let autoExecutedNote = "";
      if (autoCreate && new Date(nextRunAt).getTime() <= Date.now()) {
        const execSummary = await processDueRecurringTransactions(ctx, {
          scheduleId: recordId,
          timeZone: DEFAULT_RECURRING_TIMEZONE,
        });
        if (execSummary.executedCount > 0) {
          refreshTargets = ["recurring", "transactions", "wallets", "budgets"];
          autoExecutedNote = `\n- **Thực thi kỳ đầu tiên:** Đã tự động ghi nhận kỳ đến hạn hôm nay vào sổ giao dịch.`;
        }
      }

      const freqVi = getFrequencyLabelVi(frequency, interval);
      const nextDateVi = formatLocalDateKey(
        String((record.next_run_at as string) || nextRunAt),
        DEFAULT_RECURRING_TIMEZONE,
      );
      const typeVi = type === "income" ? "Thu nhập định kỳ" : "Chi tiêu định kỳ";

      successReply =
        `Đã tạo thành công lịch giao dịch định kỳ **${title}**!\n\n` +
        `- **Phân loại:** ${typeVi}\n` +
        `- **Số tiền mỗi kỳ:** **${formatMoneyVi(amount, wallet.currency || "VND")}**\n` +
        `- **Tần suất:** ${freqVi}\n` +
        `- **Ví liên kết:** ${wallet.name}\n` +
        `- **Ngày chạy dự kiến:** ${nextDateVi} (Múi giờ Việt Nam GMT+7)\n` +
        `- **Chế độ xử lý:** ${autoCreate ? "Tự động ghi nhận khi đến hạn" : "Nhắc nhở xác nhận"}` +
        `${autoExecutedNote}\n\n` +
        `Danh sách giao dịch định kỳ trên giao diện đã được cập nhật.`;
    }

    if (!record || !recordId) {
      return {
        success: false,
        status: 500,
        reply: "Không thể xác nhận dữ liệu vừa tạo từ cơ sở dữ liệu.",
        error: "EMPTY_DB_RESULT",
      };
    }

    invalidateUserFinancialCache(ctx.userId);
    slotDraftByUser.delete(ctx.userId);

    const executedResult: ExecutedCrudActionResult = {
      actionId: storedAction?.proposal.actionId || req.actionId || generateId("act"),
      idempotencyKey: effectiveIdemKey || generateId("idem"),
      actionType,
      recordId,
      record,
      refreshTargets,
    };

    const nowMs = Date.now();
    const idemRecord: StoredIdempotencyRecord = {
      userId: ctx.userId,
      idempotencyKey: executedResult.idempotencyKey,
      fingerprint,
      result: executedResult,
      reply: successReply,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + IDEMPOTENCY_TTL_MS,
    };

    if (effectiveIdemKey) {
      idempotencyStore.set(idemLookupKey, idemRecord);
    }
    fingerprintStore.set(fingerprint, idemRecord);

    if (storedAction) {
      storedAction.status = "confirmed";
      storedAction.executedResult = executedResult;
      storedAction.executedReply = successReply;
      if (latestPendingActionByUser.get(ctx.userId) === storedAction.proposal.actionId) {
        latestPendingActionByUser.delete(ctx.userId);
      }
    }

    return {
      success: true,
      status: 200,
      reply: successReply,
      executedAction: executedResult,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const cleanMsg = translateDbErrorVi(rawMsg);
    return {
      success: false,
      status: rawMsg.includes("FORBIDDEN") ? 403 : rawMsg.includes("AUTH_REQUIRED") ? 401 : 500,
      reply: `Không thể thực hiện thao tác: ${cleanMsg}`,
      error: cleanMsg,
    };
  } finally {
    inFlightExecutionKeys.delete(idemLookupKey);
    inFlightExecutionKeys.delete(fingerprint);
  }
}

// ---------------------------------------------------------------------------
// Orchestrator for Natural Language + LLM Tool Call CRUD Handling in Chat
// ---------------------------------------------------------------------------

export interface CrudOrchestrationResult {
  handled: boolean;
  reply: string;
  status: number;
  pendingAction?: PendingCrudActionProposal;
  executedAction?: ExecutedCrudActionResult;
  error?: string;
}

function registerPendingProposal(
  userId: string,
  actionType: CrudActionType,
  title: string,
  summaryFields: ActionSummaryField[],
  payload: Record<string, unknown>,
  warnings?: string[],
): PendingCrudActionProposal {
  const nowMs = Date.now();
  const actionId = generateId("act");
  const idempotencyKey = generateId("idem");
  const expiresAt = new Date(nowMs + PENDING_ACTION_TTL_MS).toISOString();

  const proposal: PendingCrudActionProposal = {
    actionId,
    idempotencyKey,
    actionType,
    title,
    summaryFields,
    warnings: warnings && warnings.length > 0 ? warnings : undefined,
    payload,
    expiresAt,
  };

  const fingerprint = computePayloadFingerprint(userId, actionType, payload);
  pendingActionsById.set(actionId, {
    userId,
    proposal,
    fingerprint,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + PENDING_ACTION_TTL_MS,
    status: "pending",
  });
  latestPendingActionByUser.set(userId, actionId);
  slotDraftByUser.delete(userId);

  return proposal;
}

function saveSlotDraft(
  userId: string,
  actionType: CrudActionType,
  slots: Record<string, unknown>,
  missingFields: string[],
  rawText: string,
  previousRawTexts: string[] = [],
): void {
  const nowMs = Date.now();
  slotDraftByUser.set(userId, {
    userId,
    actionType,
    slots,
    missingFields,
    rawTexts: [...previousRawTexts.slice(-4), rawText],
    updatedAtMs: nowMs,
    expiresAtMs: nowMs + SLOT_DRAFT_TTL_MS,
  });
}

function buildProposalMarkdown(proposal: PendingCrudActionProposal): string {
  const lines = proposal.summaryFields.map((f) => `- **${f.label}:** ${f.value}`);
  const warningBlock =
    proposal.warnings && proposal.warnings.length > 0
      ? `\n\n> **Lưu ý kiểm tra trùng / cảnh báo:**\n${proposal.warnings.map((w) => `> - ${w}`).join("\n")}`
      : "";

  return (
    `Tôi đã chuẩn bị thông tin **${proposal.title}** theo yêu cầu của bạn:\n\n` +
    `${lines.join("\n")}` +
    `${warningBlock}\n\n` +
    `Vui lòng kiểm tra lại và nhấn nút **Xác nhận thực hiện** bên dưới (hoặc trả lời **"Xác nhận"**) để hệ thống lưu dữ liệu, hoặc **"Hủy"** nếu bạn muốn thay đổi.\n\n` +
    `<!-- [Mã xác nhận: ${proposal.actionId} | ${proposal.actionType}] -->`
  );
}

/**
 * Handle a detected CRUD intent (or LLM tool call) end-to-end:
 * - Validates authentication & loads user wallets/categories/budgets.
 * - Merges multi-turn slot-filling drafts + optional LLM tool call arguments (guarded against hallucination).
 * - If mandatory fields are missing, asks a clear Vietnamese question instead of inventing data.
 * - Executes `create_category` directly against Supabase (verifying DB success) OR builds a
 *   confirmation proposal (`pendingAction`) for financial/recurring operations.
 */
export async function handleChatCrudIntent(
  detected: DetectedCrudIntent,
  rawMessage: string,
  history: ChatMessage[],
  ctx: ToolExecutionContext | null | undefined,
  llmToolCall?: OllamaToolCall | null,
): Promise<CrudOrchestrationResult> {
  pruneExpiredStores();

  if (!ctx?.userId) {
    return {
      handled: true,
      status: 401,
      reply: "Vui lòng đăng nhập tài khoản để thực hiện tạo dữ liệu.",
      error: "AUTH_REQUIRED",
    };
  }

  // 1. Handle Confirmation / Cancellation
  if (detected.kind === "CANCEL_PENDING") {
    const cancelRes = await executeConfirmedCrudAction(ctx, {
      actionId: detected.actionIdFromText,
      idempotencyKey: `cancel_${Date.now()}`,
      cancel: true,
    });
    return {
      handled: true,
      status: cancelRes.status,
      reply: cancelRes.reply,
    };
  }

  if (detected.kind === "CONFIRM_PENDING") {
    const active =
      (detected.actionIdFromText ? pendingActionsById.get(detected.actionIdFromText) : undefined) ||
      (() => {
        const latestId = latestPendingActionByUser.get(ctx.userId);
        return latestId ? pendingActionsById.get(latestId) : undefined;
      })();

    if (!active) {
      return {
        handled: true,
        status: 200,
        reply:
          "Hiện không có thao tác nào đang chờ xác nhận (hoặc yêu cầu đã hết hạn). Bạn hãy mô tả lại danh mục, ngân sách hoặc giao dịch cần tạo nhé!",
      };
    }

    const execRes = await executeConfirmedCrudAction(ctx, {
      actionId: active.proposal.actionId,
      idempotencyKey: active.proposal.idempotencyKey,
      actionType: active.proposal.actionType,
      payload: active.proposal.payload,
    });

    return {
      handled: true,
      status: execRes.status,
      reply: execRes.reply,
      executedAction: execRes.executedAction,
      error: execRes.error,
    };
  }

  // 2. Load user's real wallets, categories, budgets, balances
  let userData: LoadedUserCrudData;
  try {
    userData = await loadUserCrudData(ctx);
  } catch (err) {
    const msg = err instanceof Error ? translateDbErrorVi(err.message) : "Lỗi kết nối cơ sở dữ liệu.";
    return {
      handled: true,
      status: 500,
      reply: `Không thể truy xuất dữ liệu tài khoản để kiểm tra trước khi tạo: ${msg}`,
      error: msg,
    };
  }

  const prevDraft =
    detected.kind === "SLOT_FILL_FOLLOWUP" ? slotDraftByUser.get(ctx.userId) : undefined;
  const actionType =
    (llmToolCall?.function.name as CrudActionType | undefined) ||
    detected.actionType ||
    prevDraft?.actionType;

  if (!actionType) {
    return { handled: false, status: 200, reply: "" };
  }

  const combinedUserText = [...(prevDraft?.rawTexts || []), rawMessage].join(" | ");
  const llmArgs = (llmToolCall?.function.arguments || {}) as Record<string, unknown>;

  // =========================================================================
  // CASE A: CREATE CATEGORY
  // =========================================================================
  if (actionType === "create_category") {
    const det = extractCategorySlotsFromText(rawMessage);
    const prevSlots = prevDraft?.slots || {};

    // Anti-hallucination: only accept LLM `kind` if user text actually expressed thu/chi
    const mergedKind =
      det.kind ||
      (prevSlots.kind as "expense" | "income" | undefined) ||
      undefined;
    const mergedName =
      det.name ||
      (typeof prevSlots.name === "string" ? prevSlots.name : undefined) ||
      (typeof llmArgs.name === "string" &&
      normalizeLookup(combinedUserText).includes(normalizeLookup(llmArgs.name))
        ? llmArgs.name.trim()
        : undefined);
    const mergedColor =
      det.color || (typeof prevSlots.color === "string" ? prevSlots.color : undefined);
    const mergedParentHint =
      det.parentCategoryName ||
      (typeof prevSlots.parentCategoryName === "string" ? prevSlots.parentCategoryName : undefined);

    const missing: string[] = [];
    if (!mergedName) missing.push("tên danh mục");
    if (!mergedKind) missing.push("loại danh mục (**Chi tiêu** hay **Thu nhập**)");

    if (missing.length > 0) {
      saveSlotDraft(
        ctx.userId,
        "create_category",
        {
          name: mergedName,
          kind: mergedKind,
          color: mergedColor,
          parentCategoryName: mergedParentHint,
        },
        missing,
        rawMessage,
        prevDraft?.rawTexts,
      );

      if (mergedName && !mergedKind) {
        return {
          handled: true,
          status: 200,
          reply:
            `Để tạo danh mục **${mergedName}**, bạn vui lòng cho biết thêm danh mục này thuộc nhóm **Chi tiêu** hay **Thu nhập**?\n\n` +
            `<!-- [Đang bổ sung thông tin: create_category] -->`,
        };
      }
      return {
        handled: true,
        status: 200,
        reply:
          `Để tạo danh mục mới, bạn vui lòng cung cấp thêm: ${missing.join(" và ")}.\n` +
          `Ví dụ: *"Tạo danh mục chi tiêu Thú cưng"* hoặc *"Thêm danh mục thu nhập Cổ tức"*.\n\n` +
          `<!-- [Đang bổ sung thông tin: create_category] -->`,
      };
    }

    const { icon, color: defaultColor } = pickCategoryIconAndColor(mergedName!, mergedKind!);
    let parentId: string | null = null;
    if (mergedParentHint) {
      const parentCat = matchUserCategory(userData.categories, mergedKind!, mergedParentHint);
      if (!parentCat) {
        return {
          handled: true,
          status: 200,
          reply: `Không tìm thấy danh mục cha **"${mergedParentHint}"** trong nhóm ${mergedKind === "income" ? "Thu nhập" : "Chi tiêu"} của bạn. Vui lòng kiểm tra lại tên danh mục cha.`,
        };
      }
      parentId = parentCat.id;
    }

    const execRes = await executeConfirmedCrudAction(ctx, {
      idempotencyKey: `cat_${normalizeLookup(mergedName!)}_${mergedKind}`,
      actionType: "create_category",
      payload: {
        name: mergedName!,
        kind: mergedKind!,
        color: mergedColor || defaultColor,
        icon,
        parent_id: parentId,
      },
    });

    return {
      handled: true,
      status: execRes.status === 409 || execRes.status === 400 ? 200 : execRes.status,
      reply: execRes.reply,
      executedAction: execRes.executedAction,
      error: execRes.error,
    };
  }

  // =========================================================================
  // CASE B: CREATE BUDGET
  // =========================================================================
  if (actionType === "create_budget") {
    const det = extractBudgetSlotsFromText(rawMessage);
    const prevSlots = prevDraft?.slots || {};

    const mergedAmount = det.amount ?? (prevSlots.amount as number | undefined);
    const mergedPeriod =
      det.period ?? (prevSlots.period as "weekly" | "monthly" | "yearly" | undefined);
    const mergedCategoryHint =
      det.categoryHint || (prevSlots.categoryHint as string | undefined);
    const mergedExplicitName =
      det.explicitName || (prevSlots.explicitName as string | undefined);
    const mergedWalletHint =
      det.sourceWalletHint || (prevSlots.sourceWalletHint as string | undefined);
    const mergedAlertPct =
      det.alertPercent ?? (prevSlots.alertPercent as number | undefined) ?? 80;

    // Resolve category against user's expense categories
    const matchedCat = mergedCategoryHint
      ? matchUserCategory(userData.categories, "expense", mergedCategoryHint)
      : null;

    const effectiveName =
      mergedExplicitName ||
      (matchedCat ? `Ngân sách ${matchedCat.name}` : mergedCategoryHint ? `Ngân sách ${mergedCategoryHint}` : undefined);

    const missing: string[] = [];
    if (!effectiveName) missing.push("**tên hoặc danh mục chi tiêu** (ví dụ: Ăn uống, Di chuyển)");
    if (!mergedAmount || mergedAmount <= 0) missing.push("**hạn mức số tiền** (ví dụ: 3.000.000 VND)");
    if (!mergedPeriod) missing.push("**chu kỳ áp dụng** (`tuần`, `tháng` hay `năm`)");

    if (missing.length > 0) {
      saveSlotDraft(
        ctx.userId,
        "create_budget",
        {
          amount: mergedAmount,
          period: mergedPeriod,
          categoryHint: mergedCategoryHint,
          explicitName: mergedExplicitName,
          sourceWalletHint: mergedWalletHint,
          alertPercent: mergedAlertPct,
        },
        missing,
        rawMessage,
        prevDraft?.rawTexts,
      );

      return {
        handled: true,
        status: 200,
        reply:
          `Để thiết lập ngân sách${effectiveName ? ` **${effectiveName}**` : ""}, bạn vui lòng cho biết thêm:\n` +
          missing.map((m) => `- ${m}`).join("\n") +
          `\n\n<!-- [Đang bổ sung thông tin: create_budget] -->`,
      };
    }

    // Validate optional envelope source wallet if user requested one
    let sourceWallet: Wallet | null = null;
    if (mergedWalletHint) {
      sourceWallet = matchUserWallet(userData.wallets, mergedWalletHint, "VND");
      if (!sourceWallet) {
        const walletNames = userData.wallets.map((w) => `"${w.name}"`).join(", ") || "chưa có ví nào";
        return {
          handled: true,
          status: 200,
          reply: `Không tìm thấy ví **"${mergedWalletHint}"** để cấp vốn ngân sách. Các ví hiện có của bạn: ${walletNames}. Vui lòng chọn lại ví hoặc tạo ngân sách theo dõi hạn mức không trích ví.`,
        };
      }
      const avail = userData.availableByWallet.get(sourceWallet.id) ?? 0;
      if (mergedAmount! > avail) {
        return {
          handled: true,
          status: 200,
          reply:
            `Không thể tạo ngân sách trích quỹ từ ví **${sourceWallet.name}** vì số dư khả dụng của ví chỉ còn **${formatMoneyVi(avail, sourceWallet.currency)}** (thấp hơn mức **${formatMoneyVi(mergedAmount!)}**).\n\n` +
            `Bạn có thể giảm hạn mức, chọn ví khác, hoặc tạo ngân sách ở chế độ **Theo dõi hạn mức** (không khóa tiền trong ví).`,
        };
      }
    }

    // Duplicate check before proposing
    const dupBudget = userData.budgets.find((b) => {
      if (b.status && b.status !== "active") return false;
      if (String(b.period) !== mergedPeriod) return false;
      if (matchedCat && b.category_id && String(b.category_id) === matchedCat.id) return true;
      return normalizeLookup(String(b.name || "")) === normalizeLookup(effectiveName!);
    });
    if (dupBudget) {
      return {
        handled: true,
        status: 200,
        reply: `Bạn đã có ngân sách đang hoạt động **${dupBudget.name}** (${formatMoneyVi(Number(dupBudget.amount || 0))}) cho cùng chu kỳ này. Hệ thống ngăn tạo trùng để tránh sai lệch theo dõi chi tiêu.`,
      };
    }

    const nowVnDate = formatLocalDateKey(new Date(), DEFAULT_RECURRING_TIMEZONE);
    const periodStart =
      mergedPeriod === "monthly" ? `${nowVnDate.slice(0, 7)}-01` : nowVnDate;
    const periodVi =
      mergedPeriod === "weekly" ? "Hàng tuần" : mergedPeriod === "yearly" ? "Hàng năm" : "Hàng tháng";

    const summaryFields: ActionSummaryField[] = [
      { label: "Tên ngân sách", value: effectiveName! },
      { label: "Danh mục áp dụng", value: matchedCat ? matchedCat.name : "Tất cả / Ngân sách chung" },
      { label: "Hạn mức", value: formatMoneyVi(mergedAmount!) },
      { label: "Chu kỳ", value: `${periodVi} (bắt đầu ${periodStart})` },
      {
        label: "Loại ngân sách",
        value: sourceWallet
          ? `Quỹ phong bì — trích ${formatMoneyVi(mergedAmount!)} từ ví "${sourceWallet.name}"`
          : "Theo dõi hạn mức chi tiêu (không khóa số dư ví)",
      },
      { label: "Ngưỡng cảnh báo", value: `${mergedAlertPct}%` },
    ];

    const proposal = registerPendingProposal(
      ctx.userId,
      "create_budget",
      `Ngân sách "${effectiveName!}"`,
      summaryFields,
      {
        name: effectiveName!,
        amount: mergedAmount!,
        period: mergedPeriod!,
        category_id: matchedCat?.id ?? null,
        wallet_id: sourceWallet?.id ?? null,
        initial_allocation: sourceWallet ? mergedAmount! : 0,
        period_start: periodStart,
        alert_percent: mergedAlertPct,
      },
    );

    return {
      handled: true,
      status: 200,
      reply: buildProposalMarkdown(proposal),
      pendingAction: proposal,
    };
  }

  // =========================================================================
  // CASE C: CREATE TRANSACTION
  // =========================================================================
  if (actionType === "create_transaction") {
    if (userData.wallets.length === 0) {
      return {
        handled: true,
        status: 200,
        reply: "Tài khoản của bạn hiện chưa có ví nào để ghi nhận giao dịch. Vui lòng tạo ít nhất một ví trong mục **Ví tiền** trước nhé!",
      };
    }

    const det = extractTransactionSlotsFromText(rawMessage, userData.categories, userData.wallets);
    const prevSlots = prevDraft?.slots || {};

    const mergedType = det.type ?? (prevSlots.type as "expense" | "income" | undefined);
    const mergedAmount = det.amount ?? (prevSlots.amount as number | undefined);
    const mergedCurrency = (det.currency || (prevSlots.currency as string) || "VND").toUpperCase();
    const mergedTitle =
      (det.title && !det.explicitlyMentionedWallet ? det.title : det.title) ||
      (prevSlots.title as string | undefined);
    const mergedWalletHint =
      det.walletHint || (prevSlots.walletHint as string | undefined);
    const mergedCategoryHint =
      det.categoryHint || (prevSlots.categoryHint as string | undefined);
    const mergedOccurredAt =
      det.occurredAtIso || (prevSlots.occurredAtIso as string | undefined) || new Date().toISOString();

    const matchedWallet = matchUserWallet(userData.wallets, mergedWalletHint, mergedCurrency);

    const missing: string[] = [];
    if (!mergedType) missing.push("**loại giao dịch** (**Chi tiêu** hay **Thu nhập**)");
    if (!mergedTitle) missing.push("**nội dung / tên giao dịch** (ví dụ: Ăn trưa, Nhận lương)");
    if (!mergedAmount || mergedAmount <= 0) missing.push("**số tiền** (ví dụ: 50.000 VND)");
    if (!matchedWallet) {
      const walletChoices = userData.wallets
        .map((w) => `**${w.name}** (khả dụng: ${formatMoneyVi(userData.availableByWallet.get(w.id) ?? 0, w.currency || "VND")})`)
        .join(", ");
      missing.push(`**ví thực hiện** (các ví hiện có: ${walletChoices})`);
    }

    let matchedCat: Category | null = null;
    if (mergedType) {
      matchedCat = matchUserCategory(
        userData.categories,
        mergedType,
        mergedCategoryHint,
        mergedTitle || combinedUserText,
        userData.wallets,
      );
      if (!matchedCat && userData.categories.some((c) => c.kind === mergedType)) {
        const catSamples = userData.categories
          .filter((c) => c.kind === mergedType)
          .slice(0, 6)
          .map((c) => `**${c.name}**`)
          .join(", ");
        missing.push(`**danh mục** (gợi ý: ${catSamples})`);
      }
    }

    if (missing.length > 0) {
      saveSlotDraft(
        ctx.userId,
        "create_transaction",
        {
          type: mergedType,
          amount: mergedAmount,
          currency: mergedCurrency,
          title: mergedTitle,
          walletHint: mergedWalletHint || matchedWallet?.name,
          categoryHint: mergedCategoryHint || matchedCat?.name,
          occurredAtIso: mergedOccurredAt,
        },
        missing,
        rawMessage,
        prevDraft?.rawTexts,
      );

      return {
        handled: true,
        status: 200,
        reply:
          `Để ghi nhận giao dịch chính xác (không tự ý giả định dữ liệu), bạn vui lòng bổ sung thêm:\n` +
          missing.map((m) => `- ${m}`).join("\n") +
          `\n\n<!-- [Đang bổ sung thông tin: create_transaction] -->`,
      };
    }

    // Check wallet currency & available balance BEFORE proposing
    const walletCurrency = (matchedWallet!.currency || "VND").toUpperCase();
    if (mergedCurrency !== walletCurrency) {
      return {
        handled: true,
        status: 200,
        reply: `Giao dịch **${mergedCurrency}** yêu cầu chọn ví có đơn vị tiền tệ **${mergedCurrency}** (ví **${matchedWallet!.name}** đang dùng **${walletCurrency}**).`,
      };
    }

    const avail = userData.availableByWallet.get(matchedWallet!.id) ?? 0;
    if (mergedType === "expense" && mergedAmount! > avail) {
      return {
        handled: true,
        status: 200,
        reply:
          `Không thể tạo khoản chi **${formatMoneyVi(mergedAmount!, walletCurrency)}** từ ví **${matchedWallet!.name}** vì số dư khả dụng hiện chỉ còn **${formatMoneyVi(avail, walletCurrency)}** (thiếu **${formatMoneyVi(mergedAmount! - avail, walletCurrency)}**).\n\n` +
          `Vui lòng chọn ví khác có đủ số dư khả dụng hoặc điều chỉnh lại số tiền.`,
      };
    }

    // Check potential duplicate transaction using existing `detectDuplicateTransaction`
    const warnings: string[] = [];
    const dupCheck = detectDuplicateTransaction(
      {
        title: mergedTitle!,
        amount: mergedAmount!,
        type: mergedType!,
        walletId: matchedWallet!.id,
        occurredAt: mergedOccurredAt,
      },
      userData.recentTransactions,
    );
    if (dupCheck.isDuplicate && dupCheck.reason) {
      warnings.push(`${dupCheck.reason}. Hãy chỉ xác nhận nếu đây là một giao dịch mới thực sự.`);
    }

    const afterAvail = mergedType === "expense" ? avail - mergedAmount! : avail + mergedAmount!;
    const dateLabel = formatLocalDateKey(mergedOccurredAt, DEFAULT_RECURRING_TIMEZONE);
    const categoryLabel = matchedCat ? matchedCat.name : mergedType === "income" ? "Thu khác" : "Khác";

    const summaryFields: ActionSummaryField[] = [
      { label: "Loại giao dịch", value: mergedType === "income" ? "Thu nhập (+)" : "Chi tiêu (-)" },
      { label: "Nội dung", value: mergedTitle! },
      { label: "Số tiền", value: formatMoneyVi(mergedAmount!, walletCurrency) },
      { label: "Danh mục", value: categoryLabel },
      {
        label: "Ví thực hiện",
        value: `${matchedWallet!.name} (Khả dụng dự kiến sau giao dịch: ${formatMoneyVi(afterAvail, walletCurrency)})`,
      },
      { label: "Ngày ghi nhận", value: dateLabel },
    ];

    const proposal = registerPendingProposal(
      ctx.userId,
      "create_transaction",
      `Giao dịch "${mergedTitle!}"`,
      summaryFields,
      {
        title: mergedTitle!,
        amount: mergedAmount!,
        type: mergedType!,
        currency: walletCurrency,
        category: categoryLabel,
        category_id: matchedCat?.id ?? null,
        wallet_id: matchedWallet!.id,
        occurred_at: mergedOccurredAt,
        note: "",
      },
      warnings,
    );

    return {
      handled: true,
      status: 200,
      reply: buildProposalMarkdown(proposal),
      pendingAction: proposal,
    };
  }

  // =========================================================================
  // CASE D: CREATE RECURRING TRANSACTION
  // =========================================================================
  if (actionType === "create_recurring_transaction") {
    if (userData.wallets.length === 0) {
      return {
        handled: true,
        status: 200,
        reply: "Tài khoản của bạn hiện chưa có ví nào để liên kết giao dịch định kỳ. Vui lòng tạo ví trước trong mục **Ví tiền**.",
      };
    }

    const det = extractRecurringSlotsFromText(rawMessage);
    const prevSlots = prevDraft?.slots || {};

    const mergedTitle = det.title || (prevSlots.title as string | undefined);
    const mergedAmount = det.amount ?? (prevSlots.amount as number | undefined);
    const mergedCurrency = (det.currency || (prevSlots.currency as string) || "VND").toUpperCase();
    const mergedType = det.type ?? (prevSlots.type as "expense" | "income" | undefined);
    const mergedFrequency = det.frequency ?? (prevSlots.frequency as Frequency | undefined);
    const mergedInterval = det.interval ?? (prevSlots.interval as number | undefined) ?? 1;
    const mergedDayOfMonth = det.dayOfMonth ?? (prevSlots.dayOfMonth as number | undefined);
    const mergedDayOfWeek = det.dayOfWeek ?? (prevSlots.dayOfWeek as number | undefined);
    const mergedStartDateStr = det.startDateStr || (prevSlots.startDateStr as string | undefined);
    const mergedTimeOfDay = det.timeOfDay || (prevSlots.timeOfDay as string | undefined);
    const mergedMonthEndMode =
      det.monthEndMode || (prevSlots.monthEndMode as "last_day" | "next_month" | undefined) || "last_day";
    const mergedWalletHint = det.walletHint || (prevSlots.walletHint as string | undefined);
    const mergedProcessingMode =
      det.processingMode || (prevSlots.processingMode as "auto" | "remind" | undefined) || "auto";

    const matchedWallet = matchUserWallet(userData.wallets, mergedWalletHint, mergedCurrency);

    const missing: string[] = [];
    if (!mergedTitle) missing.push("**tên giao dịch định kỳ** (ví dụ: Tiền thuê nhà, Tiền Internet)");
    if (!mergedType) missing.push("**phân loại** (**Chi tiêu** hay **Thu nhập**)");
    if (!mergedAmount || mergedAmount <= 0) missing.push("**số tiền mỗi kỳ** (ví dụ: 4.000.000 VND)");
    if (!mergedFrequency) missing.push("**tần suất lặp lại** (`hàng ngày`, `hàng tuần`, `hàng tháng`, `hàng quý` hoặc `hàng năm`)");
    if (!matchedWallet) {
      const walletChoices = userData.wallets.map((w) => `**${w.name}**`).join(", ");
      missing.push(`**ví liên kết thanh toán/nhận tiền** (các ví hiện có: ${walletChoices})`);
    }

    if (missing.length > 0) {
      saveSlotDraft(
        ctx.userId,
        "create_recurring_transaction",
        {
          title: mergedTitle,
          amount: mergedAmount,
          currency: mergedCurrency,
          type: mergedType,
          frequency: mergedFrequency,
          interval: mergedInterval,
          dayOfMonth: mergedDayOfMonth,
          dayOfWeek: mergedDayOfWeek,
          startDateStr: mergedStartDateStr,
          timeOfDay: mergedTimeOfDay,
          monthEndMode: mergedMonthEndMode,
          walletHint: mergedWalletHint || matchedWallet?.name,
          processingMode: mergedProcessingMode,
        },
        missing,
        rawMessage,
        prevDraft?.rawTexts,
      );

      return {
        handled: true,
        status: 200,
        reply:
          `Để thiết lập lịch giao dịch định kỳ chính xác, bạn vui lòng cho biết thêm:\n` +
          missing.map((m) => `- ${m}`).join("\n") +
          `\n\n<!-- [Đang bổ sung thông tin: create_recurring_transaction] -->`,
      };
    }

    // Duplicate check against active recurring schedules
    const dupRec = userData.recurringSchedules.find((r) => {
      if (!r.active) return false;
      return (
        normalizeLookup(String(r.title || "")) === normalizeLookup(mergedTitle!) &&
        String(r.type) === mergedType &&
        String(r.frequency) === mergedFrequency &&
        Math.abs(Number(r.amount) - mergedAmount!) < 0.01
      );
    });
    if (dupRec) {
      return {
        handled: true,
        status: 200,
        reply: `Lịch giao dịch định kỳ **${dupRec.title}** (${formatMoneyVi(mergedAmount!, matchedWallet!.currency || "VND")} - ${getFrequencyLabelVi(mergedFrequency!, mergedInterval)}) đã tồn tại và đang hoạt động trong tài khoản của bạn.`,
      };
    }

    const matchedCat = matchUserCategory(
      userData.categories,
      mergedType!,
      mergedTitle,
      combinedUserText,
      userData.wallets,
    );

    let scheduleCalc;
    try {
      scheduleCalc = computeInitialRecurringSchedule({
        frequency: mergedFrequency!,
        interval: mergedInterval,
        dayOfMonth: mergedDayOfMonth,
        dayOfWeek: mergedDayOfWeek,
        startDateStr: mergedStartDateStr,
        timeOfDay: mergedTimeOfDay || "08:00",
        monthEndMode: mergedMonthEndMode,
        timeZone: DEFAULT_RECURRING_TIMEZONE,
      });
    } catch (schedErr) {
      const msg = schedErr instanceof Error ? translateDbErrorVi(schedErr.message) : "Ngày bắt đầu không hợp lệ.";
      return {
        handled: true,
        status: 200,
        reply: `Không thể tính lịch định kỳ: ${msg} Vui lòng kiểm tra lại ngày tháng.`,
      };
    }

    const warnings: string[] = [];
    const avail = userData.availableByWallet.get(matchedWallet!.id) ?? 0;
    if (mergedType === "expense" && mergedAmount! > avail) {
      warnings.push(
        `Số dư khả dụng hiện tại của ví "${matchedWallet!.name}" là ${formatMoneyVi(avail, matchedWallet!.currency || "VND")}, thấp hơn mức chi mỗi kỳ (${formatMoneyVi(mergedAmount!, matchedWallet!.currency || "VND")}). Vui lòng đảm bảo nạp đủ tiền trước kỳ chạy ${scheduleCalc.nextRunLabelVi}.`,
      );
    }

    const summaryFields: ActionSummaryField[] = [
      { label: "Tên lịch định kỳ", value: mergedTitle! },
      { label: "Phân loại", value: mergedType === "income" ? "Thu nhập định kỳ (+)" : "Chi tiêu định kỳ (-)" },
      { label: "Số tiền mỗi kỳ", value: formatMoneyVi(mergedAmount!, matchedWallet!.currency || "VND") },
      { label: "Danh mục", value: matchedCat ? matchedCat.name : mergedType === "income" ? "Thu khác" : "Khác" },
      { label: "Ví liên kết", value: matchedWallet!.name },
      { label: "Tần suất", value: scheduleCalc.frequencyLabelVi },
      { label: "Lần chạy tiếp theo", value: scheduleCalc.nextRunLabelVi },
      {
        label: "Chế độ thực thi",
        value: mergedProcessingMode === "auto" ? "Tự động ghi nhận qua Backend khi đến hạn" : "Nhắc nhở xác nhận",
      },
    ];

    const proposal = registerPendingProposal(
      ctx.userId,
      "create_recurring_transaction",
      `Giao dịch định kỳ "${mergedTitle!}"`,
      summaryFields,
      {
        title: mergedTitle!,
        amount: mergedAmount!,
        type: mergedType!,
        frequency: mergedFrequency!,
        interval: mergedInterval,
        wallet_id: matchedWallet!.id,
        category_id: matchedCat?.id ?? null,
        start_date: scheduleCalc.startDate,
        next_run_at: scheduleCalc.nextRunAt,
        processing_mode: mergedProcessingMode,
        month_end_mode: mergedMonthEndMode,
        end_type: "never",
        note: "",
      },
      warnings,
    );

    return {
      handled: true,
      status: 200,
      reply: buildProposalMarkdown(proposal),
      pendingAction: proposal,
    };
  }

  return { handled: false, status: 200, reply: "" };
}

/**
 * Reset in-memory pending proposals, multi-turn slot drafts, and idempotency stores (test helper).
 */
export function resetAiCrudStoresForTests(): void {
  pendingActionsById.clear();
  latestPendingActionByUser.clear();
  slotDraftByUser.clear();
  idempotencyStore.clear();
  fingerprintStore.clear();
  inFlightExecutionKeys.clear();
}
