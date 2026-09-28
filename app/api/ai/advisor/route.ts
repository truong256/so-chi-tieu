/**
 * app/api/ai/advisor/route.ts
 * ===========================
 * POST /api/ai/advisor
 *
 * Shadow-mode financial advisor endpoint.
 * - Requires valid Supabase Bearer token.
 * - user_id in financial_summary is forced to authenticated user's ID.
 * - Result is ADVISORY ONLY — never writes budgets or transactions.
 */

import { NextResponse } from "next/server";
import { aiAdvisor } from "@/backend/src/services/ai-local.client";
import type { AdvisorRequest, FinancialSummary, CategoryItem, WalletItem, SavingsGoalItem } from "@/backend/src/services/ai-local.client";
import {
  AuthenticationError,
  extractBearerToken,
  verifySupabaseAccessToken,
} from "@/backend/src/services/supabase-auth.service";
import { HttpInputError, asRecord, readJsonBody } from "@/backend/src/services/http-input.service";

export const runtime = "nodejs";
export const maxDuration = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function parseCategories(raw: unknown): CategoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).map((item) => {
    const r = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    return {
      name: safeString(r.name, "Unknown"),
      kind: safeString(r.kind, "expense"),
      budget: safeNumber(r.budget),
      amount: safeNumber(r.amount),
    };
  });
}

function parseWallets(raw: unknown): WalletItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map((item) => {
    const r = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    return {
      name: safeString(r.name, "Unknown"),
      balance: safeNumber(r.balance),
    };
  });
}

function parseSavingsGoals(raw: unknown): SavingsGoalItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map((item) => {
    const r = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    return {
      name: safeString(r.name, "Unknown"),
      target: safeNumber(r.target),
      current: safeNumber(r.current),
      monthly_target: safeNumber(r.monthly_target),
    };
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
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
    const body = asRecord(await readJsonBody(request, 64 * 1024));
    const fs = typeof body.financial_summary === "object" && body.financial_summary !== null
      ? (body.financial_summary as Record<string, unknown>)
      : {};

    // 3. Build payload — force user_id to session user (no spoofing)
    const financialSummary: FinancialSummary = {
      income: safeNumber(fs.income),
      expense: safeNumber(fs.expense),
      previous_month_expense:
        typeof fs.previous_month_expense === "number" ? fs.previous_month_expense : undefined,
      categories: parseCategories(fs.categories),
      wallets: parseWallets(fs.wallets),
      savings_goals: parseSavingsGoals(fs.savings_goals),
      user_id: user.id, // always bound to session user
      month:
        typeof fs.month === "string" && /^\d{4}-\d{2}$/.test(fs.month)
          ? fs.month
          : new Date().toISOString().slice(0, 7),
    };

    const advisorReq: AdvisorRequest = {
      financial_summary: financialSummary,
      classification:
        typeof body.classification === "object" && body.classification !== null
          ? (body.classification as Record<string, unknown>)
          : undefined,
      forecast:
        typeof body.forecast === "object" && body.forecast !== null
          ? (body.forecast as Record<string, unknown>)
          : undefined,
      risk:
        typeof body.risk === "object" && body.risk !== null
          ? (body.risk as Record<string, unknown>)
          : undefined,
    };

    // 4. Call AI service with session userId for canary routing
    const result = await aiAdvisor(advisorReq, { userId: user.id, preferredVersion: "v3" });

    if (!result.ok || !result.data) {
      // Deterministic rule-based fallback when AI service is offline
      const income = financialSummary.income;
      const expense = financialSummary.expense;
      const net = income - expense;
      const savingsRate = income > 0 ? net / income : 0;
      let healthGrade = "HEALTHY";
      let riskScore = 0.25;
      let summary = `Tài chính tháng này: Thu nhập ${income.toLocaleString("vi-VN")}đ, chi tiêu ${expense.toLocaleString("vi-VN")}đ. Tỷ lệ tiết kiệm ${(savingsRate * 100).toFixed(0)}%.`;
      const warnings: string[] = [];
      const suggestions: string[] = [];

      if (income <= 0 && expense <= 0) {
        summary = "Chưa ghi nhận dữ liệu thu chi trong tháng này. Hãy thêm giao dịch để nhận phân tích chi tiết.";
        healthGrade = "HEALTHY";
        riskScore = 0.0;
      } else if (expense > income) {
        healthGrade = "CRITICAL";
        riskScore = 0.85;
        summary = `Cảnh báo thâm hụt: Chi tiêu ${expense.toLocaleString("vi-VN")}đ vượt thu nhập ${income.toLocaleString("vi-VN")}đ (${Math.abs(net).toLocaleString("vi-VN")}đ).`;
        warnings.push("Chi tiêu vượt quá tổng thu nhập trong tháng.");
        suggestions.push("Cắt giảm các khoản chi không thiết yếu để đưa cán cân tài chính về mức dương.");
      } else if (savingsRate < 0.2) {
        healthGrade = "CAUTION";
        riskScore = 0.5;
        warnings.push("Tỷ lệ tiết kiệm hiện dưới mức khuyến nghị 20%.");
        suggestions.push("Xem xét tối ưu hóa ngân sách mua sắm và giải trí.");
      } else {
        suggestions.push("Duy trì tốc độ tích lũy hiện tại và chuyển phần thặng dư vào quỹ dự phòng.");
      }

      console.log(
        `[AI_ADVISOR] source=heuristic fallback=true reason=${result.error ?? "ai_service_offline"} endpoint=/api/ai/advisor`,
      );

      return NextResponse.json({
        ok: true,
        advisory: true,
        fallback: true,
        source: "deterministic_rule_fallback",
        data: {
          summary,
          warnings,
          suggestions,
          confidence: 0.7,
          model_version: "rule_fallback",
          health_grade: healthGrade,
          risk_score: riskScore,
          advisory: true,
          meta: {
            model: "advisor",
            version: "rule_fallback",
            latency_ms: 1,
            fallback_used: true,
            advisory: true,
          },
        },
      });
    }

    console.log(
      `[AI_ADVISOR] source=model_advisor version=${result.data.model_version} confidence=${result.data.confidence} fallback=false endpoint=/api/ai/advisor`,
    );

    return NextResponse.json({
      ok: true,
      advisory: true,
      source: "model_advisor",
      fallback: false,
      data: result.data,
      meta: result.data.meta,
    });
  } catch (err) {
    if (err instanceof AuthenticationError || err instanceof HttpInputError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[/api/ai/advisor] Unhandled error:", err);
    return NextResponse.json({ error: "Lỗi máy chủ." }, { status: 500 });
  }
}
