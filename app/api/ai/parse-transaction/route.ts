/**
 * app/api/ai/parse-transaction/route.ts
 * =====================================
 * POST /api/ai/parse-transaction
 *
 * Natural Language Transaction Parser Endpoint.
 * - Authenticated with Supabase Bearer token.
 * - Extracts spending category using Local ML V3 (aiClassify) with Canary / Fallback.
 * - Extracts amount, wallet, date, and description from Vietnamese natural language.
 * - Never fails silently: outputs explicit source metadata:
 *   "local_model_v3" | "local_model_v2" | "heuristic".
 * - Fully backward compatible with dashboard.tsx expectation.
 */

import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { aiClassify } from "@/backend/src/services/ai-local.client";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";
import { HttpInputError, asRecord, readJsonBody } from "@/backend/src/services/http-input.service";
import {
  parseSmartTransaction,
  parseVietnameseAmount,
  removeAccents,
} from "@/frontend/utils/smart-parser";
import type { AITransactionParseResult, Category, Wallet, TransactionType } from "@/frontend/types/finance.types";

export const runtime = "nodejs";
export const maxDuration = 15;

interface UserCategoryRow {
  id: string;
  name: string;
  kind: TransactionType;
}

interface UserWalletRow {
  id: string;
  name: string;
  type: string;
}

/**
 * Maps model category string ("ăn uống", "di chuyển", "mua sắm", etc.)
 * to the user's specific database category record.
 */
function matchCategoryRecord(
  predictedCategory: string,
  categories: UserCategoryRow[],
  targetKind: TransactionType,
): UserCategoryRow | null {
  const normPred = removeAccents(predictedCategory.toLowerCase().trim());

  // 1. Exact match within target kind
  const exactKind = categories.find(
    (c) => c.kind === targetKind && removeAccents(c.name.toLowerCase().trim()) === normPred,
  );
  if (exactKind) return exactKind;

  // 2. Substring match within target kind
  const subKind = categories.find(
    (c) =>
      c.kind === targetKind &&
      (removeAccents(c.name.toLowerCase()).includes(normPred) ||
        normPred.includes(removeAccents(c.name.toLowerCase()))),
  );
  if (subKind) return subKind;

  // 3. Fallback across all categories
  const anyMatch = categories.find((c) =>
    removeAccents(c.name.toLowerCase()).includes(normPred),
  );
  if (anyMatch) return anyMatch;

  // 4. Default to first category of target kind
  return categories.find((c) => c.kind === targetKind) ?? null;
}

/**
 * Matches wallet from text keywords or defaults to user's first wallet.
 */
function matchWalletFromText(
  text: string,
  wallets: UserWalletRow[],
): UserWalletRow | null {
  if (!wallets.length) return null;
  const normText = removeAccents(text.toLowerCase());

  // Check specific wallet names in text
  for (const w of wallets) {
    const normW = removeAccents(w.name.toLowerCase().trim());
    if (normW.length >= 2 && normText.includes(normW)) {
      return w;
    }
  }

  // Common keywords
  if (normText.includes("momo")) {
    const momo = wallets.find((w) => removeAccents(w.name.toLowerCase()).includes("momo"));
    if (momo) return momo;
  }
  if (normText.includes("tien mat") || normText.includes("cash")) {
    const cash = wallets.find(
      (w) =>
        w.type === "cash" ||
        removeAccents(w.name.toLowerCase()).includes("tien mat") ||
        removeAccents(w.name.toLowerCase()).includes("cash"),
    );
    if (cash) return cash;
  }
  if (
    normText.includes("the") ||
    normText.includes("chuyen khoan") ||
    normText.includes("ck") ||
    normText.includes("ngan hang")
  ) {
    const bank = wallets.find((w) => w.type === "bank");
    if (bank) return bank;
  }

  return wallets[0] ?? null;
}

/**
 * Extracts a clean title from the text by stripping the matched amount/wallet substrings.
 */
function cleanTransactionTitle(text: string, matchedAmountStr?: string): string {
  let cleaned = text.trim();
  if (matchedAmountStr) {
    cleaned = cleaned.replace(matchedAmountStr, " ").replace(/\s{2,}/g, " ").trim();
  }
  // Remove trailing time / wallet hints if short
  cleaned = cleaned.replace(/\b(hôm nay|hom nay|hôm qua|hom qua|sáng nay|chiều nay|tối nay)\b/gi, "").trim();
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return cleaned || text.trim();
}

