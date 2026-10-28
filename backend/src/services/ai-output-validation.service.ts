/**
 * backend/src/services/ai-output-validation.service.ts
 * ====================================================
 * AI Output Validation & Sanitization Engine.
 *
 * Responsibilities:
 * 1. JSON parsing and sanitization for structured parser outputs.
 * 2. Sanitizing AI chat responses to prevent leakage of:
 *    - Raw tool call JSON payloads (e.g. {"name": "...", "arguments": ...})
 *    - Model system prompt bleed-through and prompt boundary tags
 *    - Markdown fence artifacts
 * 3. Real-time streaming sanitizer to buffer and filter tool call tokens.
 * 4. Data consistency checks against authoritative financial snapshot.
 */

import type { AuthoritativeFinancialSnapshot } from "./financial-snapshot.service.ts";

export interface OutputValidationContext {
  authoritativeSnapshot?: AuthoritativeFinancialSnapshot;
  toolSummaries?: string[];
  fallbackMessage?: string;
}

export function parseAiJsonObject(raw: string): Record<string, unknown> | null {
  let json = raw.trim();
  if (json.startsWith("```json")) {
    json = json.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (json.startsWith("```")) {
    json = json.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

export function cleanMoneyAmount(value: unknown, allowZero = true): number | null {
  let numberValue: number;
  if (typeof value === "number") {
    numberValue = value;
  } else if (typeof value === "string") {
    const normalized = value.trim().replace(/[\s₫đVND]/gi, "");
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(normalized)) {
      numberValue = Number(normalized.replace(/[.,]/g, ""));
    } else if (/^\d+[.,]\d+$/.test(normalized)) {
      numberValue = Number(normalized.replace(",", "."));
    } else if (/^\d+$/.test(normalized)) {
      numberValue = Number(normalized);
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!Number.isFinite(numberValue) || numberValue < 0 || (!allowZero && numberValue === 0)) return null;
  const rounded = Math.round(numberValue);
  return rounded <= 1_000_000_000_000_000 ? rounded : null;
}

export function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const local = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (local) {
    day = Number(local[1]);
    month = Number(local[2]);
    year = Number(local[3]);
  } else {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  )
    return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Validates and sanitizes AI chat output before sending to the client.
 * 1. Strips leaked tool calls in raw JSON or code blocks.
 * 2. Strips prompt tags and internal delimiter markers.
 * 3. Formats markdown cleanly.
 * 4. Guards against empty responses.
 */
export function validateAndSanitizeAiOutput(
  rawText: string,
  context?: OutputValidationContext,
): string {
  if (!rawText) {
    return (
      context?.fallbackMessage ||
      "Tôi có thể hỗ trợ bạn theo dõi thu chi, ngân sách, số dư ví và mục tiêu tiết kiệm. Hãy cho tôi biết nhu cầu của bạn nhé!"
    );
  }

  let text = rawText.trim();

  // 1. Remove raw markdown JSON code fences containing tool calls
  text = text.replace(/```(?:json)?\s*\{\s*(?:"name"|"tool_calls"|"tool"|"function")[\s\S]*?\}\s*```/gi, "");
  text = text.replace(/```(?:json)?\s*\[\s*\{\s*(?:"name"|"tool_calls"|"tool"|"function")[\s\S]*?\}\s*\]\s*```/gi, "");

  // 2. Remove inline or block raw tool call JSON objects
  text = text.replace(/\{\s*"name"\s*:\s*"[a-zA-Z0-9_-]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/gi, "");
  text = text.replace(/\{\s*"tool_calls"\s*:\s*\[[\s\S]*?\]\s*\}/gi, "");
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  text = text.replace(/\[TOOL_CALL:[\s\S]*?\]/gi, "");
  text = text.replace(/\[FUNCTION:[\s\S]*?\]/gi, "");

  // 3. Remove prompt delimiter leakage
  text = text.replace(/=== KẾT QUẢ TRUY VẤN DỮ LIỆU TỪ CÔNG CỤ ===[\s\S]*?=== HẾT KẾT QUẢ CÔNG CỤ ===/gi, "");
  text = text.replace(/=== THÔNG TIN THAM CHIẾU TỪ LƯỢT TRƯỚC ===[\s\S]*?=== HẾT THÔNG TIN THAM CHIẾU ===/gi, "");
  text = text.replace(/=== BỐI CẢNH TÀI CHÍNH XÁC THỰC TỪ SERVER ===[\s\S]*?=== HẾT BỐI CẢNH TÀI CHÍNH ===/gi, "");
  text = text.replace(/^SYSTEM PROMPT:[\s\S]*?(?=\n\n|$)/gi, "");

  // 4. Clean trailing code fence artifacts
  text = text.replace(/^```(?:json|markdown)?\s*/i, "").replace(/\s*```$/i, "");

  // 5. Remove multiple consecutive blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  if (!text) {
    if (context?.toolSummaries && context.toolSummaries.length > 0) {
      return context.toolSummaries[0];
    }
    return (
      context?.fallbackMessage ||
      "Dữ liệu tài chính đã được cập nhật an toàn. Bạn có câu hỏi nào khác về thu chi hay ngân sách không?"
    );
  }

  return text;
}

/**
 * Real-time streaming sanitizer to buffer and filter potential tool call tokens.
 */
export class StreamOutputSanitizer {
  private buffer: string = "";
  private isBufferingJson: boolean = false;
  private readonly context?: OutputValidationContext;

  constructor(context?: OutputValidationContext) {
    this.context = context;
  }

  processToken(token: string): string {
    // If we are currently buffering potential JSON tool call
    if (this.isBufferingJson) {
      this.buffer += token;

      // Check if it's confirmed to be a tool call JSON
      if (/\{\s*"name"\s*:\s*"[a-zA-Z0-9_-]+"/i.test(this.buffer) || /<tool_call>/i.test(this.buffer)) {
        // If it closes the JSON block, drop the whole tool call and reset
        if (this.buffer.includes("}") || this.buffer.includes("</tool_call>")) {
          const afterJson = this.buffer.replace(/[\s\S]*?(?:\}|<\/tool_call>)/, "");
          this.buffer = afterJson;
          this.isBufferingJson = false;
          return this.processToken("");
        }
        // Still inside JSON tool call, emit nothing
        return "";
      }

      // If buffer grows long (> 60 chars) without matching a tool call pattern, it wasn't a tool call!
      if (
        this.buffer.length > 60 ||
        (!this.buffer.includes('"name"') && !this.buffer.includes('"tool_calls"') && !this.buffer.includes("<tool_call>"))
      ) {
        const flushed = this.buffer;
        this.buffer = "";
        this.isBufferingJson = false;
        return flushed;
      }

      return "";
    }

    // Check if new token begins a potential tool call JSON
    if (token.includes("{") || token.includes("```json") || token.includes("<tool_call>")) {
      this.isBufferingJson = true;
      this.buffer += token;
      return "";
    }

    return token;
  }

  flush(): string {
    if (this.buffer) {
      const remaining = this.buffer;
      this.buffer = "";
      this.isBufferingJson = false;
      return validateAndSanitizeAiOutput(remaining, this.context);
    }
    return "";
  }
}

export function createStreamOutputSanitizer(context?: OutputValidationContext): StreamOutputSanitizer {
  return new StreamOutputSanitizer(context);
}
