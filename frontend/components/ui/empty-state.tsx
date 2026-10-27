"use client";

import React from "react";

export interface EmptyStateProps {
  title?: string;
  message?: string;
  text?: string; // Backwards compatible with legacy <Empty text="..." />
  icon?: React.ReactNode;
  actionText?: string;
  onAction?: () => void;
  className?: string;
}

export default function EmptyState({
  title,
  message,
  text,
  icon,
  actionText,
  onAction,
  className = "",
}: EmptyStateProps) {
  const displayTitle = title || text || "Chưa có dữ liệu";
  const displayMessage = title ? message : undefined;

  return (
    <div
      className={`ui-empty-state ${className}`.trim()}
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "48px 24px",
        borderRadius: "16px",
        background: "var(--main-card-bg, #f5f8f6)",
        border: "1px dashed var(--border-input, #d5ddda)",
        color: "var(--text-subtle, #546366)",
        gap: "10px",
        margin: "12px 0",
        transition: "all 0.2s ease",
      }}
    >
      {icon ? (
        <div style={{ fontSize: "28px", marginBottom: "4px" }}>{icon}</div>
      ) : (
        <div
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "var(--lime-accent, #d2f544)",
            boxShadow: "0 0 0 4px rgba(210, 245, 68, 0.25)",
            marginBottom: "4px",
          }}
        />
      )}
      <h4
        style={{
          margin: 0,
          fontSize: "15px",
          fontWeight: 700,
          color: "var(--text-dark, #141c1e)",
          letterSpacing: "-0.01em",
        }}
      >
        {displayTitle}
      </h4>
      {displayMessage && (
        <p
          style={{
            margin: 0,
            fontSize: "13px",
            lineHeight: 1.5,
            color: "var(--text-subtle, #546366)",
            maxWidth: "360px",
          }}
        >
          {displayMessage}
        </p>
      )}
      {actionText && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            marginTop: "8px",
            padding: "8px 16px",
            fontSize: "13px",
            fontWeight: 600,
            borderRadius: "10px",
            background: "var(--sidebar-bg, #151d1f)",
            color: "#ffffff",
            border: "none",
            cursor: "pointer",
            transition: "transform 0.15s ease, background 0.15s ease",
          }}
        >
          {actionText}
        </button>
      )}
    </div>
  );
}
