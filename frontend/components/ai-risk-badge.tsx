/**
 * frontend/components/ai-risk-badge.tsx
 * =======================================
 * "use client" — Small risk assessment badge shown on transaction card / form.
 *
 * Usage:
 *   <AiRiskBadge
 *     token={token}
 *     amount={transaction.amount}
 *     cardType="Credit"
 *     cardBrand="Visa"
 *   />
 *
 * ADVISORY ONLY — never blocks the transaction.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { aiAssessRisk, type RiskSuggestion, type RiskLevel } from "@/frontend/services/ai.service";

export interface AiRiskBadgeProps {
  token: string;
  amount: number;
  creditLimit?: number;
  cardId?: string;
  cardBrand?: string;
  cardType?: string;
  mcc?: number;
  className?: string;
}

const LEVEL_CONFIG: Record<RiskLevel, { label: string; color: string; bg: string; icon: string }> = {
  SAFE: { label: "Bình thường", color: "#22c55e", bg: "rgba(34,197,94,0.1)", icon: "✓" },
  WARNING: { label: "Cần lưu ý", color: "#eab308", bg: "rgba(234,179,8,0.1)", icon: "⚠" },
  DANGER: { label: "Dấu hiệu bất thường", color: "#ef4444", bg: "rgba(239,68,68,0.1)", icon: "!" },
};

export default function AiRiskBadge({
  token,
  amount,
  creditLimit,
  cardId,
  cardBrand = "Visa",
  cardType = "Credit",
  mcc = 5411,
  className = "",
}: AiRiskBadgeProps) {
  const [risk, setRisk] = useState<RiskSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const lastAmountRef = useRef<number>(0);

  const displayRisk = !token || amount <= 0 ? null : risk;

  useEffect(() => {
    if (!token || amount <= 0) {
      return;
    }
    if (lastAmountRef.current === amount) return;
    lastAmountRef.current = amount;

    setLoading(true);
    let cancelled = false;
    void aiAssessRisk(token, {
      amount,
      credit_limit: creditLimit,
      card_id: cardId,
      card_brand: cardBrand,
      card_type: cardType,
      mcc,
      hour: new Date().getHours(),
      day_of_week: new Date().getDay(),
      month: new Date().getMonth() + 1,
    }).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) setRisk(res.data);
      else setRisk(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [token, amount, creditLimit, cardId, cardBrand, cardType, mcc]);

  if (loading) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: "#818cf8",
          opacity: 0.6,
        }}
      >
        ✦ Đánh giá rủi ro…
      </span>
    );
  }

  if (!displayRisk) return null;

  const cfg = LEVEL_CONFIG[displayRisk.risk_level] ?? LEVEL_CONFIG.SAFE;

  return (
    <div className={className} style={{ position: "relative", display: "inline-block" }}>
      <button
        id="ai-risk-badge-toggle"
        onClick={() => setShowDetail((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "3px 10px",
          background: cfg.bg,
          border: `1px solid ${cfg.color}44`,
          borderRadius: 20,
          cursor: "pointer",
          fontSize: 11,
          color: cfg.color,
          fontWeight: 600,
        }}
        aria-label={`AI đánh giá rủi ro: ${cfg.label}`}
        aria-expanded={showDetail}
      >
        <span style={{ fontSize: 12 }}>{cfg.icon}</span>
        {cfg.label}
        <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>
          ({Math.round(displayRisk.fraud_probability * 100)}%)
        </span>
      </button>

      {showDetail && displayRisk.risk_indicators.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 200,
            background: "#0f111e",
            border: `1px solid ${cfg.color}33`,
            borderRadius: 10,
            padding: "10px 14px",
            minWidth: 220,
            boxShadow: `0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px ${cfg.color}22`,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>
            ✦ Tín hiệu rủi ro thử nghiệm (Warning V3 Experimental)
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            {displayRisk.risk_indicators.map((ind, i) => (
              <li key={i} style={{ fontSize: 11, color: "#cbd5e1", display: "flex", gap: 6 }}>
                <span style={{ color: cfg.color }}>•</span>
                {ind}
              </li>
            ))}
          </ul>
          <div
            style={{
              fontSize: 10,
              color: "#64748b",
              marginTop: 8,
              paddingTop: 6,
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            Nguồn: Warning V3 (Experimental) — Chỉ mang tính tham khảo, không tự động chặn giao dịch
          </div>
        </div>
      )}
    </div>
  );
}
