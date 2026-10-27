"use client";

import React from "react";

export type BadgeVariant = "success" | "danger" | "warning" | "info" | "neutral" | "primary";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "sm" | "md";
  children: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; border: string }> = {
  success: {
    bg: "#e6f8dc",
    text: "#1b5e20",
    border: "rgba(46, 125, 50, 0.2)",
  },
  danger: {
    bg: "#fce8e6",
    text: "#b71c1c",
    border: "rgba(211, 47, 47, 0.2)",
  },
  warning: {
    bg: "#fff8e1",
    text: "#b78103",
    border: "rgba(245, 158, 11, 0.2)",
  },
  info: {
    bg: "#e3f2fd",
    text: "#0d47a1",
    border: "rgba(30, 64, 175, 0.2)",
  },
  neutral: {
    bg: "#f1f5f3",
    text: "#3d494c",
    border: "rgba(61, 73, 76, 0.15)",
  },
  primary: {
    bg: "rgba(210, 245, 68, 0.18)",
    text: "#141c1e",
    border: "rgba(210, 245, 68, 0.4)",
  },
};

export default function Badge({
  variant = "neutral",
  size = "md",
  className = "",
  style,
  children,
  ...props
}: BadgeProps) {
  const v = variantStyles[variant] || variantStyles.neutral;
  const isSm = size === "sm";

  return (
    <span
      className={`ui-badge ui-badge-${variant} ${className}`.trim()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: isSm ? "2px 8px" : "4px 10px",
        fontSize: isSm ? "11px" : "12px",
        fontWeight: 600,
        lineHeight: 1.3,
        borderRadius: "9999px",
        backgroundColor: v.bg,
        color: v.text,
        border: `1px solid ${v.border}`,
        whiteSpace: "nowrap",
        letterSpacing: "0.02em",
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}
