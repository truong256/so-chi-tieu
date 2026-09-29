/**
 * frontend/components/ai-classify-hint.tsx
 * ==========================================
 * "use client" — Inline category suggestion chip shown in transaction form.
 *
 * Usage:
 *   <AiClassifyHint
 *     token={token}
 *     text={descriptionText}
 *     onAccept={(category) => setCategory(category)}
 *   />
 *
 * The user must click "Áp dụng" to accept — AI never auto-sets the category.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { aiSuggestCategory, aiSendFeedback, type ClassifySuggestion } from "@/frontend/services/ai.service";

export interface AiClassifyHintProps {
  token: string;
  /** The transaction description text to classify */
  text: string;
  /** Called when user explicitly accepts the AI suggestion */
  onAccept: (category: string) => void;
  className?: string;
}

const DEBOUNCE_MS = 700;
const MIN_TEXT_LEN = 3;

export default function AiClassifyHint({
  token,
  text,
  onAccept,
  className = "",
}: AiClassifyHintProps) {
  const [suggestion, setSuggestion] = useState<ClassifySuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef("");

  const fetchSuggestion = useCallback(
    async (t: string) => {
      if (!token || t.length < MIN_TEXT_LEN) {
        setSuggestion(null);
        return;
      }
      setLoading(true);
      const res = await aiSuggestCategory(token, t);
      if (res.ok && res.data) {
        setSuggestion(res.data);
      } else {
        setSuggestion(null);
      }
      setLoading(false);
    },
    [token],
  );

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === lastTextRef.current) return;
    lastTextRef.current = trimmed;
    setDismissed(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggestion(trimmed);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, fetchSuggestion]);

  const handleAccept = () => {
    if (suggestion) {
      onAccept(suggestion.category);
      const band = suggestion.confidence >= 0.60 ? "HIGH" : suggestion.confidence >= 0.40 ? "MEDIUM" : "LOW";
      void aiSendFeedback(token, {
        suggested_category: suggestion.category,
        final_category: suggestion.category,
        model_version: suggestion.meta?.version || "v3",
        confidence_band: band,
        accepted: true,
        latency_ms: suggestion.meta?.latency_ms,
      });
    }
    setDismissed(true);
  };

  const handleDismiss = () => {
    if (suggestion) {
      const band = suggestion.confidence >= 0.60 ? "HIGH" : suggestion.confidence >= 0.40 ? "MEDIUM" : "LOW";
      void aiSendFeedback(token, {
        suggested_category: suggestion.category,
        final_category: "dismissed",
        model_version: suggestion.meta?.version || "v3",
        confidence_band: band,
        accepted: false,
      });
    }
    setDismissed(true);
  };

  if (dismissed || (!loading && !suggestion)) return null;

  return (
    <div
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        background: "rgba(129,140,248,0.08)",
        border: "1px solid rgba(129,140,248,0.22)",
        borderRadius: 20,
        fontSize: 12,
        color: "#94a3b8",
        userSelect: "none",
      }}
      role="status"
      aria-live="polite"
      aria-label="Gợi ý danh mục giao dịch"
      title="Dựa vào nội dung bạn nhập, hệ thống gợi ý danh mục phù hợp. Bạn có thể chọn danh mục khác nếu gợi ý chưa phù hợp."
    >
      {loading ? (
        <>
          <span style={{ fontSize: 12, color: "#818cf8" }}>✦</span>
          <span style={{ color: "#818cf8" }}>Đang tìm danh mục phù hợp…</span>
        </>
      ) : suggestion ? (
        <>
          <span style={{ fontSize: 12, color: "#818cf8" }}>✦</span>
          <span>
            Danh mục đề xuất:{" "}
            <strong style={{ color: "#c7d2fe" }}>{suggestion.category}</strong>
            {suggestion.confidence < 0.40 ? (
              <span style={{ color: "#f59e0b", marginLeft: 4, fontSize: 11 }}>
                (Gợi ý tham khảo: {Math.round(suggestion.confidence * 100)}%)
              </span>
            ) : (
              <span style={{ color: "#94a3b8", marginLeft: 4, fontSize: 11 }}>
                (Mức độ tin cậy: {Math.round(suggestion.confidence * 100)}%)
              </span>
            )}
          </span>
          <button
            id="ai-classify-accept-btn"
            onClick={handleAccept}
            title="Áp dụng danh mục này vào giao dịch"
            style={{
              padding: "3px 10px",
              background: "rgba(129,140,248,0.2)",
              border: "1px solid rgba(129,140,248,0.4)",
              borderRadius: 12,
              color: "#c7d2fe",
              fontSize: 11,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Áp dụng gợi ý
          </button>
          <button
            id="ai-classify-dismiss-btn"
            onClick={handleDismiss}
            style={{
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 12,
              lineHeight: 1,
              padding: "2px 4px",
            }}
            aria-label="Bỏ qua gợi ý danh mục"
            title="Bỏ qua gợi ý"
          >
            ✕
          </button>
        </>
      ) : null}
    </div>
  );
}
