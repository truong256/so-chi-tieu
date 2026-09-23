"use client";

import React from "react";

interface AdminStatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  trend?: {
    text: string;
    isPositive?: boolean;
  };
  variant?: "default" | "dark" | "highlight";
}

export default function AdminStatCard({
  label,
  value,
  sublabel,
  trend,
  variant = "default",
}: AdminStatCardProps) {
  const cardClass =
    variant === "dark"
      ? "admin-stat-card dark"
      : variant === "highlight"
      ? "admin-stat-card highlight"
      : "admin-stat-card";

  return (
    <div className={cardClass}>
      <span className="admin-stat-label">{label}</span>
      <div className="admin-stat-value">{value}</div>
      {(sublabel || trend) && (
        <div className="admin-stat-footer">
          {trend && (
            <span
              className={`admin-stat-trend ${
                trend.isPositive ? "trend-up" : "trend-down"
              }`}
            >
              {trend.text}
            </span>
          )}
          {sublabel && <span className="admin-stat-sublabel">{sublabel}</span>}
        </div>
      )}
    </div>
  );
}
