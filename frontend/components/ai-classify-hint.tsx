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
import { aiSuggestCategory, type ClassifySuggestion } from "@/frontend/services/ai.service";

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
      aria-label="AI gợi ý danh mục"
    >
      {loading ? (
        <>
          <span style={{ fontSize: 12, color: "#818cf8" }}>✦</span>
          <span style={{ color: "#818cf8" }}>AI đang phân tích…</span>
        </>
      ) : suggestion ? (
        <>
          <span style={{ fontSize: 12, color: "#818cf8" }}>✦</span>
          <span>
            AI gợi ý:{" "}
            <strong style={{ color: "#c7d2fe" }}>{suggestion.category}</strong>
            {suggestion.confidence < 0.35 ? (
              <span style={{ color: "#f59e0b", marginLeft: 4, fontSize: 11 }}>
                (AI chưa chắc chắn — {Math.round(suggestion.confidence * 100)}%)
              </span>
            ) : suggestion.confidence < 0.50 ? (
              <span style={{ color: "#94a3b8", marginLeft: 4, fontSize: 11 }}>
                ({Math.round(suggestion.confidence * 100)}% tin cậy)
              </span>
            ) : null}
          </span>
          <button
            id="ai-classify-accept-btn"
            onClick={() => {
              if (suggestion) onAccept(suggestion.category);
              setDismissed(true);
            }}
            style={{
              padding: "2px 9px",
              background: "rgba(129,140,248,0.2)",
              border: "1px solid rgba(129,140,248,0.4)",
              borderRadius: 12,
              color: "#c7d2fe",
              fontSize: 11,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Áp dụng
          </button>
          <button
            id="ai-classify-dismiss-btn"
            onClick={() => setDismissed(true)}
            style={{
              background: "none",
              border: "none",
              color: "#475569",
              cursor: "pointer",
              fontSize: 13,
              lineHeight: 1,
              padding: 0,
            }}
            aria-label="Bỏ qua gợi ý AI"
          >
            ✕
          </button>
        </>
      ) : null}
    </div>
  );
}