export async function POST(request: Request) {
  const t0 = Date.now();
  try {
    // 1. Auth guard
    const token = extractBearerToken(request);
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
    const supabaseKey = (
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      ""
    ).trim();

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: "Lỗi cấu hình server." }, { status: 500 });
    }

    const user = await verifySupabaseAccessToken(token, {
      supabaseUrl,
      supabasePublishableKey: supabaseKey,
    });

    // 2. Parse body
    const body = asRecord(await readJsonBody(request, 8 * 1024));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const clientDate = typeof body.client_date === "string" ? body.client_date.trim() : new Date().toISOString().slice(0, 10);

    if (!text) {
      return NextResponse.json({ error: "Trường 'text' không được để trống." }, { status: 400 });
    }

    // 3. Load user categories and wallets from database
    const supabase = createSupabaseClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const [catRes, walRes] = await Promise.all([
      supabase.from("categories").select("id, name, kind").eq("user_id", user.id).order("name"),
      supabase.from("wallets").select("id, name, type").eq("user_id", user.id).order("name"),
    ]);

    const userCategories: UserCategoryRow[] = (catRes.data ?? []) as UserCategoryRow[];
    const userWallets: UserWalletRow[] = (walRes.data ?? []) as UserWalletRow[];

    // 4. Call Local ML Classify via Client (FastAPI manages V4 canary routing)
    const aiResult = await aiClassify(
      { text, user_id: user.id, is_real_traffic: true },
      { userId: user.id },
    );

    // 5. Build parsed response
    let source: "local_model_v4" | "local_model_v3" | "local_model_v2" | "heuristic" = "heuristic";
    let predictedCategory = "";
    let confidence = 0.0;
    let fallback = false;

    // Check if AI classification succeeded
    if (aiResult.ok && aiResult.data) {
      predictedCategory = aiResult.data.category;
      confidence = aiResult.data.confidence;
      const modelVer = aiResult.data.meta?.version;
      source = modelVer === "v4" ? "local_model_v4" : (modelVer === "v2" ? "local_model_v2" : "local_model_v3");
      fallback = Boolean(aiResult.data.meta?.fallback_used);

      // Log prediction event safely (no PII or secrets)
      console.log(
        `[AI_CLASSIFY] source=${source} confidence=${confidence.toFixed(4)} fallback=${fallback} endpoint=/api/ai/parse-transaction`,
      );
    } else {
      source = "heuristic";
      fallback = true;
      console.log(
        `[AI_CLASSIFY] source=heuristic fallback=true reason=${aiResult.error ?? "ai_service_offline"} endpoint=/api/ai/parse-transaction`,
      );
    }

    let finalData: AITransactionParseResult;

    if (source === "heuristic") {
      // Run heuristic SmartParser as graceful fallback
      const smartResult = parseSmartTransaction(
        text,
        userCategories as unknown as Category[],
        userWallets as unknown as Wallet[],
      );
      predictedCategory = smartResult.categoryId
        ? userCategories.find((c) => c.id === smartResult.categoryId)?.name ?? "khác"
        : "khác";
      confidence = smartResult.confidence.category / 100;

      finalData = {
        transaction_type: smartResult.type,
        amount: smartResult.amount,
        currency: "VND",
        category_id: smartResult.categoryId,
        category_name: predictedCategory,
        wallet_id: smartResult.walletId,
        wallet_name: userWallets.find((w) => w.id === smartResult.walletId)?.name ?? null,
        description: smartResult.name || text,
        date: smartResult.date ? smartResult.date.toISOString().slice(0, 10) : clientDate,
        time: null,
        confidence_notes: [
          `Nhận diện bằng bộ quy tắc ngoại tuyến (heuristic fallback) — ${Math.round(confidence * 100)}% tin cậy`,
        ],
      };
    } else {
      // Primary Local ML Model output
      const isIncome = predictedCategory === "thu nhập";
      const targetKind: TransactionType = isIncome ? "income" : "expense";
      const matchedCat = matchCategoryRecord(predictedCategory, userCategories, targetKind);

      const parsedAmt = parseVietnameseAmount(text);
      const matchedWal = matchWalletFromText(text, userWallets);
      const title = cleanTransactionTitle(text, parsedAmt.matchedStr);

      finalData = {
        transaction_type: targetKind,
        amount: parsedAmt.amount,
        currency: "VND",
        category_id: matchedCat?.id ?? null,
        category_name: matchedCat?.name ?? predictedCategory,
        wallet_id: matchedWal?.id ?? null,
        wallet_name: matchedWal?.name ?? null,
        description: title,
        date: clientDate,
        time: null,
        confidence_notes: [
          `Phân loại bằng ${source} (độ tin cậy: ${Math.round(confidence * 100)}%)`,
        ],
      };
    }

    const latencyMs = Date.now() - t0;

    return NextResponse.json({
      success: true,
      category: predictedCategory,
      confidence,
      source,
      fallback,
      latency_ms: latencyMs,
      data: finalData,
    });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/ai/parse-transaction] Unhandled error:", err);
    return NextResponse.json({ error: "Lỗi máy chủ." }, { status: 500 });
  }
}
