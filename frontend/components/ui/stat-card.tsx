"use client";

import React from "react";

export interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: {
    direction: "up" | "down" | "neutral";
    text: string;
  };
  variant?: "income" | "expense" | "savings" | "neutral" | "dark";
  icon?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function StatCard({
  label,
  value,
  subtext,
  trend,
  variant = "neutral",
  icon,
  className = "",
  onClick,
}: StatCardProps) {
  const isDark = variant === "dark";
  const isClickable = Boolean(onClick);

  return (
    <div
      className={`ui-stat-card ui-stat-card-${variant} ${className}`.trim()}
      onClick={onClick}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      style={{
        background: isDark ? "var(--sidebar-bg, #151d1f)" : "var(--white, #ffffff)",
        color: isDark ? "#ffffff" : "var(--text-dark, #141c1e)",
        borderRadius: "16px",
        padding: "20px",
        border: isDark ? "1px solid var(--sidebar-border, #253032)" : "1px solid var(--border-light, #e5ece8)",
        boxShadow: isDark
          ? "0 4px 20px rgba(0, 0, 0, 0.25)"
          : "0 2px 4px rgba(0, 0, 0, 0.03), 0 6px 12px -2px rgba(0, 0, 0, 0.05)",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        cursor: isClickable ? "pointer" : "default",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: isDark ? "var(--sidebar-text-muted, #a3b2b5)" : "var(--text-subtle, #546366)",
          }}
        >
          {label}
        </span>
        {icon && (
          <span style={{ fontSize: "16px", opacity: 0.85 }}>{icon}</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <strong
          style={{
            fontSize: "24px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            color:
              variant === "income"
                ? "var(--income-green-text, #2e7d32)"
                : variant === "expense"
                ? "var(--expense-red-text, #d32f2f)"
                : isDark
                ? "var(--lime-accent, #d2f544)"
                : "var(--text-dark, #141c1e)",
          }}
        >
          {value}
        </strong>
      </div>

      {(subtext || trend) && (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px" }}>
          {trend && (
            <span
              style={{
                fontWeight: 700,
                color:
                  trend.direction === "up"
                    ? "#2e7d32"
                    : trend.direction === "down"
                    ? "#d32f2f"
                    : "var(--text-subtle, #546366)",
              }}
            >
              {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "•"} {trend.text}
            </span>
          )}
          {subtext && (
            <span
              style={{
                color: isDark ? "rgba(255, 255, 255, 0.65)" : "var(--text-subtle, #546366)",
              }}
            >
              {subtext}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
