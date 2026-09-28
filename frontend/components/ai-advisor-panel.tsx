/**
 * frontend/components/ai-advisor-panel.tsx
 * =========================================
 * "use client" — Shadow-mode AI Advisory Panel
 *
 * Displays financial insights from the FastAPI AI service as
 * ADVISORY SUGGESTIONS only. Never writes to Supabase directly.
 *
 * Usage:
 *   <AiAdvisorPanel
 *     token={supabaseToken}
 *     financialSummary={{ income, expense, categories, wallets, month }}
 *   />
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  aiGetAdvisory,
  aiGetForecast,
  type AdvisorSuggestion,
  type DailyForecastItem,
} from "@/frontend/services/ai.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdvisorCategory {
  name: string;
  kind?: string;
  budget?: number;
  amount?: number;
}

export interface AdvisorWallet {
  name: string;
  balance?: number;
}

export interface AdvisorSavingsGoal {
  name: string;
  target?: number;
  current?: number;
  monthly_target?: number;
}

export interface AiAdvisorPanelProps {
  token: string;
  financialSummary: {
    income: number;
    expense: number;
    previous_month_expense?: number;
    categories?: AdvisorCategory[];
    wallets?: AdvisorWallet[];
    savings_goals?: AdvisorSavingsGoal[];
    month?: string;
  };
  forecastDays?: number;
  forecastHistory?: Array<{ date: string; amount: number }>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gradeColor(grade?: string): string {
  if (!grade) return "#8b8fa8";
  const g = grade.toUpperCase();
  if (g === "A") return "#22c55e";
  if (g === "B") return "#84cc16";
  if (g === "C") return "#eab308";
  if (g === "D") return "#f97316";
  return "#ef4444";
}

function riskScoreColor(score?: number): string {
  if (score === undefined) return "#8b8fa8";
  if (score < 0.3) return "#22c55e";
  if (score < 0.6) return "#eab308";
  return "#ef4444";
}

function confidencePct(c: number): string {
  return `${Math.round(c * 100)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--ai-accent, #818cf8)",
            animation: `ai-dot-bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
          }}
        />
      ))}
    </span>
  );
}

function AiBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.05em",
        color: "#818cf8",
        background: "rgba(129,140,248,0.12)",
        border: "1px solid rgba(129,140,248,0.25)",
        borderRadius: 20,
        padding: "2px 8px",
      }}
    >
      ✦ {label}
    </span>
  );
}

interface ForecastMiniChartProps {
  items: DailyForecastItem[];
}

function ForecastMiniChart({ items }: ForecastMiniChartProps) {
  if (!items.length) return null;

  const max = Math.max(...items.map((d) => d.predicted_spending), 1);
  const width = 280;
  const height = 60;
  const step = width / (items.length - 1 || 1);

  const points = items.map((d, i) => ({
    x: i * step,
    y: height - (d.predicted_spending / max) * (height - 8) - 4,
    v: d.predicted_spending,
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = [
    `M ${points[0].x},${height}`,
    ...points.map((p) => `L ${p.x},${p.y}`),
    `L ${points[points.length - 1].x},${height}`,
    "Z",
  ].join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: 60, overflow: "visible" }}
      aria-label="Biểu đồ dự báo chi tiêu"
    >
      <defs>
        <linearGradient id="ai-forecast-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ai-forecast-grad)" />
      <polyline
        points={polyline}
        fill="none"
        stroke="#818cf8"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AiAdvisorPanel({
  token,
  financialSummary,
  forecastDays = 14,
  forecastHistory,
  className = "",
}: AiAdvisorPanelProps) {
  const [advisor, setAdvisor] = useState<AdvisorSuggestion | null>(null);
  const [forecast, setForecast] = useState<DailyForecastItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const fetchedRef = useRef(false);

  const load = useCallback(async () => {
    if (!token || loading) return;
    setLoading(true);
    setError(null);

    const [advisorRes, forecastRes] = await Promise.all([
      aiGetAdvisory(token, { financial_summary: financialSummary }),
      aiGetForecast(token, forecastDays, forecastHistory),
    ]);

    if (advisorRes.ok && advisorRes.data) {
      setAdvisor(advisorRes.data);
    } else {
      setError(advisorRes.error ?? "Không thể tải phân tích AI.");
    }

    if (forecastRes.ok && forecastRes.data) {
      setForecast(forecastRes.data.forecast ?? []);
    }

    setLoading(false);
  }, [token, financialSummary, forecastDays, forecastHistory, loading]);

  // Auto-load when panel opens for first time
  useEffect(() => {
    if (isOpen && !fetchedRef.current && token) {
      fetchedRef.current = true;
      void load();
    }
  }, [isOpen, load, token]);

  return (
    <div
      className={className}
      style={{
        background: "rgba(15,17,30,0.75)",
        border: "1px solid rgba(129,140,248,0.18)",
        borderRadius: 16,
        overflow: "hidden",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* ---- keyframes (injected once) ---- */}
      <style>{`
        @keyframes ai-dot-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes ai-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ---- Header ---- */}
      <button
        id="ai-advisor-panel-toggle"
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "#e2e8f0",
        }}
        aria-expanded={isOpen}
        aria-controls="ai-advisor-panel-body"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0" }}>
            Phân tích tài chính AI
          </span>
          <AiBadge label="ADVISORY" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {loading && <LoadingDots />}
          <span style={{ color: "#818cf8", fontSize: 13 }}>{isOpen ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* ---- Body ---- */}
      {isOpen && (
        <div
          id="ai-advisor-panel-body"
          style={{
            padding: "0 18px 18px",
            animation: "ai-fade-in 0.25s ease",
          }}
        >
          {/* Disclaimer banner */}
          <div
            style={{
              fontSize: 11,
              color: "#94a3b8",
              background: "rgba(129,140,248,0.06)",
              border: "1px solid rgba(129,140,248,0.15)",
              borderRadius: 8,
              padding: "6px 12px",
              marginBottom: 14,
              lineHeight: 1.6,
            }}
          >
            ⚠ Đây là gợi ý từ mô hình AI, mang tính tham khảo. Không tự động
            thay đổi dữ liệu của bạn.
          </div>

          {/* Error state */}
          {error && !loading && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12 }}>
              {error}
              <button
                id="ai-advisor-retry-btn"
                onClick={() => { fetchedRef.current = false; void load(); }}
                style={{
                  marginLeft: 10,
                  color: "#818cf8",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  textDecoration: "underline",
                }}
              >
                Thử lại
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !advisor && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[120, 80, 100].map((w, i) => (
                <div
                  key={i}
                  style={{
                    height: 14,
                    width: `${w}px`,
                    borderRadius: 6,
                    background: "rgba(129,140,248,0.12)",
                    animation: "ai-dot-bounce 1.4s ease-in-out infinite",
                  }}
                />
              ))}
            </div>
          )}

          {/* Advisor content */}
          {advisor && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Grade + Risk + Confidence row */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {advisor.health_grade && (
                  <div
                    style={{
                      flex: 1,
                      minWidth: 80,
                      textAlign: "center",
                      background: "rgba(15,17,30,0.6)",
                      border: `1px solid ${gradeColor(advisor.health_grade)}44`,
                      borderRadius: 12,
                      padding: "10px 6px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        color: gradeColor(advisor.health_grade),
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {advisor.health_grade}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                      Sức khỏe tài chính
                    </div>
                  </div>
                )}
                {advisor.risk_score !== undefined && (
                  <div
                    style={{
                      flex: 1,
                      minWidth: 80,
                      textAlign: "center",
                      background: "rgba(15,17,30,0.6)",
                      border: `1px solid ${riskScoreColor(advisor.risk_score)}44`,
                      borderRadius: 12,
                      padding: "10px 6px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: riskScoreColor(advisor.risk_score),
                      }}
                    >
                      {Math.round(advisor.risk_score * 100)}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                      Điểm rủi ro
                    </div>
                  </div>
                )}
                <div
                  style={{
                    flex: 1,
                    minWidth: 80,
                    textAlign: "center",
                    background: "rgba(15,17,30,0.6)",
                    border: "1px solid rgba(129,140,248,0.2)",
                    borderRadius: 12,
                    padding: "10px 6px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: "#818cf8",
                    }}
                  >
                    {confidencePct(advisor.confidence)}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                    Độ tin cậy
                  </div>
                </div>
              </div>

              {/* Summary */}
              <div
                style={{
                  fontSize: 13,
                  color: "#cbd5e1",
                  lineHeight: 1.7,
                  padding: "10px 12px",
                  background: "rgba(129,140,248,0.06)",
                  borderRadius: 10,
                  borderLeft: "3px solid #818cf8",
                }}
              >
                {advisor.summary}
              </div>

              {/* Warnings */}
              {advisor.warnings.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24", marginBottom: 6 }}>
                    ⚠ Cảnh báo
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                    {advisor.warnings.map((w, i) => (
                      <li key={i} style={{ fontSize: 12, color: "#fde68a", lineHeight: 1.55 }}>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggestions */}
              {advisor.suggestions.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#86efac", marginBottom: 6 }}>
                    💡 Gợi ý
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                    {advisor.suggestions.map((s, i) => (
                      <li key={i} style={{ fontSize: 12, color: "#bbf7d0", lineHeight: 1.55 }}>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Forecast chart */}
              {forecast.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>
                    📈 Dự báo chi tiêu {forecastDays} ngày tới
                  </div>
                  <ForecastMiniChart items={forecast} />
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 10,
                      color: "#64748b",
                      marginTop: 4,
                    }}
                  >
                    <span>{forecast[0]?.date ?? ""}</span>
                    <span>{forecast[forecast.length - 1]?.date ?? ""}</span>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 4,
                }}
              >
                <span style={{ fontSize: 10, color: "#475569" }}>
                  {advisor.model_version}
                </span>
                <button
                  id="ai-advisor-refresh-btn"
                  onClick={() => { fetchedRef.current = false; setAdvisor(null); setForecast([]); void load(); }}
                  style={{
                    fontSize: 11,
                    color: "#818cf8",
                    background: "none",
                    border: "1px solid rgba(129,140,248,0.25)",
                    borderRadius: 6,
                    padding: "3px 10px",
                    cursor: "pointer",
                  }}
                >
                  ↻ Làm mới
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
